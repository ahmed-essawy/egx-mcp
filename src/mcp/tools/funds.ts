import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { isNavStale } from "../../domain/freshness";
import { anchorDate, monthOf, percentChange, PERIODS, realReturnPct, type Period } from "../../domain/returns";
import { barCloseAt, indexCloseAt } from "../../store/d1/closes";
import { earliestNav, getFund, navAt, navHistoryPage, type FundProfile, type NavPoint } from "../../store/d1/funds";
import { holidaysBetween } from "../../store/d1/calendar";
import { cpiAt } from "../../store/d1/inflation";
import type { Directory } from "../../store/kv";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type Label, type Meta, type Provenance } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { closeProvenance, computedProvenance, STORED_BARS_SOURCE, STORED_INDEX_SOURCE } from "../provenance";
import { resolveFund, resolveSymbol } from "../resolve";
import { roundPercent, roundPrice } from "../rounding";
import { loadMarketClock, type MarketClock } from "../session";
import { counted, dateSchema, found, loadDirectory, RANGE_ORDER_MESSAGE, symbolInputSchema, unresolvedSymbol, type Found } from "../shared";

const FUND_SOURCE = "mubasher";
const EGX30_CODE = "EGX30";
const HISTORY_PAGE_SIZE = 500;
const MIN_FUNDS = 2;
const MAX_FUNDS = 5;
const REASON_SEPARATOR = "; ";
const SOURCE_SEPARATOR = ", ";
const EXACTLY_ONE_MESSAGE = "Provide exactly one of fund or symbol.";
const EGX30_GAP_REASON = "EGX30 history does not cover the period";

type NotAvailable = Meta["notAvailable"][number];

const periodSchema = z.enum(PERIODS);

const performanceSchema = z.union([
  z.object({ pct: z.number() }),
  z.object({ status: z.literal("not_available"), longestAvailable: periodSchema.nullable() }),
]);

const fundOutputSchema = envelopeSchema(
  z.object({
    fundId: z.string(),
    nameAr: z.string(),
    nameEn: z.string().nullable(),
    manager: z.string().nullable(),
    currency: z.string(),
    category: z.string().nullable(),
    nav: z.number(),
    navDate: z.string(),
    stale: z.boolean(),
    cycleDays: z.number(),
    performance: z.object({
      "1m": performanceSchema,
      "3m": performanceSchema,
      "1y": performanceSchema,
      ytd: performanceSchema,
    }),
  }),
);

const historyInputSchema = z
  .object({ fund: symbolInputSchema, from: dateSchema, to: dateSchema, cursor: dateSchema.optional() })
  .refine(({ from, to }) => from <= to, RANGE_ORDER_MESSAGE);

const historyOutputSchema = envelopeSchema(
  z.object({
    navs: z.array(z.object({ date: z.string(), nav: z.number() })),
    earliestAvailable: z.string().nullable(),
    nextCursor: z.string().nullable(),
  }),
);

const compareInputSchema = z.object({
  funds: z.array(symbolInputSchema).min(MIN_FUNDS).max(MAX_FUNDS),
  period: periodSchema,
  includeEgx30: z.boolean().default(true),
});

const compareOutputSchema = envelopeSchema(
  z.object({
    items: z.array(
      z.union([
        z.object({ fundId: z.string(), currency: z.string(), returnPct: z.number() }),
        z.object({
          fundId: z.string(),
          currency: z.string(),
          status: z.literal("not_available"),
          longestAvailable: periodSchema.nullable(),
        }),
      ]),
    ),
    egx30ReturnPct: z.number().nullable().optional(),
    currenciesDiffer: z.boolean(),
  }),
);

const realReturnInputSchema = z
  .object({
    fund: symbolInputSchema.optional(),
    symbol: symbolInputSchema.optional(),
    from: dateSchema,
    to: dateSchema,
  })
  .refine(({ fund, symbol }) => (fund === undefined) !== (symbol === undefined), EXACTLY_ONE_MESSAGE)
  .refine(({ from, to }) => from <= to, RANGE_ORDER_MESSAGE);

const realReturnOutputSchema = envelopeSchema(
  z.union([
    z.object({
      nominalPct: z.number(),
      inflationPct: z.number(),
      realPct: z.number(),
      inflationSource: z.string(),
      inflationMonths: z.tuple([z.string(), z.string()]),
    }),
    z.object({ status: z.literal("not_available"), reason: z.string() }),
  ]),
);

