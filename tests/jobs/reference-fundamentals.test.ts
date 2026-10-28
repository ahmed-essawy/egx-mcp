import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { referenceJob } from "../../src/jobs/reference";
import { mapMubasherActionKind, parseMubasherActionRow } from "../../src/providers/mubasher";
import { upsertAliases, upsertListings } from "../../src/store/d1/symbols";
import mubasherActions from "../fixtures/mubasher-actions-p1.json";
import mubasherFunds from "../fixtures/mubasher-funds-p1.json";
import tradingViewFundamentals from "../fixtures/tradingview-fundamentals.json";
import { restoreBindings } from "../helpers/bindings";
import {
  clearStores,
  createJobRunner,
  failingUpstream,
  firstPageOnly,
  fixtureResponse,
  notFound,
  readLastRunDate,
  readNotices,
  requestUrl,
} from "../helpers/jobs";
import type { PageUpstream, Upstream } from "../helpers/jobs";
import { DIRECTORY_KEY, seedCalendar } from "../helpers/seed";

const RUN_DAY = "2026-10-25";
const NEXT_DAY = "2026-10-26";
const THIRD_DAY = "2026-10-27";
const EPS_COLUMN = 6;
const CHANGED_EPS = 25.5;
const SEEDED_FETCHED_AT = 1;
const UNKNOWN_PERIOD_END = "";
const RUN_TIME = "19:00";
const LATER_RUN_TIME = "21:00";
const STORE_TABLES = [
  "corporate_actions",
  "financial_figures",
  "symbols",
  "symbol_aliases",
  "funds",
  "nav_records",
  "market_events",
  "notices",
  "job_state",
  "market_calendar",
];
const REFERENCE_JOB = "reference";
const ACTIONS_STEP = "corporateActions";
const FUNDAMENTALS_STEP = "fundamentals";
const MUBASHER = "mubasher";
const TRADINGVIEW = "tradingview";
const MUBASHER_FUNDS_URL = "https://www.mubasher.info/api/1/funds";
const MUBASHER_ACTIONS_URL = "https://www.mubasher.info/api/1/corporate-actions";
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const ACTION_PAGES = [1, 2, 3];
const SCAN_RANGE = [0, 400];
const SCAN_COLUMNS = [
  "name",
  "isin",
  "total_revenue_fy",
  "net_income_fy",
  "total_equity_fq",
  "total_debt_fq",
  "earnings_per_share_basic_ttm",
  "dps_common_stock_prim_issue_fy",
  "dividend_amount_recent",
  "ex_dividend_date_recent",
  "ex_dividend_date_upcoming",
  "fiscal_period_end",
  "currency",
  "fundamental_currency_code",
];
const FIRST_FIGURE_COLUMN = 2;
const LAST_FIGURE_COLUMN = 7;
const FISCAL_PERIOD_END_COLUMN = 11;
const NET_INCOME_COLUMN = 3;
const FIGURE_COUNT = tradingViewFundamentals.data.reduce(
  (total, row) => total + row.d.slice(FIRST_FIGURE_COLUMN, LAST_FIGURE_COLUMN + 1).filter((value) => value !== null).length,
  0,
);
const COMI_TICKER = "COMI";
const COMI_ISIN = "EGS60121C018";
const COMI_FIGURES = [
  { metric: "revenue", period_type: "FY", value: 230151557000 },
  { metric: "net_income", period_type: "FY", value: 61634295000 },
  { metric: "total_equity", period_type: "FQ", value: 238416239000 },
  { metric: "total_debt", period_type: "FQ", value: 82394734000 },
  { metric: "eps_basic", period_type: "TTM", value: 21.1557 },
  { metric: "dps", period_type: "FY", value: 6 },
];
const EPS_METRIC = "eps_basic";
const COMI_EPS = 21.1557;
const COMI_FIGURE_COUNT = COMI_FIGURES.length;
const COMI_FISCAL_END_SECONDS = Date.UTC(2026, 5, 30) / 1000;
const COMI_FISCAL_END_DATE = "2026-06-30";
const CHANGED_NET_INCOME = 70000000000;
const CHANGED_ROW_COUNT = 1;
const SEEDED_STATUS = "active";
const CASH_DIVIDEND_COUNT = 6;
const BONUS_COUNT = 6;
const RIGHTS_COUNT = 1;
const OTHER_COUNT = 4;
const ACTION_COUNT = CASH_DIVIDEND_COUNT + BONUS_COUNT + RIGHTS_COUNT + OTHER_COUNT;
const BONUS_TYPE = "توزيع أسهم خزينة كأسهم منحة";
const UNMAPPED_TICKER = "EXPA_r1";
const WKOL_TICKER = "WKOL";
const WKOL_BONUS_EX_DATE = "2026-11-04";
const WKOL_ANNOUNCED_ON = "2025-11-09";
const FERC_TICKER = "FERC";
const SUGR_TICKER = "SUGR";
const MATCHED_DIVIDENDS = [
  { ticker: "ISPH", exDate: "2026-10-12", amount: 0.130004004 },
  { ticker: "MHOT", exDate: "2026-10-13", amount: 1.20000005 },
  { ticker: "MIPH", exDate: "2026-08-12", amount: 2.5 },
  { ticker: "ACAMD", exDate: "2026-08-10", amount: 0.100000001 },
];
const UNMATCHED_DIVIDEND_TICKERS = [FERC_TICKER, SUGR_TICKER];
const AMOUNT_PRECISION = 6;
const COMI_RECENT_EX_DATE = "2026-04-07";
const SOURCE_TEXT_SEPARATOR = " | ";

