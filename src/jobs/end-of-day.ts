import { cairoParts, isTradingDay, type CairoParts } from "../domain/calendar";
import { getCalendarRow } from "../store/d1/calendar";
import { getJobState, markJobRun } from "../store/d1/jobs";
import { getSnapshot } from "../store/kv";
import { syncListings } from "./listing-sync";

const JOB = "end_of_day";
const RUN_FROM_TIME = "15:30";
const SKIPPED_NO_SESSION = "skipped: no session";

async function isDue(env: Env, today: CairoParts): Promise<boolean> {
  if (today.time < RUN_FROM_TIME) return false;
  if (!isTradingDay(today.date, await getCalendarRow(env.DB, today.date))) return false;
  return (await getJobState(env.DB, JOB))?.lastRunDate !== today.date;
}

async function hasNoSession(env: Env, date: string): Promise<boolean> {
  const snapshot = await getSnapshot(env);
  return snapshot?.session.date === date && snapshot.session.noTradesToday;
}

export async function endOfDayJob(env: Env, now: number): Promise<string | undefined> {
  const today = cairoParts(now);
  if (!(await isDue(env, today))) return undefined;
  await markJobRun(env.DB, JOB, today.date);
  if (await hasNoSession(env, today.date)) return SKIPPED_NO_SESSION;
  await syncListings(env, now, JOB);
  return undefined;
}
