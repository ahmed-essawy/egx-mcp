import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingViewIndices, tradingViewStocks } from "../../src/providers/tradingview";
import tradingViewScan from "../fixtures/tradingview-egypt-scan.json";
import { requestUrl } from "../helpers/jobs";

const SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const COLUMN_COUNT = 17;
const CURRENCY_COLUMN = "currency";
const VOLUME_INDEX = 10;
const VALUE_INDEX = 11;
const SAMPLE_VOLUME = 138596;
const SAMPLE_VALUE = 293871.17;
const SAMPLE_PRICE = 0.037;
const EGP = "EGP";
const USD = "USD";
const INDEX_TIME = 1793175315;
const INDEX_VALUE = 50010.2;
const INDEX_CHANGE = -0.28;
const INDEX_BODY = { totalCount: 1, data: [{ s: "EGX:EGX30", d: ["EGX30", INDEX_VALUE, INDEX_CHANGE, INDEX_TIME] }] };

function stockRow(currency: string | undefined) {
  const base = tradingViewScan.data[0]?.d ?? [];
  const values: unknown[] = [...base];
  values[0] = "GTEX";
  values[4] = SAMPLE_PRICE;
  values[VOLUME_INDEX] = SAMPLE_VOLUME;
  values[VALUE_INDEX] = SAMPLE_VALUE;
  if (currency !== undefined) {
    while (values.length < COLUMN_COUNT) values.push(null);
    values.push(currency);
  }
  return { s: "EGX:GTEX", d: values };
}

function stubScan(body: unknown) {
  const stub = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body));
  vi.stubGlobal("fetch", stub);
  return stub;
}

function requestedColumns(stub: ReturnType<typeof stubScan>): string[] {
  const init = stub.mock.calls[0]?.[1];
  return (JSON.parse(String(init?.body)) as { columns: string[] }).columns;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tradingViewIndices", () => {
  it("takes the data time from the last bar update, which moves with the value", async () => {
    const stub = stubScan(INDEX_BODY);

    const [index] = await tradingViewIndices.fetchIndices(["EGX30"]);

    expect(requestedColumns(stub)).toContain("last_bar_update_time");
    expect(requestedColumns(stub)).not.toContain("update_time");
    expect(index).toEqual({ code: "EGX30", value: INDEX_VALUE, changePct: INDEX_CHANGE, tradeTime: INDEX_TIME });
  });
});

describe("tradingViewStocks quotes", () => {
  it("asks for the listing currency", async () => {
    const stub = stubScan({ totalCount: 1, data: [stockRow(EGP)] });

    await tradingViewStocks.fetchQuotes();

    expect(requestedColumns(stub)).toContain(CURRENCY_COLUMN);
    expect(requestUrl(stub.mock.calls[0]?.[0] ?? "")).toBe(SCAN_URL);
  });

  it("keeps the traded value of a stock quoted in EGP", async () => {
    stubScan({ totalCount: 1, data: [stockRow(EGP)] });

    const [quote] = await tradingViewStocks.fetchQuotes();

    expect(quote).toMatchObject({ ticker: "GTEX", last: SAMPLE_PRICE, volume: SAMPLE_VOLUME, value: SAMPLE_VALUE });
  });

  it("keeps the traded value when the currency column is absent", async () => {
    stubScan({ totalCount: 1, data: [stockRow(undefined)] });

    const [quote] = await tradingViewStocks.fetchQuotes();

    expect(quote?.value).toBe(SAMPLE_VALUE);
  });

  it("drops the traded value TradingView converted from a stock it labels as USD", async () => {
    stubScan({ totalCount: 1, data: [stockRow(USD)] });

    const [quote] = await tradingViewStocks.fetchQuotes();

    expect(quote).toMatchObject({ ticker: "GTEX", last: SAMPLE_PRICE, volume: SAMPLE_VOLUME, value: null });
  });
});
