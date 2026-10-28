export const D1_DAILY_ROWS_WRITTEN = 100000;
export const JOBS_D1_ROWS_RESERVE = 16000;
export const D1_WRITE_HEADROOM = 3000;
export const ACCOUNTING_ROWS_PER_CALL = 2;
export const ADJUST_BATCH_OVERHEAD_ROWS = 8;

export interface BackfillAllowanceInput {
  configured: number;
  globalDailyCalls: number;
  rowsPerCall: number;
  callsToday: number;
  adjustCap: number;
  adjustRowsToday: number;
  personalCap: number;
  personalRowsToday: number;
  backfillRowsToday: number;
}

export function backfillAllowance(input: BackfillAllowanceInput): number {
  const reservedForCalls = input.rowsPerCall * Math.max(input.callsToday, input.globalDailyCalls);
  const reservedForAdjust = Math.max(input.adjustRowsToday, input.adjustCap);
  const reservedForPersonal = Math.max(input.personalRowsToday, input.personalCap);
  const headroom =
    D1_DAILY_ROWS_WRITTEN -
    reservedForCalls -
    reservedForAdjust -
    reservedForPersonal -
    JOBS_D1_ROWS_RESERVE -
    D1_WRITE_HEADROOM -
    input.backfillRowsToday;
  return Math.max(0, Math.min(input.configured - input.backfillRowsToday, headroom));
}
