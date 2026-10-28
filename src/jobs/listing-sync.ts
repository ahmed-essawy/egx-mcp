import { normalizeArabic } from "../domain/arabic";
import { mubasherListings } from "../providers/mubasher";
import { tradingViewStocks } from "../providers/tradingview";
import type { ListingProvider, ProviderListing } from "../providers/types";
import { insertEvents, type NewNotice } from "../store/d1/events";
import {
  aliasMap,
  countSymbols,
  insertPendingListings,
  listDirectoryRows,
  upsertAliases,
  upsertListings,
  type AliasRow,
  type DirectoryRow,
  type ListingRow,
  type NewListing,
} from "../store/d1/symbols";
import { getDirectory, putDirectoryIfChanged, type Directory, type DirectorySymbol } from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";

export const LISTING_SYNC_STEP = "listingSync";
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

type Sources = [tradingView: ProviderListing[], mubasher: ProviderListing[]];

function collectFailures(
  job: string,
  providers: ListingProvider[],
  results: PromiseSettledResult<ProviderListing[]>[],
  now: number,
): NewNotice[] {
  return results.flatMap((result, index) =>
    result.status === "rejected" ? [jobFailedNotice(job, LISTING_SYNC_STEP, providers[index]?.id ?? "", errorMessage(result.reason), now)] : [],
  );
}

function mergeListings(tradingView: ProviderListing[], mubasher: ProviderListing[]): ListingRow[] {
  const mubasherByTicker = new Map(mubasher.map((listing) => [listing.ticker, listing]));
  return tradingView.flatMap((listing) => {
    if (listing.isin === null || !ISIN_PATTERN.test(listing.isin)) return [];
    const arabic = mubasherByTicker.get(listing.ticker);
    return [
      {
        isin: listing.isin,
        ticker: listing.ticker,
        nameAr: arabic?.nameAr ?? null,
        nameEn: listing.nameEn,
        sector: arabic?.sector ?? null,
        status: "active" as const,
        sharesOutstanding: listing.sharesOutstanding,
        freeFloatShares: listing.freeFloatShares,
      },
    ];
  });
}

function toAliasRows(rows: ListingRow[]): AliasRow[] {
  return rows.flatMap((row) => [
    { isin: row.isin, kind: "ticker" as const, value: row.ticker, provider: null },
    ...(row.nameAr === null ? [] : [{ isin: row.isin, kind: "name_ar" as const, value: row.nameAr, provider: null }]),
    ...(row.nameEn === null ? [] : [{ isin: row.isin, kind: "name_en" as const, value: row.nameEn, provider: null }]),
  ]);
}

function toDirectorySymbol(row: DirectoryRow): DirectorySymbol {
  return [
    row.isin,
    row.ticker,
    row.nameAr,
    row.nameEn,
    row.sector,
    row.status,
    normalizeArabic(row.nameAr ?? ""),
    normalizeArabic(row.nameEn ?? ""),
    [...new Set(row.aliases.map(normalizeArabic))],
  ];
}

function buildTickerToIsin(aliases: Record<string, string>, listings: ListingRow[]): Record<string, string> {
  const current = listings.map((row): [string, string] => [row.ticker.toUpperCase(), row.isin]);
  return { ...aliases, ...Object.fromEntries(current) };
}

async function writeDirectory(env: Env, listings: ListingRow[], now: number): Promise<Directory> {
  const [rows, aliases, current] = await Promise.all([
    listDirectoryRows(env.DB),
    aliasMap(env.DB),
    getDirectory(env),
  ]);
  const directory: Directory = {
    v: 1,
    builtAt: now,
    symbols: rows.map(toDirectorySymbol),
    tickerToIsin: buildTickerToIsin(aliases, listings),
    funds: current?.funds ?? [],
  };
  await putDirectoryIfChanged(env, directory);
  return directory;
}

export type ListingSync = { directory: Directory | null; notices: NewNotice[]; listedIsins: string[] | null };

function newListingNotice({ isin, ticker }: NewListing, now: number): NewNotice {
  return { kind: "new_listing", subject: isin, details: { isin, ticker, time: now }, at: now };
}

async function discoverListings(env: Env, rows: ListingRow[], now: number): Promise<NewNotice[]> {
  if ((await countSymbols(env.DB)) === 0) return [];
  const discovered = await insertPendingListings(env.DB, rows, now);
  await insertEvents(
    env.DB,
    discovered.map(({ isin, ticker }) => ({
      kind: "new_listing" as const,
      occurredAt: now,
      isin,
      fundId: null,
      payload: { ticker },
    })),
  );
  return discovered.map((listing) => newListingNotice(listing, now));
}

function collectListedIsins(rows: ListingRow[], mubasher: ProviderListing[], directory: Directory): string[] {
  const mapped = mubasher.flatMap((listing) => {
    const isin = directory.tickerToIsin[listing.ticker.toUpperCase()];
    return isin === undefined ? [] : [isin];
  });
  return [...new Set([...rows.map((row) => row.isin), ...mapped])];
}

export async function syncListings(env: Env, now: number, job: string): Promise<ListingSync> {
  const providers = [tradingViewStocks, mubasherListings];
  const results = await Promise.allSettled(providers.map((provider) => provider.fetchListings()));
  const failures = collectFailures(job, providers, results, now);
  if (failures.length > 0) return { directory: null, notices: failures, listedIsins: null };
  const [tradingView, mubasher] = results.map((result) =>
    result.status === "fulfilled" ? result.value : [],
  ) as Sources;
  const rows = mergeListings(tradingView, mubasher);
  if (rows.length === 0) return { directory: null, notices: [], listedIsins: null };
  const notices = await discoverListings(env, rows, now);
  await upsertListings(env.DB, rows, now);
  await upsertAliases(env.DB, toAliasRows(rows), now);
  const directory = await writeDirectory(env, rows, now);
  return { directory, notices, listedIsins: collectListedIsins(rows, mubasher, directory) };
}
