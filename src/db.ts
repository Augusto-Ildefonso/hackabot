import type { Filter, FilterField, FilterMode, Hackathon } from './types';

export const MAX_FILTERS = 30;
export const MAX_VALUE_LENGTH = 60;
const RATE_LIMIT = 20; // commands per minute
const HACKATHON_TTL_DAYS = 90;

const now = () => Math.floor(Date.now() / 1000);

export interface ActiveUser {
  chatId: number;
  filters: Filter[];
}

export async function upsertUser(db: D1Database, chatId: number): Promise<void> {
  // Re-registering also clears a previous `blocked` flag (user came back).
  await db
    .prepare(
      `INSERT INTO users (chat_id, created_at) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET blocked = 0`,
    )
    .bind(chatId, now())
    .run();
}

export async function userExists(db: D1Database, chatId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM users WHERE chat_id = ?').bind(chatId).first();
  return row !== null;
}

/** Fixed-window limiter. Returns false when the user is over the limit. */
export async function allowCommand(db: D1Database, chatId: number): Promise<boolean> {
  const t = now();
  const row = await db
    .prepare('SELECT rate_window_start AS s, rate_count AS c FROM users WHERE chat_id = ?')
    .bind(chatId)
    .first<{ s: number; c: number }>();
  if (!row) return true;
  if (t - row.s >= 60) {
    await db.prepare('UPDATE users SET rate_window_start = ?, rate_count = 1 WHERE chat_id = ?').bind(t, chatId).run();
    return true;
  }
  if (row.c >= RATE_LIMIT) return false;
  await db.prepare('UPDATE users SET rate_count = rate_count + 1 WHERE chat_id = ?').bind(chatId).run();
  return true;
}

export async function setPaused(db: D1Database, chatId: number, paused: boolean): Promise<void> {
  await db.prepare('UPDATE users SET paused = ? WHERE chat_id = ?').bind(paused ? 1 : 0, chatId).run();
}

export async function markBlocked(db: D1Database, chatId: number): Promise<void> {
  await db.prepare('UPDATE users SET blocked = 1 WHERE chat_id = ?').bind(chatId).run();
}

export async function deleteUser(db: D1Database, chatId: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM filters WHERE chat_id = ?').bind(chatId),
    db.prepare('DELETE FROM users WHERE chat_id = ?').bind(chatId),
  ]);
}

export type AddResult = 'added' | 'exists' | 'limit';

export async function addFilter(
  db: D1Database,
  chatId: number,
  field: FilterField,
  value: string,
  mode: FilterMode,
): Promise<AddResult> {
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM filters WHERE chat_id = ?')
    .bind(chatId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FILTERS) return 'limit';
  const res = await db
    .prepare('INSERT OR IGNORE INTO filters (chat_id, field, value, mode) VALUES (?, ?, ?, ?)')
    .bind(chatId, field, value, mode)
    .run();
  return res.meta.changes > 0 ? 'added' : 'exists';
}

export async function removeFilter(
  db: D1Database,
  chatId: number,
  field: FilterField,
  value: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM filters WHERE chat_id = ? AND field = ? AND value = ? COLLATE NOCASE')
    .bind(chatId, field, value)
    .run();
  return res.meta.changes > 0;
}

export async function clearFilters(db: D1Database, chatId: number): Promise<void> {
  await db.prepare('DELETE FROM filters WHERE chat_id = ?').bind(chatId).run();
}

export async function listFilters(db: D1Database, chatId: number): Promise<Filter[]> {
  const { results } = await db
    .prepare('SELECT field, value, mode FROM filters WHERE chat_id = ? ORDER BY mode, field, value')
    .bind(chatId)
    .all<Filter>();
  return results;
}

export async function isPaused(db: D1Database, chatId: number): Promise<boolean> {
  const row = await db.prepare('SELECT paused FROM users WHERE chat_id = ?').bind(chatId).first<{ paused: number }>();
  return row?.paused === 1;
}

export async function activeUsers(db: D1Database): Promise<ActiveUser[]> {
  const [users, filters] = await Promise.all([
    db.prepare('SELECT chat_id FROM users WHERE paused = 0 AND blocked = 0').all<{ chat_id: number }>(),
    db.prepare('SELECT chat_id, field, value, mode FROM filters').all<Filter & { chat_id: number }>(),
  ]);
  const byUser = new Map<number, Filter[]>();
  for (const f of filters.results) {
    const list = byUser.get(f.chat_id) ?? [];
    list.push({ field: f.field, value: f.value, mode: f.mode });
    byUser.set(f.chat_id, list);
  }
  return users.results.map((u) => ({ chatId: u.chat_id, filters: byUser.get(u.chat_id) ?? [] }));
}

export async function userCount(db: D1Database): Promise<{ total: number; active: number }> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total, SUM(paused = 0 AND blocked = 0) AS active FROM users')
    .first<{ total: number; active: number | null }>();
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

export async function hackathonCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hackathons').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Inserts hackathons not yet stored and returns only the newly inserted ones. */
export async function insertNew(db: D1Database, list: Hackathon[]): Promise<Hackathon[]> {
  if (list.length === 0) return [];
  const t = now();
  const results = await db.batch(
    list.map((h) =>
      db
        .prepare('INSERT OR IGNORE INTO hackathons (id, payload, first_seen_at) VALUES (?, ?, ?)')
        .bind(h.id, JSON.stringify(h), t),
    ),
  );
  return list.filter((_, i) => results[i].meta.changes > 0);
}

export async function recentHackathons(db: D1Database, limit: number): Promise<Hackathon[]> {
  const { results } = await db
    .prepare('SELECT payload FROM hackathons ORDER BY first_seen_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<{ payload: string }>();
  return results.map((r) => JSON.parse(r.payload) as Hackathon);
}

export async function pruneHackathons(db: D1Database): Promise<void> {
  const cutoff = now() - HACKATHON_TTL_DAYS * 86400;
  await db.prepare('DELETE FROM hackathons WHERE first_seen_at < ?').bind(cutoff).run();
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
