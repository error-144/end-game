import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

/**
 * AuthView — sign-in / sign-up / password-reset / password-update
 *
 * Props:
 *   .onAuthenticated {Function}  — called when the user is fully signed in
 *   .onSkip          {Function}  — called when the user clicks "Continue without account"
 */
export class AuthView extends LitElement {
    static styles = css`
        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :host {
            display: block;
            height: 100%;
            width: 100%;
            position: fixed;
            top: 0;
            left: 0;
            overflow: hidden;
        }

        .auth-bg {
            width: 100%;
            height: 100%;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            overflow: hidden;
            background: #0a0a0a;
        }

        canvas.aurora {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        canvas.dither {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            opacity: 0.06;
            mix-blend-mode: overlay;
            pointer-events: none;
            image-rendering: pixelated;
        }

        .auth-card {
            position: relative;
            z-index: 2;
            width: 360px;
            background: rgba(17, 17, 17, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 36px 32px 32px;
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            display: flex;
            flex-direction: column;
            gap: 24px;
            animation: fadeUp 0.3s ease both;
        }

        @keyframes fadeUp {
            from {
                opacity: 0;
                transform: translateY(12px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .card-header {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .app-wordmark {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.35);
        }

        .card-title {
            font-size: 22px;
            font-weight: 600;
            color: #f5f5f5;
            line-height: 1.25;
        }

        .card-subtitle {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.45);
            line-height: 1.5;
            margin-top: 2px;
        }

        .form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        label {
            font-size: 12px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.5);
        }

        input[type='email'],
        input[type='password'],
        input[type='text'] {
            width: 100%;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 13px;
            color: #f5f5f5;
            font-family: var(--font);
            outline: none;
            transition:
                border-color 0.15s,
                background 0.15s;
            cursor: text;
            user-select: text;
        }

        input[type='email']:focus,
        input[type='password']:focus,
        input[type='text']:focus {
            border-color: rgba(59, 130, 246, 0.6);
            background: rgba(255, 255, 255, 0.07);
        }

        input::placeholder {
            color: rgba(255, 255, 255, 0.2);
        }

        .strength-bar {
            height: 3px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.08);
            overflow: hidden;
            margin-top: 4px;
        }

        .strength-fill {
            height: 100%;
            border-radius: 2px;
            transition:
                width 0.25s,
                background 0.25s;
        }

        .actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .btn-primary {
            width: 100%;
            padding: 11px;
            background: #3b82f6;
            border: none;
            border-radius: 8px;
            color: #ffffff;
            font-size: 13px;
            font-weight: 600;
            font-family: var(--font);
            cursor: pointer;
            transition:
                background 0.15s,
                opacity 0.15s,
                transform 0.1s;
            position: relative;
        }

        .btn-primary:hover:not(:disabled) {
            background: #2563eb;
        }
        .btn-primary:active:not(:disabled) {
            transform: scale(0.98);
        }
        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-primary.loading::after {
            content: '';
            position: absolute;
            right: 14px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255, 255, 255, 0.4);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
        }

        @keyframes spin {
            to {
                transform: translateY(-50%) rotate(360deg);
            }
        }

        .btn-ghost {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            font-size: 12px;
            font-family: var(--font);
            cursor: pointer;
            padding: 4px;
            text-align: center;
            transition: color 0.15s;
        }

        .btn-ghost:hover {
            color: rgba(255, 255, 255, 0.7);
        }

        .divider {
            display: flex;
            align-items: center;
            gap: 10px;
            color: rgba(255, 255, 255, 0.2);
            font-size: 11px;
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
        }

        .msg {
            font-size: 12px;
            line-height: 1.5;
            padding: 10px 12px;
            border-radius: 7px;
            animation: fadeUp 0.2s ease both;
        }

        .msg.error {
            background: rgba(239, 68, 68, 0.12);
            border: 1px solid rgba(239, 68, 68, 0.25);
            color: #fca5a5;
        }

        .msg.success {
            background: rgba(34, 197, 94, 0.12);
            border: 1px solid rgba(34, 197, 94, 0.25);
            color: #86efac;
        }

        .footer-links {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.3);
        }

        .footer-links button {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.5);
            font-size: 12px;
            font-family: var(--font);
            cursor: pointer;
            padding: 0;
            text-decoration: underline;
            text-underline-offset: 2px;
            transition: color 0.15s;
        }

        .footer-links button:hover {
            color: #f5f5f5;
        }

        .confirm-icon {
            font-size: 40px;
            text-align: center;
        }

        .confirm-email {
            font-size: 13px;
            font-weight: 600;
            color: #f5f5f5;
            word-break: break-all;
        }
    `;

