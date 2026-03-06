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

## 3) Run locally

```bash
npm run dev
```

## 4) Deploy on Render

- Create a new `Web Service` from this folder.
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Set env vars from `.env.example`.

## Endpoints

- `GET /health` health check
- `GET /wake` keep-awake endpoint for cron ping
- `GET /api/push/public-key` returns VAPID public key
- `POST /api/push/subscribe` body: `{ userKey, subscription }`
- `POST /api/push/unsubscribe` body: `{ userKey, endpoint }`
- `POST /api/chat/notify` body: `{ from, to, text, timestamp? }`
