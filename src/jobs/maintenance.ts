import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { oauthOptions } from "../auth/oauth-options";
import { loadConfig, parseOrigin } from "../config";
import { cairoParts } from "../domain/calendar";
import { raiseNotices } from "../store/d1/events";
import { markJobRun } from "../store/d1/jobs";
import { getPurgeCursor, putPurgeCursor } from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";

const JOB = "maintenance";
const PURGE_STEP = "purge";
const PURGE_SOURCE = "oauth";
const PURGE_BATCH_SIZE = 250;

async function purgeOAuthData(env: Env, origin: string): Promise<void> {
  const cursor = await getPurgeCursor(env);
  const result = await getOAuthApi(oauthOptions(origin), env).purgeExpiredData({
    batchSize: PURGE_BATCH_SIZE,
    cursor: cursor ?? undefined,
  });
  await putPurgeCursor(env, result.done ? null : (result.cursor ?? null));
}

export async function maintenanceJob(env: Env, now: number): Promise<void> {
  await markJobRun(env.DB, JOB, cairoParts(now).date);
  const origin = parseOrigin(loadConfig(env).publicOrigin);
  if (origin === null) {
    console.warn("maintenance purge skipped: PUBLIC_ORIGIN is not set");
    return;
  }
  try {
    await purgeOAuthData(env, origin);
  } catch (error) {
    await raiseNotices(env.DB, [jobFailedNotice(JOB, PURGE_STEP, PURGE_SOURCE, errorMessage(error), now)]);
  }
}
