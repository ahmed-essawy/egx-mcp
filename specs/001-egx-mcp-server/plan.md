# Implementation Plan: EGX MCP Server

**Branch**: `001-egx-mcp-server` (repository https://github.com/ahmed-essawy/egx-mcp, base `main`) | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-egx-mcp-server/spec.md`

## Summary

A public, stateless MCP server on Cloudflare Workers Free that answers questions about EGX stocks, indices, Egyptian funds, gold and USD/EGP from stored data only. Scheduled jobs pull from free sources (EGX website as primary when reachable, TradingView scanner as backup, Mubasher for funds, listings and corporate actions) into one KV snapshot and a D1 database. Users connect with Google OAuth (`workers-oauth-provider`) or dashboard API keys; per-user limits and global daily caps keep every resource under the free tier, so load is refused, never billed. History comes from a one-off local backfill of Mubasher's daily CSVs. Details: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 7.0.2 (type check), Node.js 24 LTS for tooling and the backfill script

**Primary Dependencies**: `agents` 0.30.1 (`createMcpHandler`, stateless Streamable HTTP), `@modelcontextprotocol/server` 2.3.1, `@cloudflare/workers-oauth-provider` 1.2.4, `zod` 4.6.7; dev: `wrangler` 4.152.0, `vitest` 4.1.12, `@cloudflare/vitest-pool-workers` 0.23.0

**Storage**: Cloudflare D1 (one database `egx`), KV namespace `DATA` (`snapshot:v1`, `directory:v1`, `stats:v1`), KV namespace `OAUTH_KV` (library-owned)

**Testing**: Vitest in the Workers pool: unit (domain), contract (each MCP tool through `SELF.fetch("/mcp")`), jobs (holiday, empty source, partial failure), integration (OAuth, keys, two-user isolation)

**Target Platform**: Cloudflare Workers Free plan, compatibility date 2026-10-01, flag `nodejs_compat`

**Project Type**: single web service (MCP server + small dashboard) plus one local script

**Performance Goals**: 95 percent of tool calls under 2 s (SC-004); snapshot at most 3 min behind the source in session (SC-003)

**Constraints**: 0 USD (constitution 2.1.0, IV); 10 ms CPU per request and per cron; 1,000 KV writes, 100,000 KV reads, 100,000 requests, 5M D1 rows read, 100k D1 rows written per day; 50 external subrequests and 50 D1 queries per invocation; no upstream call during a request

**Scale/Scope**: about 300 stocks, 5 indices, about 220 funds, 5 years of daily bars (about 375,000 rows), up to 15,000 tool calls per day (default global cap)

All unknowns are resolved in [research.md](research.md); items that could not be verified are tracked as risks there (S1 to S10, K1, K2, C1, T1), not as open clarifications.

## Free-tier budget (headline)

At the default global cap of 15,000 tool calls per day: KV writes at most 897 of 1,000 (snapshot 291 hard-bounded by the 09:55 to 14:45 window, OAuth hard-capped at 600), KV reads 75 percent, requests 31 percent, D1 rows read 72 percent (hard cap 3.5M), D1 rows written at most 97,000 of 100,000 on a backfill day and 61,000 on any other day, with every writer hard-bounded (accounting reserved for the full call cap 30,000, jobs reserve 16,000 including the daily purge of at most 5,400, adjustment recompute 10,000 checked atomically inside each adjustment batch, personal writes 5,000, backfill allowance 36,000 computed per file from today's live counters and the deployed caps, headroom 3,000; `loadConfig` refuses caps whose reserves pass 100,000), at most 40 D1 statements per end-of-day invocation (2 adjustment batches of 6 statements, notices in one statement), 30 per reference run and 30 per admin call, at most 20 external subrequests per invocation. Full table: [research.md R1](research.md#free-tier-budget-constitution-gate).

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1, against constitution 2.1.0 (amended 2026-10-25 after analyze round 1: Principle II scheduling rule scoped to snapshot fetches; Platform source list with fallback order). Re-evaluated after analyze round 2 (findings D5 to D8): the round 2 design before this fix would have FAILED III (bars adjusted before the ex date, raw derived from unapplied actions), I (queued actions unlabeled) and IV (rows-written cap not hard). Re-evaluated after analyze round 3: the round 3 design before this fix would have FAILED I (D12: the ex-date session compared with unadjusted 52-week values, unlabeled), III (D11: backfill rows could miss an action applied during the load; C20: an inverted ratio could not be undone) and IV (D10, C22: purges unbounded or slower than creation; D13: statement count growing with notices; D14: daily adjust cap a non-atomic pre-read; D15: any cap combination accepted). The column below is the result after the round 3 fix; the remaining round 3 findings are listed under Known open items.*

| Principle | Gate | Pre-research | Post-design |
|---|---|---|---|
| I. Honest delayed data | Every quote, index, NAV, metal price carries label, data time, source; "no data yet" kept | PASS | PASS: common envelope `meta` in [mcp-tools.md](contracts/mcp-tools.md); `no_data_yet`; global metals carry `tt`; iSagha prices carry the fetch time labeled as such; every pending bonus or split whose ex date has passed labels the bars before it (`adjustmentPending` or `rawPending` with state and reason) until it is applied (data-model invariant INV-6), also in tools that read a `stats:v1` built before the ex date (stats keep every unapplied action and tools filter by ex date at read time); a holiday missing from the calendar is reported as `closed` by every tool |
| II. Cache-only reads | Tools read KV/D1 only; snapshot as one JSON under one KV key; snapshot fetches only inside the session window on trading days; daily jobs at most once per day | PASS | PASS: `snapshot:v1`; snapshot cron gated by the 09:55 to 14:45 Cairo window and `market_calendar`; end-of-day job once per trading day after 15:30 Cairo, skipped entirely on a day the snapshot marked `noTradesToday`; reference job once per day; `directory:v1`, `stats:v1`, `snapshot:last-session` are daily read models, not per-symbol keys |
| III. Integrity and provenance | ISIN key; raw and adjusted stored; no deletes of history; source on every figure; computed ratios; backfill as local script | PASS | PASS: `daily_bars` raw + `adj_*` under the adjustment state machine in [data-model.md](data-model.md#adjustment-state-machine-bonus-split-reverse-split): an action is applied once (INV-1), only after its ex-date session is stored (INV-2), never during a symbol's backfill (INV-5: the loading flag is committed before the backfill reads the applied set, and every guard is re-checked in SQL by the batch's gate), and backfilled raw comes only from applied actions (INV-4), so no bar is adjusted early or twice; ratios are validated per kind and a wrong applied ratio is undone by `admin revert_action` under the same gate; `source` columns (with `+filled` for filled OHLC); ratios computed in `src/domain/ratios.ts`; `scripts/backfill/backfill.ts`. Pruning applies only to `market_events` (older than 400 days) and `usage_daily` (90 days), which are not historical market data. Open items that touch III: C19, C24, C26 (Known open items) |
| IV. Zero cost | Free tiers only, no payment method, refusal over billing, jobs sized to free tiers | PASS | PASS: budget table; global caps for calls, rows read, OAuth KV writes and personal D1 writes; the D1 rows-written total is hard: every writer has a cap or a worst-case reserve, `loadConfig` refuses caps whose reserves pass 100,000, and the backfill allowance is computed before each file from today's live counters and the deployed caps (at most 36,000 at defaults, 97,000 total); adjustment recompute capped at 10,000 rows per day inside each batch's transaction and 2 actions per end-of-day run; notices cost one statement per run (at most 40 D1 statements per end-of-day run); daily purges keep `market_events` within 400 days and need no purge for the K2 table; asserted by T122. Open items that touch IV: C23, C29, C31, and the `usage_daily` purge keeps 90 days only while new rows average at most 3,000 per day (research R1 Purges) |
| V. Secure multi-user access | OAuth via `workers-oauth-provider` with Google; keys from dashboard, shown once, SHA-256 + prefix + last used, revocable, max 3; per-user limits; usage recorded; no secrets in code or logs | PASS | PASS: [http-endpoints.md](contracts/http-endpoints.md); secrets (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) via `wrangler secret`, the public Google client id as the `GOOGLE_CLIENT_ID` var in `wrangler.jsonc` with `keep_vars: true` so dashboard variables survive a deploy; logs carry user id and tool name only |
| VI. Informational only | Facts only; no recommendations; no ticks; no push | PASS | PASS: `notice` field; notices are pull-only through `admin` |
| Platform: data sources | EGX primary while usable, TradingView backup; else TradingView primary and Mubasher backup; every stock value keeps a primary and a backup | PASS | PASS: `STOCK_PROVIDERS` default `egx,tradingview`, switched to `tradingview,mubasher` by the probe task when EGX fails |
| Platform: provider abstraction | Each source replaceable without changing tool I/O | PASS | PASS: `src/providers/types.ts` interfaces; tools never import a provider |
| Platform: Yahoo not used | | PASS | PASS |
| Workflow: tests per tool and per job case | | PASS | PASS: `tests/contract/*`, `tests/jobs/*` |

Result: **PASS** for the design with every round 3 in-scope finding fixed. The open items below are edge cases that the per-task reviews must close before the first public release (after US8); none is accepted as a violation, so Complexity Tracking stays empty.

## Known open items

From analyze round 3, out of scope for the planning fix round by owner decision; each is handled by the code review of the task that touches it.

- C19: backfill resume and rerun across a new CSV version of the same symbol.
- C21: account deletion is refused when the personal-write cap is reached.
- F19: read tools that call `saveCrossings` and the personal-write capacity. Decision: `portfolio_get` and `what_changed_since` are registered with `readOnly: true`, because the crossing state write is internal bookkeeping and not a user-visible change.
- C23: OAuth KV reads are not bounded for refused requests.
- C24: CSV validation does not detect corporate actions the source omitted.
- F20: wording drift between artifacts.
- E10: test for the dashboard key cap.
- C26: `ux_actions` drops a second bonus of the same symbol on the same ex date.
- C28: a backfill file that straddles 00:00 UTC.
- C29: consumers of the R1 rows-read budget.
- B5: no notice for a symbol stuck in the `loading` backfill state.
- C31: CPU fallback for the end-of-day job.
- G1: T068 needs a case that forces a statement of the apply batch to fail and asserts no row is left in `adjusting` and nothing was written.

## Project Structure

### Documentation (this feature)

```text
specs/001-egx-mcp-server/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── probe-results.json  (written by the probe task)
├── contracts/
│   ├── mcp-tools.md
│   ├── admin-tool.md
│   └── http-endpoints.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json
tsconfig.json
.gitignore
.nvmrc                         24
wrangler.jsonc                 bindings DB, DATA, OAUTH_KV, RATE_LIMITER; 4 crons; vars for limits
vitest.config.ts
worker-configuration.d.ts      generated by `wrangler types`
README.md                      FR-051
migrations/
├── 0001_initial.sql           all tables and indexes in data-model.md
└── 0002_usage_minute.sql      only if the Rate Limiting binding is unavailable (risk K2); one row per user, no purge
scripts/
├── probe/
│   ├── egx-probe.ts           one-off probe Worker (EGX, TradingView, Mubasher, iSagha, Rate Limiting)
│   └── wrangler.jsonc
├── backfill/
│   ├── backfill.ts            5-year corporate actions, Mubasher CSV download, validate, chunked load
│   ├── progress.json          git-ignored resume state
│   └── out/                   git-ignored generated SQL and validation report
└── check-readme.ts            README completeness check
src/
├── index.ts                   OAuthProvider export, outer fetch with OAuth KV guard, scheduled dispatch
├── config.ts                  parses env vars: limits, caps, OWNER_EMAILS, UNLIMITED_EMAILS, STOCK_PROVIDERS, SNAPSHOT_EVERY_MINUTES
├── auth/
│   ├── api-keys.ts            generate, hash, resolveExternalToken, 60 s positive memo
│   ├── google.ts              Google authorize URL, code exchange, ID token checks
│   └── session.ts             signed dashboard cookie, CSRF
├── http/
│   ├── routes.ts              route table for defaultHandler
│   ├── authorize.ts           consent page, Google callback
│   ├── dashboard.ts           keys, account delete
│   └── views.ts               HTML templates (escaped)
├── limits/
│   ├── usage.ts               pre-call checks and post-call accounting batch
│   └── oauth-guard.ts         OAuth KV write counter
├── mcp/
│   ├── server.ts              createServer, defineTool wrapper with auth context, scopes and limits
│   ├── tool-names.ts          the single list of tool names
│   ├── envelope.ts            meta, notice, errors
│   ├── resolve.ts             symbol and fund resolution on the directory
│   └── tools/
│       ├── search.ts
│       ├── quotes.ts          get_quotes
│       ├── market.ts          overview, indices, movers, 52w, sectors, daily summary
│       ├── history.ts         price history, compare
│       ├── funds.ts           fund, history, compare, real return
│       ├── fundamentals.ts    profile, dividends, actions, financials
│       ├── prices.ts          metals, usd/egp
│       ├── personal.ts        portfolio, levels, what changed
│       └── admin.ts
├── domain/
│   ├── calendar.ts            Cairo time, session window, holidays
│   ├── arabic.ts              normalizeArabic
│   ├── indices.ts             index codes, names, input aliases
│   ├── adjust.ts              adjustment factors, CSV parsing, backfill row values
│   ├── stats.ts               52-week range, average volume and period returns for stats:v1
│   ├── session-quotes.ts      quotes whose trade date is the snapshot session date
│   ├── budget.ts              D1 rows-written reserves, accounting rows per call, adjust batch overhead, backfillAllowance
│   ├── returns.ts             period returns, real return
│   ├── freshness.ts           stale rules
│   ├── levels.ts              price level crossing rule
│   └── ratios.ts              P/E, P/B, dividend yield
├── store/
│   ├── kv.ts                  snapshot, last-session, directory, stats, purge cursor
│   └── d1/
│       ├── symbols.ts
│       ├── bars.ts
│       ├── funds.ts
│       ├── inflation.ts
│       ├── fundamentals.ts
│       ├── calendar.ts        market_calendar reads and owner writes
│       ├── users.ts           users, api_keys
│       ├── personal.ts        holdings, price_levels
│       ├── events.ts          market_events, notices, discrepancies
│       ├── jobs.ts            job_state
│       └── usage.ts
├── providers/
│   ├── types.ts               StockQuoteProvider, IndexProvider, FxProvider, GlobalMetalsProvider, EgyptMetalsProvider, ListingProvider, FundNavProvider, CorporateActionProvider, FundamentalsProvider
│   ├── egx.ts                 only after the probe passes and a planner addendum
│   ├── tradingview.ts
│   ├── mubasher.ts
│   └── gold-egypt.ts          isaghaRetail
└── jobs/
    ├── dispatch.ts            cron string to job
    ├── snapshot.ts            also bootstraps a missing directory:v1 (job listing_bootstrap)
    ├── listing-sync.ts        shared listing sync, used by end-of-day and the snapshot bootstrap
    ├── end-of-day.ts          discovery (listingSync step), bars, indices, discrepancies, events, adjustments, stats
    ├── reference.ts           funds, NAVs, corporate actions, figures, metals and FX
    └── maintenance.ts
tests/
├── setup.ts                   applies D1 migrations
├── helpers/                   MCP client and seed helpers
├── unit/                      calendar (DST both sides), arabic, adjust, returns, ratios, freshness, levels, google, session, views
├── contract/                  one file per tool group in src/mcp/tools
├── jobs/                      holiday, empty source, partial failure, provider fallback, discovery
├── integration/               oauth flow, keys and revocation, limits and caps, two-user isolation, budget, no-upstream
└── fixtures/                  recorded provider payloads
```

**Structure Decision**: one Worker project at the repository root. Folders split by responsibility: `mcp/tools` (I/O contracts), `domain` (pure calculations, unit tested), `store` (all KV and D1 access, so query shapes live in one place), `providers` (one file per source behind the interfaces in `types.ts`, which removes the coupling between tools and sources that FR-049 forbids), `jobs` (scheduled work). No repository base classes, no DI container, no web framework.

## Key design decisions

1. **Stateless MCP, no Durable Objects**: `createMcpHandler` as `apiHandler` of `OAuthProvider`; tools are request and response only.
2. **Two auth paths, one identity**: OAuth tokens carry `props.userId`; API keys resolve to the same `userId` in `resolveExternalToken` and carry both scopes. Owner is matched by email from `OWNER_EMAILS`.
3. **Limits**: global caps (calls, rows read, OAuth KV writes) in `usage_global`; per-minute through the Rate Limiting binding (`period: 60`, `limit` 10); per-day through `usage_daily`. Settings are env vars (changed in the dashboard or `wrangler.jsonc`, no code change, FR-046a).
4. **Snapshot**: 1-minute cron inside 09:55 to 14:45 Cairo (inclusive), providers in `STOCK_PROVIDERS` order, write only on change, movers precomputed; a trading day with no trade today by the open plus 30 minutes is treated as closed by every tool and skipped by the end-of-day job (holiday missing from the table); at a 2-minute cadence the window-end minute always runs.
5. **Bulk writes**: `json_each(?)` upserts, one statement per table per job, including notices (`raiseNotices`, one statement per run); adjustment recompute as set-based `UPDATE`s under a daily cap; daily chunked purges in the reference job.
6. **Search**: in-memory over `directory:v1` with Arabic normalization; no D1 scan, no FTS5.
7. **Backfill**: local Node script: 5-year corporate actions first, then Mubasher CSV validated against stored closes, written in files sized to the allowance computed from today's live counters and the deployed caps (36,000 rows per UTC day at defaults), resumable; `symbols.adj_basis_date` and `backfill_state = 'loading'` are committed by their own statement before the script reads the symbol's applied actions and before its first row, and record what the CSV already includes.
8. **Corporate-action adjustment**: one state machine (`needs_ratio`, `recorded`, `applied`) with apply guards (ex-date session stored, symbol not loading, daily row cap) pre-checked on one read and re-checked in SQL by the gate statement of one 6-statement batch per apply (transient `adjusting` status, never committed), per-kind ratio validation, `admin revert_action` for a wrong applied ratio through the same batch, read-time pending labels, and eight invariants tested by T068, T070 and T102 ([data-model.md](data-model.md#adjustment-state-machine-bonus-split-reverse-split)).

## Questions for the owner

Both resolved by the owner on 2026-10-25.

- **Q1 Bonus and split ratios: RESOLVED (a)**. The owner sets each ratio with `admin set_action_ratio` after a `needs_ratio` notice. Until the action is applied (ratio entered, ex-date session stored, within the daily cap), adjusted history for that symbol is labeled as not yet adjusted for that action: responses carry `adjustmentPending` (or `rawPending` for backfilled bars the source already adjusted) and a `pendingAdjustments[]` list (see [data-model.md](data-model.md) corporate_actions and [mcp-tools.md](contracts/mcp-tools.md)).
- **Q2 Primary stock source: RESOLVED (a)**. Keep `STOCK_PROVIDERS=egx,tradingview`. The first implementation task is a probe of the EGX endpoints from a deployed Worker; if it fails, the default becomes `tradingview,mubasher` (TradingView primary, Mubasher backup, so FR-013 still holds) and the outcome is recorded in research.md. The snapshot job raises a `source_switched` notice on any day the backup serves.

## Complexity Tracking

Not needed: no constitution violations.
