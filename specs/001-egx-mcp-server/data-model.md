# Data Model: EGX MCP Server

**Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Storage split (constitution, Platform constraints): KV holds the quote snapshot under one key plus two daily read models; D1 holds everything else. Migration file: `migrations/0001_initial.sql` (first migration of a new repository).

Conventions: dates are `TEXT` `YYYY-MM-DD` in Africa/Cairo; instants are `INTEGER` Unix seconds UTC; money and prices are `REAL` in the instrument's currency; every market figure row has `source TEXT NOT NULL`. Tables keyed by natural composite keys use `WITHOUT ROWID` so the primary key is the only B-tree (no extra index writes).

## D1 tables

### symbols
| Column | Type | Rules |
|---|---|---|
| isin | TEXT PK | 12 chars, `^[A-Z]{2}[A-Z0-9]{9}[0-9]$` |
| ticker | TEXT NOT NULL | current ticker, uppercase |
| name_ar | TEXT | |
| name_en | TEXT | |
| sector | TEXT | |
| market | TEXT NOT NULL | `main` or `nilex` (defaults to `main`; no source flags Nilex yet) |
| index_codes | TEXT NOT NULL DEFAULT '[]' | JSON array of index codes; no source fills it yet, so it stays `[]` and the profile marks index membership not available |
| status | TEXT NOT NULL | `pending`, `active`, `inactive` |
| shares_outstanding | REAL | |
| free_float_shares | REAL | |
| first_trade_date | TEXT | from backfill (listing date proxy, risk S8) |
| adj_basis_date | TEXT | last session date of the Mubasher CSV used by the backfill; actions with `ex_date <= adj_basis_date` are already inside the `adj_*` prices of backfilled rows (`raw_derived = 1`); null when the symbol was not backfilled. Set by the backfill's loading statement for the symbol, which runs and commits on its own before the script reads the symbol's applied actions and before any of its rows |
| backfill_state | TEXT | null (never backfilled), `loading` (set with `adj_basis_date` by the loading statement, committed before the applied actions are read and before any row), `done` (set in the symbol's last file, after its rows). No action of the symbol is applied while `loading` |
| missing_sessions | INTEGER NOT NULL DEFAULT 0 | consecutive sessions absent from the listing source |
| created_at, updated_at | INTEGER NOT NULL | |

Index: `idx_symbols_ticker ON symbols(ticker)` (ticker lookup in jobs and admin). State: `pending` (new, notice raised) to `active` (first quote stored) to `inactive` (`missing_sessions >= 5`) and back to `active` if it reappears. Rows are never deleted.

### symbol_aliases (WITHOUT ROWID)
PK `(isin, kind, value)`. `kind`: `ticker`, `name_ar`, `name_en`, `provider`. `provider` TEXT (for `kind = provider`, for example `tradingview` with value `EGX:COMI`). `first_seen`, `last_seen` INTEGER (`last_seen` is rewritten only when the stored value is more than 7 days older, so the daily upsert does not rewrite every alias). Keeps old tickers and names so search finds both (edge case: renames). An ISIN seen with two tickers keeps both rows.

### daily_bars (WITHOUT ROWID)
PK `(isin, session_date)`. Columns: `open, high, low, close REAL NOT NULL`, `volume REAL NOT NULL`, `value REAL`, `adj_open, adj_high, adj_low, adj_close REAL NOT NULL`, `adj_factor REAL NOT NULL DEFAULT 1` (product of the factors of `applied` actions with `ex_date` after this date), `raw_derived INTEGER NOT NULL DEFAULT 0` (1 for backfilled rows, whose raw was derived from the source-adjusted CSV; 0 for rows written from a quote), `source TEXT NOT NULL`. Validation: `low <= min(open, close)`, `high >= max(open, close)`, `volume >= 0`. Missing provider values: when `open`, `high` or `low` is null, it is set to `close`, then `high = max(high, open, close)` and `low = min(low, open, close)`, and `source` gets the suffix `+filled` (for example `tradingview+filled`). Raw columns change after insert only by a backfill correction or by the raw re-derivation of backfilled rows described under `corporate_actions`.

### index_values (WITHOUT ROWID)
PK `(index_code, session_date)`. `close REAL NOT NULL`, `change_pct REAL`, `source TEXT NOT NULL`.

### corporate_actions
`id INTEGER PK`, `isin TEXT NOT NULL`, `kind TEXT NOT NULL` (`cash_dividend`, `bonus`, `split`, `reverse_split`, `rights`, `name_change`, `other`), `announced_on TEXT`, `ex_date TEXT NOT NULL`, `ratio REAL` (per kind, checked in code by `validateRatio` and by a `CHECK`: bonus `0 < ratio <= 10`, split `ratio > 1`, reverse split `0 < ratio < 1`, any other kind `ratio > 0`; bonus: bonus shares received per share held, so "1 for 4" is 0.25; split and reverse split: shares held after per share held before, so a 2 for 1 split is 2 and a 1 for 10 reverse split is 0.1), `amount REAL` and `currency TEXT` (dividends), `status TEXT NOT NULL` (`needs_ratio`, `recorded`, `applied`, and the transient `adjusting` described below), `source TEXT NOT NULL`, `source_text TEXT`, `created_at, updated_at INTEGER`.
- Unique: `ux_actions ON corporate_actions(isin, kind, ex_date)` (idempotent upsert from Mubasher).
- Index: `idx_actions_ex_date ON corporate_actions(ex_date)` (dividend calendar range).
- Partial index: `idx_actions_unapplied ON corporate_actions(ex_date, isin) WHERE status IN ('needs_ratio', 'recorded') AND kind IN ('bonus', 'split', 'reverse_split')`. Only unapplied price-changing actions are in it (a few dozen rows), so the pending lookups and the apply queue never scan dividends or applied rows. Every query meant to use it repeats that `WHERE` text verbatim (SQLite uses a partial index only when the query implies its predicate).

#### Adjustment state machine (bonus, split, reverse split)

Terms: `f` is the action factor (`1 / (1 + ratio)` for bonus, `1 / ratio` for split and reverse split). `L` (latest stored session) is `job_state.last_run_date` of job `eod_bars`, which the end-of-day `bars` step sets to the session date after it writes that day's bars; null before the first bars run. `B` is the symbol's `adj_basis_date` (bound as `''` when null). "Pending" means status `needs_ratio` or `recorded`.

| From | Event | To |
|---|---|---|
| (new) | inserted without a ratio (Mubasher daily job, backfill `--actions`) | `needs_ratio`, one `needs_ratio` notice (subject `<ticker> <kind> <exDate>`) |
| (new) | inserted with a ratio (`admin add_corporate_action`) | `recorded`, then an apply attempt |
| `needs_ratio` | `admin set_action_ratio` | `recorded` (ratio stored), then an apply attempt |
| `recorded` | apply attempt that passes every guard | `applied` (terminal) |
| `recorded` | apply attempt refused by a guard | stays `recorded` (queued); the end-of-day job retries |
| `applied` | `admin revert_action` that passes guards (3) and (4) | `needs_ratio` (ratio cleared, bars restored with factor `1 / f`, `needs_ratio` notice open), then a corrected ratio follows the rows above |

`adjusting` exists only inside one adjustment batch: the batch's first statement sets it and its last statement replaces it, and the batch is one transaction, so `adjusting` is never committed and no statement outside the batch sees it.

Apply guards: (1) status is `recorded` and `ratio` is set; (2) `L` is not null and `ex_date <= L`, so every bar dated before the ex date is already stored and no later end-of-day bar can fall before it (the `bars` step writes only bars dated `L`, and `L >= ex_date`); (3) `symbols.backfill_state` is not `loading`; (4) today's `usage_global.adjust_rows` plus the batch's rows, `n + 8` (`n` = bars of the symbol dated before the ex date; 8 bounds the rows the gate, (d), (e) and (c) write with their index entries), stays within `ADJUST_MAX_ROWS_PER_DAY`. `applyAdjustment` first checks them on the candidate row of one read statement (`readApplyCandidates`) through the pure `applyRefusal`, so a refusal (`ex_date_not_reached`, `backfill_loading`, `daily_cap`, `not_recorded`) writes nothing and sends no batch. The batch's gate statement then checks all four again in SQL inside the same transaction, so a change between the read and the batch (a concurrent attempt, a backfill setting `loading`, another batch using the day's rows) makes the whole batch write nothing (result `concurrent_change`).

