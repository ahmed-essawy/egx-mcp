import { tradingDaysBetween } from "../../domain/freshness";
import { median } from "../../domain/returns";
import { holidaysBetween } from "./calendar";
import type { ReadResult, WriteResult } from "./users";

export type FundStatus = "active" | "stale";

export type FundRow = {
  fundId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string | null;
  category: string | null;
};

export type NavRow = {
  fundId: string;
  navDate: string;
  nav: number;
  source: string;
  fetchedAt: number;
};

export type FundProfile = {
  fundId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string;
  currencyInferred: boolean;
  category: string | null;
  cycleDays: number;
  hasCycle: boolean;
  status: FundStatus;
  createdAt: number | null;
  updatedAt: number | null;
};

export type NavPoint = { navDate: string; nav: number };

type FundProfileRecord = {
  fund_id: string;
  name_ar: string;
  name_en: string | null;
  manager: string | null;
  currency: string;
  currency_inferred: number;
  category: string | null;
  cycle_days: number;
  nav_count: number;
  status: FundStatus;
  created_at: number | null;
  updated_at: number | null;
};

type NavPointRecord = { nav_date: string; nav: number };

type NavDateRecord = { fund_id: string; nav_date: string };

const DEFAULT_CURRENCY = "EGP";
const CYCLE_WINDOW = 8;
const MIN_CYCLE_DAYS = 1;
const MIN_CYCLE_NAVS = 2;

function toNavPoint(row: NavPointRecord): NavPoint {
  return { navDate: row.nav_date, nav: row.nav };
}

function firstNavPoint(rows: NavPointRecord[]): NavPoint | null {
  const [row] = rows;
  return row ? toNavPoint(row) : null;
}

function cycleDaysOf(dates: string[], holidays: ReadonlySet<string>): number | null {
  const gaps = dates.slice(1).map((date, index) => tradingDaysBetween(dates[index] ?? date, date, holidays));
  if (gaps.length === 0) return null;
  return Math.max(MIN_CYCLE_DAYS, Math.ceil(median(gaps)));
}

function groupDatesByFund(rows: NavDateRecord[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const dates = grouped.get(row.fund_id) ?? [];
    dates.push(row.nav_date);
    grouped.set(row.fund_id, dates);
  }
  return grouped;
}

async function setFundStatus(db: D1Database, fundIds: string[], status: FundStatus, now: number): Promise<string[]> {
  if (fundIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `UPDATE funds SET status = ?1, updated_at = ?2
       WHERE status != ?1 AND fund_id IN (SELECT value FROM json_each(?3))
       RETURNING fund_id`,
    )
    .bind(status, now, JSON.stringify(fundIds))
    .all<{ fund_id: string }>();
  return results.map((row) => row.fund_id);
}

