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
