import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeArabic } from "../../src/domain/arabic";
import type { DirectoryFund } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, type ToolResult } from "../helpers/mcp";
import { seedDirectory, seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const SEARCH_TOOL = "search";
const USER_EMAIL = "user@example.com";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const COMI_NAME_AR = "البنك التجاري الدولي";
const COMI_NAME_EN = "Commercial International Bank";
const BANKING_SECTOR = "Banks";
const CEMENT_QUERY_PLAIN = "اسمنت";
const CEMENT_QUERY_HAMZA = "أسمنت";
const MAX_LIMIT = 20;
const OVER_LIMIT = 21;

type SearchResult = Record<string, unknown> & { type: string };
type SearchMeta = { label: string; source: string | null; notAvailable: { field: string }[] };
type SearchPayload = { data: { results: SearchResult[] }; meta: SearchMeta };

function fund(fundId: string, nameAr: string, nameEn: string | null, manager: string | null): DirectoryFund {
  return [fundId, nameAr, nameEn, manager, "EGP", normalizeArabic(nameAr), normalizeArabic(nameEn ?? "")];
}

async function seedStocksAndFunds(): Promise<void> {
  const symbols = [
    stockSymbol("EGS00000C001", "CMCO", { nameAr: "كوميكو للصناعات", nameEn: "Comico Industries" }),
    stockSymbol(COMI_ISIN, COMI_TICKER, { nameAr: COMI_NAME_AR, nameEn: COMI_NAME_EN, sector: BANKING_SECTOR }),
    stockSymbol("EGS00000C002", "SUCE", { nameAr: "اسمنت السويس", nameEn: "Suez Cement" }),
    stockSymbol("EGS00000C003", "ARCC", { nameAr: "أسمنت العربية", nameEn: "Arabian Cement" }),
  ];
  const funds = [fund("FUND-001", "صندوق البنك الدولي", "Bank Income Fund", "Example Asset Management")];
  await seedSymbols(symbols, funds);
}

async function search(key: string, args: Record<string, unknown>): Promise<ToolResult> {
  return callTool(SEARCH_TOOL, args, key);
}

function payloadOf(result: ToolResult): SearchPayload {
  return structuredPayloadOf<SearchPayload>(result);
}

function resultsOf(result: ToolResult): SearchResult[] {
  return payloadOf(result).data.results;
}

describe("search contract", () => {
  let key: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    await seedSnapshot();
    key = await seedKey(await seedUser(USER_EMAIL));
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("resolving a stock", () => {
    beforeEach(seedStocksAndFunds);

    it.each([COMI_TICKER, COMI_ISIN, COMI_NAME_AR, "Commercial International"])(
      "returns COMI first for %s with the contract fields",
      async (query) => {
        const results = resultsOf(await search(key, { query }));

        expect(results[0]).toMatchObject({
          type: "stock",
          isin: COMI_ISIN,
          ticker: COMI_TICKER,
          nameAr: COMI_NAME_AR,
          nameEn: COMI_NAME_EN,
          sector: BANKING_SECTOR,
          status: "active",
        });
      },
    );

    it("labels the response delayed with the directory as source", async () => {
      const { meta } = payloadOf(await search(key, { query: COMI_TICKER }));

      expect(meta.label).toBe("delayed");
      expect(meta.source).toBe("directory");
    });

    it("returns identical results for an Arabic query with and without the hamza", async () => {
      const plain = resultsOf(await search(key, { query: CEMENT_QUERY_PLAIN }));
      const hamza = resultsOf(await search(key, { query: CEMENT_QUERY_HAMZA }));

      expect(plain.length).toBeGreaterThan(0);
      expect(hamza).toEqual(plain);
    });
  });

  describe("type filter", () => {
    beforeEach(seedStocksAndFunds);

    it("returns only funds for type fund", async () => {
      const results = resultsOf(await search(key, { query: "bank", type: "fund" }));

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result.type === "fund")).toBe(true);
      expect(results[0]).toMatchObject({ fundId: "FUND-001" });
    });

    it("returns both kinds for type any", async () => {
      const types = new Set(resultsOf(await search(key, { query: "bank" })).map((result) => result.type));

      expect(types).toEqual(new Set(["stock", "fund"]));
    });
  });

  describe("limit", () => {
    beforeEach(seedStocksAndFunds);

    it("accepts the maximum limit", async () => {
      expect((await search(key, { query: COMI_TICKER, limit: MAX_LIMIT })).isError).toBeFalsy();
    });

    it("rejects a limit above 20 as invalid_input", async () => {
      const result = await search(key, { query: COMI_TICKER, limit: OVER_LIMIT });

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });
  });

  describe("empty directory", () => {
    it("returns no results and names the directory as not available", async () => {
      await seedDirectory();

      const { data, meta } = payloadOf(await search(key, { query: COMI_TICKER }));

      expect(data.results).toEqual([]);
      expect(meta.notAvailable.map((entry) => entry.field)).toContain("directory");
    });
  });
});