type Performance = z.infer<typeof performanceSchema>;
type FundNav = { profile: FundProfile; latest: NavPoint };
type Dated = { value: number; date: string };
type Basis = { label: Label; source: string; valueAt: (date: string) => Promise<Dated | null> };

function noNav(fundId: string): Found<never> {
  return { ok: false, result: fail("not_available", `No NAV is stored for ${fundId} yet.`) };
}

function unresolvedFund(input: string, code: "not_found" | "ambiguous", candidates: unknown[]): Found<never> {
  if (code === "ambiguous") {
    return { ok: false, result: fail(code, `"${input}" matches more than one fund.`, { extra: { candidates } }) };
  }
  return { ok: false, result: fail(code, `No fund matches "${input}".`, { extra: { suggestions: candidates } }) };
}

async function findFund(ctx: ToolContext, directory: Directory, input: string): Promise<Found<FundProfile>> {
  const resolution = resolveFund(directory, input);
  if (!resolution.ok) {
    const candidates = resolution.candidates.map(([fundId, nameAr, nameEn, manager]) => ({
      fundId,
      nameAr,
      nameEn,
      manager,
    }));
    return unresolvedFund(input, resolution.code, candidates);
  }
  const profile = await counted(ctx.rows, getFund(ctx.env.DB, resolution.entry[0]));
  return profile === null ? unresolvedFund(input, "not_found", []) : found(profile);
}

async function findFundNavs(
  ctx: ToolContext,
  directory: Directory,
  clock: MarketClock,
  inputs: string[],
): Promise<Found<FundNav[]>> {
  const lookups = await Promise.all(inputs.map((input) => findFund(ctx, directory, input)));
  const profiles: FundProfile[] = [];
  for (const lookup of lookups) {
    if (!lookup.ok) return lookup;
    profiles.push(lookup.value);
  }
  const latests = await Promise.all(
    profiles.map((profile) => counted(ctx.rows, navAt(ctx.env.DB, profile.fundId, clock.today))),
  );
  const funds: FundNav[] = [];
  for (const [index, profile] of profiles.entries()) {
    const latest = latests[index] ?? null;
    if (latest === null) return noNav(profile.fundId);
    funds.push({ profile, latest });
  }
  return found(funds);
}

function staleReasonOf({ profile, latest }: FundNav, clock: MarketClock): string | null {
  if (!profile.hasCycle) return null;
  if (!isNavStale(latest.navDate, clock.today, profile.cycleDays, clock.holidays)) return null;
  return `NAV of ${profile.fundId} dated ${latest.navDate} is older than its ${profile.cycleDays}-day publication cycle.`;
}

async function clockForNavs(ctx: ToolContext, clock: MarketClock, funds: FundNav[]): Promise<MarketClock> {
  if (funds.length === 0) return clock;
  const oldest = funds.reduce((min, { latest }) => (latest.navDate < min ? latest.navDate : min), clock.today);
  const holidays = await counted(ctx.rows, holidaysBetween(ctx.env.DB, oldest, clock.today));
  return { ...clock, holidays };
}

function currencyGapOf({ profile }: FundNav): NotAvailable[] {
  if (!profile.currencyInferred) return [];
  return [{ field: "currency", reason: `currency assumed ${profile.currency}` }];
}

function metaOf(
  label: Label,
  source: string,
  staleReasons: string[],
  notAvailable: NotAvailable[],
  provenanceFor: (stale: boolean) => Provenance[],
): Meta {
  const stale = staleReasons.length > 0;
  return {
    label,
    dataTime: null,
    source,
    stale,
    staleReason: stale ? staleReasons.join(" ") : null,
    session: null,
    notAvailable,
    provenance: provenanceFor(stale),
  };
}

function navMetaFor(
  funds: FundNav[],
  clock: MarketClock,
  notAvailable: NotAvailable[],
  provenanceFor: (stale: boolean) => Provenance[],
): Meta {
  const staleReasons = funds.flatMap((fund) => staleReasonOf(fund, clock) ?? []);
  return metaOf(
    "daily_nav",
    FUND_SOURCE,
    staleReasons,
    [...funds.flatMap(currencyGapOf), ...notAvailable],
    provenanceFor,
  );
}

