import { describe, expect, it } from "vitest";
import { TOOL_DESCRIPTIONS } from "../../src/mcp/tool-descriptions";
import { TOOL_NAMES, type ToolName } from "../../src/mcp/tool-names";
import { TOOL_GROUPS, toolEntries } from "../../src/site/tool-catalog";
import { MAX_ITEMS_PER_USER } from "../../src/store/d1/personal";

const EXPECTED_ORDER: readonly ToolName[] = [
  "search",
  "get_quotes",
  "get_market_overview",
  "get_indices",
  "get_movers",
  "get_52_week_range",
  "get_sector_performance",
  "get_daily_summary",
  "get_price_history",
  "compare_symbols",
  "get_index_history",
  "get_index_summary",
  "get_fund",
  "get_fund_history",
  "compare_funds",
  "get_real_return",
  "get_company_profile",
  "get_dividends",
  "get_corporate_actions",
  "get_financials",
  "get_metals",
  "get_usd_egp",
  "portfolio_get",
  "portfolio_upsert_holding",
  "portfolio_remove_holding",
  "price_level_set",
  "price_level_remove",
  "price_levels_list",
  "what_changed_since",
  "admin",
];

const EXPECTED_GROUPS = [
  { id: "find", label: "Find and quote", intro: "Find a stock or fund and get its delayed quote." },
  { id: "market", label: "Market today", intro: "The state of the market from the latest delayed snapshot." },
  { id: "history", label: "History", intro: "End-of-day prices and index closes, up to 5 years per request." },
  { id: "funds", label: "Funds", intro: "Egyptian mutual funds with daily NAVs." },
  {
    id: "company",
    label: "Company data",
    intro: "Company profiles, dividends, corporate actions and stored figures.",
  },
  { id: "metals", label: "Gold and currency", intro: "Gold, silver and the dollar rate in Egypt." },
  {
    id: "personal",
    label: "Your portfolio and price levels",
    intro: `Personal tools that work only on your own data, up to ${MAX_ITEMS_PER_USER} holdings and ${MAX_ITEMS_PER_USER} price levels. EGX MCP never pushes alerts; crossings show when you ask.`,
  },
  { id: "owner", label: "Owner only", intro: "Maintenance for the service owner." },
];

const SPOT_CHECKS = {
  search: {
    group: "find",
    example: "Which EGX stocks have cement in the name?",
    returns: "Matching stocks and funds with ticker, ISIN and Arabic and English names.",
  },
  get_metals: {
    group: "metals",
    example: "What is the gold 21K price and the gold pound price in Egypt today?",
    returns:
      "Egyptian gold and silver buy and sell prices per gram, the gold pound and global spot prices in USD.",
  },
  admin: {
    group: "owner",
    example: "As the owner, list the open notices.",
    returns: "Owner maintenance results; every other account gets a forbidden answer.",
  },
} as const;

describe("tool catalog", () => {
  it("lists every tool exactly once", () => {
    const names = toolEntries().map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("orders the tools by group, then by the published table", () => {
    expect(toolEntries().map((entry) => entry.name)).toEqual(EXPECTED_ORDER);
  });

  it("uses the shared tool description for every entry", () => {
    for (const entry of toolEntries()) expect(entry.description).toBe(TOOL_DESCRIPTIONS[entry.name]);
  });

  it("holds the published group labels and intros in order", () => {
    expect(TOOL_GROUPS).toEqual(EXPECTED_GROUPS);
  });

  it("gives every entry a known group, an example and a returns text", () => {
    const groupIds = TOOL_GROUPS.map((group) => group.id);
    for (const entry of toolEntries()) {
      expect(groupIds).toContain(entry.group);
      expect(entry.example).not.toBe("");
      expect(entry.returns).not.toBe("");
    }
  });

  for (const [name, expected] of Object.entries(SPOT_CHECKS)) {
    it(`holds the published text of ${name}`, () => {
      const entry = toolEntries().find((candidate) => candidate.name === name);
      expect(entry).toMatchObject(expected);
    });
  }
});
