import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseIndexCsv } from "../../src/domain/index-csv";
import { shiftDays } from "../../src/domain/returns";
import csv from "../fixtures/mubasher-index-EGX30.csv?raw";
import { callNodeTool, createNodeStores, type NodeStores } from "../helpers/node-mcp";

const NOW_MS = Date.UTC(2026, 9, 28, 12, 0, 0);
const TODAY = "2026-10-28";
const FIRST_DATE = "2026-08-02";
const LAST_FIXTURE_DATE = "2026-10-27";
const FIXTURE_ROWS = 54;
const TRADINGVIEW_CLOSE = 49123.456;
const STALE_CAUSE = "Latest close 2026-10-22 is older than the last completed session.";
const NO_ROWS_REASON = "no stored closes for this index in the requested window";
const THURSDAY = 4;
const DAYS_PER_WEEK = 7;

type Point = { date: string; close: number; source: string };

type HistoryData = {
  code: string;
  name: string;
  interval: string;
  from: string;
  to: string;
  earliestAvailable: string | null;
  truncated: boolean;
  points: Point[];
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

type Envelope = { data: HistoryData; meta: Meta };
type ErrorEnvelope = { error: { code: string; message: string }; meta: Meta };

const fixtureRows = parseIndexCsv(csv).filter((row) => row.date >= FIRST_DATE && row.date <= LAST_FIXTURE_DATE);

function insert(stores: NodeStores, code: string, date: string, close: number, source: string): void {
  stores.sqlite
    .prepare("INSERT INTO index_values (index_code, session_date, close, source) VALUES (?1, ?2, ?3, ?4)")
    .run(code, date, close, source);
}

function seeded(): NodeStores {
  const stores = createNodeStores();
  for (const row of fixtureRows) insert(stores, "EGX30", row.date, row.close, "mubasher");
  insert(stores, "EGX30", TODAY, TRADINGVIEW_CLOSE, "tradingview");
  return stores;
}

async function history(stores: NodeStores, args: Record<string, unknown>) {
  const result = await callNodeTool(stores.env, "get_index_history", args);
  return { result, envelope: result.structuredContent as unknown as Envelope };
}

function thursdayOnOrAfter(date: string): string {
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDays(date, (THURSDAY - dayOfWeek + DAYS_PER_WEEK) % DAYS_PER_WEEK);
}

function lastOfEach(dates: string[], keyOf: (date: string) => string): string[] {
  const lastByKey = new Map<string, string>();
  for (const date of dates) lastByKey.set(keyOf(date), date);
  return [...lastByKey.values()];
}

describe("get_index_history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the fixture as 54 distinct closes", () => {
    expect(fixtureRows).toHaveLength(FIXTURE_ROWS);
  });

  it("returns daily closes ascending with their sources", async () => {
    const { result, envelope } = await history(seeded(), { index: "EGX30" });
    expect(result.isError).toBeFalsy();
    expect(envelope.data.code).toBe("EGX30");
    expect(envelope.data.name).toBe("EGX 30 Index");
    expect(envelope.data.interval).toBe("daily");
    expect(envelope.data.from).toBe(shiftDays(TODAY, -365));
    expect(envelope.data.to).toBe(TODAY);
    expect(envelope.data.earliestAvailable).toBe(FIRST_DATE);
    expect(envelope.data.truncated).toBe(false);
    expect(envelope.data.points).toHaveLength(FIXTURE_ROWS + 1);
    expect(envelope.data.points[0]).toEqual({ date: FIRST_DATE, close: fixtureRows[0]!.close, source: "mubasher" });
    expect(envelope.data.points.at(-1)).toEqual({ date: TODAY, close: 49123.46, source: "tradingview" });
    const dates = envelope.data.points.map((point) => point.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("limits the window to the requested days", async () => {
    const { envelope } = await history(seeded(), { index: "EGX30", days: 10 });
    expect(envelope.data.from).toBe(shiftDays(TODAY, -10));
    expect(envelope.data.points.every((point) => point.date >= envelope.data.from)).toBe(true);
    expect(envelope.data.earliestAvailable).toBe(FIRST_DATE);
  });

  it("keeps the last session of each Sunday to Thursday week", async () => {
    const { envelope } = await history(seeded(), { index: "EGX30", interval: "weekly" });
    const allDates = [...fixtureRows.map((row) => row.date), TODAY];
    expect(envelope.data.interval).toBe("weekly");
    expect(envelope.data.points.map((point) => point.date)).toEqual(lastOfEach(allDates, thursdayOnOrAfter));
    expect(envelope.data.points.map((point) => point.date)).toContain("2026-10-22");
  });

  it("keeps the last session of each month", async () => {
    const { envelope } = await history(seeded(), { index: "EGX30", interval: "monthly" });
    expect(envelope.data.points.map((point) => point.date)).toEqual(["2026-08-31", "2026-09-30", TODAY]);
  });

  it("returns the last rows and flags truncation", async () => {
    const { envelope } = await history(seeded(), { index: "EGX30", maxRows: 3 });
    expect(envelope.data.truncated).toBe(true);
    expect(envelope.data.points.map((point) => point.date)).toEqual(["2026-10-26", LAST_FIXTURE_DATE, TODAY]);
  });

  it("resolves a short alias to the stored code", async () => {
    const stores = createNodeStores();
    insert(stores, "EGX70EWI", "2026-10-27", 12000, "mubasher");
    const { envelope } = await history(stores, { index: "EGX70" });
    expect(envelope.data.code).toBe("EGX70EWI");
    expect(envelope.data.points).toEqual([{ date: "2026-10-27", close: 12000, source: "mubasher" }]);
  });

  it("rejects an unknown index", async () => {
    const result = await callNodeTool(seeded().env, "get_index_history", { index: "EGX99" });
    const failure = result.structuredContent as unknown as ErrorEnvelope;
    expect(result.isError).toBe(true);
    expect(failure.error).toMatchObject({ code: "not_found", message: "Unknown index: EGX99." });
    expect(failure.meta.provenance).toEqual([]);
  });

  it("gives no points for an index without stored closes", async () => {
    const { result, envelope } = await history(seeded(), { index: "EGX30USD" });
    expect(result.isError).toBeFalsy();
    expect(envelope.data.points).toEqual([]);
    expect(envelope.data.earliestAvailable).toBeNull();
    expect(envelope.meta.notAvailable).toEqual([{ field: "points", reason: NO_ROWS_REASON }]);
    expect(envelope.meta.dataTime).toBeNull();
    expect(envelope.meta.source).toBeNull();
    expect(envelope.meta.provenance).toEqual([]);
  });

  it.each([
    { index: "EGX30", days: 0 },
    { index: "EGX30", maxRows: 501 },
  ])("rejects out of range input %j", async (args) => {
    const result = await callNodeTool(seeded().env, "get_index_history", args);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as unknown as ErrorEnvelope).error.code).toBe("invalid_input");
  });

  it("labels the result end of day with one provenance entry per source", async () => {
    const { envelope } = await history(seeded(), { index: "EGX30" });
    expect(envelope.meta.label).toBe("end_of_day");
    expect(envelope.meta.dataTime).toBe(TODAY);
    expect(envelope.meta.source).toBe("tradingview");
    expect(envelope.meta.stale).toBe(false);
    expect(envelope.meta.staleReason).toBeNull();
    expect(envelope.meta.provenance).toEqual([
      { fields: ["points"], source: "mubasher", dataTime: LAST_FIXTURE_DATE, timeKind: "close", stale: false, basis: "primary" },
      { fields: ["points"], source: "tradingview", dataTime: TODAY, timeKind: "close", stale: false, basis: "primary" },
    ]);
  });

  it("marks a latest close older than the previous trading day as stale", async () => {
    const stores = createNodeStores();
    insert(stores, "EGX30", "2026-10-22", 50000, "mubasher");
    const { envelope } = await history(stores, { index: "EGX30" });
    expect(envelope.meta.stale).toBe(true);
    expect(envelope.meta.staleReason).toBe(STALE_CAUSE);
    expect(envelope.meta.provenance[0]?.stale).toBe(true);
  });
});
