import type { AuthProps } from "../auth/api-keys";
import { loadConfig, type Config } from "../config";
import { nextUtcMidnight, utcDay } from "../domain/calendar";
import { readUsage, recordUsage, type UsageSnapshot } from "../store/d1/usage";
import { touchKey } from "../store/d1/users";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const TOUCH_KEY_WORST_CASE_ROWS = 1;
export const CAPACITY_MESSAGE = "The free service is at capacity until 00:00 UTC.";
const ACCOUNT_NOT_FOUND_MESSAGE = "Account not found.";

type RowsMeta = { rows_read?: number; rows_written?: number };

type Refusal = {
  ok: false;
  code: "capacity" | "rate_limited" | "unauthorized";
  message: string;
  retryAt: string;
};

export type LimitsOutcome = { ok: true; usage: UsageSnapshot } | Refusal;

export class RowsCounter {
  total = 0;
  written = 0;

  add(meta: RowsMeta): void {
    this.total += meta.rows_read ?? 0;
    this.written += meta.rows_written ?? 0;
  }
}

function toIso(unixSeconds: number): string {
  return new Date(unixSeconds * MS_PER_SECOND).toISOString();
}

export function capacityRetryAt(now: number): string {
  return toIso(nextUtcMidnight(now));
}

function refuse(code: Refusal["code"], message: string, retryAtSeconds: number): Refusal {
  return { ok: false, code, message, retryAt: toIso(retryAtSeconds) };
}

function isGlobalCapReached(usage: UsageSnapshot, cfg: Config): boolean {
  return usage.globalCalls >= cfg.globalDailyCalls || usage.globalRowsRead >= cfg.globalDailyRowsRead;
}

export function checkPersonalWrite(usage: { personalRows: number }, cfg: Config, worstCaseRows: number): boolean {
  return usage.personalRows + worstCaseRows <= cfg.personalDailyRows;
}

export async function checkLimits(
  env: Env,
  cfg: Config,
  auth: AuthProps,
  now: number,
  rows: RowsCounter,
): Promise<LimitsOutcome> {
  const usage = await readUsage(env.DB, auth.userId, utcDay(now));
  rows.add({ rows_read: usage.rowsRead });
  const nextMidnight = nextUtcMidnight(now);
  if (isGlobalCapReached(usage, cfg)) return refuse("capacity", CAPACITY_MESSAGE, nextMidnight);
  if (!usage.accountActive) return refuse("unauthorized", ACCOUNT_NOT_FOUND_MESSAGE, nextMidnight);
  if (cfg.unlimitedEmails.has(auth.email.toLowerCase())) return { ok: true, usage };
  const { success } = await env.RATE_LIMITER.limit({ key: auth.userId });
  if (!success) {
    const retryAt = now + SECONDS_PER_MINUTE;
    return refuse("rate_limited", `Rate limit reached. Retry at ${toIso(retryAt)}.`, retryAt);
  }
  if (usage.userCalls >= cfg.userDailyCalls) {
    return refuse("rate_limited", `Rate limit reached. Retry at ${toIso(nextMidnight)}.`, nextMidnight);
  }
  return { ok: true, usage };
}

async function touchKeyRows(
  env: Env,
  cfg: Config,
  auth: AuthProps,
  usage: UsageSnapshot,
  rows: RowsCounter,
  now: number,
): Promise<number> {
  if (auth.via !== "key" || !auth.keyId) return 0;
  const personalRows = usage.personalRows + rows.written;
  if (!checkPersonalWrite({ personalRows }, cfg, TOUCH_KEY_WORST_CASE_ROWS)) return 0;
  const { rowsWritten, rowsRead } = await touchKey(env.DB, auth.keyId, now);
  rows.add({ rows_read: rowsRead });
  return rowsWritten;
}

export async function finishCall(
  env: Env,
  auth: AuthProps,
  tool: string,
  rows: RowsCounter,
  now: number,
  usage: UsageSnapshot,
): Promise<void> {
  const cfg = loadConfig(env);
  const touchedRows = await touchKeyRows(env, cfg, auth, usage, rows, now);
  await recordUsage(env.DB, {
    userId: auth.userId,
    day: utcDay(now),
    tool,
    rowsRead: rows.total,
    personalRows: rows.written + touchedRows,
  });
}
