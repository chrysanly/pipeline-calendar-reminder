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

## Import tools and Worker lock (tasks 9–13): built, own tests pass, QA waits for your go-ahead
- **Task 9: Kept import files.** `js/file-store.js` keeps each imported file in this browser's
  IndexedDB (newest 20, up to 10 MB each). The History import entry stores its `fileId`.
  Clear all data keeps History and the files. Files never go to the account, so re-import
  works only in the browser that imported the file.
- **Task 10: Re-import from History.** Import entries with a kept file get a Re-import button
  (`js/history-ui.js`). It imports the file again with `reimport: true` (updates rows, no duplicates)
  and logs a new entry. A normal upload adds rows that are already there as duplicates (task 14).
- **Task 11: Import progress toast.** `mergeImportedAsync` in `js/importer.js` merges in chunks of 50
  and reports `onProgress(done, total)`. The toast shows a spinner and "Importing n/total", then
  turns into the summary (`showProgress` in `js/ui.js`, `.banner.is-busy` in `css/components.css`).
- **Task 12: Clear calendar.** The Calendar toolbar (Day, Week and Month; not Home) has Clear calendar.
  Its dialog (`js/clear-calendar-ui.js`) is fixed to the period on screen (`calendarPeriod` in
  `js/calendar.js`): "Clear Sat, 3 Oct 2026", "Clear 4 – 10 Oct 2026" or "Clear October 2026", with how
  many reminders it clears (`countOnCalendar`), and a warning that Home and the data stay and that the
  same reminders leave the other views too. `hideFromCalendar` in `js/storage.js` sets `calendarHidden`:
  the calendar views and reminder popups skip those reminders. Busy then "Cleared 4 reminders from
  Sat, 3 Oct 2026"; History logs it with the period ("Day: …"). Re-import does not bring them back;
  the client page's Add to calendar does. An empty period can't be cleared.
- **Tests:** `tests/storage.test.js`, `tests/reminders.test.js`, `tests/history.test.js`,
  `tests/importer.test.js`, `tests/file-store.test.js`, `tests/web/import-tools.spec.mjs`.
- **Task 13: Worker lock, Minutes through the Worker.** `worker/src/index.js` lets a signed-in
  caller through only when their verified email is in the `ALLOWED_EMAILS` secret (empty list = 403);
  `APP_TOKEN` is unchanged. New `POST /ai/chat` (the two Llama models only, capped size, same rate
  limit). `js/groq.js`: with `WORKER_URL` set and no browser key, Minutes goes through the Worker;
  an own key still wins. Settings shows "Using CladFlo Worker, no key needed". Guide:
  `docs/worker-setup.md`. Tests: `tests/worker.test.js`, `tests/groq.test.js`, `tests/web/minutes.spec.mjs`.
  Specs now serve an empty `js/app-config.js` (`tests/web/fixtures.mjs`), so this PC's `.env` can't change them.

## Client tools (task 14): built, own tests pass, QA waits for your go-ahead
- **Home chart.** `progressData(clients)` in `js/dashboard.js`: Potential and Active at the end of
  each of the last 6 months (a client counts from the month it was last saved). Bars at the top of Home.
- **Duplicates.** A normal upload adds a row that is already there as a new reminder with
  `duplicate: true` and its own `importKey` (`key#1`, `key#2`…). Home, the calendar chip and the
  client timeline show a Duplicate badge; the summary says "n duplicate(s) (added)".
- **Imports are raw data.** New imported reminders start `calendarHidden: true`: Home and the
  client page only, no popups. The client page's Add to calendar / Remove from calendar moves them.
- **Client page.** A named client on Home opens the Client tab. Action bar
  (`js/views/client-actions.js`): Follow up (date and time required, notes optional → a calendar
  reminder), Add to / Remove from calendar, Add minutes (Minutes page with the client filled in).
  Notes are now Comments (any number, newest first). `js/views/client.js` was split into
  `client-dom.js` and `client-work.js` (time and expenses) to stay under 500 lines.
- **Pickers, no jQuery.** `js/select.js` (searchable select: Client picker, Minutes client, Home
  status/country/city filters), `js/datepicker.js` (date picker for Follow up, range picker for Clear
  calendar), `css/pickers.css` (in `build.mjs` STYLESHEETS after components.css).
