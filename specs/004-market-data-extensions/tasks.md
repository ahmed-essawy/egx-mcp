# Tasks: Market data extensions (replanned onto `main` 70fd4d1)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/mcp-tools.md](contracts/mcp-tools.md).

- Repo: `D:/Work/egx-mcp.pipeline/market-data-extensions-2` (branch `pipeline/market-data-extensions`) for every task. One repo, so no task is `[P]`. Order is strict.
- One task per implementer dispatch. Every task is test-first: write or pick the test, run it and see it fail for the stated reason (Workers-pool tests: see them typecheck), then implement, then verify.
- Commit per task: `wip(004): T0NN <imperative summary>`, explicit paths. Delivery is one squash commit (`deliver: squash-local`) without AI attribution.

**HARD RULES (repeat in every implementer and reviewer prompt)**:
- Never run `npm test`, any Workers-pool vitest, `wrangler dev`, `wrangler deploy`, any `--remote` wrangler command, the backfill script, the probe, or any request to a data provider.
- Verify with `npm run typecheck` and the runs in plan.md "Verification". Baseline: typecheck clean, the Node project and the whole suite fully green (1175 tests on `main`, no known failures); any failure is new.
- No comments in code, no em dash, en dash or double hyphen as punctuation in any text, no AI attribution, named constants for literals, stage by explicit path, never stage `.claude/`, `CLAUDE.md` or `.specify/`, never amend, reset or push.
- Designs are in plan.md "Design (exact)" and the contract; do not invent beyond them. Record any forced change under "Deviations noted" in the report.

## Phase 1: Setup and test harness

- [x] T001 Cherry-pick the probe URL and restore the EGX 30 fixture.
  - Run `git cherry-pick 7dd0041`, then `git show e401e10 -- tests/fixtures | git apply` and commit `tests/fixtures/mubasher-index-EGX30.csv` and `tests/fixtures/README.md`.
  - Test: none (no behavior); the fixture is exercised in T015.
  - Acceptance: `scripts/probe/egx-probe.ts` lists the `getIndexChartData` URL last in `EGX_URLS`; the fixture has 300 lines; the fixtures README has its row; typecheck clean; Node-pool run equals the baseline.

- [x] T002 Node MCP harness.
  - Files: `tests/helpers/node-mcp.ts` (new), `tests/unit/node-mcp.test.ts` (new), `tests/helpers/sqlite-d1.ts` (only if needed).
  - Test first (`tests/unit/node-mcp.test.ts`, fails because the helper is missing):
    - `listNodeTools(createNodeStores().env)` returns the 28 names listed in `tests/unit/server.test.ts`, in that order.
    - `callNodeTool(env, "search", { query: "COMI" })` with an empty KV returns `isError` falsy, `data.results` `[]`, `meta.notAvailable[0].field` `"directory"`.
    - After `putJson(stores, "directory:v1", <directory with COMI>)`, the same call returns one stock result with ticker `COMI`.
    - `callNodeTool(env, "get_quotes", { symbols: ["COMI"] })` with the directory but no snapshot returns `ok` with `meta.notAvailable` naming `snapshot`.
    - Two `createNodeStores()` calls do not share KV or D1 state.
  - Implement per plan.md "Node MCP harness".
  - Acceptance: the new test passes; typecheck clean; Node project and whole suite stay green.

## Phase 2: Provenance (US3)

- [x] T003 [US3] Provenance envelope with placeholders.
  - Run `git show 236f033 -- src/mcp/envelope.ts src/mcp/output-schema.ts src/mcp/provenance.ts tests/unit/provenance.test.ts tests/unit/envelope.test.ts | git apply --3way` and resolve any conflict in favor of `main`'s code plus the added provenance lines.
  - Test first: extend `tests/unit/envelope.test.ts`: `ERROR_META` gains `provenance: []`; `fail(...)` meta has `provenance: []`; `metaSchema.parse` accepts an entry with `timeKind: "period"` and rejects `fields: []`. The picked `tests/unit/provenance.test.ts` (4 cases) must be seen failing before `provenance.ts` is applied, or note it was applied in the same step.
  - Implement: `TimeKind` adds `"period"` (type and schema); `errorMeta` returns `provenance: []`; add `provenance: []` to every `Meta` literal listed in plan.md "Provenance".
  - Acceptance: tests pass; typecheck clean; `tests/unit/node-mcp.test.ts` still passes; Node project and whole suite stay green.

