import { cairoParts } from "../domain/calendar";
import type { FigureMetricName } from "../domain/figures";
import { TRADINGVIEW_INDEX_TICKERS } from "../domain/indices";
import { fetchJson } from "./http";
import {
  ProviderError,
  type DailyClose,
  type FxProvider,
  type GlobalMetalsProvider,
  type FundamentalsProvider,
  type IndexProvider,
  type ListingProvider,
  type ProviderFigure,
  type ProviderFundamentals,
  type ProviderIndex,
  type ProviderListing,
  type ProviderQuote,
  type SpotPrice,
  type StockQuoteProvider,
} from "./types";
import { asString, isPresent } from "./values";

const PROVIDER_ID = "tradingview";
const SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const INDEX_SCAN_URL = "https://scanner.tradingview.com/global/scan";
const INDEX_COLUMNS = ["name", "close", "change", "last_bar_update_time"];
const FX_METALS_TICKERS = ["FX_IDC:USDEGP", "TVC:GOLD", "TVC:SILVER"];
const FX_METALS_COLUMNS = ["name", "close", "update_time"];
const USD_EGP_NAME = "USDEGP";
const GOLD_NAME = "GOLD";
const SILVER_NAME = "SILVER";
export const EMPTY_USD_EGP = "scan response has no USDEGP row";
export const EMPTY_SPOT = "scan response has no spot metal rows";
const CLOSE_COLUMNS = ["name", "close", "time", "type"];
const FUNDAMENTALS_COLUMNS = [
  "name",
  "isin",
  "total_revenue_fy",
  "net_income_fy",
  "total_equity_fq",
  "total_debt_fq",
  "earnings_per_share_basic_ttm",
  "dps_common_stock_prim_issue_fy",
  "dividend_amount_recent",
  "ex_dividend_date_recent",
  "ex_dividend_date_upcoming",
  "fiscal_period_end",
  "currency",
  "fundamental_currency_code",
] as const;
const FIGURE_METRICS: readonly { column: FundamentalsColumn; metric: FigureMetricName; periodType: string }[] = [
  { column: "total_revenue_fy", metric: "revenue", periodType: "FY" },
  { column: "net_income_fy", metric: "net_income", periodType: "FY" },
  { column: "total_equity_fq", metric: "total_equity", periodType: "FQ" },
  { column: "total_debt_fq", metric: "total_debt", periodType: "FQ" },
  { column: "earnings_per_share_basic_ttm", metric: "eps_basic", periodType: "TTM" },
  { column: "dps_common_stock_prim_issue_fy", metric: "dps", periodType: "FY" },
];
const FISCAL_YEAR_PERIOD = "FY";
const SCAN_RANGE = [0, 400];
const STOCK_TYPE = "stock";
const LISTING_MARKET = "main";
const LISTING_CURRENCY = "EGP";

const COLUMNS = [
  "name",
  "description",
  "isin",
  "sector",
  "close",
  "open",
  "high",
  "low",
  "change",
  "change_abs",
  "volume",
  "Value.Traded",
  "time",
  "update_time",
  "type",
  "total_shares_outstanding",
  "float_shares_outstanding",
  "currency",
] as const;

type Column = (typeof COLUMNS)[number];
type ScanRow = Record<Column, unknown>;
type FundamentalsColumn = (typeof FUNDAMENTALS_COLUMNS)[number];
type FundamentalsRow = Record<FundamentalsColumn, unknown>;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tradedValue(row: ScanRow): number | null {
  const currency = asString(row.currency);
  if (currency !== null && currency !== LISTING_CURRENCY) return null;
  return asNumber(row["Value.Traded"]);
}

function toScanRow(values: unknown[]): ScanRow {
  return Object.fromEntries(COLUMNS.map((column, index) => [column, values[index]])) as ScanRow;
}

function scanRows(body: unknown): unknown[][] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new ProviderError(PROVIDER_ID, "parse", "scan response has no data array");
  if (data.length === 0) throw new ProviderError(PROVIDER_ID, "empty", "scan response has no rows");
  return data
    .map((entry) => (entry as { d?: unknown } | null)?.d)
    .filter((values): values is unknown[] => Array.isArray(values));
}

function parseRows(body: unknown): ScanRow[] {
  return scanRows(body)
    .map(toScanRow)
    .filter((row) => row.type === STOCK_TYPE);
}

async function postScan(columns: readonly string[]): Promise<unknown> {
  return fetchJson(PROVIDER_ID, SCAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ columns, range: SCAN_RANGE }),
  });
}

async function fetchScan(): Promise<ScanRow[]> {
  return parseRows(await postScan(COLUMNS));
}

function toDailyClose(values: unknown[]): [string, DailyClose] | null {
  const [name, close, time, type] = values;
  const ticker = asString(name);
  const last = asNumber(close);
  const seconds = asNumber(time);
  if (type !== STOCK_TYPE || ticker === null || last === null || seconds === null) return null;
  return [ticker, { close: last, tradeDate: cairoParts(seconds).date }];
}

function toQuote(row: ScanRow): ProviderQuote | null {
  const ticker = asString(row.name);
  const last = asNumber(row.close);
  const tradeTime = asNumber(row.update_time);
  const time = asNumber(row.time);
  if (ticker === null || last === null || tradeTime === null || time === null) return null;
  const changeAbs = asNumber(row.change_abs);
  return {
    ticker,
    isin: asString(row.isin),
    last,
    open: asNumber(row.open),
    high: asNumber(row.high),
    low: asNumber(row.low),
    prevClose: changeAbs === null ? null : last - changeAbs,
    change: changeAbs,
    changePct: asNumber(row.change),
    volume: asNumber(row.volume) ?? 0,
    value: tradedValue(row),
    tradeTime,
    tradeDate: cairoParts(time).date,
  };
}

