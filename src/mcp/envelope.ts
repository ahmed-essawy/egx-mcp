import type { CallToolResult } from "@modelcontextprotocol/server";

export { toCairoIso } from "../domain/calendar";

export type Label = "delayed" | "end_of_day" | "daily_nav" | "owner_entered" | "personal";

export type ErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "capacity"
  | "not_found"
  | "ambiguous"
  | "invalid_input"
  | "not_available"
  | "forbidden";

export interface Meta {
  label: Label;
  dataTime: string | null;
  source: string | null;
  stale: boolean;
  staleReason: string | null;
  session: { date: string; status: string } | null;
  notAvailable: { field: string; reason: string }[];
}

export const NOTICE = "Delayed, unofficial data for information only. Not investment advice.";

function toResult(payload: Record<string, unknown>, isError: boolean): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
  if (isError) result.isError = true;
  return result;
}

export function ok<T>(data: T, meta: Meta): CallToolResult {
  return toResult({ data, meta, notice: NOTICE }, false);
}

export type FailOptions = { retryAt?: string; extra?: object; source?: string | null };

function errorMeta(source: string | null): Meta {
  return {
    label: "delayed",
    dataTime: null,
    source,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: [],
  };
}

export function fail(code: ErrorCode, message: string, { retryAt, extra, source = null }: FailOptions = {}): CallToolResult {
  const error = { ...extra, code, message, retryAt: retryAt ?? null };
  return toResult({ error, meta: errorMeta(source), notice: NOTICE }, true);
}
