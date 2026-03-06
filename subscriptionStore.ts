import fs from 'node:fs/promises';
import path from 'node:path';
import type { PushSubscription } from 'web-push';

type StoredSubscriptions = Record<string, PushSubscription[]>;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'subscriptions.json');

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify({}, null, 2), 'utf8');
  }
}

async function readAll(): Promise<StoredSubscriptions> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredSubscriptions;
  } catch {
    return {};
  }
}

async function writeAll(data: StoredSubscriptions): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function dedupeByEndpoint(subscriptions: PushSubscription[]): PushSubscription[] {
  const seen = new Set<string>();
  const result: PushSubscription[] = [];
  for (const sub of subscriptions) {
    if (!sub?.endpoint) continue;
    if (seen.has(sub.endpoint)) continue;
    seen.add(sub.endpoint);
    result.push(sub);
  }
  return result;
}

export async function upsertSubscription(userKey: string, subscription: PushSubscription): Promise<void> {
  const all = await readAll();
  const existing = Array.isArray(all[userKey]) ? all[userKey] : [];
  all[userKey] = dedupeByEndpoint([...existing, subscription]);
  await writeAll(all);
}

export async function removeSubscription(userKey: string, endpoint: string): Promise<void> {
  const all = await readAll();
  const existing = Array.isArray(all[userKey]) ? all[userKey] : [];
  all[userKey] = existing.filter((sub) => sub.endpoint !== endpoint);
  await writeAll(all);
}

export async function getUserSubscriptions(userKey: string): Promise<PushSubscription[]> {
  const all = await readAll();
  return Array.isArray(all[userKey]) ? all[userKey] : [];
}

export async function removeInvalidSubscriptions(userKey: string, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return;
  const all = await readAll();
  const existing = Array.isArray(all[userKey]) ? all[userKey] : [];
  const invalidSet = new Set(endpoints);
  all[userKey] = existing.filter((sub) => !invalidSet.has(sub.endpoint));
  await writeAll(all);
}
