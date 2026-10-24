'use strict';

const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    if (typeof process.loadEnvFile === 'function') {
        try {
            process.loadEnvFile(envPath);
        } catch (error) {
            console.warn('[Backend] Could not load .env via process.loadEnvFile:', error.message);
        }
    } else {
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            for (const line of envContent.split('\n')) {
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
        } catch (error) {
            console.warn('[Backend] Could not parse .env fallback:', error.message);
        }
    }
}

const crypto = require('node:crypto');
const http = require('node:http');
const { GoogleGenAI, Modality } = require('@google/genai');
const { WebSocketServer, WebSocket } = require('ws');
const { getSystemPrompt } = require('./prompts');
const { handleAccountRequest, getUser, getSubscription, ensureSubscription, consumeFreeTrial } = require('./account');

const PORT = Number(process.env.PORT || 8787);
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_HTTP_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;
const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const activeSessions = new Map();

function sendHttpJson(response, status, body) {
    if (response.headersSent) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_HTTP_BODY_BYTES) {
                if (!request.bodyTooLarge) {
                    request.bodyTooLarge = true;
                    reject(Object.assign(new Error('Screenshot request is too large'), { statusCode: 413 }));
                }
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (request.bodyTooLarge) return;
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(Object.assign(new Error('Expected a JSON request body'), { statusCode: 400 }));
            }
        });
        request.on('error', reject);
    });
}

async function analyzeScreenshot(ai, image, prompt) {
    const result = await ai.models.generateContent({
        model: VISION_MODEL,
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: `${prompt}\n\nAnalyze the screenshot and return a concise, useful summary of the visible content. Do not claim details that are not visible.`,
                    },
                    { inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } },
                ],
            },
        ],
    });
    const summary = typeof result.text === 'string' ? result.text.trim() : '';
    if (!summary) throw new Error('Vision model returned an empty summary');
    return summary.slice(0, 12000);
}

const httpServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (await handleAccountRequest(request, response, requestUrl)) return;
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
        sendHttpJson(response, 200, { ok: true });
        return;
    }

    const screenshotMatch = requestUrl.pathname.match(/^\/v1\/sessions\/([a-f0-9-]{36})\/screenshot$/i);
    if (request.method === 'POST' && screenshotMatch) {
        try {
            const sessionContext = activeSessions.get(screenshotMatch[1]);
            const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
            const authConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
            const user = authConfigured && token ? await getUser(token).catch(() => null) : null;
            const subscription = user ? await getSubscription(user.id).catch(() => null) : null;
            const accountAuthorized =
                user &&
                user.id === sessionContext?.userId &&
                !sessionContext.isClosing &&
                (sessionContext.isTrialSession || ['active', 'trialing'].includes(subscription?.status));
            if (!accountAuthorized) {
                sendHttpJson(response, 401, { error: 'Invalid credentials or inactive subscription' });
                return;
            }

            if (!sessionContext || sessionContext.isClosing || !sessionContext.session) {
                sendHttpJson(response, 404, { error: 'Active session not found' });
                return;
            }

            const body = await readJsonBody(request);
            if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.data !== 'string') {
                sendHttpJson(response, 400, { error: 'Request must include Base64 JPEG data' });
                return;
            }
            let image;
            try {
                image = decodeBase64(body.data, MAX_IMAGE_BYTES, 'image');
            } catch (error) {
                sendHttpJson(response, error.message.includes('must be between') ? 413 : 400, { error: error.message });
                return;
            }
            if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
                sendHttpJson(response, 400, { error: 'Screenshot must be a complete JPEG image' });
                return;
            }
            const prompt =
                typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 12000) : 'Describe and help with this screen.';

            // Keep context updates ordered so simultaneous screenshots cannot reorder the Live conversation.
            const operation = sessionContext.screenshotQueue.then(async () => {
                if (sessionContext.isClosing || !sessionContext.session) throw new Error('Active session is closing');
                sendJson(sessionContext.socket, { type: 'status', status: 'Analyzing screenshot...' });
                const summary = await analyzeScreenshot(sessionContext.ai, image, prompt);
                sessionContext.responseSource = 'image';
                sessionContext.currentTranscription = prompt;
                sessionContext.session.sendRealtimeInput({
                    text: `The user shared a screenshot. Their request is: ${prompt}\n\nScreenshot summary:\n${summary}\n\nUse this visual context to answer the user's request.`,
                });
                sendJson(sessionContext.socket, { type: 'screenshot_summary', summary });
                return summary;
            });
            sessionContext.screenshotQueue = operation.catch(() => {});
            const summary = await operation;
            sendHttpJson(response, 200, { ok: true, summary });
        } catch (error) {
            if (!response.headersSent) {
                sendHttpJson(response, error.statusCode || 502, { error: error.message || 'Unable to analyze screenshot' });
            }
        }
        return;
    }

    if (!response.headersSent) {
        sendHttpJson(response, 404, { error: 'not found' });
    }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_PAYLOAD_BYTES });

