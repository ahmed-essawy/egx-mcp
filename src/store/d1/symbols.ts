import type { SymbolStatus } from "../kv";
import type { WriteResult } from "./users";

export type ListingRow = {
  isin: string;
  ticker: string;
  nameAr: string | null;
  nameEn: string | null;
  sector: string | null;
  status: SymbolStatus;
  sharesOutstanding: number | null;
  freeFloatShares: number | null;
};

export type AliasKind = "ticker" | "name_ar" | "name_en" | "provider";

export type AliasRow = { isin: string; kind: AliasKind; value: string; provider: string | null };

export type DirectoryRow = {
  isin: string;
  ticker: string;
  nameAr: string | null;
  nameEn: string | null;
  sector: string | null;
  status: SymbolStatus;
  aliases: string[];
};

export type SymbolProfile = {
  isin: string;
  ticker: string;
  nameAr: string | null;
  nameEn: string | null;
  sector: string | null;
  market: "main" | "nilex";
  indexCodes: string[];
  status: SymbolStatus;
  sharesOutstanding: number | null;
  freeFloatShares: number | null;
  firstTradeDate: string | null;
  adjBasisDate: string | null;
  backfillState: "loading" | "done" | null;
  missingSessions: number;
  createdAt: number;
  updatedAt: number;
};

type DirectoryRowRecord = {
  isin: string;
  ticker: string;
  name_ar: string | null;
  name_en: string | null;
  sector: string | null;
  status: SymbolStatus;
  aliases: string | null;
};

type SymbolProfileRecord = {
  isin: string;
  ticker: string;
  name_ar: string | null;
  name_en: string | null;
  sector: string | null;
  market: "main" | "nilex";
  index_codes: string;
  status: SymbolStatus;
  shares_outstanding: number | null;
  free_float_shares: number | null;
  first_trade_date: string | null;
  adj_basis_date: string | null;
  backfill_state: "loading" | "done" | null;
  missing_sessions: number;
  created_at: number;
  updated_at: number;
};

const ALIAS_REFRESH_SECONDS = 7 * 24 * 60 * 60;

export async function upsertListings(db: D1Database, rows: ListingRow[], now: number): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const records = rows.map((row) => ({
    isin: row.isin,
    ticker: row.ticker,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    sector: row.sector,
    status: row.status,
    shares_outstanding: row.sharesOutstanding,
    free_float_shares: row.freeFloatShares,
  }));
  const { meta } = await db
    .prepare(
      `INSERT INTO symbols (isin, ticker, name_ar, name_en, sector, status, shares_outstanding, free_float_shares, created_at, updated_at)
       SELECT json_extract(value, '$.isin'), json_extract(value, '$.ticker'), json_extract(value, '$.name_ar'),
              json_extract(value, '$.name_en'), json_extract(value, '$.sector'), json_extract(value, '$.status'),
              json_extract(value, '$.shares_outstanding'), json_extract(value, '$.free_float_shares'), ?2, ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (isin) DO UPDATE SET ticker = excluded.ticker,
         name_ar = COALESCE(excluded.name_ar, symbols.name_ar),
         name_en = COALESCE(excluded.name_en, symbols.name_en),
         sector = COALESCE(excluded.sector, symbols.sector),
         shares_outstanding = COALESCE(excluded.shares_outstanding, symbols.shares_outstanding),
         free_float_shares = COALESCE(excluded.free_float_shares, symbols.free_float_shares),
         updated_at = excluded.updated_at
       WHERE symbols.ticker IS NOT excluded.ticker
         OR symbols.name_ar IS NOT COALESCE(excluded.name_ar, symbols.name_ar)
         OR symbols.name_en IS NOT COALESCE(excluded.name_en, symbols.name_en)
         OR symbols.sector IS NOT COALESCE(excluded.sector, symbols.sector)
         OR symbols.shares_outstanding IS NOT COALESCE(excluded.shares_outstanding, symbols.shares_outstanding)
         OR symbols.free_float_shares IS NOT COALESCE(excluded.free_float_shares, symbols.free_float_shares)`,
    )
    .bind(JSON.stringify(records), now)
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function upsertAliases(db: D1Database, rows: AliasRow[], now: number): Promise<WriteResult> {
  if (rows.length === 0) return { rowsWritten: 0 };
  const { meta } = await db
    .prepare(
      `INSERT INTO symbol_aliases (isin, kind, value, provider, first_seen, last_seen)
       SELECT json_extract(value, '$.isin'), json_extract(value, '$.kind'), json_extract(value, '$.value'),
              json_extract(value, '$.provider'), ?2, ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (isin, kind, value) DO UPDATE SET last_seen = excluded.last_seen
       WHERE symbol_aliases.last_seen < excluded.last_seen - ?3`,
    )
    .bind(JSON.stringify(rows), now, ALIAS_REFRESH_SECONDS)
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function countSymbols(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM symbols").first<{ total: number }>();
  return row?.total ?? 0;
}

export async function listDirectoryRows(db: D1Database): Promise<DirectoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.isin, s.ticker, s.name_ar, s.name_en, s.sector, s.status,
              json_group_array(a.value) FILTER (WHERE a.value IS NOT NULL) AS aliases
       FROM symbols s
       LEFT JOIN symbol_aliases a ON a.isin = s.isin AND a.kind IN ('ticker', 'name_ar', 'name_en')
       GROUP BY s.isin ORDER BY s.isin`,
    )
    .all<DirectoryRowRecord>();
  return results.map((row) => ({
    isin: row.isin,
    ticker: row.ticker,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    sector: row.sector,
    status: row.status,
    aliases: row.aliases === null ? [] : (JSON.parse(row.aliases) as string[]),
  }));
}

export async function aliasMap(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db
    .prepare("SELECT upper(value) AS alias, isin FROM symbol_aliases WHERE kind IN ('ticker', 'provider') ORDER BY isin")
    .all<{ alias: string; isin: string }>();
  return Object.fromEntries(results.map((row) => [row.alias, row.isin]));
}

export async function setStatus(
  db: D1Database,
  isins: string[],
  status: SymbolStatus,
  now: number,
): Promise<WriteResult> {
  if (isins.length === 0) return { rowsWritten: 0 };
  const { meta } = await db
    .prepare(
      "UPDATE symbols SET status = ?1, updated_at = ?2 WHERE status != ?1 AND isin IN (SELECT value FROM json_each(?3))",
    )
    .bind(status, now, JSON.stringify(isins))
    .run();
  return { rowsWritten: meta.rows_written };
}

export async function getProfile(db: D1Database, isin: string): Promise<SymbolProfile | null> {
  const row = await db
    .prepare(
      `SELECT isin, ticker, name_ar, name_en, sector, market, index_codes, status, shares_outstanding,
              free_float_shares, first_trade_date, adj_basis_date, backfill_state, missing_sessions,
              created_at, updated_at
       FROM symbols WHERE isin = ?1`,
    )
    .bind(isin)
    .first<SymbolProfileRecord>();
  if (!row) return null;
  return {
    isin: row.isin,
    ticker: row.ticker,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    sector: row.sector,
    market: row.market,
    indexCodes: JSON.parse(row.index_codes) as string[],
    status: row.status,
    sharesOutstanding: row.shares_outstanding,
    freeFloatShares: row.free_float_shares,
    firstTradeDate: row.first_trade_date,
    adjBasisDate: row.adj_basis_date,
    backfillState: row.backfill_state,
    missingSessions: row.missing_sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
