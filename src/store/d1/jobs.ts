export type JobState = {
  job: string;
  lastRunDate: string | null;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  cursor: string | null;
};

type JobStateRow = {
  job: string;
  last_run_date: string | null;
  last_ok_at: number | null;
  last_error_at: number | null;
  cursor: string | null;
};

export async function getJobState(db: D1Database, job: string): Promise<JobState | null> {
  const row = await db
    .prepare("SELECT job, last_run_date, last_ok_at, last_error_at, cursor FROM job_state WHERE job = ?1")
    .bind(job)
    .first<JobStateRow>();
  if (!row) return null;
  return {
    job: row.job,
    lastRunDate: row.last_run_date,
    lastOkAt: row.last_ok_at,
    lastErrorAt: row.last_error_at,
    cursor: row.cursor,
  };
}

export async function markJobRun(db: D1Database, job: string, cairoDate: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO job_state (job, last_run_date) VALUES (?1, ?2) ON CONFLICT (job) DO UPDATE SET last_run_date = excluded.last_run_date",
    )
    .bind(job, cairoDate)
    .run();
}

export async function markJobOk(db: D1Database, job: string, at: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO job_state (job, last_ok_at) VALUES (?1, ?2) ON CONFLICT (job) DO UPDATE SET last_ok_at = excluded.last_ok_at",
    )
    .bind(job, at)
    .run();
}

export async function markJobError(db: D1Database, job: string, at: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO job_state (job, last_error_at) VALUES (?1, ?2) ON CONFLICT (job) DO UPDATE SET last_error_at = excluded.last_error_at",
    )
    .bind(job, at)
    .run();
}

export async function setCursor(db: D1Database, job: string, cursor: string | null): Promise<void> {
  await db
    .prepare("INSERT INTO job_state (job, cursor) VALUES (?1, ?2) ON CONFLICT (job) DO UPDATE SET cursor = excluded.cursor")
    .bind(job, cursor)
    .run();
}
