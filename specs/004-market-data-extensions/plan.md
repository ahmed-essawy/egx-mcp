# Implementation Plan: Market data extensions

**Branch**: `pipeline/market-data-extensions` (worktree `D:/Work/egx-mcp.pipeline/market-data-extensions-2`, delivered as one squash commit `feat/market-data-extensions`) | **Base**: `main` 70fd4d1 | **Date**: 2026-10-28 (replan) | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **Data model**: [data-model.md](data-model.md) | **Contract**: [contracts/mcp-tools.md](contracts/mcp-tools.md)

## Summary

Owner decisions stay option A (Mubasher plus snapshot history, full metals plus the gold pound, two new index tools). On current `main` the remaining work is:

1. **Provenance (US3)**: `meta.provenance` on every one of the 30 tools and on the error envelope, built by pure functions in `src/mcp/provenance.ts`; the G2 findings are folded in. A Node-run contract guard calls every tool with full and empty stores.
2. **Index history (US1)**: reuse the already stored `index_values`; add the EGX 30 backfill script, `readIndexSeries`, `get_index_history` and `get_index_summary`; harden the end-of-day `indexValues` step and its due time (G4); add the EGX endpoint to the probe.
3. **Gold (US2)**: the gold pound in the iSagha provider and `get_metals`, and the 26 h and 72 h staleness rules.

Already on `main` and dropped from this plan: `get_metals`, `get_usd_egp`, the iSagha and TradingView FX and metals providers, the `metalsFx` refresh (snapshot and reference jobs), the end-of-day storage of index closes, `tests/raw.d.ts`.

## Technical Context

- **Stack**: TypeScript 7.0.2 strict, Cloudflare Workers (compat date 2026-10-01, `nodejs_compat`), `@modelcontextprotocol/server` 2.3.1, zod 4.6.7, D1, KV, vitest 4.1.12 with `@cloudflare/vitest-pool-workers` 0.23.0. Node 24 for local scripts (type stripping, imports with `.ts` extensions). A Node script may import `src` modules whose whole import chain uses `.ts` extensions (`adjust.ts`, `returns.ts`, `budget.ts`), like `scripts/check-readme.ts`.
- **No new dependency, binding, cron or migration; one new KV key family (`snapshot:index-closes:<session date>`).** Next migration number would be `0004` (origin/main has 0001 and 0003).
- **Data access and performance risks**:
  - `readIndexSeries`: explicit columns, one statement for every index of a request (no N+1), PK range seek per code via `json_each`, sent in one `db.batch` with the earliest-date statement. Bounded by `days` at most 1825 (about 1,300 rows per index, at most about 6,500 for 5 indices). Rows read go into `ctx.rows`. No pagination: weekly and monthly buckets need every close of the window, so `maxRows` (at most 500) is applied after downsampling; CPU is one pass over at most 6,500 numbers.
  - Earliest date: per-code correlated `MIN` subquery (one PK prefix seek per code), replacing the first build's `GROUP BY` full scan (G4).
  - End of day: `insertIndexValues` unchanged (insert-only `json_each`), now called with today's closes plus the closes recovered from the per-date KV keys of the 5 days before; 5 extra KV reads per day (missing keys).
  - Provenance: pure in-memory grouping over at most the returned items; no extra reads.
  - No new index: every query uses an existing PK.
- **Writing rules**: no comments in code; no em dash, en dash or double hyphen used as punctuation in any text (CLI flags such as `--out` inside code are fine); no AI attribution; named `const` for every literal (project style); stage by explicit path; never stage `.claude/`, `CLAUDE.md` or `.specify/`.

### Verification (every task)

- Never run `wrangler dev`, `wrangler deploy`, any `--remote` wrangler command, the backfill script, the probe, or any request to a data provider.
- `npm run typecheck`.
- `npx vitest run --project node` (Node project) and `npx vitest run` (whole suite). New `node:sqlite` or `vi.mock` tests are added to `NODE_TEST_FILES` in `vitest.config.ts`.
- **Baseline at 70fd4d1 (planner, 2026-10-28)**: typecheck clean; the Node project and the whole suite (`npx vitest run`) are fully green, 1175 tests on `main`, no known baseline failures. Any failure is new. Workers-pool files (`tests/contract`, `tests/jobs`, `tests/integration`) are written in the repo style and must typecheck.
- README tasks also run `npm run check:readme`.

## Constitution Check (v2.1.0)

