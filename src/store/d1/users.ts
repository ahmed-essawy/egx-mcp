export type User = {
  id: string;
  googleSub: string;
  email: string;
  displayName: string | null;
  createdAt: number | null;
  deletedAt: number | null;
};

export type ApiKeySummary = {
  id: string;
  prefix: string;
  name: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type ActiveKey = {
  keyId: string;
  userId: string;
  email: string;
};

export type NewApiKey = {
  id: string;
  userId: string;
  prefix: string;
  keyHash: string;
  name: string | null;
  now: number;
};

export type GoogleProfile = { sub: string; email: string; name: string | null };

export type WriteResult = { rowsWritten: number };
export type ReadResult<T> = { value: T; rowsRead: number };
export type TouchResult = WriteResult & { rowsRead: number };

type UserRow = {
  id: string;
  google_sub: string;
  email: string;
  display_name: string | null;
  created_at: number | null;
  deleted_at: number | null;
};

type ApiKeyRow = {
  id: string;
  prefix: string;
  name: string | null;
  created_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
};

type ActiveKeyRow = {
  key_id: string;
  user_id: string;
  email: string;
};

export const MAX_ACTIVE_KEYS = 3;
const LAST_USED_REFRESH_SECONDS = 3600;
const HOLDINGS_ROW_WRITES = 2;
const PRICE_LEVELS_ROW_WRITES = 2;
const API_KEYS_ROW_WRITES = 4;
const USAGE_DAILY_ROW_WRITES = 1;
const USER_ROW_WRITES = 3;

export function rowsWrittenOf(results: D1Result[]): number {
  return results.reduce((sum, result) => sum + result.meta.rows_written, 0);
}

export async function upsertUserByGoogleSub(
  db: D1Database,
  profile: GoogleProfile,
  now: number,
): Promise<{ id: string; deletedAt: number | null; rowsWritten: number }> {
  const { results, meta } = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name
       RETURNING id, deleted_at`,
    )
    .bind(crypto.randomUUID(), profile.sub, profile.email, profile.name, now)
    .all<{ id: string; deleted_at: number | null }>();
  const row = results[0]!;
  return { id: row.id, deletedAt: row.deleted_at, rowsWritten: meta.rows_written };
}

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const row = await db
    .prepare("SELECT id, google_sub, email, display_name, created_at, deleted_at FROM users WHERE id = ?1")
    .bind(id)
    .first<UserRow>();
  if (!row) return null;
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export async function createApiKey(db: D1Database, key: NewApiKey): Promise<{ created: boolean; rowsWritten: number }> {
  const { meta } = await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, prefix, key_hash, name, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL) < ?7`,
    )
    .bind(key.id, key.userId, key.prefix, key.keyHash, key.name, key.now, MAX_ACTIVE_KEYS)
    .run();
  return { created: meta.changes > 0, rowsWritten: meta.rows_written };
}

export async function listApiKeys(db: D1Database, userId: string): Promise<ApiKeySummary[]> {
  const { results } = await db
    .prepare(
      "SELECT id, prefix, name, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ?1 ORDER BY created_at, id",
    )
    .bind(userId)
    .all<ApiKeyRow>();
  return results.map((row) => ({
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeApiKey(
  db: D1Database,
  userId: string,
  keyId: string,
  now: number,
): Promise<{ revoked: boolean; rowsWritten: number }> {
  const { meta } = await db
    .prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL")
    .bind(now, keyId, userId)
    .run();
  return { revoked: meta.changes > 0, rowsWritten: meta.rows_written };
}

export async function findActiveKeyByHash(db: D1Database, hash: string): Promise<ActiveKey | null> {
  const row = await db
    .prepare(
      `SELECT k.id AS key_id, k.user_id, u.email
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ?1 AND k.revoked_at IS NULL AND u.deleted_at IS NULL`,
    )
    .bind(hash)
    .first<ActiveKeyRow>();
  if (!row) return null;
  return { keyId: row.key_id, userId: row.user_id, email: row.email };
}

export async function touchKey(db: D1Database, keyId: string, now: number): Promise<TouchResult> {
  const { meta } = await db
    .prepare(
      "UPDATE api_keys SET last_used_at = ?2 WHERE id = ?1 AND (last_used_at IS NULL OR last_used_at < ?2 - ?3)",
    )
    .bind(keyId, now, LAST_USED_REFRESH_SECONDS)
    .run();
  return { rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
}

export async function deleteAccount(db: D1Database, userId: string): Promise<WriteResult> {
  const results = await db.batch([
    db.prepare("DELETE FROM holdings WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM price_levels WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM api_keys WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM usage_daily WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
  ]);
  return { rowsWritten: rowsWrittenOf(results) };
}

export async function accountRowsUpperBound(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM holdings WHERE user_id = ?1) * ?2
            + (SELECT COUNT(*) FROM price_levels WHERE user_id = ?1) * ?3
            + (SELECT COUNT(*) FROM api_keys WHERE user_id = ?1) * ?4
            + (SELECT COUNT(*) FROM usage_daily WHERE user_id = ?1) * ?5
            + ?6 AS bound`,
    )
    .bind(
      userId,
      HOLDINGS_ROW_WRITES,
      PRICE_LEVELS_ROW_WRITES,
      API_KEYS_ROW_WRITES,
      USAGE_DAILY_ROW_WRITES,
      USER_ROW_WRITES,
    )
    .first<{ bound: number }>();
  return row!.bound;
}
