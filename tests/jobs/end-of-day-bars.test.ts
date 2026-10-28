import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfDayJob } from "../../src/jobs/end-of-day";
import type { NewIndexValue } from "../../src/store/d1/bars";
import type { QuoteEntry, Snapshot, Stats } from "../../src/store/kv";
import { restoreBindings, setBindings } from "../helpers/bindings";
import {
  bindMember,
  clearStores,
  createJobRunner,
  failingUpstream,
  firstPageOnly,
  fixtureResponse,
  notFound,
  readLastRunDate,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { Upstream } from "../helpers/jobs";
import { MARKET_ISINS, MARKET_TRADE_TIME, indexEntry, marketSnapshot } from "../helpers/market";
import {
  LAST_SESSION_KEY,
  SNAPSHOT_KEY,
  defaultSnapshot,
  seedBars,
  seedCalendar,
  seedLastSessionSnapshot,
  seedSnapshot,
  syntheticIsin,
  syntheticTicker,
} from "../helpers/seed";
import type { BarRow } from "../helpers/seed";
import mubasherListed from "../fixtures/mubasher-listed-p1.json";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";

const TODAY = "2026-10-25";
const NEXT_DAY = "2026-10-26";
const FRIDAY = "2026-10-23";
const WEDNESDAY = "2026-10-21";
const THURSDAY = "2026-10-22";
const FAR_EX_DATE = "2026-10-30";
const RUN_TIME = "15:30";
const LATER_RUN_TIME = "16:31";
const SECOND_CRON_RUN_TIME = "16:30";
const EOD_BARS_JOB = "eod_bars";
const BARS_STEP = "bars";
const DISCREPANCIES_STEP = "discrepancies";
const INDEX_VALUES_STEP = "indexValues";
const STATS_KEY = "stats:v1";
const DIRECTORY_KEY = "directory:v1";
const INDEX_CLOSES_KEY_PREFIX = "snapshot:index-closes:";
const STORE_KV_KEYS = [
  SNAPSHOT_KEY,
  LAST_SESSION_KEY,
  STATS_KEY,
  DIRECTORY_KEY,
  `${INDEX_CLOSES_KEY_PREFIX}${FRIDAY}`,
];
const STORE_TABLES = [
  "daily_bars",
  "index_values",
  "market_events",
  "source_discrepancies",
  "corporate_actions",
  "notices",
  "symbols",
  "symbol_aliases",
  "job_state",
  "usage_global",
  "market_calendar",
];
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const MUBASHER_LISTED_URL = "https://www.mubasher.info/api/1/listed-companies";
const MUBASHER_PRICES_URL = "https://www.mubasher.info/api/1/stocks/prices/all";
const CLOSES_COLUMN_COUNT = 4;
const PRIMARY_SOURCE = "mubasher";
const BACKUP_SOURCE = "tradingview";
const STOCK_TYPE = "stock";
const BONUS = "bonus";
const SPLIT = "split";
const ONE_FOR_ONE_BONUS_RATIO = 1;
const ONE_FOR_ONE_BONUS_FACTOR = 0.5;
const ADJUST_BATCH_OVERHEAD_ROWS = 8;
const ADJUST_ROWS_CAP = 10000;
const ROWS_ALREADY_USED = 9500;
const ROWS_OVER_THE_CAP = 1250;
const MAX_ACTIONS_PER_RUN = 2;
const QUEUED_ACTIONS = 8;
const FIRST_QUEUE_SYMBOL = 10;
const LOADING_SYMBOL = 20;
const CAPPED_SYMBOL = 30;
const FUTURE_SYMBOL = 40;
const PENDING_SYMBOL = 50;
const MAX_STATS_BOUND_PARAMETERS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const CAPPED_HISTORY_START = Date.UTC(2023, 0, 1);
const SEED_CHUNK = 250;
const BIG_MOVE_THRESHOLD_CHP = 5;
const ADJUST_DAY = TODAY;

type Quotes = Record<string, QuoteEntry>;
type BarSelect = {
  isin: string;
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
type IndexRow = { index_code: string; session_date: string; close: number; change_pct: number | null; source: string };
type EventRow = { kind: string; isin: string | null; payload: Record<string, unknown> };
type DiscrepancyRow = {
  isin: string;
  session_date: string;
  primary_source: string;
  backup_source: string;
  primary_close: number;
  backup_close: number;
  diff_pct: number;
};
type ActionRow = { id: number; isin: string; kind: string; ex_date: string; ratio: number | null; status: string };
type NoticeRow = { subject: string; status: string };
type ActionSeed = {
  index: number;
  kind?: string;
  ratio?: number | null;
  exDate: string;
  status: "needs_ratio" | "recorded" | "applied";
};
type SymbolSeed = { backfillState?: "loading" | "done" | null; adjBasisDate?: string | null; missingSessions?: number };
type Upstreams = { closes: Upstream; prices: Upstream };
type Prepared = { sql: string; params: unknown[] };

function backupCloseRows(closes: Record<string, number>) {
  return {
    totalCount: Object.keys(closes).length,
    data: Object.entries(closes).map(([ticker, close]) => ({
      s: `EGX:${ticker}`,
      d: [ticker, close, MARKET_TRADE_TIME, STOCK_TYPE],
    })),
  };
}

function agreeingCloses(): Record<string, number> {
  return Object.fromEntries(
    MARKET_ISINS.map((_isin, index) => [syntheticTicker(index), priceAt(index)]),
  );
}

function priceAt(index: number): number {
  return 100 + changePctAt(index);
}

function changePctAt(index: number): number {
  return index - 3;
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) {
      const columns = (JSON.parse(String(init?.body ?? "{}")) as { columns?: string[] }).columns ?? [];
      if (columns.length === CLOSES_COLUMN_COUNT) {
        return (upstreams.closes ?? fixtureResponse(backupCloseRows(agreeingCloses())))();
      }
      return Response.json(tradingViewScan);
    }
    if (url.startsWith(MUBASHER_LISTED_URL)) return firstPageOnly(mubasherListed)(1);
    if (url.startsWith(MUBASHER_PRICES_URL)) return (upstreams.prices ?? notFound)();
    return notFound();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function withBindSpy(source: Env) {
  const prepared: Prepared[] = [];
  const db = new Proxy(source.DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) =>
        new Proxy(target.prepare(sql), {
          get(statement, member) {
            if (member !== "bind") return bindMember(statement, member);
            return (...params: unknown[]) => {
              prepared.push({ sql, params });
              return statement.bind(...params);
            };
          },
        });
    },
  });
  return { spied: Object.create(source, { DB: { value: db } }) as Env, prepared };
}

