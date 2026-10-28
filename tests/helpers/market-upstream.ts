import { vi } from "vitest";
import { requestUrl } from "./request";
import type { DirectorySymbol } from "../../src/store/kv";
import isaghaGold from "../fixtures/isagha-gold.html?raw";
import isaghaSilver from "../fixtures/isagha-silver.html?raw";
import mubasherActions from "../fixtures/mubasher-actions-p1.json";
import mubasherFunds from "../fixtures/mubasher-funds-p1.json";
import mubasherPrices from "../fixtures/mubasher-prices-all.json";
import tradingViewFundamentals from "../fixtures/tradingview-fundamentals.json";
import tradingViewFxMetals from "../fixtures/tradingview-fx-metals.json";
import tradingViewGlobalScan from "../fixtures/tradingview-global-scan.json";

export type UpstreamKind =
  | "tv-stocks"
  | "tv-closes"
  | "tv-fundamentals"
  | "mubasher-listed"
  | "mubasher-prices"
  | "mubasher-funds"
  | "mubasher-funds-later"
  | "mubasher-actions";

export type UpstreamOptions = {
  symbolCount: number;
  newListings?: number;
  fundPages?: number;
  actionRows?: number;
  tick: () => number;
  tradeTime: number;
  isDown?: (kind: UpstreamKind) => boolean;
};

const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/egypt/scan";
const TRADINGVIEW_GLOBAL_URL = "https://scanner.tradingview.com/global/scan";
const MUBASHER_BASE = "https://www.mubasher.info/api/1/";
const ISAGHA_GOLD_URL = "https://market.isagha.com/prices";
const ISAGHA_SILVER_URL = "https://market.isagha.com/prices/silver";
const FX_TICKER = "FX_IDC:USDEGP";
const FUNDAMENTALS_COLUMN = "total_revenue_fy";
const TRADED_COLUMN = "Value.Traded";
const BASE_PRICE = 10;
const PRICE_STEP = 0.01;
const FUND_ID_STRIDE = 1000;
const BONUS_TYPE_PREFIX = "توزيع أسهم خزينة";
const ACTION_EX_DATE = "10 نوفمبر 2026";
const MUBASHER_LISTED_ROW = mubasherActionsSeed();
const ACTION_PAGES = 3;
const STOCK_TYPE = "stock";
const CURRENCY = "EGP";

export function isinOf(index: number): string {
  return `EGS${String(index + 1).padStart(9, "0")}`;
}

export function tickerOf(index: number): string {
  return `S${String(index + 1).padStart(3, "0")}`;
}

export function directorySymbols(count: number): DirectorySymbol[] {
  return Array.from({ length: count }, (_, index) => [isinOf(index), tickerOf(index), null, null, "Banks", "active", "", "", []] as DirectorySymbol);
}

function mubasherActionsSeed() {
  return mubasherActions.rows.find((row) => row.type.startsWith(BONUS_TYPE_PREFIX)) ?? mubasherActions.rows[0]!;
}

function scanRow(index: number, tick: number, tradeTime: number) {
  const price = BASE_PRICE + (index % 7) + tick * PRICE_STEP;
  return {
    s: `EGX:${tickerOf(index)}`,
    d: [tickerOf(index), `Company ${index}`, isinOf(index), "Banks", price, price, price, price, 1, 0.1, 1000 + tick, 50_000 + index + tick, tradeTime, tradeTime + tick, STOCK_TYPE, null, null, CURRENCY],
  };
}

function stockScan(count: number, tick: number, tradeTime: number) {
  const data = Array.from({ length: count }, (_, index) => scanRow(index, tick, tradeTime));
  return { totalCount: data.length, data };
}

function closesScan(count: number, tick: number, tradeTime: number) {
  const data = Array.from({ length: count }, (_, index) => ({
    s: `EGX:${tickerOf(index)}`,
    d: [tickerOf(index), BASE_PRICE + (index % 7) + tick * PRICE_STEP, tradeTime, STOCK_TYPE],
  }));
  return { totalCount: data.length, data };
}