function toListing(row: ScanRow): ProviderListing | null {
  const ticker = asString(row.name);
  if (ticker === null) return null;
  return {
    ticker,
    isin: asString(row.isin),
    nameAr: null,
    nameEn: asString(row.description),
    sector: asString(row.sector),
    market: LISTING_MARKET,
    sharesOutstanding: asNumber(row.total_shares_outstanding),
    freeFloatShares: asNumber(row.float_shares_outstanding),
  };
}

export const tradingViewStocks: StockQuoteProvider & ListingProvider = {
  id: PROVIDER_ID,
  async fetchQuotes() {
    return (await fetchScan()).map(toQuote).filter(isPresent);
  },
  async fetchListings() {
    return (await fetchScan()).map(toListing).filter(isPresent);
  },
};

export async function tradingViewDailyCloses(): Promise<Map<string, DailyClose>> {
  const body = await postScan(CLOSE_COLUMNS);
  return new Map(scanRows(body).map(toDailyClose).filter(isPresent));
}

function toIndex(values: unknown[], wanted: ReadonlySet<string>): ProviderIndex | null {
  const [name, close, change, updateTime] = values;
  const code = asString(name);
  const value = asNumber(close);
  const tradeTime = asNumber(updateTime);
  if (code === null || !wanted.has(code) || value === null || tradeTime === null) return null;
  return { code, value, changePct: asNumber(change), tradeTime };
}

export const tradingViewIndices: IndexProvider = {
  id: PROVIDER_ID,
  async fetchIndices(codes) {
    const body = await fetchJson(PROVIDER_ID, INDEX_SCAN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbols: { tickers: TRADINGVIEW_INDEX_TICKERS }, columns: INDEX_COLUMNS }),
    });
    const wanted = new Set(codes);
    return scanRows(body)
      .map((values) => toIndex(values, wanted))
      .filter(isPresent);
  },
};

async function fetchFxMetalsScan(): Promise<Map<string, SpotPrice>> {
  const body = await fetchJson(PROVIDER_ID, INDEX_SCAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: { tickers: FX_METALS_TICKERS }, columns: FX_METALS_COLUMNS }),
  });
  const points = new Map<string, SpotPrice>();
  for (const [name, close, updateTime] of scanRows(body)) {
    const code = asString(name);
    const value = asNumber(close);
    const tradeTime = asNumber(updateTime);
    if (code !== null && value !== null && tradeTime !== null) points.set(code, { value, tradeTime });
  }
  return points;
}

export interface FxMetals {
  usdEgp: Awaited<ReturnType<FxProvider["fetchUsdEgp"]>> | null;
  spot: Awaited<ReturnType<GlobalMetalsProvider["fetchSpot"]>>;
}

export async function fetchFxMetals(): Promise<FxMetals> {
  const points = await fetchFxMetalsScan();
  const usdEgp = points.get(USD_EGP_NAME);
  return {
    usdEgp: usdEgp === undefined ? null : { rate: usdEgp.value, tradeTime: usdEgp.tradeTime, kind: "market" },
    spot: { XAUUSD: points.get(GOLD_NAME) ?? null, XAGUSD: points.get(SILVER_NAME) ?? null },
  };
}

export const tradingViewFxMetals: FxProvider & GlobalMetalsProvider = {
  id: PROVIDER_ID,
  async fetchUsdEgp() {
    const { usdEgp } = await fetchFxMetals();
    if (usdEgp === null) throw new ProviderError(PROVIDER_ID, "empty", EMPTY_USD_EGP);
    return usdEgp;
  },
  async fetchSpot() {
    const { spot } = await fetchFxMetals();
    if (spot.XAUUSD === null && spot.XAGUSD === null) throw new ProviderError(PROVIDER_ID, "empty", EMPTY_SPOT);
    return spot;
  },
};

function toFundamentalsRow(values: unknown[]): FundamentalsRow {
  return Object.fromEntries(FUNDAMENTALS_COLUMNS.map((column, index) => [column, values[index]])) as FundamentalsRow;
}

function cairoDate(seconds: unknown): string | null {
  const value = asNumber(seconds);
  return value === null ? null : cairoParts(value).date;
}

function toFigures(row: FundamentalsRow, currency: string): ProviderFigure[] {
  const latestPeriodEnd = cairoDate(row.fiscal_period_end);
  return FIGURE_METRICS.flatMap(({ column, metric, periodType }) => {
    const value = asNumber(row[column]);
    const periodEnd = periodType === FISCAL_YEAR_PERIOD ? null : latestPeriodEnd;
    return value === null ? [] : [{ metric, periodType, periodEnd, value, currency }];
  });
}

function toFundamentals(row: FundamentalsRow): ProviderFundamentals | null {
  const ticker = asString(row.name);
  if (ticker === null) return null;
  const quoteCurrency = asString(row.currency) ?? LISTING_CURRENCY;
  const currency = asString(row.fundamental_currency_code) ?? quoteCurrency;
  return {
    ticker,
    isin: asString(row.isin),
    quoteCurrency,
    figures: toFigures(row, currency),
    dividend: {
      recentAmount: asNumber(row.dividend_amount_recent),
      recentExDate: cairoDate(row.ex_dividend_date_recent),
      upcomingExDate: cairoDate(row.ex_dividend_date_upcoming),
      currency,
    },
  };
}

export const tradingViewFundamentals: FundamentalsProvider = {
  id: PROVIDER_ID,
  async fetchFundamentals() {
    const body = await fetchJson(PROVIDER_ID, SCAN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ columns: FUNDAMENTALS_COLUMNS, range: SCAN_RANGE }),
    });
    return scanRows(body).map(toFundamentalsRow).map(toFundamentals).filter(isPresent);
  },
};
