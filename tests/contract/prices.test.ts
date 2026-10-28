import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedUser, setNow, SNAPSHOT_KEY } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const NOW = cairoSummerEpoch("2026-10-25", "12:00");
const USER_EMAIL = "user@example.com";
const METALS_TOOL = "get_metals";
const FX_TOOL = "get_usd_egp";
const NOT_AVAILABLE_REASON = "not available from current sources";
const EGYPT_SOURCE = "isagha";
const MARKET_SOURCE = "tradingview";
const EGYPT_UNIT = "EGP/g";
const POUND_UNIT = "EGP/piece";
const SPOT_UNIT = "USD/oz";
const FETCHED_AT = cairoSummerEpoch("2026-10-25", "11:45");
const FETCHED_AT_ISO = "2026-10-25T11:45:00+03:00";
const TICK_TIME = cairoSummerEpoch("2026-10-25", "11:58");
const TICK_TIME_ISO = "2026-10-25T11:58:00+03:00";
const EGYPT_KEYS = ["gold18k", "gold21k", "gold24k", "goldPound", "silver925", "silver999"];
const SEEDED_EGYPT = {
  src: EGYPT_SOURCE,
  fetchedAt: FETCHED_AT,
  unit: EGYPT_UNIT,
  gold: {
    "18": { buy: 5360, sell: 5400 },
    "21": { buy: 6255, sell: 6300 },
    "24": { buy: 7150, sell: 7200 },
    pound: { buy: 50040, sell: 50400 },
  },
  silver: {
    "925": { buy: 80, sell: 85 },
    "999": { buy: 86, sell: 90 },
  },
};
const EXPECTED_EGYPT: Record<string, { buy: number; sell: number }> = {
  gold18k: SEEDED_EGYPT.gold["18"],
  gold21k: SEEDED_EGYPT.gold["21"],
  gold24k: SEEDED_EGYPT.gold["24"],
  goldPound: SEEDED_EGYPT.gold.pound,
  silver925: SEEDED_EGYPT.silver["925"],
  silver999: SEEDED_EGYPT.silver["999"],
};
const GOLD_SPOT = 4012.5;
const SILVER_SPOT = 48.25;
const USD_EGP_RATE = 48.52;
const UNROUNDED_RATE = 48.523456;
const ROUNDED_RATE = 48.5235;
const STALE_EGYPT_AGE_SECONDS = 27 * 3600;
const NOTICE = "Delayed, unofficial data for information only. Not investment advice.";

type Item = Record<string, unknown>;
type MetalsPayload = {
  data: { egypt: Record<string, Item>; global: Record<string, Item> };
  meta: Meta;
  notice: string;
};
type FxPayload = { data: Item; meta: Meta; notice: string };
type Meta = { label: string; dataTime: string | null; source: string | null; stale: boolean; staleReason: string | null };

function spot(value: number) {
  return { v: value, unit: SPOT_UNIT, tt: TICK_TIME, src: MARKET_SOURCE };
}

function globalMetals(): Partial<Snapshot["metals"]> {
  return { XAUUSD: spot(GOLD_SPOT), XAGUSD: spot(SILVER_SPOT) };
}

function pricesSnapshot(withEgypt: boolean): Partial<Snapshot> {
  const metals = withEgypt ? { ...globalMetals(), egypt: SEEDED_EGYPT } : globalMetals();
  return {
    metals,
    fx: { USDEGP: { v: USD_EGP_RATE, tt: TICK_TIME, src: MARKET_SOURCE, kind: "market" } },
  };
}

async function metalsFor(key: string): Promise<MetalsPayload> {
  const result: ToolResult = await callTool(METALS_TOOL, {}, key);
  return structuredPayloadOf<MetalsPayload>(result);
}

