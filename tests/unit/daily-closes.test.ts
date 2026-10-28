import { afterEach, describe, expect, it, vi } from "vitest";
import { mubasherDailyCloses } from "../../src/providers/mubasher";
import { tradingViewDailyCloses } from "../../src/providers/tradingview";
import mubasherPrices from "../fixtures/mubasher-prices-all.json";

const SESSION_SECONDS = 1792911600;
const CAIRO_SESSION_DATE = "2026-10-25";
const SAMPLE_CLOSE = 12.5;
const DEIN_CLOSE = 12.42;
const DEIN_DATE = "2026-10-07";

function stubFetch(body: unknown) {
  const stub = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body));
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tradingViewDailyCloses", () => {
  it("maps each stock ticker to its close and Cairo trade date using three scan columns plus the type", async () => {
    const stub = stubFetch({
      totalCount: 3,
      data: [
        { s: "EGX:COMI", d: ["COMI", SAMPLE_CLOSE, SESSION_SECONDS, "stock"] },
        { s: "EGX:ETF1", d: ["ETF1", 3, SESSION_SECONDS, "fund"] },
        { s: "EGX:NULL", d: ["NULL", null, SESSION_SECONDS, "stock"] },
      ],
    });

    const closes = await tradingViewDailyCloses();

    expect([...closes.keys()]).toEqual(["COMI"]);
    expect(closes.get("COMI")).toEqual({ close: SAMPLE_CLOSE, tradeDate: CAIRO_SESSION_DATE });
    const columns = (JSON.parse(String(stub.mock.calls[0]?.[1]?.body)) as { columns: string[] }).columns;
    expect(columns).toEqual(["name", "close", "time", "type"]);
  });

  it("rejects an empty scan", async () => {
    stubFetch({ totalCount: 0, data: [] });

    await expect(tradingViewDailyCloses()).rejects.toMatchObject({ kind: "empty" });
  });
});

describe("mubasherDailyCloses", () => {
  it("maps each code to its close and Cairo trade date", async () => {
    stubFetch(mubasherPrices);

    const closes = await mubasherDailyCloses();

    expect(closes.get("DEIN")).toEqual({ close: DEIN_CLOSE, tradeDate: DEIN_DATE });
  });

  it("rejects a response without prices", async () => {
    stubFetch({ prices: [] });

    await expect(mubasherDailyCloses()).rejects.toMatchObject({ kind: "empty" });
  });
});