function longestAvailablePeriod(end: string, available: Period[]): Period | null {
  return available.reduce<Period | null>(
    (longest, period) => (longest === null || anchorDate(period, end) < anchorDate(longest, end) ? period : longest),
    null,
  );
}

async function returnOver(ctx: ToolContext, { profile, latest }: FundNav, period: Period): Promise<number | null> {
  const start = await counted(ctx.rows, navAt(ctx.env.DB, profile.fundId, anchorDate(period, latest.navDate)));
  return start === null ? null : roundPercent(percentChange(start.nav, latest.nav));
}

async function returnsOver(ctx: ToolContext, fundNav: FundNav, periods: readonly Period[]) {
  return Promise.all(periods.map(async (period) => ({ period, pct: await returnOver(ctx, fundNav, period) })));
}

async function longestAvailableOf(ctx: ToolContext, fundNav: FundNav, periods: readonly Period[]): Promise<Period | null> {
  const returns = await returnsOver(ctx, fundNav, periods);
  return longestAvailablePeriod(
    fundNav.latest.navDate,
    returns.filter(({ pct }) => pct !== null).map(({ period }) => period),
  );
}

async function comparedPerformance(ctx: ToolContext, fundNav: FundNav, period: Period): Promise<Performance> {
  const pct = await returnOver(ctx, fundNav, period);
  if (pct !== null) return { pct };
  const others = PERIODS.filter((other) => other !== period);
  return { status: "not_available", longestAvailable: await longestAvailableOf(ctx, fundNav, others) };
}

async function performanceOf(ctx: ToolContext, fundNav: FundNav): Promise<Record<Period, Performance>> {
  const returns = await returnsOver(ctx, fundNav, PERIODS);
  const longestAvailable = longestAvailablePeriod(
    fundNav.latest.navDate,
    returns.filter(({ pct }) => pct !== null).map(({ period }) => period),
  );
  const entries = returns.map(({ period, pct }): [Period, Performance] => [
    period,
    pct === null ? { status: "not_available", longestAvailable } : { pct },
  ]);
  return Object.fromEntries(entries) as Record<Period, Performance>;
}

async function egx30Return(
  ctx: ToolContext,
  period: Period,
  end: string,
): Promise<{ pct: number; asOf: string } | null> {
  const [start, last] = await Promise.all([
    counted(ctx.rows, indexCloseAt(ctx.env.DB, EGX30_CODE, anchorDate(period, end))),
    counted(ctx.rows, indexCloseAt(ctx.env.DB, EGX30_CODE, end)),
  ]);
  if (start === null || last === null || start.sessionDate === last.sessionDate) return null;
  return { pct: roundPercent(percentChange(start.close, last.close)), asOf: last.sessionDate };
}

function newestDate(dates: string[]): string {
  return dates.reduce((newest, date) => (date > newest ? date : newest));
}

function fundBasis(ctx: ToolContext, profile: FundProfile): Basis {
  return {
    label: "daily_nav",
    source: FUND_SOURCE,
    valueAt: async (date) => {
      const point = await counted(ctx.rows, navAt(ctx.env.DB, profile.fundId, date));
      return point === null ? null : { value: point.nav, date: point.navDate };
    },
  };
}

function symbolBasis(ctx: ToolContext, directory: Directory, input: string): Found<Basis> {
  const resolution = resolveSymbol(directory, input);
  if (!resolution.ok) return { ok: false, result: unresolvedSymbol(input, resolution) };
  const isin = resolution.entry[0];
  return found({
    label: "end_of_day",
    source: STORED_BARS_SOURCE,
    valueAt: async (date) => {
      const bar = await counted(ctx.rows, barCloseAt(ctx.env.DB, isin, date));
      return bar === null ? null : { value: bar.close, date: bar.sessionDate };
    },
  });
}

async function basisFor(
  ctx: ToolContext,
  directory: Directory,
  { fund, symbol }: { fund: string | undefined; symbol: string | undefined },
): Promise<Found<Basis>> {
  if (fund !== undefined) {
    const profile = await findFund(ctx, directory, fund);
    return profile.ok ? found(fundBasis(ctx, profile.value)) : profile;
  }
  if (symbol !== undefined) return symbolBasis(ctx, directory, symbol);
  return { ok: false, result: fail("invalid_input", EXACTLY_ONE_MESSAGE) };
}

