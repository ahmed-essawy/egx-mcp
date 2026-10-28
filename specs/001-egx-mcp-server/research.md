# Research: EGX MCP Server

**Feature**: `001-egx-mcp-server` | **Checked**: 2026-10-25 (Sunday, an EGX trading day) | **Plan**: [plan.md](plan.md)

Confidence levels: **High** (official doc or live call returned the fact today), **Medium** (indirect evidence), **Low / Risk** (could not verify; listed in the Risks section, never assumed).

## R1. Cloudflare free-tier limits

Sources: developers.cloudflare.com pages `workers/platform/limits`, `kv/platform/limits`, `d1/platform/limits`, `d1/platform/pricing`, `durable-objects/platform/pricing`, `workers/runtime-apis/bindings/rate-limit`, changelog 2025-09-19 (rate limiting GA). Fetched 2026-10-25.

| Resource | Free limit | Confidence |
|---|---|---|
| Worker requests | 100,000 per day, reset 00:00 UTC, excess gets error 1027 (refused, not billed) | High |
| CPU time | 10 ms per HTTP request and 10 ms per Cron Trigger invocation | High |
| Cron Triggers | 5 per account | High |
| Subrequests | 50 external per invocation, 1,000 to Cloudflare services (KV, D1) | High |
| Memory | 128 MB per isolate | High |
| KV reads | 100,000 per day | High |
| KV writes | 1,000 per day to different keys, 1 per second to the same key | High |
| KV deletes / lists | Not listed on the limits page (commonly 1,000 per day each) | Risk K1 |
| KV value size | 25 MiB; key 512 bytes; minimum `cacheTtl` 30 s | High |
| KV storage | 1 GB | High |
| D1 rows read | 5,000,000 per day; queries fail after the limit, reset 00:00 UTC | High |
| D1 rows written | 100,000 per day; each index touched adds one row written | High |
| D1 storage | 500 MB per database, 5 GB per account, 10 databases | High |
| D1 queries per invocation | 50; bound parameters per query 100; SQL text 100 KB; row 2 MB | High |
| D1 FTS5 | Supported module | High |
| Durable Objects | Available on Free with SQLite backend only: 100,000 requests/day, 13,000 GB-s/day | High |
| Rate Limiting binding | GA since 2025-09-19, periods 10 s or 60 s, per location, approximate; config key `ratelimits`, Wrangler 4.36.0+. Free-plan availability not stated | Medium, Risk K2 |

- **Decision**: Workers Free, one Worker, one KV namespace for app data plus the `OAUTH_KV` namespace required by the OAuth library, one D1 database, one Rate Limiting binding for the per-minute limit, no Durable Objects.
- **Rationale**: Durable Objects are not needed once MCP runs stateless (R4). KV writes (1,000/day) and D1 rows written (100,000/day) are the binding limits, so the design keeps per-call writes in D1 at 2 rows and KV writes to scheduled jobs and OAuth only.
- **Alternatives considered**: Durable Object rate limiter (exact counts, but adds DO requests per call and a class to maintain); D1 per-minute bucket (adds 1 D1 write per call, kept as the fallback if K2 fails).

### Free-tier budget (constitution gate)

Assumptions: about 300 active stocks (TradingView scanner `egypt` returned `totalCount` 294 today), about 220 funds (Mubasher: 11 pages of 20), 2 HTTP requests per tool call on average (tool call plus amortized initialize/list), default global cap 15,000 tool calls per day.

