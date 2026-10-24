# Productization Checklist

We will work through one item at a time and update this checklist as decisions are made.

## Phase 0 — Rights and product scope

- [ ] Choose the licensing path before paid desktop distribution. **Deferred for now at the user's direction.**
- [ ] Audit notices and licenses for upstream code, bundled assets, native helpers, models, and dependencies.
- [ ] Choose a distinct product name and check branding/asset rights.
- [ ] Define the first customer segment and primary use case.

## Phase 1 — Subscription rules

- [ ] Define launch plan, price, billing interval, included features, and usage allowance.
- [ ] Decide how usage is measured and what happens at the plan limit.
- [ ] Decide supported AI providers and whether users can bring their own keys.
- [ ] Define trial, cancellation, failed payment, refund, and account deletion behavior.
- [ ] Define data retention and user consent for screen/audio processing.

## Phase 2 — Accounts and backend foundation

- [ ] Choose authentication, database, billing, and hosting services.
- [ ] Define account, subscription, device/session, and usage data.
- [x] Initial direction: Supabase Auth + Supabase Postgres, Stripe Checkout/customer portal/webhooks, and a single configurable recurring Price.
- [x] Add app sign-up/login and password recovery using PKCE, secure session storage, and a custom-protocol return path.
- [x] Add hosted checkout, billing portal, Stripe webhook synchronization, and server-side active-subscription checks.
- [ ] Configure production provider projects, webhook secrets, and the launch Price ID.
- [x] Enforce active/trialing subscription status on the server.
- [ ] Decide whether the current five-session, five-minute free-trial allowance is the launch policy; add broader usage quotas and rate limits after that decision.
- [ ] Add monitoring, backups, and incident response.

## Phase 3 — AI session service

- [x] Initial direction: backend proxies one Gemini Live session per connected client; desktop sends audio, typed text, and screenshots over one WebSocket.
- [x] Add a Cloud Run-compatible Node.js backend and session setup/teardown; sessions require Supabase authentication and either a paid subscription or an available free trial.
- [x] Route audio and typed text through the persistent WebSocket.
- [x] Add an authenticated screenshot REST endpoint with independent vision analysis and ordered context injection into the active Live session.
- [x] Stream response text and status updates back to the desktop app.
- [ ] Add production authentication, reconnect/resume, usage accounting, and session limits.
- [ ] Ensure raw audio and screenshots are not retained unless explicitly needed and disclosed.

## Phase 4 — Desktop app integration

- [x] Expose Cloud AI mode and configure the backend WebSocket URL.
- [x] Keep the Gemini API key on the backend for Cloud AI mode.
- [x] Add user sign-up/login, account status, and Supabase token refresh.
- [x] Show account and subscription state in the Cloud AI screen.
- [x] Show remaining free trials in the Cloud AI account screen.
- [ ] Handle expired subscriptions, usage limits, and service outages clearly.
- [ ] Review Electron security boundaries before shipping account credentials.

## Phase 5 — Release readiness

- [ ] Verify license/attribution notices in each installer.
- [ ] Configure development, staging, and production environments.
- [ ] Test the purchase-to-session-to-cancellation journey in billing test mode.
- [ ] Review abuse controls, deletion, reconnects, and usage accounting.
- [ ] Run a private beta and compare AI cost with plan pricing.
- [ ] Prepare support, release/update, and incident processes.

## Current work notes

- Licensing is deferred until before paid distribution.
- A first-pass product brief was previously prepared, but the current focus has shifted to cloud backend integration.
- Backend implementation lives in `backend/`; setup and Cloud Run instructions are in `backend/README.md`.
- The backend requires an active or trialing subscription for Cloud AI. Usage quotas are intentionally deferred.
- Supabase and Stripe credentials and the Stripe Price ID still need to be configured for each deployment. Cloud AI uses the signed-in account and server-side subscription state. Launch uses one configurable recurring Stripe Price; usage quotas are deferred.
