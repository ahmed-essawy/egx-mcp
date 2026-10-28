import { describe, expect, it } from "vitest";
import { readIndexSeries } from "../../src/store/d1/closes";
import { createSqliteD1 } from "../helpers/sqlite-d1";

const SOURCE = "mubasher";

function seed(rows: [string, string, number][]) {
  const { db, sqlite } = createSqliteD1();
  const insert = sqlite.prepare("INSERT INTO index_values (index_code, session_date, close, source) VALUES (?, ?, ?, ?)");
  for (const [code, date, close] of rows) insert.run(code, date, close, SOURCE);
  return db;
}

describe("readIndexSeries", () => {
  const rows: [string, string, number][] = [
    ["EGX30", "2026-10-22", 3],
    ["EGX30", "2026-10-20", 1],
    ["EGX30", "2026-10-21", 2],
    ["EGX70EWI", "2026-10-21", 9],
    ["EGX30", "2026-09-01", 7],
  ];

  it("returns the in-window rows ordered by code then date with each earliest date", async () => {
    const db = seed(rows);
    const series = await readIndexSeries(db, ["EGX30", "EGX70EWI", "EGX30USD"], "2026-10-21", "2026-10-22");
    expect(series.rows).toEqual([
      { code: "EGX30", date: "2026-10-21", close: 2, source: SOURCE },
      { code: "EGX30", date: "2026-10-22", close: 3, source: SOURCE },
      { code: "EGX70EWI", date: "2026-10-21", close: 9, source: SOURCE },
    ]);
    expect(series.earliest.get("EGX30")).toBe("2026-09-01");
    expect(series.earliest.get("EGX70EWI")).toBe("2026-10-21");
    expect(series.earliest.has("EGX30USD")).toBe(false);
    expect(series.rowsRead).toBeGreaterThan(0);
  });

  it("returns nothing for an empty code list", async () => {
    const db = seed(rows);
    const series = await readIndexSeries(db, [], "2026-10-21", "2026-10-22");
    expect(series.rows).toEqual([]);
    expect(series.earliest.size).toBe(0);
  });
});
