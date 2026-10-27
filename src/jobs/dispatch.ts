import { endOfDayJob } from "./end-of-day";
import { maintenanceJob } from "./maintenance";
import { referenceJob } from "./reference";
import { snapshotJob } from "./snapshot";

const SNAPSHOT_CRON = "* 6-12 * * SUN-THU";
const END_OF_DAY_CRON = "30 12,13 * * SUN-THU";
const REFERENCE_CRON = "0 16 * * *";
const MAINTENANCE_CRON = "0 1 * * SAT";
const MS_PER_SECOND = 1000;

type Job = (env: Env, now: number) => Promise<unknown>;

const JOBS_BY_CRON: Record<string, Job> = {
  [SNAPSHOT_CRON]: snapshotJob,
  [END_OF_DAY_CRON]: endOfDayJob,
  [REFERENCE_CRON]: referenceJob,
  [MAINTENANCE_CRON]: maintenanceJob,
};

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const job = JOBS_BY_CRON[controller.cron];
  if (job === undefined) {
    console.error("unknown cron", controller.cron);
    return;
  }
  const now = Math.floor(controller.scheduledTime / MS_PER_SECOND);
  ctx.waitUntil(job(env, now));
}
