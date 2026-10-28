import { actionFactor, applyRefusal, revertRefusal } from "../../domain/adjust";
import type { ApplyCandidate, CorporateActionKind } from "../../domain/adjust";
import { ADJUST_BATCH_OVERHEAD_ROWS } from "../../domain/budget";
import { utcDay } from "../../domain/calendar";
import type { StatsBarInput } from "../../domain/stats";
import type { PendingAdjustment } from "../kv";
import { markJobRun } from "./jobs";

export type NewBar = {
  isin: string;
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number | null;
  source: string;
};

export type NewIndexValue = {
  indexCode: string;
  sessionDate: string;
  close: number;
  changePct: number | null;
  source: string;
};

export type HistoryBar = {
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number | null;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  adjFactor: number;
  rawDerived: boolean;
  source: string;
};

export type RangeSummary = {
  isin: string;
  firstClose: number;
  lastClose: number;
  high: number;
  low: number;
  volume: number;
  firstDate: string;
  lastDate: string;
};

export type PendingAction = {
  actionId: number;
  isin: string;
  kind: PendingAdjustment["kind"];
  exDate: string;
  announcedOn: string | null;
  source: string;
  status: "needs_ratio" | "recorded";
  basisDate: string | null;
  backfillState: "loading" | "done" | null;
  latestSession: string | null;
  adjAffected: boolean;
};

export type Counted<T> = { value: T; rowsRead: number };

export type ApplyQuery = { actionId: number } | { limit: number };

export type AdjustmentRefusal =
  | "not_recorded"
  | "not_applied"
  | "ex_date_not_reached"
  | "backfill_loading"
  | "daily_cap"
  | "concurrent_change";

export type AdjustmentResult = { applied: boolean; rows: number; refusedReason: AdjustmentRefusal | null };

export type StatsSeries = { isin: string; bars: StatsBarInput[] };

type HistoryBarRow = {
  session_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number | null;
  adj_open: number;
  adj_high: number;
  adj_low: number;
  adj_close: number;
  adj_factor: number;
  raw_derived: number;
  source: string;
};

type RangeSummaryRow = {
  isin: string;
  first_close: number;
  last_close: number;
  high: number;
  low: number;
  volume: number;
  first_date: string;
  last_date: string;
};

type PendingActionRow = {
  action_id: number;
  isin: string;
  kind: PendingAdjustment["kind"];
  ex_date: string;
  announced_on: string | null;
  source: string;
  status: "needs_ratio" | "recorded";
  adj_basis_date: string | null;
  backfill_state: "loading" | "done" | null;
  latest_session: string | null;
  adj_affected: number;
};

type ApplyCandidateRow = {
  id: number;
  isin: string;
  ticker: string;
  kind: CorporateActionKind;
  ratio: number | null;
  ex_date: string;
  status: string;
  adj_basis_date: string | null;
  backfill_state: "loading" | "done" | null;
  row_count: number;
  latest_session: string | null;
  adjust_rows_today: number;
};

type StatsSeriesRow = { isin: string; bars: string };

type AdjustmentBatchInput = {
  candidate: ApplyCandidate;
  factor: number;
  fromStatus: "recorded" | "applied";
  toStatus: "applied" | "needs_ratio";
  clearRatio: boolean;
  noticeStatement: D1PreparedStatement;
  checkLatestSession: boolean;
  day: string;
  maxRowsPerDay: number;
  now: number;
};

const DEFAULT_HISTORY_LIMIT = 500;
const LATEST_SESSION_SQL = "(SELECT last_run_date FROM job_state WHERE job = 'eod_bars')";
const UNAPPLIED_PRICE_CHANGING_SQL =
  "a.status IN ('needs_ratio', 'recorded') AND a.kind IN ('bonus', 'split', 'reverse_split')";
const HISTORY_COLUMNS =
  "session_date, open, high, low, close, volume, value, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source";
const PENDING_COLUMNS = `a.id AS action_id, a.isin, a.kind, a.ex_date, a.announced_on, a.source, a.status,
  s.adj_basis_date, s.backfill_state, ${LATEST_SESSION_SQL} AS latest_session`;
