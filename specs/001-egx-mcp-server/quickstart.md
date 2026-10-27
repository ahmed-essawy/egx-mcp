# Quickstart: validation scenarios

**Plan**: [plan.md](plan.md) | Contracts: [mcp-tools.md](contracts/mcp-tools.md), [http-endpoints.md](contracts/http-endpoints.md), [admin-tool.md](contracts/admin-tool.md) | Data: [data-model.md](data-model.md)

## Prerequisites

- Windows 11, Node.js 24 LTS, Git, a free Cloudflare account with no payment method attached, a Google Cloud OAuth client (web) with redirect URIs `https://<worker>/callback/google` and `https://<worker>/dashboard/callback`, and `http://localhost:8787/...` for local runs.
- An MCP client: Claude (custom connector), ChatGPT (connector) or Cursor (`mcp.json`), or MCP Inspector (`npx @modelcontextprotocol/inspector`).

## Setup

```text
npm ci
npx wrangler login
npx wrangler d1 create egx
npx wrangler kv namespace create DATA
npx wrangler kv namespace create OAUTH_KV
(put the ids in wrangler.jsonc)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler d1 migrations apply egx --local
npx wrangler d1 migrations apply egx --remote
npm run typecheck
npm test
npx wrangler dev --test-scheduled
```

Expected: tests pass; `curl "http://localhost:8787/__scheduled?cron=*+6-12+*+*+SUN-THU"` writes `snapshot:v1` during the Cairo window and logs `skipped: outside window` otherwise.

## Scenario 0: free-tier guard (constitution IV)

1. In the Cloudflare dashboard, confirm the account plan is Workers Free and Billing shows no payment method.
2. Set `GLOBAL_DAILY_CALLS=3` in a local `.dev.vars`, call any tool 4 times. Expected: the 4th returns `capacity` with a retry time at 00:00 UTC, even for an `UNLIMITED_EMAILS` user.
3. `npx wrangler tail --format json` during a session: snapshot, end-of-day and reference job runs and `get_market_overview`, `get_quotes` (20 symbols), `search` calls. Expected: CPU time under 10 ms for each; 95 percent of tool calls under 2 s wall time (SC-004).
4. During the session compare `snapshot:v1` `generatedAt` and the newest `tt` with the TradingView scanner `update_time` for 5 symbols. Expected: at most 3 minutes behind (SC-003).
5. Call `get_quotes` in pages of 20 over every active symbol in `directory:v1`. Expected: each returns a quote or `no_data_yet` (SC-001).

## Story 1: stock quote (P1)

1. Sign in at `/dashboard`, create a key; copy it (shown once). Reload: only the prefix remains.
2. Add the server to an MCP client with header `Authorization: Bearer <key>`.
3. Ask "What is the price of CIB?" and "سعر سهم البنك التجاري الدولي". Expected: both resolve to COMI, show price, change, volume, `meta.label = delayed`, `dataTime`, `source`.
4. `search` with `اسمنت` and `أسمنت`. Expected: the same results (normalization).
5. In a local D1, set a quote trade date 3 sessions back in a test snapshot. Expected: `stale: true` with the data date.
6. Insert a `pending` symbol with no quote. Expected: `status: no_data_yet`.
7. Revoke the key, wait 60 s, call again. Expected: `unauthorized` within 2 minutes.

## Story 2: market overview (P1)

During and after trading hours call `get_market_overview` and `get_indices` with `["EGX30","EGX30CAPPED","EGX30USD","EGX70EWI","EGX100EWI"]`. Expected: status open or closed, breadth, movers, totals with time and source; `EGX30USD` returns `not_available` unless the EGX provider supplies it; after close the answer names the session date. Holiday missing from the calendar: on a trading day with no `market_calendar` row and a test snapshot whose quotes all have an older `td`, call `get_market_overview` after the open plus 30 minutes. Expected: `status: closed` (from `session.noTradesToday`), and that day's end-of-day run fetches nothing and writes nothing.

## Story 3: history and comparisons (P2)

