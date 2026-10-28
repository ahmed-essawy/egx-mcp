import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarize, type Close } from "../../src/domain/index-analytics";
import { shiftDays } from "../../src/domain/returns";
import { roundIndex, roundPercent } from "../../src/mcp/rounding";
import { callNodeTool, createNodeStores, type NodeStores } from "../helpers/node-mcp";

const NOW_MS = Date.UTC(2026, 9, 28, 12, 0, 0);
const TODAY = "2026-10-28";
const LAST_DATE = "2026-10-27";
const DEFAULT_DAYS = 365;
const EGX30_ROWS = 60;
const EGX70_ROWS = 10;
const FIRST_SOURCE_ROWS = 30;
const NOT_ENOUGH_REASON = "not enough stored closes";
const NO_CLOSES_REASON = "no stored closes for this index";
const STALE_CAUSE = "Latest close 2026-10-22 is older than the last completed session.";

type Dated = { date: string; close: number };

type Summary = {
  code?: string;
  name?: string;
  input?: string;
  status: string;
  reason?: string;
  latest?: Dated;
  previousClose?: number | null;
  dailyChange?: number | null;
  dailyChangePct?: number | null;
  periodFrom?: string;
  periodHigh?: Dated | null;
  periodLow?: Dated | null;
  periodReturnPct?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  annualizedVolatilityPct?: number | null;
  drawdownFromHighPct?: number | null;
  return5SessionsPct?: number | null;
  observations?: number;
  sources?: string[];
  stale?: boolean;
};

type Meta = {
  label: string;
  dataTime: string | null;
  source: string | null;
  stale: boolean;
  staleReason: string | null;
  notAvailable: { field: string; reason: string }[];
  provenance: {
    fields: string[];
    source: string;
    dataTime: string | null;
    timeKind: string;
    stale: boolean;
    basis: string;
  }[];
};

type Envelope = {
  data: { summaries: Summary[]; highestReturn: { code: string; periodReturnPct: number } | null };
  meta: Meta;
};
type ErrorEnvelope = { error: { code: string; message: string }; meta: Meta };

function closesFor(count: number, base: number, step: number, lastDate = LAST_DATE): Close[] {
  return Array.from({ length: count }, (_, index) => ({
    date: shiftDays(lastDate, index - count + 1),
    close: base + step * index + ((index * 7) % 5),
    source: index < FIRST_SOURCE_ROWS ? "mubasher" : "tradingview",
  }));
}

function allMubasher(closes: Close[]): Close[] {
  return closes.map((row) => ({ ...row, source: "mubasher" }));
}

function seed(stores: NodeStores, code: string, closes: Close[]): void {
  for (const row of closes) {
    stores.sqlite
      .prepare("INSERT INTO index_values (index_code, session_date, close, source) VALUES (?1, ?2, ?3, ?4)")
      .run(code, row.date, row.close, row.source);
  }
}

const egx30Closes = closesFor(EGX30_ROWS, 40000, 100);
const egx70Closes = allMubasher(closesFor(EGX70_ROWS, 12000, 20));

function seeded(): NodeStores {
  const stores = createNodeStores();
  seed(stores, "EGX30", egx30Closes);
  seed(stores, "EGX70EWI", egx70Closes);
  return stores;
}

async function summary(stores: NodeStores, args: Record<string, unknown>) {
  const result = await callNodeTool(stores.env, "get_index_summary", args);
  return { result, envelope: result.structuredContent as unknown as Envelope };
}

function roundedIndex(value: number | null): number | null {
  return value === null ? null : roundIndex(value);
}

function roundedDated(value: Dated | null): Dated | null {
  return value ? { date: value.date, close: roundIndex(value.close) } : null;
}

function expected(code: string, name: string, closes: Close[], days = DEFAULT_DAYS): Summary {
  const periodFrom = shiftDays(TODAY, -days);
  const metrics = summarize(closes, periodFrom);
  return {
    code,
    name,
    status: "ok",
    latest: roundedDated(metrics.latest) as Dated,
    previousClose: roundedIndex(metrics.previousClose),
    dailyChange: roundedIndex(metrics.dailyChange),
    dailyChangePct: roundPercent(metrics.dailyChangePct),
    periodFrom,
    periodHigh: roundedDated(metrics.periodHigh),
    periodLow: roundedDated(metrics.periodLow),
    periodReturnPct: roundPercent(metrics.periodReturnPct),
    sma20: roundedIndex(metrics.sma20),
    sma50: roundedIndex(metrics.sma50),
    annualizedVolatilityPct: roundPercent(metrics.annualizedVolatilityPct),
    drawdownFromHighPct: roundPercent(metrics.drawdownFromHighPct),
    return5SessionsPct: roundPercent(metrics.return5SessionsPct),
    observations: metrics.observations,
    sources: [...new Set(closes.map((row) => row.source))],
    stale: false,
  };
}