    static properties = {
        mode: { type: String },
        email: { type: String },
        password: { type: String },
        confirmPassword: { type: String },
        loading: { type: Boolean },
        errorMsg: { type: String },
        successMsg: { type: String },
        confirmEmail: { type: String },
        initialMode: { type: String },
        onAuthenticated: { type: Function },
        onSkip: { type: Function },
        _strength: { state: true },
    };

    constructor() {
        super();
        this.mode = 'signin';
        this.email = '';
        this.password = '';
        this.confirmPassword = '';
        this.loading = false;
        this.errorMsg = '';
        this.successMsg = '';
        this.confirmEmail = '';
        this.initialMode = 'signin';
        this.onAuthenticated = () => {};
        this.onSkip = () => {};
        this._strength = 0;
        this._animId = null;
        this._time = 0;

        this._accountIpc = null;
        this._passwordRecoveryListener = null;
        this._callbackErrorListener = null;
        this._accountStateListener = null;
    }

    connectedCallback() {
        super.connectedCallback();
        if (!window.require || this._accountIpc) return;
        const { ipcRenderer } = window.require('electron');
        this._accountIpc = ipcRenderer;
        this._passwordRecoveryListener = () => {
            this.mode = 'update-password';
            this.successMsg = 'Recovery link accepted. Set your new password below.';
            this.errorMsg = '';
        };
        this._callbackErrorListener = (_event, msg) => {
            this.errorMsg = msg || 'Sign-in callback failed. Try again.';
            this.loading = false;
        };
        this._accountStateListener = (_event, state) => {
            if (state.authenticated && !state.passwordRecoveryPending && this.mode !== 'update-password') this.onAuthenticated(state);
        };
        ipcRenderer.on('account:password-recovery', this._passwordRecoveryListener);
        ipcRenderer.on('account:callback-error', this._callbackErrorListener);
        ipcRenderer.on('account:state-changed', this._accountStateListener);
        if (this.initialMode === 'update-password') {
            this.mode = 'update-password';
            this.successMsg = 'Recovery link accepted. Set your new password below.';
        } else {
            this._ipc('account:get-state')
                .then(state => {
                    if (state.authenticated && !state.passwordRecoveryPending && this.mode !== 'update-password') this.onAuthenticated(state);
                })
                .catch(() => {});
        }
    }