function sendJson(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function decodeBase64(value, maxBytes, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
        throw new Error(`Invalid ${label} data`);
    }
    const buffer = Buffer.from(value, 'base64');
    if (buffer.length === 0 || buffer.length > maxBytes) {
        throw new Error(`${label} must be between 1 byte and ${maxBytes} bytes`);
    }
    return buffer;
}

function resample24kTo16k(inputBuffer, remainder) {
    const combined = Buffer.concat([remainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2);
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let index = 0; index < outputSamples; index += 1) {
        const sourcePosition = (index * 3) / 2;
        const sourceIndex = Math.floor(sourcePosition);
        const fraction = sourcePosition - sourceIndex;
        const first = combined.readInt16LE(sourceIndex * 2);
        const second = sourceIndex + 1 < inputSamples ? combined.readInt16LE((sourceIndex + 1) * 2) : first;
        const sample = Math.round(first + fraction * (second - first));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), index * 2);
    }

    const consumedSamples = Math.ceil((outputSamples * 3) / 2);
    const nextRemainder = combined.slice(consumedSamples * 2);
    return { outputBuffer, remainder: nextRemainder };
}

function safeProfile(value) {
    const supported = new Set(['interview', 'sales', 'meeting', 'presentation', 'negotiation', 'exam']);
    return supported.has(value) ? value : 'interview';
}

