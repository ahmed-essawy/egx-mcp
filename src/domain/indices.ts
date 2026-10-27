export const INDEX_CODES = ["EGX30", "EGX30CAPPED", "EGX30USD", "EGX70EWI", "EGX100EWI"] as const;

export type IndexCode = (typeof INDEX_CODES)[number];

export const INDEX_NAMES: Readonly<Record<IndexCode, string>> = {
  EGX30: "EGX 30 Index",
  EGX30CAPPED: "EGX 30 Capped Index",
  EGX30USD: "EGX 30 USD Index",
  EGX70EWI: "EGX 70 EWI Index",
  EGX100EWI: "EGX 100 EWI Index",
};

export const TRADINGVIEW_INDEX_TICKERS = [
  "EGX:EGX30",
  "EGX:EGX30CAPPED",
  "EGX:EGX70EWI",
  "EGX:EGX100EWI",
] as const;

const SHORT_CODE_ALIASES: Readonly<Record<string, IndexCode>> = {
  EGX70: "EGX70EWI",
  EGX100: "EGX100EWI",
};

function isIndexCode(value: string): value is IndexCode {
  return (INDEX_CODES as readonly string[]).includes(value);
}

export function resolveIndexCode(input: string): IndexCode | undefined {
  const normalized = input.replace(/\s+/g, "").toUpperCase();
  const code = SHORT_CODE_ALIASES[normalized] ?? normalized;
  return isIndexCode(code) ? code : undefined;
}