describe("prices contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(NOW);
    await clearState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSnapshot(pricesSnapshot(true));
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("get_metals", () => {
    it.each(EGYPT_KEYS)("returns %s with buy, sell, unit, dataTime and source", async (name) => {
      const { data } = await metalsFor(key);

      expect(data.egypt[name]).toEqual({
        ...EXPECTED_EGYPT[name],
        unit: name === "goldPound" ? POUND_UNIT : EGYPT_UNIT,
        dataTime: FETCHED_AT_ISO,
        dataTimeKind: "fetched",
        source: EGYPT_SOURCE,
      });
    });

    it.each([
      ["XAUUSD", GOLD_SPOT],
      ["XAGUSD", SILVER_SPOT],
    ])("returns global %s with value, unit, dataTime and source", async (code, value) => {
      const { data } = await metalsFor(key);

      expect(data.global[code]).toEqual({ value, unit: SPOT_UNIT, dataTime: TICK_TIME_ISO, source: MARKET_SOURCE });
    });

    it("labels the response delayed", async () => {
      const { meta } = await metalsFor(key);

      expect(meta.label).toBe("delayed");
    });

    it("carries the notice, the newest data time and the source in meta", async () => {
      const { meta, notice } = await metalsFor(key);

      expect(notice).toBe(NOTICE);
      expect(meta.dataTime).toBe(TICK_TIME_ISO);
      expect(meta.source).toBe(MARKET_SOURCE);
    });

    it("rounds spot prices to 4 decimals", async () => {
      await seedSnapshot({ metals: { XAUUSD: { ...spot(GOLD_SPOT), v: UNROUNDED_RATE } } });

      const { data } = await metalsFor(key);

      expect(data.global.XAUUSD).toMatchObject({ value: ROUNDED_RATE });
    });

    it("fails with not_available when the snapshot is missing", async () => {
      await env.DATA.delete(SNAPSHOT_KEY);

      const result = await callTool(METALS_TOOL, {}, key);

      expect(errorCodeOf(result)).toBe("not_available");
      expect(result.structuredContent).toMatchObject({ notice: NOTICE });
    });

    it("returns not_available for each Egypt item when metals.egypt is absent", async () => {
      await seedSnapshot(pricesSnapshot(false));

      const { data } = await metalsFor(key);

      for (const name of EGYPT_KEYS) {
        expect(data.egypt[name]).toEqual({ status: "not_available", reason: NOT_AVAILABLE_REASON });
      }
    });

    it("returns goldPound as not_available and keeps the other Egypt items when the pound is missing", async () => {
      const { pound: _pound, ...goldWithoutPound } = SEEDED_EGYPT.gold;
      await seedSnapshot({ metals: { ...globalMetals(), egypt: { ...SEEDED_EGYPT, gold: goldWithoutPound } } });

      const { data } = await metalsFor(key);

      expect(data.egypt.goldPound).toEqual({ status: "not_available", reason: NOT_AVAILABLE_REASON });
      expect(data.egypt.gold24k).toMatchObject(SEEDED_EGYPT.gold["24"]);
    });

    it("keeps the global spot prices when metals.egypt is absent", async () => {
      await seedSnapshot(pricesSnapshot(false));

      const { data } = await metalsFor(key);

      expect(data.global.XAUUSD).toMatchObject({ value: GOLD_SPOT, source: MARKET_SOURCE });
      expect(data.global.XAGUSD).toMatchObject({ value: SILVER_SPOT, source: MARKET_SOURCE });
    });
  });

  describe("get_metals staleness", () => {
    it("is stale with the egypt reason when the egypt prices are 27 hours old", async () => {
      const fetchedAt = NOW - STALE_EGYPT_AGE_SECONDS;
      await seedSnapshot({ metals: { ...globalMetals(), egypt: { ...SEEDED_EGYPT, fetchedAt } } });

      const { meta } = await metalsFor(key);

      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toContain("Egypt retail prices fetched at");
    });
  });

  describe("get_usd_egp", () => {
    it("returns rate, kind market, dataTime and source", async () => {
      const { data } = structuredPayloadOf<FxPayload>(await callTool(FX_TOOL, {}, key));

      expect(data).toEqual({
        rate: USD_EGP_RATE,
        kind: "market",
        dataTime: TICK_TIME_ISO,
        source: MARKET_SOURCE,
      });
    });

    it("labels the response delayed", async () => {
      const { meta } = structuredPayloadOf<FxPayload>(await callTool(FX_TOOL, {}, key));

      expect(meta.label).toBe("delayed");
    });

    it("carries the notice, the data time and the source in meta", async () => {
      const { meta, notice } = structuredPayloadOf<FxPayload>(await callTool(FX_TOOL, {}, key));

      expect(notice).toBe(NOTICE);
      expect(meta.dataTime).toBe(TICK_TIME_ISO);
      expect(meta.source).toBe(MARKET_SOURCE);
    });

    it("rounds the rate to 4 decimals", async () => {
      await seedSnapshot({ fx: { USDEGP: { v: UNROUNDED_RATE, tt: TICK_TIME, src: MARKET_SOURCE, kind: "market" } } });

      const { data } = structuredPayloadOf<FxPayload>(await callTool(FX_TOOL, {}, key));

      expect(data.rate).toBe(ROUNDED_RATE);
    });

    it("fails with not_available when the snapshot is missing", async () => {
      await env.DATA.delete(SNAPSHOT_KEY);

      const result = await callTool(FX_TOOL, {}, key);

      expect(errorCodeOf(result)).toBe("not_available");
      expect(result.structuredContent).toMatchObject({ notice: NOTICE });
    });

    it("fails with not_available when fx.USDEGP is missing", async () => {
      await seedSnapshot({ fx: {} });

      const result = await callTool(FX_TOOL, {}, key);

      expect(errorCodeOf(result)).toBe("not_available");
      expect(result.structuredContent).toMatchObject({ notice: NOTICE });
    });
  });
});
