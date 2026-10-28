import type { BackfillRow } from "../../src/domain/index-csv.ts";

const ROWS_PER_STATEMENT = 200;
const USAGE_STATEMENT =
  "INSERT INTO usage_global (day, backfill_rows) VALUES (date('now'), changes()) ON CONFLICT (day) DO UPDATE SET backfill_rows = usage_global.backfill_rows + excluded.backfill_rows;";

function sqlRow(row: BackfillRow, indexCode: string, source: string): string {
  const changePct = row.changePct === null ? "NULL" : String(row.changePct);
  return `('${indexCode}','${row.date}',${String(row.close)},${changePct},'${source}')`;
}

function insertStatement(chunk: BackfillRow[], indexCode: string, source: string): string {
  const values = chunk.map((row) => sqlRow(row, indexCode, source)).join(",");
  return `INSERT INTO index_values (index_code, session_date, close, change_pct, source) VALUES ${values} ON CONFLICT (index_code, session_date) DO NOTHING;`;
}

export function backfillSql(rows: BackfillRow[], indexCode: string, source: string): string {
  const lines: string[] = [];
  for (let start = 0; start < rows.length; start += ROWS_PER_STATEMENT) {
    lines.push(insertStatement(rows.slice(start, start + ROWS_PER_STATEMENT), indexCode, source), USAGE_STATEMENT);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