Apply step: one `batch()` (one transaction) of 6 statements in this order, with `f`, `ex_date`, `B`, the action id, the UTC day and `ADJUST_MAX_ROWS_PER_DAY` bound as parameters: (g) the gate `UPDATE corporate_actions SET status = 'adjusting' WHERE id = ? AND status = 'recorded' AND ratio IS NOT NULL AND ex_date <= (SELECT last_run_date FROM job_state WHERE job = 'eod_bars') AND NOT EXISTS (SELECT 1 FROM symbols WHERE isin = ? AND backfill_state = 'loading') AND COALESCE((SELECT adjust_rows FROM usage_global WHERE day = ?), 0) + (SELECT COUNT(*) FROM daily_bars WHERE isin = ? AND session_date < ?) + 8 <= ?`; (a) `adj_open, adj_high, adj_low, adj_close, adj_factor` multiplied by `f` for rows `isin = ? AND session_date < ex_date AND (raw_derived = 0 OR ex_date > B)` (rows whose adjusted prices do not yet include the action); (b) raw `open, high, low, close` divided by `f` and `adj_factor` multiplied by `f` for rows `isin = ? AND session_date < ex_date AND raw_derived = 1 AND ex_date <= B` (backfilled rows whose CSV prices already include the action; only their raw changes); (d) the `usage_global.adjust_rows` upsert adding the same in-batch `COUNT(*)` plus 8; (e) the action's open `needs_ratio` notice set to `done`; (c) `UPDATE corporate_actions SET status = 'applied', updated_at = ? WHERE id = ? AND status = 'adjusting'`. Statements (a), (b), (d) and (e) carry `AND EXISTS (SELECT 1 FROM corporate_actions WHERE id = ? AND status = 'adjusting')`, so they act only when this batch's gate passed: a second attempt for the same action finds it `applied` and writes nothing, and a batch refused by the gate writes no bar, no counter and no notice. (a) and (b) match disjoint rows and together cover every bar before the ex date, so `adjust_rows` grows by at least the batch's total `meta.rows_written`.

