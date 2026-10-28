import { cairoParts, nowSeconds } from "../../src/domain/calendar.ts";
import { backfillRows, parseIndexCsv } from "../../src/domain/index-csv.ts";
import { shiftDays } from "../../src/domain/returns.ts";
import { PROVIDER_TIMEOUT_MS, USER_AGENT } from "../../src/providers/request-defaults.ts";
import { backfillSql } from "./index-sql.ts";
import { extractHistoricalDataUrl } from "./backfill-core.ts";

interface NodeFs {
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
}

interface NodePath {
  dirname(path: string): string;
}

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  getBuiltinModule(id: "node:fs"): NodeFs;
  getBuiltinModule(id: "node:path"): NodePath;
};

const { mkdirSync, writeFileSync } = process.getBuiltinModule("node:fs");
const { dirname } = process.getBuiltinModule("node:path");

const PAGE_URL = "https://english.mubasher.info/markets/EGX/indices/EGX30";
const INDEX_CODE = "EGX30";
const SOURCE = "mubasher";
const BACKFILL_DAYS = 1826;
const DEFAULT_OUT = "scripts/backfill/out/index-history-EGX30.sql";
const OUT_FLAG = "--out";
const OUT_MISSING_MESSAGE = "--out needs a file path";
const WRANGLER_COMMAND = "npx wrangler d1 execute egx --remote --file";
const FAILURE_EXIT_CODE = 1;

function outPath(args: string[]): string {
  const flagIndex = args.indexOf(OUT_FLAG);
  if (flagIndex < 0) return DEFAULT_OUT;
  const value = args[flagIndex + 1];
  if (value === undefined || value.startsWith("-")) throw new Error(OUT_MISSING_MESSAGE);
  return value;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchCsv(): Promise<string> {
  const page = await fetchText(PAGE_URL);
  const csvUrl = extractHistoricalDataUrl(page);
  if (!csvUrl) throw new Error("historical-data-url not found on the index page");
  return fetchText(csvUrl);
}

async function main(): Promise<void> {
  const out = outPath(process.argv.slice(2));
  const today = cairoParts(nowSeconds()).date;
  const rows = backfillRows(parseIndexCsv(await fetchCsv()), shiftDays(today, -BACKFILL_DAYS), today);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, backfillSql(rows, INDEX_CODE, SOURCE), "utf8");
  console.log(`${rows.length} rows written to ${out}`);
  console.log(`Run once: ${WRANGLER_COMMAND} "${out}"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = FAILURE_EXIT_CODE;
});
