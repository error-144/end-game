# Cloud AI backend

This service creates one Gemini Live session per connected desktop client. The desktop app uses two paths:

- **WebSocket `/ws`**: session setup, audio chunks, typed text, streamed response events, and session cleanup.
- **HTTP `POST /v1/sessions/:sessionId/screenshot`**: authenticated JPEG upload, independent vision analysis, then serialized summary injection into that session's existing Gemini Live connection.
- **HTTP `GET /healthz`**: deployment health check.
- **Supabase Auth**: PKCE sign-up/login lives in the Electron app; the backend returns its public Auth config and verifies access tokens for account and session requests.
- **Stripe Checkout and webhooks**: one recurring Stripe Price is supported initially. Stripe webhooks update the Supabase `subscriptions` row, which the backend checks before starting Cloud AI.

The backend keeps the Gemini API key in its server environment. Do not put `GEMINI_API_KEY` in the desktop app. Screenshots are processed in memory and are not written to disk. The WebSocket remains open while vision analysis runs.

The audio protocol accepts the desktop's 24 kHz PCM and resamples it to 16 kHz PCM for Gemini Live. Screenshot requests are limited to 8 MiB of decoded JPEG data. `GEMINI_LIVE_MODEL` and `GEMINI_VISION_MODEL` can be set independently.

The screenshot request uses `Authorization: Bearer <Supabase access token>` and a JSON body with `data` (Base64 JPEG) and optional `prompt`. A successful response returns `{ "ok": true, "summary": "..." }`; the same summary is injected into the active Live session. The backend assigns an opaque session ID when the WebSocket emits `session_ready` and removes that session on disconnect.

## Account and subscription setup

1. Create a Supabase project and run both [`supabase/migrations/001_subscriptions.sql`](supabase/migrations/001_subscriptions.sql) and [`supabase/migrations/002_trials.sql`](supabase/migrations/002_trials.sql), in order. The app uses Supabase Auth with PKCE and stores its session through Electron `safeStorage`.
2. Add `cheating-daddy://auth/callback**` to Supabase Auth's allowed redirect URLs. Signup verification and password recovery return to the app through the registered deep link.
3. Create one recurring Price in Stripe and configure `STRIPE_PRICE_ID` with its `price_...` ID.
4. Configure a Stripe webhook at `https://YOUR_BACKEND/v1/billing/webhook` for `checkout.session.completed` and `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Configure the environment variables listed below. Keep `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` on the backend only. The service role key is used only for server-side subscription writes.

The app opens hosted Stripe Checkout in the system browser. The success page has a deep link back to Electron; the app then refreshes subscription status. The verified Stripe webhook is the paid entitlement source of truth. Paid access is based on `active` or `trialing` status. Accounts without paid access receive up to five five-minute sessions; the trial count is enforced by the backend.

## Local development

From this directory, configure the backend environment and start the service:

```sh
npm install
export GEMINI_API_KEY=your_gemini_key
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your_anon_key
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
npm start
```

The server listens on `ws://127.0.0.1:8787/ws`; screenshot requests use `http://127.0.0.1:8787/v1/sessions/{sessionId}/screenshot` and its health endpoint is `http://127.0.0.1:8787/healthz`.

In the desktop app, choose **Cloud AI** and create or log in to an account. The app uses `CHEATING_DADDY_BACKEND_URL` if set; otherwise it connects to the local URL above.

Signup, login, password recovery, and free trials require the Supabase variables above. Billing tests additionally require `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and `PUBLIC_BACKEND_URL`. Configure the desktop app's backend URL to the local service. Use a Stripe test subscription to verify the paid flow.

## Deploy to Cloud Run

Create Secret Manager entries for `gemini-api-key`, `supabase-anon-key`, `supabase-service-role-key`, `stripe-secret-key`, and `stripe-webhook-secret`, then deploy this directory as the source:

```sh
gcloud run deploy cheating-daddy-ai \
  --source . \
  --region REGION \
  --allow-unauthenticated \
  --timeout 3600 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,SUPABASE_ANON_KEY=supabase-anon-key:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest \
  --set-env-vars SUPABASE_URL=https://YOUR_PROJECT.supabase.co,STRIPE_PRICE_ID=price_YOUR_RECURRING_PRICE,PUBLIC_BACKEND_URL=https://YOUR_BACKEND.run.app
```

Set `CHEATING_DADDY_BACKEND_URL` in the desktop app environment to the service's `wss://...run.app/ws` URL. The desktop derives the HTTPS screenshot endpoint from this URL. Configure a session duration limit and reconnect behavior before production. Cloud Run WebSocket requests have a timeout, so clients must reconnect when it is reached.

## Current authentication limitation

Sessions require a valid Supabase access token and either an active subscription or an unused free trial. No shared development token is accepted by the backend.