Revert step (`admin revert_action`, recovery from a wrong ratio): the same 6-statement batch, built by the same function, with factor `1 / f` (`f` from the stored ratio), a gate from `status = 'applied'` that checks guards (3) and (4) only, (e) reopening the action's `needs_ratio` notice (`INSERT ... ON CONFLICT(dedupe_key) DO UPDATE SET status = 'open', done_at = NULL`) and (c) `SET status = 'needs_ratio', ratio = NULL`. Every bar returns to its value before the apply, and the bars are labeled again until a corrected ratio is applied.

Backfilled rows (`raw_derived = 1`, all dated on or before `B`): the backfill sets `symbols.adj_basis_date = B` and `backfill_state = 'loading'` with its own `wrangler d1 execute` statement, committed before the script reads the symbol's `applied` actions and before any row is generated, and sets `backfill_state = 'done'` at the end of the symbol's last file. An apply committed before the loading statement is in the set the script reads; an apply attempted after it is refused by the gate, which checks guard (3) in SQL in the apply transaction. So the set of `applied` actions of the symbol cannot change between that read and the symbol's last file. Each CSV row (date `d`) is written with: `adj_*` = CSV price times the product of `f` over `applied` actions with `ex_date > B` (these are not in the CSV); raw = CSV price divided by the product of `f` over `applied` actions with `d < ex_date <= B`; `adj_factor` = product of `f` over `applied` actions with `ex_date > d`. Pending actions are never used in this derivation; they are handled later by the apply step above.

Non-price kinds (`cash_dividend`, `rights`, `name_change`, `other`) are inserted as `recorded`, which is terminal for them; they never adjust prices and never label bars.

#### Pending labels (owner decision Q1a)

Every pending bonus, split or reverse split with `ex_date <= today` (Cairo) labels each bar of that symbol dated before its ex date: `rawPending` when `raw_derived = 1 AND ex_date <= B` (adjusted prices already include it; raw does not), otherwise `adjustmentPending` (adjusted prices do not include it). Actions with a future ex date label nothing (no stored bar is on or after the ex date, so no false drop exists yet). `applied` actions never label. Each pending item carries `state` (`needs_ratio` or `queued`) and `reason`: `needs_ratio` gives "not yet adjusted: awaiting the owner's ratio"; `recorded` gives "not yet adjusted: adjustment queued" plus a cause derived at read time: "until the ex-date session is stored" when `ex_date > L`, "until the backfill of this symbol finishes" when `backfill_state = 'loading'`, else "daily adjustment limit reached; a later end-of-day run applies it". The labels are derived at read time, so applying an action clears them with no extra writes, and they disappear only when the action is `applied`.

