# Push backend (Renderer)

Node.js + TypeScript backend for Web Push notifications.

## 1) Install

```bash
npm install
```

## 2) Create env

```bash
cp .env.example .env
```

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys
```

Put the generated keys in `.env`.

`VAPID_SUBJECT` must be a URL (`mailto:you@example.com` or `https://...`).
If you provide only an email, the server now auto-converts it to `mailto:<email>`.

## 3) Run locally

```bash
npm run dev
```

## 4) Deploy on Render

- Create a new `Web Service` from this folder.
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Set env vars from `.env.example`.

For GitHub Pages project sites, set:

- `FRONTEND_ORIGIN=https://cyril-bonnet.github.io`
- `FRONTEND_APP_URL=https://cyril-bonnet.github.io/website/`

`FRONTEND_APP_URL` is used as the notification click target. If omitted, the backend falls back to the origin root.

## Endpoints

- `GET /health` health check
- `GET /wake` keep-awake endpoint for cron ping
- `GET /api/push/public-key` returns VAPID public key
- `POST /api/push/subscribe` body: `{ userKey, subscription }`
- `POST /api/push/unsubscribe` body: `{ userKey, endpoint }`
- `POST /api/chat/notify` body: `{ from, to, text, timestamp? }`
- `GET /api/notifications/preferences/:userKey` get notification preferences
- `POST /api/notifications/preferences` body: `{ userKey, preferences }`
- `POST /api/events/notify` body: `{ from, to, type, title, body, url? }`
- `GET /api/notifications/types` returns default preference values