| Resource (limit/day) | Consumers | Worst case per day | Share |
|---|---|---|---|
| Worker requests (100,000) | snapshot cron 420 (`* 6-12 * * SUN-THU`) + daily crons 4 + MCP 15,000 x 2 + dashboard/OAuth 1,000 | 31,424 | 31% |
| KV writes (1,000) | snapshot at most 291 (1 min cadence, window 09:55 to 14:45 inclusive = 291 runs, write only on change; the 14:45 run is the final one) + `snapshot:last-session` 1 + daily metals and FX merge into the snapshot 1 + stats 1 + directory 3 (2 plus one snapshot bootstrap write on a day the directory is missing) + purge cursor 1 (weekly) + OAuth guard 600 | 898 | 90% (hard caps) |
| KV reads (100,000) | snapshot, directory, stats: at most 3 per call (isolate memo 30 s lowers it) = 45,000; OAuth token lookups 2 per call = 30,000 | 75,000 | 75% |
| D1 rows read (5,000,000) | tool calls under the global rows-read cap 3,500,000; jobs: stats 75,000 + discovery, NAV, actions about 10,000 + daily purge at most 4,200 | 3,589,200 | 72% (hard cap) |
| D1 rows written (100,000) | accounting 2 per call (`ACCOUNTING_ROWS_PER_CALL`), reserved for the full call cap = 30,000; scheduled jobs reserve `JOBS_D1_ROWS_RESERVE` 16,000 (worst case at the input caps with write-on-change: end of day about 4,800, reference about 5,000, the reference job's daily purge at most 5,400 (1,200 `market_events` rows with their index = 2,400, plus 3,000 `usage_daily` rows), maintenance only its `job_state` rows: about 15,200 on a trading day, about 10,400 on other days; asserted by T122); adjustment recompute at most 10,000 (`ADJUST_MAX_ROWS_PER_DAY`, `usage_global.adjust_rows`, checked by the gate statement inside each adjustment batch, so concurrent end-of-day and admin applies cannot pass it); personal writes at most 5,000 (`PERSONAL_DAILY_ROWS`, `usage_global.personal_rows`: holdings, levels, crossings, key touches, key create and revoke, sign-ups, account deletion, admin writes); backfill at most the allowance below (36,000 at defaults); headroom 3,000, which also covers the OAuth guard counter (one `usage_global` upsert per guarded request, at most 600 because each guarded request costs at least 1 of the 600 OAuth KV write units) and the backfill's own counter upserts (1 per file, at most about 10 per day) | 97,000 on a backfill day, 61,000 on any other day | 97% (61%); every consumer hard-capped; `loadConfig` refuses caps whose reserves pass 100,000 |
| D1 storage (500 MB) | 5 years of bars (about 375,000 rows, about 40 MB), plus about 75,000 rows per year | under 60 MB | 12% |
| Cron triggers (5 per account) | 4 used | 4 | 80% |
| D1 queries (50 per invocation) | end-of-day job: bulk `json_each` statements, one `raiseNotices` per run whatever the number of notices, 1 apply-queue read and at most 2 adjustment batches of 6 statements, at most 40 (about 38 counted); reference job at most 30 (about 20 with the purge step and one `raiseNotices`); one admin call at most 30 (`apply_queued_actions` with 3 actions: auth and usage 4, candidates 1, 3 x 6, remaining 1, accounting 3 = 27) | 40 | 80% |
| External subrequests (50 per invocation) | snapshot: stocks 1 (2 on fallback) + indices 1 + FX and metals 1 + iSagha 2 every 15 minutes = 6; end of day: Mubasher listings at most 18 pages + TradingView listings 1 + backup closes 1 = 20; reference: funds at most 13 pages + actions 3 + fundamentals 1 + FX and metals 1 + iSagha 2 = 20 | max 20 | 40% |

- **Directory bootstrap**: the snapshot job runs the shared listing sync (job `listing_bootstrap`) on the first tick of a Cairo date while `directory:v1` is missing, before the window gate, so a fresh deploy answers search and quotes from 06:00 UTC instead of after the 15:30 Cairo end-of-day run. It is marked before it runs, so a failure is not retried the same date. On that day the listings are fetched twice (bootstrap plus end of day); this is the one accepted exception to the once-per-day rule for daily jobs, because the bootstrap is its own job and runs only while the directory is missing. It adds at most 19 subrequests (Mubasher 18 pages, TradingView 1) to one snapshot tick, 25 in total. A deploy on Friday or Saturday bootstraps on Sunday 06:00 UTC, the first tick after the deploy.
- **Snapshot cadence**: 1 minute with write-on-change. At 2 minutes the worst case is 143 writes, but 2 minutes plus up to 60 s of KV propagation can exceed the 3 minute target of SC-003. Cadence is a config value (`SNAPSHOT_EVERY_MINUTES`, 1 or 2). At 2 minutes the job skips odd Cairo minutes except the window-end minute (14:45, or 13:45 on a 13:30 special-hours day), which always runs so `snapshot:last-session` is written by the snapshot job.
- **Backfill allowance (hard, from today's live counters)**: the service is public from its first deploy, so there is no pre-launch exemption. Before each SQL file the local script reads today's `usage_global` row (`calls`, `adjust_rows`, `personal_rows`, `backfill_rows`) and the caps of the deployed Worker version (`npx wrangler deployments status --json`, then `npx wrangler versions view <id> --json`; dashboard edits are new versions, so local `wrangler.jsonc` values are never trusted) and computes `backfillAllowance` = min(`BACKFILL_MAX_ROWS_PER_DAY` - `backfill_rows`, 100,000 - `rowsPerCall` x max(`calls`, `GLOBAL_DAILY_CALLS`) - max(`adjust_rows`, `ADJUST_MAX_ROWS_PER_DAY`) - max(`personal_rows`, `PERSONAL_DAILY_ROWS`) - `JOBS_D1_ROWS_RESERVE` - `D1_WRITE_HEADROOM` - `backfill_rows`). `rowsPerCall` x `calls` is what today's calls already wrote and `rowsPerCall` x (`GLOBAL_DAILY_CALLS` - `calls`) is reserved for the rest of the day; the `max` terms keep a counter that already passed a lowered cap from being under-reserved. At defaults (2 rows per call, cap 15,000): 100,000 - 30,000 - 10,000 - 5,000 - 16,000 - 3,000 = 36,000 rows per UTC day, so `BACKFILL_MAX_ROWS_PER_DAY` defaults to 36,000. With the K2 fallback (3 rows per call, cap 12,000): 100,000 - 36,000 - 10,000 - 5,000 - 16,000 - 3,000 = 30,000. A file runs only when its estimated rows written (rows times 1 plus the secondary indexes touched: `daily_bars` 1, `corporate_actions` 4, `notices` 3, `symbols` 2) fit the allowance; after it runs, the script adds the `meta.rows_written` reported by `wrangler d1 execute --json` to `usage_global.backfill_rows`. About 375,000 bar rows plus the 5-year action load (about 5,000 actions, about 20,000 rows written with indexes), 395,000 rows, take about 11 UTC days (395,000 / 36,000).
- **Adjustment recompute**: each bonus or split rewrites the bars before its ex date (about 625 on average over 5 years, at most about 1,250). `applyAdjustment` adds its rows (the bars before the ex date plus 8 for the other rows of its batch) to `usage_global.adjust_rows` inside its batch, and the batch's gate statement refuses in the same transaction when the day's total would pass 10,000 (`ADJUST_MAX_ROWS_PER_DAY`); the action stays `recorded` and is labeled as queued. The end-of-day job applies at most 2 queued actions per run (`ADJUST_MAX_ACTIONS_PER_RUN`) so it stays at or under 40 D1 statements, and the owner can drain the queue faster with `admin apply_queued_actions` (at most 3 per call) up to the daily row cap. State machine and invariants: [data-model.md](data-model.md#adjustment-state-machine-bonus-split-reverse-split).
- **Personal writes**: every user-driven D1 write adds its `meta.rows_written` to `usage_global.personal_rows` in the existing accounting upsert; before the write the caller checks that the operation's worst case fits `PERSONAL_DAILY_ROWS` (5,000) and otherwise refuses with `capacity` (tools, dashboard, sign-up) or skips the write (`touchKey`).
- **Purges** (daily, in the reference job, inside `JOBS_D1_ROWS_RESERVE`): `market_events` older than 400 days, up to 1,200 rows per day, more than the jobs can create in one day (1,120), so the 400-day retention holds; `usage_daily` older than 90 days, up to 3,000 rows per day (21,000 per week against the few thousand rows per week expected), so the 90-day retention holds while new user-tool-day rows average at most 3,000 per day; above that rate deletion lags and the table grows by at most 12,000 rows (about 0.6 MB) per day, which the free D1 storage absorbs for about two years. `usage_daily` is keyed `(day, user_id, tool)` so the purge is a PK range seek. The K2 fallback table `usage_minute` holds one row per user, overwritten in place, and needs no purge.
- **Global caps** (owner config, refuse with "free service at capacity until 00:00 UTC"): 15,000 tool calls, 3,500,000 D1 rows read by tools, 600 OAuth KV writes, 5,000 D1 rows written by user-driven writes (`PERSONAL_DAILY_ROWS`). Unlimited users are counted against global caps (FR-046b). Config validation: `loadConfig` throws `invalid config: rows written budget` when `ACCOUNTING_ROWS_PER_CALL` x `GLOBAL_DAILY_CALLS` + `ADJUST_MAX_ROWS_PER_DAY` + `PERSONAL_DAILY_ROWS` + `JOBS_D1_ROWS_RESERVE` + `D1_WRITE_HEADROOM` > 100,000 (at the other defaults the largest call cap is (100,000 - 34,000) / 2 = 33,000, or 22,000 with the K2 fallback), when `ADJUST_MAX_ROWS_PER_DAY` < 1,500 (the largest action, about 1,250 bars plus 8, must fit in one day) and when `ADJUST_MAX_ACTIONS_PER_RUN` is outside 1..2 (end-of-day statement bound); a refused configuration fails every request, so a wrong dashboard edit refuses service instead of passing the free tier.
- **CPU 10 ms**: no per-request heavy work. The snapshot precomputes movers and breadth; daily stats are precomputed; JSON payloads are under 100 KB. Risk C1 covers measuring this.

## R2. EGX session times and timezone

Sources: EFG Hermes market information page, tradinghours.com/markets/egx, Amwal Al Ghad Ramadan notices (Feb 2026). No official EGX page could be opened from this environment (R3).

- **Facts found** (2026-10-25, Medium): Sunday to Thursday. Pre-open 08:30 to 10:00 (random cut-off 09:50 to 10:00), continuous trading 10:00 to 14:15, closing auction 14:15 to 14:30 (EFG Hermes). tradinghours.com lists 10:00 to 14:15 continuous. Ramadan 2026 used 10:00 to 13:30. Confidence Medium.
- **Decision**: session window 09:55 to 14:45 Africa/Cairo, both ends inclusive (5 minutes before the 10:00 open to 15 minutes after the 14:30 close, as constitution 2.1.0 Principle II defines it), Sunday to Thursday, skipping dates in `market_calendar` with kind `holiday`; rows with kind `special_hours` (Ramadan) move the window to `open_time` minus 5 minutes and `close_time` plus 15 minutes. Daily jobs run once per day outside the window (constitution 2.1.0): end of day at or after 15:30 Cairo on trading days only; reference data at 16:00 UTC every day (funds, metals and FX do not follow the EGX calendar).
- **Timezone**: crons are UTC; Egypt observes DST (UTC+3 from the last Friday of April to the last Thursday of October, otherwise UTC+2). The snapshot cron runs `* 6-12 * * SUN-THU` UTC and the handler gates on Cairo local time computed with `Intl.DateTimeFormat` and `timeZone: "Africa/Cairo"` (workerd ships ICU tzdata). Daily crons run hourly-tolerant: the handler checks it has not run for the Cairo date yet.
- **Alternatives**: hard-coded UTC hours (breaks twice a year); one cron per DST period (needs redeploys).

## R3. Data sources

Live probes on 2026-10-25 from the owner's desktop (not from a Worker, so Cloudflare egress may behave differently).

| Capability | Decision | Evidence today | Confidence |
|---|---|---|---|
| Stocks, primary | EGX website data endpoints (`egxProvider`), only if the deployed-Worker probe passes | `www.egx.com.eg` reset every TLS connection (curl and fetch); endpoints not inspected | Risk S1 |
| Stocks, backup if EGX passes, else primary | TradingView scanner `POST https://scanner.tradingview.com/egypt/scan` | Returned 294 instruments with name, ISIN, sector, open/high/low/close, change, volume, `Value.Traded`, `update_mode` `delayed_streaming_900` (15 min delay) | High (access), Risk S2 (terms) |
| Stocks, backup if EGX fails the probe | Mubasher `GET https://www.mubasher.info/api/1/stocks/prices/all?country=eg` (`mubasherStocks`) | Returned 396 rows: `code`, Arabic `name`, `value` (last), `change`, `changePercentage`, `open`, `high`, `low`, `volume`, `turnover`, `updatedAt` in UTC (`2026-10-25 11:29:51`, matching TradingView's 11:29:52 UTC); numbers are strings with `,` and `%`; no ISIN (mapped by ticker alias); delisted rows remain with old `updatedAt` (2024), so freshness uses `updatedAt` | High (access), Risk S2; reconfirmed from Cloudflare by the probe |
| Indices | TradingView `global/scan` tickers `EGX:EGX30`, `EGX:EGX30CAPPED`, `EGX:EGX70EWI`, `EGX:EGX100EWI` | All returned values; `EGX:EGX30USD` not found. The data time is `last_bar_update_time`: the index `update_time` was observed frozen for an hour while the value changed | High; EGX30 USD Risk S3 |
| USD/EGP | TradingView `FX_IDC:USDEGP`, the only source in the first release, labeled `market` (the spec does not use the CBE rate) | TradingView returned 55.25; `cbe.org.eg` returned "Request Rejected" (WAF) | High (TV), Risk S4 (CBE) |
| Gold, silver global | TradingView `TVC:GOLD`, `TVC:SILVER` (USD/oz), with `update_time` stored as the data time | Returned values | High |
| Gold, silver in Egypt (buy/sell per gram) | `isaghaRetail` (EgyptMetalsProvider) parsing iSagha: `https://market.isagha.com/prices` (gold) and `https://market.isagha.com/prices/silver` | Rechecked during `/speckit-tasks`: rows `tr[data-testid="prices-row"]` with `data-unit` (gold `14`, `18`, `21`, `22`, `24`, `pound`, `ounce`; silver `600`, `800`, `900`, `925`, `999`, `pound`, `s_ounce`); inside each row the `[data-testid="price-figure"]` values in order are sell, sell gap, buy, buy gap (21K in the captured fixture `tests/fixtures/isagha-gold.html`: sell 6300, buy 6255 EGP). No timestamp on the page, so the data time is the fetch time | High (access), Risk S2 (terms, markup changes) |
| Fund list and latest NAV | Mubasher `GET https://www.mubasher.info/api/1/funds?country=eg&page=N` | JSON, 11 pages x 20: `fundId`, Arabic name, owner/manager, `price` (NAV), `date` (Arabic month text), returns; `currency`, `classification` and English name are often null (stored when present, currency otherwise assumed EGP and flagged) | High |
| Fund NAV history before launch | None confirmed; history accrues daily from launch | Mubasher fund pages not probed for history | Risk S6 |
| Listing master, Arabic names, sector | Mubasher `GET /api/1/listed-companies?country=eg&page=N` (14 pages today, capped at 18) joined on ticker with TradingView `egypt/scan` (ISIN) | Both returned | High |
| Index membership, Nilex flag | None confirmed | | `index_codes` stays `[]` and the profile marks it not available; market defaults to `main` |
| Corporate actions (events, dates) | Mubasher `GET /api/1/corporate-actions?country=eg&page=N` for daily updates (pages 1 to 3), and `?country=eg&symbol=<TICKER>&page=N` for the one-off 5-year load in the backfill script (COMI: 4 pages) | Type (cash dividend, bonus, capital increase, name change), announced and effective dates; **ratio and amount missing** | High (dates), Risk S7 (ratios) |
| Dividend amounts | TradingView columns `dividend_amount_recent`, `ex_dividend_date_recent`, `ex_dividend_date_upcoming` | COMI returned amount 6 and ex date | High |
| Financial figures | TradingView columns `total_revenue_fy`, `net_income_fy`, `total_equity_fq`, `total_debt_fq`, `earnings_per_share_basic_ttm`, `total_shares_outstanding`, `float_shares_outstanding`, `fiscal_period_end` | COMI returned all except `fiscal_period_end` | High (access), Risk S2 |
| Company profile | TradingView (ISIN, sector, shares, float) plus Mubasher (Arabic name, sector); listing date not found | | Medium; listing date Risk S8 |
| 5-year backfill | Mubasher static CSV `https://static.mubasher.info/File.MubasherCharts/File.Historical_Stock_Charts_Dir/<hash>.csv`, URL taken from the stock page attribute `historical-data-url` | COMI file: 6,161 rows from 2001-05-15 to 2026-10-22, format `YYYY-MM-DD/00:00:00,o,h,l,c,v`; 2001 prices about 0.62 show the series is already adjusted. Checked over all 6,161 rows: column 1 equals the previous row's close in 4,256 rows and falls outside the day's high/low in 951 rows, so it is the reference price, not the open; columns 2, 3, 4, 5 are high, low, close, volume (high >= low in every row). Decision: open = column 1 clamped to [low, high] | High (access), Risk S9 (adjustment basis) |
| Investor statistics by investor type | EGX website only | Not reachable | Risk S1 |
| Disclosures | None confirmed (Mubasher announcement pages exist; no JSON endpoint found) | | Risk S10 |
| Inflation | Owner entry through the admin tool (CAPMAS monthly urban CPI) | `capmas.gov.eg` is a JS app; no fetch needed | High (by design) |
| Yahoo Finance | Not used (constitution) | | n/a |

Not available from current sources until a risk closes (tools return `not_available` with the reason): investor statistics by type and EGX30 USD (S1, S3); disclosures in "what changed" (S10); listing date (S8); index membership; fund history before launch and EGX30 fund comparisons before index history exists (S6); bonus and split ratios without owner confirmation (S7).

- **Decision on provider order**: config `STOCK_PROVIDERS` (default `egx,tradingview`). The snapshot job tries the first provider, falls back to the next on error, empty result or a stale trade date, records the source actually used per value, and raises one `source_switched` notice per day when the backup served. Owner decision Q2a: keep `egx,tradingview`; the first implementation task probes the EGX endpoints from a deployed Worker. If the probe fails, the default becomes `tradingview,mubasher` so a primary and a backup remain (FR-013); the probe outcome is recorded in this file, and no notice is raised at that point because the notices table does not exist yet.
- **Decision on corporate-action ratios (owner decision Q1a)**: Mubasher gives the event and dates. Cash dividend amounts come from TradingView. Bonus and split ratios are stored with `status = needs_ratio` and an operator notice; the owner sets the ratio with the admin tool, which triggers the adjustment recompute.
- **Adjustment basis for backfilled bars**: the Mubasher CSV is already adjusted for every action up to its download date. The backfill stores that date per symbol as `symbols.adj_basis_date` (the CSV's last session date) together with `backfill_state = 'loading'` with its own statement, committed before the script reads the symbol's applied actions and before any row. Backfilled rows (`raw_derived = 1`) keep the CSV prices as `adj_*` (times the factors of `applied` actions after the basis date); raw is derived only from `applied` actions with `ex_date <= adj_basis_date`. No action of the symbol is applied while it is loading, so the applied set cannot change across its files. A later apply of an action with `ex_date <= adj_basis_date` re-derives only the raw prices of backfilled rows; every other row gets `adj_*` multiplied. So no bar is adjusted twice. State machine and invariants: [data-model.md](data-model.md#adjustment-state-machine-bonus-split-reverse-split).
- **Pending labels**: every `needs_ratio` or `recorded` bonus, split or reverse split whose ex date is on or before today labels every bar before its ex date (`rawPending` for backfilled rows covered by the basis, `adjustmentPending` otherwise) with a state and reason; the label disappears only when the action is `applied`.
- **Wrong ratio recovery (C20)**: decision `admin revert_action`, not a documented SQL recovery, because hand-run SQL would bypass the apply gate (backfill loading, daily cap, once-only) that keeps INV-1 to INV-8 and the hard D1 cap, while the tool reuses the same gated batch with factor `1 / f`; per-kind ratio validation (bonus 0 to 10, split above 1, reverse split below 1) blocks the inversion error first.
- **Alternatives**: TradingView chart websocket for history (undocumented protocol, raw and adjusted both available; kept as a fallback, Q1); investing.com (bot protection); EGX historical pages (not reachable).

## R4. Stack and versions (npm registry, 2026-10-25)

| Package | Version | Note |
|---|---|---|
| Node.js (dev and backfill) | 24 LTS (`agents` requires >= 22) | Backfill runs as `node scripts/backfill/backfill.ts` (type stripping is on by default in Node 24), so no `tsx` dependency |
| TypeScript | 7.0.2 | Type check only (`tsc --noEmit`); bundling is Wrangler's esbuild |
| wrangler | 4.152.0 | `wrangler types` generates `worker-configuration.d.ts` (used instead of `@cloudflare/workers-types`) |
| agents | 0.30.1 | `createMcpHandler` from `agents/mcp/server`; stateless Streamable HTTP; no Durable Object. `McpAgent` is deprecated |
| @modelcontextprotocol/server | 2.3.1 (exact peer of agents 0.30.1; 2.4.0 is latest) | `McpServer`, tools with `inputSchema`/`outputSchema` |
| @cloudflare/workers-oauth-provider | 1.2.4 | `OAuthProvider` with `apiRoute: "/mcp"`, `apiHandler`, `defaultHandler`, `resolveExternalToken` (API keys), `beginUpstream`/`finishUpstream` (Google), `accessTokenTTL`, `refreshTokenTTL`, `purgeExpiredData()` |
| zod | 4.6.7 (server requires ^4.2.0) | Tool input and output schemas |
| vitest | 4.1.12 (pool requires ^4.1.0; 5.x is not supported) | |
| @cloudflare/vitest-pool-workers | 0.23.0 | Runs tests in workerd with KV, D1 and cron bindings |

- **Decision**: no web framework (about 10 HTTP routes, a small route table is enough), no ORM (D1 prepared statements), no Durable Objects.
- **OAuth**: Google upstream through the library's upstream helpers; consent page owned by the app. `accessTokenTTL` 86,400 s (cuts refresh writes to about 2 KV writes per active OAuth user per day), `refreshTokenTTL` 30 days default. KV writes per first sign-in: about 4 (client registration 1, grant 1, code exchange 2).
- **OAuth KV write guard**: the outer `fetch` counts expected writes for `/register` (1), the authorize completion (1) and `/token` (2) in `usage_global.oauth_kv_writes` before delegating, and refuses with HTTP 503 and `Retry-After` once the 600 cap is hit, so OAuth can never starve the snapshot.
- **API keys**: accepted as `Authorization: Bearer egx_...` on `/mcp` through `resolveExternalToken`, validated in D1 (no KV).
- **Arabic search**: `normalizeArabic` removes tashkeel and tatweel, maps أ إ آ ٱ to ا, ى and ئ to ي, ؤ to و, ة to ه, drops ء, maps Arabic-Indic digits to ASCII, lowercases Latin, collapses spaces. The discovery job writes a precomputed directory (normalized names, tickers, ISINs, aliases, funds) to KV key `directory:v1`; search runs in memory on it. **FTS5 rejected**: about 520 entities fit in memory, FTS5 does not tokenize Arabic variants anyway, and every D1 search would cost rows read against the 5M budget. D1 `LIKE` scan rejected for the same budget reason.
- **Tests**: Vitest in the Workers pool; contract tests per tool, job tests for holiday, empty source and partial failure (constitution), access tests across two users.

## R5. Revocation and cache TTLs

- **Decision**: API keys are looked up in D1 by SHA-256 hash on every request (unique index, 1 row read). A per-isolate memo keeps a positive result for at most 60 s; revoked keys are never cached. D1 has no read replicas enabled, so a revoke is visible to the next uncached lookup. Worst case 60 s, inside the 2 minute target (FR-044).
- **Rejected**: caching keys in KV (writes per key, plus up to 60 s propagation on top of any TTL, and no guaranteed upper bound).
- **Snapshot reads**: `KV.get("snapshot:v1", { type: "json", cacheTtl: 30 })` plus a 30 s per-isolate memo. Worst lag: cadence 1 min plus KV propagation up to 60 s, under SC-003's 3 minutes.
- **Directory and stats**: `cacheTtl` 300 s and memo 300 s (written once a day).
- **OAuth tokens**: validated by the library from `OAUTH_KV`; account deletion revokes grants with the library helpers (eventual, up to 60 s). The `/mcp` handler also checks `users.deleted_at` through the same D1 batch as the usage check.

## Risks (could not verify)

| ID | Risk | Effect | Mitigation |
|---|---|---|---|
| S1 | EGX website reset connections from here; endpoints unknown | Primary source may not work; investor statistics unavailable | The first task is a probe from a deployed Worker; if it fails, `STOCK_PROVIDERS` becomes `tradingview,mubasher` and the outcome is recorded here (Q2a, resolved) |
| S2 | TradingView, Mubasher are unofficial; terms may forbid reuse; may block Worker IPs | Loss of a source | Provider abstraction; README states sources; failures raise notices |
| S3 | EGX30 USD not on TradingView | Index answer `not_available` | EGX provider if S1 closes |
| S4 | CBE site rejects automated requests | Official USD/EGP missing | TradingView rate labeled as market rate |
| S5 | iSagha markup may change or block Worker IPs (markup confirmed from desktop) | Gold and silver buy/sell `not_available` | The probe task fetches iSagha from Cloudflare; a parse failure raises a `job_failed` notice; global spot is always served |
| S6 | No fund NAV history before launch | 1M, 3M, 1Y unavailable until history accrues | Spec scenario 4.2 behavior |
| S7 | Corporate action ratios missing in Mubasher | Adjusted prices incomplete until the owner sets ratios | `needs_ratio` notices; affected values flagged `adjustmentPending` (Q1a, resolved) |
| S8 | Listing date source unknown | Profile field empty with reason | Use first trade date in Mubasher CSV as "first trade date" |
| S9 | Mubasher CSV adjustment basis assumed; column 1 is a reference price, not the open | Backfill accuracy | Validation step: each symbol's CSV close for the newest session already in `daily_bars` (written by the EOD job) must match within 0.5 percent, otherwise that symbol is skipped and listed |
| S10 | No disclosure source | "what changed" omits disclosures with a reason | Later source |
| K1 | KV delete/list free limits not on the page | Purge job | Purge weekly in batches of at most 500 |
| K2 | Rate Limiting binding on Free not stated | Per-minute limit | Fallback: D1 minute bucket `usage_minute`, one row per user overwritten in place (1 more write per served call, none for a refused call, no purge; global cap drops to 12,000) |
| K3 | Shape of `wrangler versions view --json` (whether it lists `plain_text` vars) not verified | Backfill cannot read the deployed caps | The backfill stops with a message when a cap var is missing from the output; the planner then names another read path |
| C1 | 10 ms CPU per request and per cron | Errors on heavy calls | Precompute in jobs; CPU of tools and of the snapshot, end-of-day and reference jobs measured with `wrangler tail`; no call parses more than 100 KB |
| T1 | Egypt DST rules in workerd tzdata | Wrong window twice a year | Unit tests with fixed dates on both sides of the 2026 switch |
