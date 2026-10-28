import { describe, expect, it } from "vitest";
import {
  ACTION_ROWS_WRITTEN,
  MAX_ACTION_PAGES,
  MAX_FILE_ROWS,
  NOTICE_ROWS_WRITTEN,
  StopForTheDay,
  appliedActionsQuery,
  attemptSymbol,
  buildActionStatements,
  buildBarFile,
  capDifferences,
  checkSymbol,
  compareClose,
  computeAllowance,
  doneStatement,
  estimateBarFileRows,
  extractHistoricalDataUrl,
  fetchSymbolActions,
  isIsin,
  isIsoDate,
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
} from "../../scripts/backfill/backfill-core";
import { backfillRowValues, type AppliedAction } from "../../src/domain/adjust";
import { createSqliteD1 } from "../helpers/sqlite-d1";
import comiCsv from "../fixtures/mubasher-history-COMI.csv?raw";

const ISIN = "EGS60121C018";
const TICKER = "COMI";
const NOW = 1_792_000_000;

const CAPS = {
  GLOBAL_DAILY_CALLS: 15000,
  ADJUST_MAX_ROWS_PER_DAY: 10000,
  PERSONAL_DAILY_ROWS: 5000,
  BACKFILL_MAX_ROWS_PER_DAY: 36000,
};

function bar(date: string, close: number) {
  return { date, open: close, high: close, low: close, close, volume: 100 };
}

function seedSymbol(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]): void {
  sqlite.exec(
    `INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES ('${ISIN}', '${TICKER}', 'active', 1, 1)`,
  );
}

describe("parseArgs", () => {
  it("returns usage with no arguments", () => {
    expect(parseArgs([])).toEqual({ kind: "usage" });
    expect(parseArgs(["--help"])).toEqual({ kind: "usage" });
  });

  it("parses the three modes", () => {
    expect(parseArgs(["--validate"])).toEqual({ kind: "run", mode: "validate", years: 5, duringSession: false });
    expect(parseArgs(["--actions", "--years", "3"])).toEqual({ kind: "run", mode: "actions", years: 3, duringSession: false });
    expect(parseArgs(["--years", "5"])).toEqual({ kind: "run", mode: "load", years: 5, duringSession: false });
  });

  it("accepts --during-session", () => {
    expect(parseArgs(["--years", "5", "--during-session"])).toEqual({ kind: "run", mode: "load", years: 5, duringSession: true });
  });

  it("rejects bad years and unknown flags", () => {
    expect(parseArgs(["--years", "0"]).kind).toBe("error");
    expect(parseArgs(["--years", "abc"]).kind).toBe("error");
    expect(parseArgs(["--years"]).kind).toBe("error");
    expect(parseArgs(["--bogus"]).kind).toBe("error");
  });

  it("rejects --validate together with --actions", () => {
    expect(parseArgs(["--validate", "--actions"]).kind).toBe("error");
  });
});

describe("sessionRefusal", () => {
  const sundayOpen = Date.UTC(2026, 9, 25, 8, 0, 0) / 1000;
  const sundayBeforeOpen = Date.UTC(2026, 9, 25, 6, 59, 0) / 1000;
  const sundayAfterClose = Date.UTC(2026, 9, 25, 12, 31, 0) / 1000;
  const fridayMidday = Date.UTC(2026, 9, 23, 9, 0, 0) / 1000;

  it("refuses load and actions inside the session window", () => {
    expect(sessionRefusal("load", false, sundayOpen)).toContain("--during-session");
    expect(sessionRefusal("actions", false, sundayOpen)).toContain("--during-session");
  });

  it("allows validate, an override and times outside the window", () => {
    expect(sessionRefusal("validate", false, sundayOpen)).toBeNull();
    expect(sessionRefusal("load", true, sundayOpen)).toBeNull();
    expect(sessionRefusal("load", false, sundayBeforeOpen)).toBeNull();
    expect(sessionRefusal("actions", false, sundayAfterClose)).toBeNull();
    expect(sessionRefusal("load", false, fridayMidday)).toBeNull();
  });
});