type Row = Record<string, unknown>;
type ActionRecord = {
  ticker: string;
  kind: string;
  ex_date: string;
  announced_on: string | null;
  status: string;
  ratio: number | null;
  amount: number | null;
  currency: string | null;
  source: string;
  source_text: string | null;
};
type FigureRecord = {
  isin: string;
  metric: string;
  period_type: string;
  period_end: string;
  period_inferred: number;
  value: number;
  currency: string;
  source: string;
  fetched_at: number | null;
};
type EventRecord = { kind: string; isin: string | null };
type Upstreams = { funds: PageUpstream; actions: PageUpstream; fundamentals: Upstream };

function actionsPage(rows: Row[]) {
  return { ...mubasherActions, rows };
}

function actionRow(patch: Row = {}, index = 0): Row {
  return { ...(mubasherActions.rows[index] as Row), ...patch };
}

function scanWith(ticker: string, patch: Record<number, unknown>) {
  const data = tradingViewFundamentals.data.map((row) => {
    if (row.d[0] !== ticker) return row;
    const values: unknown[] = [...row.d];
    for (const [column, value] of Object.entries(patch)) values[Number(column)] = value;
    return { ...row, d: values };
  });
  return { ...tradingViewFundamentals, data };
}

function stubFetch(upstreams: Partial<Upstreams> = {}) {
  const stub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) {
      return (upstreams.fundamentals ?? fixtureResponse(tradingViewFundamentals))();
    }
    const page = Number(new URL(url).searchParams.get("page"));
    if (url.startsWith(MUBASHER_FUNDS_URL)) return (upstreams.funds ?? firstPageOnly(mubasherFunds))(page);
    if (url.startsWith(MUBASHER_ACTIONS_URL)) return (upstreams.actions ?? firstPageOnly(mubasherActions))(page);
    return notFound();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function createRunner() {
  return createJobRunner(referenceJob, { date: RUN_DAY, time: RUN_TIME });
}

async function seedListedSymbols(): Promise<void> {
  const rows = tradingViewFundamentals.data.map((row) => ({
    isin: String(row.d[1]),
    ticker: String(row.d[0]),
  }));
  await upsertListings(
    env.DB,
    rows.map((row) => ({
      ...row,
      nameAr: null,
      nameEn: null,
      sector: null,
      status: SEEDED_STATUS,
      sharesOutstanding: null,
      freeFloatShares: null,
    })),
    1,
  );
  await upsertAliases(
    env.DB,
    rows.map((row) => ({ isin: row.isin, kind: "ticker" as const, value: row.ticker, provider: null })),
    1,
  );
}

