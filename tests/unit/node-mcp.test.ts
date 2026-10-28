import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "../../src/store/kv";
import { callNodeTool, createNodeStores, listNodeTools, putJson } from "../helpers/node-mcp";

const NOW_MS = Date.UTC(2026, 9, 27, 10, 0, 0);

const TOOL_NAMES = [
  "search",
  "get_quotes",
  "get_market_overview",
  "get_indices",
  "get_daily_summary",
  "get_movers",
  "get_52_week_range",
  "get_sector_performance",
  "get_index_history",
  "get_index_summary",
  "get_metals",
  "get_usd_egp",
  "portfolio_get",
  "portfolio_upsert_holding",
  "portfolio_remove_holding",
  "price_level_set",
  "price_level_remove",
  "price_levels_list",
  "what_changed_since",
  "get_price_history",
  "compare_symbols",
  "get_fund",
  "get_fund_history",
  "compare_funds",
  "get_real_return",
  "get_company_profile",
  "get_dividends",
  "get_corporate_actions",
  "get_financials",
  "admin",
];

const DIRECTORY: Directory = {
  v: 1,
  builtAt: Math.floor(NOW_MS / 1000),
  symbols: [["EGS60081C017", "COMI", "البنك التجاري الدولي", "Commercial International Bank", "Banks", "active", "", "commercial international bank", ["comi"]]],
  tickerToIsin: { COMI: "EGS60081C017" },
  funds: [],
};

type Envelope = {
  data: { results: { ticker?: string }[] };
  meta: { notAvailable: { field: string }[] };
};

describe("node MCP harness", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the registered tools in order", async () => {
    const tools = await listNodeTools(createNodeStores().env);
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
  });

  it("reports a missing directory as not available", async () => {
    const result = await callNodeTool(createNodeStores().env, "search", { query: "COMI" });
    const structured = result.structuredContent as unknown as Envelope;
    expect(result.isError).toBeFalsy();
    expect(structured.data.results).toEqual([]);
    expect(structured.meta.notAvailable[0]?.field).toBe("directory");
  });

  it("finds a stock once the directory is stored", async () => {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    const result = await callNodeTool(stores.env, "search", { query: "COMI" });
    const structured = result.structuredContent as unknown as Envelope;
    expect(structured.data.results).toHaveLength(1);
    expect(structured.data.results[0]?.ticker).toBe("COMI");
  });

  it("names the snapshot as not available for quotes without one", async () => {
    const stores = createNodeStores();
    putJson(stores, "directory:v1", DIRECTORY);
    const result = await callNodeTool(stores.env, "get_quotes", { symbols: ["COMI"] });
    const structured = result.structuredContent as unknown as Envelope;
    expect(result.isError).toBeFalsy();
    expect(structured.meta.notAvailable.map((entry) => entry.field)).toContain("snapshot");
  });

  it("keeps KV and D1 state separate between stores", () => {
    const first = createNodeStores();
    const second = createNodeStores();
    putJson(first, "directory:v1", DIRECTORY);
    first.sqlite.exec("INSERT INTO usage_global (day, calls) VALUES ('2026-10-27', 5)");
    expect(second.kv.size).toBe(0);
    expect(second.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_global").get()).toEqual({ n: 0 });
  });
});