wss.on('connection', socket => {
    let sessionContext = null;
    let isStarting = false;
    let isClosing = false;
    let responseStarted = false;
    let responseSource = 'audio';
    let currentTranscription = '';
    let resampleRemainder = Buffer.alloc(0);
    let sessionId = null;
    let ai = null;

    const fail = (message, close = false) => {
        sendJson(socket, { type: 'error', message });
        if (close && socket.readyState === WebSocket.OPEN) socket.close(1008, 'Session rejected');
    };

    const closeSession = async () => {
        if (isClosing && !sessionContext?.session) return;
        isClosing = true;
        if (sessionContext) {
            sessionContext.isClosing = true;
            if (sessionContext.trialTimers) {
                for (const timer of sessionContext.trialTimers) clearTimeout(timer);
                sessionContext.trialTimers = [];
            }
        }
        if (sessionId) activeSessions.delete(sessionId);
        if (sessionContext?.session) {
            try {
                await sessionContext.session.close();
            } catch (error) {
                console.warn('[Backend] Gemini close error:', error.message);
            }
            sessionContext.session = null;
        }
    };

    const startSession = async message => {
        if (isStarting || sessionContext?.session) throw new Error('Session has already been started');
        if (!process.env.GEMINI_API_KEY) throw new Error('Backend is missing GEMINI_API_KEY');
        let accountUser = null;
        let isTrialSession = false;
        let requiresTrialReservation = false;
        let trialAllowance = 5;
        let trialsRemaining = 0;
        const authConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
        if (authConfigured) {
            accountUser = await getUser(typeof message.token === 'string' ? message.token : '').catch(() => null);
            if (!accountUser) throw new Error('Sign in again to use Cloud AI');
            const subscription = await ensureSubscription(accountUser.id).catch(() => null);
            const isPaidActive = ['active', 'trialing'].includes(subscription?.status);
            if (!isPaidActive) {
                const used = subscription?.free_trials_used || 0;
                const allowed = subscription?.free_trials_allowed || 5;
                if (used >= allowed) {
                    throw new Error(`You have used all ${allowed} of your 5-minute free trials. Please upgrade to continue.`);
                }
                requiresTrialReservation = true;
                trialAllowance = allowed;
            }
        } else {
            throw new Error('Supabase Auth and subscription storage must be configured to use Cloud AI');
        }
        isStarting = true;
        sendJson(socket, { type: 'status', status: 'Connecting to AI...' });

        const profile = safeProfile(message.profile);
        const userContext = typeof message.userContext === 'string' ? message.userContext.slice(0, 12000) : '';
        const language = typeof message.language === 'string' ? message.language.slice(0, 32) : 'en-US';
        const googleSearchEnabled = message.googleSearchEnabled === true;
        const systemPrompt = getSystemPrompt(profile, userContext, googleSearchEnabled);
        const tools = googleSearchEnabled ? [{ googleSearch: {} }] : [];
        ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { apiVersion: 'v1alpha' },
        });

        const session = await ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.AUDIO],
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                contextWindowCompression: { slidingWindow: {} },
                speechConfig: { languageCode: language },
                systemInstruction: { parts: [{ text: systemPrompt }] },
                tools,
            },
            callbacks: {
                onopen: () => sendJson(socket, { type: 'status', status: 'AI session connected' }),
                onmessage: message => {
                    const serverContent = message.serverContent;
                    if (!serverContent) return;

                    const inputText = serverContent.inputTranscription?.text;
                    if (responseSource === 'audio' && typeof inputText === 'string' && inputText.trim()) {
                        currentTranscription += inputText;
                        sendJson(socket, { type: 'transcription', text: inputText });
                    }

                    const outputText = serverContent.outputTranscription?.text;
                    if (typeof outputText === 'string' && outputText) {
                        if (!responseStarted) {
                            responseStarted = true;
                            sendJson(socket, { type: 'response_start', source: responseSource });
                        }
                        sendJson(socket, { type: 'response_chunk', text: outputText, source: responseSource });
                    }

                    if (serverContent.turnComplete) {
                        sendJson(socket, {
                            type: 'response_end',
                            source: responseSource,
                            transcription: currentTranscription.trim(),
                        });
                        responseStarted = false;
                        currentTranscription = '';
                        responseSource = 'audio';
                        sendJson(socket, { type: 'status', status: 'Listening...' });
                    }
                },
                onerror: event => {
                    const errorMessage = event?.message || 'Gemini session error';
                    console.error('[Backend] Gemini session error:', errorMessage);
                    fail(errorMessage);
                },
                onclose: event => {
                    if (sessionContext) sessionContext.session = null;
                    if (sessionId) activeSessions.delete(sessionId);
                    if (!isClosing) {
                        sendJson(socket, { type: 'session_end', reason: event?.reason || 'AI session closed' });
                        if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'AI session closed');
                    }
                },
            },
        });

        if (requiresTrialReservation) {
            try {
                const trialResult = await consumeFreeTrial(accountUser.id);
                isTrialSession = true;
                trialsRemaining = Math.max(0, trialAllowance - trialResult.free_trials_used);
            } catch (error) {
                try {
                    await session.close();
                } catch (closeError) {
                    console.warn('[Backend] Could not close unreserved trial session:', closeError.message);
                }
                isStarting = false;
                throw error;
            }
        }

        isStarting = false;
        if (socket.readyState !== WebSocket.OPEN) {
            sessionContext = { session };
            await closeSession();
            return;
        }
        sessionId = crypto.randomUUID();
        sessionContext = {
            id: sessionId,
            userId: accountUser?.id || null,
            socket,
            session,
            ai,
            isClosing: false,
            isTrialSession,
            screenshotQueue: Promise.resolve(),
            get responseSource() {
                return responseSource;
            },
            set responseSource(value) {
                responseSource = value;
            },
            get currentTranscription() {
                return currentTranscription;
            },
            set currentTranscription(value) {
                currentTranscription = value;
            },
        };
        activeSessions.set(sessionId, sessionContext);
        sendJson(socket, { type: 'session_ready', sessionId, model: MODEL });

        if (isTrialSession) {
            sendJson(socket, {
                type: 'trial_started',
                durationSeconds: 300,
                trialsRemaining,
                trialsAllowed: 5,
                message: `Free trial active (5 min limit). ${trialsRemaining} trial(s) remaining after this session.`,
            });

            // 1-minute warning timer (at 4 minutes = 240 seconds)
            const warningTimer = setTimeout(() => {
                if (socket.readyState === WebSocket.OPEN && !isClosing) {
                    sendJson(socket, {
                        type: 'trial_warning',
                        secondsRemaining: 60,
                        message: 'Trial session will end in 1 minute.',
                    });
                }
            }, 240 * 1000);

            // Expiration timer (at 5 minutes = 300 seconds)
            const expirationTimer = setTimeout(async () => {
                if (socket.readyState === WebSocket.OPEN) {
                    sendJson(socket, {
                        type: 'trial_expired',
                        message: 'Your 5-minute trial session has completed. Please upgrade to continue.',
                    });
                    await closeSession();
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.close(1000, 'Trial session time limit reached');
                    }
                }
            }, 300 * 1000);

            sessionContext.trialTimers = [warningTimer, expirationTimer];
        }
    };

    socket.on('message', async raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            fail('Expected a JSON message');
            return;
        }

        try {
            if (message.type === 'start') {
                await startSession(message);
                return;
            }
            if (message.type === 'end') {
                await closeSession();
                sendJson(socket, { type: 'session_end' });
                socket.close(1000, 'Session ended');
                return;
            }
            if (!sessionContext?.session || isClosing) throw new Error('No active AI session');

            if (message.type === 'audio') {
                const audio = decodeBase64(message.data, 512 * 1024, 'audio');
                const resampled = resample24kTo16k(audio, resampleRemainder);
                resampleRemainder = resampled.remainder;
                responseSource = 'audio';
                sessionContext.session.sendRealtimeInput({
                    audio: { data: resampled.outputBuffer.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
                });
                return;
            }

            if (message.type === 'text') {
                const text = typeof message.text === 'string' ? message.text.trim() : '';
                if (!text || text.length > 12000) throw new Error('Text must be between 1 and 12000 characters');
                responseSource = 'text';
                currentTranscription = text;
                sendJson(socket, { type: 'status', status: 'Generating response...' });
                sessionContext.session.sendRealtimeInput({ text });
                return;
            }

            if (message.type === 'image') throw new Error('Screenshots must use the REST screenshot endpoint');

            throw new Error(`Unsupported message type: ${String(message.type)}`);
        } catch (error) {
            fail(error.message || 'Unable to process message', message.type === 'start');
        }
    });

    socket.on('close', () => {
        if (sessionContext) sessionContext.isClosing = true;
        closeSession();
    });
    socket.on('error', error => console.warn('[Backend] Client socket error:', error.message));
});

httpServer.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n[Backend] Port ${PORT} is already in use by another process.`);
        console.error(`To stop the conflicting process, run:\n  kill -9 $(lsof -t -i :${PORT})\n`);
        process.exit(1);
    } else {
        console.error('[Backend] Server error:', error);
    }
});

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Listening on port ${PORT}; WebSocket path /ws`);
});
