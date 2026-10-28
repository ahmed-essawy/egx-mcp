# Contract: MCP tools added or changed by 004

Base contract: [001 contracts/mcp-tools.md](../../001-egx-mcp-server/contracts/mcp-tools.md). This file adds `meta.provenance` to the common envelope (every tool, success and error), defines `get_index_history` and `get_index_summary`, and adds the gold pound and staleness to `get_metals` and `get_usd_egp`.

## Common envelope: `meta.provenance`

```json
"meta": {
  "label": "delayed",
  "dataTime": "2026-10-25T14:30:00+03:00",
  "source": "tradingview",
  "stale": false,
  "staleReason": null,
  "session": { "date": "2026-10-25", "status": "closed" },
  "notAvailable": [],
  "provenance": [
    { "fields": ["indices"], "source": "tradingview", "dataTime": "2026-10-25T14:30:00+03:00", "timeKind": "trade", "stale": false, "basis": "primary" },
    { "fields": ["breadth", "totals", "topGainers", "topLosers", "mostActiveByVolume", "mostActiveByValue"], "source": "tradingview", "dataTime": "2026-10-25T14:30:00+03:00", "timeKind": "trade", "stale": false, "basis": "computed" }
  ]
}
```

Rules:
- `provenance` is required and is `[]` on every error result and on any success whose `data` carries no market value.
- Entries are listed in the order of the `data` keys they first cover; inside a builder, groups keep first-seen source order.
- `fields` is never empty.

### Builders (`src/mcp/provenance.ts`, pure)

| Builder | Output |
|---|---|
| `stockBasis(source, primarySource)` | `"primary"` when `source === primarySource` (the first entry of the configured `STOCK_PROVIDERS`), else `"backup"` |
| `quoteProvenance(fields, quotes, primarySource, clock)` | one entry per distinct `quote.src`: `dataTime` newest `tt` of the group (`toCairoIso`), `timeKind: "trade"`, `stale` true when any quote of the group has `isQuoteStale(td, clock.sessionDate, clock.holidays)`, `basis: stockBasis(src, primarySource)`; `[]` for no quotes |
| `indexProvenance(fields, entries)` | one entry per distinct `entry.src`: newest `tt`, `"trade"`, `stale: false`, `"primary"`; `[]` for no entries |
| `closeProvenance(fields, rows, stale)` | `rows: { date, source }[]`; one entry per distinct source: `dataTime` newest date of the group, `"close"`, the given `stale`, basis `"computed"` when the source ends with `+filled`, else `"primary"`; `[]` for no rows |
| `computedProvenance(fields, source, dataTime, timeKind, stale)` | one entry with `basis: "computed"` |

Constants exported from the same module: `STORED_BARS_SOURCE = "stored daily bars"` (reused by `src/mcp/tools/funds.ts`, replacing its `BARS_SOURCE`), `STORED_INDEX_SOURCE = "stored index closes"`, `SYMBOL_MASTER_SOURCE = "symbol master"`, `MARKET_EVENTS_SOURCE = "market events"`, `DIRECTORY_SOURCE = "directory"` (reused by `search.ts`).

### Per tool

`clock` is the tool's `MarketClock`; `snapshot.sources` is written `sources`.