const CANDIDATE_COLUMNS = `a.id, a.isin, s.ticker, a.kind, a.ratio, a.ex_date, a.status, s.adj_basis_date, s.backfill_state,
  (SELECT COUNT(*) FROM daily_bars b WHERE b.isin = a.isin AND b.session_date < a.ex_date) AS row_count,
  ${LATEST_SESSION_SQL} AS latest_session,
  COALESCE((SELECT adjust_rows FROM usage_global WHERE day = ?1), 0) AS adjust_rows_today`;

function adjustingSql(idParam: string): string {
  return `EXISTS (SELECT 1 FROM corporate_actions WHERE id = ${idParam} AND status = 'adjusting')`;
}

function adjAffectedSql(fromParam: string): string {
  return `EXISTS (SELECT 1 FROM daily_bars b WHERE b.isin = a.isin AND b.session_date >= ${fromParam}
    AND b.session_date < a.ex_date AND (b.raw_derived = 0 OR a.ex_date > COALESCE(s.adj_basis_date, ''))) AS adj_affected`;
}

function toPendingAction(row: PendingActionRow): PendingAction {
  return {
    actionId: row.action_id,
    isin: row.isin,
    kind: row.kind,
    exDate: row.ex_date,
    announcedOn: row.announced_on,
    source: row.source,
    status: row.status,
    basisDate: row.adj_basis_date,
    backfillState: row.backfill_state,
    latestSession: row.latest_session,
    adjAffected: row.adj_affected === 1,
  };
}

function toApplyCandidate(row: ApplyCandidateRow): ApplyCandidate {
  return {
    id: row.id,
    isin: row.isin,
    ticker: row.ticker,
    kind: row.kind,
    ratio: row.ratio,
    exDate: row.ex_date,
    status: row.status,
    basisDate: row.adj_basis_date,
    backfillState: row.backfill_state,
    rowCount: row.row_count,
    latestSession: row.latest_session,
    adjustRowsToday: row.adjust_rows_today,
  };
}

function refused(reason: AdjustmentRefusal): AdjustmentResult {
  return { applied: false, rows: 0, refusedReason: reason };
}

function noticeSubject(candidate: ApplyCandidate): string {
  return `${candidate.ticker} ${candidate.kind} ${candidate.exDate}`;
}