export async function upsertFunds(db: D1Database, rows: FundRow[], now: number): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const records = rows.map((row) => ({
    fund_id: row.fundId,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    manager: row.manager,
    currency: row.currency ?? DEFAULT_CURRENCY,
    currency_inferred: row.currency === null ? 1 : 0,
    category: row.category,
  }));
  const { meta } = await db
    .prepare(
      `INSERT INTO funds (fund_id, name_ar, name_en, manager, currency, currency_inferred, category, cycle_days, status, created_at, updated_at)
       SELECT json_extract(value, '$.fund_id'), json_extract(value, '$.name_ar'), json_extract(value, '$.name_en'),
              json_extract(value, '$.manager'), json_extract(value, '$.currency'),
              json_extract(value, '$.currency_inferred'), json_extract(value, '$.category'), 1, 'active', ?2, ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (fund_id) DO UPDATE SET
         name_ar = excluded.name_ar,
         name_en = COALESCE(excluded.name_en, funds.name_en),
         manager = COALESCE(excluded.manager, funds.manager),
         currency = excluded.currency,
         currency_inferred = excluded.currency_inferred,
         category = COALESCE(excluded.category, funds.category),
         updated_at = excluded.updated_at
       WHERE funds.name_ar IS NOT excluded.name_ar
         OR funds.name_en IS NOT COALESCE(excluded.name_en, funds.name_en)
         OR funds.manager IS NOT COALESCE(excluded.manager, funds.manager)
         OR funds.currency IS NOT excluded.currency
         OR funds.currency_inferred IS NOT excluded.currency_inferred
         OR funds.category IS NOT COALESCE(excluded.category, funds.category)`,
    )
    .bind(JSON.stringify(records), now)
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function insertNavs(db: D1Database, rows: NavRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const records = rows.map((row) => ({
    fund_id: row.fundId,
    nav_date: row.navDate,
    nav: row.nav,
    source: row.source,
    fetched_at: row.fetchedAt,
  }));
  const payload = JSON.stringify(records);
  const [inserted] = await db.batch<{ fund_id: string }>([
    db
      .prepare(
        `INSERT INTO nav_records (fund_id, nav_date, nav, source, fetched_at)
         SELECT json_extract(value, '$.fund_id'), json_extract(value, '$.nav_date'), json_extract(value, '$.nav'),
                json_extract(value, '$.source'), json_extract(value, '$.fetched_at')
         FROM json_each(?1) WHERE true
         ON CONFLICT (fund_id, nav_date) DO NOTHING
         RETURNING fund_id`,
      )
      .bind(payload),
    db
      .prepare(
        `INSERT INTO market_events (kind, occurred_at, isin, fund_id, payload)
         SELECT DISTINCT 'new_nav', nav.fetched_at, NULL, nav.fund_id, json_object('navDate', nav.nav_date, 'nav', nav.nav)
         FROM json_each(?1) AS candidate
         JOIN nav_records AS nav
           ON nav.fund_id = json_extract(candidate.value, '$.fund_id')
          AND nav.nav_date = json_extract(candidate.value, '$.nav_date')
         WHERE nav.fetched_at = json_extract(candidate.value, '$.fetched_at')
           AND nav.source = json_extract(candidate.value, '$.source')`,
      )
      .bind(payload),
  ]);
  return (inserted?.results ?? []).map((row) => row.fund_id);
}

export async function recomputeCycles(db: D1Database, fundIds: string[]): Promise<WriteResult> {
  if (fundIds.length === 0) return { rowsWritten: 0 };
  const { results } = await db
    .prepare(
      `SELECT nav.fund_id, nav.nav_date
       FROM json_each(?1) AS fund
       JOIN nav_records AS nav
         ON nav.fund_id = fund.value
        AND nav.nav_date >= COALESCE(
              (SELECT nav_date FROM nav_records WHERE fund_id = fund.value ORDER BY nav_date DESC LIMIT 1 OFFSET ?2),
              '')
       ORDER BY nav.fund_id, nav.nav_date`,
    )
    .bind(JSON.stringify(fundIds), CYCLE_WINDOW - 1)
    .all<NavDateRecord>();
  if (results.length === 0) return { rowsWritten: 0 };
  const dates = results.map((row) => row.nav_date).sort();
  const { value: holidays } = await holidaysBetween(db, dates[0] ?? "", dates.at(-1) ?? "");
  const cycles: { fund_id: string; cycle_days: number }[] = [];
  for (const [fundId, dates] of groupDatesByFund(results)) {
    const cycleDays = cycleDaysOf(dates, holidays);
    if (cycleDays !== null) cycles.push({ fund_id: fundId, cycle_days: cycleDays });
  }
  if (cycles.length === 0) return { rowsWritten: 0 };
  const { meta } = await db
    .prepare(
      `UPDATE funds SET cycle_days = updates.cycle_days
       FROM (SELECT json_extract(value, '$.fund_id') AS fund_id, json_extract(value, '$.cycle_days') AS cycle_days
             FROM json_each(?1)) AS updates
       WHERE funds.fund_id = updates.fund_id AND funds.cycle_days != updates.cycle_days`,
    )
    .bind(JSON.stringify(cycles))
    .run();
  return { rowsWritten: meta.rows_written };
}

export function markStale(db: D1Database, fundIds: string[], now: number): Promise<string[]> {
  return setFundStatus(db, fundIds, "stale", now);
}

export function markActive(db: D1Database, fundIds: string[], now: number): Promise<string[]> {
  return setFundStatus(db, fundIds, "active", now);
}

