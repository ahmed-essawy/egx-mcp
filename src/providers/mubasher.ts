import { cairoParts } from "../domain/calendar";
import { fetchJson } from "./http";
import {
  ProviderError,
  type DailyClose,
  type FundFetch,
  type CorporateActionProvider,
  type FundNavProvider,
  type ListingProvider,
  type ProviderFund,
  type ProviderListing,
  type ProviderQuote,
  type StockQuoteProvider,
} from "./types";
import {
  mapMubasherActionKind,
  parseArabicDate,
  parseMubasherActionRow,
  type Row,
} from "./mubasher-parse";
import { asString, isPresent } from "./values";

export { mapMubasherActionKind, parseArabicDate, parseMubasherActionRow };

const PROVIDER_ID = "mubasher";
const PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all?country=eg";
const LISTED_URL = "https://www.mubasher.info/api/1/listed-companies?country=eg";
const MAX_LISTING_PAGES = 18;
const FIRST_PAGE = 1;
const LISTING_MARKET = "main";
const FUNDS_URL = "https://www.mubasher.info/api/1/funds?country=eg";
const MAX_FUND_PAGES = 13;
const FUND_SOURCE_PREFIX = "mubasher:";
const ACTIONS_URL = "https://www.mubasher.info/api/1/corporate-actions?country=eg";
const FUND_CURRENCIES: ReadonlyArray<readonly [string, string]> = [
  ["جنيه", "EGP"],
  ["دولار", "USD"],
];
const MS_PER_SECOND = 1000;
const NUMBER_NOISE = /[,%]/g;

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

function toFundCurrency(value: unknown): string | null {
  const text = asString(value);
  if (text === null) return null;
  return FUND_CURRENCIES.find(([marker]) => text.includes(marker))?.[1] ?? null;
}

function toFundManager(row: Row): string | null {
  const managers = Array.isArray(row.managers) ? row.managers : [];
  return asString(managers[0]) ?? asString(row.owner);
}

function toFund(row: Row): ProviderFund | null {
  const fundId = asNumber(row.fundId);
  const nameAr = asString(row.name);
  const nav = asNumber(row.price);
  const dateText = asString(row.date);
  const navDate = dateText === null ? null : parseArabicDate(dateText);
  if (fundId === null || nameAr === null || nav === null || nav <= 0 || navDate === null) return null;
  return {
    sourceId: `${FUND_SOURCE_PREFIX}${fundId}`,
    nameAr,
    nameEn: null,
    manager: toFundManager(row),
    currency: toFundCurrency(row.currency),
    category: asString(row.classification),
    nav,
    navDate,
  };
}

async function fetchPagedRows(url: string, page: number): Promise<{ rows: Row[]; pageCount: number }> {
  const body = (await fetchJson(PROVIDER_ID, `${url}&page=${page}`)) as {
    rows?: unknown;
    numberOfPages?: unknown;
  } | null;
  return { rows: asRows(body?.rows, "rows"), pageCount: asNumber(body?.numberOfPages) ?? FIRST_PAGE };
}

async function fetchLaterFundPages(lastPage: number): Promise<{ rows: Row[]; failedPages: number[] }> {
  const rows: Row[] = [];
  const failedPages: number[] = [];
  for (let page = FIRST_PAGE + 1; page <= lastPage; page += 1) {
    try {
      rows.push(...(await fetchPagedRows(FUNDS_URL, page)).rows);
    } catch {
      failedPages.push(page);
    }
  }
  return { rows, failedPages };
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

async function fetchActionRows(page: number): Promise<Row[]> {
  const body = (await fetchJson(PROVIDER_ID, `${ACTIONS_URL}&page=${page}`)) as { rows?: unknown } | null;
  return asRows(body?.rows, "rows");
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
    const first = await fetchPagedRows(LISTED_URL, FIRST_PAGE);
    if (first.rows.length === 0) throw new ProviderError(PROVIDER_ID, "empty", "response has no listings");
    const rows = [...first.rows];
    const lastPage = Math.min(first.pageCount, MAX_LISTING_PAGES);
    for (let page = FIRST_PAGE + 1; page <= lastPage; page += 1) {
      rows.push(...(await fetchPagedRows(LISTED_URL, page)).rows);
    }
    return rows.map(toListing).filter(isPresent);
  },
};

export const mubasherFunds: FundNavProvider = {
  id: PROVIDER_ID,
  async fetchFunds(): Promise<FundFetch> {
    const first = await fetchPagedRows(FUNDS_URL, FIRST_PAGE);
    if (first.rows.length === 0) throw new ProviderError(PROVIDER_ID, "empty", "response has no funds");
    const later = await fetchLaterFundPages(Math.min(first.pageCount, MAX_FUND_PAGES));
    return {
      funds: [...first.rows, ...later.rows].map(toFund).filter(isPresent),
      failedPages: later.failedPages,
    };
  },
};

export const mubasherActions: CorporateActionProvider = {
  id: PROVIDER_ID,
  async fetchActions(pages) {
    const rows: Row[] = [];
    for (let page = FIRST_PAGE; page <= pages; page += 1) {
      rows.push(...(await fetchActionRows(page)));
    }
    return rows.map(parseMubasherActionRow).filter(isPresent);
  },
};
