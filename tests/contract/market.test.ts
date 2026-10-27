import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearState, restoreBindings } from "../helpers/bindings";
import {
  directoryFor,
  INDEX_SOURCE,
  MARKET_BREADTH,
  MARKET_ISINS,
  MARKET_TOTALS,
  MARKET_TRADE_TIME_ISO,
  STOCKS_SOURCE,
  TOP_GAINER,
  TOP_LOSER,
  marketSnapshot,
  MOVERS_IN_SNAPSHOT,
  type Mover,
} from "../helpers/market";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { defaultSnapshot, seedKey, seedSnapshot, seedSymbols, seedUser, setNow, syntheticTicker } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const AFTER_CLOSE = cairoSummerEpoch("2026-10-25", "15:00");
const MORNING = cairoSummerEpoch("2026-10-25", "11:00");
const FRIDAY_NOON = cairoSummerEpoch("2026-10-23", "12:00");
const USER_EMAIL = "user@example.com";
const SESSION_DATE = "2026-10-25";
const LAST_SESSION_BEFORE_WEEKEND = "2026-10-22";
const OVERVIEW_TOOL = "get_market_overview";
const INDICES_TOOL = "get_indices";
const QUOTES_TOOL = "get_quotes";
const MAX_TOP = 10;
const OVER_TOP = 11;
const DEFAULT_TOP = 5;
const LIMITED_TOP = 2;
const OVERVIEW_FIELDS = [
  "status",
  "indices",
  "breadth",
  "topGainers",
  "topLosers",
  "mostActiveByVolume",
  "mostActiveByValue",
  "totals",
  "investorStats",
];
const NOT_AVAILABLE_REASON = "not available from current sources";

type MarketMeta = {
  label: string;
  dataTime: string | null;
  source: string | null;
  session: { date: string; status: string } | null;
  notAvailable: { field: string; reason: string }[];
};
type OverviewData = {
  status: string;
  indices: { code: string }[];
  breadth: { advancers: number; decliners: number; unchanged: number };
  topGainers: Mover[];
  topLosers: Mover[];
  mostActiveByVolume: Mover[];
  mostActiveByValue: Mover[];
  totals: { volume: number; value: number };
  investorStats: null;
};
type MarketPayload<T> = { data: T; meta: MarketMeta };

function payloadOf<T>(result: ToolResult): MarketPayload<T> {
  return structuredPayloadOf<MarketPayload<T>>(result);
}

function isinsOf(movers: Mover[]): string[] {
  return movers.map((mover) => mover.isin);
}