function createRunner() {
  return createJobRunner(endOfDayJob, { date: TODAY, time: RUN_TIME });
}

function createSpiedRunner() {
  const spy: { prepared: Prepared[] } = { prepared: [] };
  const runner = createJobRunner(async (source, now) => {
    const { spied, prepared } = withBindSpy(source);
    spy.prepared = prepared;
    return endOfDayJob(spied, now);
  }, { date: TODAY, time: RUN_TIME });
  return { runner, spy };
}

async function seedMarket(mutate: (quotes: Quotes) => void = () => undefined): Promise<Snapshot> {
  const partial = marketSnapshot(TODAY);
  const quotes = structuredClone(partial.quotes ?? {});
  mutate(quotes);
  return seedSnapshot({ ...partial, quotes });
}

function quoteOf(quotes: Quotes, index: number): QuoteEntry {
  const quote = quotes[syntheticIsin(index)];
  if (!quote) throw new Error(`no quote ${index}`);
  return quote;
}

async function readBars(isin?: string): Promise<BarSelect[]> {
  const where = isin === undefined ? "" : "WHERE isin = ?1";
  const statement = env.DB.prepare(
    `SELECT isin, session_date, open, high, low, close, volume, value, adj_open, adj_high, adj_low, adj_close,
            adj_factor, raw_derived, source
     FROM daily_bars ${where} ORDER BY isin, session_date`,
  );
  const { results } = await (isin === undefined ? statement : statement.bind(isin)).all<BarSelect>();
  return results;
}

async function readIndexValues(): Promise<IndexRow[]> {
  const { results } = await env.DB
    .prepare("SELECT index_code, session_date, close, change_pct, source FROM index_values ORDER BY index_code")
    .all<IndexRow>();
  return results;
}

async function readBigMoves(): Promise<EventRow[]> {
  const { results } = await env.DB
    .prepare("SELECT kind, isin, payload FROM market_events WHERE kind = 'big_move' ORDER BY isin")
    .all<{ kind: string; isin: string | null; payload: string }>();
  return results.map((row) => ({ ...row, payload: JSON.parse(row.payload) as Record<string, unknown> }));
}

async function countEvents(): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS total FROM market_events").first<{ total: number }>())?.total ?? 0;
}

async function seedTickerAliases(aliases: [number, string, "ticker" | "provider"][]): Promise<void> {
  for (const [index, value, kind] of aliases) {
    await env.DB
      .prepare("INSERT INTO symbol_aliases (isin, kind, value, first_seen, last_seen) VALUES (?1, ?2, ?3, 1, 1)")
      .bind(syntheticIsin(index), kind, value)
      .run();
  }
}

function seedMarketTickerAliases(): Promise<void> {
  return seedTickerAliases(MARKET_ISINS.map((_isin, index) => [index, syntheticTicker(index), "ticker"]));
}

