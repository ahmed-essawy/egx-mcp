CREATE TABLE symbols (
  isin TEXT PRIMARY KEY CHECK (length(isin) = 12),
  ticker TEXT NOT NULL,
  name_ar TEXT,
  name_en TEXT,
  sector TEXT,
  market TEXT NOT NULL DEFAULT 'main' CHECK (market IN ('main', 'nilex')),
  index_codes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'inactive')),
  shares_outstanding REAL,
  free_float_shares REAL,
  first_trade_date TEXT,
  adj_basis_date TEXT,
  backfill_state TEXT CHECK (backfill_state IS NULL OR backfill_state IN ('loading', 'done')),
  missing_sessions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_symbols_ticker ON symbols(ticker);

CREATE TABLE symbol_aliases (
  isin TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ticker', 'name_ar', 'name_en', 'provider')),
  value TEXT NOT NULL,
  provider TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (isin, kind, value)
) STRICT, WITHOUT ROWID;

CREATE TABLE daily_bars (
  isin TEXT NOT NULL,
  session_date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL CHECK (volume >= 0),
  value REAL,
  adj_open REAL NOT NULL,
  adj_high REAL NOT NULL,
  adj_low REAL NOT NULL,
  adj_close REAL NOT NULL,
  adj_factor REAL NOT NULL DEFAULT 1,
  raw_derived INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  PRIMARY KEY (isin, session_date),
  CHECK (low <= min(open, close)),
  CHECK (high >= max(open, close))
) STRICT, WITHOUT ROWID;

CREATE TABLE index_values (
  index_code TEXT NOT NULL,
  session_date TEXT NOT NULL,
  close REAL NOT NULL,
  change_pct REAL,
  source TEXT NOT NULL,
  PRIMARY KEY (index_code, session_date)
) STRICT, WITHOUT ROWID;

CREATE TABLE corporate_actions (
  id INTEGER PRIMARY KEY,
  isin TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash_dividend', 'bonus', 'split', 'reverse_split', 'rights', 'name_change', 'other')),
  announced_on TEXT,
  ex_date TEXT NOT NULL,
  ratio REAL CHECK (ratio IS NULL OR (kind = 'bonus' AND ratio > 0 AND ratio <= 10) OR (kind = 'split' AND ratio > 1) OR (kind = 'reverse_split' AND ratio > 0 AND ratio < 1) OR (kind NOT IN ('bonus', 'split', 'reverse_split') AND ratio > 0)),
  amount REAL,
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('needs_ratio', 'recorded', 'applied', 'adjusting')),
  source TEXT NOT NULL,
  source_text TEXT,
  created_at INTEGER,
  updated_at INTEGER
) STRICT;

CREATE UNIQUE INDEX ux_actions ON corporate_actions(isin, kind, ex_date);
CREATE INDEX idx_actions_ex_date ON corporate_actions(ex_date);
CREATE INDEX idx_actions_unapplied ON corporate_actions(ex_date, isin)
  WHERE status IN ('needs_ratio', 'recorded') AND kind IN ('bonus', 'split', 'reverse_split');

CREATE TABLE funds (
  fund_id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  manager TEXT,
  currency TEXT NOT NULL DEFAULT 'EGP',
  currency_inferred INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  cycle_days INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'stale')),
  created_at INTEGER,
  updated_at INTEGER
) STRICT;

CREATE TABLE nav_records (
  fund_id TEXT NOT NULL,
  nav_date TEXT NOT NULL,
  nav REAL NOT NULL CHECK (nav > 0),
  source TEXT NOT NULL,
  fetched_at INTEGER,
  PRIMARY KEY (fund_id, nav_date)
) STRICT, WITHOUT ROWID;

CREATE TABLE financial_figures (
  isin TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('revenue', 'net_income', 'total_equity', 'total_debt', 'eps_basic', 'dps')),
  period_type TEXT NOT NULL CHECK (period_type IN ('FY', 'FQ', 'TTM')),
  period_end TEXT NOT NULL,
  period_inferred INTEGER NOT NULL DEFAULT 0,
  value REAL NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER,
  PRIMARY KEY (isin, metric, period_type, period_end)
) STRICT, WITHOUT ROWID;

CREATE TABLE inflation_figures (
  month TEXT PRIMARY KEY,
  cpi_index REAL NOT NULL CHECK (cpi_index > 0),
  yoy_pct REAL,
  source TEXT NOT NULL,
  entered_by TEXT,
  entered_at INTEGER
) STRICT, WITHOUT ROWID;

CREATE TABLE market_calendar (
  date TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('holiday', 'special_hours')),
  open_time TEXT,
  close_time TEXT,
  note TEXT,
  CHECK (kind <> 'special_hours' OR (open_time IS NOT NULL AND close_time IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER,
  deleted_at INTEGER
) STRICT;

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE INDEX idx_keys_user ON api_keys(user_id, revoked_at);

CREATE TABLE holdings (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  isin TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  cost_per_share REAL NOT NULL CHECK (cost_per_share >= 0),
  acquired_on TEXT NOT NULL,
  created_at INTEGER
) STRICT;

CREATE INDEX idx_holdings_user ON holdings(user_id);

CREATE TABLE price_levels (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  isin TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  level REAL NOT NULL CHECK (level > 0),
  armed INTEGER NOT NULL DEFAULT 1,
  last_crossed_at INTEGER,
  created_at INTEGER
) STRICT;

CREATE INDEX idx_levels_user ON price_levels(user_id);

CREATE TABLE market_events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('new_nav', 'big_move', 'new_listing', 'corporate_action', 'disclosure')),
  occurred_at INTEGER NOT NULL,
  isin TEXT,
  fund_id TEXT,
  payload TEXT NOT NULL
) STRICT;

CREATE INDEX idx_events_time ON market_events(occurred_at);

CREATE TABLE source_discrepancies (
  isin TEXT NOT NULL,
  session_date TEXT NOT NULL,
  primary_source TEXT,
  backup_source TEXT,
  primary_close REAL,
  backup_close REAL,
  diff_pct REAL NOT NULL,
  created_at INTEGER,
  PRIMARY KEY (isin, session_date)
) STRICT, WITHOUT ROWID;

CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('new_listing', 'job_failed', 'needs_ratio', 'fund_stale', 'source_switched')),
  subject TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at INTEGER,
  dedupe_key TEXT UNIQUE
) STRICT;

CREATE INDEX idx_notices_open ON notices(status, created_at);

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  calls INTEGER NOT NULL,
  PRIMARY KEY (day, user_id, tool)
) STRICT, WITHOUT ROWID;

CREATE TABLE usage_global (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0,
  oauth_kv_writes INTEGER NOT NULL DEFAULT 0,
  backfill_rows INTEGER NOT NULL DEFAULT 0,
  adjust_rows INTEGER NOT NULL DEFAULT 0,
  personal_rows INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;

CREATE TABLE job_state (
  job TEXT PRIMARY KEY,
  last_run_date TEXT,
  last_ok_at INTEGER,
  last_error_at INTEGER,
  cursor TEXT
) STRICT, WITHOUT ROWID;
