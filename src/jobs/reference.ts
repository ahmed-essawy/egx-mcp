import { normalizeArabic } from "../domain/arabic";
import { cairoParts, SECONDS_PER_DAY, utcDay } from "../domain/calendar";
import { isNavStale } from "../domain/freshness";
import { mubasherActions, mubasherFunds } from "../providers/mubasher";
import { tradingViewFundamentals, tradingViewFxMetals } from "../providers/tradingview";
import type { ProviderFund } from "../providers/types";
import { holidaysBetween } from "../store/d1/calendar";
import { purgeEvents, raiseNotices, type NewNotice } from "../store/d1/events";
import {
  insertNavs,
  listFundSummaries,
  markActive,
  markStale,
  recomputeCycles,
  upsertFunds,
  type FundSummary,
} from "../store/d1/funds";
import { getJobState, markJobRun } from "../store/d1/jobs";
import { purgeUsageDaily } from "../store/d1/usage";
import {
  getDirectory,
  getSnapshot,
  putDirectoryIfChanged,
  putSnapshotIfChanged,
  type Directory,
  type DirectoryFund,
} from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";
import { refreshMetalsFx } from "./metals-fx";
import { runCorporateActionsStep, runFundamentalsStep } from "./reference-fundamentals";

const JOB = "reference";
const FUNDS_STEP = "funds";
const METALS_FX_STEP = "metalsFx";
const ACTIONS_STEP = "corporateActions";
const FUNDAMENTALS_STEP = "fundamentals";
const PURGE_STEP = "purge";
const D1_SOURCE = "d1";
const EVENT_RETENTION_DAYS = 400;
const USAGE_RETENTION_DAYS = 90;
const EVENT_PURGE_LIMIT = 1200;
const USAGE_PURGE_LIMIT = 3000;

type ReferenceContext = { env: Env; now: number; today: string };
type ReferenceStep = { name: string; source: string; run: (context: ReferenceContext) => Promise<NewNotice[]> };

function toFundRow(fund: ProviderFund) {
  return {
    fundId: fund.sourceId,
    nameAr: fund.nameAr,
    nameEn: fund.nameEn,
    manager: fund.manager,
    currency: fund.currency,
    category: fund.category,
  };
}

function toNavRow(fund: ProviderFund, now: number) {
  return { fundId: fund.sourceId, navDate: fund.navDate, nav: fund.nav, source: mubasherFunds.id, fetchedAt: now };
}

function toDirectoryFund(fund: FundSummary): DirectoryFund {
  return [
    fund.fundId,
    fund.nameAr,
    fund.nameEn,
    fund.manager,
    fund.currency,
    normalizeArabic(fund.nameAr),
    normalizeArabic(fund.nameEn ?? ""),
  ];
}

function isStaleFund(fund: FundSummary, today: string, holidays: ReadonlySet<string>): boolean {
  return fund.latestNavDate !== null && fund.hasCycle && isNavStale(fund.latestNavDate, today, fund.cycleDays, holidays);
}

function staleNotice(fundId: string, now: number): NewNotice {
  return { kind: "fund_stale", subject: fundId, details: { fundId, time: now }, at: now };
}

async function storeNavs(env: Env, funds: ProviderFund[], now: number): Promise<string[]> {
  await upsertFunds(env.DB, funds.map(toFundRow), now);
  const newIds = await insertNavs(
    env.DB,
    funds.map((fund) => toNavRow(fund, now)),
  );
  await recomputeCycles(env.DB, newIds);
  return newIds;
}

async function updateStatuses(
  env: Env,
  summaries: FundSummary[],
  newIds: string[],
  context: ReferenceContext,
  holidays: ReadonlySet<string>,
): Promise<NewNotice[]> {
  const stale = summaries.filter((fund) => isStaleFund(fund, context.today, holidays)).map((fund) => fund.fundId);
  const staleIds = new Set(stale);
  await markActive(
    env.DB,
    newIds.filter((fundId) => !staleIds.has(fundId)),
    context.now,
  );
  const newlyStale = await markStale(env.DB, stale, context.now);
  return newlyStale.map((fundId) => staleNotice(fundId, context.now));
}

