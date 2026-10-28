import { loadConfig, type Config } from "../config";
import { ADJUST_BATCH_OVERHEAD_ROWS } from "../domain/budget";
import { cairoParts, isTradingDay, utcDay, type CairoParts } from "../domain/calendar";
import { sessionQuotes, type SessionQuote } from "../domain/session-quotes";
import { buildSymbolStats, statsWindowStart } from "../domain/stats";
import { mubasherDailyCloses } from "../providers/mubasher";
import { tradingViewDailyCloses } from "../providers/tradingview";
import type { DailyClose } from "../providers/types";
import {
  applyAdjustment,
  insertBars,
  insertIndexValues,
  pendingAll,
  readApplyCandidates,
  setLatestSession,
  statsAggregate,
  type NewBar,
  type PendingAction,
} from "../store/d1/bars";
import { getCalendarRow } from "../store/d1/calendar";
import { insertDiscrepancies, insertEvents, raiseNotices, type Discrepancy, type NewNotice } from "../store/d1/events";
import { getJobState, markJobOk, markJobRun } from "../store/d1/jobs";
import {
  getDirectory,
  getSnapshot,
  putLastSessionSnapshot,
  putStats,
  type Directory,
  type PendingAdjustment,
  type Snapshot,
  type SymbolStats,
} from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";
import { syncListings } from "./listing-sync";

const JOB = "end_of_day";
const RUN_FROM_TIME = "15:30";
const SKIPPED_NO_SESSION = "skipped: no session";
const BIG_MOVE_THRESHOLD_PCT = 5;
const DISCREPANCY_THRESHOLD_PCT = 2;
const PERCENT = 100;
const SNAPSHOT_SOURCE = "snapshot";
const STORE_SOURCE = "store";
const DAILY_CLOSES: Record<string, () => Promise<Map<string, DailyClose>>> = {
  tradingview: tradingViewDailyCloses,
  mubasher: mubasherDailyCloses,
};

type BackupProvider = { id: string; fetchCloses: () => Promise<Map<string, DailyClose>> };
type RunContext = {
  env: Env;
  now: number;
  date: string;
  config: Config;
  snapshot: Snapshot | null;
  directory: Directory | null;
  quotes: SessionQuote[];
};
type Step = { name: string; source: string; run: () => Promise<void> };

async function isDue(env: Env, today: CairoParts): Promise<boolean> {
  if (today.time < RUN_FROM_TIME) return false;
  if (!isTradingDay(today.date, await getCalendarRow(env.DB, today.date))) return false;
  return (await getJobState(env.DB, JOB))?.lastRunDate !== today.date;
}

function hasNoSession(snapshot: Snapshot | null, date: string): boolean {
  return snapshot?.session.date === date && snapshot.session.noTradesToday;
}

function toBar({ isin, quote }: SessionQuote, sessionDate: string): NewBar {
  const close = quote.p;
  const open = quote.o ?? close;
  const isFilled = quote.o === null || quote.h === null || quote.l === null;
  return {
    isin,
    sessionDate,
    open,
    high: Math.max(quote.h ?? close, open, close),
    low: Math.min(quote.l ?? close, open, close),
    close,
    volume: quote.v,
    value: quote.val,
    source: isFilled ? `${quote.src}+filled` : quote.src,
  };
}

function resolveBackup(config: Config, snapshot: Snapshot | null): BackupProvider | null {
  const served = snapshot?.sources.stocks;
  const id = config.stockProviders.find((provider) => provider !== served && DAILY_CLOSES[provider] !== undefined);
  const fetchCloses = id === undefined ? undefined : DAILY_CLOSES[id];
  return id === undefined || fetchCloses === undefined ? null : { id, fetchCloses };
}

function closesByIsin(closes: Map<string, DailyClose>, tickerToIsin: Record<string, string>): Map<string, DailyClose> {
  const keyed = new Map<string, DailyClose>();
  for (const [ticker, close] of closes) {
    const isin = tickerToIsin[ticker.toUpperCase()];
    if (isin !== undefined) keyed.set(isin, close);
  }
  return keyed;
}

function findDiscrepancies(
  { quotes, date, now }: RunContext,
  backup: BackupProvider,
  closes: Map<string, DailyClose>,
): Discrepancy[] {
  return quotes.flatMap(({ isin, quote }) => {
    const backupClose = closes.get(isin);
    if (backupClose === undefined || backupClose.tradeDate !== date) return [];
    const diffPct = (Math.abs(backupClose.close - quote.p) / quote.p) * PERCENT;
    if (!(diffPct > DISCREPANCY_THRESHOLD_PCT)) return [];
    return [
      {
        isin,
        sessionDate: date,
        primarySource: quote.src,
        backupSource: backup.id,
        primaryClose: quote.p,
        backupClose: backupClose.close,
        diffPct,
        createdAt: now,
      },
    ];
  });
}

async function writeBars({ env, quotes, date }: RunContext): Promise<void> {
  if (quotes.length === 0) throw new Error("no quotes for the session date");
  await insertBars(env.DB, quotes.map((entry) => toBar(entry, date)));
  await setLatestSession(env.DB, date);
}