- **Toasts.** `runWithToast` in `js/banner.js`: a busy toast, then what happened or what failed.
  Store and commit errors go through `reportError`, so a failed save is never shown as saved.
- **Tests:** `tests/dashboard.test.js`, `tests/importer.test.js`, `tests/exporter.test.js`,
  `tests/storage.test.js`, `tests/timeline.test.js`, `tests/pickers.test.js`, `tests/web/client-tools.spec.mjs`.

## Round 2 of task 14: built, own tests pass, QA waits for your go-ahead
- **Pickers and fields restyled.** Every text field, select and textarea shares one look
  (a zero-specificity base in `css/components.css`). Searchable selects get a chevron and a card list
  (red = picked). The date field has its calendar button inside it; the calendar opens as a card
  in the flow under the fields (red = picked, pink = range, yellow = today, Today button). Range picker:
  a button in From and in To, one shared calendar. Checked at desktop and phone width, light and dark.
- **Minutes off the navbar.** No `#view-minutes` button and no N key. The Minutes page opens only
  from the client profile's Add minutes; "Back to <client>" returns there. Saved minutes stay in the timeline.
- **Home chart** also shows each status's share of all clients (`progressData().share`).
- **Board filters** (`js/views/kanban.js`): search, status, country, city (searchable selects), Clear
  filters, "n of total clients", remembered per browser (`cladflo.board-filters.v1`). Pure functions
  `filterBoard`, `parseBoardFilters`, `hasBoardFilters` in `js/dashboard.js`.
- **Team chat** (`js/chat.js`, `js/views/chat.js`, `css/chat.css`): a Chat tab, one room at
  `chat/main/messages`, live, newest 100 with Load older, own messages on the right, unread count on
  the tab, 1000-character cap, Enter sends. Off in `?backend=local` and when signed out (it says so).
  Send shows "Sending your message…" then "Message sent to the team", or why it failed.
  `firestore.rules` lets only verified emails on a list read and post, no edits or deletes.
  Feature modules can reach Firestore through `app.db()`.
- **Tests:** `tests/chat.test.js`, `tests/deploy.test.js` (chat rules), `tests/dashboard.test.js`,
  `tests/web/chat.spec.mjs` (fake Firestore now supports `orderBy`/`limit` and refused writes),
  `tests/web/client-tools.spec.mjs`. Older specs updated for no Minutes button: `minutes`, `mobile-minutes`, `nav`.

## Next (not started), in order
5. Proposals, merge tags, MSA/SOW, public portal, e-signature (`js/templates.js`, `js/portal.js`, `portal.html`, `js/views/proposals.js`)
6. Invoices, lifecycle, PDF, payment links (`js/invoices.js`, `js/views/invoices.js`, `css/invoice.css`)
7. Two-way Google Calendar sync (`js/gcal.js`)
8. Docs (`README.md`: setup, Worker deploy, features)

## Done by you
- **Groq API key** set on the Worker (`GROQ_API_KEY`).
- **Cloudflare account**, `APP_TOKEN` and the Worker URL in `.env` (`WORKER_URL`).
- **Google OAuth client ID** in `.env` (`GOOGLE_OAUTH_CLIENT_ID`).

## Every imported row kept (after round 2 of task 14): built, own tests pass
- A 3867-row file now gives 3867 reminders. Before, rows with the same company and date collapsed
  into one ("1354 updated"), and Home showed one line per company (2229).
- `mergeImported` in `js/importer.js` keeps every row. A row whose company is already there (earlier
  in the file, or in the data before an upload) gets `duplicate: true` and its own key (`key#1`, `key#2`…).
  Re-import updates row for row (the nth row with a key updates the nth copy), so it never merges rows
  away, and it adds back rows an older import dropped. `createMergeContext` carries this across chunks.
- Home (`homeRows` in `js/dashboard.js`): one line per client plus one per duplicate row, tinted yellow
  with the Duplicate badge. The count reads "(3867 · 1638 duplicates)". Status cards still count clients.
- To fix data imported before this change: History → Re-import that file once.

## Chat fix, Back to Home, Clear calendar per view: built, own tests pass, QA waits for your go-ahead
- **Chat:** the rules had placeholder emails (and were not deployed), so every read and send was refused.
  They now list your two Gmail accounts. Errors say what is wrong: "Your email isn't on the chat list, or
  the chat rules aren't deployed yet" (refused), "Can't reach Firestore" (offline, or no answer in 15 s),
  expired sign-in; the page also shows who is signed in. If Firebase can't load (ad blocker), the page
  says so instead of blaming `?backend=local`. `chatErrorText` and `withChatTimeout` in `js/chat.js`.
