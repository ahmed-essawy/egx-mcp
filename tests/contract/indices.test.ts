import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { EGX30_VALUE, indexEntry, INDEX_SOURCE, MARKET_TRADE_TIME_ISO, STOCKS_SOURCE } from "../helpers/market";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { seedKey, seedSnapshot, seedUser, setNow } from "../helpers/seed";
import { cairoSummerEpoch } from "../helpers/time";

const AFTER_CLOSE = cairoSummerEpoch("2026-10-25", "15:00");
const USER_EMAIL = "user@example.com";
const SESSION_DATE = "2026-10-25";
const INDICES_TOOL = "get_indices";
const MAX_NAMES = 10;
const OVER_NAMES = 11;
const NOT_AVAILABLE_REASON = "not available from current sources";
const AVAILABLE_CODES = ["EGX30", "EGX30CAPPED", "EGX70EWI", "EGX100EWI"];
const SEEDED: Record<string, { name: string; value: number; changePct: number }> = {
  EGX30: { name: "EGX 30 Index", value: EGX30_VALUE, changePct: -3.56 },
  EGX30CAPPED: { name: "EGX 30 Capped Index", value: 63120.8, changePct: -3.1 },
  EGX70EWI: { name: "EGX 70 EWI Index", value: 11234.5, changePct: 0.42 },
  EGX100EWI: { name: "EGX 100 EWI Index", value: 17890.2, changePct: -0.15 },
};

type IndexItem = Record<string, unknown> & { code: string };
type IndicesMeta = {
  label: string;
  source: string | null;
  session: { date: string; status: string } | null;
};
type IndicesPayload = { data: { indices: IndexItem[] }; meta: IndicesMeta };

function indicesSnapshot(): Partial<Snapshot> {
  const indices = Object.fromEntries(
    Object.entries(SEEDED).map(([code, seeded]) => [code, indexEntry(seeded.value, seeded.changePct)]),
  );
  return { sources: { stocks: STOCKS_SOURCE, primaryFailed: true }, indices };
}

function payloadOf(result: ToolResult): IndicesPayload {
  return structuredPayloadOf<IndicesPayload>(result);
}

async function indicesFor(names: string[], key: string): Promise<IndexItem[]> {
  return payloadOf(await callTool(INDICES_TOOL, { names }, key)).data.indices;
}

describe("get_indices contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(AFTER_CLOSE);
    await clearState();
    key = await seedKey(await seedUser(USER_EMAIL));
    await seedSnapshot(indicesSnapshot());
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns the four available indices for an empty list", async () => {
    const indices = await indicesFor([], key);

    expect(indices.filter((item) => item.status === undefined).map((item) => item.code)).toEqual(AVAILABLE_CODES);
  });

  it("returns code, name, value, changePct, dataTime and source for each index", async () => {
    const indices = await indicesFor([], key);

    for (const code of AVAILABLE_CODES) {
      const item = indices.find((entry) => entry.code === code);
      expect(item).toBeDefined();
      expect(item).toMatchObject({ ...SEEDED[code], dataTime: MARKET_TRADE_TIME_ISO, source: INDEX_SOURCE });
    }
  });

  it("labels the response delayed with the snapshot source and session", async () => {
    const { meta } = payloadOf(await callTool(INDICES_TOOL, { names: [] }, key));

    expect(meta.label).toBe("delayed");
    expect(meta.source).toBe(INDEX_SOURCE);
    expect(meta.session).toEqual({ date: SESSION_DATE, status: "closed" });
  });

  it.each([
    ["EGX70", "EGX70EWI"],
    ["EGX100", "EGX100EWI"],
    ["EGX30 capped", "EGX30CAPPED"],
    ["egx 30", "EGX30"],
    ["EGX70EWI", "EGX70EWI"],
  ])("resolves %s to %s", async (input, code) => {
    const indices = await indicesFor([input], key);

    expect(indices).toHaveLength(1);
    expect(indices[0]).toMatchObject({ code, ...SEEDED[code] });
  });

  it("returns only the requested indices in the requested order", async () => {
    const indices = await indicesFor(["EGX100", "EGX30"], key);

    expect(indices.map((item) => item.code)).toEqual(["EGX100EWI", "EGX30"]);
  });

  it("reports EGX30 USD as not_available", async () => {
    const indices = await indicesFor(["EGX30 USD"], key);

    expect(indices).toEqual([{ code: "EGX30USD", status: "not_available", reason: NOT_AVAILABLE_REASON }]);
  });

  it("accepts 10 names", async () => {
    const result = await callTool(INDICES_TOOL, { names: Array(MAX_NAMES).fill("EGX30") }, key);

    expect(result.isError).toBeFalsy();
  });

  it("rejects more than 10 names as invalid_input", async () => {
    const result = await callTool(INDICES_TOOL, { names: Array(OVER_NAMES).fill("EGX30") }, key);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe("invalid_input");
  });
});