describe("value validation", () => {
  it("accepts real ISINs and rejects injection", () => {
    expect(isIsin(ISIN)).toBe(true);
    expect(isIsin("EGS60121C01")).toBe(false);
    expect(isIsin("EGS60121C018'; DROP TABLE symbols;--")).toBe(false);
  });

  it("accepts real dates only", () => {
    expect(isIsoDate("2026-10-22")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2026-1-2")).toBe(false);
    expect(isIsoDate("2026-10-22' OR 1=1")).toBe(false);
  });

  it("accepts tickers made of letters and digits", () => {
    expect(isTicker("COMI")).toBe(true);
    expect(isTicker("COMI/../x")).toBe(false);
    expect(isTicker("")).toBe(false);
  });

  it("subtracts calendar years", () => {
    expect(yearsBefore("2026-10-28", 5)).toBe("2021-10-28");
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-03-01");
  });
});

describe("page and CSV parsing", () => {
  it("reads the historical data url", () => {
    const html = '<div class="x" historical-data-url="https://static.mubasher.info/File.MubasherCharts/a/44507230.csv" y="1">';
    expect(extractHistoricalDataUrl(html)).toBe("https://static.mubasher.info/File.MubasherCharts/a/44507230.csv");
  });

  it("returns null when the attribute is missing or points to another host", () => {
    expect(extractHistoricalDataUrl("<div></div>")).toBeNull();
    expect(extractHistoricalDataUrl('<div historical-data-url="https://evil.example/a.csv">')).toBeNull();
  });

  it("parses the fixture in ascending order and skips junk lines", () => {
    const bars = parseBars(`Date,Open\n${comiCsv}\n\n`);
    expect(bars.length).toBeGreaterThan(200);
    const dates = bars.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("raises high and lowers low so no bar breaks the table checks", () => {
    const [clamped] = parseBars("2026-10-21/00:00:00,10,11,9,12,5\n");
    expect(clamped).toMatchObject({ open: 10, high: 12, low: 9, close: 12 });
    const [below] = parseBars("2026-10-22/00:00:00,10,11,9,8,5\n");
    expect(below).toMatchObject({ high: 11, low: 8, close: 8 });
  });

  it("writes clamped bars that the real schema accepts", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    const bars = parseBars("2026-10-21/00:00:00,10,11,9,12,5\n");
    const rows = bars.map((entry) => backfillRowValues(entry, [], "2026-10-21"));
    sqlite.exec(buildBarFile(ISIN, rows, true).sql);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_bars").get()).toEqual({ n: 1 });
  });

  it("keeps the last line when a date repeats", () => {
    const bars = parseBars("2026-10-21/00:00:00,10,11,9,10,5\n2026-10-21/00:00:00,10,12,9,11,6\n");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.close).toBe(11);
  });
});

describe("compareClose", () => {
  const bars = [bar("2026-10-21", 100), bar("2026-10-22", 125.15)];

  it("passes within half a percent", () => {
    expect(compareClose(bars, [{ date: "2026-10-22", close: 125.5 }]).passed).toBe(true);
    expect(compareClose(bars, [{ date: "2026-10-22", close: 125.15 }]).passed).toBe(true);
  });

  it("fails beyond half a percent", () => {
    const result = compareClose(bars, [{ date: "2026-10-22", close: 130 }]);
    expect(result.passed).toBe(false);
    expect(result.csvClose).toBe(125.15);
  });

  it("fails when the csv has none of the stored dates", () => {
    const result = compareClose(bars, [{ date: "2026-10-25", close: 125 }]);
    expect(result.passed).toBe(false);
    expect(result.csvClose).toBeNull();
  });

  it("compares on the newest date both sides have", () => {
    const stored = [
      { date: "2026-10-22", close: 125.15 },
      { date: "2026-10-23", close: 130 },
      { date: "2026-10-21", close: 100 },
    ];
    const result = compareClose(bars, stored);
    expect(result).toMatchObject({ passed: true, csvClose: 125.15, storedDate: "2026-10-22", storedClose: 125.15 });
  });
});

describe("checkSymbol", () => {
  const stored = [{ date: "2026-10-22", close: 125.15 }];
  const page = '<div historical-data-url="https://static.mubasher.info/File.MubasherCharts/a/44507230.csv" y="1">';

  it("records a failed page fetch as a missing url", async () => {
    const result = await checkSymbol("page", stored, () => Promise.reject(new Error("boom")));
    expect(result).toEqual({ outcome: "missingUrl" });
  });

  it("records a failed csv fetch as failed with a null close", async () => {
    const fetchText = (url: string) => (url === "page" ? Promise.resolve(page) : Promise.reject(new Error("csv down")));
    const result = await checkSymbol("page", stored, fetchText);
    expect(result).toEqual({
      outcome: "failed",
      csvClose: null,
      differencePct: null,
      storedDate: null,
      storedClose: null,
      error: "csv down",
    });
  });
});

describe("selectBars", () => {
  const bars = ["2020-01-01", "2021-06-01", "2023-01-01", "2026-10-22", "2026-10-25"].map((date) => bar(date, 10));

  it("keeps rows from the cutoff up to the basis date", () => {
    expect(selectBars(bars, { from: "2021-10-28", basisDate: "2026-10-22", afterDate: null }).map((b) => b.date)).toEqual([
      "2023-01-01",
      "2026-10-22",
    ]);
  });

  it("keeps everything from the first row when the history is shorter", () => {
    const short = selectBars(bars.slice(3), { from: "2021-10-28", basisDate: "2026-10-25", afterDate: null });
    expect(short.map((b) => b.date)).toEqual(["2026-10-22", "2026-10-25"]);
  });

  it("skips rows already loaded", () => {
    const rest = selectBars(bars, { from: "2020-01-01", basisDate: "2026-10-22", afterDate: "2021-06-01" });
    expect(rest.map((b) => b.date)).toEqual(["2023-01-01", "2026-10-22"]);
  });
});

describe("symbol statements", () => {
  it("builds the loading statement with checked values", () => {
    expect(loadingStatement(ISIN, "2026-10-22", "2001-05-15")).toBe(
      `UPDATE symbols SET adj_basis_date = '2026-10-22', backfill_state = 'loading', first_trade_date = '2001-05-15' WHERE isin = '${ISIN}'`,
    );
  });

  it("refuses unchecked values", () => {
    expect(() => loadingStatement("bad", "2026-10-22", "2001-05-15")).toThrow();
    expect(() => loadingStatement(ISIN, "2026-13-01", "2001-05-15")).toThrow();
    expect(() => loadingStatement(ISIN, "2026-10-22", "x' OR '1")).toThrow();
    expect(() => doneStatement("x")).toThrow();
    expect(() => appliedActionsQuery("x'")).toThrow();
  });

  it("builds the done statement and the applied query", () => {
    expect(doneStatement(ISIN)).toBe(`UPDATE symbols SET backfill_state = 'done' WHERE isin = '${ISIN}'`);
    expect(appliedActionsQuery(ISIN)).toBe(
      `SELECT kind, ratio, ex_date FROM corporate_actions WHERE isin = '${ISIN}' AND status = 'applied' AND kind IN ('bonus', 'split', 'reverse_split')`,
    );
  });

  it("builds the usage upsert", () => {
    expect(usageUpsertStatement("2026-10-28", 120)).toBe(
      "INSERT INTO usage_global (day, backfill_rows) VALUES ('2026-10-28', 120) ON CONFLICT(day) DO UPDATE SET backfill_rows = backfill_rows + excluded.backfill_rows",
    );
    expect(() => usageUpsertStatement("2026-10-28", -1)).toThrow();
    expect(() => usageUpsertStatement("2026-10-28", 1.5)).toThrow();
  });

  it("parses applied actions and rejects bad rows", () => {
    expect(parseAppliedActions([{ kind: "bonus", ratio: 0.25, ex_date: "2024-05-01" }])).toEqual([
      { kind: "bonus", ratio: 0.25, exDate: "2024-05-01", status: "applied" },
    ]);
    expect(() => parseAppliedActions([{ kind: "rights", ratio: 1, ex_date: "2024-05-01" }])).toThrow();
    expect(() => parseAppliedActions([{ kind: "bonus", ratio: null, ex_date: "2024-05-01" }])).toThrow();
    expect(() => parseAppliedActions([{ kind: "bonus", ratio: 0.25, ex_date: "May" }])).toThrow();
  });
});

describe("bar files", () => {
  const applied: AppliedAction[] = [{ kind: "split", ratio: 2, exDate: "2025-01-10", status: "applied" }];
  const csvBars = parseBars(comiCsv);
  const basis = csvBars.at(-1)?.date as string;

  it("estimates rows with the usage upsert and the done update", () => {
    expect(estimateBarFileRows(10, false)).toBe(11);
    expect(estimateBarFileRows(10, true)).toBe(12);
    expect(MAX_FILE_ROWS).toBe(5000);
  });

  it("writes rows that the real schema accepts and keeps live rows", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    const rows = csvBars.map((entry) => backfillRowValues(entry, applied, basis));
    sqlite.exec(
      `INSERT INTO daily_bars (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source)
       VALUES ('${ISIN}', '${basis}', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 'live')`,
    );
    const file = buildBarFile(ISIN, rows, true);
    sqlite.exec(file.sql);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM daily_bars").get() as { n: number };
    expect(count.n).toBe(rows.length);
    const live = sqlite.prepare("SELECT source, raw_derived FROM daily_bars WHERE session_date = ?").get(basis) as {
      source: string;
      raw_derived: number;
    };
    expect(live).toEqual({ source: "live", raw_derived: 0 });
    const loaded = sqlite.prepare("SELECT source, raw_derived FROM daily_bars WHERE session_date = ?").get(csvBars[0]?.date as string) as {
      source: string;
      raw_derived: number;
    };
    expect(loaded).toEqual({ source: "mubasher_csv", raw_derived: 1 });
    expect(sqlite.prepare("SELECT backfill_state FROM symbols").get()).toEqual({ backfill_state: "done" });
    expect(file.estimatedRows).toBe(estimateBarFileRows(rows.length, true));
  });

  it("leaves the state alone on a file that is not the last", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    const rows = csvBars.slice(0, 3).map((entry) => backfillRowValues(entry, [], basis));
    sqlite.exec(buildBarFile(ISIN, rows, false).sql);
    expect(sqlite.prepare("SELECT backfill_state FROM symbols").get()).toEqual({ backfill_state: null });
  });

  it("uses applied actions only for the derived values", () => {
    const first = csvBars[0];
    const row = backfillRowValues(first as NonNullable<typeof first>, applied, basis);
    const file = buildBarFile(ISIN, [row], true);
    expect(file.sql).toContain(String(row.close));
  });

  it("refuses an invalid isin or a non finite number", () => {
    const row = backfillRowValues(bar("2026-10-22", 10), [], "2026-10-22");
    expect(() => buildBarFile("bad", [row], true)).toThrow();
    expect(() => buildBarFile(ISIN, [{ ...row, close: Number.NaN }], true)).toThrow();
  });
});

