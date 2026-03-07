import express from "express";
import cors from "cors";
import webpush from "web-push";
import type { PushSubscription } from "web-push";
import {
  getUserSubscriptions,
  removeInvalidSubscriptions,
  removeSubscription,
  upsertSubscription,
} from "./subscriptionStore.js";
import {
  getDefaultPreferences,
  getUserPreferences,
  isKnownNotificationType,
  type NotificationType,
  updateUserPreferences,
} from "./preferencesStore.js";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || "";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const FRONTEND_APP_URL = process.env.FRONTEND_APP_URL || "";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const RAW_VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@example.com";

function normalizeVapidSubject(input: string): string {
  const value = String(input || "").trim();
  if (!value) {
    return "mailto:admin@example.com";
  }

  if (value.startsWith("mailto:") || value.startsWith("https://")) {
    return value;
  }

  if (value.includes("@")) {
    return `mailto:${value}`;
  }

  return value;
}

function assertValidVapidSubject(subject: string): void {
  const isMailto =
    subject.startsWith("mailto:") && subject.length > "mailto:".length;
  const isHttps = (() => {
    try {
      return new URL(subject).protocol === "https:";
    } catch {
      return false;
    }
  })();

  if (!isMailto && !isHttps) {
    throw new Error(
      "Invalid VAPID_SUBJECT. Use a mailto or https URL, e.g. mailto:you@example.com",
    );
  }
}

const VAPID_SUBJECT = normalizeVapidSubject(RAW_VAPID_SUBJECT);

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error(
    "Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY environment variable.",
  );
}

assertValidVapidSubject(VAPID_SUBJECT);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function resolveFrontendAppUrl(): string {
  const candidate = String(FRONTEND_APP_URL || FRONTEND_ORIGIN || "").trim();
  if (!candidate || candidate === "*") return "/";

  try {
    const url = new URL(candidate);
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return "/";
  }
}

const NOTIFICATION_APP_URL = resolveFrontendAppUrl();

function displayNameForUser(userKey: string): string {
  if (userKey === "ru") return "Ru";
  if (userKey === "kiki") return "Kiki";
  return userKey || "Someone";
}

async function sendNotificationToUser(
  to: string,
  type: NotificationType,
  payloadInput: {
    title: string;
    body: string;
    url?: string;
  },
): Promise<{ sent: number; cleaned: number; reason?: string }> {
  const preferences = await getUserPreferences(to);
  if (!preferences[type]) {
    return { sent: 0, cleaned: 0, reason: "disabled-by-preference" };
  }

  const subscriptions = await getUserSubscriptions(to);
  if (!subscriptions.length) {
    return { sent: 0, cleaned: 0, reason: "no-subscriptions" };
  }

  const payload = JSON.stringify({
    title: payloadInput.title,
    body: payloadInput.body,
    url: payloadInput.url || NOTIFICATION_APP_URL,
    icon: "maroon.png",
    badge: "maroon.png",
    timestamp: Date.now(),
    type,
  });

  const invalidEndpoints: string[] = [];
  let sent = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      sent += 1;
    } catch (error: unknown) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 0;

      if (statusCode === 404 || statusCode === 410) {
        invalidEndpoints.push(subscription.endpoint);
        continue;
      }

      console.error(
        "Push send failed for subscription:",
        subscription.endpoint,
        error,
      );
    }
  }

  await removeInvalidSubscriptions(to, invalidEndpoints);
  return { sent, cleaned: invalidEndpoints.length };
}

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN }));
app.use(express.json({ limit: "256kb" }));

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!API_KEY) {
    next();
    return;
  }

  const incoming = req.header("x-api-key") || "";
  if (incoming !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rugile-push-backend" });
});

app.get("/wake", (_req, res) => {
  res.json({ ok: true, awakeAt: Date.now() });
});

