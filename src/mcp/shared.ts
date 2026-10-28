import { z } from "zod";
import { toCairoIso } from "../domain/calendar";
import { isQuoteStale } from "../domain/freshness";
import type { DirectorySymbol, QuoteEntry } from "../store/kv";
import type { MarketClock } from "./session";

export const DIRECTORY_MISSING_MESSAGE = "The symbol directory is not built yet.";
export const SNAPSHOT_FIELD = "snapshot";
export const SNAPSHOT_MISSING_REASON = "snapshot not built yet";

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
