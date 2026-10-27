import type { DirectorySymbol, IndexEntry, QuoteEntry, Snapshot } from "../../src/store/kv";
import { defaultSnapshot, stockSymbol, syntheticIsin, syntheticTicker } from "./seed";
import { MS_PER_SECOND } from "./time";

export const INDEX_SOURCE = "tradingview";
export const STOCKS_SOURCE = "mubasher";
export const EGX30_VALUE = 49234.3;
export const MARKET_TRADE_TIME = Date.UTC(2026, 9, 25, 11, 30, 0) / MS_PER_SECOND;
export const MARKET_TRADE_TIME_ISO = "2026-10-25T14:30:00+03:00";
export const MOVERS_IN_SNAPSHOT = 7;
export const MARKET_BREADTH = { advancers: 3, decliners: 3, unchanged: 1 };
export const MARKET_TOTALS = { volume: 70000, value: 3_500_000 };
export const MARKET_ISINS = Array.from({ length: MOVERS_IN_SNAPSHOT }, (_, index) => syntheticIsin(index));

const BASE_PRICE = 100;
const FIRST_CHANGE_PCT = -3;
const VOLUME_STEP = 1000;
const VALUE_STEP = 50000;
const ACTIVITY_BASE = 10;

export type Mover = Record<string, unknown> & { isin: string };

function nameArOf(index: number): string {
  return `شركة ${syntheticTicker(index)}`;
}

function nameEnOf(index: number): string {
  return `${syntheticTicker(index)} Company`;
}

function changePctAt(index: number): number {
  return FIRST_CHANGE_PCT + index;
}

function volumeFor(changePct: number): number {
  return VOLUME_STEP * (ACTIVITY_BASE + changePct);
}

function valueFor(changePct: number): number {
  return VALUE_STEP * (ACTIVITY_BASE - changePct);
}

function moverAt(index: number): Mover {
  const changePct = changePctAt(index);
  return {
    isin: syntheticIsin(index),
    ticker: syntheticTicker(index),
    nameEn: nameEnOf(index),
    nameAr: nameArOf(index),
    price: BASE_PRICE + changePct,
    changePct,
    volume: volumeFor(changePct),
    value: valueFor(changePct),
  };
}

export const TOP_GAINER = moverAt(MOVERS_IN_SNAPSHOT - 1);
export const TOP_LOSER = moverAt(0);

export function directoryFor(count: number): DirectorySymbol[] {
  return Array.from({ length: count }, (_, index) =>
    stockSymbol(syntheticIsin(index), syntheticTicker(index), { nameAr: nameArOf(index), nameEn: nameEnOf(index) }),
  );
}

export function indexEntry(value: number, changePct: number): IndexEntry {
  return { v: value, chp: changePct, tt: MARKET_TRADE_TIME, src: INDEX_SOURCE };
}

function quote(ticker: string, changePct: number, tradeDate: string): QuoteEntry {
  return {
    t: ticker,
    p: BASE_PRICE + changePct,
    o: BASE_PRICE,
    h: BASE_PRICE + 5,
    l: BASE_PRICE - 5,
    pc: BASE_PRICE,
    ch: changePct,
    chp: changePct,
    v: volumeFor(changePct),
    val: valueFor(changePct),
    tt: MARKET_TRADE_TIME,
    td: tradeDate,
    src: STOCKS_SOURCE,
  };
}

export function marketSnapshot(sessionDate: string): Partial<Snapshot> {
  const quotes = Object.fromEntries(
    MARKET_ISINS.map((isin, index) => [isin, quote(syntheticTicker(index), changePctAt(index), sessionDate)]),
  );
  return {
    session: { ...defaultSnapshot().session, date: sessionDate },
    sources: { stocks: STOCKS_SOURCE, primaryFailed: true },
    quotes,
    indices: { EGX30: indexEntry(EGX30_VALUE, -3.56), EGX70EWI: indexEntry(11234.5, 0.42) },
    breadth: MARKET_BREADTH,
    totals: MARKET_TOTALS,
    top: {
      gainers: [...MARKET_ISINS].reverse(),
      losers: MARKET_ISINS,
      byVolume: [...MARKET_ISINS].reverse(),
      byValue: MARKET_ISINS,
    },
  };
}
