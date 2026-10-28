import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { FIGURE_METRIC_NAMES } from "../../domain/figures";
import { dividendYield, pb, pe, type RatioResult } from "../../domain/ratios";
import { shiftDays } from "../../domain/returns";
import {
  dividendsLast365,
  listActions,
  listFigures,
  type ActionFilter,
  type CorporateAction,
  type Figure,
} from "../../store/d1/fundamentals";
import { getProfile } from "../../store/d1/symbols";
import { getSnapshot, type Directory, type QuoteEntry } from "../../store/kv";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type Label, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { resolveSymbol } from "../resolve";
import { roundPrice } from "../rounding";
import { loadMarketClock, type MarketClock } from "../session";
import {
  counted,
  dateSchema,
  found,
  loadDirectory,
  newestDataTime,
  RANGE_ORDER_MESSAGE,
  staleReasonOf,
  symbolInputSchema,
  unresolvedSymbol,
  type Found,
} from "../shared";

const LABEL: Label = "end_of_day";
const SOURCE_SEPARATOR = ", ";
const DIVIDEND_WINDOW_DAYS = 90;
const EARLIEST_DATE = "0000-01-01";
const LATEST_DATE = "9999-12-31";
const CASH_DIVIDEND_KIND = "cash_dividend";
const NOT_AVAILABLE_REASON = "not available from current sources";
const EPS_METRIC = "eps_basic";
const EQUITY_METRIC = "total_equity";
const UNKNOWN_PERIOD_END_REASON = "the source gives no period end for some figures";

const profileOutputSchema = envelopeSchema(
  z.object({
    isin: z.string(),
    ticker: z.string(),
    nameAr: z.string().nullable(),
    nameEn: z.string().nullable(),
    sector: z.string().nullable(),
    market: z.enum(["main", "nilex"]),
    sharesOutstanding: z.number().nullable(),
    freeFloatShares: z.number().nullable(),
    firstTradeDate: z.string().nullable(),
    indexCodes: z.array(z.string()),
    status: z.enum(["pending", "active", "inactive"]),
  }),
);

