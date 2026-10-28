import { describe, expect, it } from "vitest";
import { backfillSql } from "../../scripts/backfill/index-sql";
import type { BackfillRow } from "../../src/domain/index-csv";

const USAGE_STATEMENT =
  "INSERT INTO usage_global (day, backfill_rows) VALUES (date('now'), changes()) ON CONFLICT (day) DO UPDATE SET backfill_rows = usage_global.backfill_rows + excluded.backfill_rows;";
const INSERT_PREFIX =
  "INSERT INTO index_values (index_code, session_date, close, change_pct, source) VALUES ";
const INSERT_SUFFIX = " ON CONFLICT (index_code, session_date) DO NOTHING;";

function rows(count: number): BackfillRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    close: 100 + index,
    changePct: index === 0 ? null : 0.5,
  }));
}

describe("backfillSql", () => {
  it("returns an empty string for no rows", () => {
    expect(backfillSql([], "EGX30", "mubasher")).toBe("");
  });

  it("splits 201 rows into two insert statements of 200 and 1 rows", () => {
    const lines = backfillSql(rows(201), "EGX30", "mubasher").trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]?.startsWith(INSERT_PREFIX)).toBe(true);
    expect(lines[0]?.endsWith(INSERT_SUFFIX)).toBe(true);
    expect(lines[0]?.match(/\('EGX30'/g)).toHaveLength(200);
    expect(lines[2]?.match(/\('EGX30'/g)).toHaveLength(1);
  });

  it("follows every insert with the exact usage statement", () => {
    const lines = backfillSql(rows(201), "EGX30", "mubasher").trimEnd().split("\n");
    expect(lines[1]).toBe(USAGE_STATEMENT);
    expect(lines[3]).toBe(USAGE_STATEMENT);
  });

  it("prints a null change as NULL and a number as is", () => {
    const sql = backfillSql(rows(2), "EGX30", "mubasher");
    expect(sql).toContain("('EGX30','2026-01-01',100,NULL,'mubasher')");
    expect(sql).toContain("('EGX30','2026-01-02',101,0.5,'mubasher')");
  });
});