export async function insertBars(db: D1Database, bars: NewBar[]): Promise<void> {
  if (bars.length === 0) return;
  const rows = bars.map((bar) => ({
    isin: bar.isin,
    session_date: bar.sessionDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    value: bar.value,
    source: bar.source,
  }));
  await db
    .prepare(
      `INSERT INTO daily_bars
         (isin, session_date, open, high, low, close, volume, value, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source)
       SELECT json_extract(value, '$.isin'), json_extract(value, '$.session_date'), json_extract(value, '$.open'),
              json_extract(value, '$.high'), json_extract(value, '$.low'), json_extract(value, '$.close'),
              json_extract(value, '$.volume'), json_extract(value, '$.value'), json_extract(value, '$.open'),
              json_extract(value, '$.high'), json_extract(value, '$.low'), json_extract(value, '$.close'), 1, 0,
              json_extract(value, '$.source')
       FROM json_each(?1) WHERE true
       ON CONFLICT (isin, session_date) DO NOTHING`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

export async function insertIndexValues(db: D1Database, values: NewIndexValue[]): Promise<void> {
  if (values.length === 0) return;
  const rows = values.map((entry) => ({
    index_code: entry.indexCode,
    session_date: entry.sessionDate,
    close: entry.close,
    change_pct: entry.changePct,
    source: entry.source,
  }));
  await db
    .prepare(
      `INSERT INTO index_values (index_code, session_date, close, change_pct, source)
       SELECT json_extract(value, '$.index_code'), json_extract(value, '$.session_date'), json_extract(value, '$.close'),
              json_extract(value, '$.change_pct'), json_extract(value, '$.source')
       FROM json_each(?1) WHERE true
       ON CONFLICT (index_code, session_date) DO NOTHING`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

export async function getHistoryPage(
  db: D1Database,
  isin: string,
  from: string,
  to: string,
  afterDate: string | null,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<Counted<HistoryBar[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT ${HISTORY_COLUMNS} FROM daily_bars
       WHERE isin = ?1 AND session_date BETWEEN ?2 AND ?3 AND session_date > ?4 ORDER BY session_date LIMIT ?5`,
    )
    .bind(isin, from, to, afterDate ?? "", limit)
    .all<HistoryBarRow>();
  const bars = results.map((row) => ({
    sessionDate: row.session_date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    value: row.value,
    adjOpen: row.adj_open,
    adjHigh: row.adj_high,
    adjLow: row.adj_low,
    adjClose: row.adj_close,
    adjFactor: row.adj_factor,
    rawDerived: row.raw_derived === 1,
    source: row.source,
  }));
  return { value: bars, rowsRead: meta.rows_read ?? 0 };
}

export async function earliestDate(db: D1Database, isin: string): Promise<Counted<string | null>> {
  const { results, meta } = await db
    .prepare("SELECT MIN(session_date) AS earliest FROM daily_bars WHERE isin = ?1")
    .bind(isin)
    .all<{ earliest: string | null }>();
  return { value: results[0]?.earliest ?? null, rowsRead: meta.rows_read ?? 0 };
}

export async function compareRange(
  db: D1Database,
  isins: string[],
  from: string,
  to: string,
): Promise<Counted<RangeSummary[]>> {
  const { results, meta } = await db
    .prepare(
      `WITH scoped AS (
         SELECT isin, session_date, adj_close, adj_high, adj_low, volume FROM daily_bars
         WHERE isin IN (SELECT value FROM json_each(?1)) AND session_date BETWEEN ?2 AND ?3
       ),
       common AS (
         SELECT MAX(first_date) AS common_from, MIN(last_date) AS common_to
         FROM (SELECT MIN(session_date) AS first_date, MAX(session_date) AS last_date FROM scoped GROUP BY isin)
       )
       SELECT isin, MAX(first_close) AS first_close, MAX(last_close) AS last_close, MAX(adj_high) AS high,
              MIN(adj_low) AS low, SUM(volume) AS volume, MIN(session_date) AS first_date, MAX(session_date) AS last_date
       FROM (
         SELECT scoped.isin, scoped.session_date, scoped.adj_high, scoped.adj_low, scoped.volume,
                FIRST_VALUE(scoped.adj_close) OVER bars AS first_close, LAST_VALUE(scoped.adj_close) OVER bars AS last_close
         FROM scoped, common
         WHERE scoped.session_date BETWEEN common.common_from AND common.common_to
         WINDOW bars AS (
           PARTITION BY scoped.isin ORDER BY scoped.session_date ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
         )
       )
       GROUP BY isin ORDER BY isin`,
    )
    .bind(JSON.stringify(isins), from, to)
    .all<RangeSummaryRow>();
  const summaries = results.map((row) => ({
    isin: row.isin,
    firstClose: row.first_close,
    lastClose: row.last_close,
    high: row.high,
    low: row.low,
    volume: row.volume,
    firstDate: row.first_date,
    lastDate: row.last_date,
  }));
  return { value: summaries, rowsRead: meta.rows_read ?? 0 };
}

export function setLatestSession(db: D1Database, sessionDate: string): Promise<void> {
  return markJobRun(db, "eod_bars", sessionDate);
}

export async function pendingForIsins(
  db: D1Database,
  isins: string[],
  today: string,
  from: string,
): Promise<Counted<PendingAction[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT ${PENDING_COLUMNS}, ${adjAffectedSql("?3")}
       FROM corporate_actions a JOIN symbols s ON s.isin = a.isin
       WHERE ${UNAPPLIED_PRICE_CHANGING_SQL} AND a.isin IN (SELECT value FROM json_each(?1)) AND a.ex_date <= ?2
       ORDER BY a.ex_date, a.id`,
    )
    .bind(JSON.stringify(isins), today, from)
    .all<PendingActionRow>();
  return { value: results.map(toPendingAction), rowsRead: meta.rows_read ?? 0 };
}

export async function pendingAll(db: D1Database, from: string): Promise<PendingAction[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PENDING_COLUMNS}, ${adjAffectedSql("?1")}
       FROM corporate_actions a JOIN symbols s ON s.isin = a.isin
       WHERE ${UNAPPLIED_PRICE_CHANGING_SQL}
       ORDER BY a.ex_date, a.id`,
    )
    .bind(from)
    .all<PendingActionRow>();
  return results.map(toPendingAction);
}

export async function readApplyCandidates(db: D1Database, query: ApplyQuery, day: string): Promise<ApplyCandidate[]> {
  const statement =
    "actionId" in query
      ? db
          .prepare(
            `SELECT ${CANDIDATE_COLUMNS} FROM corporate_actions a JOIN symbols s ON s.isin = a.isin WHERE a.id = ?2`,
          )
          .bind(day, query.actionId)
      : db
          .prepare(
            `SELECT ${CANDIDATE_COLUMNS} FROM corporate_actions a JOIN symbols s ON s.isin = a.isin
             WHERE ${UNAPPLIED_PRICE_CHANGING_SQL} AND a.status = 'recorded' AND a.ex_date <= ${LATEST_SESSION_SQL}
               AND s.backfill_state IS NOT 'loading'
             ORDER BY a.ex_date, a.id LIMIT ?2`,
          )
          .bind(day, query.limit);
  const { results } = await statement.all<ApplyCandidateRow>();
  return results.map(toApplyCandidate);
}

async function adjustmentBatch(db: D1Database, input: AdjustmentBatchInput): Promise<AdjustmentResult> {
  const { candidate, factor, day, maxRowsPerDay, now } = input;
  const latestSessionCheck = input.checkLatestSession ? ` AND ?5 <= ${LATEST_SESSION_SQL}` : "";
  const basis = candidate.basisDate ?? "";
  const gate = db
    .prepare(
      `UPDATE corporate_actions SET status = 'adjusting'
       WHERE id = ?1 AND status = ?2 AND ratio IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM symbols WHERE isin = ?3 AND backfill_state = 'loading')
         AND COALESCE((SELECT adjust_rows FROM usage_global WHERE day = ?4), 0)
           + (SELECT COUNT(*) FROM daily_bars WHERE isin = ?3 AND session_date < ?5) + ?6 <= ?7${latestSessionCheck}`,
    )
    .bind(
      candidate.id,
      input.fromStatus,
      candidate.isin,
      day,
      candidate.exDate,
      ADJUST_BATCH_OVERHEAD_ROWS,
      maxRowsPerDay,
    );
  const adjustedPrices = db
    .prepare(
      `UPDATE daily_bars
       SET adj_open = adj_open * ?1, adj_high = adj_high * ?1, adj_low = adj_low * ?1, adj_close = adj_close * ?1,
           adj_factor = adj_factor * ?1
       WHERE isin = ?2 AND session_date < ?3 AND (raw_derived = 0 OR ?3 > ?4) AND ${adjustingSql("?5")}`,
    )
    .bind(factor, candidate.isin, candidate.exDate, basis, candidate.id);
  const rawPrices = db
    .prepare(
      `UPDATE daily_bars
       SET open = open / ?1, high = high / ?1, low = low / ?1, close = close / ?1, adj_factor = adj_factor * ?1
       WHERE isin = ?2 AND session_date < ?3 AND raw_derived = 1 AND ?3 <= ?4 AND ${adjustingSql("?5")}`,
    )
    .bind(factor, candidate.isin, candidate.exDate, basis, candidate.id);
  const usage = db
    .prepare(
      `INSERT INTO usage_global (day, adjust_rows)
       SELECT ?1, (SELECT COUNT(*) FROM daily_bars WHERE isin = ?2 AND session_date < ?3) + ?4
       WHERE ${adjustingSql("?5")}
       ON CONFLICT (day) DO UPDATE SET adjust_rows = adjust_rows + excluded.adjust_rows`,
    )
    .bind(day, candidate.isin, candidate.exDate, ADJUST_BATCH_OVERHEAD_ROWS, candidate.id);
  const ratioReset = input.clearRatio ? ", ratio = NULL" : "";
  const status = db
    .prepare(
      `UPDATE corporate_actions SET status = ?1${ratioReset}, updated_at = ?2 WHERE id = ?3 AND status = 'adjusting'`,
    )
    .bind(input.toStatus, now, candidate.id);
  const [, adjusted, raw, , , statusResult] = await db.batch([
    gate,
    adjustedPrices,
    rawPrices,
    usage,
    input.noticeStatement,
    status,
  ]);
  if (statusResult!.meta.changes === 0) return refused("concurrent_change");
  return { applied: true, rows: adjusted!.meta.changes + raw!.meta.changes, refusedReason: null };
}

export async function applyAdjustment(
  db: D1Database,
  candidate: ApplyCandidate,
  maxRowsPerDay: number,
  day: string,
  now: number,
): Promise<AdjustmentResult> {
  const refusal = applyRefusal(candidate, maxRowsPerDay);
  if (refusal !== null || candidate.ratio === null) return refused(refusal ?? "not_recorded");
  const noticeStatement = db
    .prepare(
      `UPDATE notices SET status = 'done', done_at = ?1
       WHERE kind = 'needs_ratio' AND status = 'open' AND subject = ?2 AND ${adjustingSql("?3")}`,
    )
    .bind(now, noticeSubject(candidate), candidate.id);
  return adjustmentBatch(db, {
    candidate,
    factor: actionFactor(candidate.kind, candidate.ratio),
    fromStatus: "recorded",
    toStatus: "applied",
    clearRatio: false,
    noticeStatement,
    checkLatestSession: true,
    day,
    maxRowsPerDay,
    now,
  });
}

export async function revertAdjustment(
  db: D1Database,
  candidate: ApplyCandidate,
  maxRowsPerDay: number,
  day: string,
  now: number,
): Promise<AdjustmentResult> {
  const refusal = revertRefusal(candidate, maxRowsPerDay);
  if (refusal !== null || candidate.ratio === null) return refused(refusal ?? "not_applied");
  const subject = noticeSubject(candidate);
  const details = JSON.stringify({
    actionId: candidate.id,
    isin: candidate.isin,
    kind: candidate.kind,
    exDate: candidate.exDate,
  });
  const noticeStatement = db
    .prepare(
      `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
       SELECT 'needs_ratio', ?1, ?2, ?3, 'open', ?4
       WHERE ${adjustingSql("?5")}
       ON CONFLICT (dedupe_key) DO UPDATE SET status = 'open', done_at = NULL`,
    )
    .bind(subject, details, now, `needs_ratio|${subject}|${utcDay(now)}`, candidate.id);
  return adjustmentBatch(db, {
    candidate,
    factor: 1 / actionFactor(candidate.kind, candidate.ratio),
    fromStatus: "applied",
    toStatus: "needs_ratio",
    clearRatio: true,
    noticeStatement,
    checkLatestSession: false,
    day,
    maxRowsPerDay,
    now,
  });
}

export async function statsAggregate(db: D1Database, sinceDate: string): Promise<StatsSeries[]> {
  const { results } = await db
    .prepare(
      `SELECT isin, json_group_array(json_array(session_date, adj_high, adj_low, adj_close, volume)) AS bars
       FROM (
         SELECT isin, session_date, adj_high, adj_low, adj_close, volume FROM daily_bars
         WHERE session_date >= ?1
       )
       GROUP BY isin`,
    )
    .bind(sinceDate)
    .all<StatsSeriesRow>();
  return results.map((row) => ({
    isin: row.isin,
    bars: (JSON.parse(row.bars) as [string, number, number, number, number][])
      .map(([sessionDate, adjHigh, adjLow, adjClose, volume]) => ({ sessionDate, adjHigh, adjLow, adjClose, volume }))
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)),
  }));
}
