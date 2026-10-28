import type { QuoteEntry, Snapshot } from "../store/kv";

export type SessionQuote = { isin: string; quote: QuoteEntry };

export function sessionQuotes(snapshot: Snapshot | null, date: string): SessionQuote[] {
  if (snapshot?.session.date !== date) return [];
  return Object.entries(snapshot.quotes)
    .filter(([, quote]) => quote.td === date)
    .map(([isin, quote]) => ({ isin, quote }));
}
