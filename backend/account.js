'use strict';

const crypto = require('node:crypto');

const APP_PROTOCOL = 'cheating-daddy';

function sendJson(response, status, value) {
    if (response.headersSent) return true;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
    return true;
}

const fs = require('node:fs');
const path = require('node:path');

function ensureEnvLoaded() {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const envPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        if (typeof process.loadEnvFile === 'function') {
            try {
                process.loadEnvFile(envPath);
            } catch {}
        } else {
            try {
                const lines = fs.readFileSync(envPath, 'utf8').split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.slice(0, eqIdx).trim();
                        const val = trimmed
                            .slice(eqIdx + 1)
                            .trim()
                            .replace(/^['"](.*)['"]$/, '$1');
                        if (process.env[key] === undefined) process.env[key] = val;
                    }
                }
            } catch {}
        }
    }
}

function getSupabaseConfig() {
    ensureEnvLoaded();
    return {
        url: process.env.SUPABASE_URL?.replace(/\/$/, ''),
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
}

function getStripeConfig() {
    ensureEnvLoaded();
    return {
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        priceId: process.env.STRIPE_PRICE_ID,
        publicBackendUrl: process.env.PUBLIC_BACKEND_URL?.replace(/\/$/, ''),
    };
}

async function readBody(request, maxBytes = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function readJson(request) {
    try {
        return JSON.parse((await readBody(request)).toString('utf8'));
    } catch (error) {
        if (error.statusCode) throw error;
        throw Object.assign(new Error('Expected a JSON request body'), { statusCode: 400 });
    }
}

function authHeaders(anonKey, accessToken) {
    return {
        apikey: anonKey,
        authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${anonKey}`,
        'content-type': 'application/json',
    };
}

async function getUser(accessToken) {
    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) throw Object.assign(new Error('Supabase Auth is not configured'), { statusCode: 503 });
    const response = await fetch(`${url}/auth/v1/user`, { headers: authHeaders(anonKey, accessToken) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.msg || data.message || 'Sign in to continue'), { statusCode: 401 });
    return data;
}

function getBearerToken(request) {
    const header = request.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function getSubscription(userId) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    if (!serviceRoleKey) throw Object.assign(new Error('Supabase service role key is not configured'), { statusCode: 503 });
    const query = new URLSearchParams({
        select: 'user_id,stripe_customer_id,stripe_subscription_id,price_id,status,current_period_end,cancel_at_period_end,free_trials_used,free_trials_allowed',
        user_id: `eq.${userId}`,
        limit: '1',
    });
    const response = await fetch(`${url}/rest/v1/subscriptions?${query}`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Could not read subscription status');
    const rows = await response.json();
    return rows[0] || null;
}

async function ensureSubscription(userId) {
    let sub = await getSubscription(userId);
    if (!sub) {
        const { url, serviceRoleKey } = getSupabaseConfig();
        const row = {
            user_id: userId,
            status: 'inactive',
            free_trials_used: 0,
            free_trials_allowed: 5,
        };
        const query = new URLSearchParams({ on_conflict: 'user_id' });
        const response = await fetch(`${url}/rest/v1/subscriptions?${query}`, {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                authorization: `Bearer ${serviceRoleKey}`,
                'content-type': 'application/json',
                prefer: 'resolution=ignore-duplicates,return=representation',
            },
            body: JSON.stringify(row),
        });
        if (!response.ok) throw Object.assign(new Error('Could not initialize account subscription'), { statusCode: 503 });
        const data = await response.json().catch(() => []);
        sub = data[0] || (await getSubscription(userId));
        if (!sub) throw Object.assign(new Error('Could not initialize account subscription'), { statusCode: 503 });
    }
    return sub;
}

async function consumeFreeTrial(userId) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    const current = await ensureSubscription(userId);
    const usedBefore = Number(current.free_trials_used) || 0;
    const allowed = Number(current.free_trials_allowed) || 5;
    if (usedBefore >= allowed) throw Object.assign(new Error('No free trials remain'), { statusCode: 403 });
    const filters = new URLSearchParams({ user_id: `eq.${userId}`, free_trials_used: `eq.${usedBefore}` });
    const response = await fetch(`${url}/rest/v1/subscriptions?${filters}`, {
        method: 'PATCH',
        headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
            prefer: 'return=representation',
        },
        body: JSON.stringify({ free_trials_used: usedBefore + 1 }),
    });
    if (!response.ok) throw Object.assign(new Error('Could not reserve a free trial'), { statusCode: 503 });
    const rows = await response.json().catch(() => []);
    if (!rows[0]) throw Object.assign(new Error('A free trial was just started on this account. Refresh and try again.'), { statusCode: 409 });
    return { free_trials_used: usedBefore + 1, free_trials_allowed: allowed };
}

async function requireActiveUser(request) {
    const accessToken = getBearerToken(request);
    if (!accessToken) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
    const user = await getUser(accessToken);
    return { user, accessToken };
}

async function stripeRequest(path, params, method = 'POST') {
    const { secretKey } = getStripeConfig();
    if (!secretKey) throw Object.assign(new Error('Stripe is not configured'), { statusCode: 503 });
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
        method,
        headers: {
            authorization: `Bearer ${secretKey}`,
            ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(method === 'POST' ? { body: params.toString() } : {}),
    });
    const result = await response.json();
    if (!response.ok)
        throw Object.assign(new Error(result.error?.message || 'Stripe request failed'), { statusCode: response.status >= 500 ? 502 : 400 });
    return result;
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const values = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=', 2)));
    const timestamp = Number(values.t);
    const signatures = signatureHeader
        .split(',')
        .filter(part => part.startsWith('v1='))
        .map(part => part.slice(3));
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || signatures.length === 0) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
    return signatures.some(signature => {
        if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
        return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    });
}

async function saveSubscription(userId, subscription, customerId) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    const row = {
        user_id: userId,
        stripe_customer_id: customerId || subscription.customer || null,
        stripe_subscription_id: subscription.id || null,
        price_id: subscription.items?.data?.[0]?.price?.id || process.env.STRIPE_PRICE_ID || null,
        status: subscription.status || 'canceled',
        current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    };
    const response = await fetch(`${url}/rest/v1/subscriptions?on_conflict=user_id`, {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
            prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
    });
    if (!response.ok) throw new Error(`Could not persist subscription status (${response.status})`);
}

async function syncStripeEvent(event) {
    const object = event.data?.object;
    if (!object) return;
    let userId = object.metadata?.app_user_id || object.client_reference_id;
    let customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    let subscription = object;

    if (object.object === 'checkout.session' && object.subscription) {
        userId = userId || object.metadata?.app_user_id;
        const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
        subscription = await stripeRequest(`subscriptions/${subscriptionId}`, null, 'GET');
        userId = userId || subscription.metadata?.app_user_id;
    } else if (object.object === 'subscription') {
        if (event.type === 'customer.subscription.deleted') {
            subscription.status = 'canceled';
        } else {
            // Read Stripe's latest object so a delayed webhook cannot overwrite newer subscription state.
            subscription = await stripeRequest(`subscriptions/${object.id}`, null, 'GET');
        }
    } else {
        return;
    }

    if (!userId) {
        console.warn('[Billing] Ignoring Stripe subscription event without app_user_id:', event.id);
        return;
    }
    await saveSubscription(userId, subscription, customerId);
}

function billingReturnPage(cancelled = false) {
    const heading = cancelled ? 'Checkout cancelled' : 'Payment received';
    const description = cancelled
        ? 'Your plan was not changed. You can return to the app and try again whenever you are ready.'
        : 'Your subscription is being confirmed. Return to the app and it will refresh your account status.';
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>body{margin:0;background:#0a0a0a;color:#f5f5f5;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:440px;padding:36px;border:1px solid #262626;border-radius:16px;background:#111;text-align:center}p{color:#a3a3a3;line-height:1.6}a{display:inline-block;margin-top:18px;padding:12px 18px;background:#3b82f6;color:white;text-decoration:none;border-radius:8px;font-weight:600}</style><main class="card"><h1>${heading}</h1><p>${description}</p><a href="${APP_PROTOCOL}://billing/return">Return to Cheating Daddy</a></main></html>`;
}

async function handleAccountRequest(request, response, requestUrl) {
    const route = requestUrl.pathname;
    try {
        if (request.method === 'GET' && route === '/v1/auth/config') {
            const { url, anonKey } = getSupabaseConfig();
            if (!url || !anonKey) return sendJson(response, 503, { error: 'Supabase Auth is not configured' });
            return sendJson(response, 200, { supabaseUrl: url, supabaseAnonKey: anonKey });
        }

        if (request.method === 'GET' && route === '/v1/account') {
            const { user } = await requireActiveUser(request);
            const subscription = await ensureSubscription(user.id);
            const active = ['active', 'trialing'].includes(subscription?.status);
            const trialsUsed = subscription?.free_trials_used || 0;
            const trialsAllowed = subscription?.free_trials_allowed || 5;
            return sendJson(response, 200, {
                user: { id: user.id, email: user.email },
                subscription: {
                    ...(subscription || {}),
                    active,
                    freeTrialsUsed: trialsUsed,
                    freeTrialsAllowed: trialsAllowed,
                    freeTrialsRemaining: Math.max(0, trialsAllowed - trialsUsed),
                },
            });
        }

        if (request.method === 'GET' && route === '/v1/trial/status') {
            const { user } = await requireActiveUser(request);
            const subscription = await ensureSubscription(user.id);
            const isPaidActive = ['active', 'trialing'].includes(subscription?.status);
            const used = subscription?.free_trials_used || 0;
            const allowed = subscription?.free_trials_allowed || 5;
            return sendJson(response, 200, {
                hasActiveSubscription: isPaidActive,
                freeTrialsUsed: used,
                freeTrialsAllowed: allowed,
                freeTrialsRemaining: Math.max(0, allowed - used),
                sessionDurationSeconds: 300,
            });
        }

        if (request.method === 'POST' && route === '/v1/billing/checkout') {
            const { user } = await requireActiveUser(request);
            const { priceId, publicBackendUrl } = getStripeConfig();
            if (!priceId || !publicBackendUrl) return sendJson(response, 503, { error: 'Stripe price and public backend URL must be configured' });
            const current = await getSubscription(user.id);
            if (['active', 'trialing'].includes(current?.status))
                return sendJson(response, 409, { error: 'Your account already has an active subscription' });
            const params = new URLSearchParams({
                mode: 'subscription',
                'line_items[0][price]': priceId,
                'line_items[0][quantity]': '1',
                client_reference_id: user.id,
                customer_email: user.email || '',
                'metadata[app_user_id]': user.id,
                'subscription_data[metadata][app_user_id]': user.id,
                success_url: `${publicBackendUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${publicBackendUrl}/billing/cancel`,
            });
            const checkout = await stripeRequest('checkout/sessions', params);
            return sendJson(response, 200, { url: checkout.url });
        }

        if (request.method === 'POST' && route === '/v1/billing/portal') {
            const { user } = await requireActiveUser(request);
            const current = await getSubscription(user.id);
            if (!current?.stripe_customer_id) return sendJson(response, 409, { error: 'No billing profile exists for this account yet' });
            const { publicBackendUrl } = getStripeConfig();
            if (!publicBackendUrl) return sendJson(response, 503, { error: 'Public backend URL is not configured' });
            const params = new URLSearchParams({ customer: current.stripe_customer_id, return_url: `${publicBackendUrl}/billing/return` });
            const portal = await stripeRequest('billing_portal/sessions', params);
            return sendJson(response, 200, { url: portal.url });
        }

        if (request.method === 'POST' && route === '/v1/billing/webhook') {
            const { webhookSecret } = getStripeConfig();
            const rawBody = await readBody(request, 1024 * 1024);
            if (!verifyStripeSignature(rawBody, request.headers['stripe-signature'], webhookSecret)) {
                return sendJson(response, 400, { error: 'Invalid Stripe webhook signature' });
            }
            const event = JSON.parse(rawBody.toString('utf8'));
            if (event.type.startsWith('checkout.session.') || event.type.startsWith('customer.subscription.')) {
                await syncStripeEvent(event);
            }
            return sendJson(response, 200, { received: true });
        }

        if (request.method === 'GET' && (route === '/billing/return' || route === '/billing/cancel')) {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            response.end(billingReturnPage(route === '/billing/cancel'));
            return true;
        }
    } catch (error) {
        sendJson(response, error.statusCode || 500, { error: error.message || 'Account request failed' });
        return true;
    }
    return false;
}

module.exports = {
    handleAccountRequest,
    getUser,
    getSubscription,
    ensureSubscription,
    consumeFreeTrial,
    getBearerToken,
};