export async function getFund(db: D1Database, fundId: string): Promise<ReadResult<FundProfile | null>> {
  const { results, meta } = await db
    .prepare(
      `SELECT fund_id, name_ar, name_en, manager, currency, currency_inferred, category, cycle_days, status,
              (SELECT COUNT(*) FROM (SELECT 1 FROM nav_records WHERE fund_id = ?1 LIMIT ?2)) AS nav_count,
              created_at, updated_at
       FROM funds WHERE fund_id = ?1`,
    )
    .bind(fundId, MIN_CYCLE_NAVS)
    .all<FundProfileRecord>();
  const row = results[0];
  const rowsRead = meta.rows_read ?? 0;
  if (!row) return { value: null, rowsRead };
  const profile: FundProfile = {
    fundId: row.fund_id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    manager: row.manager,
    currency: row.currency,
    currencyInferred: row.currency_inferred === 1,
    category: row.category,
    cycleDays: row.cycle_days,
    hasCycle: row.nav_count >= MIN_CYCLE_NAVS,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { value: profile, rowsRead };
}

export async function navAt(db: D1Database, fundId: string, date: string): Promise<ReadResult<NavPoint | null>> {
  const { results, meta } = await db
    .prepare(
      `SELECT nav_date, nav FROM nav_records
       WHERE fund_id = ?1 AND nav_date = (SELECT MAX(nav_date) FROM nav_records WHERE fund_id = ?1 AND nav_date <= ?2)`,
    )
    .bind(fundId, date)
    .all<NavPointRecord>();
  return { value: firstNavPoint(results), rowsRead: meta.rows_read ?? 0 };
}

export async function navHistoryPage(
  db: D1Database,
  fundId: string,
  from: string,
  to: string,
  afterDate: string | null,
  limit: number,
): Promise<ReadResult<NavPoint[]>> {
  const { results, meta } = await db
    .prepare(
      `SELECT nav_date, nav FROM nav_records
       WHERE fund_id = ?1 AND nav_date >= ?2 AND nav_date <= ?3 AND nav_date > ?4
       ORDER BY nav_date LIMIT ?5`,
    )
    .bind(fundId, from, to, afterDate ?? "", limit)
    .all<NavPointRecord>();
  return { value: results.map(toNavPoint), rowsRead: meta.rows_read ?? 0 };
}

export async function earliestNav(db: D1Database, fundId: string): Promise<ReadResult<NavPoint | null>> {
  const { results, meta } = await db
    .prepare("SELECT nav_date, nav FROM nav_records WHERE fund_id = ?1 ORDER BY nav_date LIMIT 1")
    .bind(fundId)
    .all<NavPointRecord>();
  return { value: firstNavPoint(results), rowsRead: meta.rows_read ?? 0 };
}

export type FundSummary = {
  fundId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string;
  cycleDays: number;
  status: FundStatus;
  latestNavDate: string | null;
  hasCycle: boolean;
};

type FundSummaryRecord = {
  fund_id: string;
  name_ar: string;
  name_en: string | null;
  manager: string | null;
  currency: string;
  cycle_days: number;
  status: FundStatus;
  latest_nav_date: string | null;
  nav_count: number;
};

export async function listFundSummaries(db: D1Database): Promise<FundSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT fund_id, name_ar, name_en, manager, currency, cycle_days, status,
              (SELECT MAX(nav_date) FROM nav_records WHERE nav_records.fund_id = funds.fund_id) AS latest_nav_date,
              (SELECT COUNT(*) FROM (SELECT 1 FROM nav_records WHERE nav_records.fund_id = funds.fund_id LIMIT ?1)) AS nav_count
       FROM funds ORDER BY fund_id`,
    )
    .bind(MIN_CYCLE_NAVS)
    .all<FundSummaryRecord>();
  return results.map((row) => ({
    fundId: row.fund_id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    manager: row.manager,
    currency: row.currency,
    cycleDays: row.cycle_days,
    status: row.status,
    latestNavDate: row.latest_nav_date,
    hasCycle: row.nav_count >= MIN_CYCLE_NAVS,
  }));
}