describe("get_index_summary", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("summarizes each index with the pure analytics", async () => {
    const { result, envelope } = await summary(seeded(), { indices: ["EGX30", "EGX70EWI"] });
    expect(result.isError).toBeFalsy();
    expect(envelope.data.summaries).toEqual([
      expected("EGX30", "EGX 30 Index", egx30Closes),
      expected("EGX70EWI", "EGX 70 EWI Index", egx70Closes),
    ]);
  });

  it("lists the missing moving averages in meta.notAvailable", async () => {
    const { envelope } = await summary(seeded(), { indices: ["EGX30", "EGX70EWI"] });
    const egx70 = envelope.data.summaries[1]!;
    expect(egx70.sma20).toBeNull();
    expect(egx70.sma50).toBeNull();
    expect(envelope.meta.notAvailable).toEqual([
      { field: "EGX70EWI.sma20", reason: NOT_ENOUGH_REASON },
      { field: "EGX70EWI.sma50", reason: NOT_ENOUGH_REASON },
    ]);
  });

  it("names the higher period return", async () => {
    const { envelope } = await summary(seeded(), { indices: ["EGX30", "EGX70EWI"] });
    const [egx30, egx70] = envelope.data.summaries;
    expect(egx30!.periodReturnPct).not.toBe(egx70!.periodReturnPct);
    const winner = egx30!.periodReturnPct! > egx70!.periodReturnPct! ? egx30! : egx70!;
    expect(envelope.data.highestReturn).toEqual({ code: winner.code, periodReturnPct: winner.periodReturnPct });
  });

  it("gives equal returns to the first input", async () => {
    const stores = createNodeStores();
    seed(stores, "EGX70EWI", egx70Closes);
    seed(stores, "EGX100EWI", egx70Closes);
    const first = await summary(stores, { indices: ["EGX100EWI", "EGX70EWI"] });
    expect(first.envelope.data.highestReturn?.code).toBe("EGX100EWI");
    const reversed = await summary(stores, { indices: ["EGX70EWI", "EGX100EWI"] });
    expect(reversed.envelope.data.highestReturn?.code).toBe("EGX70EWI");
  });

  it("gives no highest return for a single index", async () => {
    const { envelope } = await summary(seeded(), { indices: ["EGX30"] });
    expect(envelope.data.highestReturn).toBeNull();
  });

  it("keeps request positions, reports unknown and empty indices and serves a duplicate once", async () => {
    const { result, envelope } = await summary(seeded(), { indices: ["EGX30", "EGX99", "EGX30USD", "egx30"] });
    expect(result.isError).toBeFalsy();
    expect(envelope.data.summaries).toHaveLength(3);
    expect(envelope.data.summaries[0]).toMatchObject({ code: "EGX30", status: "ok" });
    expect(envelope.data.summaries[1]).toEqual({ input: "EGX99", status: "not_found" });
    expect(envelope.data.summaries[2]).toEqual({
      code: "EGX30USD",
      status: "not_available",
      reason: NO_CLOSES_REASON,
    });
    expect(envelope.data.highestReturn).toBeNull();
  });

  it("defaults to EGX30", async () => {
    const { envelope } = await summary(seeded(), {});
    expect(envelope.data.summaries.map((item) => item.code)).toEqual(["EGX30"]);
    expect(envelope.data.summaries[0]?.periodFrom).toBe(shiftDays(TODAY, -DEFAULT_DAYS));
  });

  it("limits the period to the requested days but keeps the averages on the full series", async () => {
    const { envelope } = await summary(seeded(), { indices: ["EGX30"], days: 20 });
    expect(envelope.data.summaries[0]).toEqual(expected("EGX30", "EGX 30 Index", egx30Closes, 20));
  });

  it.each([
    { indices: ["EGX30", "EGX70EWI", "EGX100EWI", "EGX30USD", "EGX30CAPPED", "EGX30"] },
    { indices: [] },
    { indices: ["EGX30"], days: 0 },
    { indices: ["EGX30"], days: 1826 },
  ])("rejects invalid input %j", async (args) => {
    const result = await callNodeTool(seeded().env, "get_index_summary", args);
    const failure = result.structuredContent as unknown as ErrorEnvelope;
    expect(result.isError).toBe(true);
    expect(failure.error.code).toBe("invalid_input");
    expect(failure.meta.provenance).toEqual([]);
  });

  it("records one computed summaries entry per source", async () => {
    const { envelope } = await summary(seeded(), { indices: ["EGX30", "EGX70EWI"] });
    expect(envelope.meta.label).toBe("end_of_day");
    expect(envelope.meta.dataTime).toBe(LAST_DATE);
    expect(envelope.meta.source).toBe("mubasher");
    expect(envelope.meta.stale).toBe(false);
    expect(envelope.meta.staleReason).toBeNull();
    expect(envelope.meta.provenance).toEqual([
      { fields: ["summaries"], source: "mubasher", dataTime: LAST_DATE, timeKind: "close", stale: false, basis: "computed" },
      {
        fields: ["summaries"],
        source: "tradingview",
        dataTime: LAST_DATE,
        timeKind: "close",
        stale: false,
        basis: "computed",
      },
    ]);
  });

  it("marks a latest close older than the previous trading day as stale", async () => {
    const stores = createNodeStores();
    seed(stores, "EGX30", allMubasher(closesFor(EGX70_ROWS, 50000, 10, "2026-10-22")));
    const { envelope } = await summary(stores, { indices: ["EGX30"] });
    expect(envelope.data.summaries[0]?.stale).toBe(true);
    expect(envelope.meta.stale).toBe(true);
    expect(envelope.meta.staleReason).toBe(STALE_CAUSE);
    expect(envelope.meta.provenance.every((entry) => entry.stale)).toBe(true);
  });

  it("returns no provenance when nothing is available", async () => {
    const { envelope } = await summary(createNodeStores(), { indices: ["EGX99"] });
    expect(envelope.meta.provenance).toEqual([]);
    expect(envelope.meta.dataTime).toBeNull();
    expect(envelope.meta.source).toBeNull();
  });
});