function fundamentalsScan(count: number, tick: number) {
  const template = tradingViewFundamentals.data[0]!.d;
  const data = Array.from({ length: count }, (_, index) => ({
    s: `EGX:${tickerOf(index)}`,
    d: template.map((value, column) => {
      if (column === 0) return tickerOf(index);
      if (column === 1) return isinOf(index);
      return typeof value === "number" ? value + index + tick : value;
    }),
  }));
  return { totalCount: data.length, data };
}

function listedRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `شركة ${index}`,
    url: `/markets/EGX/stocks/${tickerOf(index)}`,
    market: "البورصة المصرية",
    sector: "بنوك",
    symbol: tickerOf(index),
    price: BASE_PRICE,
    changePercentage: 0,
    lastUpdate: "25 أكتوبر 2026",
  }));
}

function fundsPage(page: number, pages: number, tick: number) {
  const rows = mubasherFunds.rows.map((row) => ({ ...row, fundId: row.fundId + page * FUND_ID_STRIDE, price: row.price + tick * PRICE_STEP }));
  return { ...mubasherFunds, numberOfPages: pages, rows };
}

function actionsPage(total: number, page: number) {
  const perPage = Math.ceil(total / ACTION_PAGES);
  const first = (page - 1) * perPage;
  const rows = Array.from({ length: Math.max(0, Math.min(perPage, total - first)) }, (_, offset) => ({
    ...MUBASHER_LISTED_ROW,
    url: `/markets/EGX/stocks/${tickerOf(first + offset)}`,
    effectiveFrom: ACTION_EX_DATE,
  }));
  return { numberOfPages: ACTION_PAGES, validCriteria: true, rows };
}

function htmlResponse(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function scanKind(init: RequestInit | undefined): UpstreamKind {
  const columns = (JSON.parse(String(init?.body)) as { columns: string[] }).columns;
  if (columns.includes(FUNDAMENTALS_COLUMN)) return "tv-fundamentals";
  return columns.includes(TRADED_COLUMN) ? "tv-stocks" : "tv-closes";
}

function mubasherKind(url: string): UpstreamKind {
  const path = url.slice(MUBASHER_BASE.length);
  if (path.startsWith("listed-companies")) return "mubasher-listed";
  if (path.startsWith("stocks/prices")) return "mubasher-prices";
  if (path.startsWith("corporate-actions")) return "mubasher-actions";
  return new URL(url).searchParams.get("page") === "1" ? "mubasher-funds" : "mubasher-funds-later";
}

export function stubUpstream(options: UpstreamOptions) {
  const { symbolCount, newListings = 0, fundPages = 1, actionRows = 0, tick, tradeTime, isDown = () => false } = options;
  const respond = (kind: UpstreamKind, url: string, init: RequestInit | undefined): Response => {
    if (isDown(kind)) return new Response("down", { status: 500 });
    switch (kind) {
      case "tv-stocks":
        return Response.json(stockScan(symbolCount + newListings, tick(), tradeTime));
      case "tv-closes":
        return Response.json(closesScan(symbolCount + newListings, tick(), tradeTime));
      case "tv-fundamentals":
        return Response.json(fundamentalsScan(symbolCount + newListings, tick()));
      case "mubasher-listed":
        return Response.json({ numberOfPages: 1, rows: listedRows(symbolCount + newListings) });
      case "mubasher-prices":
        return Response.json(mubasherPrices);
      case "mubasher-actions":
        return Response.json(actionsPage(actionRows, Number(new URL(url).searchParams.get("page"))));
      default:
        return Response.json(fundsPage(Number(new URL(url).searchParams.get("page")), fundPages, tick()));
    }
  };
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url === ISAGHA_GOLD_URL) return htmlResponse(isaghaGold);
    if (url === ISAGHA_SILVER_URL) return htmlResponse(isaghaSilver);
    if (url.startsWith(TRADINGVIEW_GLOBAL_URL)) {
      return Response.json(String(init?.body).includes(FX_TICKER) ? tradingViewFxMetals : tradingViewGlobalScan);
    }
    if (url.startsWith(TRADINGVIEW_SCAN_URL)) return respond(scanKind(init), url, init);
    if (url.startsWith(MUBASHER_BASE)) return respond(mubasherKind(url), url, init);
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}
