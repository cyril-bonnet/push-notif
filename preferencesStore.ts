import fs from "node:fs/promises";
import path from "node:path";

export type NotificationType =
  | "chat"
  | "quick_note"
  | "todo"
  | "weekly"
  | "feedback"
  | "taste"
  | "mood"
  | "status";

export type NotificationPreferences = Record<NotificationType, boolean>;

type StoredPreferences = Record<string, Partial<NotificationPreferences>>;

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "preferences.json");

const DEFAULT_PREFERENCES: NotificationPreferences = {
  chat: true,
  quick_note: true,
  todo: true,
  weekly: true,
  feedback: true,
  taste: true,
  mood: true,
  status: true,
};

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify({}, null, 2), "utf8");
  }
}

async function readAll(): Promise<StoredPreferences> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StoredPreferences;
  } catch {
    return {};
  }
}

async function writeAll(data: StoredPreferences): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export function getDefaultPreferences(): NotificationPreferences {
  return { ...DEFAULT_PREFERENCES };
}

export function normalizePreferences(
  raw: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  const defaults = getDefaultPreferences();
  if (!raw || typeof raw !== "object") return defaults;

  return {
    chat: typeof raw.chat === "boolean" ? raw.chat : defaults.chat,
    quick_note:
      typeof raw.quick_note === "boolean"
        ? raw.quick_note
        : defaults.quick_note,
    todo: typeof raw.todo === "boolean" ? raw.todo : defaults.todo,
    weekly: typeof raw.weekly === "boolean" ? raw.weekly : defaults.weekly,
    feedback:
      typeof raw.feedback === "boolean" ? raw.feedback : defaults.feedback,
    taste: typeof raw.taste === "boolean" ? raw.taste : defaults.taste,
    mood: typeof raw.mood === "boolean" ? raw.mood : defaults.mood,
    status: typeof raw.status === "boolean" ? raw.status : defaults.status,
  };
}

export function isKnownNotificationType(
  value: string,
): value is NotificationType {
  return [
    "chat",
    "quick_note",
    "todo",
    "weekly",
    "feedback",
    "taste",
    "mood",
    "status",
  ].includes(value);
}

export async function getUserPreferences(
  userKey: string,
): Promise<NotificationPreferences> {
  const all = await readAll();
  return normalizePreferences(all[userKey]);
}

export async function updateUserPreferences(
  userKey: string,
  updates: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const all = await readAll();
  const current = normalizePreferences(all[userKey]);
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(updates).filter(([, value]) => typeof value === "boolean"),
    ),
  };

  all[userKey] = next;
  await writeAll(all);
  return next;
}
