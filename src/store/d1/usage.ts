import { rowsWrittenOf, type ReadResult, type WriteResult } from "./users";

export type UsageSnapshot = {
  globalCalls: number;
  globalRowsRead: number;
  personalRows: number;
  userCalls: number;
  accountActive: boolean;
  rowsRead: number;
};

export type GlobalUsage = {
  calls: number;
  rowsRead: number;
  oauthKvWrites: number;
  backfillRows: number;
  adjustRows: number;
  personalRows: number;
};

export type UsageEntry = {
  userId: string;
  day: string;
  tool: string;
  rowsRead: number;
  personalRows: number;
};

export type ToolUsage = { tool: string; calls: number };

export type TopUser = { userId: string; calls: number };

type GlobalCounterColumn = "personal_rows" | "oauth_kv_writes" | "backfill_rows";

type GlobalUsageRow = {
  calls: number;
  rows_read: number;
  oauth_kv_writes: number;
  backfill_rows: number;
  adjust_rows: number;
  personal_rows: number;
};

const GLOBAL_COLUMNS = "calls, rows_read, oauth_kv_writes, backfill_rows, adjust_rows, personal_rows";

const COUNTER_UPSERTS: Record<GlobalCounterColumn, string> = {
  personal_rows: `INSERT INTO usage_global (day, personal_rows) VALUES (?1, ?2)
    ON CONFLICT (day) DO UPDATE SET personal_rows = personal_rows + excluded.personal_rows`,
  oauth_kv_writes: `INSERT INTO usage_global (day, oauth_kv_writes) VALUES (?1, ?2)
    ON CONFLICT (day) DO UPDATE SET oauth_kv_writes = oauth_kv_writes + excluded.oauth_kv_writes`,
  backfill_rows: `INSERT INTO usage_global (day, backfill_rows) VALUES (?1, ?2)
    ON CONFLICT (day) DO UPDATE SET backfill_rows = backfill_rows + excluded.backfill_rows`,
};

function rowsReadOf(results: D1Result[]): number {
  return results.reduce((sum, result) => sum + result.meta.rows_read, 0);
}

export async function readUsage(db: D1Database, userId: string, day: string): Promise<UsageSnapshot> {
  const [globalResult, dailyResult, userResult] = await db.batch([
    db.prepare("SELECT calls, rows_read, personal_rows FROM usage_global WHERE day = ?1").bind(day),
    db
      .prepare("SELECT COALESCE(SUM(calls), 0) AS calls FROM usage_daily WHERE day = ?1 AND user_id = ?2")
      .bind(day, userId),
    db.prepare("SELECT deleted_at FROM users WHERE id = ?1").bind(userId),
  ]);
  const global = globalResult!.results[0] as { calls: number; rows_read: number; personal_rows: number } | undefined;
  const daily = dailyResult!.results[0] as { calls: number } | undefined;
  const user = userResult!.results[0] as { deleted_at: number | null } | undefined;
  return {
    globalCalls: global?.calls ?? 0,
    globalRowsRead: global?.rows_read ?? 0,
    personalRows: global?.personal_rows ?? 0,
    userCalls: daily?.calls ?? 0,
    accountActive: user !== undefined && user.deleted_at === null,
    rowsRead: rowsReadOf([globalResult!, dailyResult!, userResult!]),
  };
}

export async function recordUsage(db: D1Database, entry: UsageEntry): Promise<WriteResult> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO usage_daily (day, user_id, tool, calls) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT (day, user_id, tool) DO UPDATE SET calls = calls + 1`,
      )
      .bind(entry.day, entry.userId, entry.tool),
    db
      .prepare(
        `INSERT INTO usage_global (day, calls, rows_read, personal_rows) VALUES (?1, 1, ?2, ?3)
         ON CONFLICT (day) DO UPDATE SET calls = calls + 1, rows_read = rows_read + excluded.rows_read,
           personal_rows = personal_rows + excluded.personal_rows`,
      )
      .bind(entry.day, entry.rowsRead, entry.personalRows),
  ]);
  return { rowsWritten: rowsWrittenOf(results) };
}

async function addGlobalCounter(
  db: D1Database,
  column: GlobalCounterColumn,
  day: string,
  n: number,
): Promise<WriteResult> {
  const { meta } = await db.prepare(COUNTER_UPSERTS[column]).bind(day, n).run();
  return { rowsWritten: meta.rows_written };
}

export function addPersonalRows(db: D1Database, day: string, n: number): Promise<WriteResult> {
  return addGlobalCounter(db, "personal_rows", day, n);
}

export function addOauthKvWrites(db: D1Database, day: string, n: number): Promise<WriteResult> {
  return addGlobalCounter(db, "oauth_kv_writes", day, n);
}

export async function chargeOauthKvWrites(db: D1Database, day: string, n: number, cap: number): Promise<boolean> {
  const { results } = await db
    .prepare(
      `INSERT INTO usage_global (day, oauth_kv_writes) SELECT ?1, ?2 WHERE ?2 <= ?3
       ON CONFLICT (day) DO UPDATE SET oauth_kv_writes = oauth_kv_writes + excluded.oauth_kv_writes
         WHERE oauth_kv_writes + excluded.oauth_kv_writes <= ?3
       RETURNING oauth_kv_writes`,
    )
    .bind(day, n, cap)
    .all<{ oauth_kv_writes: number }>();
  return results.length > 0;
}

export function addBackfillRows(db: D1Database, day: string, n: number): Promise<WriteResult> {
  return addGlobalCounter(db, "backfill_rows", day, n);
}

export async function readGlobal(db: D1Database, day: string): Promise<ReadResult<GlobalUsage>> {
  const { results, meta } = await db
    .prepare(`SELECT ${GLOBAL_COLUMNS} FROM usage_global WHERE day = ?1`)
    .bind(day)
    .all<GlobalUsageRow>();
  const row = results[0];
  const usage = {
    calls: row?.calls ?? 0,
    rowsRead: row?.rows_read ?? 0,
    oauthKvWrites: row?.oauth_kv_writes ?? 0,
    backfillRows: row?.backfill_rows ?? 0,
    adjustRows: row?.adjust_rows ?? 0,
    personalRows: row?.personal_rows ?? 0,
  };
  return { value: usage, rowsRead: meta.rows_read ?? 0 };
}

export async function readToolUsage(db: D1Database, userId: string, day: string): Promise<ToolUsage[]> {
  const { results } = await db
    .prepare("SELECT tool, calls FROM usage_daily WHERE day = ?1 AND user_id = ?2 ORDER BY tool")
    .bind(day, userId)
    .all<ToolUsage>();
  return results;
}

export async function topUsers(db: D1Database, day: string, limit: number): Promise<ReadResult<TopUser[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT user_id, SUM(calls) AS calls FROM usage_daily WHERE day = ?1
       GROUP BY user_id ORDER BY calls DESC, user_id LIMIT ?2`,
    )
    .bind(day, limit)
    .all<{ user_id: string; calls: number }>();
  const users = results.map((row) => ({ userId: row.user_id, calls: row.calls }));
  return { value: users, rowsRead: meta.rows_read ?? 0 };
}

export async function purgeUsageDaily(db: D1Database, beforeDay: string, limit: number): Promise<number> {
  const { meta } = await db
    .prepare(
      `DELETE FROM usage_daily WHERE (day, user_id, tool) IN (
         SELECT day, user_id, tool FROM usage_daily WHERE day < ?1 ORDER BY day LIMIT ?2)`,
    )
    .bind(beforeDay, limit)
    .run();
  return meta.changes;
}
