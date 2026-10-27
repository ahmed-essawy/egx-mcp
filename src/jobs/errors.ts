import type { NewNotice } from "../store/d1/events";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function jobFailedNotice(job: string, step: string, source: string, error: string, now: number): NewNotice {
  return {
    kind: "job_failed",
    subject: `${job}:${step}:${source}`,
    details: { job, step, source, time: now, error },
    at: now,
  };
}
