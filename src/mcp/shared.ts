import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toCairoIso } from "../domain/calendar";
import { isQuoteStale } from "../domain/freshness";
import type { Directory, DirectorySymbol, QuoteEntry } from "../store/kv";
import { fail } from "./envelope";
import { resolveSymbol, type Resolution } from "./resolve";
import type { MarketClock } from "./session";

export const DIRECTORY_MISSING_MESSAGE = "The symbol directory is not built yet.";
export const SNAPSHOT_FIELD = "snapshot";
export const SNAPSHOT_MISSING_REASON = "snapshot not built yet";
export const ADJUSTED_FIELD = "adjusted";
export const NEEDS_RATIO_REASON = "not yet adjusted: awaiting the owner's ratio";
export const QUEUED_REASON = "not yet adjusted: adjustment queued";

export const identitySchema = z.object({
  isin: z.string(),
  ticker: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
});

export type Identity = z.infer<typeof identitySchema>;

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