1. Backfill: after at least one `endOfDayJob` run, `node scripts/backfill/backfill.ts --validate` compares each symbol's CSV close for the newest session in `daily_bars`. Expected: matches within 0.5 percent; mismatching symbols are listed and skipped.
2. `node scripts/backfill/backfill.ts --actions --years 5`, then `node scripts/backfill/backfill.ts --years 5`. Expected: corporate actions for 5 years are loaded first (bonus and split as `needs_ratio`); before each file the script prints the allowance computed from today's `usage_global` counters and stops when the next file would not fit (at most 36,000 rows per UTC day at default caps, computed with the caps of the deployed Worker version); the progress file advances; rerun resumes; `symbols.adj_basis_date` and `backfill_state = 'loading'` are set by their own statement before the script reads the symbol's applied actions and before its first row and `backfill_state = 'done'` after its last.
3. For a backfilled symbol with a `needs_ratio` bonus before its `adj_basis_date`, `get_price_history`. Expected: those bars show `rawPending: true` and `adjustmentPending: false` with the reason "awaiting the owner's ratio"; after `admin set_action_ratio` the action is `applied`, the adjusted prices are unchanged and the raw prices before the ex date are divided by the factor. Then `admin set_action_ratio` for an action whose ex date is after the latest stored session. Expected: `status: recorded`, `rowsAdjusted: 0`, `refusedReason: ex_date_not_reached`, the `needs_ratio` notice stays open; after the end-of-day run on the ex date the action is `applied`, the notice is `done` and `adjClose` is continuous across the ex date.
4. For a symbol with a recorded bonus in the past year, `get_price_history` `series: both`. Expected: `adjClose` shows no drop at the ex date, `close` shows the traded prices.
5. `compare_symbols` with 3 tickers over 6 months. Expected: one item per symbol with return, high, low, volume over the common period.
6. Request a range before `earliestAvailable`. Expected: the response states the earliest date.

## Story 4: funds (P2)

1. Trigger `referenceJob` locally. Expected: `funds` and `nav_records` filled from Mubasher.
2. `get_fund` for a weekly fund midweek. Expected: last NAV with its own date, `stale: false`.
3. `get_fund` 1-year performance for a fund with under a year of history. Expected: `not_available` with the longest period.
4. `compare_funds` with an EGP fund and a USD fund. Expected: each in its own currency, `currenciesDiffer: true`.
5. `admin set_inflation` for the needed months, then `get_real_return`. Expected: nominal, inflation and real returns.

## Story 5: portfolio and what changed (P3)

1. `portfolio_upsert_holding` twice, `price_level_set` below the current price.
2. Lower the snapshot price below the level (test snapshot). Call `what_changed_since` for yesterday. Expected: the crossing appears once with its detection time; a second call does not repeat it.
3. `portfolio_get`. Expected: value, gain per holding and total, allocation by sector.
4. With a second Google account, call `portfolio_get` and pass the first user's holding id to `portfolio_remove_holding`. Expected: empty portfolio and `not_found` (SC-011).

## Story 6: fundamentals (P3)

`get_financials` for COMI. Expected: revenue and net income with period, currency, source; P/E computed from the snapshot price with inputs shown. For a symbol with no figures: `not_computable` with the reason. `get_dividends` for the next 90 days shows amount and dates.

## Story 7: discovery and notices (P3)

1. Delete one symbol row in local D1, run `endOfDayJob`. Expected: the symbol returns as `pending` and `admin list_notices` shows a `new_listing` notice.
2. Make a provider throw (test double). Expected: one `job_failed` notice naming job, source and time; the previous snapshot stays.
3. Call `admin` as a non-owner. Expected: `forbidden`.

## Story 8: public access and limits (P4)

1. From Claude or ChatGPT add the server URL without a key. Expected: Google sign-in, consent page, then tools work as that user.
2. Create 3 keys, try a 4th. Expected: refused.
3. Call 11 tools in one minute with a normal user. Expected: `rate_limited` with a retry time. Repeat as an `UNLIMITED_EMAILS` user: served.
4. Set `OAUTH_DAILY_KV_WRITES=2` locally and sign in twice. Expected: the second flow gets `503` with `Retry-After`.

## Story 9: gold, silver, dollar (P4)

`get_metals` and `get_usd_egp`. Expected: values with time and source; Egypt gold 18K, 21K, 24K and silver 925, 999 buy/sell per gram from iSagha with the fetch time; USD/EGP labeled `market` when it comes from TradingView.

## Story 10: README (P1)

A person who has not seen the project follows `README.md` on a clean Windows machine and reaches a first tool call in under 30 minutes (SC-009). Check every section listed in FR-051 exists, including troubleshooting for source outage, blocked requests and stale data.