const dividendsInputSchema = z.object({
  symbol: symbolInputSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const actionsInputSchema = z.object({ symbol: symbolInputSchema, from: dateSchema.optional() });

const actionsOutputSchema = envelopeSchema(
  z.object({
    items: z.array(
      z.object({
        isin: z.string(),
        ticker: z.string(),
        kind: z.string(),
        exDate: z.string(),
        announcedOn: z.string().nullable(),
        amount: z.number().nullable(),
        currency: z.string().nullable(),
        ratio: z.number().nullable(),
        status: z.enum(["needs_ratio", "recorded", "applied", "adjusting"]),
        source: z.string(),
      }),
    ),
  }),
);

const ratioSchema = z.union([
  z.object({ value: z.number(), inputs: z.record(z.string(), z.number()) }),
  z.object({ status: z.literal("not_computable"), reason: z.string() }),
]);

const financialsOutputSchema = envelopeSchema(
  z.object({
    figures: z.array(
      z.object({
        metric: z.string(),
        periodType: z.enum(["FY", "FQ", "TTM"]),
        periodEnd: z.string().nullable(),
        value: z.number(),
        currency: z.string(),
        source: z.string(),
      }),
    ),
    missing: z.array(z.string()),
    ratios: z.object({ pe: ratioSchema, pb: ratioSchema, dividendYield: ratioSchema }),
  }),
);

type NotAvailable = Meta["notAvailable"][number];
type ActionItem = z.infer<typeof actionsOutputSchema>["data"]["items"][number];
type Ratio = z.infer<typeof ratioSchema>;

const PROFILE_GAPS: NotAvailable[] = ["listingDate", "indexMembership"].map((field) => ({
  field,
  reason: NOT_AVAILABLE_REASON,
}));

function metaOf(sources: string[], notAvailable: NotAvailable[] = []): Meta {
  const distinct = [...new Set(sources)];
  return {
    label: LABEL,
    dataTime: null,
    source: distinct.length === 0 ? null : distinct.join(SOURCE_SEPARATOR),
    stale: false,
    staleReason: null,
    session: null,
    notAvailable,
  };
}

function profileMissing(input: string) {
  return unresolvedSymbol(input, { ok: false, code: "not_found", candidates: [] });
}

function findIsin(directory: Directory, input: string): Found<string> {
  const resolution = resolveSymbol(directory, input);
  if (resolution.ok) return found(resolution.entry[0]);
  return { ok: false, result: unresolvedSymbol(input, resolution) };
}

function tickerLookup(directory: Directory): ReadonlyMap<string, string> {
  return new Map(directory.symbols.map(([isin, ticker]) => [isin, ticker]));
}

function actionItem(action: CorporateAction, tickers: ReadonlyMap<string, string>): ActionItem {
  return {
    isin: action.isin,
    ticker: tickers.get(action.isin) ?? action.isin,
    kind: action.kind,
    exDate: action.exDate,
    announcedOn: action.announcedOn,
    amount: action.amount,
    currency: action.currency,
    ratio: action.ratio,
    status: action.status,
    source: action.source,
  };
}

async function actionsResult(ctx: ToolContext, directory: Directory, filter: ActionFilter) {
  const actions = await counted(ctx.rows, listActions(ctx.env.DB, filter));
  const tickers = tickerLookup(directory);
  return ok({ items: actions.map((action) => actionItem(action, tickers)) }, metaOf(actions.map(({ source }) => source)));
}

function newerFetch(a: Figure, b: Figure): Figure {
  return (a.fetchedAt ?? 0) > (b.fetchedAt ?? 0) ? a : b;
}

function latestFigure(figures: Figure[], metric: string): Figure | null {
  const ofMetric = figures.filter((figure) => figure.metric === metric);
  const dated = ofMetric
    .filter((figure) => figure.periodEnd !== null)
    .reduce<Figure | null>(
      (newest, figure) => (newest === null || (figure.periodEnd ?? "") > (newest.periodEnd ?? "") ? figure : newest),
      null,
    );
  const undated = ofMetric.filter((figure) => figure.periodEnd === null).reduce<Figure | null>(
    (newest, figure) => (newest === null ? figure : newerFetch(figure, newest)),
    null,
  );
  if (dated === null) return undated;
  return undated === null ? dated : newerFetch(undated, dated);
}

function financialsMeta(figures: Figure[], quotes: QuoteEntry[], clock: MarketClock): Meta {
  const staleReason = staleReasonOf(quotes, clock);
  return {
    ...metaOf(
      figures.map(({ source }) => source),
      financialsGaps(figures),
    ),
    dataTime: newestDataTime(quotes.map(({ tt }) => tt)),
    stale: staleReason !== null,
    staleReason,
  };
}

function financialsGaps(figures: Figure[]): NotAvailable[] {
  return figures.some(({ periodEnd }) => periodEnd === null)
    ? [{ field: "periodEnd", reason: UNKNOWN_PERIOD_END_REASON }]
    : [];
}

function roundRatio(result: RatioResult): Ratio {
  return "value" in result ? { ...result, value: roundPrice(result.value) } : result;
}

function dividendRange(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
  if (from !== undefined) return { from, to: to ?? shiftDays(from, DIVIDEND_WINDOW_DAYS) };
  if (to !== undefined) return { from: shiftDays(to, -DIVIDEND_WINDOW_DAYS), to };
  return { from: today, to: shiftDays(today, DIVIDEND_WINDOW_DAYS) };
}

function registerGetCompanyProfile(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_company_profile",
      description:
        "Get the profile of an Egyptian listed company by ticker, ISIN, or Arabic or English name: sector, market, shares outstanding, free float and first trade date.",
      inputSchema: z.object({ symbol: symbolInputSchema }),
      outputSchema: profileOutputSchema,
      readOnly: true,
      handler: async ({ symbol }, ctx) => {
        const directory = await loadDirectory(ctx.env);
        if (!directory.ok) return directory.result;
        const isin = findIsin(directory.value, symbol);
        if (!isin.ok) return isin.result;
        const profile = await counted(ctx.rows, getProfile(ctx.env.DB, isin.value));
        if (profile === null) return profileMissing(symbol);
        return ok(
          {
            isin: profile.isin,
            ticker: profile.ticker,
            nameAr: profile.nameAr,
            nameEn: profile.nameEn,
            sector: profile.sector,
            market: profile.market,
            sharesOutstanding: profile.sharesOutstanding,
            freeFloatShares: profile.freeFloatShares,
            firstTradeDate: profile.firstTradeDate,
            indexCodes: profile.indexCodes,
            status: profile.status,
          },
          metaOf([], PROFILE_GAPS),
        );
      },
    },
    env,
    auth,
  );
}

