# Feature Specification: Market data extensions

**Feature Branch**: `004-market-data-extensions` (built on `pipeline/market-data-extensions`, delivered squash-local as `feat/market-data-extensions`) | **Created**: 2026-10-28 | **Replanned**: 2026-10-28 onto `main` 70fd4d1 | **Status**: Planned

**Input**: Three ideas from competitor research. (1) Index history and summary analytics for EGX indices (history with daily, weekly and monthly downsampling; latest, previous close, daily change, period high, low and return, SMA20, SMA50, annualized volatility, drawdown from the period high, 5-session return; comparison of several indices), first choice of source the EGX endpoint `getIndexChartData` (7 codes: EGX30, EGX30_TR, EGX30_CAP, EGX70_EWI, EGX100_EWI, EGX_33_Shariah, EGXVolatility). (2) Gold prices in Egypt in EGP, including the gold pound. (3) Per-field provenance and confidence in every tool response, extending the existing `meta` envelope, plus a contract test that runs every registered tool.

## Replan note (2026-10-28)

The first plan was made on `b9b575d`. Since then `main` shipped `get_metals` and `get_usd_egp` (iSagha and TradingView providers, the `metalsFx` refresh in the snapshot and reference jobs), the end-of-day `indexValues` step that stores index closes in `index_values`, the price history and mover tools, the personal tools, and the fund and fundamentals tools. This spec keeps only the work that is still missing:

- Index history: the stored closes now exist on `main`. What remains is the EGX 30 backfill, two read tools, hardening of the end-of-day step (review G4) and the EGX endpoint probe.
- Gold: what remains is the gold pound and honest staleness for metals and FX.
- Provenance: it now covers 30 tools (28 on `main` including `admin`, plus the 2 new index tools) and the error envelope.

## Clarifications

### Session 2026-10-28 (owner, option A for all three, unchanged by the replan)

- Q: The EGX endpoint `getIndexChartData` resets the connection from the owner's desktop and from a second network. Which source feeds index history? -> A: stored daily closes. EGX 30 gets about 5 years from the Mubasher index CSV through a one-off local backfill; EGX 30, EGX 30 Capped, EGX 70 EWI and EGX 100 EWI get one close per trading day from the delayed snapshot (already stored by `main`). The EGX endpoint, which would add EGX 30 TR, EGX 33 Shariah and the EGX volatility index, stays out of this feature until the owner's deployed probe passes. This feature adds that endpoint to the probe.
- Q: How does gold fit with 001 User Story 9? -> A: full metals plus the gold pound. Since `main` already delivers the rest of User Story 9, this feature adds the gold pound and the metals and FX staleness rules.
- Q: What tool surface does index analytics get? -> A: two new tools, `get_index_history` and `get_index_summary`. `get_indices` is unchanged apart from provenance.

### Replan decisions (planner, 2026-10-28, within the owner's choices)

- Provenance is computed by pure functions and checked by tests that run on Node (an in-memory D1 on `node:sqlite` and an in-memory KV), because the Workers test pool cannot start on this machine (research R6).
- Index closes stay insert-only (first stored close wins). Mubasher and TradingView publish the same EGX 30 close (research R2), so a correction path is not needed now.

## User Scenarios and Testing

### User Story 1: Index history and trend analytics (Priority: P1)

A user asks how an EGX index moved over a period ("How did EGX30 do over the last year, and how volatile was it?"). The server returns the stored daily closes, optionally downsampled to weeks or months, and a summary with the latest close, the daily change, the period high, low and return, moving averages, volatility, drawdown and the 5-session return. A comparison across indices names the index with the highest period return.

**Why this priority**: Index closes are already stored every trading day; history is the first question that follows a live index value.

**Independent Test**: Seed stored closes for EGX30 and EGX70EWI in the in-memory D1. Call `get_index_history` with `interval: "weekly"` and check that the points are the last session of each Sunday to Thursday week. Call `get_index_summary` with both indices and compare every metric with the pure `summarize` function on the same rows.

**Acceptance Scenarios**:

