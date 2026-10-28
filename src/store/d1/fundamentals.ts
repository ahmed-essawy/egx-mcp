import { PRICE_CHANGING_KINDS, type CorporateActionKind } from "../../domain/adjust";
import { shiftDays } from "../../domain/returns";
import type { ReadResult, WriteResult } from "./users";

export type ActionStatus = "needs_ratio" | "recorded" | "applied" | "adjusting";

export type FigurePeriodType = "FY" | "FQ" | "TTM";

export type FigureRow = {
  isin: string;
  metric: string;
  periodType: FigurePeriodType;
  periodEnd: string | null;
  periodInferred: boolean;
  value: number;
  currency: string;
  source: string;
  fetchedAt: number;
};

export type Figure = {
  isin: string;
  metric: string;
  periodType: FigurePeriodType;
  periodEnd: string | null;
  periodInferred: boolean;
  value: number;
  currency: string;
  source: string;
  fetchedAt: number | null;
};

export type ActionRow = {
  isin: string;
  ticker: string;
  kind: CorporateActionKind;
  announcedOn: string | null;
  exDate: string;
  amount: number | null;
  currency: string | null;
  source: string;
  sourceText: string | null;
  now: number;
};

export type InsertedAction = {
  id: number;
  isin: string;
  kind: CorporateActionKind;
  exDate: string;
  status: ActionStatus;
};

export type DividendAmountRow = {
  isin: string;
  exDate: string;
  amount: number;
  currency: string;
};

export type CorporateAction = {
  id: number;
  isin: string;
  kind: CorporateActionKind;
  announcedOn: string | null;
  exDate: string;
  ratio: number | null;
  amount: number | null;
  currency: string | null;
  status: ActionStatus;
  source: string;
  sourceText: string | null;
};

export type ActionFilter = {
  isin?: string;
  from: string;
  to: string;
  kinds?: CorporateActionKind[];
};

export type ManualActionRow = {
  isin: string;
  kind: CorporateActionKind;
  announcedOn: string | null;
  exDate: string;
  ratio: number | null;
  amount: number | null;
  currency: string | null;
  source: string;
  sourceText: string | null;
  now: number;
};

type FigureRecord = {
  isin: string;
  metric: string;
  period_type: FigurePeriodType;
  period_end: string;
  period_inferred: number;
  value: number;
  currency: string;
  source: string;
  fetched_at: number | null;
};

type InsertedActionRecord = {
  id: number;
  isin: string;
  kind: CorporateActionKind;
  ex_date: string;
  status: ActionStatus;
};

type ActionRecord = {
  id: number;
  isin: string;
  kind: CorporateActionKind;
  announced_on: string | null;
  ex_date: string;
  ratio: number | null;
  amount: number | null;
  currency: string | null;
  status: ActionStatus;
  source: string;
  source_text: string | null;
};

type DividendSumRecord = { total: number | null; unpriced: number };

export type DividendTotals = { total: number | null; unpriced: number };

const ACTION_COLUMNS = "id, isin, kind, announced_on, ex_date, ratio, amount, currency, status, source, source_text";
const DAYS_IN_YEAR = 365;
const CASH_DIVIDEND_KIND = "cash_dividend";
const UNKNOWN_PERIOD_END = "";