function missingPriceReasons(start: Dated | null, end: Dated | null, from: string, to: string): string[] {
  return [
    ...(start === null ? [`no data on or before ${from}`] : []),
    ...(end === null ? [`no data on or before ${to}`] : []),
  ];
}

function missingCpiReasons(from: string, to: string, startCpi: unknown, endCpi: unknown): string[] {
  return [
    ...(startCpi === null ? [`CPI figure missing for ${monthOf(from)}`] : []),
    ...(endCpi === null ? [`CPI figure missing for ${monthOf(to)}`] : []),
  ];
}

function registerGetFund(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_fund",
      description:
        "Get an Egyptian mutual fund by id or Arabic or English name: latest NAV with its date, and performance over 1 month, 3 months, 1 year and year to date.",
      inputSchema: z.object({ fund: symbolInputSchema }),
      outputSchema: fundOutputSchema,
      readOnly: true,
      handler: async ({ fund }, ctx) => {
        const [directory, clock] = await Promise.all([
          loadDirectory(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (!directory.ok) return directory.result;
        const lookup = await findFundNavs(ctx, directory.value, clock, [fund]);
        if (!lookup.ok) return lookup.result;
        const [fundNav] = lookup.value as [FundNav];
        const { profile, latest } = fundNav;
        const [performance, navClock] = await Promise.all([
          performanceOf(ctx, fundNav),
          clockForNavs(ctx, clock, [fundNav]),
        ]);
        return ok(
          {
            fundId: profile.fundId,
            nameAr: profile.nameAr,
            nameEn: profile.nameEn,
            manager: profile.manager,
            currency: profile.currency,
            category: profile.category,
            nav: roundPrice(latest.nav),
            navDate: latest.navDate,
            stale: staleReasonOf(fundNav, navClock) !== null,
            cycleDays: profile.cycleDays,
            performance,
          },
          navMetaFor([fundNav], navClock, [], (stale) => [
            ...closeProvenance(["nav", "navDate"], [{ date: latest.navDate, source: FUND_SOURCE }], stale),
            computedProvenance(["performance"], FUND_SOURCE, latest.navDate, "close", stale),
          ]),
        );
      },
    },
    env,
    auth,
  );
}

function registerGetFundHistory(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_fund_history",
      description:
        "Get the stored NAV history of an Egyptian mutual fund between two dates, 500 points per page, with the earliest date available.",
      inputSchema: historyInputSchema,
      outputSchema: historyOutputSchema,
      readOnly: true,
      handler: async ({ fund, from, to, cursor }, ctx) => {
        const [directory, clock] = await Promise.all([
          loadDirectory(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (!directory.ok) return directory.result;
        const lookup = await findFund(ctx, directory.value, fund);
        if (!lookup.ok) return lookup.result;
        const profile = lookup.value;
        const [page, earliest, latest] = await Promise.all([
          counted(
            ctx.rows,
            navHistoryPage(ctx.env.DB, profile.fundId, from, to, cursor ?? null, HISTORY_PAGE_SIZE + 1),
          ),
          counted(ctx.rows, earliestNav(ctx.env.DB, profile.fundId)),
          counted(ctx.rows, navAt(ctx.env.DB, profile.fundId, clock.today)),
        ]);
        const navs = page.slice(0, HISTORY_PAGE_SIZE);
        const nextCursor = page.length > HISTORY_PAGE_SIZE ? (navs.at(-1)?.navDate ?? null) : null;
        const funds = latest === null ? [] : [{ profile, latest }];
        const navClock = await clockForNavs(ctx, clock, funds);
        return ok(
          {
            navs: navs.map(({ navDate, nav }) => ({ date: navDate, nav: roundPrice(nav) })),
            earliestAvailable: earliest?.navDate ?? null,
            nextCursor,
          },
          navMetaFor(funds, navClock, [], (stale) =>
            closeProvenance(
              ["navs"],
              navs.map(({ navDate }) => ({ date: navDate, source: FUND_SOURCE })),
              stale,
            ),
          ),
        );
      },
    },
    env,
    auth,
  );
}

function registerCompareFunds(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "compare_funds",
      description:
        "Compare 2 to 5 Egyptian mutual funds over 1 month, 3 months, 1 year or year to date, each in its own currency, optionally against EGX30.",
      inputSchema: compareInputSchema,
      outputSchema: compareOutputSchema,
      readOnly: true,
      handler: async ({ funds, period, includeEgx30 }, ctx) => {
        const [directory, clock] = await Promise.all([
          loadDirectory(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (!directory.ok) return directory.result;
        const lookup = await findFundNavs(ctx, directory.value, clock, funds);
        if (!lookup.ok) return lookup.result;
        const compared = lookup.value;
        const [performances, navClock] = await Promise.all([
          Promise.all(compared.map((fundNav) => comparedPerformance(ctx, fundNav, period))),
          clockForNavs(ctx, clock, compared),
        ]);
        const items = compared.map(({ profile }, index) => {
          const performance = performances[index] as Performance;
          const identity = { fundId: profile.fundId, currency: profile.currency };
          return "pct" in performance ? { ...identity, returnPct: performance.pct } : { ...identity, ...performance };
        });
        const newestNavDate = newestDate(compared.map(({ latest }) => latest.navDate));
        const egx30 = includeEgx30 ? await egx30Return(ctx, period, newestNavDate) : undefined;
        const egx30Gap: NotAvailable[] =
          egx30 === null ? [{ field: "egx30ReturnPct", reason: EGX30_GAP_REASON }] : [];
        return ok(
          {
            items,
            egx30ReturnPct: egx30 === undefined ? undefined : (egx30?.pct ?? null),
            currenciesDiffer: new Set(compared.map(({ profile }) => profile.currency)).size > 1,
          },
          navMetaFor(compared, navClock, egx30Gap, (stale) => [
            computedProvenance(["items"], FUND_SOURCE, newestNavDate, "close", stale),
            ...(egx30
              ? [computedProvenance(["egx30ReturnPct"], STORED_INDEX_SOURCE, egx30.asOf, "close", false)]
              : []),
          ]),
        );
      },
    },
    env,
    auth,
  );
}

function registerGetRealReturn(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_real_return",
      description:
        "Get the nominal, inflation and real return of one Egyptian mutual fund or one stock between two dates, using stored CPI figures.",
      inputSchema: realReturnInputSchema,
      outputSchema: realReturnOutputSchema,
      readOnly: true,
      handler: async ({ fund, symbol, from, to }, ctx) => {
        const directory = await loadDirectory(ctx.env);
        if (!directory.ok) return directory.result;
        const basis = await basisFor(ctx, directory.value, { fund, symbol });
        if (!basis.ok) return basis.result;
        const { label, source, valueAt } = basis.value;
        const [start, end, startCpi, endCpi] = await Promise.all([
          valueAt(from),
          valueAt(to),
          counted(ctx.rows, cpiAt(ctx.env.DB, monthOf(from))),
          counted(ctx.rows, cpiAt(ctx.env.DB, monthOf(to))),
        ]);
        const cpiGaps = missingCpiReasons(from, to, startCpi, endCpi);
        if (start === null || end === null || startCpi === null || endCpi === null) {
          const reason = [...new Set([...missingPriceReasons(start, end, from, to), ...cpiGaps])].join(REASON_SEPARATOR);
          const notAvailable = cpiGaps.length > 0 ? [{ field: "inflationPct", reason }] : [];
          return ok({ status: "not_available", reason }, metaOf(label, source, [], notAvailable, () => []));
        }
        const nominal = percentChange(start.value, end.value);
        const inflation = percentChange(startCpi.cpiIndex, endCpi.cpiIndex);
        const inflationSource = [...new Set([startCpi.source, endCpi.source])].join(SOURCE_SEPARATOR);
        return ok(
          {
            nominalPct: roundPercent(nominal),
            inflationPct: roundPercent(inflation),
            realPct: roundPercent(realReturnPct(nominal, inflation)),
            inflationSource,
            inflationMonths: [monthOf(from), monthOf(to)],
          },
          metaOf(label, [source, inflationSource].join(SOURCE_SEPARATOR), [], [], () => [
            computedProvenance(["nominalPct", "realPct"], source, end.date, "close", false),
            computedProvenance(["inflationPct", "realPct"], inflationSource, monthOf(to), "period", false),
          ]),
        );
      },
    },
    env,
    auth,
  );
}

export function registerFundTools(server: McpServer, env: Env, auth: AuthProps): void {
  registerGetFund(server, env, auth);
  registerGetFundHistory(server, env, auth);
  registerCompareFunds(server, env, auth);
  registerGetRealReturn(server, env, auth);
}
