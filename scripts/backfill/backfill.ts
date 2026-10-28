import { backfillRowValues, type AppliedAction } from "../../src/domain/adjust.ts";
import { nowSeconds, utcDay } from "../../src/domain/calendar.ts";
import {
  MAX_FILE_ROWS,
  StopForTheDay,
  USAGE_TEXT,
  appliedActionsQuery,
  attemptSymbol,
  buildActionStatements,
  buildBarFile,
  capDifferences,
  checkSymbol,
  computeAllowance,
  estimateBarFileRows,
  fetchSymbolActions,
  isIsin,
  isTicker,
  loadingRefusal,
  loadingStatement,
  mergeCaps,
  parseAppliedActions,
  parseArgs,
  parseBars,
  parseD1Output,
  parseDeploymentVersionIds,
  parseVersionCaps,
  readConfiguredCaps,
  recentClosesQuery,
  selectBars,
  sessionRefusal,
  usageUpsertStatement,
  yearsBefore,
  type Caps,
  type D1Output,
  type SqlFile,
  type StoredClose,
  type UsageToday,
} from "./backfill-core.ts";

interface Child {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  existsSync(path: string): boolean;
}

interface NodeChildProcess {
  spawnSync(
    command: string,
    args: string[],
    options: { encoding: "utf8"; shell: boolean; maxBuffer: number },
  ): Child;
}

declare const process: {
  argv: string[];
  platform: string;
  exitCode: number | undefined;
  getBuiltinModule(id: "node:fs"): NodeFs;
  getBuiltinModule(id: "node:child_process"): NodeChildProcess;
};

interface SymbolRef {
  isin: string;
  ticker: string;
}

interface PassedSymbol extends SymbolRef {
  csvUrl: string;
}

interface Validation {
  passed: PassedSymbol[];
  failed: Array<SymbolRef & { storedDate: string | null; storedClose: number | null; csvClose: number | null; differencePct: number | null }>;
  missingUrl: SymbolRef[];
}

interface ProgressEntry {
  isin: string;
  lastDate: string | null;
  basisDate: string;
  state: "loading" | "done";
}

interface Progress {
  symbols: ProgressEntry[];
  actionsLoaded: string[];
}

const fs = process.getBuiltinModule("node:fs");
const { spawnSync } = process.getBuiltinModule("node:child_process");

