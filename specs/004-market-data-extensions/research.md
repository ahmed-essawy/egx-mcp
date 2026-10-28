# Research: Market data extensions

Probes R1 to R3 were read-only GETs on 2026-10-28 with `User-Agent: egx-mcp/1.0 (+https://github.com/ahmed-essawy/egx-mcp)`. R6 to R8 were checked on the replan base `70fd4d1`.

## R1. EGX `getIndexChartData`

- **Probe**: `GET https://www.egx.com.eg/WebService.asmx/getIndexChartData?index=EGX30&period=30&gtk=0` (and `period=0`). From the owner's desktop (our user agent, and a browser user agent with `Referer` and `X-Requested-With`) TLS connects, then the server resets the connection (`curl` exit 56). From a second network: `ECONNRESET`. Same as risk S1 in [001 research](../001-egx-mcp-server/research.md#risks-could-not-verify).
- **Response shape**: unknown (the competitor `PierreEhab/EGX-MCP-SERVER` uses the `egx` PyPI package, which hides the HTTP call).
- **Decision**: no EGX provider in this feature. The URL is added to `EGX_URLS` in `scripts/probe/egx-probe.ts` (001 T006 already allows this), so one owner deploy of the probe answers it. A follow-up feature adds an EGX index provider behind the same table once a response is captured as a fixture; it would add EGX 30 TR, EGX 33 Shariah and the volatility index (codes `EGX30_TR`, `EGX_33_Shariah`, `EGXVolatility`; the others map `EGX30_CAP` to `EGX30CAPPED`, `EGX70_EWI` to `EGX70EWI`, `EGX100_EWI` to `EGX100EWI`).

## R2. Index history sources that work today

- **Mubasher index CSV**: the EGX 30 page carries `historical-data-url="https://static.mubasher.info/File.MubasherCharts/File.Historical_Index_Charts_Dir/<hash>.csv"`. 6,952 lines from 1998-01-01 to 2026-10-27 (410 KB), row format `YYYY-MM-DD/00:00:00,ref,high,low,close,volume`. Close for 2026-10-25 is 49234.35; TradingView's EGX30 for that day is 49234.3, so the sources agree.
- The fixture `tests/fixtures/mubasher-index-EGX30.csv` (300 lines, commit e401e10) has 8 duplicate dates, so the parser (keep the first) yields 292 rows (G3 report).
- EGX 70 and EGX 100 Mubasher CSVs end in 2019 and 2020 (old price indices); no Mubasher page exists for the capped, TR, Shariah or volatility indices. Mubasher backfills EGX 30 only.
- **Daily closes**: `main` already stores the snapshot's TradingView closes for `EGX30`, `EGX30CAPPED`, `EGX70EWI` and `EGX100EWI` in `index_values` (`src/jobs/end-of-day.ts` `writeIndexValues`, `src/store/d1/bars.ts` `insertIndexValues`). `src/store/d1/closes.ts` `indexCloseAt` already reads them for `compare_funds`.
- The CSV is parsed only by the local script (constitution III).

## R3. Egypt gold pound

- `tests/fixtures/isagha-gold.html` has exactly one `tr[data-testid="prices-row"][data-unit="pound"]` row with figures `50400, 154, 50040, 104` (sell, sell gap, buy, buy gap), checked 2026-10-28. `src/providers/gold-egypt.ts` already reads sell at index 0 and buy at index 2, so adding `"pound"` to its gold units is enough.
- The KV shape `EgyptMetals.gold: Record<string, BuySell>` already accepts the extra key; no migration of `snapshot:v1`. A snapshot written before the change has no `pound` key and the tool answers `not_available` for it.

## R4. Provenance shape

- `meta.source` and `meta.dataTime` describe one source per response and stay for compatibility. They cannot say "breadth is computed from the backup stock source while indices come from TradingView".
- **Decision**: `meta.provenance: { fields, source, dataTime, timeKind, stale, basis }[]`, one entry per distinct (source, kind of value) group, `fields` naming the top-level `data` keys covered.
  - `basis`: `primary` is the configured primary source's own value, `backup` a fallback source's value, `computed` a value derived by the server.
  - `timeKind`: `trade` (provider trade or update instant), `fetched` (when the server fetched a page with no timestamp, or built a stored reference set), `close` (a date-only end-of-day value: a session close or a published daily NAV), `period` (the period a reported figure covers: a financial period end, an ex-date, a CPI month). `period` is new in the replan, because fundamentals and CPI figures are neither trades nor closes.
- **Rejected**: a numeric confidence score (no defensible way to compute it); per-value provenance on every number (payload growth with no extra information).

## R5. Contract test feasibility

- `@modelcontextprotocol/server` 2.3.1 validates `structuredContent` against the registered output schema after every non-error call; on a mismatch it returns `isError: true` with `Output validation error: ...` and no `structuredContent`. So "matches its schema" is asserted by: a success has `structuredContent`, and an error has `structuredContent.error.code` in the known list.
- `tests/unit/server.test.ts` already drives `createServer` over `InMemoryTransport` on Node. `tests/helpers/sqlite-d1.ts` (on `main`) gives a D1 on `node:sqlite` with both migrations, used by `tests/unit/funds-store.test.ts`. KV access in `src/store/kv.ts` is only `env.DATA.get(key, { type: "json" })` and `env.DATA.put(key, text)`. A Map-backed KV and a stub `RATE_LIMITER` are therefore enough to call every tool on Node.
- **Decision**: the all-tools guard and the new tools' contract tests run on Node (`tests/unit`), so they really go red and green on this machine. The kv memo is module-global, so the harness calls `__resetKvMemo()` before every call.

