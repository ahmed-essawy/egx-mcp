import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorySymbol, QuoteEntry, SymbolStatus } from "../../src/store/kv";
import { clearState, restoreBindings } from "../helpers/bindings";
import { callTool, errorCodeOf, payloadOf as structuredPayloadOf, postMcp, type ToolResult } from "../helpers/mcp";
import { DIRECTORY_KEY, seedKey, seedSnapshot, seedSymbols, seedUser, setNow, stockSymbol, syntheticIsin, syntheticTicker } from "../helpers/seed";
import { MS_PER_SECOND } from "../helpers/time";

const GIVEN_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / MS_PER_SECOND;
const QUOTE_TIME = Date.UTC(2026, 9, 25, 8, 30, 0) / MS_PER_SECOND;
const QUOTES_TOOL = "get_quotes";
const USER_EMAIL = "user@example.com";
const SESSION_DATE = "2026-10-25";
const STALE_TRADE_DATE = "2026-10-20";
const SOURCE = "tradingview";
const BACKUP_SOURCE = "mubasher";
const COMI_ISIN = "EGS60121C018";
const COMI_TICKER = "COMI";
const MAX_SYMBOLS = 20;
const OVER_SYMBOLS = 21;
const PAGING_TIMEOUT_MS = 15_000;
const DIRECTORY_SIZE = 300;
const QUOTED_COUNT = 280;
const PAGE_COUNT = 15;
const ITEM_FIELDS = [
  "isin",
  "ticker",
  "nameEn",
  "nameAr",
  "status",
  "price",
  "open",
  "high",
  "low",
  "prevClose",
  "change",
  "changePct",
  "volume",
  "value",
  "tradeDate",
  "dataTime",
  "source",
  "stale",
];

type QuoteItem = Record<string, unknown> & { status: string; ticker?: string; isin?: string };
type QuotesMeta = {
  label: string;
  source: string | null;
  stale: boolean;
  staleReason: string | null;
  session: { date: string; status: string } | null;
  provenance: { fields: string[]; source: string; basis: string; stale: boolean; timeKind: string }[];
};
type QuotesPayload = { data: { quotes: QuoteItem[] }; meta: QuotesMeta };

function stock(isin: string, ticker: string, status: SymbolStatus = "active"): DirectorySymbol {
  return stockSymbol(isin, ticker, { nameAr: `شركة ${ticker}`, nameEn: `${ticker} Company`, status });
}

function quote(ticker: string, tradeDate: string = SESSION_DATE): QuoteEntry {
  return {
    t: ticker,
    p: 122.03,
    o: 125.15,
    h: 125.2,
    l: 121.51,
    pc: 125.15,
    ch: -3.12,
    chp: -2.49,
    v: 1846236,
    val: 225296179.08,
    tt: QUOTE_TIME,
    td: tradeDate,
    src: SOURCE,
  };
}

async function getQuotes(key: string, symbols: string[]): Promise<ToolResult> {
  return callTool(QUOTES_TOOL, { symbols }, key);
}

function quotesCall(symbols: string[]) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call",
    params: { name: QUOTES_TOOL, arguments: { symbols } },
  };
}

function payloadOf(result: ToolResult): QuotesPayload {
  return structuredPayloadOf<QuotesPayload>(result);
}

