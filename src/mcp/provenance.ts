import type { Config } from "../config";
import { isQuoteStale } from "../domain/freshness";
import type { IndexEntry, QuoteEntry } from "../store/kv";
import { type Basis, type Provenance, type TimeKind, toCairoIso } from "./envelope";
import type { MarketClock } from "./session";

export const STORED_BARS_SOURCE = "stored daily bars";
export const STORED_INDEX_SOURCE = "stored index closes";
export const SYMBOL_MASTER_SOURCE = "symbol master";
export const MARKET_EVENTS_SOURCE = "market events";
export const DIRECTORY_SOURCE = "directory";

const FILLED_SUFFIX = "+filled";

export function stockBasis(source: string, primarySource: string): Basis {
  return source === primarySource ? "primary" : "backup";
}

export function groupBySource<T>(items: readonly T[], sourceOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const source = sourceOf(item);
    const group = groups.get(source);
    if (group) group.push(item);
    else groups.set(source, [item]);
  }
  return groups;
}

function newest<T>(items: readonly T[], valueOf: (item: T) => number): number {
  return Math.max(...items.map(valueOf));
}

export function quoteProvenance(
  fields: string[],
  quotes: readonly QuoteEntry[],
  primarySource: string,
  clock: MarketClock,
): Provenance[] {
  return [...groupBySource(quotes, (quote) => quote.src)].map(([source, group]) => ({
    fields,
    source,
    dataTime: toCairoIso(newest(group, (quote) => quote.tt)),
    timeKind: "trade",
    stale: group.some((quote) => isQuoteStale(quote.td, clock.sessionDate, clock.holidays)),
    basis: stockBasis(source, primarySource),
  }));
}

export function indexProvenance(fields: string[], entries: readonly IndexEntry[]): Provenance[] {
  return [...groupBySource(entries, (entry) => entry.src)].map(([source, group]) => ({
    fields,
    source,
    dataTime: toCairoIso(newest(group, (entry) => entry.tt)),
    timeKind: "trade",
    stale: false,
    basis: "primary",
  }));
}

export function closeProvenance(
  fields: string[],
  rows: readonly { date: string; source: string }[],
  stale: boolean,
): Provenance[] {
  return [...groupBySource(rows, (row) => row.source)].map(([source, group]) => ({
    fields,
    source,
    dataTime: group.reduce((latest, row) => (row.date > latest ? row.date : latest), ""),
    timeKind: "close",
    stale,
    basis: source.endsWith(FILLED_SUFFIX) ? "computed" : "primary",
  }));
}

export function computedProvenance(
  fields: string[],
  source: string,
  dataTime: string | null,
  timeKind: TimeKind,
  stale: boolean,
): Provenance {
  return { fields, source, dataTime, timeKind, stale, basis: "computed" };
}

export function primaryStockSource(cfg: Config): string {
  return cfg.stockProviders[0] ?? "";
}
