import { cairoParts } from "../domain/calendar";
import { fetchJson } from "./http";
import {
  ProviderError,
  type DailyClose,
  type ListingProvider,
  type ProviderListing,
  type ProviderQuote,
  type StockQuoteProvider,
} from "./types";
import { asString, isPresent } from "./values";

const PROVIDER_ID = "mubasher";
const PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all?country=eg";
const LISTED_URL = "https://www.mubasher.info/api/1/listed-companies?country=eg";
const MAX_LISTING_PAGES = 18;
const FIRST_PAGE = 1;
const LISTING_MARKET = "main";
const MS_PER_SECOND = 1000;
const NUMBER_NOISE = /[,%]/g;

type Row = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asString(value)?.replace(NUMBER_NOISE, "");
  if (text === undefined || text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRows(value: unknown, field: string): Row[] {
  if (!Array.isArray(value)) throw new ProviderError(PROVIDER_ID, "parse", `response has no ${field} array`);
  return value.filter((entry): entry is Row => typeof entry === "object" && entry !== null);
}

function parseUtcSeconds(value: unknown): number | null {
  const text = asString(value);
  if (text === null) return null;
  const milliseconds = Date.parse(`${text.replace(" ", "T")}Z`);
  return Number.isNaN(milliseconds) ? null : milliseconds / MS_PER_SECOND;
}

function toQuote(row: Row): ProviderQuote | null {
  const ticker = asString(row.code);
  const last = asNumber(row.value);
  const tradeTime = parseUtcSeconds(row.updatedAt);
  if (ticker === null || last === null || tradeTime === null) return null;
  const change = asNumber(row.change);
  return {
    ticker,
    isin: null,
    last,
    open: asNumber(row.open),
    high: asNumber(row.high),
    low: asNumber(row.low),
    prevClose: change === null ? null : last - change,
    change,
    changePct: asNumber(row.changePercentage),
    volume: asNumber(row.volume) ?? 0,
    value: asNumber(row.turnover),
    tradeTime,
    tradeDate: cairoParts(tradeTime).date,
  };
}

function toListing(row: Row): ProviderListing | null {
  const ticker = asString(row.symbol);
  if (ticker === null) return null;
  return {
    ticker,
    isin: null,
    nameAr: asString(row.name),
    nameEn: null,
    sector: asString(row.sector),
    market: LISTING_MARKET,
    sharesOutstanding: null,
    freeFloatShares: null,
  };
}

async function fetchListingPage(page: number): Promise<{ rows: Row[]; pageCount: number }> {
  const body = (await fetchJson(PROVIDER_ID, `${LISTED_URL}&page=${page}`)) as {
    rows?: unknown;
    numberOfPages?: unknown;
  } | null;
  return { rows: asRows(body?.rows, "rows"), pageCount: asNumber(body?.numberOfPages) ?? FIRST_PAGE };
}

async function fetchPriceRows(): Promise<Row[]> {
  const body = (await fetchJson(PROVIDER_ID, PRICES_URL)) as { prices?: unknown } | null;
  const rows = asRows(body?.prices, "prices");
  if (rows.length === 0) throw new ProviderError(PROVIDER_ID, "empty", "response has no prices");
  return rows;
}

function toDailyClose(row: Row): [string, DailyClose] | null {
  const quote = toQuote(row);
  return quote === null ? null : [quote.ticker, { close: quote.last, tradeDate: quote.tradeDate }];
}

export const mubasherStocks: StockQuoteProvider = {
  id: PROVIDER_ID,
  async fetchQuotes() {
    return (await fetchPriceRows()).map(toQuote).filter(isPresent);
  },
};

export async function mubasherDailyCloses(): Promise<Map<string, DailyClose>> {
  return new Map((await fetchPriceRows()).map(toDailyClose).filter(isPresent));
}

export const mubasherListings: ListingProvider = {
  id: PROVIDER_ID,
  async fetchListings() {
    const first = await fetchListingPage(FIRST_PAGE);
    if (first.rows.length === 0) throw new ProviderError(PROVIDER_ID, "empty", "response has no listings");
    const rows = [...first.rows];
    const lastPage = Math.min(first.pageCount, MAX_LISTING_PAGES);
    for (let page = FIRST_PAGE + 1; page <= lastPage; page += 1) {
      rows.push(...(await fetchListingPage(page)).rows);
    }
    return rows.map(toListing).filter(isPresent);
  },
};
