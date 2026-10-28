import { mubasherActions } from "../providers/mubasher";
import { tradingViewFundamentals } from "../providers/tradingview";
import type { ProviderAction, ProviderFundamentals } from "../providers/types";
import type { NewNotice } from "../store/d1/events";
import {
  setDividendAmounts,
  setQuoteCurrencies,
  upsertActions,
  upsertFigures,
  type ActionRow,
  type DividendAmountRow,
  type FigurePeriodType,
  type FigureRow,
} from "../store/d1/fundamentals";
import { aliasMap } from "../store/d1/symbols";

const ACTION_PAGES = 3;

export type FundamentalsContext = { env: Env; now: number; today: string };

type ResolvedAction = { action: ProviderAction; isin: string };

function resolveActions(actions: ProviderAction[], isinByTicker: Record<string, string>): ResolvedAction[] {
  return actions.flatMap((action) => {
    const isin = isinByTicker[action.ticker.toUpperCase()];
    return isin === undefined ? [] : [{ action, isin }];
  });
}

function toActionRow({ action, isin }: ResolvedAction, now: number): ActionRow {
  return {
    isin,
    ticker: action.ticker,
    kind: action.kind,
    announcedOn: action.announcedOn,
    exDate: action.exDate,
    amount: null,
    currency: null,
    source: mubasherActions.id,
    sourceText: action.sourceText,
    now,
  };
}

export async function runCorporateActionsStep({ env, now }: FundamentalsContext): Promise<NewNotice[]> {
  const actions = await mubasherActions.fetchActions(ACTION_PAGES);
  const resolved = resolveActions(actions, await aliasMap(env.DB));
  await upsertActions(
    env.DB,
    resolved.map((entry) => toActionRow(entry, now)),
  );
  return [];
}

function resolveIsin(row: ProviderFundamentals, isinByTicker: Record<string, string>): string | null {
  return row.isin ?? isinByTicker[row.ticker.toUpperCase()] ?? null;
}

function toFigureRows(row: ProviderFundamentals, isin: string, now: number): FigureRow[] {
  return row.figures.map((figure) => ({
    isin,
    metric: figure.metric,
    periodType: figure.periodType as FigurePeriodType,
    periodEnd: figure.periodEnd,
    periodInferred: figure.periodEnd === null,
    value: figure.value,
    currency: figure.currency,
    source: tradingViewFundamentals.id,
    fetchedAt: now,
  }));
}

function toDividendAmount(row: ProviderFundamentals, isin: string): DividendAmountRow[] {
  const { recentAmount, recentExDate, currency } = row.dividend;
  return recentAmount === null || recentExDate === null ? [] : [{ isin, exDate: recentExDate, amount: recentAmount, currency }];
}

export async function runFundamentalsStep(context: FundamentalsContext): Promise<NewNotice[]> {
  const { env } = context;
  const rows = await tradingViewFundamentals.fetchFundamentals();
  const isinByTicker = await aliasMap(env.DB);
  const known = new Set(Object.values(isinByTicker));
  const listed = rows.flatMap((row) => {
    const isin = resolveIsin(row, isinByTicker);
    return isin !== null && known.has(isin) ? [{ row, isin }] : [];
  });
  await upsertFigures(
    env.DB,
    listed.flatMap(({ row, isin }) => toFigureRows(row, isin, context.now)),
  );
  await setQuoteCurrencies(
    env.DB,
    listed.map(({ row, isin }) => ({ isin, currency: row.quoteCurrency })),
  );
  await setDividendAmounts(
    env.DB,
    listed.flatMap(({ row, isin }) => toDividendAmount(row, isin)),
  );
  return [];
}