app.get("/api/push/public-key", requireApiKey, (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", requireApiKey, async (req, res) => {
  const userKey = String(req.body?.userKey || "").trim();
  const subscription = req.body?.subscription as PushSubscription | undefined;

  if (!userKey || !subscription?.endpoint) {
    res
      .status(400)
      .json({ error: "Invalid payload. Expected userKey and subscription." });
    return;
  }

  try {
    await upsertSubscription(userKey, subscription);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Subscribe failed:", error);
    res.status(500).json({ error: "Subscribe failed." });
  }
});

app.post("/api/push/unsubscribe", requireApiKey, async (req, res) => {
  const userKey = String(req.body?.userKey || "").trim();
  const endpoint = String(req.body?.endpoint || "").trim();

  if (!userKey || !endpoint) {
    res
      .status(400)
      .json({ error: "Invalid payload. Expected userKey and endpoint." });
    return;
  }

  try {
    await removeSubscription(userKey, endpoint);
    res.json({ ok: true });
  } catch (error) {
    console.error("Unsubscribe failed:", error);
    res.status(500).json({ error: "Unsubscribe failed." });
  }
});

app.post("/api/chat/notify", requireApiKey, async (req, res) => {
  const from = String(req.body?.from || "").trim();
  const to = String(req.body?.to || "").trim();
  const text = String(req.body?.text || "").trim();

  if (!from || !to || !text) {
    res
      .status(400)
      .json({ error: "Invalid payload. Expected from, to and text." });
    return;
  }

  try {
    const result = await sendNotificationToUser(to, "chat", {
      title: `New message from ${displayNameForUser(from)}`,
      body: text.length > 100 ? `${text.slice(0, 100)}…` : text,
      url: NOTIFICATION_APP_URL,
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Notify failed:", error);
    res.status(500).json({ error: "Notify failed." });
  }
});

app.get("/api/notifications/preferences/:userKey", requireApiKey, async (req, res) => {
  const userKey = String(req.params?.userKey || "").trim();
  if (!userKey) {
    res.status(400).json({ error: "Missing userKey" });
    return;
  }

  try {
    const preferences = await getUserPreferences(userKey);
    res.json({ userKey, preferences });
  } catch (error) {
    console.error("Get preferences failed:", error);
    res.status(500).json({ error: "Get preferences failed." });
  }
});

app.post("/api/notifications/preferences", requireApiKey, async (req, res) => {
  const userKey = String(req.body?.userKey || "").trim();
  const preferences = req.body?.preferences;

  if (!userKey || !preferences || typeof preferences !== "object") {
    res
      .status(400)
      .json({ error: "Invalid payload. Expected userKey and preferences object." });
    return;
  }

  try {
    const next = await updateUserPreferences(userKey, preferences);
    res.json({ ok: true, userKey, preferences: next });
  } catch (error) {
    console.error("Update preferences failed:", error);
    res.status(500).json({ error: "Update preferences failed." });
  }
});

app.post("/api/events/notify", requireApiKey, async (req, res) => {
  const from = String(req.body?.from || "").trim();
  const to = String(req.body?.to || "").trim();
  const typeRaw = String(req.body?.type || "").trim();
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  const url = String(req.body?.url || "").trim();

  if (!from || !to || !typeRaw || !title || !body) {
    res
      .status(400)
      .json({ error: "Invalid payload. Expected from, to, type, title and body." });
    return;
  }

  if (!isKnownNotificationType(typeRaw)) {
    res.status(400).json({ error: "Invalid notification type." });
    return;
  }

  try {
    const result = await sendNotificationToUser(to, typeRaw, {
      title,
      body,
      url: url || NOTIFICATION_APP_URL,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Event notify failed:", error);
    res.status(500).json({ error: "Event notify failed." });
  }
});

app.get("/api/notifications/types", requireApiKey, (_req, res) => {
  res.json({ defaults: getDefaultPreferences() });
});

app.listen(PORT, () => {
  console.log(`Push backend listening on port ${PORT}`);
});