## R6. Test runner status (re-checked at 70fd4d1)

- `npm run typecheck`: PASS (after `npx wrangler types`, which writes the ignored `worker-configuration.d.ts`).
- `npx vitest run --project node` and the whole suite `npx vitest run`: fully green, 1175 tests on `main`, no known baseline failures. This is the baseline.

## R7. State of the first build (branch `pipeline/claude-market-data-extensions`, commits e401e10..8d8d7b3, base b9b575d)

`git apply --check` of each commit on 70fd4d1:

| Commit | Content | Applies | Decision |
|---|---|---|---|
| e401e10 | old spec files, EGX 30 CSV fixture and its fixtures README row | yes | Fixture and README row reused (T001). Spec files replaced by this replan. |
| 7dd0041 | T001 probe URL | yes | Cherry-pick (T001). |
| e49df75 | T002 `tests/raw.d.ts`, `clearState` line, `seedIndexCloses` | no (`raw.d.ts` exists on `main`, `bindings.ts` changed) | Dropped. The new contract tests seed the Node D1 directly. |
| 236f033 | T003 T004 provenance types, schema, `provenance.ts`, its test, tool builders | no (`market.ts`, `quotes.ts` conflict) | Reuse the files that apply (`envelope.ts`, `output-schema.ts`, `provenance.ts`, `tests/unit/provenance.test.ts`, `tests/unit/envelope.test.ts`) (T003); redo every tool builder (T005 to T013). |
| 7673d22 | T005 provenance assertions in 5 Workers contract tests | yes | Cherry-pick after the tool builders, then fix the 2 G2 findings it carries (T014). |
| 0fa1481 | T006 to T008 `index-csv.ts`, `index-analytics.ts`, tests, `addDays` | yes | Cherry-pick (T015), then replace `addDays` by the existing `shiftDays` and the private percent helper by `percentChange` (no duplication with `src/domain/returns.ts`). |
| 964e656 | T009 `tests/jobs/index-closes.test.ts` | yes | Dropped: it tests the superseded `storeIndexCloses` job. |
| 963b3ab | T010 `src/store/d1/indices.ts`, `src/jobs/index-closes.ts`, end-of-day hook | no (`end-of-day.ts`) | Dropped: `main` stores closes already. The series read is redone in `closes.ts` with the G4 query fix (T016). |
| 8d8d7b3 | T011 backfill script and `backfill:indices` script entry | yes | Cherry-pick (T019), then apply the G4 fixes. |

## R8. Review findings carried into this plan

G2 review (FAIL, 2026-10-28):
- daily summary close `dataTime` must be the session date: fixed in the contract (`closeProvenance`, T006) and in the cherry-picked test (T014).
- `tests/contract/search.test.ts` reseeds an empty directory where it means "missing": T014 tests both a deleted directory key and an empty directory, both `[]` (the builder treats empty like missing, T005).
- `availableEntries` duplicated `availableIndices` in `market.ts`: one `availableIndexEntries(snapshot)` feeds both the items and the provenance (T006).

G4 code review (unadjudicated, adjudicated here against `main`):

| Finding | Applies to `main`? | Decision |
|---|---|---|
| closes read only from `snapshot:last-session`; one failed tick loses all closes | No: `main` reads the live snapshot | Closed. Recovery from the per-date closes key added for a failed day (FR-002, T018). |
| `markJobRun` before the closes step; a transient failure leaves a permanent hole | Yes (job runs once a day) | T018: the snapshot job keeps the window-end closes under `snapshot:index-closes:<date>` and the next runs store them (insert-only, idempotent); `snapshot:last-session` cannot serve because the next day's window end overwrites it first. |
| only a date check on `tt`; intraday or carried values stored as the close | Partly | T017: job waits until the refresh window has ended (`>=` its end, because the cron fires only at 12:30 and 13:30 UTC), so the snapshot holds the closing values; the `tt` date check stays and drops carried values. First-wins kept (spec clarification). |
| `MIN(session_date) GROUP BY` scans the full history per code | Yes for the new read | T016: per-code correlated `MIN` subquery over `json_each`, one PK seek per code. |
| `raiseNotices` for the new step can throw before `syncListings` | No: `main` runs listing sync first and isolates every step | Closed. T018 adds a test that a failing `indexValues` step does not stop later steps. |
| backfill counter uses the generated row count, dated at generation | Yes | T019: the SQL adds `changes()` after each insert chunk on `date('now')`. |
| zero storable closes on a trading day is a silent gap | Yes | T018: the step throws, so one `job_failed` notice is raised. |
| `RUN_FROM_TIME` 15:30 races the last snapshot on special hours closing at or after 15:15 | Yes | T017: strict comparison against the window end plus a third end-of-day cron hour (14 UTC) and snapshot cron hours 6-13. |
| no test for a D1 or KV failure inside the step with listing sync still running | Yes | T018 acceptance line. |
| backfill fetch has no timeout | Yes | T019: shared `PROVIDER_TIMEOUT_MS`. |
| `--out` ignores bad input and prints an unquoted path | Yes | T019. |
| `USER_AGENT` copied a third time | Yes | T019: shared zero-import `src/providers/request-defaults.ts`. |
| redundant `?? 0` on `meta.rows_*`; `readIndexSeries` unused | No (dropped code) | Closed. |
| serial awaits in the script | No: the CSV URL comes from the page, so the two requests are dependent | Closed, recorded. |
