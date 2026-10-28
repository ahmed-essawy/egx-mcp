import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingViewIndices } from "../../src/providers/tradingview";

const INDEX_TIME = 1793175315;
const INDEX_VALUE = 50010.2;
const INDEX_CHANGE = -0.28;
const INDEX_BODY = { totalCount: 1, data: [{ s: "EGX:EGX30", d: ["EGX30", INDEX_VALUE, INDEX_CHANGE, INDEX_TIME] }] };

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