async function refreshDirectory(env: Env, summaries: FundSummary[], now: number): Promise<void> {
  const current = await getDirectory(env);
  if (current === null) return;
  const directory: Directory = {
    v: 1,
    builtAt: now,
    symbols: current.symbols,
    tickerToIsin: current.tickerToIsin,
    funds: summaries.map(toDirectoryFund),
  };
  await putDirectoryIfChanged(env, directory);
}

function oldestNavDate(summaries: FundSummary[]): string | null {
  return summaries.reduce<string | null>(
    (oldest, { latestNavDate }) => (latestNavDate !== null && (oldest === null || latestNavDate < oldest) ? latestNavDate : oldest),
    null,
  );
}

function failedPagesNotice(failedPages: number[], now: number): NewNotice[] {
  if (failedPages.length === 0) return [];
  const notice = jobFailedNotice(JOB, FUNDS_STEP, mubasherFunds.id, "some pages failed to load", now);
  return [{ ...notice, details: { ...notice.details, pages: failedPages } }];
}

async function runFundsStep(context: ReferenceContext): Promise<NewNotice[]> {
  const { env, now, today } = context;
  const { funds, failedPages } = await mubasherFunds.fetchFunds();
  const newIds = await storeNavs(env, funds, now);
  const summaries = await listFundSummaries(env.DB);
  const { value: holidays } = await holidaysBetween(env.DB, oldestNavDate(summaries) ?? today, today);
  const staleNotices = await updateStatuses(env, summaries, newIds, context, holidays);
  await refreshDirectory(env, summaries, now);
  return [...failedPagesNotice(failedPages, now), ...staleNotices];
}

async function runMetalsFxStep({ env, now }: ReferenceContext): Promise<NewNotice[]> {
  const snapshot = await getSnapshot(env);
  if (snapshot === null) return [];
  const { fx, metals, notices } = await refreshMetalsFx(JOB, snapshot, now, true);
  await putSnapshotIfChanged(env, { ...snapshot, fx, metals });
  return notices;
}

async function runPurgeStep({ env, now }: ReferenceContext): Promise<NewNotice[]> {
  await purgeEvents(env.DB, now - EVENT_RETENTION_DAYS * SECONDS_PER_DAY, EVENT_PURGE_LIMIT);
  await purgeUsageDaily(env.DB, utcDay(now - USAGE_RETENTION_DAYS * SECONDS_PER_DAY), USAGE_PURGE_LIMIT);
  return [];
}

const STEPS: ReferenceStep[] = [
  { name: METALS_FX_STEP, source: tradingViewFxMetals.id, run: runMetalsFxStep },
  { name: FUNDS_STEP, source: mubasherFunds.id, run: runFundsStep },
  { name: ACTIONS_STEP, source: mubasherActions.id, run: runCorporateActionsStep },
  { name: FUNDAMENTALS_STEP, source: tradingViewFundamentals.id, run: runFundamentalsStep },
  { name: PURGE_STEP, source: D1_SOURCE, run: runPurgeStep },
];

async function stepNotices(step: ReferenceStep, context: ReferenceContext): Promise<NewNotice[]> {
  try {
    return await step.run(context);
  } catch (error) {
    return [jobFailedNotice(JOB, step.name, step.source, errorMessage(error), context.now)];
  }
}

async function runStep(step: ReferenceStep, context: ReferenceContext): Promise<void> {
  await raiseNotices(context.env.DB, await stepNotices(step, context));
}

async function isDue(env: Env, today: string): Promise<boolean> {
  return (await getJobState(env.DB, JOB))?.lastRunDate !== today;
}

export async function referenceJob(env: Env, now: number): Promise<void> {
  const today = cairoParts(now).date;
  if (!(await isDue(env, today))) return;
  await markJobRun(env.DB, JOB, today);
  const context: ReferenceContext = { env, now, today };
  for (const step of STEPS) await runStep(step, context);
}