| Tool | `meta.provenance` |
|---|---|
| `search` | directory present and not empty: `[computedProvenance(["results"], "directory", toCairoIso(builtAt), "fetched", false)]`; missing or empty: `[]` |
| `get_quotes` | `quoteProvenance(["quotes"], served quotes, sources, clock)`; no snapshot: `[]` |
| `get_market_overview` | `indexProvenance(["indices"], available index entries)`, then `computedProvenance(OVERVIEW_MOVER_FIELDS, sources.stocks, newest quote and index tt as in meta.dataTime, "trade", false)`; `OVERVIEW_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers", "mostActiveByVolume", "mostActiveByValue"]` |
| `get_indices` | `indexProvenance(["indices"], entries of the requested known indices)` |
| `get_daily_summary` | `closeProvenance(["indices"], available entries as { date: cairoParts(tt).date, source: src }, stale)` per source, `stale` true when any entry date differs from `snapshot.session.date`, then `computedProvenance(SUMMARY_MOVER_FIELDS, sources.stocks, snapshot.session.date, "close", false)`; `SUMMARY_MOVER_FIELDS = ["breadth", "totals", "topGainers", "topLosers"]` |
| `get_movers` | `quoteProvenance(["items"], picked quotes, sources, clock)`; stats kinds also `computedProvenance(["items"], STORED_BARS_SOURCE, stats.asOf, "close", false)` |
| `get_52_week_range` | `quoteProvenance(["items"], served quotes, sources, clock)`, then `computedProvenance(["items"], STORED_BARS_SOURCE, stats.asOf, "close", false)` |
| `get_sector_performance` | sectors present: `[computedProvenance(["sectors"], STORED_BARS_SOURCE, stats.asOf, "close", false)]`; none: `[]` |
| `get_price_history` | `closeProvenance(["bars"], page bars as { date: sessionDate, source }, false)` |
| `compare_symbols` | `[computedProvenance(["items", "commonFrom", "commonTo"], STORED_BARS_SOURCE, commonTo, "close", false)]` |
| `get_fund` | `closeProvenance(["nav", "navDate"], [{ date: navDate, source: "mubasher" }], stale)`, then `computedProvenance(["performance"], "mubasher", navDate, "close", stale)` |
| `get_fund_history` | `closeProvenance(["navs"], navs as { date, source: "mubasher" }, meta.stale)` |
| `compare_funds` | `computedProvenance(["items"], "mubasher", newest navDate, "close", meta.stale)`; when `egx30ReturnPct` is a number, also `computedProvenance(["egx30ReturnPct"], STORED_INDEX_SOURCE, end close date, "close", false)` |
| `get_real_return` | ok: `computedProvenance(["nominalPct", "realPct"], price source, end value date, "close", false)`, then `computedProvenance(["inflationPct", "realPct"], inflationSource, monthOf(to), "period", false)`; `status: "not_available"`: `[]` |
| `get_company_profile` | `[computedProvenance(["sector", "market", "sharesOutstanding", "freeFloatShares", "firstTradeDate", "indexCodes", "status"], SYMBOL_MASTER_SOURCE, toCairoIso(profile.updatedAt), "fetched", false)]` |
| `get_dividends`, `get_corporate_actions` | one entry per distinct action source: `{ fields: ["items"], source, dataTime: newest exDate of the group, timeKind: "period", stale: false, basis: "primary" }`; no items: `[]` |
| `get_financials` | one entry per distinct figure source: `{ fields: ["figures"], source, dataTime: newest non-null periodEnd or null, timeKind: "period", stale: false, basis: "primary" }`; with a quote also `computedProvenance(["ratios"], quote.src, toCairoIso(quote.tt), "trade", meta.stale)` |
| `get_metals` | Egypt present: `{ fields: ["egypt"], source: egypt.src, dataTime: toCairoIso(fetchedAt), timeKind: "fetched", stale: egyptStale, basis: "primary" }`; then one entry per distinct spot `src`: `{ fields: ["global"], dataTime: newest spot tt, timeKind: "trade", stale: any spot stale, basis: "primary" }` |
| `get_usd_egp` | `[{ fields: ["rate"], source: src, dataTime: toCairoIso(tt), timeKind: "trade", stale: fxStale, basis: "primary" }]` |
| `portfolio_get` | snapshot present: `quoteProvenance(["holdings"], held quotes, sources, clock)`, then, when any quote, `computedProvenance(["totals", "allocationBySector", "levelsCrossed"], sources.stocks, meta.dataTime, "trade", meta.stale)`; no snapshot: `[]` |
| `what_changed_since` | events present: `computedProvenance(["bigMoves", "newListings", "corporateActions"], MARKET_EVENTS_SOURCE, toCairoIso(newest occurredAt), "fetched", false)`; `new_nav` events present: `computedProvenance(["newNavs"], MARKET_EVENTS_SOURCE, toCairoIso(newest new_nav occurredAt), "fetched", false)`; levels crossed present: `computedProvenance(["levelsCrossed"], sources.stocks, newest tt of the crossing quotes, "trade", false)` |
| `portfolio_upsert_holding`, `portfolio_remove_holding`, `price_level_set`, `price_level_remove`, `price_levels_list` | `[]` (owner data, no market value) |
| `admin` | `[]` (owner data, no market value) |
| `get_index_history`, `get_index_summary` | see below |
| every error result | `[]` |

Staleness constants: `EGYPT_RETAIL_STALE_SECONDS = 26 * SECONDS_PER_HOUR`, `SPOT_STALE_SECONDS = 72 * SECONDS_PER_HOUR` (also for FX). Stale when `clock.now - time > limit`.

## `get_index_history`

Input:

| Field | Type | Default |
|---|---|---|
| `index` | string 1..40, resolved by `resolveIndexCode` | required |
| `days` | integer 1..1825, calendar days back from today (Cairo) | 365 |
| `interval` | `"daily"`, `"weekly"`, `"monthly"` | `"daily"` |
| `maxRows` | integer 1..500 | 500 |

`data`:

```json
{
  "code": "EGX30",
  "name": "EGX 30 Index",
  "interval": "weekly",
  "from": "2025-10-28",
  "to": "2026-10-28",
  "earliestAvailable": "2021-10-28",
  "truncated": false,
  "points": [ { "date": "2026-10-22", "close": 51052.26, "source": "mubasher" } ]
}
```

- Unknown `index`: tool error `not_found`, message `Unknown index: <input>.`
- Known index with no rows in the window: `points: []`, `earliestAvailable` from the table or `null`, `meta.notAvailable: [{ field: "points", reason: "no stored closes for this index in the requested window" }]`.
- `from = shiftDays(today, -days)`, `to = today`.
- `weekly`: bucket key is the Thursday on or after the session date; the point is the bucket's last close, dated with its own session date. `monthly`: bucket key `YYYY-MM`, same rule.
- `truncated` is true when the downsampled series is longer than `maxRows`; then only the last `maxRows` points are returned.
- `close` is rounded with `roundIndex`.
- `meta`: `label: "end_of_day"`, `dataTime` the last point's date or `null`, `source` the last point's source or `null`, `stale` and `staleReason` (`Latest close <date> is older than the last completed session.`) from `isQuoteStale(lastDate, clock.sessionDate, clock.holidays)`, `session: sessionMeta(clock, null)`, `provenance: closeProvenance(["points"], points, stale)`.