describe("action statements", () => {
  const actions = [
    { ticker: TICKER, kind: "bonus" as const, announcedOn: "2025-05-13", exDate: "2025-12-17", sourceText: "توزيع | it's ok" },
    { ticker: TICKER, kind: "cash_dividend" as const, announcedOn: null, exDate: "2025-06-01", sourceText: "نقدي | x" },
  ];

  it("counts four rows per action and three per notice", () => {
    const batch = buildActionStatements(ISIN, actions, NOW);
    expect(batch.estimatedRows).toBe(2 * ACTION_ROWS_WRITTEN + NOTICE_ROWS_WRITTEN);
  });

  it("inserts actions as the end-of-day job does and raises one needs_ratio notice for the bonus", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    const batch = buildActionStatements(ISIN, actions, NOW);
    sqlite.exec(batch.sql);
    sqlite.exec(batch.sql);
    const stored = sqlite.prepare("SELECT kind, status, source, source_text FROM corporate_actions ORDER BY kind").all();
    expect(stored).toEqual([
      { kind: "bonus", status: "needs_ratio", source: "mubasher", source_text: "توزيع | it's ok" },
      { kind: "cash_dividend", status: "recorded", source: "mubasher", source_text: "نقدي | x" },
    ]);
    const notices = sqlite.prepare("SELECT kind, subject, dedupe_key FROM notices").all();
    expect(notices).toEqual([
      { kind: "needs_ratio", subject: "COMI bonus 2025-12-17", dedupe_key: "needs_ratio|COMI bonus 2025-12-17|2026-10-14" },
    ]);
  });

  it("raises no new notice for a needs_ratio row that already existed", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    sqlite.exec(
      `INSERT INTO corporate_actions (isin, kind, announced_on, ex_date, status, source, source_text, created_at, updated_at) VALUES ('${ISIN}', 'bonus', NULL, '2025-12-17', 'needs_ratio', 'mubasher', 'x', 1, 1)`,
    );
    sqlite.exec(buildActionStatements(ISIN, [actions[0]!], NOW).sql);
    expect(sqlite.prepare("SELECT kind FROM notices").all()).toEqual([]);
  });

  it("refuses an invalid isin, kind or date", () => {
    expect(() => buildActionStatements("bad", actions, NOW)).toThrow();
    expect(() => buildActionStatements(ISIN, [{ ...actions[0]!, exDate: "x" }], NOW)).toThrow();
    expect(() => buildActionStatements(ISIN, [{ ...actions[0]!, ticker: "A'B" }], NOW)).toThrow();
  });
});

