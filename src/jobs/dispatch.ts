import { raiseNotices } from "../store/d1/events";
import { endOfDayJob } from "./end-of-day";
import { errorMessage, jobFailedNotice } from "./errors";
import { maintenanceJob } from "./maintenance";
import { referenceJob } from "./reference";
import { snapshotJob } from "./snapshot";

const SNAPSHOT_CRON = "* 6-12 * * SUN-THU";
const END_OF_DAY_CRON = "30 12,13 * * SUN-THU";
const REFERENCE_CRON = "0 16 * * *";
const MAINTENANCE_CRON = "0 1 * * SAT";
const MS_PER_SECOND = 1000;
const UNHANDLED_STEP = "unhandled";

type Job = (env: Env, now: number) => Promise<unknown>;

interface ScheduledJob {
  name: string;
  run: Job;
}

const JOBS_BY_CRON: Record<string, ScheduledJob> = {
  [SNAPSHOT_CRON]: { name: "snapshot", run: snapshotJob },
  [END_OF_DAY_CRON]: { name: "end_of_day", run: endOfDayJob },
  [REFERENCE_CRON]: { name: "reference", run: referenceJob },
  [MAINTENANCE_CRON]: { name: "maintenance", run: maintenanceJob },
};

async function recordUnhandled(scheduledJob: ScheduledJob, env: Env, now: number, error: unknown): Promise<void> {
  try {
    await raiseNotices(env.DB, [jobFailedNotice(scheduledJob.name, UNHANDLED_STEP, "", errorMessage(error), now)]);
  } catch (noticeError) {
    console.error("unhandled job error not recorded", scheduledJob.name, errorMessage(noticeError));
  }
}

async function runIsolated(scheduledJob: ScheduledJob, env: Env, now: number): Promise<void> {
  try {
    await scheduledJob.run(env, now);
  } catch (error) {
    await recordUnhandled(scheduledJob, env, now, error);
  }
}

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const scheduledJob = JOBS_BY_CRON[controller.cron];
  if (scheduledJob === undefined) {
    console.error("unknown cron", controller.cron);
    return;
  }
  const now = Math.floor(controller.scheduledTime / MS_PER_SECOND);
  ctx.waitUntil(runIsolated(scheduledJob, env, now));
}