## `get_index_summary`

Input:

| Field | Type | Default |
|---|---|---|
| `indices` | array of 1..5 strings 1..40 | `["EGX30"]` |
| `days` | integer 1..1825 | 365 |

`data`:

```json
{
  "summaries": [
    {
      "code": "EGX30", "name": "EGX 30 Index", "status": "ok",
      "latest": { "date": "2026-10-27", "close": 50104.83 },
      "previousClose": 48416.94, "dailyChange": 1687.89, "dailyChangePct": 3.49,
      "periodFrom": "2025-10-28",
      "periodHigh": { "date": "2026-10-20", "close": 53000.1 },
      "periodLow": { "date": "2025-11-10", "close": 36000.5 },
      "periodReturnPct": 21.4, "sma20": 51000.2, "sma50": 50000.9,
      "annualizedVolatilityPct": 18.3, "drawdownFromHighPct": -5.47, "return5SessionsPct": -1.9,
      "observations": 245, "sources": ["mubasher", "tradingview"], "stale": false
    },
    { "input": "EGX99", "status": "not_found" },
    { "code": "EGX30USD", "status": "not_available", "reason": "no stored closes for this index" }
  ],
  "highestReturn": { "code": "EGX30", "periodReturnPct": 21.4 }
}
```

Formulas (pure, `src/domain/index-analytics.ts`). The rows read cover `shiftDays(today, -max(days, 100))` to today. `series` is those closes, oldest first; `period` is the closes with `date >= periodFrom`, where `periodFrom = shiftDays(today, -days)`.

| Metric | Definition | `null` when |
|---|---|---|
| `latest` | last of `series` | never (empty series means `not_available`) |
| `previousClose`, `dailyChange`, `dailyChangePct` | second-to-last close; `latest - prev`; `(latest / prev - 1) * 100` | fewer than 2 closes |
| `periodHigh`, `periodLow` | max and min close in `period` (first occurrence on ties) with its date | fewer than 2 closes in `period` |
| `periodReturnPct` | `(latest / first close of period - 1) * 100` | fewer than 2 closes in `period` |
| `sma20`, `sma50` | mean of the last 20 or 50 closes of `series` | fewer than 20 or 50 closes |
| `annualizedVolatilityPct` | sample standard deviation (n - 1) of `close[i] / close[i-1] - 1` over `period`, times `sqrt(252)`, times 100 | fewer than 3 closes in `period` |
| `drawdownFromHighPct` | `(latest / periodHigh.close - 1) * 100` | fewer than 2 closes in `period` |
| `return5SessionsPct` | `(latest / close[len - 6] - 1) * 100` over `series` | fewer than 6 closes |
| `observations` | closes in `period` | never |

- Closes and SMAs are rounded with `roundIndex`, every `...Pct` with `roundPercent`.
- Every `null` metric adds `{ field: "<code>.<metric>", reason: "not enough stored closes" }` to `meta.notAvailable`.
- `highestReturn` is present only when 2 or more `ok` summaries have a non-null `periodReturnPct`; it is the maximum, ties to the earlier request position; otherwise `null`.
- Duplicate inputs resolving to the same code are served once, at the first position. Unknown inputs are `{ input, status: "not_found" }` in request position.
- Item `stale` is `isQuoteStale(latest.date, clock.sessionDate, clock.holidays)`.
- `meta`: `label: "end_of_day"`, `dataTime` newest `latest.date` across ok summaries, `source` `provenance[0]?.source ?? null`, `stale` any ok summary stale, `staleReason` as in history for the first stale code, `session: sessionMeta(clock, null)`, `provenance`: one `computedProvenance(["summaries"], source, newest date of that source's rows, "close", meta.stale)` per distinct source across the ok summaries' rows, in first-seen order (`groupBySource`).

## `get_metals` (changed)

- `data.egypt` gains `goldPound`, placed after `gold24k`: `{ buy, sell, unit: "EGP/piece", dataTime, dataTimeKind: "fetched", source }`, or `{ status: "not_available", reason: "not available from current sources" }` when the snapshot has no pound.
- `meta.stale` is true when Egypt retail is older than 26 hours or any spot is older than 72 hours. `meta.staleReason`: `Egypt retail prices fetched at <iso> are older than 26 hours.` when Egypt is stale, else `Spot prices dated <iso> are older than 72 hours.` with the oldest stale spot time.
- `session` stays `null`.

## `get_usd_egp` (changed)

- `meta.stale` is true and `meta.staleReason` is `The USD/EGP rate dated <iso> is older than 72 hours.` when `now - tt > 72 h`.

Words: `buy` and `sell` appear only as keys; no string value contains `buy`, `sell`, `hold` or `recommend` as a whole word (FR-011, 001 FR-050).
