# Contract: MCP tools

Transport: MCP Streamable HTTP, stateless, at `POST /mcp` (see [http-endpoints.md](http-endpoints.md)). Auth: OAuth access token or API key as `Authorization: Bearer`. Every tool declares `inputSchema` and `outputSchema` (zod 4) and returns `structuredContent` plus one `text` content item with the same JSON.

Symbol inputs (`symbol`, `symbols[]`) accept a ticker, ISIN, Arabic or English name; resolution uses the directory and fails with `not_found` (with up to 5 suggestions) or `ambiguous` (with candidates).

## Common envelope

```json
{
  "data": {},
  "meta": {
    "label": "delayed | end_of_day | daily_nav | owner_entered | personal",
    "dataTime": "2026-10-25T11:30:00+03:00",
    "source": "tradingview",
    "stale": false,
    "staleReason": null,
    "session": { "date": "2026-10-25", "status": "open | closed | holiday | pre_open" },
    "notAvailable": [ { "field": "investorStats", "reason": "not available from current sources" } ]
  },
  "notice": "Delayed, unofficial data for information only. Not investment advice."
}
```

Rules: `meta` is present on every market data response (FR-007, SC-002). Per-item `source`, `dataTime`, `stale` appear inside `data` items when items differ. A listed symbol with no data returns the item with `status: "no_data_yet"` (FR-009). Stock stale: trade date older than the last completed session before today (FR-008). Errors use MCP tool errors (`isError: true`) with `{ "error": { "code": "...", "message": "...", "retryAt": "ISO or null" } }`. Codes: `unauthorized`, `rate_limited`, `capacity`, `not_found`, `ambiguous`, `invalid_input`, `not_available`, `forbidden`.

## Market data tools (read only)

| Tool | Input | `data` output | Reads |
|---|---|---|---|
| `search` | `query` string 1..80, `type` `stock`/`fund`/`any` (default `any`), `limit` 1..20 (default 10) | `results[]`: `{ type, isin or fundId, ticker, nameAr, nameEn, sector or manager, status }` | directory |
| `get_quotes` | `symbols` string[1..20] | `quotes[]`: `{ isin, ticker, nameEn, nameAr, status, price, open, high, low, prevClose, change, changePct, volume, value, tradeDate, dataTime, source, stale }` | snapshot |
| `get_market_overview` | `top` 1..10 (default 5) | `{ status, indices[], breadth{advancers,decliners,unchanged}, topGainers[], topLosers[], mostActiveByVolume[], mostActiveByValue[], totals{volume,value}, investorStats or null }`; `investorStats` is null with a `meta.notAvailable` reason while no source provides it | snapshot |
| `get_indices` | `names` string[0..10] (empty = all known) | `indices[]`: `{ code, name, value, changePct, dataTime, source }` or `{ code, status: "not_available", reason }` | snapshot |
| `get_price_history` | `symbol`, `from`, `to` (dates, range at most 5 years), `series` `raw`/`adjusted`/`both` (default `both`), `cursor` string optional | `{ isin, earliestAvailable, pendingAdjustments[], bars[]: { date, open, high, low, close, volume, adjOpen, adjHigh, adjLow, adjClose, rawDerived, adjustmentPending, rawPending, source }, nextCursor }` page size 500 | D1 |
| `compare_symbols` | `symbols` string[2..5], `from`, `to` | `items[]`: `{ isin, ticker, returnPct, high, low, totalVolume, firstDate, lastDate, adjustmentPending, pendingAdjustments[] }` (`adjustmentPending` only when a pending action affects a bar inside the range), `commonFrom`, `commonTo` | D1 |
| `get_movers` | `kind` `gainers`/`losers`/`volume`/`value`/`unusual_volume`/`near_52w_high`/`near_52w_low`, `limit` 1..20 | `items[]` with the metric and `avgVol20` or `h52`/`l52` and `distancePct` | snapshot + stats |
| `get_52_week_range` | `symbols` string[1..20] | `items[]`: `{ isin, price, h52, h52Date, l52, l52Date, fromHighPct, fromLowPct }` | snapshot + stats |
| `get_sector_performance` | `period` `1d`/`1w`/`1m`/`3m`/`ytd`/`1y` | `sectors[]`: `{ sector, medianReturnPct, advancers, decliners, symbols }` | stats + directory |
| `get_daily_summary` | none | last completed session: indices, breadth, top 5 movers each way, totals | snapshot (after close) + stats |
| `get_fund` | `fund` string | `{ fundId, nameAr, nameEn (null when the source has none), manager, currency, category (null when the source has none), nav, navDate, stale, cycleDays, performance{1m,3m,1y,ytd} each `{ pct }` or `{ status: "not_available", longestAvailable }` }` | D1 |
| `get_fund_history` | `fund`, `from`, `to`, `cursor` | `{ navs[]: { date, nav }, earliestAvailable, nextCursor }` page 500 | D1 |
| `compare_funds` | `funds` string[2..5], `period` `1m`/`3m`/`1y`/`ytd`, `includeEgx30` boolean (default true) | `items[]`: `{ fundId, currency, returnPct }`, `egx30ReturnPct`, `currenciesDiffer` | D1 |
| `get_real_return` | `fund` or `symbol` (exactly one), `from`, `to` | `{ nominalPct, inflationPct, realPct, inflationSource, inflationMonths: [from, to] }` or `not_available` when CPI months are missing | D1 |
| `get_company_profile` | `symbol` | `{ isin, ticker, nameAr, nameEn, sector, market, sharesOutstanding, freeFloatShares, firstTradeDate, indexCodes, status }`; while no source gives them, `meta.notAvailable` lists `listingDate` and `indexMembership` (`indexCodes` is `[]`) | D1 |
| `get_dividends` | `symbol` optional, `from`, `to` (default today to +90 days) | `items[]`: `{ isin, ticker, kind, exDate, announcedOn, amount, currency, ratio, status, source }` | D1 |
| `get_corporate_actions` | `symbol`, `from` optional | same item shape, all kinds | D1 |
| `get_financials` | `symbol` | `{ figures[]: { metric, periodType, periodEnd, value, currency, source }, missing[], ratios{ pe, pb, dividendYield } each `{ value, inputs }` or `{ status: "not_computable", reason }` }` | D1 + snapshot |
| `get_metals` | none | `{ egypt: { gold18k, gold21k, gold24k, silver925, silver999 } each `{ buy, sell, unit: "EGP/g", dataTime, dataTimeKind: "fetched", source }` or not_available, global: { XAUUSD, XAGUSD } each `{ value, unit: "USD/oz", dataTime, source }` }` | snapshot |
| `get_usd_egp` | none | `{ rate, kind: "market", dataTime, source }` (the only source in the first release is the TradingView market rate) | snapshot |