async function readDiscrepancies(): Promise<DiscrepancyRow[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT isin, session_date, primary_source, backup_source, primary_close, backup_close, diff_pct
       FROM source_discrepancies ORDER BY isin`,
    )
    .all<DiscrepancyRow>();
  return results;
}

async function readActions(): Promise<ActionRow[]> {
  const { results } = await env.DB
    .prepare("SELECT id, isin, kind, ex_date, ratio, status FROM corporate_actions ORDER BY ex_date, id")
    .all<ActionRow>();
  return results;
}

async function readNeedsRatioNotices(): Promise<NoticeRow[]> {
  const { results } = await env.DB
    .prepare("SELECT subject, status FROM notices WHERE kind = 'needs_ratio' ORDER BY subject")
    .all<NoticeRow>();
  return results;
}

async function readAdjustRows(): Promise<number> {
  const row = await env.DB
    .prepare("SELECT adjust_rows FROM usage_global WHERE day = ?1")
    .bind(ADJUST_DAY)
    .first<{ adjust_rows: number }>();
  return row?.adjust_rows ?? 0;
}

async function readStats(): Promise<Stats> {
  const stats = await env.DATA.get<Stats>(STATS_KEY, { type: "json" });
  if (!stats) throw new Error("stats not written");
  return stats;
}

async function readLastSession(): Promise<Snapshot | null> {
  return env.DATA.get<Snapshot>(LAST_SESSION_KEY, { type: "json" });
}

async function seedSymbol(index: number, options: SymbolSeed = {}): Promise<void> {
  const { backfillState = null, adjBasisDate = null, missingSessions = 0 } = options;
  await env.DB
    .prepare(
      `INSERT INTO symbols (isin, ticker, status, backfill_state, adj_basis_date, missing_sessions, created_at, updated_at)
       VALUES (?1, ?2, 'active', ?3, ?4, ?5, 1, 1)`,
    )
    .bind(syntheticIsin(index), syntheticTicker(index), backfillState, adjBasisDate, missingSessions)
    .run();
}

function noticeSubject(index: number, kind: string, exDate: string): string {
  return `${syntheticTicker(index)} ${kind} ${exDate}`;
}

async function seedAction(action: ActionSeed): Promise<void> {
  const { index, kind = BONUS, ratio = ONE_FOR_ONE_BONUS_RATIO, exDate, status } = action;
  await env.DB
    .prepare(
      `INSERT INTO corporate_actions (isin, kind, ex_date, ratio, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'test', 1, 1)`,
    )
    .bind(syntheticIsin(index), kind, exDate, status === "needs_ratio" ? null : ratio, status)
    .run();
  if (status === "applied") return;
  const subject = noticeSubject(index, kind, exDate);
  await env.DB
    .prepare(
      `INSERT INTO notices (kind, subject, details, created_at, status, dedupe_key)
       VALUES ('needs_ratio', ?1, '{}', 1, 'open', ?2)`,
    )
    .bind(subject, `needs_ratio|${subject}|${TODAY}`)
    .run();
}

async function seedUsedAdjustRows(rows: number): Promise<void> {
  await env.DB.prepare("INSERT INTO usage_global (day, adjust_rows) VALUES (?1, ?2)").bind(ADJUST_DAY, rows).run();
}

function flatBar(sessionDate: string, price: number): BarRow {
  return { sessionDate, open: price, high: price, low: price, close: price };
}

async function seedFlatHistory(index: number, rows: BarRow[]): Promise<void> {
  await seedBars(syntheticIsin(index), rows);
}

async function seedLongHistory(index: number, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_value, offset) =>
    flatBar(new Date(CAPPED_HISTORY_START + offset * MS_PER_DAY).toISOString().slice(0, 10), 10),
  );
  for (let start = 0; start < rows.length; start += SEED_CHUNK) {
    await seedBars(syntheticIsin(index), rows.slice(start, start + SEED_CHUNK));
  }
}

function withFailingIndexInsert(source: Env): Env {
  const db = new Proxy(source.DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) => {
        if (sql.includes("INTO index_values")) throw new Error("index_values write failed");
        return target.prepare(sql);
      };
    },
  });
  return Object.create(source, { DB: { value: db } }) as Env;
}

function snapshotWithoutTodaysIndices(): Partial<Snapshot> {
  const partial = marketSnapshot(TODAY);
  const stale = indexEntry(49234.3, -3.56);
  return { ...partial, indices: { EGX30: { ...stale, tt: stale.tt - SECONDS_PER_DAY } } };
}

function fridayCloses(): NewIndexValue[] {
  return [{ indexCode: "EGX30", sessionDate: FRIDAY, close: 48000.5, changePct: 1.25, source: BACKUP_SOURCE }];
}

async function seedIndexClosesKey(date: string, closes: NewIndexValue[]): Promise<void> {
  await env.DATA.put(`${INDEX_CLOSES_KEY_PREFIX}${date}`, JSON.stringify(closes));
}

async function seedIndexValue(close: number, source: string): Promise<void> {
  await env.DB
    .prepare("INSERT INTO index_values (index_code, session_date, close, change_pct, source) VALUES ('EGX30', ?1, ?2, NULL, ?3)")
    .bind(TODAY, close, source)
    .run();
}

async function jobFailures(step: string) {
  return (await readNotices("job_failed")).filter((notice) => notice.details.step === step);
}

describe("endOfDayJob bars", () => {
  beforeEach(async () => {
    setBindings({ STOCK_PROVIDERS: "tradingview,mubasher", ADJUST_MAX_ROWS_PER_DAY: String(ADJUST_ROWS_CAP) });
    await clearStores(STORE_KV_KEYS, STORE_TABLES);
  });

  afterEach(() => {
    restoreBindings();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("daily bars", () => {
    it("writes one bar per quote with the session date, raw equal to adjusted, factor 1 and the quote source", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const bars = await readBars();

      expect(bars).toHaveLength(MARKET_ISINS.length);
      expect(bars.map((bar) => bar.isin)).toEqual([...MARKET_ISINS].sort());
      expect(bars.find((bar) => bar.isin === syntheticIsin(0))).toEqual({
        isin: syntheticIsin(0),
        session_date: TODAY,
        open: 100,
        high: 105,
        low: 95,
        close: 97,
        volume: 7000,
        value: 650000,
        adj_open: 100,
        adj_high: 105,
        adj_low: 95,
        adj_close: 97,
        adj_factor: 1,
        raw_derived: 0,
        source: PRIMARY_SOURCE,
      });
      expect(await jobFailures(BARS_STEP)).toEqual([]);
    });

    it("writes only quotes whose trade date is the session date", async () => {
      await seedMarket((quotes) => {
        quoteOf(quotes, 0).td = FRIDAY;
      });
      stubFetch();

      await createRunner().run();
      const bars = await readBars();

      expect(bars).toHaveLength(MARKET_ISINS.length - 1);
      expect(bars.map((bar) => bar.isin)).not.toContain(syntheticIsin(0));
      expect(bars.every((bar) => bar.session_date === TODAY)).toBe(true);
    });

    it("sets job_state eod_bars to the session date after the bars step", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run();

      expect(await readLastRunDate(EOD_BARS_JOB)).toBe(TODAY);
    });

    it("still sets job_state eod_bars when activating pending symbols fails", async () => {
      await seedMarket();
      await env.DB
        .prepare(
          `INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES (?1, ?2, 'pending', 1, 1)`,
        )
        .bind(syntheticIsin(0), syntheticTicker(0))
        .run();
      await env.DB
        .prepare(
          `CREATE TRIGGER block_activation BEFORE UPDATE OF status ON symbols
           WHEN NEW.status = 'active' BEGIN SELECT RAISE(ABORT, 'activation blocked'); END`,
        )
        .run();
      stubFetch();

      try {
        await createRunner().run();
      } finally {
        await env.DB.prepare("DROP TRIGGER block_activation").run();
      }

      expect(await readLastRunDate(EOD_BARS_JOB)).toBe(TODAY);
      expect(await jobFailures(BARS_STEP)).toHaveLength(1);
    });

    it("fills a quote with null open, high and low from the close and marks the source as filled", async () => {
      await seedMarket((quotes) => {
        const quote = quoteOf(quotes, 0);
        quote.o = null;
        quote.h = null;
        quote.l = null;
      });
      stubFetch();

      await createRunner().run();
      const bar = (await readBars(syntheticIsin(0)))[0];

      expect(bar).toMatchObject({
        open: 97,
        high: 97,
        low: 97,
        close: 97,
        adj_open: 97,
        adj_high: 97,
        adj_low: 97,
        adj_close: 97,
        source: `${PRIMARY_SOURCE}+filled`,
      });
    });

    it("writes the index values of the session", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run();

      expect(await readIndexValues()).toEqual([
        { index_code: "EGX30", session_date: TODAY, close: 49234.3, change_pct: -3.56, source: BACKUP_SOURCE },
        { index_code: "EGX70EWI", session_date: TODAY, close: 11234.5, change_pct: 0.42, source: BACKUP_SOURCE },
      ]);
    });

    it("does not write an index carried over from a previous session", async () => {
      const partial = marketSnapshot(TODAY);
      const carriedOver = indexEntry(11234.5, 0.42);
      await seedSnapshot({
        ...partial,
        indices: { ...partial.indices, EGX70EWI: { ...carriedOver, tt: carriedOver.tt - SECONDS_PER_DAY } },
      });
      stubFetch();

      await createRunner().run();

      expect(await readIndexValues()).toEqual([
        { index_code: "EGX30", session_date: TODAY, close: 49234.3, change_pct: -3.56, source: BACKUP_SOURCE },
      ]);
    });

    it("stores the index closes kept for an earlier session after the last-session snapshot was overwritten, and inserts nothing new on a second run", async () => {
      await seedMarket();
      await seedLastSessionSnapshot(marketSnapshot(TODAY));
      await seedIndexClosesKey(FRIDAY, fridayCloses());
      stubFetch();

      await createRunner().run();
      const afterFirstRun = await readIndexValues();
      await createRunner().run(LATER_RUN_TIME);

      expect(afterFirstRun).toContainEqual({
        index_code: "EGX30",
        session_date: FRIDAY,
        close: 48000.5,
        change_pct: 1.25,
        source: BACKUP_SOURCE,
      });
      expect(await readIndexValues()).toEqual(afterFirstRun);
    });

    it("raises one job_failed for the indexValues step when no index entry is dated today and still runs the later steps", async () => {
      await seedSnapshot(snapshotWithoutTodaysIndices());
      stubFetch();

      await createRunner().run();
      const failures = await jobFailures(INDEX_VALUES_STEP);

      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: "end_of_day", step: INDEX_VALUES_STEP });
      expect(await readIndexValues()).toEqual([]);
      expect(await env.DATA.get(STATS_KEY)).not.toBeNull();
      expect((await readLastSession())?.session.date).toBe(TODAY);
    });

    it("raises the notice and still runs the other steps when the index insert fails", async () => {
      await seedMarket();
      stubFetch();
      const runner = createJobRunner(
        (source, now) => endOfDayJob(withFailingIndexInsert(source), now),
        { date: TODAY, time: RUN_TIME },
      );

      await runner.run();

      expect(await jobFailures(INDEX_VALUES_STEP)).toHaveLength(1);
      expect(await readBars()).toHaveLength(MARKET_ISINS.length);
      expect(await env.DATA.get(STATS_KEY)).not.toBeNull();
      expect((await readLastSession())?.session.date).toBe(TODAY);
    });

    it("keeps the close of an existing mubasher row for the index and session", async () => {
      await seedMarket();
      await seedIndexValue(50000, PRIMARY_SOURCE);
      stubFetch();

      await createRunner().run();

      expect((await readIndexValues()).find((row) => row.index_code === "EGX30")).toMatchObject({
        close: 50000,
        source: PRIMARY_SOURCE,
      });
    });
  });

  describe("big moves", () => {
    it("writes a big_move event only for quotes with an absolute change above 5 percent", async () => {
      await seedMarket((quotes) => {
        quoteOf(quotes, 2).chp = BIG_MOVE_THRESHOLD_CHP;
        Object.assign(quoteOf(quotes, 3), { chp: 6.5, p: 106.5 });
        Object.assign(quoteOf(quotes, 4), { chp: -7.2, p: 92.8 });
      });
      stubFetch();

      await createRunner().run();

      expect(await readBigMoves()).toEqual([
        { kind: "big_move", isin: syntheticIsin(3), payload: { ticker: syntheticTicker(3), chp: 6.5, close: 106.5 } },
        { kind: "big_move", isin: syntheticIsin(4), payload: { ticker: syntheticTicker(4), chp: -7.2, close: 92.8 } },
      ]);
    });

    it("writes no event when no quote moves more than 5 percent", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run();

      expect(await countEvents()).toBe(0);
    });
  });

  describe("stats:v1", () => {
    it("holds h52, l52, avgVol20, ret and an empty pendingAdj for a symbol with history", async () => {
      await seedMarket();
      await seedBars(syntheticIsin(0), [
        { sessionDate: WEDNESDAY, open: 100, high: 120, low: 90, close: 100, volume: 1000 },
        { sessionDate: THURSDAY, open: 100, high: 110, low: 95, close: 105, volume: 2000 },
      ]);
      stubFetch();

      await createRunner().run();
      const stats = await readStats();
      const entry = stats.symbols[syntheticIsin(0)];

      expect(stats.v).toBe(1);
      expect(stats.asOf).toBe(TODAY);
      expect(entry).toMatchObject({ h52: 120, h52d: WEDNESDAY, l52: 90, l52d: WEDNESDAY, pendingAdj: [] });
      expect(entry?.avgVol20).toBeCloseTo((1000 + 2000 + 7000) / 3, 1);
      expect(Object.keys(entry?.ret ?? {}).sort()).toEqual(["1d", "1m", "1w", "1y", "3m", "ytd"]);
      expect(entry?.ret["1d"]).toBeLessThan(0);
    });

    it("builds pendingAdj from one statement without a symbol list and keeps an action with a later ex date", async () => {
      await seedMarket();
      await seedSymbol(PENDING_SYMBOL);
      await seedFlatHistory(PENDING_SYMBOL, [flatBar(WEDNESDAY, 10)]);
      await seedAction({ index: PENDING_SYMBOL, kind: SPLIT, exDate: FAR_EX_DATE, status: "needs_ratio" });
      stubFetch();
      const { runner, spy } = createSpiedRunner();

      await runner.run();
      const stats = await readStats();
      const [action] = await readActions();
      const pendingStatements = spy.prepared.filter(
        (statement) => /^\s*SELECT/i.test(statement.sql) && /adj_?affected/i.test(statement.sql),
      );

      expect(pendingStatements).toHaveLength(1);
      expect(pendingStatements[0]?.params.length).toBeLessThanOrEqual(MAX_STATS_BOUND_PARAMETERS);
      expect(stats.symbols[syntheticIsin(PENDING_SYMBOL)]?.pendingAdj).toEqual([
        { actionId: action?.id, kind: SPLIT, exDate: FAR_EX_DATE, state: "needs_ratio", adjAffected: true },
      ]);
    });
  });

  describe("discrepancies", () => {
    beforeEach(seedMarketTickerAliases);

    it("stores a close that differs from the backup by more than 2 percent once per symbol and session", async () => {
      await seedMarket();
      stubFetch({
        closes: fixtureResponse(
          backupCloseRows({ ...agreeingCloses(), [syntheticTicker(1)]: 101, [syntheticTicker(2)]: 99.5 }),
        ),
      });

      await createRunner().run();
      const rows = await readDiscrepancies();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        isin: syntheticIsin(1),
        session_date: TODAY,
        primary_source: PRIMARY_SOURCE,
        backup_source: BACKUP_SOURCE,
        primary_close: 98,
        backup_close: 101,
      });
      expect(rows[0]?.diff_pct).toBeCloseTo((3 / 98) * 100, 4);
      expect(await jobFailures(DISCREPANCIES_STEP)).toEqual([]);
    });

    it("matches the backup close by ISIN when the backup ticker is lowercase or a provider alias", async () => {
      const providerAlias = "BKP002";
      await seedMarket();
      await seedTickerAliases([[2, providerAlias, "provider"]]);
      const replaced = [syntheticTicker(1), syntheticTicker(2)];
      const agreeing = Object.fromEntries(Object.entries(agreeingCloses()).filter(([ticker]) => !replaced.includes(ticker)));
      stubFetch({
        closes: fixtureResponse(
          backupCloseRows({ ...agreeing, [syntheticTicker(1).toLowerCase()]: 101, [providerAlias.toLowerCase()]: 105 }),
        ),
      });

      await createRunner().run();
      const rows = await readDiscrepancies();

      expect(rows.map((row) => [row.isin, row.backup_close])).toEqual([
        [syntheticIsin(1), 101],
        [syntheticIsin(2), 105],
      ]);
    });

    it("stores no row when every backup close is within 2 percent", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run();

      expect(await readDiscrepancies()).toEqual([]);
    });

    it("keeps the bars and raises job_failed for the discrepancy step only when the backup fetch fails", async () => {
      await seedMarket();
      stubFetch({ closes: failingUpstream });

      await createRunner().run();
      const failures = await readNotices("job_failed");

      expect(await readBars()).toHaveLength(MARKET_ISINS.length);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBe(TODAY);
      expect(await readDiscrepancies()).toEqual([]);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: "end_of_day", step: DISCREPANCIES_STEP });
    });
  });

  describe("empty source", () => {
    it.each([
      ["no snapshot at all", async () => undefined],
      [
        "a snapshot of an earlier session",
        async () => {
          await seedSnapshot({ ...marketSnapshot(FRIDAY) });
        },
      ],
      [
        "a snapshot of today without quotes",
        async () => {
          await seedSnapshot({ session: { ...defaultSnapshot().session, date: TODAY }, quotes: {} });
        },
      ],
    ])("writes no bars and raises job_failed for the bars step with %s", async (_label, seed) => {
      await seed();
      stubFetch();

      await createRunner().run();
      const failures = await jobFailures(BARS_STEP);

      expect(await readBars()).toEqual([]);
      expect(await readIndexValues()).toEqual([]);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: "end_of_day", step: BARS_STEP });
    });
  });

  describe("when the job does not run", () => {
    it("writes nothing on a holiday", async () => {
      await seedCalendar([{ date: TODAY, kind: "holiday" }]);
      await seedMarket();
      const fetchStub = stubFetch();

      await createRunner().run();

      expect(fetchStub).not.toHaveBeenCalled();
      expect(await readBars()).toEqual([]);
      expect(await readIndexValues()).toEqual([]);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();
    });

    it("writes nothing on a weekend", async () => {
      await seedSnapshot({ ...marketSnapshot(FRIDAY) });
      const fetchStub = stubFetch();

      await createRunner().run(RUN_TIME, FRIDAY);

      expect(fetchStub).not.toHaveBeenCalled();
      expect(await readBars()).toEqual([]);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();
    });

    it("does not run at the window end minute of a special-hours day closing at 15:15, and runs at the next cron tick", async () => {
      await seedCalendar([{ date: TODAY, kind: "special_hours", openTime: "10:00", closeTime: "15:15" }]);
      await seedMarket();
      stubFetch();
      const runner = createRunner();

      await runner.run(RUN_TIME);
      expect(await readBars()).toEqual([]);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();

      await runner.run(SECOND_CRON_RUN_TIME);
      expect((await readBars()).length).toBeGreaterThan(0);
    });

    it("runs at the first cron time on a normal day", async () => {
      await seedMarket();
      stubFetch();

      await createRunner().run(RUN_TIME);

      expect((await readBars()).length).toBeGreaterThan(0);
    });

    it("waits for the second cron time when the refresh window of a special-hours day closing at 16:00 ends at 16:15", async () => {
      await seedCalendar([{ date: TODAY, kind: "special_hours", openTime: "10:00", closeTime: "16:00" }]);
      await seedMarket();
      stubFetch();
      const runner = createRunner();

      await runner.run(RUN_TIME);
      expect(await readBars()).toEqual([]);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();

      await runner.run(SECOND_CRON_RUN_TIME);
      expect((await readBars()).length).toBeGreaterThan(0);
    });

    it("runs once per Cairo date", async () => {
      await seedMarket();
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const callsAfterFirstRun = fetchStub.mock.calls.length;
      const barsAfterFirstRun = await readBars();
      await runner.run(LATER_RUN_TIME);

      expect(fetchStub.mock.calls).toHaveLength(callsAfterFirstRun);
      expect(await readBars()).toEqual(barsAfterFirstRun);
      expect(runner.kvWrites.filter((key) => key === STATS_KEY)).toHaveLength(1);
    });

    it("makes no fetch and writes no bars, events or stats when the snapshot has noTradesToday", async () => {
      await seedSnapshot({
        ...marketSnapshot(TODAY),
        session: { ...defaultSnapshot().session, date: TODAY, noTradesToday: true },
      });
      await seedSymbol(0, { missingSessions: 3 });
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const symbol = await env.DB
        .prepare("SELECT missing_sessions FROM symbols WHERE isin = ?1")
        .bind(syntheticIsin(0))
        .first<{ missing_sessions: number }>();

      expect(fetchStub).not.toHaveBeenCalled();
      expect(await readBars()).toEqual([]);
      expect(await readIndexValues()).toEqual([]);
      expect(await countEvents()).toBe(0);
      expect(runner.kvWrites).toEqual([]);
      expect(symbol?.missing_sessions).toBe(3);
      expect(await readLastRunDate("end_of_day")).toBe(TODAY);
      expect(await readLastRunDate(EOD_BARS_JOB)).toBeNull();
    });
  });

  describe("last session snapshot", () => {
    it("writes snapshot:last-session from snapshot:v1 when the stored copy has an older session date", async () => {
      await seedMarket();
      await seedLastSessionSnapshot(marketSnapshot(FRIDAY));
      stubFetch();

      await createRunner().run();

      expect((await readLastSession())?.session.date).toBe(TODAY);
    });

    it("leaves snapshot:last-session alone when it already holds the session date", async () => {
      await seedMarket();
      await seedLastSessionSnapshot(marketSnapshot(TODAY));
      stubFetch();
      const runner = createRunner();

      await runner.run();

      expect(runner.kvWrites).not.toContain(LAST_SESSION_KEY);
    });
  });

  describe("apply queue", () => {
    it("applies a recorded bonus whose ex date is today after today's bar is written and closes its notice", async () => {
      await seedSymbol(0);
      await seedFlatHistory(0, [flatBar(WEDNESDAY, 100), flatBar(THURSDAY, 100)]);
      await seedAction({ index: 0, exDate: TODAY, status: "recorded" });
      await seedMarket((quotes) => {
        Object.assign(quoteOf(quotes, 0), { o: 50, h: 50, l: 50, p: 50, chp: 0 });
      });
      stubFetch();

      await createRunner().run();
      const bars = await readBars(syntheticIsin(0));
      const [action] = await readActions();

      expect(action).toMatchObject({ status: "applied", ratio: ONE_FOR_ONE_BONUS_RATIO });
      expect(bars.map((bar) => bar.session_date)).toEqual([WEDNESDAY, THURSDAY, TODAY]);
      expect(bars.map((bar) => bar.adj_close)).toEqual([50, 50, 50]);
      expect(bars.map((bar) => bar.close)).toEqual([100, 100, 50]);
      expect(bars.map((bar) => bar.adj_factor)).toEqual([
        ONE_FOR_ONE_BONUS_FACTOR,
        ONE_FOR_ONE_BONUS_FACTOR,
        1,
      ]);
      expect(await readNeedsRatioNotices()).toEqual([
        { subject: noticeSubject(0, BONUS, TODAY), status: "done" },
      ]);
      expect(await readAdjustRows()).toBe(2 + ADJUST_BATCH_OVERHEAD_ROWS);
    });

    it("keeps a recorded bonus with tomorrow's ex date recorded with its notice open and its bars untouched", async () => {
      await seedSymbol(0);
      await seedFlatHistory(0, [flatBar(WEDNESDAY, 100), flatBar(THURSDAY, 100)]);
      await seedAction({ index: 0, exDate: NEXT_DAY, status: "recorded" });
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const [action] = await readActions();
      const bars = await readBars(syntheticIsin(0));

      expect(action).toMatchObject({ status: "recorded", ratio: ONE_FOR_ONE_BONUS_RATIO });
      expect(bars.map((bar) => bar.adj_close)).toEqual([100, 100, 97]);
      expect(bars.map((bar) => bar.adj_factor)).toEqual([1, 1, 1]);
      expect(await readNeedsRatioNotices()).toEqual([
        { subject: noticeSubject(0, BONUS, NEXT_DAY), status: "open" },
      ]);
      expect(await readAdjustRows()).toBe(0);
    });

    it("applies exactly 2 of 8 queued actions, oldest ex date first, and labels the other 6 as queued", async () => {
      const exDates = Array.from({ length: QUEUED_ACTIONS }, (_value, offset) => `2026-10-${String(10 + offset)}`);
      for (let offset = 0; offset < QUEUED_ACTIONS; offset += 1) {
        const index = FIRST_QUEUE_SYMBOL + offset;
        await seedSymbol(index);
        await seedFlatHistory(index, [flatBar("2026-10-01", 100)]);
      }
      for (let offset = QUEUED_ACTIONS - 1; offset >= 0; offset -= 1) {
        await seedAction({ index: FIRST_QUEUE_SYMBOL + offset, exDate: exDates[offset] ?? "", status: "recorded" });
      }
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const actions = await readActions();
      const stats = await readStats();
      const applied = actions.filter((action) => action.status === "applied");
      const queued = actions.filter((action) => action.status === "recorded");

      expect(applied.map((action) => action.ex_date)).toEqual(exDates.slice(0, MAX_ACTIONS_PER_RUN));
      expect(queued.map((action) => action.ex_date)).toEqual(exDates.slice(MAX_ACTIONS_PER_RUN));
      expect(queued).toHaveLength(QUEUED_ACTIONS - MAX_ACTIONS_PER_RUN);
      expect(await readAdjustRows()).toBe(MAX_ACTIONS_PER_RUN * (1 + ADJUST_BATCH_OVERHEAD_ROWS));
      for (const action of queued) {
        expect(stats.symbols[action.isin]?.pendingAdj).toEqual([
          { actionId: action.id, kind: BONUS, exDate: action.ex_date, state: "queued", adjAffected: true },
        ]);
      }
      for (const action of applied) {
        expect(stats.symbols[action.isin]?.pendingAdj).toEqual([]);
      }
      const notices = await readNeedsRatioNotices();
      expect(notices.filter((notice) => notice.status === "done")).toHaveLength(MAX_ACTIONS_PER_RUN);
      expect(notices.filter((notice) => notice.status === "open")).toHaveLength(QUEUED_ACTIONS - MAX_ACTIONS_PER_RUN);
    });

    it("skips an action of a symbol with backfill_state loading without using a slot", async () => {
      await seedSymbol(LOADING_SYMBOL, { backfillState: "loading" });
      await seedSymbol(FIRST_QUEUE_SYMBOL);
      await seedSymbol(FIRST_QUEUE_SYMBOL + 1);
      for (const index of [LOADING_SYMBOL, FIRST_QUEUE_SYMBOL, FIRST_QUEUE_SYMBOL + 1]) {
        await seedFlatHistory(index, [flatBar("2026-10-01", 100)]);
      }
      await seedAction({ index: LOADING_SYMBOL, exDate: "2026-10-05", status: "recorded" });
      await seedAction({ index: FIRST_QUEUE_SYMBOL, exDate: "2026-10-10", status: "recorded" });
      await seedAction({ index: FIRST_QUEUE_SYMBOL + 1, exDate: "2026-10-11", status: "recorded" });
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const actions = await readActions();
      const stats = await readStats();

      expect(actions.map((action) => [action.isin, action.status])).toEqual([
        [syntheticIsin(LOADING_SYMBOL), "recorded"],
        [syntheticIsin(FIRST_QUEUE_SYMBOL), "applied"],
        [syntheticIsin(FIRST_QUEUE_SYMBOL + 1), "applied"],
      ]);
      expect((await readBars(syntheticIsin(LOADING_SYMBOL))).map((bar) => bar.adj_close)).toEqual([100]);
      expect(stats.symbols[syntheticIsin(LOADING_SYMBOL)]?.pendingAdj).toEqual([
        expect.objectContaining({ kind: BONUS, state: "queued", adjAffected: true }),
      ]);
    });

    it("leaves an action recorded, its notice open and its bars labeled queued when the daily cap would be exceeded", async () => {
      await seedSymbol(CAPPED_SYMBOL);
      await seedLongHistory(CAPPED_SYMBOL, ROWS_OVER_THE_CAP);
      await seedAction({ index: CAPPED_SYMBOL, exDate: TODAY, status: "recorded" });
      await seedUsedAdjustRows(ROWS_ALREADY_USED);
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const [action] = await readActions();
      const bars = await readBars(syntheticIsin(CAPPED_SYMBOL));
      const stats = await readStats();

      expect(action).toMatchObject({ status: "recorded" });
      expect(await readNeedsRatioNotices()).toEqual([
        { subject: noticeSubject(CAPPED_SYMBOL, BONUS, TODAY), status: "open" },
      ]);
      expect(bars.filter((bar) => bar.adj_close !== 10 || bar.adj_factor !== 1)).toEqual([]);
      expect(await readAdjustRows()).toBe(ROWS_ALREADY_USED);
      expect(stats.symbols[syntheticIsin(CAPPED_SYMBOL)]?.pendingAdj).toEqual([
        { actionId: action?.id, kind: BONUS, exDate: TODAY, state: "queued", adjAffected: true },
      ]);
    });

    it("does not apply an action of a future ex date that has a ratio and does not label it for today", async () => {
      await seedSymbol(FUTURE_SYMBOL);
      await seedFlatHistory(FUTURE_SYMBOL, [flatBar(WEDNESDAY, 100)]);
      await seedAction({ index: FUTURE_SYMBOL, exDate: FAR_EX_DATE, status: "recorded" });
      await seedMarket();
      stubFetch();

      await createRunner().run();
      const [action] = await readActions();
      const stats = await readStats();

      expect(action).toMatchObject({ status: "recorded" });
      expect(stats.symbols[syntheticIsin(FUTURE_SYMBOL)]?.pendingAdj).toEqual([
        expect.objectContaining({ exDate: FAR_EX_DATE, state: "queued" }),
      ]);
      expect((await readBars(syntheticIsin(FUTURE_SYMBOL))).map((bar) => bar.adj_close)).toEqual([100]);
    });
  });
});
