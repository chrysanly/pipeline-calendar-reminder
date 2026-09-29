# CladFlo Worker setup

The Worker (`worker/src/index.js`, on Cloudflare) runs the parts that need a secret key:
meeting minutes and AI (Groq), transcription and email alerts (Resend). The keys live on
Cloudflare as secrets, so they never reach a browser, the site or git.

## Why the Worker is locked

Anyone with a Google account can sign in to a Firebase project, and the Worker's URL is
visible in the site. Without a lock, any signed-in stranger could use your Groq key.
So the Worker lets a caller through only in two cases:

1. **Signed in** with a Google account whose **verified email is in `ALLOWED_EMAILS`**.
   If the list is empty, no signed-in account gets in (403).
2. **Local mode** (`?backend=local`, no sign-in) with the shared **`APP_TOKEN`**, which is typed
   into the app's AI panel once per browser.

The Worker also checks the site (`ALLOWED_ORIGINS`), limits each caller to
`RATE_LIMIT_PER_MINUTE` requests a minute, accepts only the two Llama models on `/ai/chat`
and caps how much text one request can send.

## Deploy

From the project folder:

```sh
cd worker
npx wrangler login                        # once, opens Cloudflare in the browser
npx wrangler secret put GROQ_API_KEY      # paste your key from console.groq.com/keys
npx wrangler secret put APP_TOKEN         # any long random string (see below)
npx wrangler secret put ALLOWED_EMAILS    # e.g. you@gmail.com,teammate@company.com
npx wrangler secret put RESEND_API_KEY    # optional, only for email alerts
npx wrangler deploy
```

Before deploying, check the `[vars]` in `worker/wrangler.toml`:

- `ALLOWED_ORIGINS`: every address the site runs on, comma separated, no trailing slash
  (the Firebase Hosting addresses and `http://localhost:8000`).
- `FIREBASE_PROJECT_ID`: `pipeline-9944d`.
- `NOTIFY_FROM` / `NOTIFY_TO`: only if you use email alerts.

`wrangler deploy` prints the Worker's address, like `https://cladflo-worker.<you>.workers.dev`.

## APP_TOKEN

For local mode only, where nobody is signed in. Pick a long random string, for example from
`node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`, and set it with
`npx wrangler secret put APP_TOKEN`. Enter the same value in the app: Client page → AI panel →
access token. It is saved in that browser only. To revoke it, set a new value and deploy again.

## Editing ALLOWED_EMAILS

`ALLOWED_EMAILS` is a secret, so it is replaced as a whole, not edited in place. Run
`npx wrangler secret put ALLOWED_EMAILS` again and type the complete new list:

- any number of addresses, separated by commas (spaces and new lines work too);
- capital letters don't matter;
- each one must be the email of the Google account the person signs in with.

The change applies within a few seconds and needs no redeploy. Someone who isn't on the list
sees "This account may not use the CladFlo Worker. Ask the owner to add your email." They
can still write minutes with their own Groq key in Settings → AI settings.

## What goes in `.env`

`.env` holds only public values for the site (never the secrets above):

```sh
FIREBASE_API_KEY=...            # the six FIREBASE_* values from the Firebase console
WORKER_URL=https://cladflo-worker.<you>.workers.dev
GOOGLE_OAUTH_CLIENT_ID=...      # optional, for Google Calendar sync
```

`npm start`, `npm run build` and `npm test` rebuild `js/app-config.js` from it. With
`WORKER_URL` set, Minutes works with no Groq key in the browser (Settings shows
"Using CladFlo Worker, no key needed"). A personal key saved in Settings is still used first.
Settings → Business can point one account at a different Worker.

For Google sign-in and Calendar sync, add the same site addresses as **Authorized JavaScript
origins** on the OAuth client in Google Cloud console → APIs & Services → Credentials.

## Local Worker (optional)

Copy `worker/.dev.vars.example` to `worker/.dev.vars` (git-ignored), fill it in, then run
`npx wrangler dev` in `worker/`.