const OUT_DIR = "scripts/backfill/out";
const VALIDATION_PATH = `${OUT_DIR}/validation.json`;
const PROGRESS_PATH = "scripts/backfill/progress.json";
const CONFIG_PATH = "wrangler.jsonc";
const DATABASE = "egx";
const STOCK_PAGE_URL = "https://www.mubasher.info/markets/EGX/stocks";
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_PAUSE_MS = 250;
const STORED_WINDOW_DAYS = 14;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const SAFE_ARGUMENT = /^[A-Za-z0-9_.:\\/=@-]+$/;
const UNSAFE_IN_QUOTES = /["%\r\n]/;
const JSON_INDENT = 2;

function print(message: string): void {
  console.log(message);
}

function quoteForShell(argument: string): string {
  if (SAFE_ARGUMENT.test(argument)) return argument;
  if (UNSAFE_IN_QUOTES.test(argument)) throw new Error("An argument holds a character that cannot be passed safely");
  return `"${argument}"`;
}

function run(command: string, args: string[]): string {
  const useShell = process.platform === "win32";
  const child = spawnSync(command, useShell ? args.map(quoteForShell) : args, {
    encoding: "utf8",
    shell: useShell,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed:\n${child.stderr || child.stdout}`);
  return child.stdout;
}

function wranglerJson(args: string[]): unknown {
  const stdout = run("npx", ["wrangler", ...args, "--json"]);
  const start = stdout.search(/[[{]/);
  if (start === -1) throw new Error(`wrangler printed no JSON for: ${args.join(" ")}`);
  return JSON.parse(stdout.slice(start));
}

function d1Command(sql: string): D1Output {
  return parseD1Output(run("npx", ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", sql]));
}

function d1File(path: string): D1Output {
  return parseD1Output(run("npx", ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--file", path]));
}

function readJsonFile<T>(path: string): T | null {
  return fs.existsSync(path) ? (JSON.parse(fs.readFileSync(path, "utf8")) as T) : null;
}

function writeJsonFile(path: string, value: unknown): void {
  fs.writeFileSync(path, `${JSON.stringify(value, null, JSON_INDENT)}\n`, "utf8");
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

function listActiveSymbols(): SymbolRef[] {
  const { rows } = d1Command("SELECT isin, ticker FROM symbols WHERE status = 'active'");
  return rows.flatMap((row) => {
    const { isin, ticker } = row as Record<string, unknown>;
    return typeof isin === "string" && typeof ticker === "string" && isIsin(isin) && isTicker(ticker) ? [{ isin, ticker }] : [];
  });
}

async function validate(): Promise<void> {
  const refusal = loadingRefusal(readProgress().symbols);
  if (refusal !== null) throw new Error(refusal);
  if (d1Command("SELECT 1 AS present FROM daily_bars LIMIT 1").rows.length === 0) {
    throw new Error("daily_bars is empty: run endOfDayJob first");
  }
  const recent = new Map<string, StoredClose[]>();
  const recentRows = d1Command(recentClosesQuery(STORED_WINDOW_DAYS)).rows;
  for (const row of recentRows) {
    const isin = String(row.isin);
    recent.set(isin, [...(recent.get(isin) ?? []), { date: String(row.session_date), close: Number(row.close) }]);
  }
  const result: Validation = { passed: [], failed: [], missingUrl: [] };
  const fetchPaused = async (url: string): Promise<string> => {
    try {
      return await fetchText(url);
    } finally {
      await pause(REQUEST_PAUSE_MS);
    }
  };
  for (const symbol of listActiveSymbols()) {
    const stored = recent.get(symbol.isin);
    if (stored === undefined) {
      result.failed.push({ ...symbol, storedDate: null, storedClose: null, csvClose: null, differencePct: null });
      print(`${symbol.ticker}: failed, no stored bar`);
      continue;
    }
    const check = await checkSymbol(`${STOCK_PAGE_URL}/${symbol.ticker}`, stored, fetchPaused);
    if (check.outcome === "missingUrl") result.missingUrl.push(symbol);
    else if (check.outcome === "passed") result.passed.push({ ...symbol, csvUrl: check.csvUrl });
    else {
      result.failed.push({
        ...symbol,
        storedDate: check.storedDate,
        storedClose: check.storedClose,
        csvClose: check.csvClose,
        differencePct: check.differencePct,
      });
      if (check.error !== null) print(`${symbol.ticker}: csv fetch failed: ${check.error}`);
    }
    print(`${symbol.ticker}: ${check.outcome === "passed" ? "passed" : "failed"}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJsonFile(VALIDATION_PATH, result);
  print(`passed ${result.passed.length}, failed ${result.failed.length}, missing url ${result.missingUrl.length}`);
  for (const entry of result.failed) print(`  failed ${entry.ticker}: stored ${entry.storedClose}, csv ${entry.csvClose}`);
  for (const entry of result.missingUrl) print(`  missing url ${entry.ticker}`);
}

function readCaps(): Caps {
  const status = wranglerJson(["deployments", "status"]) as { versions?: Array<{ version_id?: string }> };
  const versions = parseDeploymentVersionIds(status).map((id) =>
    parseVersionCaps(wranglerJson(["versions", "view", id]) as Parameters<typeof parseVersionCaps>[0]),
  );
  const deployed = mergeCaps(versions);
  for (const difference of capDifferences(deployed, readConfiguredCaps(fs.readFileSync(CONFIG_PATH, "utf8")))) {
    print(`note: ${difference.name} is ${difference.deployed} on the deployed Worker and ${difference.configured} in wrangler.jsonc`);
  }
  return deployed;
}

function readUsageToday(day: string): UsageToday {
  const row = d1Command(
    `SELECT calls, adjust_rows, personal_rows, backfill_rows FROM usage_global WHERE day = '${day}'`,
  ).rows[0];
  return {
    calls: Number(row?.calls ?? 0),
    adjust_rows: Number(row?.adjust_rows ?? 0),
    personal_rows: Number(row?.personal_rows ?? 0),
    backfill_rows: Number(row?.backfill_rows ?? 0),
  };
}

function checkAllowance(estimatedRows: number): void {
  const day = utcDay(nowSeconds());
  const allowance = computeAllowance(readUsageToday(day), readCaps());
  print(`allowance for ${day}: ${allowance} rows, next file about ${estimatedRows} rows`);
  if (estimatedRows > allowance) throw new StopForTheDay(`Stopping for the day: the next file needs about ${estimatedRows} rows and ${allowance} remain. Run the same command tomorrow (UTC).`);
}

function recordRows(rowsWritten: number): void {
  if (rowsWritten > 0) d1Command(usageUpsertStatement(utcDay(nowSeconds()), rowsWritten));
}

function executeFile(name: string, sql: string): number {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}`;
  fs.writeFileSync(path, sql, "utf8");
  const { rowsWritten } = d1File(path);
  recordRows(rowsWritten);
  print(`${name}: ${rowsWritten} rows written`);
  return rowsWritten;
}

function readProgress(): Progress {
  return readJsonFile<Progress>(PROGRESS_PATH) ?? { symbols: [], actionsLoaded: [] };
}

function saveProgress(progress: Progress): void {
  writeJsonFile(PROGRESS_PATH, progress);
}

function upsertEntry(progress: Progress, entry: ProgressEntry): void {
  const index = progress.symbols.findIndex((existing) => existing.isin === entry.isin);
  if (index === -1) progress.symbols.push(entry);
  else progress.symbols[index] = entry;
}

interface PendingActions {
  isin: string;
  file: SqlFile;
}

function writeActionGroup(group: PendingActions[], fileNumber: number, progress: Progress): void {
  const estimatedRows = group.reduce((total, entry) => total + entry.file.estimatedRows, 0);
  checkAllowance(estimatedRows);
  const sql = group
    .map((entry) => entry.file.sql)
    .filter((text) => text !== "")
    .join("\n");
  if (sql !== "") executeFile(`actions-${fileNumber}.sql`, `${sql}\n`);
  for (const entry of group) progress.actionsLoaded.push(entry.isin);
  saveProgress(progress);
}

async function loadActions(years: number): Promise<void> {
  const from = yearsBefore(utcDay(nowSeconds()), years);
  const progress = readProgress();
  const pending = listActiveSymbols().filter((symbol) => !progress.actionsLoaded.includes(symbol.isin));
  print(`${pending.length} symbols still need their actions since ${from}`);
  const now = nowSeconds();
  const pace = () => pause(REQUEST_PAUSE_MS);
  let group: PendingActions[] = [];
  let groupRows = 0;
  let fileNumber = 0;
  let failed = 0;
  const flush = (): void => {
    if (group.length === 0) return;
    fileNumber += 1;
    writeActionGroup(group, fileNumber, progress);
    group = [];
    groupRows = 0;
  };
  try {
    for (const symbol of pending) {
      const attempt = await attemptSymbol(
        symbol,
        async () => buildActionStatements(symbol.isin, await fetchSymbolActions(symbol, from, fetchText, pace), now),
        print,
      );
      if (!attempt.ok) {
        failed += 1;
        continue;
      }
      const file = attempt.value;
      if (groupRows + file.estimatedRows > MAX_FILE_ROWS) flush();
      group.push({ isin: symbol.isin, file });
      groupRows += file.estimatedRows;
    }
  } catch (error) {
    try {
      flush();
    } catch (flushError) {
      print(`could not save the pending actions: ${flushError instanceof Error ? flushError.message : String(flushError)}`);
    }
    throw error;
  }
  flush();
  if (failed === 0) return print("actions loaded for every active symbol");
  print(`${failed} symbols failed and were left out; re-run to retry them`);
  process.exitCode = 1;
}

function readAppliedActions(isin: string): AppliedAction[] {
  return parseAppliedActions(d1Command(appliedActionsQuery(isin)).rows);
}

async function loadSymbol(symbol: PassedSymbol, years: number, progress: Progress): Promise<void> {
  const existing = progress.symbols.find((entry) => entry.isin === symbol.isin);
  if (existing?.state === "done") return;
  const bars = parseBars(await fetchText(symbol.csvUrl));
  const firstBar = bars[0];
  const lastBar = bars.at(-1);
  if (firstBar === undefined || lastBar === undefined) throw new Error(`${symbol.ticker}: the CSV holds no rows`);
  const basisDate = existing?.basisDate ?? lastBar.date;
  const from = yearsBefore(utcDay(nowSeconds()), years);
  const rows = selectBars(bars, { from, basisDate, afterDate: existing?.lastDate ?? null });
  const firstFileRows = Math.min(rows.length, MAX_FILE_ROWS);
  checkAllowance(estimateBarFileRows(firstFileRows, rows.length <= MAX_FILE_ROWS));

  upsertEntry(progress, { isin: symbol.isin, lastDate: existing?.lastDate ?? null, basisDate, state: "loading" });
  saveProgress(progress);
  recordRows(d1Command(loadingStatement(symbol.isin, basisDate, firstBar.date)).rowsWritten);

  const applied = readAppliedActions(symbol.isin);
  const derived = rows.map((bar) => backfillRowValues(bar, applied, basisDate));
  let fileNumber = 0;
  let start = 0;
  do {
    const chunk = derived.slice(start, start + MAX_FILE_ROWS);
    const isLast = start + MAX_FILE_ROWS >= derived.length;
    const file = buildBarFile(symbol.isin, chunk, isLast);
    if (fileNumber > 0) checkAllowance(file.estimatedRows);
    fileNumber += 1;
    executeFile(`${symbol.isin}-${utcDay(nowSeconds())}-${fileNumber}.sql`, file.sql);
    const lastDate = chunk.at(-1)?.date ?? existing?.lastDate ?? null;
    upsertEntry(progress, { isin: symbol.isin, lastDate, basisDate, state: isLast ? "done" : "loading" });
    saveProgress(progress);
    start += MAX_FILE_ROWS;
  } while (start < derived.length);
  print(`${symbol.ticker}: loaded ${derived.length} rows`);
}

async function loadPrices(years: number): Promise<void> {
  const validation = readJsonFile<Validation>(VALIDATION_PATH);
  if (validation === null) throw new Error("Run --validate first: scripts/backfill/out/validation.json is missing");
  const progress = readProgress();
  const passed = validation.passed.filter((symbol) => isIsin(symbol.isin) && isTicker(symbol.ticker));
  let failed = 0;
  for (const symbol of passed) {
    const attempt = await attemptSymbol(symbol, () => loadSymbol(symbol, years, progress), print);
    if (!attempt.ok) failed += 1;
  }
  if (failed === 0) return print(`all ${passed.length} validated symbols are loaded`);
  print(`${failed} of ${passed.length} validated symbols failed; re-run to retry them`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === "usage") return print(USAGE_TEXT);
  if (args.kind === "error") {
    print(`${args.message}\n\n${USAGE_TEXT}`);
    process.exitCode = 1;
    return;
  }
  const refusal = sessionRefusal(args.mode, args.duringSession, nowSeconds());
  if (refusal !== null) {
    print(refusal);
    process.exitCode = 1;
    return;
  }
  if (args.mode === "validate") return validate();
  if (args.mode === "actions") return loadActions(args.years);
  return loadPrices(args.years);
}

main().catch((error: unknown) => {
  print(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof StopForTheDay ? 0 : 1;
});
