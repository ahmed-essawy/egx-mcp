import { TOOL_DESCRIPTIONS } from "../mcp/tool-descriptions";
import type { ToolName } from "../mcp/tool-names";
import { MAX_ITEMS_PER_USER } from "../store/d1/personal";

export type ToolGroupId = "find" | "market" | "history" | "funds" | "company" | "metals" | "personal" | "owner";

export type ToolGuide = { group: ToolGroupId; example: string; returns: string };

export type ToolGroup = { id: ToolGroupId; label: string; intro: string };

export type ToolEntry = { name: ToolName; description: string; group: ToolGroupId; example: string; returns: string };

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: "find", label: "Find and quote", intro: "Find a stock or fund and get its delayed quote." },
  { id: "market", label: "Market today", intro: "The state of the market from the latest delayed snapshot." },
  { id: "history", label: "History", intro: "End-of-day prices and index closes, up to 5 years per request." },
  { id: "funds", label: "Funds", intro: "Egyptian mutual funds with daily NAVs." },
  {
    id: "company",
    label: "Company data",
    intro: "Company profiles, dividends, corporate actions and stored figures.",
  },
  { id: "metals", label: "Gold and currency", intro: "Gold, silver and the dollar rate in Egypt." },
  {
    id: "personal",
    label: "Your portfolio and price levels",
    intro: `Personal tools that work only on your own data, up to ${MAX_ITEMS_PER_USER} holdings and ${MAX_ITEMS_PER_USER} price levels. EGX MCP never pushes alerts; crossings show when you ask.`,
  },
  { id: "owner", label: "Owner only", intro: "Maintenance for the service owner." },
];

export const TOOL_GUIDE: Readonly<Record<ToolName, ToolGuide>> = {
  search: {
    group: "find",
    example: "Which EGX stocks have cement in the name?",
    returns: "Matching stocks and funds with ticker, ISIN and Arabic and English names.",
  },
  get_quotes: {
    group: "find",
    example: "What are the delayed prices of CIB and Talaat Moustafa?",
    returns: "Price, change, volume and value per stock, with the data time and source.",
  },
  get_market_overview: {
    group: "market",
    example: "How is the EGX market doing today?",
    returns: "Index values, advancers and decliners, top movers, most active stocks and totals.",
  },
  get_indices: {
    group: "market",
    example: "What are the EGX30 and EGX70 at?",
    returns: "Each index value and change with its data time.",
  },
  get_movers: {
    group: "market",
    example: "Which stocks are the top gainers today?",
    returns: "A ranked list for the chosen kind of move, with prices and changes.",
  },
  get_52_week_range: {
    group: "market",
    example: "How far is COMI from its 52-week high?",
    returns: "The 52-week high and low with their dates and the distance of the delayed price from each.",
  },
  get_sector_performance: {
    group: "market",
    example: "Which sectors did best this month?",
    returns: "Median return, advancers and decliners per sector for the period.",
  },
  get_daily_summary: {
    group: "market",
    example: "Give me a summary of the last session.",
    returns: "Closing index values, breadth, top movers and totals of the last completed session.",
  },
  get_price_history: {
    group: "history",
    example: "Show COMI daily prices for the last year, raw and adjusted.",
    returns: "Daily open, high, low, close and volume, paged 500 bars at a time.",
  },
  compare_symbols: {
    group: "history",
    example: "Which did better over 6 months, COMI, ETEL or SWDY?",
    returns: "Return, high, low and total volume per stock from adjusted prices.",
  },
  get_index_history: {
    group: "history",
    example: "How did the EGX30 move week by week over the last year?",
    returns: "Index closes per day, week or month, up to 500 points.",
  },
  get_index_summary: {
    group: "history",
    example: "Compare the EGX30 and EGX70 over 6 months: return, volatility and drawdown.",
    returns: "Latest close, change, period high, low and return, averages, volatility and drawdown per index.",
  },
  get_fund: {
    group: "funds",
    example: "What is the latest NAV of this fund and how did it do this year?",
    returns: "Latest NAV with its date and returns over 1 month, 3 months, 1 year and year to date.",
  },
  get_fund_history: {
    group: "funds",
    example: "Show the NAV history of this fund for the last 3 months.",
    returns: "Daily NAVs between two dates, 500 points per page, with the earliest date available.",
  },
  compare_funds: {
    group: "funds",
    example: "Compare these two funds over the last year against the EGX30.",
    returns: "Return per fund in its own currency for the period, optionally with the EGX30.",
  },
  get_real_return: {
    group: "funds",
    example: "What was the real return of this fund after inflation since January?",
    returns: "Nominal return, inflation over the period and the real return, with the CPI months used.",
  },
  get_company_profile: {
    group: "company",
    example: "Tell me about COMI: sector, shares and first trade date.",
    returns: "Sector, market, shares outstanding, free float and first trade date.",
  },
  get_dividends: {
    group: "company",
    example: "Which dividends have ex-dates in the next 90 days?",
    returns: "Cash dividends with ex-date, amount and currency.",
  },
  get_corporate_actions: {
    group: "company",
    example: "What corporate actions did COMI have in the last 5 years?",
    returns: "Dividends, bonus shares, splits, rights and other actions with their ex-dates.",
  },
  get_financials: {
    group: "company",
    example: "What are COMI's revenue, net income and P/E?",
    returns: "Stored financial figures with period and source, and P/E, P/B and dividend yield with their inputs.",
  },
  get_metals: {
    group: "metals",
    example: "What is the gold 21K price and the gold pound price in Egypt today?",
    returns: "Egyptian gold and silver buy and sell prices per gram, the gold pound and global spot prices in USD.",
  },
  get_usd_egp: {
    group: "metals",
    example: "What is the dollar rate in EGP?",
    returns: "The delayed USD to EGP market rate with its data time.",
  },
  portfolio_get: {
    group: "personal",
    example: "What is my portfolio worth and how is it split by sector?",
    returns: "Holdings with value and gain, totals, sector allocation and price levels crossed since the last check.",
  },
  portfolio_upsert_holding: {
    group: "personal",
    example: "Record that I bought 100 COMI at 95 EGP on 2026-03-01.",
    returns: "The id of the saved holding.",
  },
  portfolio_remove_holding: {
    group: "personal",
    example: "Remove my COMI holding.",
    returns: "Whether the holding was removed.",
  },
  price_level_set: {
    group: "personal",
    example: "Set a price level for when COMI goes above 100 EGP.",
    returns: "The id of the saved price level.",
  },
  price_level_remove: {
    group: "personal",
    example: "Remove my price level for COMI.",
    returns: "Whether the price level was removed.",
  },
  price_levels_list: {
    group: "personal",
    example: "Which price levels have I set?",
    returns: "Your price levels with their armed state and last crossing time.",
  },
  what_changed_since: {
    group: "personal",
    example: "What changed since yesterday afternoon, including any price levels I crossed?",
    returns: "New fund NAVs, big moves, new listings, corporate actions and your crossed price levels since that time.",
  },
  admin: {
    group: "owner",
    example: "As the owner, list the open notices.",
    returns: "Owner maintenance results; every other account gets a forbidden answer.",
  },
};

const GUIDED_TOOLS = Object.keys(TOOL_GUIDE) as ToolName[];

export function toolEntries(): readonly ToolEntry[] {
  return TOOL_GROUPS.flatMap((group) =>
    GUIDED_TOOLS.filter((name) => TOOL_GUIDE[name].group === group.id).map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      ...TOOL_GUIDE[name],
    })),
  );
}
