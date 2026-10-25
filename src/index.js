if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const account = require('./utils/account');
const storage = require('./storage');

const geminiSessionRef = { current: null };
let mainWindow = null;
let pendingDeepLink = '';

if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(account.APP_PROTOCOL, process.execPath, [require('node:path').resolve(process.argv[1])]);
} else {
    app.setAsDefaultProtocolClient(account.APP_PROTOCOL);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function handleDeepLink(url) {
    if (typeof url !== 'string' || !url.startsWith(`${account.APP_PROTOCOL}://`)) return;
    if (BrowserWindow.getAllWindows().length === 0) pendingDeepLink = url;
    else account.registerAuthDeepLink(url);
    for (const window of BrowserWindow.getAllWindows()) {
        if (window.isMinimized()) window.restore();
        window.focus();
    }
}

app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});

app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find(argument => argument.startsWith(`${account.APP_PROTOCOL}://`));
    if (url) handleDeepLink(url);
});

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    return mainWindow;
}

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return;
    // Initialize storage (checks version, resets if needed)
    storage.initializeStorage();

    // Trigger screen recording permission prompt on macOS if not already granted
    if (process.platform === 'darwin') {
        const { desktopCapturer } = require('electron');
        desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    }

    createMainWindow();
    account.setupAccountIpcHandlers();
    account.initializeAccount();
    setupGeminiIpcHandlers(geminiSessionRef);
    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();

    const startupDeepLink = process.argv.find(argument => argument.startsWith(`${account.APP_PROTOCOL}://`));
    if (startupDeepLink || pendingDeepLink) {
        account.registerAuthDeepLink(startupDeepLink || pendingDeepLink);
        pendingDeepLink = '';
    }
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
    require('./utils/localai').closeLocalSession();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupStorageIpcHandlers() {
    // ============ CONFIG ============
    ipcMain.handle('storage:get-config', async () => {
        try {
            return { success: true, data: storage.getConfig() };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-config', async (event, config) => {
        try {
            storage.setConfig(config);
            return { success: true };
        } catch (error) {
            console.error('Error setting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-config', async (event, key, value) => {
        try {
            storage.updateConfig(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating config:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CREDENTIALS ============
    ipcMain.handle('storage:get-credentials', async () => {
        try {
            return { success: true, data: storage.getCredentials() };
        } catch (error) {
            console.error('Error getting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-credentials', async (event, credentials) => {
        try {
            storage.setCredentials(credentials);
            return { success: true };
        } catch (error) {
            console.error('Error setting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-api-key', async () => {
        try {
            return { success: true, data: storage.getApiKey() };
        } catch (error) {
            console.error('Error getting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-api-key', async (event, apiKey) => {
        try {
            storage.setApiKey(apiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-groq-api-key', async () => {
        try {
            return { success: true, data: storage.getGroqApiKey() };
        } catch (error) {
            console.error('Error getting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-groq-api-key', async (event, groqApiKey) => {
        try {
            storage.setGroqApiKey(groqApiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PREFERENCES ============
    ipcMain.handle('storage:get-preferences', async () => {
        try {
            return { success: true, data: storage.getPreferences() };
        } catch (error) {
            console.error('Error getting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-preferences', async (event, preferences) => {
        try {
            storage.setPreferences(preferences);
            account.pushPreferencesToCloud(storage.getPreferences()).catch(() => {});
            return { success: true };
        } catch (error) {
            console.error('Error setting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-preference', async (event, key, value) => {
        try {
            storage.updatePreference(key, value);
            account.pushPreferencesToCloud(storage.getPreferences()).catch(() => {});
            return { success: true };
        } catch (error) {
            console.error('Error updating preference:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ KEYBINDS ============
    ipcMain.handle('storage:get-keybinds', async () => {
        try {
            return { success: true, data: storage.getKeybinds() };
        } catch (error) {
            console.error('Error getting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-keybinds', async (event, keybinds) => {
        try {
            storage.setKeybinds(keybinds);
            return { success: true };
        } catch (error) {
            console.error('Error setting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ HISTORY (Local Cache + Cloud Sync) ============
    ipcMain.handle('storage:get-all-sessions', async () => {
        try {
            const localSessions = storage.getAllSessions() || [];
            const cloudSessions = await account.fetchCloudSessions().catch(() => []);
            const sessionMap = new Map();
            for (const s of localSessions) sessionMap.set(s.sessionId, s);
            for (const s of cloudSessions) {
                if (!sessionMap.has(s.sessionId) || (s.lastUpdated && s.lastUpdated > (sessionMap.get(s.sessionId).lastUpdated || 0))) {
                    sessionMap.set(s.sessionId, s);
                }
            }
            const merged = Array.from(sessionMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return { success: true, data: merged };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session', async (event, sessionId) => {
        try {
            let session = storage.getSession(sessionId);
            if (!session) {
                session = await account.fetchCloudSessionDetails(sessionId);
                if (session) {
                    storage.saveSession(sessionId, session);
                }
            }
            return { success: true, data: session };
        } catch (error) {
            console.error('Error getting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:save-session', async (event, sessionId, data) => {
        try {
            storage.saveSession(sessionId, data);
            const fullSession = storage.getSession(sessionId);
            account.pushSessionToCloud(sessionId, fullSession || data).catch(() => {});
            return { success: true };
        } catch (error) {
            console.error('Error saving session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-session', async (event, sessionId) => {
        try {
            storage.deleteSession(sessionId);
            account.deleteCloudSession(sessionId).catch(() => {});
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-all-sessions', async () => {
        try {
            const all = storage.getAllSessions() || [];
            storage.deleteAllSessions();
            for (const s of all) {
                account.deleteCloudSession(s.sessionId).catch(() => {});
            }
            return { success: true };
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ LIMITS ============
    ipcMain.handle('storage:get-today-limits', async () => {
        try {
            return { success: true, data: storage.getTodayLimits() };
        } catch (error) {
            console.error('Error getting today limits:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CLEAR ALL ============
    ipcMain.handle('storage:clear-all', async () => {
        try {
            storage.clearAllData();
            return { success: true };
        } catch (error) {
            console.error('Error clearing all data:', error);
            return { success: false, error: error.message };
        }
    });
}

function setupGeneralIpcHandlers() {
    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (mainWindow) {
            // Also save to storage
            storage.setKeybinds(newKeybinds);
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    // Debug logging from renderer
    ipcMain.on('log-message', (event, msg) => {
        console.log(msg);
    });
}