| Principle | Status |
|---|---|
| I. Honest delayed data | PASS. Index tools are labeled `end_of_day` with the close date and a stale rule; metals and FX gain stale flags; `meta.provenance` states source, kind of time, staleness and basis for every data key. |
| II. Cache-only reads | PASS. No tool fetches a provider (the contract guard fails on any `fetch`). Index tools read stored closes from D1, like `get_price_history` and `get_fund_history` on `main`. The end-of-day job stays once per trading day and now waits for the refresh window to end. |
| III. Integrity and provenance | PASS. Closes stay insert-only with source and date, never deleted. The backfill runs as a local script. Analytics are computed by the server. |
| IV. Zero cost | PASS. Budget below; no paid source. |
| V. Secure access | PASS. New tools use `defineTool` (auth, limits, usage). No secret. |
| VI. Informational only | PASS. `highestReturn` is a reported fact; the guard checks advice words. |
| Platform: data sources | PASS. Mubasher (named for historical backfill), iSagha and TradingView (named). The script sits outside the Worker. |
| Quality gates | Each new tool has a contract test (Node harness). The touched end-of-day step has holiday, empty-source and partial-failure tests (Workers pool, NOT RUN) plus Node unit tests for its pure parts. |

Re-check after design: PASS. Complexity tracking: none.

### Free-tier budget (delta on `main`)

| Resource | Change | Worst case |
|---|---|---|
| External subrequests | none in the Worker (the backfill runs locally, 2 requests) | unchanged |
| KV reads per day | end of day +5 (`snapshot:index-closes:<date>` of the 5 preceding days) | negligible |
| KV writes | +1 per trading day (`snapshot:index-closes:<session date>`, written by the snapshot job at the window end next to `snapshot:last-session`, `expirationTtl` 6 days); the documented worst case of 898 rises to 899 of 1,000 (specs/001 research R1) | inside the 1,000 limit |
| D1 rows written per day | at most 4 more on a recovery day (insert-only, duplicates write 0) | inside `JOBS_D1_ROWS_RESERVE` |
| D1 rows written once | backfill about 1,240, counted in `usage_global.backfill_rows` (allowance 36,000) | once |
| D1 rows read per tool call | history at most about 1,300; summary at most about 6,500 | bounded by 3,500,000 per day |
| Cron triggers | none added | unchanged |
| CPU | summary math over at most 6,500 numbers; provenance grouping over returned items | well under 10 ms |

### Supersedes in 001 (record when 001 is next touched)

- T120 (tool-list test) and T121 (no-upstream test) are covered by `tests/unit/all-tools.test.ts` here (Node harness rather than `tests/contract/all-tools.test.ts`); 001 T120 keeps only its read-only hint check if not added here.
- 001 tasks.md line "spec 004 supersedes further User Story 9 work" stays true: the gold pound and metals staleness are delivered here.

## Cherry-pick plan (from `pipeline/claude-market-data-extensions`)

Order, each as part of the named task (research R7 has the per-commit evidence):

1. T001: `git cherry-pick 7dd0041` (probe URL), then `git show e401e10 -- tests/fixtures | git apply` (EGX 30 CSV fixture and its fixtures README row).
2. T003: `git show 236f033 -- src/mcp/envelope.ts src/mcp/output-schema.ts src/mcp/provenance.ts tests/unit/provenance.test.ts tests/unit/envelope.test.ts | git apply --3way`. Its `quotes.ts`, `market.ts` and `search.ts` hunks are not taken (redone in T005 to T006).
3. T014: `git cherry-pick 7673d22` after T005 to T007, then fix the two G2 findings it carries.
4. T015: `git cherry-pick 0fa1481`, then replace `addDays` by `shiftDays`.
5. T019: `git cherry-pick 8d8d7b3`, then apply the G4 fixes.

