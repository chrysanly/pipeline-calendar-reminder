# Handoff: CRM roadmap (written 29 Sep 2026)

Nothing is deployed. This commit is work in progress on `main`; keys stay out of git
(`.env`, `js/firebase-config.js`, `js/app-config.js`, `worker/.dev.vars` are ignored).
**Do not run `npm run deploy`, `firebase deploy` or `wrangler deploy` until tasks 1–4 pass QA.**

## First steps on the work PC
1. `git pull origin main`
2. `npm install`, then `npx playwright install chromium` if Playwright asks
3. Copy your `.env` (Firebase keys; optional `WORKER_URL`, `GOOGLE_OAUTH_CLIENT_ID`, see `.env.example`)
4. `npm test` (unit tests), then `npx playwright test` (browser tests, about 10 min)
5. `npm start` → http://localhost:8000 (`?backend=local` works without sign-in)

## Done and passed QA
- **Task 2: Board, deal values, forecast, export.** `js/deals.js`, `js/exporter.js`, `js/views/kanban.js`, `css/kanban.css`

## In progress (built, tests pass, waiting for the last QA round)
- **Task 1: Foundation.** Pulled 508c08b first and built on your Groq, minutes and History code.
  Done: generic per-user collections (`js/store.js`), hooks (`js/hooks.js`), view registry
  (`js/views/registry.js`), feature list (`js/features.js`), portal rules (`firestore.rules`),
  Settings → Business (`js/views/settings.js`), `WORKER_URL` / `GOOGLE_OAUTH_CLIENT_ID` →
  `js/app-config.js`, build follows imports and inlines feature CSS, first-load spinner.
  Left: QA round 3 sign-off (round 2 found nothing blocking).
- **Task 3: Client page.** `js/views/client.js`, `js/timeline.js`, `js/timetrack.js`, `css/client.css`.
  Done: timeline, notes, tasks, timer, expenses, AI mount point, phone nav scroll and snap.
  Left: QA round 3 sign-off (round 2 asked for the phone nav fix and screenshots; both done).
- **Task 4: Worker, AI, transcription, alerts.** `worker/` (Firebase-token or app-token auth,
  origin allow-list, rate limit, `/ai/actions` `/ai/followup` `/ai/transcribe` `/notify`),
  `js/ai.js`, `js/notify.js`, `js/views/ai-panel.js`, `css/ai.css`.
  Left: first QA round. Not tested against a real Worker yet (all Worker calls are mocked in tests).

## Next (not started), in order
5. Proposals, merge tags, MSA/SOW, public portal, e-signature (`js/templates.js`, `js/portal.js`, `portal.html`, `js/views/proposals.js`)
6. Invoices, lifecycle, PDF, payment links (`js/invoices.js`, `js/views/invoices.js`, `css/invoice.css`)
7. Two-way Google Calendar sync (`js/gcal.js`)
8. Docs (`README.md`: setup, Worker deploy, features)

## Waiting on you
- **Groq API key** (console.groq.com/keys) → `cd worker && npx wrangler secret put GROQ_API_KEY`
- **Cloudflare account** → `npx wrangler secret put APP_TOKEN` (any long random string), then deploy
  the Worker when ready and put its URL in `.env` as `WORKER_URL` (or in Settings → Business)
- **Check `worker/wrangler.toml`**: `ALLOWED_ORIGINS`, `FIREBASE_PROJECT_ID`, `NOTIFY_FROM`, `NOTIFY_TO`
- **Email alerts (optional):** a Resend account and API key → `npx wrangler secret put RESEND_API_KEY`
  (the plan mentioned Slack/Discord webhooks; the Worker sends email via Resend instead, only to `NOTIFY_TO`)
- **Google Calendar (task 7):** a Google Cloud OAuth client ID (Web), with you as a test user → `GOOGLE_OAUTH_CLIENT_ID` in `.env`
- **Firestore rules deploy:** `firestore.rules` now adds `portals/{token}`; deploy only when you decide (`npm run deploy` also deploys hosting)

## Test status (29 Sep 2026, this PC)
- **Unit tests:** 294/294 passed tonight, before the final push.
- **Browser tests (Playwright):** full suite not run (skipped 29 Sep 2026 to push tonight).
  Per-task desktop runs passed during the day: settings, first-load, cloud, nav, build, Board,
  Client. The AI spec's last full run had 9/10 passing; the 10th (Copy on Windows) was fixed after
  that run and hasn't been re-run.
- **First on the work PC:** run `npm test`, then `npx playwright test`, and fix anything red
  before starting task 5.

## Notes
- Features plug in through `js/features.js` (one line each); pages via `app.views.register`, events via `app.hooks`.
- Don't run two Playwright runs at once: they share `test-results/` and break each other's trace files.
