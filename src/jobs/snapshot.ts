import { loadConfig } from "../config";
import {
  CAIRO_TIME_ZONE,
  cairoParts,
  isTradingDay,
  previousTradingDay,
  refreshWindow,
  sessionHours,
  sessionStatus,
  toMinutes,
  type CairoParts,
  type CalendarRow,
  type TimeRange,
} from "../domain/calendar";
import { INDEX_CODES } from "../domain/indices";
import { mubasherStocks } from "../providers/mubasher";
import { tradingViewIndices, tradingViewStocks } from "../providers/tradingview";
import type { ProviderIndex, ProviderQuote, StockQuoteProvider } from "../providers/types";
import { getCalendarRow, recentCalendar } from "../store/d1/calendar";
import { raiseNotices, type NewNotice } from "../store/d1/events";
import { getJobState, markJobRun } from "../store/d1/jobs";
import {
  getDirectory,
  getSnapshot,
  putLastSessionSnapshot,
  putSnapshotIfChanged,
  type Directory,
  type IndexEntry,
  type QuoteEntry,
  type Snapshot,
} from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";
import { LISTING_SYNC_STEP, syncListings } from "./listing-sync";
import { refreshMetalsFx } from "./metals-fx";

const JOB = "snapshot";
const BOOTSTRAP_JOB = "listing_bootstrap";
const STOCKS_STEP = "stocks";
const INDICES_STEP = "indices";
const NO_INDICES = "no indices returned";
const TOP_SIZE = 10;
const RETAIL_EVERY_MINUTES = 15;
const SKIPPED_OUTSIDE_WINDOW = "skipped: outside window";
const SKIPPED_OFF_CADENCE = "skipped: off cadence";
const NO_MAPPED_QUOTES = "no quotes mapped to a listed symbol";
const STALE_QUOTES = "every trade date is older than the previous trading day";
const NO_TRADES_GRACE_MINUTES = 30;
const TRADINGVIEW_DELAY_MINUTES = 15;
const DELAYED_LABEL = "delayed";

const STOCK_PROVIDERS: Record<string, StockQuoteProvider> = {
  tradingview: tradingViewStocks,
  mubasher: mubasherStocks,
};

type Quotes = Record<string, QuoteEntry>;
type Failure = { source: string; error: string };
type Served = { source: string; quotes: Quotes };
type Acquired = { served: Served | null; failures: Failure[] };
type Indices = Record<string, IndexEntry>;
type IndexFetch = { indices: Indices } | { error: string };
type Aggregates = Pick<Snapshot, "breadth" | "totals" | "top">;
type Fetched = { quotes: Quotes } | { error: string };
type BootstrapResult = { directory: Directory | null; notices: NewNotice[] };

function isInsideWindow(today: CairoParts, row: CalendarRow | null, window: TimeRange): boolean {
  if (!isTradingDay(today.date, row)) return false;
  return today.time >= window.start && today.time <= window.end;
}

function isOnCadence(env: Env, today: CairoParts, isWindowEnd: boolean): boolean {
  const { snapshotEveryMinutes } = loadConfig(env);
  if (snapshotEveryMinutes === 1) return true;
  return toMinutes(today.time) % snapshotEveryMinutes === 0 || isWindowEnd;
}

function resolveProviders(env: Env): StockQuoteProvider[] {
  return loadConfig(env).stockProviders.flatMap((id) => {
    const provider = STOCK_PROVIDERS[id];
    return provider === undefined ? [] : [provider];
  });
}

function toQuoteEntry(quote: ProviderQuote, source: string): QuoteEntry {
  return {
    t: quote.ticker,
    p: quote.last,
    o: quote.open,
    h: quote.high,
    l: quote.low,
    pc: quote.prevClose,
    ch: quote.change,
    chp: quote.changePct,
    v: quote.volume,
    val: quote.value,
    tt: quote.tradeTime,
    td: quote.tradeDate,
    src: source,
  };
}

function keyByIsin(quotes: ProviderQuote[], source: string, tickerToIsin: Record<string, string>): Quotes {
  const keyed: Quotes = {};
  for (const quote of quotes) {
    const isin = tickerToIsin[quote.ticker.toUpperCase()];
    if (isin !== undefined) keyed[isin] = toQuoteEntry(quote, source);
  }
  return keyed;
}