Lookups (`pendingForIsins` is served by `ux_actions` (isin, kind, ex_date); `pendingAll` and the apply-queue read use `idx_actions_unapplied`; at most 1 bound parameter for the symbol list):
- `pendingForIsins(db, isins, today, from)`: `... WHERE status IN ('needs_ratio', 'recorded') AND kind IN ('bonus', 'split', 'reverse_split') AND isin IN (SELECT value FROM json_each(?1)) AND ex_date <= ?2`, joined to `symbols` for `adj_basis_date` and `backfill_state`, with the scalar `L` and a per-action `adjAffected` column: `EXISTS (SELECT 1 FROM daily_bars b WHERE b.isin = a.isin AND b.session_date >= ?3 AND b.session_date < a.ex_date AND (b.raw_derived = 0 OR a.ex_date > COALESCE(s.adj_basis_date, '')))` (true when some bar from `from` on has adjusted prices missing the action). Used by history (1 symbol) and compare (2 to 5 symbols).
- `pendingAll(db, from)`: the same statement without the `isin` filter and without the `ex_date <= today` filter (every unapplied price-changing action, a few dozen rows), used by the end-of-day `stats` step. A `stats:v1` built on day D therefore also holds actions whose ex date is after D, and the tools that read it keep only entries with `exDate <= today` at read time, so an action whose ex date is the next session is labeled from that session on, before the next stats build.

`stats:v1` `pendingAdj` entries are `{ actionId, kind, exDate, state, adjAffected }` with `from` = the 400-day stats window start; stats-based items (`get_movers` 52-week kinds, `get_52_week_range`, `get_sector_performance`) set `adjustmentPending` only when an entry has `exDate <= today` (read time) and `adjAffected` true.

#### Invariants (asserted by T068, T070 and T102)

1. INV-1 Once only: each action's factor enters a bar's `adj_*` (or divides its raw) at most once; an `applied` action is never applied again, and two concurrent attempts change the bars once (the gate moves the action to `adjusting` only from `recorded`, and every other statement of the batch requires `adjusting`).
2. INV-2 No early apply: an action becomes `applied` only when `ex_date <= L`. Case: a ratio entered before the ex date leaves the action `recorded` with reason `ex_date_not_reached`, no bar changes and no label; the first end-of-day run with `L >= ex_date` applies it after writing that day's bars, and the adjusted close is continuous across the ex date.
3. INV-3 Complete apply: when an action becomes `applied`, every stored bar dated before its ex date has the factor (in `adj_*` for (a) rows, in raw for (b) rows), and every bar written later before its ex date already includes it (backfill derivation above).
4. INV-4 Raw from applied only: backfilled raw prices are derived only from `applied` actions; a `recorded` or `needs_ratio` action never changes a backfilled raw value before it is applied.
5. INV-5 Backfill isolation: `adj_basis_date` and `backfill_state = 'loading'` are committed by their own statement before the script reads the symbol's applied actions and before its first row; no action of the symbol is applied while `loading`, checked again in SQL by the gate. Interleaving case: an apply whose candidate was read before the loading statement and whose batch runs after it writes nothing (`concurrent_change`). Case: an action whose ratio is entered on day 2 of a 3-day load of that symbol stays `recorded` (reason `backfill_loading`, bars labeled); after the last file sets `done`, the next end-of-day run applies it once and rows from all three files end up consistent.
6. INV-6 Honest labels: every pending price-changing action with `ex_date <= today` labels every bar before its ex date (`adjustmentPending` or `rawPending`, with `state` and `reason`), whether it waits for a ratio, for the daily cap or for a backfill, including in tools that read a `stats:v1` built before the ex date.
7. INV-7 Notice lifetime: the `needs_ratio` notice stays `open` until the action is `applied`; it is closed by statement (e) of the same batch, never by `set_action_ratio` alone, and a revert reopens it.
8. INV-8 Bounded work: one end-of-day run applies at most `ADJUST_MAX_ACTIONS_PER_RUN` (2) actions and one admin call at most 3; rows written by adjustment batches per UTC day (bars before the ex date plus 8 per batch) stay within `ADJUST_MAX_ROWS_PER_DAY`, checked by the gate inside each batch, so concurrent end-of-day and admin batches cannot pass it together.