async function writeIndexValues({ env, snapshot, quotes, date }: RunContext): Promise<void> {
  if (snapshot === null || quotes.length === 0) return;
  await insertIndexValues(
    env.DB,
    Object.entries(snapshot.indices)
      .filter(([, entry]) => cairoParts(entry.tt).date === date)
      .map(([indexCode, entry]) => ({
        indexCode,
        sessionDate: date,
        close: entry.v,
        changePct: entry.chp,
        source: entry.src,
      })),
  );
}

async function writeDiscrepancies(context: RunContext, backup: BackupProvider | null): Promise<void> {
  if (backup === null || context.directory === null || context.quotes.length === 0) return;
  const closes = closesByIsin(await backup.fetchCloses(), context.directory.tickerToIsin);
  await insertDiscrepancies(context.env.DB, findDiscrepancies(context, backup, closes));
}

async function writeBigMoves({ env, quotes, now }: RunContext): Promise<void> {
  const moves = quotes.filter(({ quote }) => Math.abs(quote.chp ?? 0) > BIG_MOVE_THRESHOLD_PCT);
  await insertEvents(
    env.DB,
    moves.map(({ isin, quote }) => ({
      kind: "big_move" as const,
      occurredAt: now,
      isin,
      fundId: null,
      payload: { ticker: quote.t, chp: quote.chp, close: quote.p },
    })),
  );
}

async function applyQueued({ env, now, config }: RunContext): Promise<void> {
  const day = utcDay(now);
  const candidates = await readApplyCandidates(env.DB, { limit: config.adjustMaxActionsPerRun }, day);
  let rowsApplied = 0;
  for (const candidate of candidates) {
    const result = await applyAdjustment(
      env.DB,
      { ...candidate, adjustRowsToday: candidate.adjustRowsToday + rowsApplied },
      config.adjustMaxRowsPerDay,
      day,
      now,
    );
    if (result.refusedReason === "daily_cap" || result.refusedReason === "concurrent_change") return;
    if (result.applied) rowsApplied += result.rows + ADJUST_BATCH_OVERHEAD_ROWS;
  }
}

function toPendingAdjustment(action: PendingAction): PendingAdjustment {
  return {
    actionId: action.actionId,
    kind: action.kind,
    exDate: action.exDate,
    state: action.status === "recorded" ? "queued" : "needs_ratio",
    adjAffected: action.adjAffected,
  };
}

function groupPending(actions: PendingAction[]): Map<string, PendingAdjustment[]> {
  const grouped = new Map<string, PendingAdjustment[]>();
  for (const action of actions) {
    grouped.set(action.isin, [...(grouped.get(action.isin) ?? []), toPendingAdjustment(action)]);
  }
  return grouped;
}

async function writeStats({ env, date }: RunContext): Promise<void> {
  const windowStart = statsWindowStart(date);
  const [series, pending] = await Promise.all([statsAggregate(env.DB, windowStart), pendingAll(env.DB, windowStart)]);
  const pendingByIsin = groupPending(pending);
  const symbols: Record<string, SymbolStats> = {};
  for (const { isin, bars } of series) {
    const stats = buildSymbolStats(bars, date, pendingByIsin.get(isin) ?? []);
    if (stats !== null) symbols[isin] = stats;
  }
  await putStats(env, { v: 1, asOf: date, symbols });
}

async function writeLastSession({ env, snapshot, date }: RunContext): Promise<void> {
  if (snapshot?.session.date !== date) return;
  await putLastSessionSnapshot(env, snapshot);
}

function buildSteps(context: RunContext): Step[] {
  const backup = resolveBackup(context.config, context.snapshot);
  return [
    { name: "bars", source: SNAPSHOT_SOURCE, run: () => writeBars(context) },
    { name: "indexValues", source: SNAPSHOT_SOURCE, run: () => writeIndexValues(context) },
    { name: "discrepancies", source: backup?.id ?? SNAPSHOT_SOURCE, run: () => writeDiscrepancies(context, backup) },
    { name: "bigMoves", source: SNAPSHOT_SOURCE, run: () => writeBigMoves(context) },
    { name: "applyQueued", source: STORE_SOURCE, run: () => applyQueued(context) },
    { name: "stats", source: STORE_SOURCE, run: () => writeStats(context) },
    { name: "lastSession", source: SNAPSHOT_SOURCE, run: () => writeLastSession(context) },
  ];
}

async function runSteps(context: RunContext): Promise<NewNotice[]> {
  const failures: NewNotice[] = [];
  for (const step of buildSteps(context)) {
    try {
      await step.run();
    } catch (error) {
      failures.push(jobFailedNotice(JOB, step.name, step.source, errorMessage(error), context.now));
    }
  }
  return failures;
}

export async function endOfDayJob(env: Env, now: number): Promise<string | undefined> {
  const today = cairoParts(now);
  if (!(await isDue(env, today))) return undefined;
  await markJobRun(env.DB, JOB, today.date);
  const snapshot = await getSnapshot(env);
  if (hasNoSession(snapshot, today.date)) return SKIPPED_NO_SESSION;
  const directory = (await syncListings(env, now, JOB)) ?? (await getDirectory(env));
  const context: RunContext = {
    env,
    now,
    date: today.date,
    config: loadConfig(env),
    snapshot,
    directory,
    quotes: sessionQuotes(snapshot, today.date),
  };
  await raiseNotices(env.DB, await runSteps(context));
  await markJobOk(env.DB, JOB, now);
  return undefined;
}