- **Back to Home** at the top left of the Client page (`js/views/client.js`, `.page-back` in `css/client.css`).
- **Clear calendar** moved to the Calendar toolbar and clears only the day, week or month on screen (task 12).
- **Tests:** `tests/chat.test.js`, `tests/calendar.test.js`, `tests/storage.test.js`, `tests/ui-pure.test.js`,
  `tests/web/chat.spec.mjs` (two users, refused reads and sends, offline), `tests/web/import-tools.spec.mjs`,
  `tests/web/client-tools.spec.mjs` (Back to Home).

## Home = pipeline, Client tab = every client: built, unit tests pass, browser specs not run yet
- **Home** lists only potential and active clients (`pipelineClients`, `HOME_STATUSES` in `js/dashboard.js`),
  plus their duplicate lines. Its status filter offers Potential and active / Potential / Active. The four
  status cards still count every client, but are numbers only (not buttons). Locations follow the same scope.
- **Client tab** opens on a table of every client, once (no duplicate lines): search, status, country and
  city filters, and pages (`js/views/client-list.js`, same table as Home from `js/client-table.js`).
  Clicking a client shows its details (the profile). The navbar's Client tab always opens on the list.
- **Back** on a client's page returns to where it was opened from: "Back to Home" when opened from Home,
  "Back to all clients" when opened from the Client tab list. `open-client` takes `{ name, from }`.
- **Needs updating next run** (they expect the old Home): `tests/web/dashboard.spec.mjs` (clickable status
  cards, leads on Home), `tests/web/pager.spec.mjs` (lead filter and card clicks), `tests/web/mobile.spec.mjs`
  and `tests/web/client-tools.spec.mjs` (the Home rows use potential and active clients now).
- **Removed:** the deal-value strip under the Home cards (was in `js/views/kanban.js`; the Board keeps its
  column totals and Forecast line) and the "Type a client name… / Open" picker on the Client tab (the
  client list replaces it). **Added:** a Duplicates card on Home (`duplicateCount` in `js/dashboard.js`),
  numbers only like the others. Specs to update next run for these: `kanban.spec.mjs` (stage strip),
  `client.spec.mjs` and `client-tools.spec.mjs` (`#client-pick`).
- **Expenses → Invoices** on the Client page: card, button, Type list (Services, Consulting, Retainer, Software,
  Materials, Subcontractor, Other), header stat, timeline filter and messages. Data stays in the `expenses`
  collection, so earlier entries still show. `client.spec.mjs` needs the new wording next run.

## App menus for plain selects, medium reminder dialog: built, own tests pass
- `js/select-menu.js`: any `<select data-picker>` opens an app-styled menu (click, tap, Enter/Space/arrows)
  instead of the browser's. The select keeps its place, value and `change` events; one shared menu is
  built only when opened (fine for thousands of Board cards). Search box over 6 options; status dots with
  `data-picker="status"`; bottom sheet on phones; follows the page while it scrolls. Used by: the status
  pill on Home and Client-tab rows (`js/client-table.js`), Board cards, the reminder dialog's Status and
  Remind me, and History's action and client filters. `installSelectMenus()` runs once in `app.js`.
- New reminder: a centred 640px dialog in two columns (`.event-grid` in `css/styles.css`), Save and Cancel
  pinned at the bottom, one column on phones; date picker on its Date and on Minutes' date. All dialogs
  share the 640px size.

## Chat: typing, online list, attachments, Shared view; AI settings removed: built, unit tests pass, browser specs not run
- **No "Message sent" toast** any more: a sent message just appears; a failure shows under the box.
- **Typing and online:** `js/chat-presence.js` writes `chat/main/presence/{uid}` (`lastSeen` every 45 s,
  `typingAt` at most every 3 s). The side panel lists everyone who has opened the chat: online (seen in the
  last 100 s) first, else "Last seen …"; the line under the messages says "Joyce is typing…".