### funds
`fund_id TEXT PK` (for example `mubasher:6401`), `name_ar TEXT NOT NULL`, `name_en TEXT` (when the source provides it), `manager TEXT`, `currency TEXT NOT NULL DEFAULT 'EGP'`, `currency_inferred INTEGER NOT NULL DEFAULT 0` (1 when the source gave no currency and `EGP` was assumed; responses then say "currency assumed EGP"), `category TEXT` (from Mubasher `classification` when present), `cycle_days INTEGER NOT NULL DEFAULT 1` (median gap in trading days between the last 8 NAV dates, recomputed by the funds job), `status TEXT NOT NULL` (`active`, `stale`), `created_at, updated_at`.

### nav_records (WITHOUT ROWID)
PK `(fund_id, nav_date)`. `nav REAL NOT NULL > 0`, `source TEXT NOT NULL`, `fetched_at INTEGER`. Insert only when `nav_date` is new. Stale rule (FR-008): stale when the number of trading days from the latest `nav_date` to today is greater than `cycle_days + 1` (both counted in trading days).

### financial_figures (WITHOUT ROWID)
PK `(isin, metric, period_type, period_end)`. `metric`: `revenue`, `net_income`, `total_equity`, `total_debt`, `eps_basic`, `dps`. `period_type`: `FY`, `FQ`, `TTM`. `period_end TEXT` (or the fetch date when the source gives none, flagged by `period_inferred = 1`). `value REAL NOT NULL`, `currency TEXT NOT NULL`, `source TEXT NOT NULL`, `fetched_at INTEGER`. Upsert writes only when the value changed (`ON CONFLICT DO UPDATE ... WHERE value IS NOT excluded.value`).

### inflation_figures (WITHOUT ROWID)
PK `month TEXT` (`YYYY-MM`). `cpi_index REAL NOT NULL > 0`, `yoy_pct REAL`, `source TEXT NOT NULL` (for example `CAPMAS urban CPI`), `entered_by TEXT`, `entered_at INTEGER`.

### market_calendar (WITHOUT ROWID)
PK `date TEXT`. `kind TEXT NOT NULL` (`holiday`, `special_hours`), `open_time`, `close_time` TEXT `HH:MM` (required for `special_hours`), `note TEXT`. Owner-maintained through the admin tool or seed SQL.

### users
`id TEXT PK` (UUID), `google_sub TEXT NOT NULL UNIQUE`, `email TEXT NOT NULL`, `display_name TEXT`, `created_at INTEGER`, `deleted_at INTEGER`. Delete account (FR-036): one `batch()` deleting the user's `holdings`, `price_levels`, `api_keys`, `usage_daily` rows (a full scan of `usage_daily`, whose key starts with `day`; rare and user-initiated), the `usage_minute` row when migration 0002 exists, and the `users` row, plus OAuth grant revocation.

### api_keys
`id TEXT PK`, `user_id TEXT NOT NULL REFERENCES users(id)`, `prefix TEXT NOT NULL` (first 8 chars after `egx_`), `key_hash TEXT NOT NULL UNIQUE` (hex SHA-256 of the full key), `name TEXT`, `created_at INTEGER`, `last_used_at INTEGER`, `revoked_at INTEGER`.
- Index: `idx_keys_user ON api_keys(user_id, revoked_at)` (count active keys, list keys).
- Rules: at most 3 rows with `revoked_at IS NULL` per user, checked in the insert statement (`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < 3`). States: active to revoked (terminal). `last_used_at` updated only when older than 3,600 s.

### holdings
`id INTEGER PK`, `user_id TEXT NOT NULL`, `isin TEXT NOT NULL`, `quantity REAL NOT NULL > 0`, `cost_per_share REAL NOT NULL >= 0`, `acquired_on TEXT NOT NULL`, `created_at INTEGER`. Index `idx_holdings_user ON holdings(user_id)`. Limit 50 per user.

### price_levels
`id INTEGER PK`, `user_id TEXT NOT NULL`, `isin TEXT NOT NULL`, `direction TEXT NOT NULL` (`above`, `below`), `level REAL NOT NULL > 0`, `armed INTEGER NOT NULL DEFAULT 1`, `last_crossed_at INTEGER`, `created_at INTEGER`. Index `idx_levels_user ON price_levels(user_id)`. Limit 50 per user.
- States: `armed = 1` to crossed (price passes the level at check time: set `armed = 0`, `last_crossed_at = now`, reported in that response) to re-armed (price back on the other side). Checks happen in `portfolio_get` and `what_changed_since` against the snapshot; writes only on a state change, so each crossing is reported once (FR-034).

