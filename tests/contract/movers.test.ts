import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearState, restoreBindings } from "../helpers/bindings";
import { MARKET_ISINS, MOVERS_IN_SNAPSHOT, marketSnapshot } from "../helpers/market";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { defaultSnapshot, seedKey, seedSnapshot, seedStats, seedSymbols, seedUser, setNow, stockSymbol, syntheticIsin, syntheticTicker } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";
import type { PendingAdjustment, Stats, StatsReturns, SymbolStats } from "../../src/store/kv";

const TODAY = "2026-10-25";
const LAST_THURSDAY = "2026-10-22";
const STALE_TRADE_DATE = "2026-10-20";
const AFTER_CLOSE = cairoSummerEpoch(TODAY, "15:00");
const MORNING = cairoSummerEpoch(TODAY, "11:00");
const THURSDAY_AFTER_CLOSE = cairoSummerEpoch(LAST_THURSDAY, "15:00");
const USER_EMAIL = "user@example.com";
const MOVERS_TOOL = "get_movers";
const RANGE_TOOL = "get_52_week_range";
const SECTOR_TOOL = "get_sector_performance";
const STATS_MISSING_REASON = "stats not built yet";
const OWNER_RATIO_REASON = "not yet adjusted: awaiting the owner's ratio";
const MAX_LIMIT = 20;
const OVER_LIMIT = 21;
const LIMITED = 3;
const BANKS = "Banks";
const REAL_ESTATE = "Real Estate";
const PAST_EX_DATE = "2026-10-20";
const FUTURE_EX_DATE = "2026-11-01";
const NO_RETURNS: StatsReturns = { "1d": null, "1w": null, "1m": null, "3m": null, ytd: null, "1y": null };
const PRICE_BY_INDEX = [97, 98, 99, 100, 101, 102, 103];
const VOLUME_BY_INDEX = [7000, 8000, 9000, 10000, 11000, 12000, 13000];
const AVG_VOLUME_BY_INDEX = [10000, 10000, 10000, 10000, 5500, 5000, 6000];
const H52_BY_INDEX = [200, 200, 200, 200, 120, 110, 104];
const L52_BY_INDEX = [96, 90, 50, 50, 50, 50, 50];
const MONTH_RETURN_BY_INDEX = [-2, 4, 6, 1, -3, 5, 9];
const SECTOR_BY_INDEX = [BANKS, BANKS, BANKS, REAL_ESTATE, REAL_ESTATE, REAL_ESTATE, REAL_ESTATE];
const UNUSUAL_INDEXES = [5, 6];
const NEAR_HIGH_ORDER = [6, 5, 4];
const NEAR_LOW_ORDER = [0, 1];
const PERCENT_PRECISION = 1;

type MarketMeta = {
  label: string;
  stale: boolean;
  staleReason: string | null;
  session: { date: string; status: string } | null;
  notAvailable: { field: string; reason: string }[];
};
type Payload<T> = { data: T; meta: MarketMeta };
type MoverItem = {
  isin: string;
  ticker: string;
  volume?: number;
  avgVol20?: number;
  h52?: number;
  l52?: number;
  distancePct?: number;
  adjustmentPending?: boolean;
};
type RangeNoData = { isin: string; ticker: string; status: string };
type RangeItem = {
  isin: string;
  price: number;
  h52: number;
  h52Date: string;
  l52: number;
  l52Date: string;
  fromHighPct: number;
  fromLowPct: number;
  adjustmentPending: boolean;
};
type SectorItem = {
  sector: string;
  medianReturnPct: number;
  advancers: number;
  decliners: number;
  symbols: number;
  adjustmentPending?: boolean;
};

function at(values: number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`no fixture value at ${index}`);
  return value;
}

function payloadOf<T>(result: ToolResult): Payload<T> {
  return structuredPayloadOf<Payload<T>>(result);
}

function pendingEntry(overrides: Partial<PendingAdjustment> = {}): PendingAdjustment {
  return { actionId: 1, kind: "split", exDate: PAST_EX_DATE, state: "needs_ratio", adjAffected: true, ...overrides };
}

