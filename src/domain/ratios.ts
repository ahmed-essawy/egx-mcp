export type RatioInputs = Readonly<Record<string, number>>;

export type RatioResult =
  | { value: number; inputs: RatioInputs }
  | { status: "not_computable"; reason: string };

export type Priced = { price: number | null; currency: string };

function notComputable(reason: string): RatioResult {
  return { status: "not_computable", reason };
}

function currencyMismatch(priceCurrency: string, figureCurrency: string | null): RatioResult | null {
  if (figureCurrency === null || figureCurrency === priceCurrency) return null;
  return notComputable(`figure currency ${figureCurrency} differs from price currency ${priceCurrency}`);
}

export function pe({ price, currency }: Priced, eps: number | null, epsCurrency: string | null): RatioResult {
  if (price === null) return notComputable("price is missing");
  if (eps === null) return notComputable("EPS is missing");
  const mismatch = currencyMismatch(currency, epsCurrency);
  if (mismatch !== null) return mismatch;
  if (eps <= 0) return notComputable("EPS is not positive");
  return { value: price / eps, inputs: { price, eps } };
}

export function pb(
  { price, currency }: Priced,
  equity: number | null,
  shares: number | null,
  equityCurrency: string | null,
): RatioResult {
  if (price === null) return notComputable("price is missing");
  if (equity === null) return notComputable("total equity is missing");
  const mismatch = currencyMismatch(currency, equityCurrency);
  if (mismatch !== null) return mismatch;
  if (shares === null) return notComputable("shares outstanding is missing");
  if (shares <= 0) return notComputable("shares outstanding is not positive");
  if (equity <= 0) return notComputable("total equity is not positive");
  return { value: price / (equity / shares), inputs: { price, equity, shares } };
}

export function dividendYield(
  price: number | null,
  dividends365: number | null,
  unpricedDividends: number,
): RatioResult {
  if (price === null) return notComputable("price is missing");
  if (price <= 0) return notComputable("price is not positive");
  if (unpricedDividends > 0) {
    return notComputable(`${unpricedDividends} cash dividend(s) in the last 365 days have no amount yet`);
  }
  if (dividends365 === null) return notComputable("dividends are missing");
  return { value: dividends365 / price, inputs: { price, dividends365 } };
}
