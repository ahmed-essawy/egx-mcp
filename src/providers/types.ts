import type { CorporateActionKind } from "../domain/adjust";

export type ProviderErrorKind = "network" | "http" | "parse" | "empty";

export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;

  constructor(provider: string, kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
  }
}

export interface ProviderQuote {
  ticker: string;
  isin: string | null;
  last: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number;
  value: number | null;
  tradeTime: number;
  tradeDate: string;
}

export interface StockQuoteProvider {
  id: string;
  fetchQuotes(): Promise<ProviderQuote[]>;
}

export interface ProviderIndex {
  code: string;
  value: number;
  changePct: number | null;
  tradeTime: number;
}

export interface IndexProvider {
  id: string;
  fetchIndices(codes: string[]): Promise<ProviderIndex[]>;
}

export interface FxProvider {
  id: string;
  fetchUsdEgp(): Promise<{ rate: number; tradeTime: number; kind: "market" }>;
}

export interface SpotPrice {
  value: number;
  tradeTime: number;
}

export interface GlobalMetalsProvider {
  id: string;
  fetchSpot(): Promise<{ XAUUSD: SpotPrice | null; XAGUSD: SpotPrice | null }>;
}

export interface EgyptMetalsProvider {
  id: string;
  fetchRetail(): Promise<{
    gold: Record<string, { buy: number; sell: number }>;
    silver: Record<string, { buy: number; sell: number }>;
  }>;
}

export interface ProviderListing {
  ticker: string;
  isin: string | null;
  nameAr: string | null;
  nameEn: string | null;
  sector: string | null;
  market: "main" | "nilex" | null;
  sharesOutstanding: number | null;
  freeFloatShares: number | null;
}

export interface ListingProvider {
  id: string;
  fetchListings(): Promise<ProviderListing[]>;
}

export interface ProviderFund {
  sourceId: string;
  nameAr: string;
  nameEn: string | null;
  manager: string | null;
  currency: string | null;
  category: string | null;
  nav: number;
  navDate: string;
}

export interface FundFetch {
  funds: ProviderFund[];
  failedPages: number[];
}

export interface FundNavProvider {
  id: string;
  fetchFunds(): Promise<FundFetch>;
}

export interface ProviderAction {
  ticker: string;
  kind: CorporateActionKind;
  announcedOn: string | null;
  exDate: string;
  sourceText: string;
}

export interface CorporateActionProvider {
  id: string;
  fetchActions(pages: number): Promise<ProviderAction[]>;
}

export interface ProviderFigure {
  metric: string;
  periodType: string;
  periodEnd: string | null;
  value: number;
  currency: string;
}

export interface ProviderFundamentals {
  ticker: string;
  isin: string | null;
  quoteCurrency: string;
  figures: ProviderFigure[];
  dividend: {
    recentAmount: number | null;
    recentExDate: string | null;
    upcomingExDate: string | null;
    currency: string;
  };
}

export interface FundamentalsProvider {
  id: string;
  fetchFundamentals(): Promise<ProviderFundamentals[]>;
}

export interface DailyClose {
  close: number;
  tradeDate: string;
}