function toFigure(row: FigureRecord): Figure {
  return {
    isin: row.isin,
    metric: row.metric,
    periodType: row.period_type,
    periodEnd: row.period_end === UNKNOWN_PERIOD_END ? null : row.period_end,
    periodInferred: row.period_inferred === 1,
    value: row.value,
    currency: row.currency,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

function toInsertedAction(row: InsertedActionRecord): InsertedAction {
  return { id: row.id, isin: row.isin, kind: row.kind, exDate: row.ex_date, status: row.status };
}

function toCorporateAction(row: ActionRecord): CorporateAction {
  return {
    id: row.id,
    isin: row.isin,
    kind: row.kind,
    announcedOn: row.announced_on,
    exDate: row.ex_date,
    ratio: row.ratio,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    source: row.source,
    sourceText: row.source_text,
  };
}

export async function upsertFigures(db: D1Database, rows: FigureRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const records = rows.map((row) => ({
    isin: row.isin,
    metric: row.metric,
    period_type: row.periodType,
    period_end: row.periodEnd ?? UNKNOWN_PERIOD_END,
    period_inferred: row.periodInferred ? 1 : 0,
    value: row.value,
    currency: row.currency,
    source: row.source,
    fetched_at: row.fetchedAt,
  }));
  const { meta } = await db
    .prepare(
      `INSERT INTO financial_figures (isin, metric, period_type, period_end, period_inferred, value, currency, source, fetched_at)
       SELECT json_extract(value, '$.isin'), json_extract(value, '$.metric'), json_extract(value, '$.period_type'),
              json_extract(value, '$.period_end'), json_extract(value, '$.period_inferred'), json_extract(value, '$.value'),
              json_extract(value, '$.currency'), json_extract(value, '$.source'), json_extract(value, '$.fetched_at')
       FROM json_each(?1)
       WHERE json_extract(json_each.value, '$.period_end') <> ''
          OR json_extract(json_each.value, '$.value') IS NOT (
            SELECT f.value FROM financial_figures f
            WHERE f.isin = json_extract(json_each.value, '$.isin')
              AND f.metric = json_extract(json_each.value, '$.metric')
              AND f.period_type = json_extract(json_each.value, '$.period_type')
            ORDER BY f.fetched_at DESC LIMIT 1)
       ON CONFLICT (isin, metric, period_type, period_end) DO UPDATE SET
         period_inferred = excluded.period_inferred,
         value = excluded.value,
         currency = excluded.currency,
         source = excluded.source,
         fetched_at = excluded.fetched_at
       WHERE financial_figures.value IS NOT excluded.value
          OR EXISTS (
            SELECT 1 FROM financial_figures s
            WHERE s.isin = excluded.isin AND s.metric = excluded.metric AND s.period_type = excluded.period_type
              AND s.period_end <> financial_figures.period_end AND s.fetched_at > financial_figures.fetched_at)`,
    )
    .bind(JSON.stringify(records))
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function upsertActions(db: D1Database, rows: ActionRow[]): Promise<InsertedAction[]> {
  if (rows.length === 0) return [];
  const records = rows.map((row) => ({
    isin: row.isin,
    kind: row.kind,
    announced_on: row.announcedOn,
    ex_date: row.exDate,
    amount: row.amount,
    currency: row.currency,
    source: row.source,
    source_text: row.sourceText,
    now: row.now,
    ticker: row.ticker,
  }));
  const payload = JSON.stringify(records);
  const [inserted] = await db.batch<InsertedActionRecord>([
    db
      .prepare(
        `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, amount, currency, status, source, source_text, created_at, updated_at)
         SELECT json_extract(value, '$.isin'), json_extract(value, '$.kind'), json_extract(value, '$.announced_on'),
                json_extract(value, '$.ex_date'), json_extract(value, '$.amount'), json_extract(value, '$.currency'),
                CASE WHEN json_extract(value, '$.kind') IN ('bonus', 'split', 'reverse_split') THEN 'needs_ratio' ELSE 'recorded' END,
                json_extract(value, '$.source'), json_extract(value, '$.source_text'),
                json_extract(value, '$.now'), json_extract(value, '$.now')
         FROM json_each(?1) WHERE true
         ON CONFLICT (isin, kind, ex_date) DO NOTHING
         RETURNING id, isin, kind, ex_date, status`,
      )
      .bind(payload),
    db
      .prepare(
        `INSERT INTO market_events (kind, occurred_at, isin, fund_id, payload)
         SELECT DISTINCT 'corporate_action', action.created_at, action.isin, NULL,
                json_object('actionId', action.id, 'kind', action.kind, 'exDate', action.ex_date)
         FROM json_each(?1) AS candidate
         JOIN corporate_actions AS action
           ON action.isin = json_extract(candidate.value, '$.isin')
          AND action.kind = json_extract(candidate.value, '$.kind')
          AND action.ex_date = json_extract(candidate.value, '$.ex_date')
         WHERE action.created_at = json_extract(candidate.value, '$.now')`,
      )
      .bind(payload),
    db
      .prepare(
        `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
         SELECT 'needs_ratio', subject, json_object('actionId', id, 'ticker', ticker, 'kind', kind, 'exDate', ex_date, 'source', source),
                created_at, 'open', 'needs_ratio|' || subject || '|' || strftime('%Y-%m-%d', created_at, 'unixepoch')
         FROM (
           SELECT action.id, action.kind, action.ex_date, action.source, action.created_at,
                  json_extract(candidate.value, '$.ticker') AS ticker,
                  json_extract(candidate.value, '$.ticker') || ' ' || action.kind || ' ' || action.ex_date AS subject
           FROM json_each(?1) AS candidate
           JOIN corporate_actions AS action
             ON action.isin = json_extract(candidate.value, '$.isin')
            AND action.kind = json_extract(candidate.value, '$.kind')
            AND action.ex_date = json_extract(candidate.value, '$.ex_date')
           WHERE action.created_at = json_extract(candidate.value, '$.now') AND action.status = 'needs_ratio'
         ) WHERE true
         ON CONFLICT (dedupe_key) DO NOTHING`,
      )
      .bind(payload),
  ]);
  return (inserted?.results ?? []).map(toInsertedAction);
}

export async function setDividendAmounts(db: D1Database, rows: DividendAmountRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const records = rows.map((row) => ({
    isin: row.isin,
    ex_date: row.exDate,
    amount: row.amount,
    currency: row.currency,
  }));
  const { meta } = await db
    .prepare(
      `UPDATE corporate_actions SET amount = updates.amount, currency = updates.currency
       FROM (SELECT json_extract(value, '$.isin') AS isin, json_extract(value, '$.ex_date') AS ex_date,
                    json_extract(value, '$.amount') AS amount, json_extract(value, '$.currency') AS currency
             FROM json_each(?1)) AS updates
       WHERE corporate_actions.isin = updates.isin AND corporate_actions.ex_date = updates.ex_date
         AND corporate_actions.kind = 'cash_dividend' AND corporate_actions.amount IS NULL`,
    )
    .bind(JSON.stringify(records))
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function listFigures(db: D1Database, isin: string): Promise<ReadResult<Figure[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT isin, metric, period_type, period_end, period_inferred, value, currency, source, fetched_at
       FROM financial_figures WHERE isin = ?1 ORDER BY metric, period_type, period_end DESC`,
    )
    .bind(isin)
    .all<FigureRecord>();
  return { value: results.map(toFigure), rowsRead: meta.rows_read ?? 0 };
}

function kindsJson(kinds: CorporateActionKind[] | undefined): string | null {
  return kinds && kinds.length > 0 ? JSON.stringify(kinds) : null;
}

function actionsOfIsin(db: D1Database, isin: string, filter: ActionFilter): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${ACTION_COLUMNS} FROM corporate_actions
       WHERE isin = ?1 AND ex_date BETWEEN ?2 AND ?3
         AND (?4 IS NULL OR kind IN (SELECT value FROM json_each(?4)))
       ORDER BY ex_date, isin, id`,
    )
    .bind(isin, filter.from, filter.to, kindsJson(filter.kinds));
}

function actionsInRange(db: D1Database, filter: ActionFilter): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${ACTION_COLUMNS} FROM corporate_actions
       WHERE ex_date BETWEEN ?1 AND ?2
         AND (?3 IS NULL OR kind IN (SELECT value FROM json_each(?3)))
       ORDER BY ex_date, isin, id`,
    )
    .bind(filter.from, filter.to, kindsJson(filter.kinds));
}

export async function listActions(db: D1Database, filter: ActionFilter): Promise<ReadResult<CorporateAction[]>> {
  const statement = filter.isin === undefined ? actionsInRange(db, filter) : actionsOfIsin(db, filter.isin, filter);
  const { results, meta } = await statement.all<ActionRecord>();
  return { value: results.map(toCorporateAction), rowsRead: meta.rows_read ?? 0 };
}

export async function dividendsLast365(
  db: D1Database,
  isin: string,
  today: string,
  currency: string,
): Promise<ReadResult<DividendTotals>> {
  const { results, meta } = await db
    .prepare(
      `SELECT SUM(CASE WHEN amount IS NOT NULL AND currency = ?3 THEN amount END) AS total,
              COALESCE(SUM(amount IS NULL), 0) AS unpriced
       FROM corporate_actions
       WHERE isin = ?1 AND kind = ?2 AND ex_date > ?4 AND ex_date <= ?5`,
    )
    .bind(isin, CASH_DIVIDEND_KIND, currency, shiftDays(today, -DAYS_IN_YEAR), today)
    .all<DividendSumRecord>();
  const row = results[0];
  return { value: { total: row?.total ?? null, unpriced: row?.unpriced ?? 0 }, rowsRead: meta.rows_read ?? 0 };
}

export type QuoteCurrencyRow = { isin: string; currency: string };

export async function setQuoteCurrencies(db: D1Database, rows: QuoteCurrencyRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const { meta } = await db
    .prepare(
      `UPDATE symbols SET quote_currency = updates.currency
       FROM (SELECT json_extract(value, '$.isin') AS isin, json_extract(value, '$.currency') AS currency
             FROM json_each(?1)) AS updates
       WHERE symbols.isin = updates.isin AND symbols.quote_currency != updates.currency`,
    )
    .bind(JSON.stringify(rows))
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function setActionRatio(
  db: D1Database,
  actionId: number,
  ratio: number,
  now: number,
): Promise<CorporateAction | null> {
  const row = await db
    .prepare(
      `UPDATE corporate_actions SET ratio = ?1, status = 'recorded', updated_at = ?2
       WHERE id = ?3 AND status = 'needs_ratio' AND kind IN ('bonus', 'split', 'reverse_split')
       RETURNING ${ACTION_COLUMNS}`,
    )
    .bind(ratio, now, actionId)
    .first<ActionRecord>();
  return row ? toCorporateAction(row) : null;
}

export async function insertManualAction(db: D1Database, row: ManualActionRow): Promise<CorporateAction | null> {
  const inserted = await db
    .prepare(
      `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, ratio, amount, currency, status, source, source_text, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT (isin, kind, ex_date) DO NOTHING
       RETURNING ${ACTION_COLUMNS}`,
    )
    .bind(
      row.isin,
      row.kind,
      row.announcedOn,
      row.exDate,
      row.ratio,
      row.amount,
      row.currency,
      row.ratio === null && PRICE_CHANGING_KINDS.includes(row.kind) ? "needs_ratio" : "recorded",
      row.source,
      row.sourceText,
      row.now,
    )
    .first<ActionRecord>();
  return inserted ? toCorporateAction(inserted) : null;
}
