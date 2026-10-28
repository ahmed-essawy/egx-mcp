import type { ReadResult, WriteResult } from "./users";

export type InflationRow = {
  month: string;
  cpiIndex: number;
  yoyPct: number | null;
  source: string;
  enteredBy: string | null;
  enteredAt: number;
};

export type CpiPoint = { cpiIndex: number; source: string };

type CpiPointRow = { cpi_index: number; source: string };

export async function cpiAt(db: D1Database, month: string): Promise<ReadResult<CpiPoint | null>> {
  const { results, meta } = await db
    .prepare("SELECT cpi_index, source FROM inflation_figures WHERE month = ?1")
    .bind(month)
    .all<CpiPointRow>();
  const row = results[0];
  return { value: row ? { cpiIndex: row.cpi_index, source: row.source } : null, rowsRead: meta.rows_read ?? 0 };
}

export async function upsertInflation(db: D1Database, row: InflationRow): Promise<WriteResult> {
  const { meta } = await db
    .prepare(
      `INSERT INTO inflation_figures (month, cpi_index, yoy_pct, source, entered_by, entered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (month) DO UPDATE SET
         cpi_index = excluded.cpi_index,
         yoy_pct = excluded.yoy_pct,
         source = excluded.source,
         entered_by = excluded.entered_by,
         entered_at = excluded.entered_at`,
    )
    .bind(row.month, row.cpiIndex, row.yoyPct, row.source, row.enteredBy, row.enteredAt)
    .run();
  return { rowsWritten: meta.rows_written };
}
