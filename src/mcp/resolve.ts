import { normalizeArabic } from "../domain/arabic";
import type { Directory, DirectoryFund, DirectorySymbol } from "../store/kv";

export const MAX_SYMBOL_INPUT_LENGTH = 80;
export const MAX_AMBIGUOUS_CANDIDATES = 10;
export const MAX_NOT_FOUND_SUGGESTIONS = 5;
const MIN_SHARED_PREFIX = 2;

export type Resolution<E> =
  | { ok: true; entry: E }
  | { ok: false; code: "not_found" | "ambiguous"; candidates: E[] };

export type SearchType = "stock" | "fund" | "any";

export type SearchHit =
  | { type: "stock"; entry: DirectorySymbol }
  | { type: "fund"; entry: DirectoryFund };

type Predicate<E> = (entry: E, query: string) => boolean;

type Rank = 0 | 1 | 2;

const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_SUBSTRING = 2;

function isinOf(entry: DirectorySymbol): string {
  return entry[0];
}

function tickerOf(entry: DirectorySymbol): string {
  return entry[1];
}

function symbolNames(entry: DirectorySymbol): string[] {
  return [entry[6], entry[7]];
}

function aliasesOf(entry: DirectorySymbol): string[] {
  return entry[8];
}

function fundIdOf(entry: DirectoryFund): string {
  return entry[0];
}

function fundNames(entry: DirectoryFund): string[] {
  return [entry[5], entry[6]];
}

function managerOf(entry: DirectoryFund): string {
  return normalizeArabic(entry[3] ?? "");
}

function symbolSearchKeys(entry: DirectorySymbol): string[] {
  return [
    normalizeArabic(isinOf(entry)),
    normalizeArabic(tickerOf(entry)),
    ...symbolNames(entry),
    ...aliasesOf(entry),
  ];
}

function fundSearchKeys(entry: DirectoryFund): string[] {
  return [normalizeArabic(fundIdOf(entry)), ...fundNames(entry), managerOf(entry)];
}

function symbolSuggestionKeys(entry: DirectorySymbol): string[] {
  return [normalizeArabic(tickerOf(entry)), ...symbolNames(entry)];
}

function fundSuggestionKeys(entry: DirectoryFund): string[] {
  return fundNames(entry);
}

function fieldRank(field: string, query: string): Rank | null {
  if (field === query) return RANK_EXACT;
  if (field.startsWith(query)) return RANK_PREFIX;
  if (field.includes(query)) return RANK_SUBSTRING;
  return null;
}

function bestRank(fields: string[], query: string): Rank | null {
  let best: Rank | null = null;
  for (const field of fields) {
    const rank = fieldRank(field, query);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function sharedPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function longestSharedPrefix(fields: string[], query: string): number {
  return Math.max(0, ...fields.map((field) => sharedPrefixLength(field, query)));
}

function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function suggest<E>(
  entries: E[],
  query: string,
  keysOf: (entry: E) => string[],
  sortKeyOf: (entry: E) => string,
): E[] {
  return entries
    .map((entry) => ({ entry, shared: longestSharedPrefix(keysOf(entry), query) }))
    .filter(({ shared }) => shared >= MIN_SHARED_PREFIX)
    .sort((a, b) => b.shared - a.shared || compareKeys(sortKeyOf(a.entry), sortKeyOf(b.entry)))
    .slice(0, MAX_NOT_FOUND_SUGGESTIONS)
    .map(({ entry }) => entry);
}

function resolveByTiers<E>(
  entries: E[],
  query: string,
  tiers: Predicate<E>[],
  suggestions: () => E[],
): Resolution<E> {
  if (query === "") return { ok: false, code: "not_found", candidates: [] };
  for (const tier of tiers) {
    const hits = entries.filter((entry) => tier(entry, query));
    if (hits.length === 1) return { ok: true, entry: hits[0] as E };
    if (hits.length > 1) {
      return { ok: false, code: "ambiguous", candidates: hits.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
    }
  }
  return { ok: false, code: "not_found", candidates: suggestions() };
}

export function resolveSymbol(dir: Directory, input: string): Resolution<DirectorySymbol> {
  const query = normalizeArabic(input);
  const aliasIsin = dir.tickerToIsin[input.trim().toUpperCase()];
  const tiers: Predicate<DirectorySymbol>[] = [
    (entry, q) => normalizeArabic(isinOf(entry)) === q,
    (entry, q) =>
      isinOf(entry) === aliasIsin ||
      normalizeArabic(tickerOf(entry)) === q ||
      aliasesOf(entry).includes(q),
    (entry, q) => symbolNames(entry).includes(q),
    (entry, q) => symbolNames(entry).some((name) => name.includes(q)),
  ];
  return resolveByTiers(dir.symbols, query, tiers, () =>
    suggest(dir.symbols, query, symbolSuggestionKeys, tickerOf),
  );
}

export function resolveFund(dir: Directory, input: string): Resolution<DirectoryFund> {
  const query = normalizeArabic(input);
  const tiers: Predicate<DirectoryFund>[] = [
    (entry, q) => normalizeArabic(fundIdOf(entry)) === q,
    (entry, q) => fundNames(entry).includes(q),
    (entry, q) => [...fundNames(entry), managerOf(entry)].some((field) => field.includes(q)),
  ];
  return resolveByTiers(dir.funds, query, tiers, () =>
    suggest(dir.funds, query, fundSuggestionKeys, fundIdOf),
  );
}

function rankedHits<E>(
  entries: E[],
  query: string,
  keysOf: (entry: E) => string[],
  sortKeyOf: (entry: E) => string,
  toHit: (entry: E) => SearchHit,
): { hit: SearchHit; rank: Rank; sortKey: string }[] {
  return entries.flatMap((entry) => {
    const rank = bestRank(keysOf(entry), query);
    return rank === null ? [] : [{ hit: toHit(entry), rank, sortKey: sortKeyOf(entry) }];
  });
}

export function searchDirectory(
  dir: Directory,
  query: string,
  type: SearchType,
  limit: number,
): SearchHit[] {
  const normalized = normalizeArabic(query);
  if (normalized === "") return [];
  const stocks =
    type === "fund"
      ? []
      : rankedHits(
          dir.symbols,
          normalized,
          symbolSearchKeys,
          tickerOf,
          (entry): SearchHit => ({ type: "stock", entry }),
        );
  const funds =
    type === "stock"
      ? []
      : rankedHits(
          dir.funds,
          normalized,
          fundSearchKeys,
          fundIdOf,
          (entry): SearchHit => ({ type: "fund", entry }),
        );
  return [...stocks, ...funds]
    .sort((a, b) => a.rank - b.rank || compareKeys(a.sortKey, b.sortKey))
    .slice(0, limit)
    .map(({ hit }) => hit);
}