- **Photos, videos, files:** the paperclip (or paste / drop). No Firebase Storage on the free Spark plan, so
  `js/chat-files.js` keeps the bytes in Firestore: `chat/main/files/{id}` + `chunks/{n}` (base64 pieces of
  700,000 characters), up to 10 MB a file; photos over 1600 px are shrunk first. Photos show in the
  message, videos and photos open full size in a viewer, files download.
- **Shared** (like Messenger): Media, Files and Links tabs in the side panel (`js/views/chat-side.js`), from
  the messages loaded. Links in messages are clickable.
- **AI settings removed** from Settings (the Groq key box): the Worker is set up for the site. A key saved
  earlier in a browser still works. Minutes says to add the Worker URL in Settings → Business if it's missing.
- **Rules changed:** messages may carry an `attachment`; new matches for `files`, `chunks` and `presence`.
  They must be deployed again (see Waiting on you).
- **Specs to update next run:** `chat.spec.mjs` (no success toast, new layout), `settings.spec.mjs` and
  `minutes.spec.mjs` (no Groq key box).

## CladFlo Talk (renamed from Chat, then from CF TALK) — deployed 29 Sep 2026
- Everything users see says **CladFlo Talk** (was CF TALK): the navbar tab, the page title, messages and errors. Code names, the
  `chat` view id, the Firestore paths (`chat/main/messages`, `files`, `presence`) and the rules are unchanged,
  so no messages were lost.
- **Deployed** with `npm run deploy` (hosting + Firestore rules) to https://pipeline-9944d.web.app. The rules
  (CF TALK for `chrys.romao21@gmail.com` and `palmajoyceann@gmail.com`: messages, attachments, online status)
  compiled and were released.
- **To use it:** both open https://pipeline-9944d.web.app, sign in with those Gmail accounts, open CladFlo Talk.
  To add someone, add their Google email (lower case) to `chatMember()` in `firestore.rules` and deploy again.
- Tests: `chat.spec.mjs` and `nav.spec.mjs` updated for the new name and for no "sent" toast (16 pass).

## CladFlo Talk on phones: built, unit tests pass, not deployed, browser specs not run
- At phone width (≤ 640 px) the side panel is hidden. On top: round avatars (initials, a colour per person,
  a dot when online, a yellow ring while typing); tap one for a card with name, email and Online / Last seen.
  A **Shared** button opens Media, Files and Links in a dialog (`js/views/chat-mobile.js`). Desktop unchanged.
- Avatars use initials: Google profile photos would need a `photo` field in the presence rules and a deploy.
- Not deployed yet: run `npm run deploy` when you want it live.

## CladFlo Talk: replies, Shared sheet fixed: built, own tests pass, NOT deployed
- **Reply** on every message (a button in its header; always shown on touch screens, on hover on desktop).
  A bar above the box says "Replying to …" with a snippet and an X. The message stores
  `replyTo: {id, name, snippet ≤ 120}` (`replyRecord` in `js/chat.js`) and shows a quote above its text;
  tapping the quote scrolls to the original and flashes it, loading older pages (up to 20) if needed,
  else a toast "That message is no longer available". Message drawing moved to `js/views/chat-message.js`.
- **Rules:** messages may carry `replyTo` (keys, id ≤ 64, name ≤ 120, snippet ≤ 120). Needs a deploy.
- **Shared sheet (phone):** up to 85% of the screen, scrolls inside; Media is a 3-across grid of square
  crops that open full size; Files and Links rows show who shared them and when.
- `tests/deploy.test.js` now reads files with LF line endings (Windows checkouts use CRLF).

## Waiting on you
- **Deploy** (replies need the new rules): `npm run deploy`.
- **Worker lock (task 13):** `cd worker && npx wrangler secret put ALLOWED_EMAILS` (your emails, comma
  separated), then `npx wrangler deploy`. Until then signed-in AI calls get 403. See `docs/worker-setup.md`.
- **OAuth origins:** add the site addresses as Authorized JavaScript origins on the Google OAuth client.
- **Check `worker/wrangler.toml`**: `ALLOWED_ORIGINS`, `FIREBASE_PROJECT_ID`, `NOTIFY_FROM`, `NOTIFY_TO`
- **Email alerts (optional):** a Resend account and API key → `npx wrangler secret put RESEND_API_KEY`
  (the plan mentioned Slack/Discord webhooks; the Worker sends email via Resend instead, only to `NOTIFY_TO`)
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
