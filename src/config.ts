import {
  ACCOUNTING_ROWS_PER_CALL,
  D1_DAILY_ROWS_WRITTEN,
  D1_WRITE_HEADROOM,
  JOBS_D1_ROWS_RESERVE,
} from "./domain/budget";

export interface Config {
  globalDailyCalls: number;
  globalDailyRowsRead: number;
  oauthDailyKvWrites: number;
  userDailyCalls: number;
  ownerEmails: Set<string>;
  unlimitedEmails: Set<string>;
  stockProviders: string[];
  snapshotEveryMinutes: 1 | 2;
  backfillMaxRowsPerDay: number;
  adjustMaxRowsPerDay: number;
  adjustMaxActionsPerRun: number;
  personalDailyRows: number;
  publicOrigin: string;
}

const STOCK_PROVIDER_IDS = ["egx", "tradingview", "mubasher"];
const MIN_ADJUST_ROWS_PER_DAY = 1500;
const MIN_ADJUST_ACTIONS_PER_RUN = 1;
const MAX_ADJUST_ACTIONS_PER_RUN = 2;

const ORIGIN_PROTOCOLS = ["https:", "http:"];

let configs = new WeakMap<Env, Config>();

function invalidConfig(name: string): Error {
  return new Error(`invalid config: ${name}`);
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

function parseInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value.trim())) throw invalidConfig(name);
  return Number(value);
}

function parseSnapshotInterval(value: string): 1 | 2 {
  const minutes = parseInteger("SNAPSHOT_EVERY_MINUTES", value);
  if (minutes !== 1 && minutes !== 2) throw invalidConfig("SNAPSHOT_EVERY_MINUTES");
  return minutes;
}

function parseStockProviders(value: string): string[] {
  const providers = parseList(value);
  const isValid =
    providers.length > 0 &&
    new Set(providers).size === providers.length &&
    providers.every((id) => STOCK_PROVIDER_IDS.includes(id));
  if (!isValid) {
    throw invalidConfig("STOCK_PROVIDERS");
  }
  return providers;
}

function build(env: Env): Config {
  const config: Config = {
    globalDailyCalls: parseInteger("GLOBAL_DAILY_CALLS", env.GLOBAL_DAILY_CALLS),
    globalDailyRowsRead: parseInteger("GLOBAL_DAILY_ROWS_READ", env.GLOBAL_DAILY_ROWS_READ),
    oauthDailyKvWrites: parseInteger("OAUTH_DAILY_KV_WRITES", env.OAUTH_DAILY_KV_WRITES),
    userDailyCalls: parseInteger("USER_DAILY_CALLS", env.USER_DAILY_CALLS),
    ownerEmails: new Set(parseList(env.OWNER_EMAILS)),
    unlimitedEmails: new Set(parseList(env.UNLIMITED_EMAILS)),
    stockProviders: parseStockProviders(env.STOCK_PROVIDERS),
    snapshotEveryMinutes: parseSnapshotInterval(env.SNAPSHOT_EVERY_MINUTES),
    backfillMaxRowsPerDay: parseInteger("BACKFILL_MAX_ROWS_PER_DAY", env.BACKFILL_MAX_ROWS_PER_DAY),
    adjustMaxRowsPerDay: parseInteger("ADJUST_MAX_ROWS_PER_DAY", env.ADJUST_MAX_ROWS_PER_DAY),
    adjustMaxActionsPerRun: parseInteger(
      "ADJUST_MAX_ACTIONS_PER_RUN",
      env.ADJUST_MAX_ACTIONS_PER_RUN,
    ),
    personalDailyRows: parseInteger("PERSONAL_DAILY_ROWS", env.PERSONAL_DAILY_ROWS),
    publicOrigin: env.PUBLIC_ORIGIN,
  };
  assertLimits(config);
  return config;
}

function assertLimits(config: Config): void {
  if (config.adjustMaxRowsPerDay < MIN_ADJUST_ROWS_PER_DAY) {
    throw invalidConfig("ADJUST_MAX_ROWS_PER_DAY");
  }
  const actions = config.adjustMaxActionsPerRun;
  if (actions < MIN_ADJUST_ACTIONS_PER_RUN || actions > MAX_ADJUST_ACTIONS_PER_RUN) {
    throw invalidConfig("ADJUST_MAX_ACTIONS_PER_RUN");
  }
  const rowsWritten =
    ACCOUNTING_ROWS_PER_CALL * config.globalDailyCalls +
    config.adjustMaxRowsPerDay +
    config.personalDailyRows +
    JOBS_D1_ROWS_RESERVE +
    D1_WRITE_HEADROOM;
  if (rowsWritten > D1_DAILY_ROWS_WRITTEN) throw invalidConfig("rows written budget");
}

export function loadConfig(env: Env): Config {
  const cached = configs.get(env);
  if (cached) return cached;
  const config = build(env);
  configs.set(env, config);
  return config;
}

export function __resetConfigCache(): void {
  configs = new WeakMap<Env, Config>();
}

export function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ORIGIN_PROTOCOLS.includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolvePublicOrigin(request: Request, env: Env): string | null {
  const configured = loadConfig(env).publicOrigin;
  return configured === "" ? new URL(request.url).origin : parseOrigin(configured);
}
