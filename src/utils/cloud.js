const WebSocket = require('ws');
const { BrowserWindow } = require('electron');

const DEFAULT_CLOUD_BACKEND_URL = process.env.CHEATING_DADDY_BACKEND_URL || 'ws://127.0.0.1:8787/ws';

let cloudWs = null;
let isCloudConnected = false;
let currentCloudResponse = '';
let currentTranscription = '';
let isFirstChunk = true;
let audioChunkCount = 0;
let onTurnComplete = null;
let currentCloudSource = 'audio';
let cloudAccessToken = '';
let cloudSessionId = '';
let screenshotEndpointBase = '';

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

function setOnTurnComplete(callback) {
    onTurnComplete = callback;
}

function connectCloud(token, profile, userContext, language = 'en-US', googleSearchEnabled = false, backendUrl = DEFAULT_CLOUD_BACKEND_URL) {
    // Close existing connection
    if (cloudWs) {
        try {
            cloudWs.close();
        } catch (e) {}
        cloudWs = null;
        isCloudConnected = false;
    }

    audioChunkCount = 0;
    cloudAccessToken = token;
    cloudSessionId = '';

    return new Promise((resolve, reject) => {
        let settled = false;
        const url = backendUrl || DEFAULT_CLOUD_BACKEND_URL;
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'wss:' && !(parsedUrl.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname))) {
            reject(new Error('Backend URL must use wss:// (ws:// is allowed for local development only)'));
            return;
        }
        const servicePath = parsedUrl.pathname.replace(/\/ws\/?$/, '').replace(/\/$/, '');
        screenshotEndpointBase = `${parsedUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${parsedUrl.host}${servicePath}`;
        console.log('[Cloud] Connecting to', url);

        cloudWs = new WebSocket(url);

        const timeout = setTimeout(() => {
            if (!isCloudConnected) {
                cloudWs?.close();
                reject(new Error('Cloud connection timeout'));
            }
        }, 10000);

        cloudWs.on('open', () => {
            console.log('[Cloud] WebSocket open');
            cloudWs.send(
                JSON.stringify({
                    type: 'start',
                    token,
                    profile: profile || 'interview',
                    userContext: userContext || '',
                    language: language || 'en-US',
                    googleSearchEnabled: Boolean(googleSearchEnabled),
                })
            );
        });

        cloudWs.on('message', data => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'session_ready') {
                    cloudSessionId = msg.sessionId || '';
                    isCloudConnected = true;
                    clearTimeout(timeout);
                    settled = true;
                    sendToRenderer('update-status', 'Cloud connected');
                    resolve(true);
                } else if (msg.type === 'error' && !isCloudConnected) {
                    clearTimeout(timeout);
                    settled = true;
                    reject(new Error(msg.message || 'Cloud session could not be started'));
                    cloudWs.close();
                    return;
                }
                handleMessage(msg);
            } catch (e) {
                console.error('[Cloud] Parse error:', e);
            }
        });

        cloudWs.on('close', (code, reason) => {
            console.log('[Cloud] WebSocket closed:', code, reason.toString());
            console.log('[Cloud] Audio chunks sent before close:', audioChunkCount);
            isCloudConnected = false;
            clearTimeout(timeout);
            if (!settled) {
                settled = true;
                reject(new Error('Cloud connection closed before the session was ready'));
            }
        });

        cloudWs.on('error', err => {
            console.error('[Cloud] WebSocket error:', err.message);
            isCloudConnected = false;
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            console.log('[Cloud] Server confirmed connected');
            break;

        case 'status':
            sendToRenderer('update-status', msg.status || 'Connected');
            break;

        case 'transcription':
            console.log('[Cloud] Transcription:', msg.text);
            currentTranscription += msg.text || '';
            sendToRenderer('update-status', 'Generating response...');
            break;

        case 'response_start':
            currentCloudResponse = '';
            isFirstChunk = true;
            currentCloudSource = msg.source || 'audio';
            break;

        case 'response_chunk':
            currentCloudResponse += msg.text;
            sendToRenderer(isFirstChunk ? 'new-response' : 'update-response', currentCloudResponse);
            isFirstChunk = false;
            break;

        case 'response_end':
            if (onTurnComplete && currentCloudResponse.trim()) {
                onTurnComplete(msg.transcription || currentTranscription, currentCloudResponse, msg.source || currentCloudSource);
            }
            currentTranscription = '';
            currentCloudResponse = '';
            currentCloudSource = 'audio';
            sendToRenderer('update-status', 'Listening...');
            break;

        case 'trial_started':
            sendToRenderer('trial-status', {
                status: 'started',
                durationSeconds: msg.durationSeconds || 300,
                trialsRemaining: msg.trialsRemaining,
                trialsAllowed: msg.trialsAllowed,
                message: msg.message,
            });
            sendToRenderer('update-status', `Free Trial (5m limit • ${msg.trialsRemaining} left)`);
            break;

        case 'trial_warning':
            sendToRenderer('trial-status', {
                status: 'warning',
                secondsRemaining: msg.secondsRemaining || 60,
                message: msg.message,
            });
            sendToRenderer('update-status', `Trial: ${msg.secondsRemaining}s remaining`);
            break;

        case 'trial_expired':
            sendToRenderer('trial-status', {
                status: 'expired',
                message: msg.message,
            });
            sendToRenderer('update-status', 'Trial completed (5m limit reached)');
            sendToRenderer('cloud-trial-expired', msg);
            break;

        case 'session_end':
            console.log('[Cloud] Session ended by server');
            isCloudConnected = false;
            break;

        case 'error':
            console.error('[Cloud] Server error:', msg.message);
            sendToRenderer('update-status', 'Cloud error: ' + msg.message);
            break;

        default:
            console.log('[Cloud] Event:', msg.type);
    }
}