1. **Given** stored EGX30 closes for the last 400 days, **When** the user asks for 365 days of daily history, **Then** each stored close in that window comes back oldest first with its date and source, and the response states the earliest stored date.
2. **Given** the same data, **When** weekly or monthly history is requested, **Then** each point is the last close of its week (weeks end on Thursday) or month, dated with that close's own session date.
3. **Given** more points than `maxRows`, **When** history is requested, **Then** only the most recent `maxRows` points are returned and `truncated` is true.
4. **Given** at least 51 stored closes, **When** a summary is requested, **Then** every metric of FR-005 is returned. With fewer closes, each metric that lacks data is `null` and `meta.notAvailable` names it.
5. **Given** 2 or more indices, **When** a summary is requested, **Then** each index has its own summary and `highestReturn` names the index with the highest period return; ties go to the earlier request position.
6. **Given** a known index with no stored closes (for example EGX30USD), **When** history or a summary is requested, **Then** it is reported as not available with a reason, never as an error.
7. **Given** a name that is not an index, **When** it is requested, **Then** history answers with the `not_found` error and the summary marks that input `not_found` in its position.
8. **Given** the end-of-day step failed for yesterday, **When** today's end-of-day job runs, **Then** yesterday's closes are stored from the per-date closes kept by the snapshot job.

### User Story 2: Gold pound and honest metals freshness (Priority: P2)

A user asks "What is the gold pound price in Egypt today?" `get_metals` returns the gold pound (EGP per piece) next to 18K, 21K and 24K per gram and silver, and every metals and FX answer says when its values are stale.

**Why this priority**: The rest of the metals story already ships on `main`; the pound is the owner's addition, and staleness is required by constitution I.

**Independent Test**: Parse the iSagha fixture and check the pound row; call `get_metals` and `get_usd_egp` on seeded snapshots with fresh and old times.

**Acceptance Scenarios**:

1. **Given** current iSagha prices, **When** the user asks for gold, **Then** `goldPound` comes back with buy 50040, sell 50400 (fixture), unit `EGP/piece`, source `isagha` and the fetch time labeled `fetched`.
2. **Given** a stored snapshot from before this feature (no pound), **When** `get_metals` is called, **Then** `goldPound` is `not_available` and every other item is served.
3. **Given** Egypt prices fetched more than 26 hours ago, **When** `get_metals` is called, **Then** `meta.stale` is true with a reason naming the fetch time, and the Egypt provenance entry is stale.
4. **Given** global spot or the USD/EGP rate with a trade time more than 72 hours old, **When** the tool is called, **Then** that value is flagged stale with a reason.

### User Story 3: Provenance on every answer and a contract guard (Priority: P1)

Every tool answer states, for each part of its data, the source, the data time and what kind of time it is, whether it is stale, and whether the value is the primary source's value, a backup source's value or a value the server computed. A contract test calls every registered tool and fails if any tool throws a protocol error, returns output that does not match its schema, returns non-finite numbers, omits the notice or the provenance, calls an upstream provider, or uses advice words.

**Why this priority**: Users make financial decisions from these answers (constitution I and III). The guard keeps every future tool honest at no runtime cost.

**Independent Test**: The all-tools test enumerates `tools/list` on an in-memory server and needs no edit when a tool is added, except a sample input.

**Acceptance Scenarios**:

1. **Given** quotes served by the backup stock source, **When** `get_quotes` is called, **Then** `meta.provenance` has an entry for `quotes` with that source, basis `backup`, the newest trade time and `timeKind: "trade"`.
2. **Given** the daily summary, **When** it is called, **Then** both entries have `timeKind: "close"` and `dataTime` equal to the session date (review G2).
3. **Given** a missing or empty symbol directory, **When** `search` is called, **Then** `meta.provenance` is empty (review G2).
4. **Given** a tool whose stores are empty, **When** it is called, **Then** it returns an error result with a known error code, or an `ok` result whose provenance is empty because no market value is returned. It never returns a protocol error or an output validation error.
5. **Given** any error result, **When** it is returned, **Then** `meta.provenance` is `[]`.
6. **Given** a new tool registered without a sample input, **When** tests run, **Then** the contract test fails and names the tool.

### Edge Cases

- A trading day with no session (`noTradesToday`): no index close is stored and no failure is reported.
- A trading day with quotes for the session but no index entry dated that day: the `indexValues` step fails and raises one `job_failed` notice (review G4).
- Special hours closing at or after 15:15: the end-of-day job waits until the snapshot refresh window has ended, so the last snapshot is the closing one (review G4).
- Two sources hold the same index and date (Mubasher backfill and the snapshot close): the first stored row is kept.
- Weekly buckets over a holiday week or a single-session week still hold the last close of that week.
- `days` outside 1 to 1825, or `maxRows` outside 1 to 500, or more than 5 indices: `invalid_input`.
- Volatility with fewer than 3 closes in the period, a 5-session return with fewer than 6 closes, an SMA with fewer closes than its length: `null` plus a `notAvailable` entry naming the metric.
- A close of 0 or a non-finite value is never stored by the backfill. All returned numbers are finite or `null`.
- Weekend: global spot trade times can be about 2 days old; they are flagged stale only after 72 hours.

