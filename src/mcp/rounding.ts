const PRICE_DECIMALS = 4;
const PERCENT_DECIMALS = 2;
const TURNOVER_DECIMALS = 2;
const INDEX_DECIMALS = 2;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

function roundedOrNull(value: number | null, decimals: number): number | null {
  return value === null ? null : roundTo(value, decimals);
}

export function roundPrice(value: number): number;
export function roundPrice(value: number | null): number | null;
export function roundPrice(value: number | null): number | null {
  return roundedOrNull(value, PRICE_DECIMALS);
}

export function roundPercent(value: number): number;
export function roundPercent(value: number | null): number | null;
export function roundPercent(value: number | null): number | null {
  return roundedOrNull(value, PERCENT_DECIMALS);
}

export function roundTurnover(value: number): number;
export function roundTurnover(value: number | null): number | null;
export function roundTurnover(value: number | null): number | null {
  return roundedOrNull(value, TURNOVER_DECIMALS);
}

export function roundIndex(value: number): number {
  return roundTo(value, INDEX_DECIMALS);
}