function symbolStats(index: number, pendingAdj: PendingAdjustment[] = []): SymbolStats {
  return {
    h52: at(H52_BY_INDEX, index),
    h52d: "2026-06-01",
    l52: at(L52_BY_INDEX, index),
    l52d: "2026-01-15",
    avgVol20: at(AVG_VOLUME_BY_INDEX, index),
    ret: { ...NO_RETURNS, "1m": at(MONTH_RETURN_BY_INDEX, index) },
    pendingAdj,
  };
}

function statsFor(asOf: string, pending: Record<number, PendingAdjustment[]> = {}): Partial<Stats> {
  const entries = MARKET_ISINS.map((isin, index) => [isin, symbolStats(index, pending[index] ?? [])]);
  return { asOf, symbols: Object.fromEntries(entries) };
}

function directoryWithSectors() {
  return MARKET_ISINS.map((isin, index) => stockSymbol(isin, syntheticTicker(index), { sector: SECTOR_BY_INDEX[index] }));
}

function isinsAt(indexes: number[]): string[] {
  return indexes.map((index) => syntheticIsin(index));
}

function isinsOf(items: { isin: string }[]): string[] {
  return items.map((item) => item.isin);
}

function percentFrom(price: number, reference: number): number {
  return ((price - reference) / reference) * 100;
}

