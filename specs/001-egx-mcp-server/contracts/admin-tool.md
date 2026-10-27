# Contract: owner admin tool

Tool name `admin`. Allowed only when the caller's Google email is in the `OWNER_EMAILS` config var; any other caller gets `forbidden` (FR-048, Story 7 scenario 4). Not exempt from global caps.

Input is a discriminated union on `action`:

| action | Fields | Effect | Output `data` |
|---|---|---|---|
| `list_notices` | `status` `open`/`done` (default `open`), `limit` 1..50, `cursor` | read `notices` | `items[]`: `{ id, kind, subject, details, createdAt, status }`, `nextCursor` |
| `mark_notice_done` | `ids` int[1..50] | `status = done`, `done_at = now` | `{ updated }` |
| `set_calendar_day` | `date`, `kind` `holiday`/`special_hours`, `openTime`, `closeTime` (required for special hours), `note` | upsert `market_calendar` | `{ date }` |
| `remove_calendar_day` | `date` | delete row | `{ removed }` |
| `list_calendar` | `from`, `to` | read | `items[]` |
| `set_inflation` | `month` `YYYY-MM`, `cpiIndex` > 0, `yoyPct`, `source` | upsert `inflation_figures` | `{ month }` |
| `set_action_ratio` | `actionId`, `ratio` valid for the action's kind (see Ratio below) | only for a `needs_ratio` action: store the ratio, status `recorded`, then one apply attempt under the guards of the [adjustment state machine](../data-model.md#adjustment-state-machine-bonus-split-reverse-split). Applied: status `applied`, its `needs_ratio` notice closed in the same batch, labels cleared. Refused (`ex_date_not_reached`, `backfill_loading`, `daily_cap`): stays `recorded`, `rowsAdjusted` 0, the notice stays open, bars before a passed ex date stay labeled as queued, and the end-of-day job retries. `status` is read back from the database after the attempt; when the batch's gate refused after the pre-check passed, `refusedReason` is derived from that read | `{ actionId, status, rowsAdjusted, refusedReason }` |
| `add_corporate_action` | `symbol`, `kind`, `exDate`, `ratio` (required for `bonus`, `split`, `reverse_split` and valid for the kind, see Ratio below) or `amount` + `currency` (for `cash_dividend`) | insert as `recorded`; for `bonus`, `split`, `reverse_split` one apply attempt with the same guards and outcomes as `set_action_ratio` | `{ actionId, status, rowsAdjusted, refusedReason }` |
| `apply_queued_actions` | `limit` 1..3 (default 3) | apply attempts for the oldest queued actions (`recorded` bonus, split or reverse split with ex date on or before the latest stored session, symbol not loading), in ex date order, stopping at the first `daily_cap` refusal | `{ applied[]: { actionId, rowsAdjusted }, remaining }` |
| `revert_action` | `actionId` | only for an `applied` bonus, split or reverse split (recovery from a wrong ratio): one gated batch that restores every bar before the ex date with factor `1 / f`, sets the action to `needs_ratio` with `ratio` null and reopens its `needs_ratio` notice, so its bars are labeled again until a corrected ratio is applied with `set_action_ratio`. Refused (`backfill_loading`, `daily_cap`): nothing changes. Any other status is `invalid_input` | `{ actionId, status, rowsAdjusted, refusedReason }` |
| `list_discrepancies` | `from`, `to`, `limit` | read `source_discrepancies` | `items[]` |
| `usage_summary` | `day` (default today UTC) | read `usage_global` and top 20 users by calls from `usage_daily` | `{ global{calls,rowsRead,oauthKvWrites,backfillRows,adjustRows,personalRows}, caps, topUsers[] }` |
| `activate_symbol` | `isin` | `pending` to `active` | `{ isin, status }` |

Ratio, validated per kind (any other value is `invalid_input`, and a `CHECK` in `corporate_actions` enforces the same ranges): `bonus` `0 < ratio <= 10`, `split` `ratio > 1`, `reverse_split` `0 < ratio < 1`. For `bonus`, the bonus shares received per share held ("1 bonus share for every 4 held" is `0.25`, factor `1 / 1.25`); for `split` and `reverse_split`, the shares held after per share held before (a 2 for 1 split is `2`, factor `0.5`; a 1 for 10 reverse split is `0.1`, factor `10`).

Every write action records nothing outside its table except the stated notice update, the `usage_global` counters (`adjust_rows` for applies and reverts, `personal_rows` for other admin writes) and, for applies and reverts, the `daily_bars` rows of that symbol. Admin writes other than applies and reverts are refused with `capacity` when `PERSONAL_DAILY_ROWS` would be passed. All responses use the common envelope with `meta.label = "owner_entered"` for owner data.