describe("fetchSymbolActions", () => {
  const symbol = { isin: ISIN, ticker: TICKER };
  const noPause = () => Promise.resolve();

  it("stops with an error when the source has more pages than the cap", async () => {
    const fetchText = () => Promise.resolve(JSON.stringify({ numberOfPages: MAX_ACTION_PAGES + 1, rows: [] }));
    await expect(fetchSymbolActions(symbol, "2021-01-01", fetchText, noPause)).rejects.toThrow(/pages/);
  });

  it("reads every page up to the cap", async () => {
    const urls: string[] = [];
    const fetchText = (url: string) => {
      urls.push(url);
      return Promise.resolve(JSON.stringify({ numberOfPages: 2, rows: [] }));
    };
    await expect(fetchSymbolActions(symbol, "2021-01-01", fetchText, noPause)).resolves.toEqual([]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("page=2");
  });
});

describe("wrangler output", () => {
  it("sums rows written over every statement and returns the first result rows", () => {
    const stdout = `noise\n${JSON.stringify([
      { results: [{ a: 1 }], success: true, meta: { rows_written: 3 } },
      { results: [], success: true, meta: { rows_written: 4 } },
    ])}`;
    expect(parseD1Output(stdout)).toEqual({ rows: [{ a: 1 }], rowsWritten: 7 });
  });

  it("throws on output without json or on a failed statement", () => {
    expect(() => parseD1Output("nothing")).toThrow();
    expect(() => parseD1Output(JSON.stringify([{ results: [], success: false, meta: { rows_written: 0 } }]))).toThrow();
  });

  it("reads version ids and plain text caps", () => {
    expect(parseDeploymentVersionIds({ versions: [{ version_id: "a", percentage: 90 }, { version_id: "b", percentage: 10 }] })).toEqual([
      "a",
      "b",
    ]);
    const version = {
      resources: {
        bindings: [
          { type: "plain_text", name: "GLOBAL_DAILY_CALLS", text: "15000" },
          { type: "plain_text", name: "ADJUST_MAX_ROWS_PER_DAY", text: "10000" },
          { type: "plain_text", name: "PERSONAL_DAILY_ROWS", text: "5000" },
          { type: "plain_text", name: "BACKFILL_MAX_ROWS_PER_DAY", text: "36000" },
          { type: "d1", name: "DB" },
        ],
      },
    };
    expect(parseVersionCaps(version)).toEqual(CAPS);
  });

  it("stops when a cap is missing or not a number", () => {
    expect(() => parseVersionCaps({ resources: { bindings: [] } })).toThrow(/GLOBAL_DAILY_CALLS/);
    expect(() =>
      parseVersionCaps({ resources: { bindings: [{ type: "plain_text", name: "GLOBAL_DAILY_CALLS", text: "many" }] } }),
    ).toThrow();
  });

  it("merges versions taking the largest caps and the smallest backfill cap", () => {
    expect(
      mergeCaps([CAPS, { ...CAPS, GLOBAL_DAILY_CALLS: 20000, ADJUST_MAX_ROWS_PER_DAY: 5000, BACKFILL_MAX_ROWS_PER_DAY: 20000 }]),
    ).toEqual({ ...CAPS, GLOBAL_DAILY_CALLS: 20000, BACKFILL_MAX_ROWS_PER_DAY: 20000 });
  });

  it("reads configured caps from wrangler.jsonc and reports differences", () => {
    const text = `{ // c\n "vars": { "GLOBAL_DAILY_CALLS": "15000", "ADJUST_MAX_ROWS_PER_DAY": "10000", "PERSONAL_DAILY_ROWS": "5000", "BACKFILL_MAX_ROWS_PER_DAY": "36000" } }`;
    const configured = readConfiguredCaps(text);
    expect(configured).toEqual(CAPS);
    expect(capDifferences({ ...CAPS, PERSONAL_DAILY_ROWS: 4000 }, configured)).toEqual([
      { name: "PERSONAL_DAILY_ROWS", deployed: 4000, configured: 5000 },
    ]);
    expect(capDifferences(CAPS, configured)).toEqual([]);
  });
});

describe("computeAllowance", () => {
  it("uses the budget formula with the accounting rows per call", () => {
    const usage = { calls: 100, adjust_rows: 0, personal_rows: 0, backfill_rows: 1000 };
    const allowance = computeAllowance(usage, CAPS);
    expect(allowance).toBe(
      Math.max(0, Math.min(36000 - 1000, 100000 - 2 * 15000 - 10000 - 5000 - 16000 - 3000 - 1000)),
    );
  });

  it("is zero once the day is used", () => {
    expect(computeAllowance({ calls: 0, adjust_rows: 0, personal_rows: 0, backfill_rows: 36000 }, CAPS)).toBe(0);
  });
});

describe("attemptSymbol", () => {
  const symbols = [
    { isin: ISIN, ticker: "BAD" },
    { isin: "EGS60131C017", ticker: "GOOD" },
  ];

  async function loadAll(fetchText: (url: string) => Promise<string>, messages: string[]): Promise<string[]> {
    const loaded: string[] = [];
    for (const symbol of symbols) {
      const outcome = await attemptSymbol(
        symbol,
        () => fetchSymbolActions(symbol, "2021-01-01", fetchText, () => Promise.resolve()),
        (message) => messages.push(message),
      );
      if (outcome.ok) loaded.push(symbol.ticker);
    }
    return loaded;
  }

  it("reports a symbol whose fetch answers an error and keeps the next one loading", async () => {
    const messages: string[] = [];
    const fetchText = (url: string) =>
      url.includes("symbol=BAD") ? Promise.reject(new Error("answered 404")) : Promise.resolve(JSON.stringify({ numberOfPages: 1, rows: [] }));
    expect(await loadAll(fetchText, messages)).toEqual(["GOOD"]);
    expect(messages).toEqual(["BAD: answered 404"]);
  });

  it("reports a symbol whose answer is HTML and keeps the next one loading", async () => {
    const messages: string[] = [];
    const fetchText = (url: string) =>
      Promise.resolve(url.includes("symbol=BAD") ? "<html>blocked</html>" : JSON.stringify({ numberOfPages: 1, rows: [] }));
    expect(await loadAll(fetchText, messages)).toEqual(["GOOD"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^BAD: /);
  });

  it("reports a price file with no rows and goes on", async () => {
    const messages: string[] = [];
    const outcome = await attemptSymbol(
      symbols[0]!,
      async () => {
        if (parseBars("").length === 0) throw new Error("BAD: the CSV holds no rows");
      },
      (message) => messages.push(message),
    );
    expect(outcome).toEqual({ ok: false });
    expect(messages).toEqual(["BAD: BAD: the CSV holds no rows"]);
  });

  it("lets the stop for the day propagate", async () => {
    const messages: string[] = [];
    await expect(
      attemptSymbol(symbols[0]!, () => Promise.reject(new StopForTheDay("stop")), (message) => messages.push(message)),
    ).rejects.toBeInstanceOf(StopForTheDay);
    expect(messages).toEqual([]);
  });

  it("returns the value of a successful symbol", async () => {
    expect(await attemptSymbol(symbols[0]!, () => Promise.resolve(7), () => undefined)).toEqual({ ok: true, value: 7 });
  });
});

describe("recentClosesQuery", () => {
  function seedBar(sqlite: ReturnType<typeof createSqliteD1>["sqlite"], isin: string, date: string, close: number): void {
    sqlite.exec(
      `INSERT INTO daily_bars (isin, session_date, open, high, low, close, volume, adj_open, adj_high, adj_low, adj_close, adj_factor, raw_derived, source) VALUES ('${isin}', '${date}', ${close}, ${close}, ${close}, ${close}, 1, ${close}, ${close}, ${close}, ${close}, 1, 0, 't')`,
    );
  }

  it("anchors the window on each symbol's own newest bar", () => {
    const { sqlite } = createSqliteD1();
    const illiquid = "EGS60131C017";
    seedSymbol(sqlite);
    sqlite.exec(
      `INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES ('${illiquid}', 'SLOW', 'active', 1, 1)`,
    );
    seedBar(sqlite, ISIN, "2026-10-20", 10);
    seedBar(sqlite, ISIN, "2026-10-22", 11);
    seedBar(sqlite, illiquid, "2026-09-20", 5);
    seedBar(sqlite, illiquid, "2026-09-25", 6);
    const rows = sqlite.prepare(recentClosesQuery(14)).all() as Array<{ isin: string; session_date: string; close: number }>;
    expect(rows.filter((row) => row.isin === illiquid).map((row) => row.session_date).sort()).toEqual(["2026-09-20", "2026-09-25"]);
    expect(rows.filter((row) => row.isin === ISIN)).toHaveLength(2);
  });

  it("leaves out bars older than the window before the symbol's newest bar", () => {
    const { sqlite } = createSqliteD1();
    seedSymbol(sqlite);
    seedBar(sqlite, ISIN, "2026-09-01", 9);
    seedBar(sqlite, ISIN, "2026-10-22", 11);
    const rows = sqlite.prepare(recentClosesQuery(14)).all() as Array<{ session_date: string }>;
    expect(rows.map((row) => row.session_date)).toEqual(["2026-10-22"]);
  });

  it("skips inactive symbols", () => {
    const { sqlite } = createSqliteD1();
    sqlite.exec(`INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES ('${ISIN}', '${TICKER}', 'inactive', 1, 1)`);
    seedBar(sqlite, ISIN, "2026-10-22", 11);
    expect(sqlite.prepare(recentClosesQuery(14)).all()).toEqual([]);
  });
});

describe("loadingRefusal", () => {
  it("is null when no symbol is still loading", () => {
    expect(loadingRefusal([{ isin: ISIN, state: "done" }])).toBeNull();
    expect(loadingRefusal([])).toBeNull();
  });

  it("names the symbols still loading and says to finish the load first", () => {
    const message = loadingRefusal([
      { isin: ISIN, state: "loading" },
      { isin: "EGS60131C017", state: "done" },
      { isin: "EGS60141C016", state: "loading" },
    ]);
    expect(message).toContain(ISIN);
    expect(message).toContain("EGS60141C016");
    expect(message).not.toContain("EGS60131C017");
    expect(message).toMatch(/finish the load first/i);
  });
});
