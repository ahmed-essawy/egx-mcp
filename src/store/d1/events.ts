import { utcDay } from "../../domain/calendar";
import type { ReadResult } from "./users";

export type NoticeKind = "new_listing" | "job_failed" | "needs_ratio" | "fund_stale" | "source_switched";
export type NoticeStatus = "open" | "done";
export type EventKind = "new_nav" | "big_move" | "new_listing" | "corporate_action" | "disclosure";

export type NewNotice = { kind: NoticeKind; subject: string; details: Record<string, unknown>; at: number };

export type Notice = {
  id: number;
  kind: NoticeKind;
  subject: string;
  details: Record<string, unknown>;
  createdAt: number;
  status: NoticeStatus;
  doneAt: number | null;
};

export type NoticeCursor = { createdAt: number; id: number };

export type NoticePage = { notices: Notice[]; nextCursor: NoticeCursor | null };

export type NewMarketEvent = {
  kind: EventKind;
  occurredAt: number;
  isin: string | null;
  fundId: string | null;
  payload: Record<string, unknown>;
};

export type MarketEvent = NewMarketEvent & { id: number };

export type EventsPage = { events: MarketEvent[]; rowsRead: number };

export type Discrepancy = {
  isin: string;
  sessionDate: string;
  primarySource: string | null;
  backupSource: string | null;
  primaryClose: number | null;
  backupClose: number | null;
  diffPct: number;
  createdAt: number | null;
};

type NoticeRow = {
  id: number;
  kind: NoticeKind;
  subject: string;
  details: string;
  created_at: number;
  status: NoticeStatus;
  done_at: number | null;
};

type MarketEventRow = {
  id: number;
  kind: EventKind;
  occurred_at: number;
  isin: string | null;
  fund_id: string | null;
  payload: string;
};

type DiscrepancyRow = {
  isin: string;
  session_date: string;
  primary_source: string | null;
  backup_source: string | null;
  primary_close: number | null;
  backup_close: number | null;
  diff_pct: number;
  created_at: number | null;
};

const MAX_NOTICES_PAGE = 50;
export const DEFAULT_EVENTS_LIMIT = 200;
const ALL_EVENT_KINDS: readonly EventKind[] = ["new_nav", "big_move", "new_listing", "corporate_action", "disclosure"];
const FIRST_PAGE_CURSOR: NoticeCursor = { createdAt: Number.MAX_SAFE_INTEGER, id: Number.MAX_SAFE_INTEGER };

export async function raiseNotices(db: D1Database, notices: NewNotice[]): Promise<void> {
  if (notices.length === 0) return;
  const rows = notices.map((notice) => ({
    kind: notice.kind,
    subject: notice.subject,
    details: JSON.stringify(notice.details),
    created_at: notice.at,
    dedupe_key: `${notice.kind}|${notice.subject}|${utcDay(notice.at)}`,
  }));
  await db
    .prepare(
      `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
       SELECT json_extract(value, '$.kind'), json_extract(value, '$.subject'), json_extract(value, '$.details'),
              json_extract(value, '$.created_at'), 'open', json_extract(value, '$.dedupe_key')
       FROM json_each(?1) WHERE true
       ON CONFLICT (dedupe_key) DO NOTHING`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

export async function listNotices(
  db: D1Database,
  status: NoticeStatus,
  limit: number,
  cursor: NoticeCursor | null,
): Promise<ReadResult<NoticePage>> {
  const pageSize = Math.min(limit, MAX_NOTICES_PAGE);
  const start = cursor ?? FIRST_PAGE_CURSOR;
  const { results, meta } = await db
    .prepare(
      `SELECT id, kind, subject, details, created_at, status, done_at FROM notices
       WHERE status = ?1 AND (created_at, id) < (?2, ?3) ORDER BY created_at DESC, id DESC LIMIT ?4`,
    )
    .bind(status, start.createdAt, start.id, pageSize)
    .all<NoticeRow>();
  const notices = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    details: JSON.parse(row.details) as Record<string, unknown>,
    createdAt: row.created_at,
    status: row.status,
    doneAt: row.done_at,
  }));
  const last = notices[notices.length - 1];
  const nextCursor = last && notices.length === pageSize ? { createdAt: last.createdAt, id: last.id } : null;
  return { value: { notices, nextCursor }, rowsRead: meta.rows_read ?? 0 };
}