- [x] T004 [US3] Pure provenance builders.
  - Files: `src/mcp/provenance.ts`, `tests/unit/provenance.test.ts`.
  - Test first (fails on missing exports):
    - `quoteProvenance(["quotes"], [q1 tradingview tt A, q2 mubasher tt B, q3 tradingview tt C > A], "tradingview", clock)` gives 2 entries in order tradingview, mubasher; tradingview `dataTime` `toCairoIso(C)`, basis `primary`; mubasher basis `backup`; a group with a quote whose `td` is 3 sessions old is `stale: true`; `[]` for no quotes.
    - `indexProvenance(["indices"], [])` is `[]`; two entries with the same `src` give one entry with the newest `tt`.
    - `closeProvenance(["bars"], [{ date: "2026-10-20", source: "tradingview" }, { date: "2026-10-22", source: "tradingview+filled" }, { date: "2026-10-21", source: "tradingview" }], true)` gives `tradingview` (dataTime `2026-10-21`, basis `primary`, stale true) then `tradingview+filled` (basis `computed`).
    - `computedProvenance(["x"], "s", null, "period", false)` equals `{ fields: ["x"], source: "s", dataTime: null, timeKind: "period", stale: false, basis: "computed" }`.
    - The 5 source constants have the contract values.
  - Implement per contract "Builders".
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T005 [US3] Provenance for `search` and `get_quotes`.
  - Files: `src/mcp/tools/search.ts`, `src/mcp/tools/quotes.ts`, `tests/unit/tool-provenance.test.ts` (new).
  - Test first (Node harness, fails on the `[]` placeholders):
    - `search` with a directory: one computed `results` entry, source `directory`, `timeKind` `fetched`, `dataTime` `toCairoIso(builtAt)`.
    - `search` with no directory key, and with an empty directory (`symbols: []`, `funds: []`): `[]` both (G2).
    - `get_quotes` primary: one entry `{ fields: ["quotes"], source: "tradingview", timeKind: "trade", stale: false, basis: "primary" }` with the quote's time.
    - A quote whose `src` is not the first configured stock provider: basis `backup`. A quote 3 sessions old: the entry is `stale: true`. No snapshot: `[]`.
  - Implement per contract; `search.ts` uses `DIRECTORY_SOURCE` from `provenance.ts`.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T006 [US3] Provenance for `get_market_overview`, `get_indices` and `get_daily_summary`.
  - Files: `src/mcp/tools/market.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first:
    - Overview: exactly 2 entries in order: indices (`trade`, `primary`), then the 6 `OVERVIEW_MOVER_FIELDS` (`computed`, source `sources.stocks`, `dataTime` equal to `meta.dataTime`).
    - Indices with `names: ["EGX30", "EGX99", "EGX30USD"]`: one `indices` entry built only from the EGX30 entry.
    - Daily summary: indices entry `{ timeKind: "close", dataTime: snapshot.session.date, basis: "primary" }` and the 4 `SUMMARY_MOVER_FIELDS` entry with `timeKind` `close` and `dataTime` the session date, not a trade instant (G2).
  - Implement: `availableIndexEntries` used by `availableIndices` and the provenance (no second loop over `INDEX_CODES`, G2); `marketMeta` gains `provenance`; `indicesMeta` fills it.
  - Acceptance: tests pass; `grep -c "INDEX_CODES.flatMap" src/mcp/tools/market.ts` is 1; typecheck clean; Node project and whole suite stay green.

- [x] T007 [US3] Provenance for `get_movers`, `get_52_week_range` and `get_sector_performance`.
  - Files: `src/mcp/tools/market.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first: movers `gainers` gives only the quote entry on `items`; `near_52w_high` adds the computed `STORED_BARS_SOURCE` entry with `dataTime` `stats.asOf` and `timeKind` `close`; 52-week range gives both; sector performance gives one computed `sectors` entry, and `[]` when no sector has members.
  - Implement per contract (`moversMeta` and `sectorMeta` take the provenance).
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T008 [US3] Provenance for `get_price_history` and `compare_symbols`.
  - Files: `src/mcp/tools/history.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first: price history over bars with sources `tradingview` and `tradingview+filled` gives 2 `bars` entries (`primary`, then `computed`), each `dataTime` its newest date on the page; an empty page gives `[]`; `compare_symbols` gives one computed entry with `dataTime` equal to `data.commonTo`.
  - Implement: `metaOf` gains a `provenance` parameter.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T009 [US3] Provenance for the fund tools.
  - Files: `src/mcp/tools/funds.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first: `get_fund` gives the `nav, navDate` close entry then the computed `performance` entry, both `dataTime` the NAV date and `stale` equal to `meta.stale`; `get_fund_history` one `navs` entry with the last NAV date, `[]` for an empty page; `compare_funds` with `includeEgx30: true` and EGX30 closes seeded adds the `egx30ReturnPct` entry with source `stored index closes` and `dataTime` the end close date, and without closes has no such entry; `get_real_return` for a fund gives the 2 entries (`close` with the end NAV date, `period` with `monthOf(to)`), for a symbol the price entry source is `stored daily bars`, and the `not_available` branch gives `[]`.
  - Implement per plan.md (`egx30Return` returns `{ pct, asOf }`, `valueAt` returns `{ value, date }`, `BARS_SOURCE` replaced by `STORED_BARS_SOURCE`). Business values (`returnPct`, `egx30ReturnPct`, `nominalPct`) stay identical.
  - Acceptance: tests pass; the existing `tests/unit/funds-store.test.ts` passes; typecheck clean; Node project and whole suite stay green.

