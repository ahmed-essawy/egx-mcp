import { cairoParts } from "../domain/calendar";
import { TRADINGVIEW_INDEX_TICKERS } from "../domain/indices";
import { fetchJson } from "./http";
import {
  ProviderError,
  type IndexProvider,
  type ListingProvider,
  type ProviderIndex,
  type ProviderListing,
  type ProviderQuote,
  type StockQuoteProvider,
} from "./types";
import { asString, isPresent } from "./values";

const PROVIDER_ID = "tradingview";
const SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const INDEX_SCAN_URL = "https://scanner.tradingview.com/global/scan";
const INDEX_COLUMNS = ["name", "close", "change", "update_time"];
const SCAN_RANGE = [0, 400];
const STOCK_TYPE = "stock";
const LISTING_MARKET = "main";

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
] as const;

type Column = (typeof COLUMNS)[number];
type ScanRow = Record<Column, unknown>;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

async function fetchScan(): Promise<ScanRow[]> {
  const body = await fetchJson(PROVIDER_ID, SCAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ columns: COLUMNS, range: SCAN_RANGE }),
  });
  return parseRows(body);
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
    value: asNumber(row["Value.Traded"]),
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