Pending adjustment (owner decision Q1a; rules in [data-model.md](../data-model.md#pending-labels-owner-decision-q1a)): `pendingAdjustments[]` items are `{ actionId, kind, exDate, announcedOn, source, state, reason }` for every bonus, split or reverse split that is not yet `applied` (`state` `needs_ratio`: "not yet adjusted: awaiting the owner's ratio"; `state` `queued`: "not yet adjusted: adjustment queued", with its cause) and whose ex date is on or before today. `adjustmentPending: true` marks every bar dated before such an ex date whose adjusted prices do not include the action; backfilled bars whose source series already includes it (`rawDerived: true` and ex date on or before the symbol's `adj_basis_date`) carry `rawPending: true` instead (their raw prices do not yet reflect it). Actions with a future ex date label nothing. `compare_symbols` items carry `adjustmentPending` when an action has `adjAffected` true for a bar in the requested range. Items of `get_movers` (52-week kinds), `get_52_week_range` and `get_sector_performance` carry `adjustmentPending` from the `stats:v1` `pendingAdj` entries with `exDate` on or before today (checked when the tool runs, because `stats:v1` holds every unapplied action, including those whose ex date is after the build day) and `adjAffected` true. When any returned item is pending, `meta.notAvailable` includes `{ field: "adjusted", reason }` with the reason of the first pending action. Labels end only when the action is `applied`.

Session status: tools report `snapshot.session.status` when `session.noTradesToday` is true (a holiday missing from the calendar is reported as `closed`); otherwise the status comes from the calendar and the clock.

Ratios (FR-031, constitution III): P/E = price / EPS (TTM), P/B = price / (total equity / shares outstanding), dividend yield = sum of cash dividends with ex date in the last 365 days / price. Computed by the server; never copied from a provider.

## Personal tools (data scoped to the caller, FR-035)

| Tool | Input | Output `data` |
|---|---|---|
| `portfolio_get` | none | `{ holdings[]: { id, isin, ticker, status, quantity, costPerShare, price, value, gain, gainPct, source, dataTime }, totals{cost,value,gain,gainPct}, allocationBySector[], levelsCrossed[] }` |
| `portfolio_upsert_holding` | `id` optional, `symbol`, `quantity` > 0, `costPerShare` >= 0, `acquiredOn` date | `{ id }` |
| `portfolio_remove_holding` | `id` | `{ removed: true }` |
| `price_level_set` | `id` optional, `symbol`, `direction` `above`/`below`, `level` > 0 | `{ id }` |
| `price_level_remove` | `id` | `{ removed: true }` |
| `price_levels_list` | none | `items[]`: `{ id, isin, ticker, direction, level, armed, lastCrossedAt }` |
| `what_changed_since` | `since` ISO instant within the last 30 days | `{ newNavs[], bigMoves[] (abs change > 5%), levelsCrossed[], newListings[], corporateActions[], disclosures: { status: "not_available", reason } }` |

An id belonging to another user returns `not_found` (never `forbidden`, so existence is not leaked).

## Owner tool

`admin`: see [admin-tool.md](admin-tool.md).

## Behavior applying to every tool

- Read only from KV and D1; no upstream fetch during a request (FR-006, constitution II).
- Rate limit order: global caps, then unlimited-list check, then per-minute (Rate Limiting binding, key = user id), then per-day (`usage_daily`). Refusal text states the retry time (FR-046).
- Tools never output buy, sell or hold wording (FR-050); the `notice` field is always present.