### market_events
`id INTEGER PK`, `kind TEXT NOT NULL` (`new_nav`, `big_move`, `new_listing`, `corporate_action`, `disclosure`), `occurred_at INTEGER NOT NULL`, `isin TEXT`, `fund_id TEXT`, `payload TEXT NOT NULL` (JSON). Index `idx_events_time ON market_events(occurred_at)`. Written by daily jobs only. Read with `WHERE occurred_at > ? ORDER BY occurred_at LIMIT 200`. Kept 400 days: the reference job's daily `purge` step deletes up to 1,200 older rows per day, oldest first through `idx_events_time`, which is more than the jobs can create in one day (`big_move` at most 400, `new_listing` at most 400, `new_nav` at most 260, `corporate_action` at most 60: 1,120).

### source_discrepancies (WITHOUT ROWID)
PK `(isin, session_date)`. `primary_source, backup_source TEXT`, `primary_close, backup_close REAL`, `diff_pct REAL NOT NULL` (> 2), `created_at`. Written by the EOD job.

### notices
`id INTEGER PK`, `kind TEXT NOT NULL` (`new_listing`, `job_failed`, `needs_ratio`, `fund_stale`, `source_switched`), `subject TEXT NOT NULL`, `details TEXT NOT NULL` (JSON: job, source, time, error), `created_at INTEGER NOT NULL`, `status TEXT NOT NULL DEFAULT 'open'` (`open`, `done`), `done_at INTEGER`. Index `idx_notices_open ON notices(status, created_at)`. Unique on `(kind, subject, date(created_at))` through a `dedupe_key TEXT UNIQUE` column so a failing job raises one notice per day. Jobs write their notices with one `raiseNotices` statement per run (one `json_each` insert, `ON CONFLICT(dedupe_key) DO NOTHING`), so the statement count does not grow with the number of notices; `job_failed` is one notice per job, step and source (subject `<job>/<step>/<source>`, failed pages listed in `details.pages`).

### usage_daily (WITHOUT ROWID)
PK `(day, user_id, tool)` (day first, so the per-call `day = ? AND user_id = ?` read, the per-day top users and the purge are PK range seeks). `calls INTEGER NOT NULL`. `day` is the UTC date (Cloudflare limits reset at 00:00 UTC). Kept 90 days: the reference job's daily `purge` step deletes up to 3,000 older rows per day from the start of the PK.

### usage_minute (WITHOUT ROWID, only with `migrations/0002_usage_minute.sql`, risk K2)
PK `user_id`. `minute INTEGER NOT NULL` (Unix minute), `calls INTEGER NOT NULL`. One row per user, overwritten in place: the per-minute upsert resets `calls` to 1 when `minute` changes and writes nothing when the user already has 10 calls in the current minute, so the table needs no purge and a refused call writes no row.

### usage_global (WITHOUT ROWID)
PK `day TEXT` (UTC). `calls`, `rows_read`, `oauth_kv_writes`, `backfill_rows`, `adjust_rows`, `personal_rows` INTEGER NOT NULL DEFAULT 0. `personal_rows` is the sum of `meta.rows_written` of every user-driven D1 write (personal tools, `saveCrossings`, `touchKey`, user upserts at sign-in, API key create and revoke, account deletion, admin writes other than the adjust recompute); it is capped at `PERSONAL_DAILY_ROWS` (default 5,000) by a pre-check of the operation's worst case, so personal writes have a hard daily bound.

### job_state (WITHOUT ROWID)
PK `job TEXT`. `last_run_date TEXT` (Cairo date), `last_ok_at`, `last_error_at INTEGER`, `cursor TEXT`. Lets daily handlers run once per Cairo date and resume paged work. The row `eod_bars` holds the latest stored session date `L` (set by the end-of-day `bars` step after its insert), used by the adjustment apply guard.

## Query patterns and risks (code-quality)

