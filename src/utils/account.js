'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, safeStorage, shell } = require('electron');
const { createClient } = require('@supabase/supabase-js');

const APP_PROTOCOL = 'cheating-daddy';
let supabaseClient = null;
let supabaseClientPromise = null;
let secureStorage = null;
let backendBaseUrl = '';
let authListener = null;
let deepLinkQueue = Promise.resolve();
let billingPendingUntil = 0;
let passwordRecoveryPending = false;

function getBackendBaseUrl() {
    const preferences = require('../storage').getPreferences();
    const configuredUrl = preferences.cloudBackendUrl || process.env.CHEATING_DADDY_BACKEND_URL || 'ws://127.0.0.1:8787/ws';
    const url = new URL(configuredUrl);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Backend URL must use ws:// or wss://');
    if (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('Account sign-in requires wss:// for remote backends');
    }
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}${url.pathname.replace(/\/ws\/?$/, '').replace(/\/$/, '')}`;
}

function validateCredentials(email, password, isSignUp) {
    if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new Error('Enter a valid email address.');
    }
    if (typeof password !== 'string' || password.length > 256 || password.length === 0) {
        throw new Error('Enter a valid password.');
    }
    if (isSignUp) validateNewPassword(password);
}

function validateNewPassword(password) {
    if (typeof password !== 'string' || password.length > 256 || password.length < 8) {
        throw new Error('Use a password with at least 8 characters.');
    }
}

function makeSecureStorage() {
    const storageDirectory = path.join(app.getPath('userData'), 'secure-auth');
    const getStoragePath = key => path.join(storageDirectory, `${crypto.createHash('sha256').update(key).digest('hex')}.bin`);
    return {
        getItem(key) {
            const itemPath = getStoragePath(key);
            if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(itemPath)) return null;
            try {
                const encrypted = fs.readFileSync(itemPath);
                return safeStorage.decryptString(encrypted);
            } catch (error) {
                console.warn('[Account] Could not read the saved session:', error.message);
                return null;
            }
        },
        setItem(key, value) {
            if (!safeStorage.isEncryptionAvailable()) return;
            const itemPath = getStoragePath(key);
            fs.mkdirSync(path.dirname(itemPath), { recursive: true });
            const encrypted = safeStorage.encryptString(value);
            fs.writeFileSync(itemPath, encrypted, { mode: 0o600 });
        },
        removeItem(key) {
            const itemPath = getStoragePath(key);
            if (fs.existsSync(itemPath)) fs.unlinkSync(itemPath);
        },
    };
}

function getSecureStorage() {
    if (!secureStorage) secureStorage = makeSecureStorage();
    return secureStorage;
}

async function getClient() {
    if (supabaseClient) return supabaseClient;
    if (supabaseClientPromise) return supabaseClientPromise;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure session storage is unavailable on this system.');
    backendBaseUrl = getBackendBaseUrl();
    supabaseClientPromise = (async () => {
        let response;
        try {
            response = await fetch(`${backendBaseUrl}/v1/auth/config`);
        } catch (fetchError) {
            throw new Error(`Cannot connect to cloud backend at ${backendBaseUrl}. Please ensure the backend is running.`);
        }
        let config;
        try {
            config = await response.json();
        } catch {
            throw new Error('Backend returned an invalid JSON response');
        }
        if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error(config.error || 'Account sign-in is not configured on the backend yet');
        }
        supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: {
                storage: getSecureStorage(),
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                flowType: 'pkce',
            },
        });
        return supabaseClient;
    })();
    try {
        return await supabaseClientPromise;
    } finally {
        supabaseClientPromise = null;
    }
}

async function getSafeAccountState() {
    let client;
    try {
        client = await getClient();
    } catch (error) {
        return { authenticated: false, user: null, subscription: null, billingPending: false, backendAvailable: false, error: error.message };
    }
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session)
        return { authenticated: false, user: null, subscription: null, billingPending: false, backendAvailable: true, passwordRecoveryPending };

    try {
        const response = await fetch(`${backendBaseUrl}/v1/account`, {
            headers: { authorization: `Bearer ${session.access_token}` },
        });
        const account = await response.json();
        if (response.status === 401) {
            await client.auth.signOut();
            return { authenticated: false, user: null, subscription: null, billingPending: false, backendAvailable: true };
        }
        if (!response.ok) {
            return {
                authenticated: true,
                user: { id: session.user.id, email: session.user.email },
                subscription: null,
                billingPending: Date.now() < billingPendingUntil,
                backendAvailable: true,
                passwordRecoveryPending,
                error: account.error || 'Could not load account status',
            };
        }
        if (account.subscription?.active) billingPendingUntil = 0;
        return {
            authenticated: true,
            user: { id: account.user.id, email: account.user.email },
            subscription: account.subscription,
            billingPending: Date.now() < billingPendingUntil,
            backendAvailable: true,
            passwordRecoveryPending,
        };
    } catch {
        return {
            authenticated: true,
            user: { id: session.user.id, email: session.user.email },
            subscription: null,
            billingPending: false,
            backendAvailable: false,
            passwordRecoveryPending,
            error: 'Backend is temporarily unavailable',
        };
    }
}

function broadcastAccountState() {
    getSafeAccountState()
        .then(state => {
            for (const window of require('electron').BrowserWindow.getAllWindows()) {
                window.webContents.send('account:state-changed', state);
            }
        })
        .catch(error => console.warn('[Account] Could not refresh account state:', error.message));
}

async function syncCloudPreferences() {
    try {
        const client = await getClient().catch(() => null);
        if (!client) return;
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session) return;
        const token = data.session.access_token;
        const backendUrl = backendBaseUrl || getBackendBaseUrl();
        const response = await fetch(`${backendUrl}/v1/preferences`, {
            headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const result = await response.json().catch(() => null);
        const cloudPrefs = result?.preferences;
        const storage = require('../storage');
        const localPrefs = storage.getPreferences();
        if (cloudPrefs && (cloudPrefs.customPrompt || cloudPrefs.selectedProfile || cloudPrefs.selectedLanguage)) {
            storage.setPreferences({
                ...localPrefs,
                customPrompt: cloudPrefs.customPrompt ?? localPrefs.customPrompt,
                selectedProfile: cloudPrefs.selectedProfile ?? localPrefs.selectedProfile,
                selectedLanguage: cloudPrefs.selectedLanguage ?? localPrefs.selectedLanguage,
                audioMode: cloudPrefs.audioMode ?? localPrefs.audioMode,
                selectedScreenshotInterval: cloudPrefs.selectedScreenshotInterval ?? localPrefs.selectedScreenshotInterval,
                selectedImageQuality: cloudPrefs.selectedImageQuality ?? localPrefs.selectedImageQuality,
                googleSearchEnabled: Boolean(cloudPrefs.googleSearchEnabled),
            });
            console.log('[Account] Preferences successfully synced from cloud');
        } else {
            await pushPreferencesToCloud(localPrefs);
        }
    } catch (err) {
        console.warn('[Account] Could not sync cloud preferences:', err.message);
    }
}

async function pushPreferencesToCloud(prefs) {
    try {
        const client = await getClient().catch(() => null);
        if (!client) return;
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session) return;
        const token = data.session.access_token;
        const backendUrl = backendBaseUrl || getBackendBaseUrl();
        await fetch(`${backendUrl}/v1/preferences`, {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(prefs || {}),
        });
    } catch (err) {
        console.warn('[Account] Could not push preferences to cloud:', err.message);
    }
}

function initializeAccount() {
    getClient()
        .then(client => {
            if (authListener) authListener.unsubscribe();
            const { data } = client.auth.onAuthStateChange(event => {
                if (event === 'PASSWORD_RECOVERY') {
                    passwordRecoveryPending = true;
                    for (const window of require('electron').BrowserWindow.getAllWindows()) {
                        window.webContents.send('account:password-recovery');
                    }
                }
                if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                    syncCloudPreferences();
                }
                setTimeout(broadcastAccountState, 0);
            });
            authListener = data.subscription;
            broadcastAccountState();
            syncCloudPreferences();
        })
        .catch(error => console.info('[Account] Sign-in is not configured:', error.message));
}

function registerAuthDeepLink(urlString) {
    if (typeof urlString !== 'string' || !urlString.startsWith(`${APP_PROTOCOL}://`)) return;
    deepLinkQueue = deepLinkQueue
        .then(async () => {
            const url = new URL(urlString);
            if (url.hostname === 'auth' && url.pathname === '/callback') {
                const returnedState = url.searchParams.get('state') || '';
                const storage = getSecureStorage();
                const expectedState = storage.getItem('account.auth.state');
                if (!expectedState || returnedState !== expectedState) throw new Error('Sign-in callback state did not match');
                storage.removeItem('account.auth.state');
                const code = url.searchParams.get('code');
                if (!code) {
                    const callbackError = new URLSearchParams(url.hash.replace(/^#/, '')).get('error_description');
                    throw new Error(
                        callbackError || url.searchParams.get('error_description') || 'Sign-in was not completed. Request a new link and try again.'
                    );
                }
                const client = await getClient();
                const { error } = await client.auth.exchangeCodeForSession(code);
                if (error) throw error;
                broadcastAccountState();
            } else if (url.hostname === 'billing' && url.pathname === '/return') {
                broadcastAccountState();
            }
        })
        .catch(error => {
            console.warn('[Account] Could not process app callback:', error.message);
            for (const window of require('electron').BrowserWindow.getAllWindows()) {
                window.webContents.send('account:callback-error', error.message);
            }
        });
}

function setupAccountIpcHandlers() {
    ipcMain.handle('account:get-state', () => getSafeAccountState());
    ipcMain.handle('account:sign-up', async (_event, email, password) => {
        validateCredentials(email, password, true);
        const client = await getClient();
        const state = crypto.randomBytes(24).toString('hex');
        getSecureStorage().setItem('account.auth.state', state);
        const redirectTo = `${APP_PROTOCOL}://auth/callback?state=${state}`;
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } });
        if (error) {
            getSecureStorage().removeItem('account.auth.state');
            throw error;
        }
        if (data.session) broadcastAccountState();
        return { confirmationRequired: !data.session, email: data.user?.email || email };
    });
    ipcMain.handle('account:sign-in', async (_event, email, password) => {
        validateCredentials(email, password, false);
        const client = await getClient();
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        broadcastAccountState();
        syncCloudPreferences();
        return { authenticated: Boolean(data.session) };
    });
    ipcMain.handle('account:request-password-reset', async (_event, email) => {
        if (typeof email !== 'string' || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            throw new Error('Enter a valid email address.');
        }
        const client = await getClient();
        const state = crypto.randomBytes(24).toString('hex');
        getSecureStorage().setItem('account.auth.state', state);
        const redirectTo = `${APP_PROTOCOL}://auth/callback?state=${state}`;
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) {
            getSecureStorage().removeItem('account.auth.state');
            throw error;
        }
        return { requested: true };
    });
    ipcMain.handle('account:update-password', async (_event, password) => {
        validateNewPassword(password);
        const client = await getClient();
        const { data, error } = await client.auth.updateUser({ password });
        if (error) throw error;
        passwordRecoveryPending = false;
        broadcastAccountState();
        return { updated: Boolean(data.user) };
    });
    ipcMain.handle('account:sign-out', async () => {
        const client = await getClient();
        const { error } = await client.auth.signOut();
        if (error) throw error;
        passwordRecoveryPending = false;
        require('./cloud').closeCloud();
        broadcastAccountState();
        return { success: true };
    });
    ipcMain.handle('account:checkout', async () => openBillingSession('/v1/billing/checkout'));
    ipcMain.handle('account:portal', async () => openBillingSession('/v1/billing/portal'));
    ipcMain.handle('account:get-access-token', async () => {
        const client = await getClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('Sign in to your account to use Cloud AI');
        return data.session.access_token;
    });
    ipcMain.handle('account:get-trial-status', async () => {
        const client = await getClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) return { hasActiveSubscription: false, freeTrialsRemaining: 0 };
        backendBaseUrl = backendBaseUrl || getBackendBaseUrl();
        const response = await fetch(`${backendBaseUrl}/v1/trial/status`, {
            headers: { authorization: `Bearer ${data.session.access_token}` },
        });
        return await response.json();
    });
    ipcMain.handle('account:handle-deep-link', (_event, url) => {
        registerAuthDeepLink(url);
        return { success: true };
    });
    ipcMain.handle('account:sync-preferences', async () => {
        await syncCloudPreferences();
        return { success: true };
    });
}

async function openBillingSession(pathname) {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Sign in before managing your subscription');
    backendBaseUrl = backendBaseUrl || getBackendBaseUrl();
    const response = await fetch(`${backendBaseUrl}${pathname}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${data.session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok || !result.url) throw new Error(result.error || 'Could not open billing');
    await shell.openExternal(result.url);
    if (pathname.endsWith('/checkout')) {
        billingPendingUntil = Date.now() + 2 * 60 * 1000;
        broadcastAccountState();
    }
    return { success: true };
}

async function getAccessToken() {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session?.access_token || '';
}

module.exports = {
    APP_PROTOCOL,
    getAccessToken,
    initializeAccount,
    registerAuthDeepLink,
    setupAccountIpcHandlers,
    syncCloudPreferences,
    pushPreferencesToCloud,
};
