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

export function fail(
  code: ErrorCode,
  message: string,
  retryAt?: string,
  extra?: object,
): CallToolResult {
  return toResult({ error: { ...extra, code, message, retryAt: retryAt ?? null } }, true);
}