describe("market contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    await clearState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSymbols(directoryFor(MOVERS_IN_SNAPSHOT));
    await seedSnapshot(marketSnapshot(SESSION_DATE));
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_market_overview", () => {
    it("returns every contract field with delayed labelling", async () => {
      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      for (const field of OVERVIEW_FIELDS) expect(data).toHaveProperty(field);
      expect(data.status).toBe("closed");
      expect(data.breadth).toEqual(MARKET_BREADTH);
      expect(data.totals).toEqual(MARKET_TOTALS);
      expect(data.indices.map((entry) => entry.code)).toEqual(expect.arrayContaining(["EGX30", "EGX70EWI"]));
      expect(data.indices.find((entry) => entry.code === "EGX30")).toMatchObject({
        code: "EGX30",
        source: INDEX_SOURCE,
        dataTime: MARKET_TRADE_TIME_ISO,
      });
      expect(meta.label).toBe("delayed");
      expect(meta.source).toBe(STOCKS_SOURCE);
      expect(meta.dataTime).toBe(MARKET_TRADE_TIME_ISO);
    });

    it("lists movers as quote summaries in the order the snapshot ranks them", async () => {
      const { data } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, { top: MOVERS_IN_SNAPSHOT }, key));

      expect(isinsOf(data.topGainers)).toEqual([...MARKET_ISINS].reverse());
      expect(isinsOf(data.topLosers)).toEqual(MARKET_ISINS);
      expect(isinsOf(data.mostActiveByVolume)).toEqual([...MARKET_ISINS].reverse());
      expect(isinsOf(data.mostActiveByValue)).toEqual(MARKET_ISINS);
      expect(data.topGainers[0]).toMatchObject(TOP_GAINER);
      expect(data.topLosers[0]).toMatchObject(TOP_LOSER);
    });

    it("shows 5 movers per list by default and honours top", async () => {
      const defaulted = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key)).data;
      const limited = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, { top: LIMITED_TOP }, key)).data;

      expect(defaulted.topGainers).toHaveLength(DEFAULT_TOP);
      expect(defaulted.mostActiveByValue).toHaveLength(DEFAULT_TOP);
      expect(limited.topLosers).toHaveLength(LIMITED_TOP);
      expect(limited.mostActiveByVolume).toHaveLength(LIMITED_TOP);
    });

    it("accepts top 10", async () => {
      const result = await callTool(OVERVIEW_TOOL, { top: MAX_TOP }, key);

      expect(result.isError).toBeFalsy();
    });

    it("rejects top above 10 as invalid_input", async () => {
      const result = await callTool(OVERVIEW_TOOL, { top: OVER_TOP }, key);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("returns investorStats null with a notAvailable reason", async () => {
      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(data.investorStats).toBeNull();
      expect(meta.notAvailable).toContainEqual({ field: "investorStats", reason: NOT_AVAILABLE_REASON });
    });

    it("reports the session closed with today as the session date after the close", async () => {
      const { meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(meta.session).toEqual({ date: SESSION_DATE, status: "closed" });
    });

    it("reports the last session date on a weekend day", async () => {
      setNow(FRIDAY_NOON);
      await seedSnapshot(marketSnapshot(LAST_SESSION_BEFORE_WEEKEND));

      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(meta.session?.date).toBe(LAST_SESSION_BEFORE_WEEKEND);
      expect(data.status).toBe("closed");
    });
  });

  describe("a trading day missing from the calendar", () => {
    beforeEach(async () => {
      setNow(MORNING);
      const { breadth, totals, top, session } = defaultSnapshot();
      await seedSnapshot({
        ...marketSnapshot(LAST_SESSION_BEFORE_WEEKEND),
        breadth,
        totals,
        top,
        session: { ...session, date: SESSION_DATE, status: "closed", noTradesToday: true },
      });
    });

    it("reports get_market_overview as closed instead of the calendar status open", async () => {
      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(meta.session).toMatchObject({ date: SESSION_DATE, status: "closed" });
      expect(data.status).toBe("closed");
    });

    it("reports get_indices as closed", async () => {
      const { meta } = payloadOf<unknown>(await callTool(INDICES_TOOL, { names: [] }, key));

      expect(meta.session).toMatchObject({ date: SESSION_DATE, status: "closed" });
    });

    it("reports get_quotes as closed", async () => {
      const { meta } = payloadOf<unknown>(await callTool(QUOTES_TOOL, { symbols: [syntheticTicker(0)] }, key));

      expect(meta.session).toMatchObject({ date: SESSION_DATE, status: "closed" });
    });
  });

  describe("during the session on a normal trading day", () => {
    beforeEach(() => {
      setNow(MORNING);
    });

    it("reports the calendar status open instead of a stored closed status", async () => {
      await seedSnapshot({
        ...marketSnapshot(SESSION_DATE),
        session: { ...defaultSnapshot().session, date: SESSION_DATE, status: "closed", noTradesToday: false },
      });

      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(meta.session).toEqual({ date: SESSION_DATE, status: "open" });
      expect(data.status).toBe("open");
    });

    it("ignores a no-trades flag stored for an earlier session date", async () => {
      await seedSnapshot({
        ...marketSnapshot(LAST_SESSION_BEFORE_WEEKEND),
        session: {
          ...defaultSnapshot().session,
          date: LAST_SESSION_BEFORE_WEEKEND,
          status: "closed",
          noTradesToday: true,
        },
      });

      const { data, meta } = payloadOf<OverviewData>(await callTool(OVERVIEW_TOOL, {}, key));

      expect(meta.session).toEqual({ date: SESSION_DATE, status: "open" });
      expect(data.status).toBe("open");
    });
  });
});
