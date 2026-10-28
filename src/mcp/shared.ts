import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toCairoIso } from "../domain/calendar";
import { isQuoteStale } from "../domain/freshness";
import type { RowsCounter } from "../limits/usage";
import type { ReadResult } from "../store/d1/users";
import { getDirectory, type Directory, type DirectorySymbol, type QuoteEntry } from "../store/kv";
import { fail } from "./envelope";
import { MAX_SYMBOL_INPUT_LENGTH, resolveSymbol, type Resolution } from "./resolve";
import type { MarketClock } from "./session";

export const DIRECTORY_MISSING_MESSAGE = "The symbol directory is not built yet.";
export const SNAPSHOT_FIELD = "snapshot";
export const SNAPSHOT_MISSING_REASON = "snapshot not built yet";
export const ADJUSTED_FIELD = "adjusted";
export const NEEDS_RATIO_REASON = "not yet adjusted: awaiting the owner's ratio";
export const QUEUED_REASON = "not yet adjusted: adjustment queued";
export const RANGE_ORDER_MESSAGE = "from must not be after to.";

export const symbolInputSchema = z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH);
export const dateSchema = z.iso.date();

export const identitySchema = z.object({
  isin: z.string(),
  ticker: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
});

export type Identity = z.infer<typeof identitySchema>;

export async function counted<T>(rows: RowsCounter, read: Promise<ReadResult<T>>): Promise<T> {
  const { value, rowsRead } = await read;
  rows.add({ rows_read: rowsRead });
  return value;
}

export function identityOf([isin, ticker, nameAr, nameEn]: DirectorySymbol): Identity {
  return { isin, ticker, nameEn, nameAr };
}

export function newestDataTime(timestamps: number[]): string | null {
  if (timestamps.length === 0) return null;
  return toCairoIso(Math.max(...timestamps));
}

export function staleReasonOf(quotes: QuoteEntry[], clock: MarketClock): string | null {
  const staleDates = quotes
    .filter((quote) => isQuoteStale(quote.td, clock.sessionDate, clock.holidays))
    .map((quote) => quote.td);
  if (staleDates.length === 0) return null;
  return `Data dated ${staleDates.sort()[0]} is older than the last completed session.`;
}

export function unresolvedSymbol(input: string, failure: Extract<Resolution<DirectorySymbol>, { ok: false }>) {
  const candidates = failure.candidates.map(identityOf);
  if (failure.code === "ambiguous") {
    return fail("ambiguous", `Symbol "${input}" matches several symbols.`, { extra: { input, candidates } });
  }
  return fail("not_found", `Symbol "${input}" was not found.`, { extra: { input, suggestions: candidates } });
}

export function resolveEach(
  directory: Directory,
  inputs: string[],
): { entries: DirectorySymbol[] } | { failure: CallToolResult } {
  const entries: DirectorySymbol[] = [];
  for (const input of inputs) {
    const resolution = resolveSymbol(directory, input);
    if (!resolution.ok) return { failure: unresolvedSymbol(input, resolution) };
    entries.push(resolution.entry);
  }
  return { entries };
}

export type Found<T> = { ok: true; value: T } | { ok: false; result: CallToolResult };

export function found<T>(value: T): Found<T> {
  return { ok: true, value };
}

export async function loadDirectory(env: Env): Promise<Found<Directory>> {
  const directory = await getDirectory(env);
  if (directory === null) return { ok: false, result: fail("not_available", DIRECTORY_MISSING_MESSAGE) };
  return found(directory);
}