## Requirements

### Functional Requirements

- **FR-001**: Stored index closes MUST keep one close per index and session date with its source, insert-only, never deleted.
- **FR-002**: The end-of-day `indexValues` step MUST store the closes of the live snapshot for today's session and, when missing, the closes the snapshot job kept for earlier session dates. It MUST fail (one `job_failed` notice) when today's session has quotes but no index close dated today.
- **FR-003**: The end-of-day job MUST NOT start before the snapshot refresh window of the day has ended (and never before 15:30 Cairo).
- **FR-004**: A one-off local script MUST write the SQL to backfill about 5 years of EGX 30 closes from the Mubasher index CSV, count only the rows actually inserted against the daily backfill allowance on the day the SQL runs, time out its requests, and never run wrangler itself.
- **FR-005**: `get_index_history` MUST return the stored closes of one index over the last `days` calendar days (1 to 1825, default 365), at `daily`, `weekly` (week ending Thursday) or `monthly` interval, limited to the most recent `maxRows` points (1 to 500, default 500), with `truncated` and `earliestAvailable`.
- **FR-006**: `get_index_summary` MUST return, for 1 to 5 indices over `days` (1 to 1825, default 365): latest close and date, previous close, daily change and percent, period high and low with dates, period return percent, SMA20, SMA50, annualized volatility percent (sample standard deviation of daily simple returns times the square root of 252, times 100), drawdown from the period high percent, 5-session return percent, the number of closes used and the sources; with 2 or more indices also `highestReturn`.
- **FR-007**: The index tools MUST read only stored data and MUST count their rows read against the caller's and the global read limits.
- **FR-008**: `get_metals` MUST return `goldPound` (EGP per piece) with buy, sell, source and fetch time, and MUST flag Egypt retail prices stale after 26 hours and global spot after 72 hours. `get_usd_egp` MUST flag the rate stale after 72 hours.
- **FR-009**: Every tool response (success and error) MUST carry `meta.provenance`: a list of entries `{ fields, source, dataTime, timeKind, stale, basis }`, `timeKind` one of `trade`, `fetched`, `close`, `period`, `basis` one of `primary`, `backup`, `computed`. Every `data` key that carries a market value MUST be covered by at least one entry; error results carry `[]`.
- **FR-010**: A contract test MUST enumerate the tools from `tools/list`, require a sample input for each, call each with full and with empty stores, and assert: no protocol error; the text content is the JSON of `structuredContent`; every number is finite; a success carries `data`, `meta` with `provenance` and the exact notice; an error carries a known error code; no upstream fetch happens; no string value uses advice words.
- **FR-011**: Tools MUST state facts and calculations only. `highestReturn` is a reported fact, never a recommendation.
- **FR-012**: The README MUST list the two new tools with an example question, name Mubasher as the source of the EGX 30 index history backfill, mention the gold pound, and give the owner's backfill and probe steps.

### Key Entities

- **Index close**: index code, session date, close, change percent (nullable), source. One row per code and date (existing table `index_values`).
- **Index summary**: the computed metrics of FR-006 for one index and window.
- **Egypt retail metals**: buy and sell per unit for gold 18, 21, 24 and the pound and silver 925 and 999, with the fetch time and source.
- **Provenance entry**: fields covered, source, data time, kind of time, stale flag and basis.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For seeded data, every summary metric equals the pure computation on the same closes after the tool's rounding.
- **SC-002**: A one-year daily history of one index reads at most about 260 stored rows; a 5-year summary of 5 indices reads at most about 6,500.
- **SC-003**: 100% of registered tools (30) pass the contract test with full and with empty stores.
- **SC-004**: No answer older than its freshness rule (26 hours for Egypt retail metals, 72 hours for spot and FX, the last completed session for quotes and closes) is shown without `stale: true`.
- **SC-005**: The feature adds no cron trigger, no binding, no migration and no dependency, and at most 1 KV read and 4 D1 row writes per trading day.

## Assumptions

- The Mubasher EGX 30 CSV (`historical-data-url` on `https://english.mubasher.info/markets/EGX/indices/EGX30`) stays reachable. Its EGX 70 and EGX 100 files stop in 2019 and 2020 (old price indices), so they are not used.
- The gold pound is 8 grams of 21K; iSagha publishes it as its own row (fixture: sell 50400, buy 50040).
- `index_values` already receives the snapshot's 4 TradingView index closes each trading day (`main`, end-of-day `indexValues` step).