describe("get_quotes contract", () => {
  let userId: string;
  let key: string;

  beforeEach(async () => {
    setNow(GIVEN_NOW);
    await clearState();
    userId = await seedUser(USER_EMAIL);
    key = await seedKey(userId);
  });

  afterEach(() => {
    restoreBindings();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("a quoted symbol", () => {
    beforeEach(async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER)]);
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER) } });
    });

    it("returns every field of the contract", async () => {
      const [item] = payloadOf(await getQuotes(key, [COMI_TICKER])).data.quotes;

      for (const field of ITEM_FIELDS) expect(item).toHaveProperty(field);
      expect(item).toMatchObject({
        isin: COMI_ISIN,
        ticker: COMI_TICKER,
        status: "active",
        price: 122.03,
        open: 125.15,
        high: 125.2,
        low: 121.51,
        prevClose: 125.15,
        change: -3.12,
        changePct: -2.49,
        volume: 1846236,
        value: 225296179.08,
        tradeDate: SESSION_DATE,
        stale: false,
      });
    });

    it("rounds float noise out of every numeric field", async () => {
      await seedSnapshot({
        quotes: {
          [COMI_ISIN]: {
            ...quote(COMI_TICKER),
            p: 122.00000000000001,
            ch: -0.8999999999999915,
            chp: -0.7332113021428013,
            pc: 122.89999999999999,
            val: 41485002.123456,
          },
        },
      });

      const [item] = payloadOf(await getQuotes(key, [COMI_TICKER])).data.quotes;

      expect(item).toMatchObject({ price: 122, change: -0.9, changePct: -0.73, prevClose: 122.9, value: 41485002.12 });
    });

    it("labels the response delayed with the snapshot source and a Cairo ISO data time", async () => {
      const { data, meta } = payloadOf(await getQuotes(key, [COMI_TICKER]));

      expect(meta.label).toBe("delayed");
      expect(meta.source).toBe(SOURCE);
      expect(meta.session).toMatchObject({ date: SESSION_DATE, status: "closed" });
      expect(data.quotes[0]).toMatchObject({ source: SOURCE });
      expect(data.quotes[0]?.dataTime).toBe("2026-10-25T11:30:00+03:00");
    });

    it("reports the served source as a primary trade entry", async () => {
      const { meta } = payloadOf(await getQuotes(key, [COMI_TICKER]));

      expect(meta.provenance).toEqual([
        {
          fields: ["quotes"],
          source: SOURCE,
          dataTime: "2026-10-25T11:30:00+03:00",
          timeKind: "trade",
          stale: false,
          basis: "primary",
        },
      ]);
    });

    it("accepts an ISIN in place of the ticker", async () => {
      const [item] = payloadOf(await getQuotes(key, [COMI_ISIN])).data.quotes;

      expect(item).toMatchObject({ isin: COMI_ISIN, ticker: COMI_TICKER });
    });
  });

  describe("symbol limit", () => {
    beforeEach(async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER)]);
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER) } });
    });

    it("accepts 20 symbols", async () => {
      const symbols = Array.from({ length: MAX_SYMBOLS }, () => COMI_TICKER);

      expect((await getQuotes(key, symbols)).isError).toBeFalsy();
    });

    it("rejects 21 symbols as invalid_input", async () => {
      const symbols = Array.from({ length: OVER_SYMBOLS }, () => COMI_TICKER);

      const result = await getQuotes(key, symbols);

      expect(result.isError).toBe(true);
      expect(errorCodeOf(result)).toBe("invalid_input");
    });

    it("carries the delayed meta and the notice on the error like a success", async () => {
      const symbols = Array.from({ length: OVER_SYMBOLS }, () => COMI_TICKER);

      const result = await getQuotes(key, symbols);

      expect(result.structuredContent).toMatchObject({
        meta: { label: "delayed", source: null, stale: false },
        notice: "Delayed, unofficial data for information only. Not investment advice.",
      });
    });

    it("reports no provenance on the error", async () => {
      const symbols = Array.from({ length: OVER_SYMBOLS }, () => COMI_TICKER);

      const result = await getQuotes(key, symbols);

      expect(result.isError).toBe(true);
      expect((result.structuredContent as unknown as { meta: { provenance: unknown } }).meta.provenance).toEqual([]);
    });
  });

  describe("a missing directory", () => {
    it("fails with not_available and names the snapshot source", async () => {
      await env.DATA.delete(DIRECTORY_KEY);
      await seedSnapshot();

      const result = await getQuotes(key, [COMI_TICKER]);

      expect(errorCodeOf(result)).toBe("not_available");
      expect(result.structuredContent).toMatchObject({ meta: { label: "delayed", source: SOURCE }, notice: expect.any(String) });
    });
  });

  describe("a listed symbol without a quote", () => {
    it("returns no_data_yet for a pending symbol", async () => {
      await seedSymbols([stock("EGS00000P001", "NEWL", "pending")]);
      await seedSnapshot();

      const [item] = payloadOf(await getQuotes(key, ["NEWL"])).data.quotes;

      expect(item).toMatchObject({ isin: "EGS00000P001", ticker: "NEWL", status: "no_data_yet" });
    });
  });

  describe("a snapshot whose primary source failed", () => {
    it("reports the served source with the backup basis", async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER)]);
      await seedSnapshot({
        sources: { stocks: BACKUP_SOURCE, primaryFailed: true },
        quotes: { [COMI_ISIN]: { ...quote(COMI_TICKER), src: BACKUP_SOURCE } },
      });

      const { meta } = payloadOf(await getQuotes(key, [COMI_TICKER]));

      expect(meta.provenance).toHaveLength(1);
      expect(meta.provenance[0]).toMatchObject({ source: BACKUP_SOURCE, basis: "backup" });
    });
  });

  describe("a stale quote", () => {
    it("flags a quote traded 3 sessions ago and names the data date", async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER)]);
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER, STALE_TRADE_DATE) } });

      const { data, meta } = payloadOf(await getQuotes(key, [COMI_TICKER]));

      expect(data.quotes[0]).toMatchObject({ stale: true, tradeDate: STALE_TRADE_DATE });
      expect(meta.stale).toBe(true);
      expect(meta.staleReason).toContain(STALE_TRADE_DATE);
      expect(meta.provenance[0]).toMatchObject({ source: SOURCE, stale: true });
    });
  });

  describe("an unknown symbol", () => {
    it("returns that item as not_found with suggestions while serving the others", async () => {
      await seedSymbols([stock(COMI_ISIN, COMI_TICKER), stock("EGS00000C002", "COMX")]);
      await seedSnapshot({ quotes: { [COMI_ISIN]: quote(COMI_TICKER) } });

      const { data } = payloadOf(await getQuotes(key, ["COMZ", COMI_TICKER]));

      expect(data.quotes).toHaveLength(2);
      expect(data.quotes[0]).toMatchObject({ status: "not_found", input: "COMZ" });
      const suggestions = data.quotes[0]?.suggestions as { ticker: string }[];
      expect(suggestions.map((entry) => entry.ticker)).toEqual(expect.arrayContaining([COMI_TICKER, "COMX"]));
      expect(data.quotes[1]).toMatchObject({ ticker: COMI_TICKER, price: 122.03 });
    });
  });

  describe("access", () => {
    it("returns 401 when no bearer is sent", async () => {
      const response = await postMcp(quotesCall([COMI_TICKER]));

      expect(response.status).toBe(401);
    });

    it("refuses a revoked key as unauthorized", async () => {
      await env.DB.prepare("UPDATE api_keys SET revoked_at = ?1 WHERE user_id = ?2").bind(GIVEN_NOW, userId).run();

      const response = await postMcp(quotesCall([COMI_TICKER]), key);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBeTruthy();
    });
  });

  describe("paging a full directory (SC-001)", () => {
    it("serves a quote or no_data_yet for all 300 symbols in 15 pages of 20", async () => {
      vi.spyOn(env.RATE_LIMITER, "limit").mockResolvedValue({ success: true });
      const symbols = Array.from({ length: DIRECTORY_SIZE }, (_, index) =>
        stock(syntheticIsin(index), syntheticTicker(index)),
      );
      const quotes = Object.fromEntries(symbols.slice(0, QUOTED_COUNT).map((entry) => [entry[0], quote(entry[1])]));
      await seedSymbols(symbols);
      await seedSnapshot({ quotes });
      const isins = symbols.map((entry) => entry[0]);

      const served: QuoteItem[] = [];
      for (let page = 0; page < PAGE_COUNT; page += 1) {
        const pageIsins = isins.slice(page * MAX_SYMBOLS, (page + 1) * MAX_SYMBOLS);
        served.push(...payloadOf(await getQuotes(key, pageIsins)).data.quotes);
      }

      expect(served).toHaveLength(DIRECTORY_SIZE);
      expect(served.filter((item) => item.status === "no_data_yet")).toHaveLength(DIRECTORY_SIZE - QUOTED_COUNT);
      expect(served.filter((item) => item.status === "active")).toHaveLength(QUOTED_COUNT);
      expect(served.map((item) => item.isin)).toEqual(isins);
    }, PAGING_TIMEOUT_MS);
  });
});