Redone, not picked: e49df75 (superseded by `main` and the Node harness), 964e656 and 963b3ab (superseded by `main`'s `indexValues` step; replaced by T016 to T018). Old commits carry a `Claude-Session` trailer; it disappears in the squash, whose message must carry no AI attribution.

## Design (exact)

### Node MCP harness (T002)

`tests/helpers/node-mcp.ts` (new):

```ts
export const NODE_AUTH: AuthProps;
export type NodeStores = { env: Env; sqlite: DatabaseSync; kv: Map<string, string> };
export function createNodeStores(): NodeStores;
export function putJson(stores: NodeStores, key: string, value: unknown): void;
export async function listNodeTools(env: Env): Promise<ListedTool[]>;
export async function callNodeTool(env: Env, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
```

- `createNodeStores`: `createSqliteD1()` for `DB`; `DATA` is a Map-backed object with `get(key, options)` returning `JSON.parse` of the stored text or `null`, `put(key, text)` and `delete(key)`; `RATE_LIMITER` is `{ limit: async () => ({ success: true }) }`; the remaining bindings are the `vars` of `wrangler.jsonc` (imported with `?raw` and `JSON.parse`, as the existing shim does). It inserts one active user row for `NODE_AUTH.userId` (columns from `migrations/0001_initial.sql`) and calls `__resetKvMemo()`.
- `listNodeTools` and `callNodeTool`: `createServer(env, NODE_AUTH)` over `InMemoryTransport.createLinkedPair()`, `initialize`, `notifications/initialized`, then `tools/list` or `tools/call`, the pattern of `tests/unit/server.test.ts`. `callNodeTool` calls `__resetKvMemo()` first and throws on a JSON-RPC error.
- Real `checkLimits` and `finishCall` run against the in-memory D1. If one cannot run on `node:sqlite`, mock `../../src/limits/usage` in the test file as `tests/unit/server.test.ts` does and record it under Deviations.
- Extend `tests/helpers/sqlite-d1.ts` only if a tool needs it: an unbound `prepare(sql).all()`/`.run()` and `meta.rows_read` (use `results.length`). Existing users of the helper stay green.
- Tests set time with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(...)`.

### Provenance (T003 to T014)

- `src/mcp/envelope.ts`: `Basis`, `TimeKind` (`"trade" | "fetched" | "close" | "period"`), `Provenance`, `Meta.provenance` (last field); `errorMeta` returns `provenance: []`.
- `src/mcp/output-schema.ts`: `provenanceSchema` (`fields: z.array(z.string()).min(1)`, `timeKind: z.enum(["trade", "fetched", "close", "period"])`, ...) and `provenance: z.array(provenanceSchema)` in `metaSchema`.
- `src/mcp/provenance.ts`: `stockBasis`, `groupBySource` (from 236f033) plus the builders and constants of the contract ("Builders"). It imports only types (`QuoteEntry`, `IndexEntry`, `Snapshot`, `MarketClock`, `Provenance`) and `toCairoIso`, `isQuoteStale`.
- T003 adds `provenance: []` to every existing `Meta` literal so the build stays green: `search.ts` `metaFor`, `quotes.ts` `metaFor`, `market.ts` `marketMeta`, `indicesMeta`, `moversMeta`, `sectorMeta`, `history.ts` `metaOf`, `personal.ts` `personalMeta`, `funds.ts` `metaOf`, `fundamentals.ts` `metaOf`, `prices.ts` `metalsMeta`, `fxMeta`. T005 to T013 replace each placeholder with the contract's entries.
- Builders that need data they do not get today:
  - `market.ts`: one private `availableIndexEntries(snapshot): [IndexCode, IndexEntry][]` (`INDEX_CODES` order) feeds `availableIndices` and both providers' provenance (G2 duplication). `marketMeta` gains a last parameter `provenance: Provenance[]`.
  - `funds.ts`: `egx30Return` returns `{ pct: number; asOf: string } | null` (`asOf` = the end close's `sessionDate`); `Basis.valueAt` returns `{ value: number; date: string } | null` (`navDate` or `sessionDate`); `BARS_SOURCE` is replaced by `STORED_BARS_SOURCE`.
  - `fundamentals.ts`: profile entry uses `profile.updatedAt` (already on `SymbolProfile`).
  - `personal.ts`: `portfolioMeta` and the `what_changed_since` meta build provenance from the quotes and events they already hold.
- Every tool's provenance is tested through the Node harness in `tests/unit/tool-provenance.test.ts` (new, grows per task), one `describe` per tool family, with exact `toEqual` on `meta.provenance`.

### Gold pound and freshness (T012, T013)

- `src/providers/gold-egypt.ts`: `GOLD_UNITS = ["18", "21", "24"]` stay required with silver, and the pound is optional: it is read only when its row parses, so a page without it serves the other units and `goldPound` is `not_available`.
- `src/mcp/tools/prices.ts`: `EGYPT_ITEMS` constant list of `[key, group, unit key, reported unit]`: `gold18k`, `gold21k`, `gold24k`, `goldPound` (`EGP/piece`), `silver925`, `silver999`, replacing the two `map` blocks in `egyptSection`; `egyptItemOf` takes the reported unit. Stale helpers `isEgyptStale(egypt, now)` and `isSpotStale(tt, now)` with the contract constants; `metalsMeta(metals, now)` and `fxMeta(entry, now)` set `stale`, `staleReason` and `provenance`. `ctx.now` is the clock.
- Workers tests updated in the same tasks: `tests/jobs/metals.test.ts` (`FIXTURE_RETAIL.gold.pound = { sell: 50400, buy: 50040 }`, a page without the pound row serves the other units and `goldPound` is `not_available`), `tests/contract/prices.test.ts` (`EGYPT_KEYS` gains `goldPound`, stale cases).

### Index analytics and store (T015, T016)

- After the cherry-pick of 0fa1481: delete `addDays` from `src/domain/calendar.ts` and its cases in `tests/unit/calendar.test.ts`; `src/domain/index-analytics.ts` imports `shiftDays` and `percentChange` from `./returns` and wraps them with its `finiteOrNull` (its private `percentChange` is removed); `src/domain/index-csv.ts` is imported by the Node script, so its imports use `.ts` extensions: it reuses `parseMubasherCsvLine` from `./adjust.ts` and `percentChange` from `./returns.ts`, whose chain (`budget.ts`) uses `.ts` extensions too.
- `src/store/d1/closes.ts` adds:

```ts
export type IndexSeriesRow = { code: string; date: string; close: number; source: string };
export type IndexSeries = { rows: IndexSeriesRow[]; earliest: ReadonlyMap<string, string>; rowsRead: number };
export async function readIndexSeries(db: D1Database, codes: string[], from: string, to: string): Promise<IndexSeries>
```

  SQL exactly as in data-model.md; one `db.batch`; `rowsRead` is the sum of both `meta.rows_read ?? 0`; `earliest` omits codes whose `MIN` is null. Tested on `createSqliteD1` in `tests/unit/index-series-store.test.ts`.

### End-of-day hardening (T017, T018)

- `src/domain/calendar.ts`: `export function isEndOfDayDue(time: string, row: CalendarRow | null): boolean` is `toMinutes(time) >= toMinutes(END_OF_DAY_EARLIEST) && toMinutes(time) > toMinutes(refreshWindow(row).end)` with `END_OF_DAY_EARLIEST = "15:30"`. The end-of-day cron (`30 12,13,14 * * SUN-THU`, still one trigger) fires at 12:30, 13:30 and 14:30 UTC (15:30, 16:30 and 17:30 Cairo in summer, 14:30, 15:30 and 16:30 in winter), and the comparison is strictly greater than the window end, so the job never shares the window-end minute with the last snapshot: a special close at 15:15 gives a window end of 15:30, does not run at 15:30 and runs at the next tick. The snapshot cron is extended to `* 6-13 * * SUN-THU` so window ends up to 15:59 Cairo in winter are reached; the snapshot job already returns before any D1 statement outside its window. `end-of-day.ts` `isDue` uses it with the day's calendar row (it already reads it) and drops `RUN_FROM_TIME`.
- `src/domain/index-closes.ts` (new): `export function indexClosesOf(snapshot: Pick<Snapshot, "indices" | "session">, date: string): NewIndexValue[]`: `[]` when `snapshot.session.date !== date`; else one value per entry with `cairoParts(entry.tt).date === date`, in `INDEX_CODES` order (`NewIndexValue` imported as a type from `src/store/d1/bars.ts`).
- `end-of-day.ts`:
  - Why not `snapshot:last-session`: the snapshot job overwrites it at the window end (14:45 Cairo) of every trading day, before that day's end-of-day cron, so a failed or missed day D has lost its closes there by D+1. Recovery therefore reads a per-date key. `src/jobs/snapshot.ts` `persist` writes `snapshot:index-closes:<session date>` (`putIndexCloses`, JSON array of `NewIndexValue`, skipped when empty, `expirationTtl` 6 days (retention 5 days plus one, so a key written at 14:45 on D-5 is still there at the 15:30 run on D)) at the window end, in the same branch that writes `snapshot:last-session`. `src/store/kv.ts` gains `putIndexCloses`, `getIndexCloses(env, dates)` and `INDEX_CLOSES_RETENTION_DAYS = 5`; `src/domain/calendar.ts` gains `precedingDays(date, count)`.
  - `writeIndexValues`: `today = snapshot ? indexClosesOf(snapshot, date) : []`; `recovered = await getIndexCloses(env, precedingDays(date, INDEX_CLOSES_RETENTION_DAYS))` (insert-only and first-wins, so keys of days already stored write 0 rows); one `insertIndexValues(env.DB, [...recovered, ...today])` (it already returns early on an empty list); then, when `quotes.length > 0 && today.length === 0`, throw `new Error(\`no index closes for ${date}\`)` so `runSteps` raises one `job_failed` notice. The early `return` for `snapshot === null || quotes.length === 0` is replaced by this logic, so a run whose live snapshot is unusable still recovers the earlier sessions. A `noTradesToday` day still returns `skipped: no session` before any step (unchanged).

### Backfill script (T019)

- `src/providers/request-defaults.ts` (new, zero imports): `USER_AGENT`, `PROVIDER_TIMEOUT_MS = 8000`; `src/providers/http.ts` imports both and drops its copies.
- After the cherry-pick of 8d8d7b3, `scripts/backfill/index-history.ts`:
  - imports `shiftDays` from `../../src/domain/returns.ts`, `cairoParts` and `nowSeconds` from `../../src/domain/calendar.ts`, `USER_AGENT` and `PROVIDER_TIMEOUT_MS` from `../../src/providers/request-defaults.ts`; `utcDay` is no longer used.
  - `fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })`.
  - `outPath(args)`: `--out` followed by a value that is missing or starts with `-` throws `--out needs a file path`; the printed owner command quotes the path (`"<path>"`).
  - SQL text comes from `scripts/backfill/index-sql.ts` (new, zero-import except a type import of `BackfillRow` with `.ts`): `export function backfillSql(rows: BackfillRow[], indexCode: string, source: string): string`, chunks of 200, each insert followed by the `usage_global` statement of data-model.md; empty rows give `""`.

### Index tools (T020, T021)

`src/mcp/tools/index-history.ts` (new) exports `registerIndexHistoryTools(server, env, auth)` with two `defineTool` calls (`readOnly: true`), per the contract.
- Private helpers: `windowOf(clock, days)` (`{ today: clock.today, from: shiftDays(clock.today, -days) }`), `seriesStale(date, clock)` (`isQuoteStale`), `toClose(row)`.
- Constants: `MAX_DAYS = 1825`, `DEFAULT_DAYS = 365`, `MAX_ROWS = 500`, `MAX_INDICES = 5`, `MAX_INDEX_INPUT_LENGTH = 40`, `SMA_LOOKBACK_DAYS = 100`, `DEFAULT_SUMMARY_INDICES = ["EGX30"]`, and the reason and message strings of the contract.
- `get_index_history`: resolve with `resolveIndexCode` (unknown: `fail("not_found", ...)`); `Promise.all` of `readIndexSeries(db, [code], from, today)` and `loadMarketClock`; `ctx.rows.add({ rows_read })`; `downsample`, then `lastRows`.
- `get_index_summary`: resolve and dedupe; one `readIndexSeries(db, codes, shiftDays(today, -Math.max(days, SMA_LOOKBACK_DAYS)), today)`; per code `summarize(series, from)` or `not_available`; `highestReturn` from ok items; `meta.notAvailable` from `nullMetrics`.
- `src/mcp/tool-names.ts`: insert both names after `"get_indices"`. `src/mcp/server.ts`: `registerIndexHistoryTools` right after `registerMarketTools`. `tests/unit/server.test.ts`: the listed names gain `"get_index_history", "get_index_summary"` right after `"get_sector_performance"` (registration order: market tools, then index tools).

### Contract guard (T022)

`tests/unit/all-tools.test.ts` (new, Node harness):
- `listNodeTools`; per tool: a `SAMPLE_ARGS` entry exists (else fail `missing sample args for <name>`), `outputSchema` present, `description` contains `NOTICE`, and the output schema's `meta` requires `provenance`.
- States: `full` (directory, snapshot with quotes, indices, metals with the pound, FX, last-session snapshot, stats, 60 `index_values` rows for EGX30 and EGX70EWI, bars, a fund with NAVs, figures, actions, CPI rows, one holding and one level for `NODE_AUTH`) and `empty` (fresh stores). Seeds use plain SQL on `stores.sqlite` and `putJson`.
- `vi.spyOn(globalThis, "fetch")` fails the test when called.
- For each tool and state: `callNodeTool` resolves (no JSON-RPC error); `JSON.parse(content[0].text)` deep-equals `structuredContent`; a recursive walk finds only finite numbers and no `undefined`; success: `data`, `meta.provenance` array, `notice === NOTICE`; error: `error.code` in the 8 `ErrorCode` values and `meta.provenance` equal to `[]`.
- `full`: every success of a tool not in `NO_MARKET_VALUE_TOOLS` (`portfolio_upsert_holding`, `portfolio_remove_holding`, `price_level_set`, `price_level_remove`, `price_levels_list`, `admin`) has a non-empty `meta.provenance`, and every `fields` name is a key of `data`.
- Advice words: no string value (keys excluded) matches `/\b(buy|sell|hold|recommend\w*)\b/i`.

### README (T023)

- Overview and "Current build": list every registered tool (30), including `get_index_history` and `get_index_summary`; remove "(coming later)" from features that now exist; keep the README check green.
- Data sources: Mubasher row adds "EGX 30 index history backfill"; iSagha row adds the gold pound.
- Tools table adds `get_index_history` ("How did EGX30 move week by week over the last year?") and `get_index_summary` ("Compare EGX30 and EGX70 over 6 months: return, volatility and drawdown?"), and `get_metals` mentions the gold pound.
- Owner tasks add: run `npm run backfill:indices`, then `npx wrangler d1 execute egx --remote --file "scripts/backfill/out/index-history-EGX30.sql"` once after the first deploy; deploy `scripts/probe` and record the `getIndexChartData` result in research R1.

## Project Structure

```text
specs/004-market-data-extensions/   spec, plan, research, data-model, quickstart, tasks, contracts/mcp-tools.md, checklists/requirements.md
scripts/probe/egx-probe.ts          (cherry-pick) one URL
scripts/backfill/index-history.ts   (cherry-pick, edit); scripts/backfill/index-sql.ts (new); package.json (cherry-pick) backfill:indices
src/providers/request-defaults.ts   (new); src/providers/http.ts, gold-egypt.ts (edit)
src/domain/index-csv.ts, index-analytics.ts (cherry-pick, edit); index-closes.ts (new); calendar.ts (edit)
src/store/d1/closes.ts              (edit) readIndexSeries
src/jobs/end-of-day.ts              (edit)
src/mcp/envelope.ts, output-schema.ts, provenance.ts (cherry-pick, edit)
src/mcp/tools/search.ts, quotes.ts, market.ts, history.ts, funds.ts, fundamentals.ts, personal.ts, prices.ts (edit)
src/mcp/tools/index-history.ts      (new); src/mcp/tool-names.ts, server.ts (edit)
tests/helpers/node-mcp.ts           (new); tests/helpers/sqlite-d1.ts (edit only if needed)
tests/unit/node-mcp.test.ts, tool-provenance.test.ts, index-series-store.test.ts, index-closes.test.ts, index-backfill-sql.test.ts, index-history-tools.test.ts, all-tools.test.ts (new)
tests/unit/provenance.test.ts, index-csv.test.ts, index-analytics.test.ts (cherry-pick); envelope.test.ts, calendar.test.ts, server.test.ts (edit)
tests/contract/search, quotes, indices, market, daily-summary (cherry-pick 7673d22, edit); prices (edit)
tests/jobs/metals.test.ts, end-of-day-bars.test.ts (edit)
tests/fixtures/mubasher-index-EGX30.csv, README.md (from e401e10)
README.md (edit)
```

## Deviations noted

- Index tools read D1 while principle II's text says index tools read the snapshot; same precedent as `get_price_history`. A PATCH clarification of the constitution can be proposed separately. Cost S.
- New contract tests live in `tests/unit` (Node harness) rather than `tests/contract` (Workers pool), because they need the Node-only fakes. Cost S to move.
- `package.json` on `main` has `"backfill": "node scripts/backfill/backfill.ts"` for a file 001 T078 has not created yet. Left as is (001 owns it).
- The contract guard `tests/unit/all-tools.test.ts` has `admin` added to `SAMPLE_ARGS` (`{ action: "usage_summary" }`) and in `NO_MARKET_VALUE_TOOLS`, because the admin tool returns owner data with `provenance: []`. Cost S.
