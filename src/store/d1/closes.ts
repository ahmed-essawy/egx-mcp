import type { ReadResult } from "./users";

export type CloseAt = { sessionDate: string; close: number };

type CloseRecord = { session_date: string; close: number };

function toCloseAt(row: CloseRecord | undefined): CloseAt | null {
  return row ? { sessionDate: row.session_date, close: row.close } : null;
}

export async function indexCloseAt(
  db: D1Database,
  indexCode: string,
  date: string,
): Promise<ReadResult<CloseAt | null>> {
  const { results, meta } = await db
    .prepare(
      `SELECT session_date, close FROM index_values
       WHERE index_code = ?1 AND session_date <= ?2 ORDER BY session_date DESC LIMIT 1`,
    )
    .bind(indexCode, date)
    .all<CloseRecord>();
  return { value: toCloseAt(results[0]), rowsRead: meta.rows_read ?? 0 };
}

export async function barCloseAt(db: D1Database, isin: string, date: string): Promise<ReadResult<CloseAt | null>> {
  const { results, meta } = await db
    .prepare(
      `SELECT session_date, adj_close AS close FROM daily_bars
       WHERE isin = ?1 AND session_date <= ?2 ORDER BY session_date DESC LIMIT 1`,
    )
    .bind(isin, date)
    .all<CloseRecord>();
  return { value: toCloseAt(results[0]), rowsRead: meta.rows_read ?? 0 };
}

export type IndexSeriesRow = { code: string; date: string; close: number; source: string };

export type IndexSeries = { rows: IndexSeriesRow[]; earliest: ReadonlyMap<string, string>; rowsRead: number };

type SeriesRecord = { index_code: string; session_date: string; close: number; source: string };

type EarliestRecord = { index_code: string; earliest: string | null };

export async function readIndexSeries(db: D1Database, codes: string[], from: string, to: string): Promise<IndexSeries> {
  const codesJson = JSON.stringify(codes);
  const [series, earliest] = await db.batch([
    db
      .prepare(
        `SELECT index_code, session_date, close, source FROM index_values
         WHERE index_code IN (SELECT value FROM json_each(?1)) AND session_date BETWEEN ?2 AND ?3
         ORDER BY index_code, session_date`,
      )
      .bind(codesJson, from, to),
    db
      .prepare(
        `SELECT value AS index_code,
           (SELECT MIN(session_date) FROM index_values WHERE index_code = json_each.value) AS earliest
         FROM json_each(?1)`,
      )
      .bind(codesJson),
  ]);
  const earliestByCode = new Map<string, string>();
  for (const record of earliest!.results as EarliestRecord[]) {
    if (record.earliest !== null) earliestByCode.set(record.index_code, record.earliest);
  }
  return {
    rows: (series!.results as SeriesRecord[]).map((record) => ({
      code: record.index_code,
      date: record.session_date,
      close: record.close,
      source: record.source,
    })),
    earliest: earliestByCode,
    rowsRead: (series!.meta.rows_read ?? 0) + (earliest!.meta.rows_read ?? 0),
  };
}
