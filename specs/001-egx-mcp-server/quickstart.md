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
(set GOOGLE_CLIENT_ID in the vars of wrangler.jsonc, it is a var and not a secret)
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler d1 migrations apply egx --local
npx wrangler d1 migrations apply egx --remote
npm run typecheck
npm test
npx wrangler dev --test-scheduled
```

Expected: tests pass (the test config pins the Miniflare compatibility date to 2026-08-22 so the Workers pool starts with the bundled `workerd`; production keeps `wrangler.jsonc` 2026-10-01, T127); `curl "http://localhost:8787/__scheduled?cron=*+6-12+*+*+SUN-THU"` writes `snapshot:v1` during the Cairo window and logs `skipped: outside window` otherwise.

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
5. In a local test snapshot in KV (`snapshot:v1`), set a quote trade date 3 sessions back. Expected: `stale: true` with the data date.
6. Insert a `pending` symbol with no quote. Expected: `status: no_data_yet`.
7. Revoke the key, wait 60 s, call again. Expected: `unauthorized` within 2 minutes.

## Story 2: market overview (P1)

During and after trading hours call `get_market_overview` and `get_indices` with `["EGX30","EGX30CAPPED","EGX30USD","EGX70EWI","EGX100EWI"]`. Expected: status open or closed, breadth, movers, totals with time and source; `EGX30USD` returns `not_available` unless the EGX provider supplies it; after close the answer names the session date. Holiday missing from the calendar: on a trading day with no `market_calendar` row and a test snapshot whose quotes all have an older `td`, call `get_market_overview` after the open plus 30 minutes. Expected: `status: closed` (from `session.noTradesToday`), and that day's end-of-day run fetches nothing and writes nothing.

## Story 3: history and comparisons (P2)

Steps 1 to 3 are owner steps against the remote D1.

1. Backfill: after at least one `endOfDayJob` run, `node scripts/backfill/backfill.ts --validate` compares each symbol's CSV close for the newest session in `daily_bars`. Expected: matches within 0.5 percent; mismatching symbols are listed and skipped.
2. `node scripts/backfill/backfill.ts --actions --years 5`, then `node scripts/backfill/backfill.ts --years 5`. Expected: corporate actions for 5 years are loaded first (bonus and split as `needs_ratio`); before each file the script prints the allowance computed from today's `usage_global` counters and stops when the next file would not fit (at most 36,000 rows per UTC day at default caps, computed with the caps of the deployed Worker version); the progress file advances; rerun resumes; `symbols.adj_basis_date` and `backfill_state = 'loading'` are set by their own statement before the script reads the symbol's applied actions and before its first row and `backfill_state = 'done'` after its last.
3. For a backfilled symbol with a `needs_ratio` bonus before its `adj_basis_date`, `get_price_history`. Expected: those bars show `rawPending: true` and `adjustmentPending: false` with the reason "awaiting the owner's ratio"; after `admin set_action_ratio` the action is `applied`, the adjusted prices are unchanged and the raw prices before the ex date are divided by the factor. Then `admin set_action_ratio` for an action whose ex date is after the latest stored session. Expected: `status: recorded`, `rowsAdjusted: 0`, `refusedReason: ex_date_not_reached`, the `needs_ratio` notice stays open; after the end-of-day run on the ex date the action is `applied`, the notice is `done` and `adjClose` is continuous across the ex date.
4. For a symbol with a recorded bonus in the past year, `get_price_history` `series: both`. Expected: `adjClose` shows no drop at the ex date, `close` shows the traded prices.
5. `compare_symbols` with 3 tickers over 6 months. Expected: one item per symbol with return, high, low, volume over the common period.
6. Request a range before `earliestAvailable`. Expected: the response states the earliest date.
7. `get_movers`, `get_52_week_range` for COMI and `get_sector_performance`. Expected: answers computed from the snapshot and `stats:v1` with no D1 read; `adjustmentPending: true` on a symbol with an unapplied bonus or split whose ex date has passed.

## Story 4: funds (P2)

1. Trigger `referenceJob` locally. Expected: `funds` and `nav_records` filled from Mubasher.
2. `get_fund` for a weekly fund midweek. Expected: last NAV with its own date, `stale: false`.
3. `get_fund` 1-year performance for a fund with under a year of history. Expected: `not_available` with the longest period.
4. `compare_funds` with an EGP fund and a USD fund. Expected: each in its own currency, `currenciesDiffer: true`.
5. `admin set_inflation` for the needed months, then `get_real_return`. Expected: nominal, inflation and real returns.
6. `get_fund_history` for a fund over a range longer than 500 NAVs, following the cursor. Expected: pages of at most 500 rows in date order and `earliestAvailable` naming the first stored NAV.

## Story 5: portfolio and what changed (P3)

1. `portfolio_upsert_holding` twice, `price_level_set` below the current price.
2. Lower the snapshot price below the level (test snapshot). Call `what_changed_since` for yesterday. Expected: the crossing appears once with its detection time; a second call does not repeat it.
3. `portfolio_get`. Expected: value, gain per holding and total, allocation by sector.
4. With a second Google account, call `portfolio_get` and pass the first user's holding id to `portfolio_remove_holding`. Expected: empty portfolio and `not_found` (SC-011).

## Story 6: fundamentals (P3)

`get_financials` for COMI. Expected: revenue and net income with period, currency, source; P/E computed from the snapshot price with inputs shown. For a symbol with no figures: `not_computable` with the reason. `get_dividends` for the next 90 days shows amount and dates. `get_company_profile` for COMI. Expected: the contract fields with `firstTradeDate`, `indexCodes: []` and `meta.notAvailable` naming `listingDate` and `indexMembership`. `get_corporate_actions` for a symbol with a Mubasher bonus. Expected: every kind listed, the bonus as a `needs_ratio` item with `ratio: null`.

## Story 7: discovery and notices (P3)

1. Delete one symbol row in local D1, run `endOfDayJob`. Expected: the symbol returns as `pending` and `admin list_notices` shows a `new_listing` notice.
2. Make a provider throw (test double). Expected: one `job_failed` notice naming job, source and time; the previous snapshot stays.
3. Call `admin` as a non-owner. Expected: `forbidden` with `meta.label = owner_entered`.
4. Remove one active symbol from both listing fixtures and run `endOfDayJob` on 5 trading days. Expected: `missing_sessions` rises by 1 per trading day and the symbol becomes `inactive` on the fifth, keeping its `daily_bars`; a holiday run and a run where a listing source fails do not count; when the symbol reappears it returns to `active` with `missing_sessions` 0. A snapshot `listing_bootstrap` run never changes `missing_sessions`.

## Story 8: public access and limits (P4)

1. From Claude or ChatGPT add the server URL without a key. Expected: Google sign-in, consent page, then tools work as that user.
2. Create 3 keys, try a 4th. Expected: refused.
3. Call 11 tools in one minute with a normal user. Expected: `rate_limited` with a retry time. Repeat as an `UNLIMITED_EMAILS` user: served.
4. Set `OAUTH_DAILY_KV_WRITES=6` locally (one full first sign-in costs 6: `/register` 1, `GET /authorize` 1, `POST /authorize` 1, `/callback/google` 1, `/token` 2) and sign in twice with a new client. Expected: the first flow completes; the first guarded request of the second flow (`/register`, or `GET /authorize` when the client reuses its registration) gets `503` with `Retry-After` to 00:00 UTC.
5. Account deletion: at `/dashboard`, submit "Delete account" with the account email in the confirm field. Expected: the holdings, levels, keys, usage rows and the user are removed, the OAuth grants are revoked, the session ends with "Account deleted", and a later `/mcp` call with the old key or OAuth token gets `unauthorized`. The privacy page describes this button, not deletion by email.
6. Read-only scope: authorize a client that requests only `mcp:read`. Expected: `search`, `portfolio_get` and `what_changed_since` are served; `portfolio_upsert_holding`, the other personal write tools and `admin` return `forbidden`, with nothing written and no usage row.

## Story 9: gold, silver, dollar (P4)

`get_metals` and `get_usd_egp`. Expected: values with time and source; Egypt gold 18K, 21K, 24K and silver 925, 999 buy/sell per gram from iSagha with the fetch time; USD/EGP labeled `market` when it comes from TradingView.

## Story 10: README (P1)

A person who has not seen the project follows `README.md` on a clean Windows machine and reaches a first tool call in under 30 minutes (SC-009). Check every section listed in FR-051 exists, including troubleshooting for source outage, blocked requests and stale data.
