import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import {
  getUserSubscriptions,
  removeInvalidSubscriptions,
  removeSubscription,
  upsertSubscription
} from './subscriptionStore.js';

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY environment variable.');
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN }));
app.use(express.json({ limit: '256kb' }));

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_KEY) {
    next();
    return;
  }

  const incoming = req.header('x-api-key') || '';
  if (incoming !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rugile-push-backend' });
});

app.get('/wake', (_req, res) => {
  res.json({ ok: true, awakeAt: Date.now() });
});

app.get('/api/push/public-key', requireApiKey, (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', requireApiKey, async (req, res) => {
  const userKey = String(req.body?.userKey || '').trim();
  const subscription = req.body?.subscription as PushSubscription | undefined;

  if (!userKey || !subscription?.endpoint) {
    res.status(400).json({ error: 'Invalid payload. Expected userKey and subscription.' });
    return;
  }

  try {
    await upsertSubscription(userKey, subscription);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Subscribe failed:', error);
    res.status(500).json({ error: 'Subscribe failed.' });
  }
});

app.post('/api/push/unsubscribe', requireApiKey, async (req, res) => {
  const userKey = String(req.body?.userKey || '').trim();
  const endpoint = String(req.body?.endpoint || '').trim();

  if (!userKey || !endpoint) {
    res.status(400).json({ error: 'Invalid payload. Expected userKey and endpoint.' });
    return;
  }

  try {
    await removeSubscription(userKey, endpoint);
    res.json({ ok: true });
  } catch (error) {
    console.error('Unsubscribe failed:', error);
    res.status(500).json({ error: 'Unsubscribe failed.' });
  }
});

app.post('/api/chat/notify', requireApiKey, async (req, res) => {
  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();
  const text = String(req.body?.text || '').trim();

  if (!from || !to || !text) {
    res.status(400).json({ error: 'Invalid payload. Expected from, to and text.' });
    return;
  }

  try {
    const subscriptions = await getUserSubscriptions(to);
    if (!subscriptions.length) {
      res.json({ ok: true, sent: 0, reason: 'no-subscriptions' });
      return;
    }

    const payload = JSON.stringify({
      title: `New message from ${from === 'ru' ? 'Ru' : from === 'kiki' ? 'Kiki' : from}`,
      body: text.length > 100 ? `${text.slice(0, 100)}…` : text,
      url: '/',
      icon: 'maroon.png',
      badge: 'maroon.png',
      timestamp: Date.now()
    });

    const invalidEndpoints: string[] = [];
    let sent = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, payload);
        sent += 1;
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          invalidEndpoints.push(subscription.endpoint);
          continue;
        }

        console.error('Push send failed for subscription:', subscription.endpoint, error);
      }
    }

    await removeInvalidSubscriptions(to, invalidEndpoints);

    res.json({ ok: true, sent, cleaned: invalidEndpoints.length });
  } catch (error) {
    console.error('Notify failed:', error);
    res.status(500).json({ error: 'Notify failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`Push backend listening on port ${PORT}`);
});
