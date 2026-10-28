import { parseMubasherCsvLine } from "./adjust.ts";
import { percentChange } from "./returns.ts";

export type IndexCsvRow = { date: string; close: number };
export type BackfillRow = { date: string; close: number; changePct: number | null };

const LINE_BREAK = /\r?\n/;

function parseLine(line: string): IndexCsvRow | null {
  const bar = parseMubasherCsvLine(line);
  if (!bar || bar.close <= 0) return null;
  return { date: bar.date, close: bar.close };
}

export function parseIndexCsv(text: string): IndexCsvRow[] {
  const byDate = new Map<string, IndexCsvRow>();
  for (const line of text.split(LINE_BREAK)) {
    const row = parseLine(line);
    if (row && !byDate.has(row.date)) byDate.set(row.date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) throw new Error("index CSV has no rows");
  return rows;
}

export function backfillRows(rows: IndexCsvRow[], from: string, today: string): BackfillRow[] {
  const result: BackfillRow[] = [];
  rows.forEach((row, index) => {
    if (row.date < from || row.date >= today) return;
    const previous = rows[index - 1];
    const changePct = previous ? percentChange(previous.close, row.close) : null;
    result.push({ date: row.date, close: row.close, changePct });
  });
  return result;
}
