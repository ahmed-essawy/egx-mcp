import { describe, expect, it } from "vitest";
import csv from "../fixtures/mubasher-index-EGX30.csv?raw";
import { backfillRows, parseIndexCsv } from "../../src/domain/index-csv";

const EXPECTED_ROW_COUNT = 292;

describe("parseIndexCsv", () => {
  it("parses the fixture into ascending rows", () => {
    const rows = parseIndexCsv(csv);

    expect(rows).toHaveLength(EXPECTED_ROW_COUNT);
    expect(rows[0]).toEqual({ date: "2025-07-10", close: 33324.38 });
    expect(rows[rows.length - 1]).toEqual({ date: "2026-10-27", close: 50104.83 });
  });

  it("keeps only valid rows", () => {
    const text = [
      "Date,Open,High,Low,Close,Volume",
      "",
      "2026-10-20/00:00:00,1,2,0.5,10,100",
      "2026-10-21/00:00:00,1,2,0.5,0,100",
      "2026-10-20/00:00:00,1,2,0.5,99,100",
      "2026-10-22/00:00:00,1,2,0.5,12,100",
    ].join("\r\n");

    expect(parseIndexCsv(text)).toEqual([
      { date: "2026-10-20", close: 10 },
      { date: "2026-10-22", close: 12 },
    ]);
  });

  it("throws when no rows remain", () => {
    expect(() => parseIndexCsv("")).toThrow("index CSV has no rows");
  });
});

describe("backfillRows", () => {
  it("returns the window before today with change percentages", () => {
    const rows = backfillRows(parseIndexCsv(csv), "2026-10-22", "2026-10-27");

    expect(rows.map((row) => row.date)).toEqual(["2026-10-22", "2026-10-25", "2026-10-26"]);
    expect(rows[1]?.changePct).toBe((49234.35 / 51052.26 - 1) * 100);
  });

  it("gives the first parsed row a null change percentage", () => {
    const rows = backfillRows(parseIndexCsv(csv), "2025-07-10", "2025-07-12");

    expect(rows).toEqual([{ date: "2025-07-10", close: 33324.38, changePct: null }]);
  });
});