describe("movers contract", () => {
  let key: string;

  async function movers(kind: string, limit?: number): Promise<MoverItem[]> {
    const args = limit === undefined ? { kind } : { kind, limit };
    return payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, args, key)).data.items;
  }

  async function range(symbols: string[]): Promise<Payload<{ items: RangeItem[] }>> {
    return payloadOf<{ items: RangeItem[] }>(await callTool(RANGE_TOOL, { symbols }, key));
  }

  async function sectors(period: string): Promise<Payload<{ sectors: SectorItem[] }>> {
    return payloadOf<{ sectors: SectorItem[] }>(await callTool(SECTOR_TOOL, { period }, key));
  }

  function adjustedNotice(meta: MarketMeta): { field: string; reason: string }[] {
    return meta.notAvailable.filter((entry) => entry.field === "adjusted");
  }

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    await clearState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSymbols(directoryWithSectors());
    await seedSnapshot(marketSnapshot(TODAY));
    await seedStats(statsFor(TODAY));
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_movers snapshot kinds", () => {
    it("lists gainers best first up to limit", async () => {
      const items = await movers("gainers", LIMITED);

      expect(isinsOf(items)).toEqual([...MARKET_ISINS].reverse().slice(0, LIMITED));
    });

    it("lists losers worst first up to limit", async () => {
      const items = await movers("losers", LIMITED);

      expect(isinsOf(items)).toEqual(MARKET_ISINS.slice(0, LIMITED));
    });

    it("lists the most traded by volume", async () => {
      const items = await movers("volume", LIMITED);

      expect(isinsOf(items)).toEqual([...MARKET_ISINS].reverse().slice(0, LIMITED));
      expect(items.map((item) => item.volume)).toEqual(VOLUME_BY_INDEX.slice().reverse().slice(0, LIMITED));
    });

    it("lists the most traded by value", async () => {
      const items = await movers("value", LIMITED);

      expect(isinsOf(items)).toEqual(MARKET_ISINS.slice(0, LIMITED));
    });

    it("returns every symbol when limit exceeds what exists", async () => {
      const items = await movers("gainers", MAX_LIMIT);

      expect(items).toHaveLength(MOVERS_IN_SNAPSHOT);
    });

    it("rejects limit above 20 as invalid_input", async () => {
      const result = await callTool(MOVERS_TOOL, { kind: "gainers", limit: OVER_LIMIT }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects limit 0 as invalid_input", async () => {
      const result = await callTool(MOVERS_TOOL, { kind: "gainers", limit: 0 }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects an unknown kind as invalid_input", async () => {
      const result = await callTool(MOVERS_TOOL, { kind: "sideways", limit: LIMITED }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("get_movers with a quote from the previous day", () => {
    const STALE_INDEX = MOVERS_IN_SNAPSHOT - 1;

    beforeEach(async () => {
      const partial = marketSnapshot(TODAY);
      const quotes = structuredClone(partial.quotes ?? {});
      const stale = quotes[syntheticIsin(STALE_INDEX)];
      if (!stale) throw new Error("missing stale quote");
      stale.td = LAST_THURSDAY;
      await seedSnapshot({ ...partial, quotes });
    });

    it("excludes it from gainers", async () => {
      const items = await movers("gainers", MAX_LIMIT);

      expect(isinsOf(items)).not.toContain(syntheticIsin(STALE_INDEX));
      expect(items).toHaveLength(MOVERS_IN_SNAPSHOT - 1);
    });

    it.each(["near_52w_high", "near_52w_low"])("excludes it from %s", async (kind) => {
      const items = await movers(kind, MAX_LIMIT);

      expect(isinsOf(items)).not.toContain(syntheticIsin(STALE_INDEX));
    });
  });

  describe("session meta", () => {
    it("equals the session of the snapshot on get_movers", async () => {
      const result = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "gainers" }, key));

      expect(result.meta.session).toEqual({ date: TODAY, status: "closed" });
    });

    it("equals the session of the snapshot on get_movers for a stats kind", async () => {
      const result = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "near_52w_high" }, key));

      expect(result.meta.session).toEqual({ date: TODAY, status: "closed" });
    });

    it("equals the session of the snapshot on get_52_week_range", async () => {
      const { meta } = await range([syntheticTicker(0)]);

      expect(meta.session).toEqual({ date: TODAY, status: "closed" });
    });

    describe("on a trading day missing from the calendar", () => {
      beforeEach(async () => {
        setNow(MORNING);
        await seedSnapshot({
          ...marketSnapshot(TODAY),
          session: { ...defaultSnapshot().session, date: TODAY, status: "closed", noTradesToday: true },
        });
      });

      it("reports get_movers as closed for a snapshot kind", async () => {
        const result = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "gainers" }, key));

        expect(result.meta.session).toEqual({ date: TODAY, status: "closed" });
      });

      it("reports get_movers as closed for a stats kind", async () => {
        const result = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "near_52w_high" }, key));

        expect(result.meta.session).toEqual({ date: TODAY, status: "closed" });
      });

      it("reports get_52_week_range as closed", async () => {
        const { meta } = await range([syntheticTicker(0)]);

        expect(meta.session).toEqual({ date: TODAY, status: "closed" });
      });
    });
  });

  describe("get_movers unusual_volume", () => {
    it("lists only symbols whose volume is above 2 times avgVol20", async () => {
      const items = await movers("unusual_volume", MAX_LIMIT);

      expect(isinsOf(items).sort()).toEqual(isinsAt(UNUSUAL_INDEXES).sort());
    });

    it("excludes a symbol whose volume is exactly 2 times avgVol20", async () => {
      const items = await movers("unusual_volume", MAX_LIMIT);

      expect(isinsOf(items)).not.toContain(syntheticIsin(4));
    });

    it("adds no adjusted notice for a pending entry", async () => {
      await seedStats(statsFor(TODAY, { 5: [pendingEntry()] }));

      const { data, meta } = payloadOf<{ items: MoverItem[] }>(
        await callTool(MOVERS_TOOL, { kind: "unusual_volume", limit: MAX_LIMIT }, key),
      );

      expect(isinsOf(data.items)).toContain(syntheticIsin(5));
      expect(adjustedNotice(meta)).toEqual([]);
    });

    it("carries the volume and avgVol20 of each item", async () => {
      const items = await movers("unusual_volume", MAX_LIMIT);

      for (const item of items) {
        const index = MARKET_ISINS.indexOf(item.isin);
        expect(item.volume).toBe(at(VOLUME_BY_INDEX, index));
        expect(item.avgVol20).toBe(at(AVG_VOLUME_BY_INDEX, index));
      }
    });

    it("honours limit", async () => {
      const items = await movers("unusual_volume", 1);

      expect(items).toHaveLength(1);
    });
  });

  describe("get_movers 52-week kinds", () => {
    it("lists near_52w_high items closest to the high first with h52 and distancePct", async () => {
      const items = await movers("near_52w_high", NEAR_HIGH_ORDER.length);

      expect(isinsOf(items)).toEqual(isinsAt(NEAR_HIGH_ORDER));
      for (const item of items) {
        const index = MARKET_ISINS.indexOf(item.isin);
        expect(item.h52).toBe(at(H52_BY_INDEX, index));
        expect(Math.abs(item.distancePct ?? Number.NaN)).toBeCloseTo(
          Math.abs(percentFrom(at(PRICE_BY_INDEX, index), at(H52_BY_INDEX, index))),
          PERCENT_PRECISION,
        );
      }
    });

    it("lists near_52w_low items closest to the low first with l52 and distancePct", async () => {
      const items = await movers("near_52w_low", NEAR_LOW_ORDER.length);

      expect(isinsOf(items)).toEqual(isinsAt(NEAR_LOW_ORDER));
      for (const item of items) {
        const index = MARKET_ISINS.indexOf(item.isin);
        expect(item.l52).toBe(at(L52_BY_INDEX, index));
        expect(Math.abs(item.distancePct ?? Number.NaN)).toBeCloseTo(
          Math.abs(percentFrom(at(PRICE_BY_INDEX, index), at(L52_BY_INDEX, index))),
          PERCENT_PRECISION,
        );
      }
    });

    it("honours limit", async () => {
      const items = await movers("near_52w_high", 1);

      expect(items).toHaveLength(1);
    });

    it("marks adjustmentPending only for an affected entry whose ex date has been reached", async () => {
      await seedStats(
        statsFor(TODAY, {
          6: [pendingEntry()],
          5: [pendingEntry({ exDate: FUTURE_EX_DATE })],
          4: [pendingEntry({ adjAffected: false })],
        }),
      );

      const items = await movers("near_52w_high", NEAR_HIGH_ORDER.length);
      const pendingByIsin = Object.fromEntries(items.map((item) => [item.isin, item.adjustmentPending]));

      expect(pendingByIsin).toEqual({
        [syntheticIsin(6)]: true,
        [syntheticIsin(5)]: false,
        [syntheticIsin(4)]: false,
      });
    });

    it("leaves adjustmentPending false for an entry with adjAffected false, such as a covered backfilled action", async () => {
      await seedStats(statsFor(TODAY, { 0: [pendingEntry({ adjAffected: false })] }));

      const items = await movers("near_52w_low", NEAR_LOW_ORDER.length);

      expect(items.find((item) => item.isin === syntheticIsin(0))?.adjustmentPending).toBe(false);
    });

    it("adds an adjusted notAvailable entry with the first pending reason only when an item is pending", async () => {
      const clean = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "near_52w_low", limit: LIMITED }, key));
      await seedStats(statsFor(TODAY, { 0: [pendingEntry()] }));
      const pending = payloadOf<{ items: MoverItem[] }>(await callTool(MOVERS_TOOL, { kind: "near_52w_low", limit: LIMITED }, key));

      expect(adjustedNotice(clean.meta)).toEqual([]);
      expect(adjustedNotice(pending.meta)).toEqual([{ field: "adjusted", reason: OWNER_RATIO_REASON }]);
    });
  });

  describe("get_52_week_range", () => {
    it("returns the range and the distance from the high and the low", async () => {
      const { data } = await range([syntheticTicker(6), syntheticTicker(0)]);

      expect(data.items).toHaveLength(2);
      const first = data.items[0];
      const second = data.items[1];
      if (!first || !second) throw new Error("expected two range items");
      expect(first).toMatchObject({
        isin: syntheticIsin(6),
        price: at(PRICE_BY_INDEX, 6),
        h52: at(H52_BY_INDEX, 6),
        h52Date: "2026-06-01",
        l52: at(L52_BY_INDEX, 6),
        l52Date: "2026-01-15",
      });
      expect(first.fromHighPct).toBeCloseTo(percentFrom(at(PRICE_BY_INDEX, 6), at(H52_BY_INDEX, 6)), PERCENT_PRECISION);
      expect(first.fromLowPct).toBeCloseTo(percentFrom(at(PRICE_BY_INDEX, 6), at(L52_BY_INDEX, 6)), PERCENT_PRECISION);
      expect(second.fromHighPct).toBeCloseTo(percentFrom(at(PRICE_BY_INDEX, 0), at(H52_BY_INDEX, 0)), PERCENT_PRECISION);
      expect(second.fromLowPct).toBeCloseTo(percentFrom(at(PRICE_BY_INDEX, 0), at(L52_BY_INDEX, 0)), PERCENT_PRECISION);
    });

    it("resolves ISINs as well as tickers", async () => {
      const { data } = await range([syntheticIsin(3)]);

      expect(isinsOf(data.items)).toEqual([syntheticIsin(3)]);
    });

    it("reports adjustmentPending from an affected entry whose ex date has been reached", async () => {
      await seedStats(
        statsFor(TODAY, {
          0: [pendingEntry()],
          1: [pendingEntry({ adjAffected: false })],
          2: [pendingEntry({ exDate: FUTURE_EX_DATE })],
        }),
      );

      const { data, meta } = await range([syntheticTicker(0), syntheticTicker(1), syntheticTicker(2), syntheticTicker(3)]);

      expect(data.items.map((item) => item.adjustmentPending)).toEqual([true, false, false, false]);
      expect(adjustedNotice(meta)).toEqual([{ field: "adjusted", reason: OWNER_RATIO_REASON }]);
    });

    it("flags a served quote older than the previous session and names its trade date", async () => {
      const { quotes = {}, ...rest } = marketSnapshot(TODAY);
      const staleQuote = quotes[syntheticIsin(0)];
      if (!staleQuote) throw new Error("missing quote");
      await seedSnapshot({ ...rest, quotes: { ...quotes, [syntheticIsin(0)]: { ...staleQuote, td: STALE_TRADE_DATE } } });

      const { meta } = await range([syntheticTicker(0)]);

      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toContain(STALE_TRADE_DATE);
    });

    it("is not stale when every served quote traded in the last completed session", async () => {
      const { meta } = await range([syntheticTicker(0)]);

      expect(meta.stale).toBe(false);
      expect(meta.staleReason).toBeNull();
    });

    it.each([
      ["h52", { h52: 0 }],
      ["l52", { l52: 0 }],
    ])("returns no_data_yet for a symbol whose %s is zero", async (_label, zeroed) => {
      const stats = statsFor(TODAY);
      const isin = syntheticIsin(0);
      const current = stats.symbols?.[isin];
      if (!current) throw new Error("missing stats");
      await seedStats({ ...stats, symbols: { ...stats.symbols, [isin]: { ...current, ...zeroed } } });

      const result = payloadOf<{ items: (RangeItem | RangeNoData)[] }>(
        await callTool(RANGE_TOOL, { symbols: [syntheticTicker(0), syntheticTicker(1)] }, key),
      );

      expect(result.data.items[0]).toMatchObject({ isin, ticker: syntheticTicker(0), status: "no_data_yet" });
      expect(result.data.items[1]).toMatchObject({ isin: syntheticIsin(1), price: at(PRICE_BY_INDEX, 1) });
    });

    it("rejects an empty symbol list as invalid_input", async () => {
      const result = await callTool(RANGE_TOOL, { symbols: [] }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("rejects more than 20 symbols as invalid_input", async () => {
      const symbols = Array.from({ length: OVER_LIMIT }, () => syntheticTicker(0));

      const result = await callTool(RANGE_TOOL, { symbols }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("fails with not_found for an unknown symbol", async () => {
      const result = await callTool(RANGE_TOOL, { symbols: ["ZZZZ"] }, key);

      expect(errorCodeOf(result)).toBe("not_found");
    });
  });

  describe("get_sector_performance", () => {
    it("returns the median return, advancers, decliners and symbol count per sector", async () => {
      const { data } = await sectors("1m");

      const bySector = Object.fromEntries(data.sectors.map((entry) => [entry.sector, entry]));
      expect(Object.keys(bySector).sort()).toEqual([BANKS, REAL_ESTATE]);
      expect(bySector[BANKS]).toMatchObject({ medianReturnPct: 4, advancers: 2, decliners: 1, symbols: 3 });
      expect(bySector[REAL_ESTATE]).toMatchObject({ medianReturnPct: 3, advancers: 3, decliners: 1, symbols: 4 });
    });

    it("rejects an unknown period as invalid_input", async () => {
      const result = await callTool(SECTOR_TOOL, { period: "5y" }, key);

      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("marks a sector pending when one of its symbols has an affected action whose ex date has been reached", async () => {
      await seedStats(statsFor(TODAY, { 6: [pendingEntry()] }));

      const { data } = await sectors("1m");

      const bySector = Object.fromEntries(data.sectors.map((entry) => [entry.sector, entry.adjustmentPending]));
      expect(bySector).toEqual({ [BANKS]: false, [REAL_ESTATE]: true });
    });
  });

  describe("ex-date session before the next stats build", () => {
    const exDateToday = { 0: [pendingEntry({ exDate: TODAY })] };

    beforeEach(async () => {
      await seedStats(statsFor(LAST_THURSDAY, exDateToday));
    });

    it("leaves get_52_week_range pending false on the day before the ex date", async () => {
      setNow(THURSDAY_AFTER_CLOSE);
      await seedSnapshot(marketSnapshot(LAST_THURSDAY));

      const { data, meta } = await range([syntheticTicker(0)]);

      expect(data.items[0]?.adjustmentPending).toBe(false);
      expect(adjustedNotice(meta)).toEqual([]);
    });

    it("leaves get_movers near_52w_low pending false on the day before the ex date", async () => {
      setNow(THURSDAY_AFTER_CLOSE);
      await seedSnapshot(marketSnapshot(LAST_THURSDAY));

      const items = await movers("near_52w_low", NEAR_LOW_ORDER.length);

      expect(items.find((item) => item.isin === syntheticIsin(0))?.adjustmentPending).toBe(false);
    });

    it("sets get_52_week_range pending true on the ex date before that day's stats build", async () => {
      const { data, meta } = await range([syntheticTicker(0)]);

      expect(data.items[0]?.adjustmentPending).toBe(true);
      expect(adjustedNotice(meta)).toEqual([{ field: "adjusted", reason: OWNER_RATIO_REASON }]);
    });

    it("sets get_movers near_52w_low pending true on the ex date before that day's stats build", async () => {
      const items = await movers("near_52w_low", NEAR_LOW_ORDER.length);

      expect(items.find((item) => item.isin === syntheticIsin(0))?.adjustmentPending).toBe(true);
    });

    it("sets get_sector_performance pending true for the sector on the ex date", async () => {
      const { data } = await sectors("1m");

      expect(data.sectors.find((entry) => entry.sector === BANKS)?.adjustmentPending).toBe(true);
    });
  });

  describe("missing stats", () => {
    beforeEach(async () => {
      await env.DATA.delete("stats:v1");
    });

    async function expectStatsMissing(result: ToolResult): Promise<void> {
      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("not_available");
      const { error } = result.structuredContent as unknown as { error: { message: string } };
      expect(error.message).toContain(STATS_MISSING_REASON);
    }

    it("fails get_movers near_52w_high", async () => {
      await expectStatsMissing(await callTool(MOVERS_TOOL, { kind: "near_52w_high", limit: LIMITED }, key));
    });

    it("fails get_movers near_52w_low", async () => {
      await expectStatsMissing(await callTool(MOVERS_TOOL, { kind: "near_52w_low", limit: LIMITED }, key));
    });

    it("fails get_movers unusual_volume", async () => {
      await expectStatsMissing(await callTool(MOVERS_TOOL, { kind: "unusual_volume", limit: LIMITED }, key));
    });

    it("fails get_52_week_range", async () => {
      await expectStatsMissing(await callTool(RANGE_TOOL, { symbols: [syntheticTicker(0)] }, key));
    });

    it("fails get_sector_performance", async () => {
      await expectStatsMissing(await callTool(SECTOR_TOOL, { period: "1m" }, key));
    });
  });
});
