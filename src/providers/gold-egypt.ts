import { fetchText } from "./http";
import { ProviderError, type EgyptMetalsProvider } from "./types";

const PROVIDER_ID = "isagha";
const GOLD_URL = "https://market.isagha.com/prices";
const SILVER_URL = "https://market.isagha.com/prices/silver";
const GOLD_UNITS = ["18", "21", "24"];
const SILVER_UNITS = ["925", "999"];
const ROW_SELECTOR = 'tr[data-testid="prices-row"]';
const FIGURE_SELECTOR = `${ROW_SELECTOR} [data-testid="price-figure"]`;
const UNIT_ATTRIBUTE = "data-unit";
const SELL_FIGURE_INDEX = 0;
const BUY_FIGURE_INDEX = 2;
const THOUSANDS_SEPARATOR = /,/g;

type Retail = Awaited<ReturnType<EgyptMetalsProvider["fetchRetail"]>>;
type UnitPrice = Retail["gold"][string];

function parseFigure(text: string | undefined): number | null {
  if (text === undefined) return null;
  const digits = text.trim().replace(THOUSANDS_SEPARATOR, "");
  if (digits === "") return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

async function readRows(html: string): Promise<Map<string, string[]>> {
  const rows = new Map<string, string[]>();
  let figures: string[] = [];
  const rewriter = new HTMLRewriter()
    .on(ROW_SELECTOR, {
      element(row) {
        figures = [];
        const unit = row.getAttribute(UNIT_ATTRIBUTE);
        if (unit !== null) rows.set(unit, figures);
      },
    })
    .on(FIGURE_SELECTOR, {
      element() {
        figures.push("");
      },
      text(chunk) {
        figures[figures.length - 1] += chunk.text;
      },
    });
  await rewriter.transform(new Response(html)).text();
  return rows;
}

function toUnitPrice(unit: string, figures: string[]): UnitPrice {
  const sell = parseFigure(figures[SELL_FIGURE_INDEX]);
  const buy = parseFigure(figures[BUY_FIGURE_INDEX]);
  if (sell === null || buy === null) {
    throw new ProviderError(PROVIDER_ID, "parse", `unit ${unit} has no readable buy and sell figures`);
  }
  return { buy, sell };
}

async function fetchUnits(url: string, units: string[]): Promise<Record<string, UnitPrice>> {
  const rows = await readRows(await fetchText(PROVIDER_ID, url));
  if (rows.size === 0) throw new ProviderError(PROVIDER_ID, "parse", `${url} has no price rows`);
  const prices: Record<string, UnitPrice> = {};
  for (const unit of units) {
    const figures = rows.get(unit);
    if (figures === undefined) throw new ProviderError(PROVIDER_ID, "parse", `${url} has no row for unit ${unit}`);
    prices[unit] = toUnitPrice(unit, figures);
  }
  return prices;
}

export const isaghaRetail: EgyptMetalsProvider = {
  id: PROVIDER_ID,
  async fetchRetail() {
    const [gold, silver] = await Promise.all([fetchUnits(GOLD_URL, GOLD_UNITS), fetchUnits(SILVER_URL, SILVER_UNITS)]);
    return { gold, silver };
  },
};
