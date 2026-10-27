import { z } from "zod";
import { toCairoIso } from "../domain/calendar";
import type { DirectorySymbol } from "../store/kv";

export const DIRECTORY_MISSING_MESSAGE = "The symbol directory is not built yet.";

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