async function fetchQuotes(provider: StockQuoteProvider, tickerToIsin: Record<string, string>): Promise<Fetched> {
  try {
    const quotes = keyByIsin(await provider.fetchQuotes(), provider.id, tickerToIsin);
    return Object.keys(quotes).length === 0 ? { error: NO_MAPPED_QUOTES } : { quotes };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function newestTradeDate(quotes: Quotes): string {
  return Object.values(quotes).reduce((newest, quote) => (quote.td > newest ? quote.td : newest), "");
}

async function isStale(db: D1Database, quotes: Quotes, now: number): Promise<boolean> {
  const newest = newestTradeDate(quotes);
  const today = cairoParts(now).date;
  if (newest >= today) return false;
  const { holidays } = await recentCalendar(db, now);
  return newest < previousTradingDay(today, holidays);
}

async function acquireQuotes(
  env: Env,
  providers: StockQuoteProvider[],
  tickerToIsin: Record<string, string>,
  now: number,
): Promise<Acquired> {
  const failures: Failure[] = [];
  for (const provider of providers) {
    const fetched = await fetchQuotes(provider, tickerToIsin);
    if ("error" in fetched) {
      failures.push({ source: provider.id, error: fetched.error });
    } else if (await isStale(env.DB, fetched.quotes, now)) {
      failures.push({ source: provider.id, error: STALE_QUOTES });
    } else {
      return { served: { source: provider.id, quotes: fetched.quotes }, failures };
    }
  }
  return { served: null, failures };
}

function toIndexEntry(index: ProviderIndex): IndexEntry {
  return { v: index.value, chp: index.changePct, tt: index.tradeTime, src: tradingViewIndices.id };
}

function keyByCode(indices: ProviderIndex[]): Indices {
  const keyed: Indices = {};
  for (const code of INDEX_CODES) {
    const index = indices.find((candidate) => candidate.code === code);
    if (index !== undefined) keyed[code] = toIndexEntry(index);
  }
  return keyed;
}

async function fetchIndices(): Promise<IndexFetch> {
  try {
    const indices = keyByCode(await tradingViewIndices.fetchIndices([...INDEX_CODES]));
    return Object.keys(indices).length === 0 ? { error: NO_INDICES } : { indices };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function sessionQuotes(quotes: Quotes, date: string): [string, QuoteEntry][] {
  return Object.entries(quotes).filter(([, quote]) => quote.td === date);
}

function topIsins(entries: [string, QuoteEntry][], rank: (quote: QuoteEntry) => number | null): string[] {
  return entries
    .flatMap(([isin, quote]) => {
      const score = rank(quote);
      return score === null ? [] : [{ isin, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_SIZE)
    .map(({ isin }) => isin);
}

function negated(value: number | null): number | null {
  return value === null ? null : -value;
}

function aggregate(quotes: Quotes, date: string): Aggregates {
  const entries = sessionQuotes(quotes, date);
  const changes = entries.map(([, quote]) => quote.chp ?? 0);
  return {
    breadth: {
      advancers: changes.filter((change) => change > 0).length,
      decliners: changes.filter((change) => change < 0).length,
      unchanged: changes.filter((change) => change === 0).length,
    },
    totals: {
      volume: entries.reduce((sum, [, quote]) => sum + quote.v, 0),
      value: entries.reduce((sum, [, quote]) => sum + (quote.val ?? 0), 0),
    },
    top: {
      gainers: topIsins(entries, (quote) => quote.chp),
      losers: topIsins(entries, (quote) => negated(quote.chp)),
      byVolume: topIsins(entries, (quote) => quote.v),
      byValue: topIsins(entries, (quote) => quote.val),
    },
  };
}

function emptySnapshot(now: number): Snapshot {
  return {
    v: 1,
    generatedAt: now,
    session: { date: "", status: "closed", tz: CAIRO_TIME_ZONE, opensAt: "", closesAt: "", noTradesToday: false },
    delay: { label: DELAYED_LABEL, minutes: null },
    sources: { stocks: "", primaryFailed: false },
    quotes: {},
    indices: {},
    fx: {},
    metals: {},
    breadth: { advancers: 0, decliners: 0, unchanged: 0 },
    totals: { volume: 0, value: 0 },
    top: { gainers: [], losers: [], byVolume: [], byValue: [] },
  };
}

function hasNoTrades(quotes: Quotes, today: CairoParts, row: CalendarRow | null): boolean {
  const threshold = toMinutes(sessionHours(row).start) + NO_TRADES_GRACE_MINUTES;
  if (toMinutes(today.time) < threshold) return false;
  return !Object.values(quotes).some((quote) => quote.td === today.date);
}

function buildSession(quotes: Quotes, today: CairoParts, row: CalendarRow | null, now: number): Snapshot["session"] {
  const hours = sessionHours(row);
  const noTradesToday = hasNoTrades(quotes, today, row);
  return {
    date: today.date,
    status: noTradesToday ? "closed" : sessionStatus(now, row),
    tz: CAIRO_TIME_ZONE,
    opensAt: hours.start,
    closesAt: hours.end,
    noTradesToday,
  };
}

function buildSources(served: Served, failures: Failure[]): Snapshot["sources"] {
  const primary = failures[0];
  if (primary === undefined) return { stocks: served.source, primaryFailed: false };
  return { stocks: served.source, primaryFailed: true, primaryError: primary.error };
}

function buildDelay(source: string): Snapshot["delay"] {
  const isTradingView = source === tradingViewStocks.id;
  return { label: DELAYED_LABEL, minutes: isTradingView ? TRADINGVIEW_DELAY_MINUTES : null };
}

function buildSnapshot(
  previous: Snapshot | null,
  served: Served,
  failures: Failure[],
  fetchedIndices: IndexFetch,
  today: CairoParts,
  row: CalendarRow | null,
  now: number,
): Snapshot {
  const quotes = { ...previous?.quotes, ...served.quotes };
  const indices = "indices" in fetchedIndices ? { ...previous?.indices, ...fetchedIndices.indices } : (previous?.indices ?? {});
  return {
    ...(previous ?? emptySnapshot(now)),
    generatedAt: now,
    session: buildSession(quotes, today, row, now),
    delay: buildDelay(served.source),
    sources: buildSources(served, failures),
    quotes,
    indices,
    ...aggregate(quotes, today.date),
  };
}

function switchNotices({ served, failures }: Acquired, now: number): NewNotice[] {
  if (served === null || failures.length === 0) return [];
  return [
    {
      kind: "source_switched",
      subject: `${JOB}:${STOCKS_STEP}`,
      details: { job: JOB, step: STOCKS_STEP, source: served.source, time: now, error: failures[0]?.error },
      at: now,
    },
  ];
}

function indexNotices(fetched: IndexFetch, now: number): NewNotice[] {
  if ("indices" in fetched) return [];
  return [jobFailedNotice(JOB, INDICES_STEP, tradingViewIndices.id, fetched.error, now)];
}

function collectNotices(acquired: Acquired, fetchedIndices: IndexFetch, now: number): NewNotice[] {
  return [
    ...acquired.failures.map((failure) => jobFailedNotice(JOB, STOCKS_STEP, failure.source, failure.error, now)),
    ...switchNotices(acquired, now),
    ...indexNotices(fetchedIndices, now),
  ];
}

async function fetchMarket(
  env: Env,
  tickerToIsin: Record<string, string>,
  now: number,
): Promise<{ acquired: Acquired; fetchedIndices: IndexFetch }> {
  const [stocks, indices] = await Promise.allSettled([
    acquireQuotes(env, resolveProviders(env), tickerToIsin, now),
    fetchIndices(),
  ]);
  if (stocks.status === "rejected") throw stocks.reason;
  if (indices.status === "rejected") throw indices.reason;
  return { acquired: stocks.value, fetchedIndices: indices.value };
}

function isRetailMinute(today: CairoParts): boolean {
  return toMinutes(today.time) % RETAIL_EVERY_MINUTES === 0;
}

async function persist(env: Env, next: Snapshot, isWindowEnd: boolean): Promise<void> {
  await putSnapshotIfChanged(env, next);
  if (isWindowEnd && !next.session.noTradesToday) await putLastSessionSnapshot(env, next);
}

async function ensureDirectory(env: Env, today: CairoParts, now: number): Promise<BootstrapResult> {
  const directory = await getDirectory(env);
  if (directory !== null) return { directory, notices: [] };
  if ((await getJobState(env.DB, BOOTSTRAP_JOB))?.lastRunDate === today.date) return { directory: null, notices: [] };
  await markJobRun(env.DB, BOOTSTRAP_JOB, today.date);
  try {
    const { directory: synced, notices } = await syncListings(env, now, BOOTSTRAP_JOB);
    return { directory: synced, notices };
  } catch (error) {
    return {
      directory: null,
      notices: [jobFailedNotice(BOOTSTRAP_JOB, LISTING_SYNC_STEP, "", errorMessage(error), now)],
    };
  }
}

async function skipRun(env: Env, notices: NewNotice[], reason: string): Promise<string> {
  await raiseNotices(env.DB, notices);
  return reason;
}

export async function snapshotJob(env: Env, now: number): Promise<string | undefined> {
  const today = cairoParts(now);
  const { directory, notices: bootstrapNotices } = await ensureDirectory(env, today, now);
  const row = await getCalendarRow(env.DB, today.date);
  const window = refreshWindow(row);
  const isWindowEnd = today.time === window.end;
  if (!isInsideWindow(today, row, window)) return skipRun(env, bootstrapNotices, SKIPPED_OUTSIDE_WINDOW);
  if (!isOnCadence(env, today, isWindowEnd)) return skipRun(env, bootstrapNotices, SKIPPED_OFF_CADENCE);
  const previous = await getSnapshot(env);
  const [{ acquired, fetchedIndices }, metalsFx] = await Promise.all([
    fetchMarket(env, directory?.tickerToIsin ?? {}, now),
    refreshMetalsFx(JOB, previous ?? emptySnapshot(now), now, isRetailMinute(today)),
  ]);
  const { fx, metals } = metalsFx;
  if (acquired.served !== null) {
    const built = buildSnapshot(previous, acquired.served, acquired.failures, fetchedIndices, today, row, now);
    await persist(env, { ...built, fx, metals }, isWindowEnd);
  } else if (previous !== null) {
    await putSnapshotIfChanged(env, { ...previous, fx, metals });
  }
  await raiseNotices(env.DB, [...bootstrapNotices, ...collectNotices(acquired, fetchedIndices, now), ...metalsFx.notices]);
  return undefined;
}