export async function markNoticesDone(db: D1Database, ids: number[], at: number): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .prepare(
      "UPDATE notices SET status = 'done', done_at = ?1 WHERE status = 'open' AND id IN (SELECT value FROM json_each(?2))",
    )
    .bind(at, JSON.stringify(ids))
    .run();
  return result.meta.changes;
}

export async function insertEvents(db: D1Database, events: NewMarketEvent[]): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map((event) => ({
    kind: event.kind,
    occurred_at: event.occurredAt,
    isin: event.isin,
    fund_id: event.fundId,
    payload: JSON.stringify(event.payload),
  }));
  await db
    .prepare(
      `INSERT INTO market_events (kind, occurred_at, isin, fund_id, payload)
       SELECT json_extract(value, '$.kind'), json_extract(value, '$.occurred_at'), json_extract(value, '$.isin'),
              json_extract(value, '$.fund_id'), json_extract(value, '$.payload')
       FROM json_each(?1) WHERE true`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

export async function listEventsSince(
  db: D1Database,
  since: number,
  limit: number = DEFAULT_EVENTS_LIMIT,
  kinds: readonly EventKind[] = ALL_EVENT_KINDS,
): Promise<EventsPage> {
  const { results, meta } = await db
    .prepare(
      `SELECT id, kind, occurred_at, isin, fund_id, payload FROM market_events
       WHERE occurred_at > ?1 AND kind IN (SELECT value FROM json_each(?2)) ORDER BY occurred_at, id LIMIT ?3`,
    )
    .bind(since, JSON.stringify(kinds), limit)
    .all<MarketEventRow>();
  const events = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    isin: row.isin,
    fundId: row.fund_id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
  return { events, rowsRead: meta.rows_read };
}

export async function insertDiscrepancies(db: D1Database, discrepancies: Discrepancy[]): Promise<void> {
  if (discrepancies.length === 0) return;
  const rows = discrepancies.map((row) => ({
    isin: row.isin,
    session_date: row.sessionDate,
    primary_source: row.primarySource,
    backup_source: row.backupSource,
    primary_close: row.primaryClose,
    backup_close: row.backupClose,
    diff_pct: row.diffPct,
    created_at: row.createdAt,
  }));
  await db
    .prepare(
      `INSERT INTO source_discrepancies
         (isin, session_date, primary_source, backup_source, primary_close, backup_close, diff_pct, created_at)
       SELECT json_extract(value, '$.isin'), json_extract(value, '$.session_date'), json_extract(value, '$.primary_source'),
              json_extract(value, '$.backup_source'), json_extract(value, '$.primary_close'),
              json_extract(value, '$.backup_close'), json_extract(value, '$.diff_pct'), json_extract(value, '$.created_at')
       FROM json_each(?1) WHERE true
       ON CONFLICT DO NOTHING`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

export async function listDiscrepancies(
  db: D1Database,
  from: string,
  to: string,
  limit: number,
): Promise<ReadResult<Discrepancy[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT isin, session_date, primary_source, backup_source, primary_close, backup_close, diff_pct, created_at
       FROM source_discrepancies WHERE session_date >= ?1 AND session_date <= ?2
       ORDER BY session_date DESC, isin LIMIT ?3`,
    )
    .bind(from, to, limit)
    .all<DiscrepancyRow>();
  const discrepancies = results.map((row) => ({
    isin: row.isin,
    sessionDate: row.session_date,
    primarySource: row.primary_source,
    backupSource: row.backup_source,
    primaryClose: row.primary_close,
    backupClose: row.backup_close,
    diffPct: row.diff_pct,
    createdAt: row.created_at,
  }));
  return { value: discrepancies, rowsRead: meta.rows_read ?? 0 };
}

export async function purgeEvents(db: D1Database, before: number, limit: number): Promise<number> {
  const { meta } = await db
    .prepare(
      `DELETE FROM market_events WHERE id IN (
         SELECT id FROM market_events WHERE occurred_at < ?1 ORDER BY occurred_at LIMIT ?2)`,
    )
    .bind(before, limit)
    .run();
  return meta.changes;
}
