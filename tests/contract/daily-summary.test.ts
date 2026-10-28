import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import {
  directoryFor,
  EGX30_VALUE,
  indexEntry,
  MARKET_BREADTH,
  MARKET_ISINS,
  MARKET_TOTALS,
  MARKET_TRADE_TIME_ISO,
  marketSnapshot,
  MOVERS_IN_SNAPSHOT,
  STOCKS_SOURCE,
  TOP_GAINER,
  TOP_LOSER,
  type Mover,
} from "../helpers/market";
import { callTool, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import {
  defaultSnapshot,
  seedKey,
  seedLastSessionSnapshot,
  seedSnapshot,
  seedSymbols,
  seedUser,
  setNow,
  syntheticIsin,
} from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const AFTER_CLOSE = cairoSummerEpoch("2026-10-25", "15:00");
const NEXT_MORNING = cairoSummerEpoch("2026-10-26", "11:00");
const USER_EMAIL = "user@example.com";
const LAST_SESSION_DATE = "2026-10-25";
const NEXT_SESSION_DATE = "2026-10-26";
const SUMMARY_TOOL = "get_daily_summary";
const TOP_COUNT = 5;
const SUMMARY_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers"];
const SUMMARY_FIELDS = ["indices", "breadth", "topGainers", "topLosers", "totals"];

type SummaryData = {
  indices: { code: string; value: number }[];
  breadth: { advancers: number; decliners: number; unchanged: number };
  topGainers: Mover[];
  topLosers: Mover[];
  totals: { volume: number; value: number };
};
type SummaryPayload = {
  data: SummaryData;
  meta: {
    label: string;
    dataTime: string | null;
    source: string | null;
    session: { date: string; status: string } | null;
    provenance: Record<string, unknown>[];
  };
};

function otherSessionSnapshot(session: Partial<Snapshot["session"]>): Partial<Snapshot> {
  return {
    session: { ...defaultSnapshot().session, ...session },
    indices: { EGX30: indexEntry(50000, 1.5) },
    breadth: { advancers: 40, decliners: 10, unchanged: 5 },
    totals: { volume: 1, value: 2 },
    top: { gainers: [syntheticIsin(0)], losers: [syntheticIsin(MOVERS_IN_SNAPSHOT - 1)], byVolume: [], byValue: [] },
  };
}

function closedLastSession(): Partial<Snapshot> {
  return {
    ...marketSnapshot(LAST_SESSION_DATE),
    session: { ...defaultSnapshot().session, date: LAST_SESSION_DATE, status: "closed" },
  };
}

function payloadOf(result: ToolResult): SummaryPayload {
  return structuredPayloadOf<SummaryPayload>(result);
}

describe("get_daily_summary contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    await clearState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSymbols(directoryFor(MOVERS_IN_SNAPSHOT));
    await seedLastSessionSnapshot(closedLastSession());
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("after the close", () => {
    beforeEach(async () => {
      await seedSnapshot(otherSessionSnapshot({ date: LAST_SESSION_DATE, status: "closed" }));
    });

    it("returns indices, breadth, top movers and totals of the last completed session", async () => {
      const { data } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      for (const field of SUMMARY_FIELDS) expect(data).toHaveProperty(field);
      expect(data.indices.map((entry) => entry.code)).toEqual(expect.arrayContaining(["EGX30", "EGX70EWI"]));
      expect(data.breadth).toEqual(MARKET_BREADTH);
      expect(data.totals).toEqual(MARKET_TOTALS);
    });

    it("lists the top 5 gainers and losers as quote summaries", async () => {
      const { data } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      expect(data.topGainers.map((mover) => mover.isin)).toEqual([...MARKET_ISINS].reverse().slice(0, TOP_COUNT));
      expect(data.topLosers.map((mover) => mover.isin)).toEqual(MARKET_ISINS.slice(0, TOP_COUNT));
      expect(data.topGainers[0]).toMatchObject(TOP_GAINER);
      expect(data.topLosers[0]).toMatchObject(TOP_LOSER);
    });

    it("labels the summary end_of_day with the session closed", async () => {
      const { meta } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      expect(meta.label).toBe("end_of_day");
      expect(meta.source).toBe(STOCKS_SOURCE);
      expect(meta.dataTime).toBe(MARKET_TRADE_TIME_ISO);
      expect(meta.session).toEqual({ date: LAST_SESSION_DATE, status: "closed" });
    });

    it("reports the indices and the summary mover fields with the close time kind", async () => {
      const { meta } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      expect(meta.provenance).toHaveLength(2);
      expect(meta.provenance[0]).toMatchObject({
        fields: ["indices"],
        dataTime: LAST_SESSION_DATE,
        timeKind: "close",
        basis: "primary",
      });
      expect(meta.provenance[1]).toMatchObject({
        fields: SUMMARY_MOVER_FIELDS,
        source: STOCKS_SOURCE,
        dataTime: LAST_SESSION_DATE,
        timeKind: "close",
        basis: "computed",
      });
    });
  });

  describe("during the next session", () => {
    beforeEach(async () => {
      setNow(NEXT_MORNING);
      await seedSnapshot(otherSessionSnapshot({ date: NEXT_SESSION_DATE, status: "open" }));
    });

    it("describes the previous completed session from the stored last-session snapshot", async () => {
      const { data } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      expect(data.breadth).toEqual(MARKET_BREADTH);
      expect(data.totals).toEqual(MARKET_TOTALS);
      expect(data.indices.find((entry) => entry.code === "EGX30")).toMatchObject({ value: EGX30_VALUE });
      expect(data.topGainers).toHaveLength(TOP_COUNT);
      expect(data.topGainers[0]).toMatchObject(TOP_GAINER);
      expect(data.topLosers[0]).toMatchObject(TOP_LOSER);
    });

    it("reports the previous session date as closed and labels it end_of_day", async () => {
      const { meta } = payloadOf(await callTool(SUMMARY_TOOL, {}, key));

      expect(meta.label).toBe("end_of_day");
      expect(meta.session).toEqual({ date: LAST_SESSION_DATE, status: "closed" });
    });
  });
});