function registerGetDividends(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_dividends",
      description:
        "Get cash dividends by ex-dividend date for one Egyptian stock, or for every company when no symbol is given. The default range is today through the next 90 days.",
      inputSchema: dividendsInputSchema,
      outputSchema: actionsOutputSchema,
      readOnly: true,
      handler: async ({ symbol, from, to }, ctx) => {
        const [directory, clock] = await Promise.all([
          loadDirectory(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
        ]);
        if (!directory.ok) return directory.result;
        const range = dividendRange(from, to, clock.today);
        if (range.from > range.to) return fail("invalid_input", RANGE_ORDER_MESSAGE);
        const isin = symbol === undefined ? found(undefined) : findIsin(directory.value, symbol);
        if (!isin.ok) return isin.result;
        return actionsResult(ctx, directory.value, { ...range, isin: isin.value, kinds: [CASH_DIVIDEND_KIND] });
      },
    },
    env,
    auth,
  );
}

function registerGetCorporateActions(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_corporate_actions",
      description:
        "Get every corporate action of one Egyptian stock (dividends, bonus shares, splits, rights and others) with its ex-date, optionally from a given date.",
      inputSchema: actionsInputSchema,
      outputSchema: actionsOutputSchema,
      readOnly: true,
      handler: async ({ symbol, from }, ctx) => {
        const directory = await loadDirectory(ctx.env);
        if (!directory.ok) return directory.result;
        const isin = findIsin(directory.value, symbol);
        if (!isin.ok) return isin.result;
        return actionsResult(ctx, directory.value, {
          isin: isin.value,
          from: from ?? EARLIEST_DATE,
          to: LATEST_DATE,
        });
      },
    },
    env,
    auth,
  );
}

function registerGetFinancials(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_financials",
      description:
        "Get the stored financial figures of one Egyptian stock with P/E, P/B and dividend yield computed from the current price, each showing its inputs or why it cannot be computed.",
      inputSchema: z.object({ symbol: symbolInputSchema }),
      outputSchema: financialsOutputSchema,
      readOnly: true,
      handler: async ({ symbol }, ctx) => {
        const [directory, clock, snapshot] = await Promise.all([
          loadDirectory(ctx.env),
          loadMarketClock(ctx.env.DB, ctx.now, ctx.rows),
          getSnapshot(ctx.env),
        ]);
        if (!directory.ok) return directory.result;
        const isin = findIsin(directory.value, symbol);
        if (!isin.ok) return isin.result;
        const profile = await counted(ctx.rows, getProfile(ctx.env.DB, isin.value));
        if (profile === null) return profileMissing(symbol);
        const [figures, dividends] = await Promise.all([
          counted(ctx.rows, listFigures(ctx.env.DB, isin.value)),
          counted(ctx.rows, dividendsLast365(ctx.env.DB, isin.value, clock.today, profile.quoteCurrency)),
        ]);
        const quote = snapshot?.quotes[isin.value] ?? null;
        const priced = { price: quote?.p ?? null, currency: profile.quoteCurrency };
        const present = new Set(figures.map(({ metric }) => metric));
        const eps = latestFigure(figures, EPS_METRIC);
        const equity = latestFigure(figures, EQUITY_METRIC);
        return ok(
          {
            figures: figures.map(({ metric, periodType, periodEnd, value, currency, source }) => ({
              metric,
              periodType,
              periodEnd,
              value,
              currency,
              source,
            })),
            missing: FIGURE_METRIC_NAMES.filter((metric) => !present.has(metric)),
            ratios: {
              pe: roundRatio(pe(priced, eps?.value ?? null, eps?.currency ?? null)),
              pb: roundRatio(pb(priced, equity?.value ?? null, profile.sharesOutstanding, equity?.currency ?? null)),
              dividendYield: roundRatio(dividendYield(priced.price, dividends.total, dividends.unpriced)),
            },
          },
          financialsMeta(figures, quote === null ? [] : [quote], clock),
        );
      },
    },
    env,
    auth,
  );
}

export function registerFundamentalTools(server: McpServer, env: Env, auth: AuthProps): void {
  registerGetCompanyProfile(server, env, auth);
  registerGetDividends(server, env, auth);
  registerGetCorporateActions(server, env, auth);
  registerGetFinancials(server, env, auth);
}