    firstUpdated() {
        this._startAurora();
        this._drawDither();
        setTimeout(() => {
            const input = this.shadowRoot.querySelector('input');
            if (input) input.focus();
        }, 80);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._accountIpc) {
            this._accountIpc.removeListener('account:password-recovery', this._passwordRecoveryListener);
            this._accountIpc.removeListener('account:callback-error', this._callbackErrorListener);
            this._accountIpc.removeListener('account:state-changed', this._accountStateListener);
            this._accountIpc = null;
        }
        if (this._animId) cancelAnimationFrame(this._animId);
    }

    _drawDither() {
        const canvas = this.shadowRoot.querySelector('canvas.dither');
        if (!canvas) return;
        const blockSize = 5;
        const cols = Math.ceil(canvas.offsetWidth / blockSize);
        const rows = Math.ceil(canvas.offsetHeight / blockSize);
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(cols, rows);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() > 0.5 ? 255 : 0;
            img.data[i] = v;
            img.data[i + 1] = v;
            img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
    }

    _startAurora() {
        const canvas = this.shadowRoot.querySelector('canvas.aurora');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const scale = 0.35;
        const resize = () => {
            canvas.width = Math.floor(canvas.offsetWidth * scale);
            canvas.height = Math.floor(canvas.offsetHeight * scale);
        };
        resize();

        const blobs = [
            { color: [30, 80, 180], x: 0.15, y: 0.2, vx: 0.28, vy: 0.2, phase: 0, r: 0.38 },
            { color: [80, 30, 160], x: 0.75, y: 0.2, vx: -0.22, vy: 0.3, phase: 1.5, r: 0.35 },
            { color: [10, 100, 140], x: 0.5, y: 0.7, vx: 0.2, vy: -0.25, phase: 3.0, r: 0.32 },
            { color: [40, 60, 200], x: 0.85, y: 0.55, vx: -0.25, vy: -0.28, phase: 4.5, r: 0.3 },
            { color: [60, 20, 140], x: 0.3, y: 0.85, vx: 0.18, vy: -0.35, phase: 6.0, r: 0.28 },
        ];

        const draw = () => {
            this._time += 0.01;
            const w = canvas.width,
                h = canvas.height,
                dim = Math.min(w, h);
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);
            for (const blob of blobs) {
                const cx = (blob.x + Math.sin(this._time * blob.vx + blob.phase) * 0.25) * w;
                const cy = (blob.y + Math.cos(this._time * blob.vy + blob.phase * 0.7) * 0.25) * h;
                const pr = blob.r * dim;
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
                grad.addColorStop(0, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, 0.45)`);
                grad.addColorStop(0.5, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, 0.18)`);
                grad.addColorStop(1, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, 0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }
            this._animId = requestAnimationFrame(draw);
        };
        draw();
    }

    _ipc(channel, ...args) {
        if (!window.require) return Promise.reject(new Error('IPC unavailable'));
        const { ipcRenderer } = window.require('electron');
        return ipcRenderer.invoke(channel, ...args);
    }

    _clearMessages() {
        this.errorMsg = '';
        this.successMsg = '';
    }

    _switchMode(mode) {
        this._clearMessages();
        this.password = '';
        this.confirmPassword = '';
        this._strength = 0;
        this.mode = mode;
        this.requestUpdate();
        setTimeout(() => {
            const input = this.shadowRoot.querySelector('input');
            if (input) input.focus();
        }, 80);
    }

    _passwordStrength(pw) {
        if (!pw) return 0;
        let score = 0;
        if (pw.length >= 8) score++;
        if (pw.length >= 12) score++;
        if (/[A-Z]/.test(pw)) score++;
        if (/[0-9]/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        return score;
    }

    _strengthColor(s) {
        if (s <= 1) return '#ef4444';
        if (s <= 2) return '#f97316';
        if (s <= 3) return '#eab308';
        return '#22c55e';
    }

    async handleSignIn(e) {
        e.preventDefault();
        this._clearMessages();
        const email = this.email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.errorMsg = 'Enter a valid email address.';
            return;
        }
        this.loading = true;
        try {
            const result = await this._ipc('account:sign-in', email, this.password);
            this.onAuthenticated(result?.state);
        } catch (err) {
            this.errorMsg = err.message || 'Sign-in failed. Check your credentials.';
        } finally {
            this.loading = false;
        }
    }

    async handleSignUp(e) {
        e.preventDefault();
        this._clearMessages();
        const email = this.email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.errorMsg = 'Enter a valid email address.';
            return;
        }
        if (this.password !== this.confirmPassword) {
            this.errorMsg = 'Passwords do not match.';
            return;
        }
        if (this._strength < 2) {
            this.errorMsg = 'Use a stronger password (min 8 chars, mix of letters and numbers).';
            return;
        }
        this.loading = true;
        try {
            const result = await this._ipc('account:sign-up', email, this.password);
            if (result.confirmationRequired) {
                this.confirmEmail = result.email || email;
                this.mode = 'confirm';
            } else {
                this.onAuthenticated(result?.state);
            }
        } catch (err) {
            this.errorMsg = err.message || 'Sign-up failed. Try again.';
        } finally {
            this.loading = false;
        }
    }

    async handleResetRequest(e) {
        e.preventDefault();
        this._clearMessages();
        const email = this.email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.errorMsg = 'Enter a valid email address.';
            return;
        }
        this.loading = true;
        try {
            await this._ipc('account:request-password-reset', email);
            this.successMsg = `Check your inbox — we sent a recovery link to ${email}.`;
        } catch (err) {
            this.errorMsg = err.message || 'Could not send reset email. Try again.';
        } finally {
            this.loading = false;
        }
    }

    async handleUpdatePassword(e) {
        e.preventDefault();
        this._clearMessages();
        if (this.password !== this.confirmPassword) {
            this.errorMsg = 'Passwords do not match.';
            return;
        }
        if (this._strength < 2) {
            this.errorMsg = 'Use a stronger password.';
            return;
        }
        this.loading = true;
        try {
            await this._ipc('account:update-password', this.password);
            this.successMsg = 'Password updated! Signing you in…';
            setTimeout(() => this.onAuthenticated(), 1200);
        } catch (err) {
            this.errorMsg = err.message || 'Could not update password. Try again.';
        } finally {
            this.loading = false;
        }
    }

    _renderStrengthBar() {
        const pct = Math.round((this._strength / 5) * 100);
        return html` <div class="strength-bar">
            <div class="strength-fill" style="width:${pct}%; background:${this._strengthColor(this._strength)}"></div>
        </div>`;
    }

    _renderMsg() {
        if (this.errorMsg) return html`<div class="msg error">${this.errorMsg}</div>`;
        if (this.successMsg) return html`<div class="msg success">${this.successMsg}</div>`;
        return '';
    }

    _renderSignIn() {
        return html` <div class="card-header">
                <div class="app-wordmark">Cheating Daddy</div>
                <div class="card-title">Welcome back</div>
                <div class="card-subtitle">Sign in to your account to continue.</div>
            </div>
            ${this._renderMsg()}
            <form class="form" @submit=${this.handleSignIn}>
                <div class="field">
                    <label for="auth-email">Email</label>
                    <input
                        id="auth-email"
                        type="email"
                        placeholder="you@example.com"
                        autocomplete="email"
                        .value=${this.email}
                        @input=${e => {
                            this.email = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="field">
                    <label for="auth-password">Password</label>
                    <input
                        id="auth-password"
                        type="password"
                        placeholder="••••••••"
                        autocomplete="current-password"
                        .value=${this.password}
                        @input=${e => {
                            this.password = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="actions">
                    <button
                        id="auth-signin-btn"
                        type="submit"
                        class="btn-primary ${this.loading ? 'loading' : ''}"
                        ?disabled=${this.loading || !this.email || !this.password}
                    >
                        ${this.loading ? 'Signing in…' : 'Sign in'}
                    </button>
                    <button class="btn-ghost" type="button" @click=${() => this._switchMode('reset')}>Forgot password?</button>
                </div>
            </form>
            <div class="divider">or</div>
            <div class="footer-links">
                <span>No account?</span>
                <button id="auth-goto-signup" @click=${() => this._switchMode('signup')}>Create one</button>
            </div>`;
    }

    _renderSignUp() {
        return html` <div class="card-header">
                <div class="app-wordmark">Cheating Daddy</div>
                <div class="card-title">Create account</div>
                <div class="card-subtitle">Get started in seconds.</div>
            </div>
            ${this._renderMsg()}
            <form class="form" @submit=${this.handleSignUp}>
                <div class="field">
                    <label for="su-email">Email</label>
                    <input
                        id="su-email"
                        type="email"
                        placeholder="you@example.com"
                        autocomplete="email"
                        .value=${this.email}
                        @input=${e => {
                            this.email = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="field">
                    <label for="su-password">Password</label>
                    <input
                        id="su-password"
                        type="password"
                        placeholder="Min 8 characters"
                        autocomplete="new-password"
                        .value=${this.password}
                        @input=${e => {
                            this.password = e.target.value;
                            this._strength = this._passwordStrength(e.target.value);
                        }}
                        ?disabled=${this.loading}
                    />
                    ${this.password ? this._renderStrengthBar() : ''}
                </div>
                <div class="field">
                    <label for="su-confirm">Confirm password</label>
                    <input
                        id="su-confirm"
                        type="password"
                        placeholder="Repeat password"
                        autocomplete="new-password"
                        .value=${this.confirmPassword}
                        @input=${e => {
                            this.confirmPassword = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="actions">
                    <button
                        id="auth-signup-btn"
                        type="submit"
                        class="btn-primary ${this.loading ? 'loading' : ''}"
                        ?disabled=${this.loading || !this.email || !this.password || !this.confirmPassword}
                    >
                        ${this.loading ? 'Creating account…' : 'Create account'}
                    </button>
                </div>
            </form>
            <div class="footer-links">
                <span>Already have one?</span>
                <button id="auth-goto-signin" @click=${() => this._switchMode('signin')}>Sign in</button>
            </div>`;
    }

    _renderReset() {
        return html` <div class="card-header">
                <div class="app-wordmark">Cheating Daddy</div>
                <div class="card-title">Reset password</div>
                <div class="card-subtitle">Enter your email and we'll send a recovery link.</div>
            </div>
            ${this._renderMsg()}
            <form class="form" @submit=${this.handleResetRequest}>
                <div class="field">
                    <label for="reset-email">Email</label>
                    <input
                        id="reset-email"
                        type="email"
                        placeholder="you@example.com"
                        autocomplete="email"
                        .value=${this.email}
                        @input=${e => {
                            this.email = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="actions">
                    <button
                        id="auth-reset-btn"
                        type="submit"
                        class="btn-primary ${this.loading ? 'loading' : ''}"
                        ?disabled=${this.loading || !this.email}
                    >
                        ${this.loading ? 'Sending…' : 'Send recovery link'}
                    </button>
                </div>
            </form>
            <div class="footer-links">
                <button @click=${() => this._switchMode('signin')}>Back to sign in</button>
            </div>`;
    }

    _renderUpdatePassword() {
        return html` <div class="card-header">
                <div class="app-wordmark">Cheating Daddy</div>
                <div class="card-title">Set new password</div>
                <div class="card-subtitle">Choose a strong password for your account.</div>
            </div>
            ${this._renderMsg()}
            <form class="form" @submit=${this.handleUpdatePassword}>
                <div class="field">
                    <label for="up-password">New password</label>
                    <input
                        id="up-password"
                        type="password"
                        placeholder="Min 8 characters"
                        autocomplete="new-password"
                        .value=${this.password}
                        @input=${e => {
                            this.password = e.target.value;
                            this._strength = this._passwordStrength(e.target.value);
                        }}
                        ?disabled=${this.loading}
                    />
                    ${this.password ? this._renderStrengthBar() : ''}
                </div>
                <div class="field">
                    <label for="up-confirm">Confirm password</label>
                    <input
                        id="up-confirm"
                        type="password"
                        placeholder="Repeat new password"
                        autocomplete="new-password"
                        .value=${this.confirmPassword}
                        @input=${e => {
                            this.confirmPassword = e.target.value;
                        }}
                        ?disabled=${this.loading}
                    />
                </div>
                <div class="actions">
                    <button
                        id="auth-update-pw-btn"
                        type="submit"
                        class="btn-primary ${this.loading ? 'loading' : ''}"
                        ?disabled=${this.loading || !this.password || !this.confirmPassword}
                    >
                        ${this.loading ? 'Updating…' : 'Update password'}
                    </button>
                </div>
            </form>`;
    }

    _renderConfirm() {
        return html` <div class="card-header">
                <div class="confirm-icon">📬</div>
                <div class="card-title">Check your email</div>
                <div class="card-subtitle">
                    We sent a confirmation link to
                    <span class="confirm-email">${this.confirmEmail}</span>. Click the link in your email; it will open this app and continue setup.
                </div>
            </div>
            <div class="actions">
                <button class="btn-primary" id="auth-confirm-signin-btn" @click=${() => this._switchMode('signin')}>Go to sign in</button>
            </div>
            <div class="footer-links">
                <button class="btn-ghost" @click=${() => this.onSkip()}>Continue without account</button>
            </div>`;
    }

    _renderBody() {
        switch (this.mode) {
            case 'signup':
                return this._renderSignUp();
            case 'reset':
                return this._renderReset();
            case 'update-password':
                return this._renderUpdatePassword();
            case 'confirm':
                return this._renderConfirm();
            default:
                return this._renderSignIn();
        }
    }

    render() {
        return html` <div class="auth-bg">
            <canvas class="aurora"></canvas>
            <canvas class="dither"></canvas>
            <div class="auth-card">${this._renderBody()}</div>
        </div>`;
    }
}

customElements.define('auth-view', AuthView);