function sendCloudAudio(pcmBuffer) {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN) {
        return;
    }

    cloudWs.send(
        JSON.stringify({
            type: 'audio',
            data: pcmBuffer.toString('base64'),
            mimeType: 'audio/pcm;rate=24000',
        }),
        err => err && console.error('[Cloud] Audio send error:', err.message)
    );

    audioChunkCount++;
    process.stdout.write('.');
}

function sendCloudText(text) {
    if (cloudWs && isCloudConnected && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(JSON.stringify({ type: 'text', text }));
    }
}

async function sendCloudImage(base64Data, prompt = '') {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN || !cloudSessionId) {
        return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await fetch(`${screenshotEndpointBase}/v1/sessions/${cloudSessionId}/screenshot`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${cloudAccessToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ data: base64Data, prompt }),
            signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Screenshot request failed (${response.status})`);
        return { success: true, summary: result.summary || '' };
    } catch (error) {
        console.error('[Cloud] Screenshot request failed:', error.message);
        return { success: false, error: error.name === 'AbortError' ? 'Screenshot analysis timed out' : error.message };
    } finally {
        clearTimeout(timeout);
    }
}

function closeCloud() {
    console.log('[Cloud] Closing. Audio chunks sent:', audioChunkCount);
    if (cloudWs) {
        try {
            if (cloudWs.readyState === WebSocket.OPEN) {
                cloudWs.send(JSON.stringify({ type: 'end' }));
            }
            cloudWs.close();
        } catch (e) {
            console.error('[Cloud] Close error:', e);
        }
        cloudWs = null;
    }
    isCloudConnected = false;
    cloudAccessToken = '';
    cloudSessionId = '';
    screenshotEndpointBase = '';
    currentCloudResponse = '';
    currentTranscription = '';
    isFirstChunk = true;
    currentCloudSource = 'audio';
    audioChunkCount = 0;
    onTurnComplete = null;
}

function isCloudActive() {
    return isCloudConnected && cloudWs && cloudWs.readyState === WebSocket.OPEN;
}

module.exports = {
    connectCloud,
    sendCloudAudio,
    sendCloudText,
    sendCloudImage,
    closeCloud,
    isCloudActive,
    setOnTurnComplete,
};