- [x] T010 [US3] Provenance for the fundamentals tools.
  - Files: `src/mcp/tools/fundamentals.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first: company profile gives one computed `symbol master` entry with `toCairoIso(updated_at)`; corporate actions from 2 sources give 2 `period` entries with the newest ex-date each, and `[]` with no actions; financials give one `period` entry per figure source with the newest period end (`null` when all are null) and, with a quote, the computed `ratios` entry; without a quote no `ratios` entry.
  - Implement: `metaOf` and `financialsMeta` take the provenance.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T011 [US3] Provenance for the personal tools.
  - Files: `src/mcp/tools/personal.ts`, `tests/unit/tool-provenance.test.ts`.
  - Test first: `portfolio_get` with 2 holdings, one quoted: the `holdings` quote entry then the computed `totals, allocationBySector, levelsCrossed` entry; without a snapshot `[]`; `what_changed_since` with one `big_move` event gives the `market events` entry with the event's time, a `new_nav` event alone gives the `["newNavs"]` entry, and `[]` with no events and no crossings; the 4 write tools and `price_levels_list` give `[]`.
  - Implement per contract; `personalMeta` keeps `provenance: []` as its default.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

## Phase 3: Gold pound and freshness (US2)

- [x] T012 [US2] Gold pound.
  - Files: `src/providers/gold-egypt.ts`, `src/mcp/tools/prices.ts`, `tests/unit/tool-provenance.test.ts` (or a new `describe` in it for metals data), `tests/jobs/metals.test.ts`, `tests/contract/prices.test.ts`.
  - Test first (Node harness): a snapshot whose `metals.egypt.gold.pound` is `{ sell: 50400, buy: 50040 }` gives `data.egypt.goldPound` `{ buy: 50040, sell: 50400, unit: "EGP/piece", dataTimeKind: "fetched", source: "isagha", dataTime: ... }`, placed after `gold24k` in key order; a snapshot without the pound gives `goldPound` `not_available` and every other item unchanged.
  - Workers tests (NOT RUN, must typecheck): `metals.test.ts` expects `gold.pound` `{ sell: 50400, buy: 50040 }` from the fixture and, when the pound row is removed, the other units still served and `goldPound` `not_available` (the pound is optional; 18, 21, 24 and silver stay required); `prices.test.ts` `EGYPT_KEYS` gains `goldPound`.
  - Implement per plan.md "Gold pound and freshness" (the `EGYPT_ITEMS` list).
  - Acceptance: Node tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T013 [US2] Metals and FX staleness and provenance.
  - Files: `src/mcp/tools/prices.ts`, `tests/unit/tool-provenance.test.ts`, `tests/contract/prices.test.ts`.
  - Test first (Node harness, time set with fake `Date`): fresh data gives `meta.stale` false and the `egypt` (`fetched`) and `global` (`trade`) entries; `fetchedAt` 27 hours old gives `meta.stale` true, the contract's Egypt reason, Egypt entry `stale: true`; spot `tt` 73 hours old gives the spot reason and the global entry stale; 25 hours (Egypt) and 71 hours (spot) are not stale; `get_usd_egp` at 73 hours is stale with the contract reason and its `rate` entry stale; no Egypt and no spot gives `[]`.
  - Workers test (NOT RUN): the same 27-hour case in `prices.test.ts`.
  - Implement per contract.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T014 [US3] Workers contract assertions for provenance.
  - Run `git cherry-pick 7673d22` (resolve conflicts in favor of `main`'s tests plus the added assertions).
  - Fix the G2 findings it carries: `tests/contract/daily-summary.test.ts` asserts `dataTime` equal to the session date on both entries; `tests/contract/search.test.ts` replaces the reseeded empty directory with a deleted `directory:v1` key for "missing" and adds a separate empty-directory case, both `[]`; add an error-result case in `quotes.test.ts` asserting `meta.provenance` `[]`.
  - Acceptance: typecheck clean; NOT RUN (Workers pool); whole suite stays green.

## Phase 4: Index history (US1)

- [x] T015 [US1] Index CSV parser and analytics.
  - Run `git cherry-pick 0fa1481` (tests and code come together; the tests were red before the code in the first build, G3 report).
  - Then: remove `addDays` from `src/domain/calendar.ts` and its cases from `tests/unit/calendar.test.ts`; in `src/domain/index-analytics.ts` import `shiftDays` and `percentChange` from `./returns`, remove the private percent helper, keep `finiteOrNull` around the results; `src/domain/index-csv.ts` unchanged (it imports `parseMubasherCsvLine` and `percentChange` with `.ts` extensions, which the Node script allows).
  - Test first for the cleanup: add a case to `tests/unit/index-analytics.test.ts` that `summarize` of closes `[100, 0]` gives `dailyChangePct` `null` (non-finite guarded), seen failing if the guard is lost; the picked tests (292 parsed rows, `toBeCloseTo(8, 9)` for the 5-session return) must stay green.
  - Acceptance: `grep -rn "addDays" src tests scripts` is empty; tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T016 [US1] `readIndexSeries`.
  - Files: `src/store/d1/closes.ts`, `tests/unit/index-series-store.test.ts` (new, `createSqliteD1`).
  - Test first (fails on the missing export): rows for EGX30 (2026-10-20, 21, 22) and EGX70EWI (2026-10-21) and an EGX30 row on 2026-09-01; `readIndexSeries(db, ["EGX30", "EGX70EWI", "EGX30USD"], "2026-10-21", "2026-10-22")` returns the 3 in-window rows ordered by code then date, `earliest` `EGX30` `2026-09-01` and `EGX70EWI` `2026-10-21` and no `EGX30USD` key; an empty `codes` list returns no rows.
  - Implement per plan.md and data-model.md (correlated earliest subquery, one batch).
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T017 [US1] End-of-day due time after the refresh window (G4).
  - Files: `src/domain/calendar.ts`, `src/jobs/end-of-day.ts`, `tests/unit/calendar.test.ts`, `tests/jobs/end-of-day-bars.test.ts`.
  - Test first (Node, fails on the missing export): `isEndOfDayDue("15:29", null)` false, `("15:30", null)` true; special hours closing `15:15` (window end 15:30): `("15:30", row)` false, `("15:31", row)` true, `("16:30", row)` true; special hours closing `16:00`: `("15:30", row)` false, `("16:15", row)` false, `("16:30", row)` true (the cron fires at 12:30, 13:30 and 14:30 UTC: 15:30, 16:30, 17:30 Cairo in summer, 14:30, 15:30, 16:30 in winter); special hours closing `13:00`: `("15:30", row)` true.
  - Workers test (NOT RUN): a special-hours day closing at 15:15 does not run at 15:30 and runs at the next cron tick; a normal day runs at the first due tick; one closing at 16:00 does not run at 15:30 and runs at 16:30.
  - Implement per plan.md; `RUN_FROM_TIME` removed from `end-of-day.ts`.
  - Acceptance: Node tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T018 [US1] Index closes step hardening (G4).
  - Files: `src/domain/index-closes.ts` (new), `src/jobs/end-of-day.ts`, `tests/unit/index-closes.test.ts` (new), `tests/jobs/end-of-day-bars.test.ts`.
  - Test first (Node, fails on the missing module): `indexClosesOf` returns `[]` when `session.date` differs from the date; keeps only entries whose `tt` falls on the date (Cairo); orders by `INDEX_CODES`; maps `v`, `chp`, `src` to `close`, `changePct`, `source`.
  - Workers tests (NOT RUN), in the existing end-of-day test style: the closes kept in `snapshot:index-closes:<date>` for an earlier session are stored when its rows are missing, with `snapshot:last-session` already overwritten by the current day (real cron order), and a second run inserts nothing new; the snapshot job writes that key once at the window end; quotes for today but no index entry dated today raise one `job_failed` notice for step `indexValues` and the later steps (`stats`, `lastSession`) still run; a D1 failure inside `insertIndexValues` raises the notice and listing sync and the other steps still run; a holiday stores nothing; an existing `mubasher` row for (EGX30, date) keeps its close.
  - Implement per plan.md "End-of-day hardening".
  - Acceptance: Node tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T019 [US1] EGX 30 backfill script.
  - Run `git cherry-pick 8d8d7b3`.
  - Files then: `src/providers/request-defaults.ts` (new), `src/providers/http.ts`, `scripts/backfill/index-history.ts`, `scripts/backfill/index-sql.ts` (new), `tests/unit/index-backfill-sql.test.ts` (new).
  - Test first (fails on the missing module): `backfillSql` of 201 rows gives 2 insert statements (200 and 1 rows), each followed by the exact `usage_global` statement with `date('now')` and `changes()` from data-model.md; a null `changePct` prints `NULL`; `[]` gives `""`.
  - Implement per plan.md "Backfill script" (shared user agent and timeout, `--out` validation and quoted path, `shiftDays`). Do not run the script.
  - Acceptance: `grep -rn "egx-mcp/1.0" src scripts` shows `src/providers/request-defaults.ts` and `scripts/probe/egx-probe.ts` only; `node scripts/backfill/index-history.ts --out` is NOT run; tests pass; typecheck clean; Node-pool run equals the baseline plus earlier tasks (existing provider tests still green).

- [x] T020 [US1] `get_index_history`.
  - Files: `src/mcp/tools/index-history.ts` (new), `src/mcp/tool-names.ts`, `src/mcp/server.ts`, `tests/unit/server.test.ts`, `tests/unit/node-mcp.test.ts` (tool count), `tests/unit/index-history-tools.test.ts` (new).
  - Test first (Node harness, fake `Date` at 2026-10-28 15:00 Cairo; fails because the tool is not registered):
    - Seed the 55 fixture closes from 2026-08-02 to 2026-10-27 (from the CSV fixture, source `mubasher`) plus one `tradingview` row: daily returns them ascending with `source`, `from` `shiftDays(today, -days)`, `earliestAvailable` the oldest seeded date.
    - `interval: "weekly"` points are the last session of each Sunday to Thursday week; `monthly` the last of each month.
    - `maxRows: 3` returns the last 3 with `truncated: true`.
    - `"EGX70"` resolves to `EGX70EWI`; `"EGX99"` gives error `not_found` with `Unknown index: EGX99.`
    - `EGX30USD` gives `points: []`, `earliestAvailable: null` and the `notAvailable` reason.
    - `days: 0` and `maxRows: 501` give `invalid_input`.
    - Meta: `end_of_day`; 2 provenance entries (`mubasher`, `tradingview`) in first-seen order with `timeKind` `close`; a latest close older than the previous trading day sets `stale` and the contract's reason.
    - `server.test.ts` lists `get_index_history` after `get_sector_performance`.
  - Implement per plan.md "Index tools" and the contract.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

- [x] T021 [US1] `get_index_summary`.
  - Files: `src/mcp/tools/index-history.ts`, `src/mcp/tool-names.ts`, `tests/unit/server.test.ts`, `tests/unit/node-mcp.test.ts`, `tests/unit/index-history-tools.test.ts`.
  - Test first (fails because the tool is not registered):
    - EGX30 (60 closes) and EGX70EWI (10 closes) seeded: each summary equals `summarize` on the same rows after `roundIndex` and `roundPercent`; EGX70EWI has `sma20`, `sma50` null and `meta.notAvailable` lists `EGX70EWI.sma20` and `EGX70EWI.sma50`.
    - `highestReturn` names the higher period return; equal returns go to the first input; 1 index gives `highestReturn: null`.
    - `["EGX30", "EGX99", "EGX30USD", "egx30"]` gives ok, `not_found` in position 2, `not_available` with its reason, and no second EGX30.
    - Default input is `["EGX30"]`; 6 indices give `invalid_input`.
    - Provenance: one computed `summaries` entry per source.
    - `server.test.ts` lists `get_index_summary` right after `get_index_history`.
  - Implement per the contract.
  - Acceptance: tests pass; typecheck clean; Node project and whole suite stay green.

## Phase 5: Guard and docs

- [x] T022 [US3] All-tools contract guard.
  - Files: `tests/unit/all-tools.test.ts` (new), `tests/helpers/node-mcp.ts` (seed helpers only if shared).
  - Test: per plan.md "Contract guard". `SAMPLE_ARGS` for all 30 tools: `search` `{ query: "COMI" }`; `get_quotes` `{ symbols: ["COMI"] }`; `get_market_overview` `{}`; `get_indices` `{ names: [] }`; `get_daily_summary` `{}`; `get_movers` `{ kind: "gainers" }`; `get_52_week_range` `{ symbols: ["COMI"] }`; `get_sector_performance` `{ period: "1m" }`; `get_metals` `{}`; `get_usd_egp` `{}`; `get_index_history` `{ index: "EGX30" }`; `get_index_summary` `{ indices: ["EGX30", "EGX70EWI"] }`; `get_price_history` `{ symbol: "COMI", from: "2026-09-01", to: "2026-10-27" }`; `compare_symbols` `{ symbols: ["COMI", "ETEL"], from: "2026-09-01", to: "2026-10-27" }`; `get_fund` and `get_fund_history` with the seeded fund id (history also `from` and `to`); `compare_funds` two seeded funds, `period: "1m"`, `includeEgx30: true`; `get_real_return` `{ fund, from, to }`; `get_company_profile`, `get_corporate_actions`, `get_financials` `{ symbol: "COMI" }`; `get_dividends` `{}`; `portfolio_get` `{}`; `portfolio_upsert_holding` `{ symbol: "COMI", quantity: 10, costPerShare: 50, acquiredOn: "2026-10-01" }`; `portfolio_remove_holding` and `price_level_remove` `{ id: 999999 }` (not found); `price_level_set` `{ symbol: "COMI", direction: "above", level: 60 }`; `price_levels_list` `{}`; `what_changed_since` `{ since: <ISO time with offset, 1 day before now> }`. Adjust a sample only to the tool's real input schema and record it.
  - The `full` seed must make every tool outside `NO_MARKET_VALUE_TOOLS` return market data: for example a cash dividend with an ex-date within the next 90 days (for `get_dividends {}`), a `big_move` event within the last day, stats with a sector for `get_sector_performance`, CPI rows for both months of `get_real_return`, bars for COMI and ETEL in the compare window.
  - Red check: temporarily drop one `SAMPLE_ARGS` entry and see the test fail naming the tool, then restore it.
  - Acceptance: every tool passes in both states; no `fetch`; typecheck clean; Node project and whole suite stay green.

- [x] T023 Update `README.md` per plan.md "README".
  - Test first: `npm run check:readme` passes before and after; check by `grep` that both new tool names and "gold pound" appear.
  - Acceptance: `npm run check:readme` passes; typecheck clean.

- [x] T024 Final verification (pipeline-planner final check): `npm run typecheck`; the Node project and the whole suite (`npx vitest run`) are fully green; `npm run check:readme`; `git diff --stat 70fd4d1..HEAD` lists only the files in plan.md "Project Structure"; no em or en dash character in `git diff 70fd4d1..HEAD`; the squash message carries no AI attribution.

## Dependencies

- T001, then T002 (harness), then T003 (changes `Meta`; every later task depends on it), then T004.
- Provenance per tool T005 to T011 in order (shared test file); T012, then T013; T014 after T005 to T007.
- US1: T015, then T016; T017, then T018; T019 after T015; T020 after T016 and T004; T021 after T020.
- T022 after T013 and T021. T023 after T021. T024 last.

## Spec coverage

| Requirement | Tasks |
|---|---|
| FR-001, FR-002 | T018 |
| FR-003 | T017 |
| FR-004 | T019 (T001 fixture, T015 parser) |
| FR-005 | T015, T016, T020 |
| FR-006 | T015, T016, T021 |
| FR-007 | T016, T020, T021 |
| FR-008 | T012, T013 |
| FR-009 | T003 to T014, T020, T021 |
| FR-010 | T002, T022 |
| FR-011 | T022 |
| FR-012 | T023 |
| G2 findings | T005, T006, T014 |
| G4 findings | T016, T017, T018, T019 |