async function readActions(): Promise<ActionRecord[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT s.ticker, a.kind, a.ex_date, a.announced_on, a.status, a.ratio, a.amount, a.currency, a.source, a.source_text
       FROM corporate_actions a JOIN symbols s ON s.isin = a.isin ORDER BY a.id`,
    )
    .all<ActionRecord>();
  return results;
}

async function readFigures(isin?: string): Promise<FigureRecord[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT isin, metric, period_type, period_end, period_inferred, value, currency, source, fetched_at
       FROM financial_figures WHERE ?1 IS NULL OR isin = ?1 ORDER BY isin, metric, period_type, period_end`,
    )
    .bind(isin ?? null)
    .all<FigureRecord>();
  return results;
}

async function seedDatedEps(): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO financial_figures (isin, metric, period_type, period_end, period_inferred, value, currency, source, fetched_at)
       VALUES (?1, ?2, 'TTM', ?3, 0, ?4, 'EGP', ?5, ?6)`,
    )
    .bind(COMI_ISIN, EPS_METRIC, COMI_FISCAL_END_DATE, COMI_EPS, TRADINGVIEW, SEEDED_FETCHED_AT)
    .run();
}

async function readEps(): Promise<FigureRecord[]> {
  return (await readFigures(COMI_ISIN)).filter((figure) => figure.metric === EPS_METRIC);
}

async function readActionEvents(): Promise<EventRecord[]> {
  const { results } = await env.DB
    .prepare("SELECT kind, isin FROM market_events WHERE kind = 'corporate_action' ORDER BY id")
    .all<EventRecord>();
  return results;
}

async function stepFailures(step: string) {
  const failures = await readNotices("job_failed");
  return failures.filter((notice) => notice.details.step === step);
}

function actionOf(actions: ActionRecord[], ticker: string, kind?: string): ActionRecord | undefined {
  return actions.find((action) => action.ticker === ticker && (kind === undefined || action.kind === kind));
}

const KIND_CASES: ReadonlyArray<readonly [string, string]> = [
  ["توزيع أرباح نقدية", "cash_dividend"],
  ["توزيع أسهم منحة", "bonus"],
  ["توزيع أسهم خزينة كأسهم منحة", "bonus"],
  ["تجزئة", "split"],
  ["تجميع", "reverse_split"],
  ["زيادة رأس مال", "rights"],
  ["زيادة رأس مال - إصدار حقوق أولوية", "rights"],
  ["تغيير اسم الشركة", "name_change"],
  ["تخفيض رأس مال - إعدام أسهم خزينة", "other"],
  ["تخفيض رأس مال - بتخفيض قيمة أسمية", "other"],
  ["نوع غير معروف", "other"],
  ["", "other"],
];

describe("mapMubasherActionKind", () => {
  it.each(KIND_CASES)("maps %s to %s", (type, kind) => {
    expect(mapMubasherActionKind(type)).toBe(kind);
  });
});

describe("parseMubasherActionRow", () => {
  it("takes the ticker from the url and parses both dates", () => {
    const action = parseMubasherActionRow(mubasherActions.rows[0] as Row);

    expect(action).toEqual({
      ticker: FERC_TICKER,
      kind: "cash_dividend",
      announcedOn: "2026-04-23",
      exDate: "2026-11-10",
      sourceText: `${mubasherActions.rows[0]?.type}${SOURCE_TEXT_SEPARATOR}${mubasherActions.rows[0]?.description}`,
    });
  });

  it("keeps the whole last url segment as the ticker", () => {
    const action = parseMubasherActionRow(actionRow({ url: `/markets/EGX/stocks/${UNMAPPED_TICKER}` }));

    expect(action?.ticker).toBe(UNMAPPED_TICKER);
  });

  it("maps the type through mapMubasherActionKind", () => {
    const action = parseMubasherActionRow(actionRow({ type: "تجزئة" }));

    expect(action?.kind).toBe("split");
  });

  it("returns a null announcedOn when announcedAt is missing or unparsable", () => {
    expect(parseMubasherActionRow(actionRow({ announcedAt: null }))?.announcedOn).toBeNull();
    expect(parseMubasherActionRow(actionRow({ announcedAt: "غير معروف" }))?.announcedOn).toBeNull();
  });

  it("returns null when effectiveFrom is missing or unparsable", () => {
    expect(parseMubasherActionRow(actionRow({ effectiveFrom: null }))).toBeNull();
    expect(parseMubasherActionRow(actionRow({ effectiveFrom: "غير معروف" }))).toBeNull();
  });

  it("returns null when the url has no ticker", () => {
    expect(parseMubasherActionRow(actionRow({ url: null }))).toBeNull();
    expect(parseMubasherActionRow(actionRow({ url: "" }))).toBeNull();
  });
});

describe("referenceJob corporate actions and fundamentals steps", () => {
  beforeEach(async () => {
    await clearStores([DIRECTORY_KEY], STORE_TABLES);
    await seedListedSymbols();
  });

  afterEach(() => {
    restoreBindings();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("Mubasher corporate actions", () => {
    it("pages Mubasher corporate actions from 1 to 3", async () => {
      const fetchStub = stubFetch();

      await createRunner().run();

      const pages = fetchStub.mock.calls
        .map(([input]) => requestUrl(input))
        .filter((url) => url.startsWith(MUBASHER_ACTIONS_URL))
        .map((url) => Number(new URL(url).searchParams.get("page")));
      expect(pages).toEqual(ACTION_PAGES);
    });

    it("inserts one action per distinct isin, kind and ex date and skips tickers without an isin", async () => {
      stubFetch();

      await createRunner().run();
      const actions = await readActions();
      const kinds = (kind: string) => actions.filter((action) => action.kind === kind);

      expect(actions).toHaveLength(ACTION_COUNT);
      expect(kinds("cash_dividend")).toHaveLength(CASH_DIVIDEND_COUNT);
      expect(kinds("bonus")).toHaveLength(BONUS_COUNT);
      expect(kinds("rights")).toHaveLength(RIGHTS_COUNT);
      expect(kinds("other")).toHaveLength(OTHER_COUNT);
      expect(actions.map((action) => action.ticker)).not.toContain(UNMAPPED_TICKER);
      expect(await readLastRunDate(REFERENCE_JOB)).toBe(RUN_DAY);
      expect(await stepFailures(ACTIONS_STEP)).toEqual([]);
    });

    it("keeps the needs_ratio notices of the actions step when the fundamentals step fails", async () => {
      stubFetch({ fundamentals: failingUpstream });

      await createRunner().run();

      expect(await readNotices("needs_ratio")).toHaveLength(BONUS_COUNT);
      expect(await stepFailures(FUNDAMENTALS_STEP)).toHaveLength(1);
    });

    it("records the announcement date, source and source text", async () => {
      stubFetch();

      await createRunner().run();
      const bonus = actionOf(await readActions(), WKOL_TICKER, "bonus");

      expect(bonus).toMatchObject({
        ex_date: WKOL_BONUS_EX_DATE,
        announced_on: WKOL_ANNOUNCED_ON,
        source: MUBASHER,
        source_text: `${BONUS_TYPE}${SOURCE_TEXT_SEPARATOR}توزيع أسهم منحة بنسبة`,
      });
    });

    it("inserts bonus actions as needs_ratio with no ratio and cash dividends as recorded", async () => {
      stubFetch();

      await createRunner().run();
      const actions = await readActions();

      const bonuses = actions.filter((action) => action.kind === "bonus");
      expect(bonuses.every((action) => action.status === "needs_ratio" && action.ratio === null)).toBe(true);
      const cash = actions.filter((action) => action.kind === "cash_dividend");
      expect(cash.every((action) => action.status === "recorded")).toBe(true);
    });

    it.each([
      ["تجزئة", "split"],
      ["تجميع", "reverse_split"],
    ])("inserts a %s action as %s with needs_ratio", async (type, kind) => {
      stubFetch({ actions: firstPageOnly(actionsPage([actionRow({ type, url: `/markets/EGX/stocks/${WKOL_TICKER}` })])) });

      await createRunner().run();
      const actions = await readActions();

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ ticker: WKOL_TICKER, kind, status: "needs_ratio", ratio: null });
    });

    it("raises one needs_ratio notice per inserted bonus, split or reverse split", async () => {
      stubFetch();

      await createRunner().run();
      const notices = await readNotices("needs_ratio");
      const bonuses = (await readActions()).filter((action) => action.kind === "bonus");

      expect(notices).toHaveLength(BONUS_COUNT);
      expect(notices.map((notice) => notice.subject).sort()).toEqual(
        bonuses.map((action) => `${action.ticker} ${action.kind} ${action.ex_date}`).sort(),
      );
      const wkol = notices.find((notice) => notice.subject === `${WKOL_TICKER} bonus ${WKOL_BONUS_EX_DATE}`);
      expect(wkol?.details).toMatchObject({
        ticker: WKOL_TICKER,
        kind: "bonus",
        exDate: WKOL_BONUS_EX_DATE,
        source: MUBASHER,
      });
      expect(typeof wkol?.details.actionId).toBe("number");
    });

    it.each([
      ["تجزئة", "split"],
      ["تجميع", "reverse_split"],
    ])("raises a needs_ratio notice for a %s action", async (type, kind) => {
      stubFetch({ actions: firstPageOnly(actionsPage([actionRow({ type, url: `/markets/EGX/stocks/${WKOL_TICKER}` })])) });

      await createRunner().run();
      const notices = await readNotices("needs_ratio");

      expect(notices.map((notice) => notice.subject)).toEqual([`${WKOL_TICKER} ${kind} 2026-11-10`]);
    });

    it("raises no needs_ratio notice for cash dividends, rights, name changes or other kinds", async () => {
      const rows = [
        actionRow({ type: "توزيع أرباح نقدية" }),
        actionRow({ type: "زيادة رأس مال - إصدار حقوق أولوية" }),
        actionRow({ type: "تغيير اسم الشركة" }),
        actionRow({ type: "تخفيض رأس مال - إعدام أسهم خزينة" }),
      ].map((row, index) => ({ ...row, effectiveFrom: `${index + 1} نوفمبر 2026` }));
      stubFetch({ actions: firstPageOnly(actionsPage(rows)) });

      await createRunner().run();

      expect(await readActions()).toHaveLength(rows.length);
      expect(await readNotices("needs_ratio")).toEqual([]);
    });

    it("writes one corporate_action event per inserted row", async () => {
      stubFetch();

      await createRunner().run();
      const events = await readActionEvents();
      const { results } = await env.DB.prepare("SELECT isin FROM corporate_actions").all<{ isin: string }>();

      expect(events).toHaveLength(ACTION_COUNT);
      expect(events.map((event) => event.isin).sort()).toEqual(results.map((row) => row.isin).sort());
    });

    it("inserts nothing new and raises nothing new when the same actions come back on the next run", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      const actionsBefore = await readActions();
      const noticesBefore = await readNotices("needs_ratio");
      const eventsBefore = await readActionEvents();

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readActions()).toEqual(actionsBefore);
      expect(await readNotices("needs_ratio")).toEqual(noticesBefore);
      expect(await readActionEvents()).toEqual(eventsBefore);
    });

    it("raises events and notices only for the actions that are new on the next run", async () => {
      const runner = createRunner();
      stubFetch({ actions: firstPageOnly(actionsPage([actionRow()])) });
      await runner.run();
      stubFetch({
        actions: firstPageOnly(
          actionsPage([actionRow(), actionRow({ type: "تجزئة", url: `/markets/EGX/stocks/${WKOL_TICKER}` })]),
        ),
      });

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readActions()).toHaveLength(2);
      expect(await readActionEvents()).toHaveLength(2);
      expect(await readNotices("needs_ratio")).toHaveLength(1);
    });
  });

  describe("cash dividend amounts from TradingView", () => {
    it("sets amount and currency on cash dividends whose ex date matches dividend_amount_recent", async () => {
      stubFetch();

      await createRunner().run();
      const actions = await readActions();

      for (const expected of MATCHED_DIVIDENDS) {
        const action = actionOf(actions, expected.ticker, "cash_dividend");
        expect(action?.ex_date).toBe(expected.exDate);
        expect(action?.amount).toBeCloseTo(expected.amount, AMOUNT_PRECISION);
        expect(action?.currency).toBe("EGP");
        expect(action?.status).toBe("recorded");
      }
    });

    it("leaves amount null when the ex dates do not match", async () => {
      stubFetch();

      await createRunner().run();
      const actions = await readActions();

      for (const ticker of UNMATCHED_DIVIDEND_TICKERS) {
        expect(actionOf(actions, ticker, "cash_dividend")?.amount).toBeNull();
      }
    });

    it("does not overwrite an amount that is already set", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      await env.DB.prepare("UPDATE corporate_actions SET amount = 99 WHERE kind = 'cash_dividend'").run();

      await runner.run(RUN_TIME, NEXT_DAY);

      const cash = (await readActions()).filter((action) => action.kind === "cash_dividend");
      expect(cash.filter((action) => action.amount === 99)).toHaveLength(CASH_DIVIDEND_COUNT);
    });
  });

  describe("TradingView figures", () => {
    it("requests the T096 columns with range 0 to 400", async () => {
      const fetchStub = stubFetch();

      await createRunner().run();
      const call = fetchStub.mock.calls.find(([input]) => requestUrl(input).startsWith(TRADINGVIEW_SCAN_URL));
      const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as {
        columns: string[];
        range: number[];
      };

      expect(body.columns).toEqual(SCAN_COLUMNS);
      expect(body.range).toEqual(SCAN_RANGE);
    });

    it("stores every non null figure with its metric, period type and source", async () => {
      stubFetch();

      await createRunner().run();
      const figures = await readFigures();
      const comi = await readFigures(COMI_ISIN);

      expect(figures).toHaveLength(FIGURE_COUNT);
      expect(comi.map(({ metric, period_type, value }) => ({ metric, period_type, value }))).toEqual(
        [...COMI_FIGURES].sort((a, b) => a.metric.localeCompare(b.metric)),
      );
      expect(comi.every((figure) => figure.currency === "EGP" && figure.source === TRADINGVIEW)).toBe(true);
      expect(await stepFailures(FUNDAMENTALS_STEP)).toEqual([]);
    });

    it("stores an unknown period end and period_inferred 1 when fiscal_period_end is null", async () => {
      stubFetch();

      await createRunner().run();
      const comi = await readFigures(COMI_ISIN);

      expect(comi).toHaveLength(COMI_FIGURE_COUNT);
      expect(comi.every((figure) => figure.period_end === UNKNOWN_PERIOD_END && figure.period_inferred === 1)).toBe(
        true,
      );
    });

    it("does not add rows when the raw fixture is fetched again on another Cairo date", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      const before = await readFigures();

      await runner.run(RUN_TIME, NEXT_DAY);
      const after = await readFigures();

      expect(before).toHaveLength(FIGURE_COUNT);
      expect(after).toEqual(before);
    });

    it("adds no undated row when a dated row already holds the same value", async () => {
      const runner = createRunner();
      await seedDatedEps();
      stubFetch();

      await runner.run();
      const eps = (await readFigures(COMI_ISIN)).filter((figure) => figure.metric === EPS_METRIC);

      expect(eps).toHaveLength(1);
      expect(eps[0]?.period_end).toBe(COMI_FISCAL_END_DATE);
    });

    it("bumps the dated row once when the source returns to it after an undated change", async () => {
      const runner = createRunner();
      await seedDatedEps();
      stubFetch({ fundamentals: fixtureResponse(scanWith(COMI_TICKER, { [EPS_COLUMN]: CHANGED_EPS })) });
      await runner.run();
      const afterUndated = await readEps();
      stubFetch({
        fundamentals: fixtureResponse(scanWith(COMI_TICKER, { [FISCAL_PERIOD_END_COLUMN]: COMI_FISCAL_END_SECONDS })),
      });
      await runner.run(RUN_TIME, NEXT_DAY);
      const afterDated = await readEps();
      await runner.run(RUN_TIME, THIRD_DAY);
      const afterRepeat = await readEps();

      expect(afterUndated.map((figure) => figure.period_end)).toEqual([UNKNOWN_PERIOD_END, COMI_FISCAL_END_DATE]);
      expect(afterUndated[1]?.fetched_at).toBe(SEEDED_FETCHED_AT);
      expect(afterDated).toHaveLength(afterUndated.length);
      expect(afterDated[1]?.fetched_at).toBeGreaterThan(afterUndated[0]?.fetched_at ?? 0);
      expect(afterRepeat).toEqual(afterDated);
    });

    it("takes the fiscal_period_end Cairo date for FQ and TTM figures and leaves FY figures undated", async () => {
      stubFetch({
        fundamentals: fixtureResponse(scanWith(COMI_TICKER, { [FISCAL_PERIOD_END_COLUMN]: COMI_FISCAL_END_SECONDS })),
      });

      await createRunner().run();
      const comi = await readFigures(COMI_ISIN);

      const fiscalYear = comi.filter((figure) => figure.period_type === "FY");
      const others = comi.filter((figure) => figure.period_type !== "FY");
      expect(fiscalYear.length).toBeGreaterThan(0);
      expect(fiscalYear.every((figure) => figure.period_end === UNKNOWN_PERIOD_END && figure.period_inferred === 1)).toBe(
        true,
      );
      expect(others.every((figure) => figure.period_end === COMI_FISCAL_END_DATE && figure.period_inferred === 0)).toBe(
        true,
      );
    });

    it("defaults the currency to EGP and keeps a provided currency", async () => {
      stubFetch({
        fundamentals: fixtureResponse(scanWith(COMI_TICKER, { 12: null })),
      });

      await createRunner().run();

      expect((await readFigures(COMI_ISIN)).every((figure) => figure.currency === "EGP")).toBe(true);
    });

    it("stores the quote currency on the symbol and the fundamental currency on the figures", async () => {
      stubFetch({ fundamentals: fixtureResponse(scanWith(COMI_TICKER, { 12: "USD", 13: "EGP" })) });

      await createRunner().run();
      const symbol = await env.DB.prepare("SELECT quote_currency FROM symbols WHERE isin = ?1").bind(COMI_ISIN).first();

      expect(symbol).toEqual({ quote_currency: "USD" });
      expect((await readFigures(COMI_ISIN)).every((figure) => figure.currency === "EGP")).toBe(true);
    });

    it("upserts a figure only when its value changed", async () => {
      const runner = createRunner();
      const withFiscalEnd = { [FISCAL_PERIOD_END_COLUMN]: COMI_FISCAL_END_SECONDS };
      stubFetch({ fundamentals: fixtureResponse(scanWith(COMI_TICKER, withFiscalEnd)) });
      await runner.run();
      const before = await readFigures(COMI_ISIN);
      stubFetch({
        fundamentals: fixtureResponse(scanWith(COMI_TICKER, { ...withFiscalEnd, [NET_INCOME_COLUMN]: CHANGED_NET_INCOME })),
      });

      await runner.run(RUN_TIME, NEXT_DAY);
      const after = await readFigures(COMI_ISIN);

      expect(after).toHaveLength(COMI_FIGURE_COUNT);
      const changed = after.filter((figure, index) => figure.value !== before[index]?.value);
      expect(changed).toHaveLength(CHANGED_ROW_COUNT);
      expect(changed[0]).toMatchObject({ metric: "net_income", value: CHANGED_NET_INCOME });
      const untouched = after.filter((figure) => figure.metric !== "net_income");
      expect(untouched).toEqual(before.filter((figure) => figure.metric !== "net_income"));
    });

    it("matches a TradingView ex date in Unix seconds as a Cairo date", async () => {
      stubFetch({ actions: firstPageOnly(actionsPage([actionRow({ url: `/markets/EGX/stocks/${COMI_TICKER}`, effectiveFrom: "7 أبريل 2026" })])) });

      await createRunner().run();
      const cash = actionOf(await readActions(), COMI_TICKER, "cash_dividend");

      expect(cash?.ex_date).toBe(COMI_RECENT_EX_DATE);
      expect(cash?.amount).toBe(6);
    });
  });

  describe("source failures", () => {
    it("keeps the Mubasher actions and raises one job_failed for the fundamentals step when TradingView fails", async () => {
      stubFetch({ fundamentals: failingUpstream });

      await createRunner().run();
      const failures = await stepFailures(FUNDAMENTALS_STEP);

      expect(await readActions()).toHaveLength(ACTION_COUNT);
      expect(await readFigures()).toEqual([]);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: REFERENCE_JOB, step: FUNDAMENTALS_STEP, source: TRADINGVIEW });
      expect(await stepFailures(ACTIONS_STEP)).toEqual([]);
    });

    it("keeps the TradingView figures and raises one job_failed for the corporateActions step when Mubasher fails", async () => {
      stubFetch({ actions: failingUpstream });

      await createRunner().run();
      const failures = await stepFailures(ACTIONS_STEP);

      expect(await readActions()).toEqual([]);
      expect(await readFigures()).toHaveLength(FIGURE_COUNT);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.details).toMatchObject({ job: REFERENCE_JOB, step: ACTIONS_STEP, source: MUBASHER });
    });

    it("writes no actions, figures or events when both sources are empty", async () => {
      stubFetch({
        actions: firstPageOnly(actionsPage([])),
        fundamentals: fixtureResponse({ ...tradingViewFundamentals, totalCount: 0, data: [] }),
      });

      await createRunner().run();

      expect(await readActions()).toEqual([]);
      expect(await readFigures()).toEqual([]);
      expect(await readActionEvents()).toEqual([]);
      expect(await readNotices("needs_ratio")).toEqual([]);
    });

    it("keeps existing rows when the sources come back empty after a good run", async () => {
      const runner = createRunner();
      stubFetch();
      await runner.run();
      const actionsBefore = await readActions();
      const figuresBefore = await readFigures();
      stubFetch({
        actions: firstPageOnly(actionsPage([])),
        fundamentals: fixtureResponse({ ...tradingViewFundamentals, totalCount: 0, data: [] }),
      });

      await runner.run(RUN_TIME, NEXT_DAY);

      expect(await readActions()).toEqual(actionsBefore);
      expect(await readFigures()).toEqual(figuresBefore);
    });
  });

  describe("schedule", () => {
    it("runs once per Cairo date", async () => {
      const fetchStub = stubFetch();
      const runner = createRunner();

      await runner.run();
      const callsAfterFirstRun = fetchStub.mock.calls.length;
      await runner.run(LATER_RUN_TIME);

      expect(fetchStub.mock.calls).toHaveLength(callsAfterFirstRun);
    });

    it("still stores actions and figures on a holiday calendar row", async () => {
      await seedCalendar([{ date: RUN_DAY, kind: "holiday" }]);
      stubFetch();

      await createRunner().run();

      expect(await readActions()).toHaveLength(ACTION_COUNT);
      expect(await readFigures()).toHaveLength(FIGURE_COUNT);
    });
  });
});