| Use | Statement shape | Rows read | Risk and control |
|---|---|---|---|
| Per call auth and limits | `batch([key by hash JOIN users, usage_daily SUM for day/user, usage_global by day])` | 3 to 5 | PK and unique lookups only; one round trip |
| Per call accounting | `batch([UPSERT usage_daily +1, UPSERT usage_global calls+1, rows_read+N])` | 2 written | No secondary indexes on these tables |
| History | `SELECT session_date, open..., adj_... FROM daily_bars WHERE isin = ? AND session_date BETWEEN ? AND ? AND session_date > ?cursor ORDER BY session_date LIMIT 500` | at most 500 | Explicit columns, keyset pagination on the PK |
| Compare 2 to 5 | one statement `WHERE isin IN (?,?,...) AND session_date BETWEEN ? AND ?`, aggregate in SQL (`MIN`, `MAX`, `SUM`, first and last close through window functions) | up to 5 x range | No per-symbol loop (no N+1); range capped at 5 years |
| Fund performance | `WHERE fund_id = ? AND nav_date >= ?` limited to the needed anchor dates (one row per anchor via `MAX(nav_date) <= anchor`) | about 6 | PK range seeks |
| Portfolio | `holdings WHERE user_id = ?` and `price_levels WHERE user_id = ?` in one batch, prices from the snapshot | at most 100 | Indexed by user, capped at 50 each |
| What changed | `market_events WHERE occurred_at > ? ORDER BY occurred_at LIMIT 200` | at most 200 | Index on `occurred_at`; `since` limited to 30 days |
| Daily stats job | one aggregate over `daily_bars WHERE session_date >= date('now','-400 days')` grouped by isin | about 75,000 once per day | Runs once; result goes to KV `stats:v1` |
| Bulk job writes | `INSERT INTO t (...) SELECT ... FROM json_each(?1) ON CONFLICT DO UPDATE ... WHERE` a value differs | rows changed | One statement per table per job (stays under 50 queries and 100 parameters); write-on-change keeps the jobs inside `JOBS_D1_ROWS_RESERVE` |
| Adjust recompute | one read statement (action, basis, backfill state, `L`, row count, today's `adjust_rows`), then one `batch()` of 6 statements: gate, two set-based `UPDATE daily_bars ... WHERE isin = ? AND session_date < ?` split by the basis rule with `ex_date` and `B` bound as parameters, usage, notice, status | rows before the ex date (about 625 on average over 5 years, at most about 1,250), read by the gate and usage `COUNT(*)` and by the two updates | PK prefix range; capped atomically by the gate at `ADJUST_MAX_ROWS_PER_DAY` 10,000 rows per UTC day; 2 actions per end-of-day run (1 + 2 x 6 statements), 3 per admin call |
| Purge (reference job, daily) | `DELETE FROM market_events WHERE id IN (SELECT id FROM market_events WHERE occurred_at < ? ORDER BY occurred_at LIMIT 1200)` and `DELETE FROM usage_daily WHERE (day, user_id, tool) IN (SELECT day, user_id, tool FROM usage_daily WHERE day < ? ORDER BY day LIMIT 3000)` | at most 4,200 | `idx_events_time` and PK range seeks; at most 2,400 + 3,000 = 5,400 rows written per day |
| Notices write | `raiseNotices`: one `INSERT INTO notices ... SELECT ... FROM json_each(?1) WHERE true ON CONFLICT(dedupe_key) DO NOTHING` per job run | 0 | 1 statement per run whatever the number of notices; 3 rows written per new notice (row, `idx_notices_open`, `dedupe_key`) |
| Pending lookups | `pendingForIsins` on `ux_actions` (`isin IN (SELECT value FROM json_each(?1))`, 1 parameter for up to 5 symbols) and `pendingAll` on `idx_actions_unapplied` (no symbol filter) | a few dozen plus the `EXISTS` seeks | Partial index predicate repeated verbatim in both; never `IN (?,?,...)` over all symbols (100 bound parameter limit) |
| Personal writes | single-row upserts and deletes guarded by `user_id = ?`, `saveCrossings` as one `json_each` update | `meta.rows_written` added to `usage_global.personal_rows` | Pre-check against `PERSONAL_DAILY_ROWS`; refused with `capacity` when the worst case would pass it |
| Notices list | `WHERE status = 'open' ORDER BY created_at LIMIT 50` | at most 50 | `idx_notices_open` |

Every read reports `meta.rows_read`; the request adds it to `usage_global.rows_read` in the accounting batch.

## KV keys (namespace `DATA`)

| Key | Writer | Frequency | Reader TTL |
|---|---|---|---|
| `snapshot:v1` | snapshot job | at most 1 per minute in the window, only when content changed | `cacheTtl` 30 s, isolate memo 30 s |
| `snapshot:last-session` | snapshot job (`putLastSessionSnapshot`, on the run at the window end); the end-of-day job writes it instead when that run was missed | 1 per trading day (read by `get_daily_summary` through `getLastSessionSnapshot`) | 300 s |
| `directory:v1` | end-of-day job (symbols part) and reference job (funds part) | at most 2 per day, only on change | 300 s |
| `oauth:purge-cursor` | maintenance job (`getPurgeCursor`, `putPurgeCursor`) | at most 1 per week | n/a |
| `stats:v1` | EOD job | 1 per trading day | 300 s |

`OAUTH_KV` is owned by the OAuth library (grants, tokens, clients).

### `snapshot:v1` shape

```json
{
  "v": 1,
  "generatedAt": 1793000000,
  "session": { "date": "2026-10-25", "status": "open", "tz": "Africa/Cairo", "opensAt": "10:00", "closesAt": "14:30", "noTradesToday": false },
  "delay": { "label": "delayed", "minutes": 15 },
  "sources": { "stocks": "tradingview", "primaryFailed": true, "primaryError": "connection reset" },
  "quotes": {
    "EGS60121C018": { "t": "COMI", "p": 122.03, "o": 125.15, "h": 125.2, "l": 121.51, "pc": 125.15, "ch": -3.12, "chp": -2.49, "v": 1846236, "val": 225296179.08, "tt": 1792999800, "td": "2026-10-25", "src": "tradingview" }
  },
  "indices": { "EGX30": { "v": 49234.3, "chp": -3.56, "tt": 1792999800, "src": "tradingview" } },
  "fx": { "USDEGP": { "v": 55.25, "tt": 1792999800, "src": "tradingview", "kind": "market" } },
  "metals": {
    "XAUUSD": { "v": 3995.54, "unit": "USD/oz", "tt": 1792999800, "src": "tradingview" },
    "XAGUSD": { "v": 53.9, "unit": "USD/oz", "tt": 1792999800, "src": "tradingview" },
    "egypt": { "src": "isagha", "fetchedAt": 1792999800, "unit": "EGP/g",
      "gold": { "18": { "buy": 5361.5, "sell": 5391.5 }, "21": { "buy": 6255, "sell": 6300 }, "24": { "buy": 7148.5, "sell": 7188.5 } },
      "silver": { "925": { "buy": 90.75, "sell": 93.5 }, "999": { "buy": 98, "sell": 101 } } }
  },
  "breadth": { "advancers": 0, "decliners": 0, "unchanged": 0 },
  "totals": { "volume": 0, "value": 0 },
  "top": { "gainers": ["<isin>"], "losers": ["<isin>"], "byVolume": ["<isin>"], "byValue": ["<isin>"] }
}
```

Rules: keyed by ISIN; `td` is the trade date reported by the source and drives freshness (FR-015); `src` per value records the source actually used (FR-013); `top` lists hold 10 ISINs each, computed once per write. `session.noTradesToday` is true when, at or after the session open plus 30 minutes on a trading day (10:30 Cairo by default; `open_time` plus 30 minutes on a `special_hours` day), no quote has `td` equal to today (a holiday missing from the calendar): `session.status` is then `closed`, every tool reports that status instead of the calendar-only status, and the end-of-day job skips the whole day. `tt` on global metals is the provider `update_time`. `metals.egypt` is refreshed at most every 15 minutes inside the window and once a day by the reference job (read, merge, write), so weekend gold prices stay current; when the iSagha fetch or parse fails, the previous `metals.egypt` is kept with its old `fetchedAt`. Size target under 60 KB.

### `directory:v1` shape
`{ "v": 1, "builtAt": 0, "symbols": [[isin, ticker, nameAr, nameEn, sector, status, normAr, normEn, aliasesNorm[]]], "tickerToIsin": { "<TICKER or provider alias>": "<isin>" }, "funds": [[fundId, nameAr, nameEn, manager, currency, normAr, normEn]] }`. `tickerToIsin` holds every current and old ticker and every `provider` alias (from `aliasMap`, built by the end-of-day job), so the snapshot job maps provider tickers to ISINs from this KV value and never reads `symbol_aliases` in D1.

### `stats:v1` shape
`{ "v": 1, "asOf": "2026-10-23", "symbols": { "<isin>": { "h52": 0, "h52d": "", "l52": 0, "l52d": "", "avgVol20": 0, "ret": { "1d": 0, "1w": 0, "1m": 0, "3m": 0, "ytd": 0, "1y": 0 }, "pendingAdj": [ { "actionId": 0, "kind": "bonus", "exDate": "", "state": "needs_ratio", "adjAffected": true } ] } } }`

The `ret` values are percent, so `3.2` means +3.2%; a period without a base bar is `null`.
