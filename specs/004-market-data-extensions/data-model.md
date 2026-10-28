# Data model: Market data extensions

No migration. Every table and KV key below exists on `main` (`migrations/0001_initial.sql`, `src/store/kv.ts`). Migrations on `origin/main` are `0001_initial.sql` and `0003_symbol_quote_currency.sql` (0002 is unused); a future migration would be `0004`.

## D1 `index_values` (existing)

```sql
CREATE TABLE index_values (
  index_code TEXT NOT NULL,
  session_date TEXT NOT NULL,
  close REAL NOT NULL,
  change_pct REAL,
  source TEXT NOT NULL,
  PRIMARY KEY (index_code, session_date)
) STRICT, WITHOUT ROWID;
```

- `index_code`: one of `INDEX_CODES` in `src/domain/indices.ts`. `EGX30USD` never has rows (not in `TRADINGVIEW_INDEX_TICKERS`).
- `source`: `tradingview` (end-of-day `indexValues` step, from `IndexEntry.src`) or `mubasher` (backfill).
- Insert-only: `ON CONFLICT (index_code, session_date) DO NOTHING`. Never updated or deleted.

### Statements

| Use | Where | SQL | Rows | Index |
|---|---|---|---|---|
| store closes (existing) | `insertIndexValues` in `src/store/d1/bars.ts` | unchanged `json_each` insert | at most 4 written per snapshot, plus the closes of the 5 preceding sessions recovered from `snapshot:index-closes:<date>` (recovered duplicates write 0) | PK |
| close on or before a date (existing) | `indexCloseAt` in `src/store/d1/closes.ts` | unchanged | 1 | PK |
| series (new) | `readIndexSeries` in `src/store/d1/closes.ts` | `SELECT index_code, session_date, close, source FROM index_values WHERE index_code IN (SELECT value FROM json_each(?1)) AND session_date BETWEEN ?2 AND ?3 ORDER BY index_code, session_date` | one per returned row | PK range seek per code |
| earliest date per code (new) | same function, same `db.batch` | `SELECT value AS index_code, (SELECT MIN(session_date) FROM index_values WHERE index_code = json_each.value) AS earliest FROM json_each(?1)` | 1 per code (PK prefix min) | PK |

Volume: 5 years of EGX 30 is about 1,240 rows; each other index adds about 245 a year. A 1-year history reads about 250 rows plus 1; a 5-year summary of 5 indices reads at most about 6,500. Bounded by the global rows-read cap (3,500,000) and the per-user call cap.

## Backfill SQL (generated file, never committed)

Per chunk of at most 200 rows:

```sql
INSERT INTO index_values (index_code, session_date, close, change_pct, source) VALUES (...),(...) ON CONFLICT (index_code, session_date) DO NOTHING;
INSERT INTO usage_global (day, backfill_rows) VALUES (date('now'), changes()) ON CONFLICT (day) DO UPDATE SET backfill_rows = usage_global.backfill_rows + excluded.backfill_rows;
```

`changes()` is the number of rows the preceding insert actually wrote, and `date('now')` is the UTC day the owner runs the file, which is how `utcDay` keys `usage_global`.

## KV `snapshot:v1` (existing `Snapshot`)

- `metals.egypt.gold` gains the key `"pound"` (`BuySell`, EGP per piece, 8 g of 21K). `metals.egypt.unit` stays `EGP/g`; the tool reports `goldPound` with unit `EGP/piece`. Older snapshots without the key stay valid.
- New key `snapshot:index-closes:<session date>`: JSON array of `NewIndexValue` (`indexCode`, `sessionDate`, `close`, `changePct`, `source`), written once per trading day by the snapshot job at the window end (same branch as `snapshot:last-session`, which the next day overwrites before the end-of-day cron), `expirationTtl` 6 days (retention 5 days plus one, so a key written at 14:45 on D-5 is still there at the 15:30 run on D), skipped when empty. The end-of-day `indexValues` step reads the keys of the 5 calendar days before its date (5 KV reads per trading day) and inserts them insert-only. KV writes budget: +1 per day (specs/001 research R1, 899 of 1,000).

## Provenance (response only, not stored)

```ts
export type Basis = "primary" | "backup" | "computed";
export type TimeKind = "trade" | "fetched" | "close" | "period";
export interface Provenance {
  fields: string[];
  source: string;
  dataTime: string | null;
  timeKind: TimeKind;
  stale: boolean;
  basis: Basis;
}
```

`dataTime` is a Cairo ISO instant (`toCairoIso`) for `trade` and `fetched`, a `YYYY-MM-DD` date for `close`, and a `YYYY-MM-DD` date or `YYYY-MM` month for `period`.
