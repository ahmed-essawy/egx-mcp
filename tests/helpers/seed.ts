import { env } from "cloudflare:test";
import { vi } from "vitest";
import { MS_PER_SECOND } from "./time";
import type { Directory, DirectoryFund, DirectorySymbol, Snapshot, Stats, SymbolStatus } from "../../src/store/kv";
import { __resetKvMemo } from "../../src/store/kv";
import { normalizeArabic } from "../../src/domain/arabic";
import { generateApiKey, hashApiKey } from "../../src/auth/api-keys";
import { createApiKey, upsertUserByGoogleSub } from "../../src/store/d1/users";

import { DEFAULT_GENERATED_AT, DEFAULT_SESSION_DATE, defaultSnapshot } from "./snapshot-fixture";

export { defaultSnapshot };
const GOOGLE_SUB_PREFIX = "sub-";
export const SNAPSHOT_KEY = "snapshot:v1";
export const DIRECTORY_KEY = "directory:v1";
export const LAST_SESSION_KEY = "snapshot:last-session";

export type BarRow = {
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  value?: number | null;
  source?: string;
};

export type CalendarSeedRow = {
  date: string;
  kind: "holiday" | "special_hours";
  openTime?: string | null;
  closeTime?: string | null;
};

export function syntheticIsin(index: number): string {
  return `EGS${String(index).padStart(9, "0")}`;
}

export function syntheticTicker(index: number): string {
  return `S${String(index).padStart(3, "0")}`;
}

function defaultDirectory(): Directory {
  return { v: 1, builtAt: DEFAULT_GENERATED_AT, symbols: [], tickerToIsin: {}, funds: [] };
}

function defaultStats(): Stats {
  return { v: 1, asOf: DEFAULT_SESSION_DATE, symbols: {} };
}

async function putJson(key: string, value: unknown): Promise<void> {
  await env.DATA.put(key, JSON.stringify(value));
  __resetKvMemo();
}

export function setNow(unixSeconds: number): void {
  vi.setSystemTime(unixSeconds * MS_PER_SECOND);
}

export async function seedUser(email: string): Promise<string> {
  const { id } = await upsertUserByGoogleSub(
    env.DB,
    { sub: `${GOOGLE_SUB_PREFIX}${email}`, email, name: null },
    Math.floor(Date.now() / MS_PER_SECOND),
  );
  return id;
}

export async function seedKey(userId: string): Promise<string> {
  const { key, prefix } = generateApiKey();
  await createApiKey(env.DB, {
    id: crypto.randomUUID(),
    userId,
    prefix,
    keyHash: await hashApiKey(key),
    name: null,
    now: Math.floor(Date.now() / MS_PER_SECOND),
  });
  return key;
}

async function seedSnapshotAt(key: string, partial: Partial<Snapshot>): Promise<Snapshot> {
  const snapshot = { ...defaultSnapshot(), ...partial };
  await putJson(key, snapshot);
  return snapshot;
}

export function seedSnapshot(partial: Partial<Snapshot> = {}): Promise<Snapshot> {
  return seedSnapshotAt(SNAPSHOT_KEY, partial);
}

export function seedLastSessionSnapshot(partial: Partial<Snapshot> = {}): Promise<Snapshot> {
  return seedSnapshotAt(LAST_SESSION_KEY, partial);
}

export async function seedDirectory(partial: Partial<Directory> = {}): Promise<Directory> {
  const directory = { ...defaultDirectory(), ...partial };
  await putJson(DIRECTORY_KEY, directory);
  return directory;
}

type StockOptions = {
  nameAr?: string | null;
  nameEn?: string | null;
  sector?: string | null;
  status?: SymbolStatus;
};

export function stockSymbol(isin: string, ticker: string, options: StockOptions = {}): DirectorySymbol {
  const { nameAr = null, nameEn = null, sector = null, status = "active" } = options;
  return [isin, ticker, nameAr, nameEn, sector, status, normalizeArabic(nameAr ?? ""), normalizeArabic(nameEn ?? ""), []];
}

export async function seedSymbols(symbols: DirectorySymbol[], funds: DirectoryFund[] = []): Promise<Directory> {
  const tickerToIsin = Object.fromEntries(symbols.map((entry) => [entry[1], entry[0]]));
  return seedDirectory({ symbols, tickerToIsin, funds });
}

export async function seedStats(partial: Partial<Stats> = {}): Promise<Stats> {
  const stats = { ...defaultStats(), ...partial };
  await putJson("stats:v1", stats);
  return stats;
}

export async function seedBars(isin: string, rows: BarRow[]): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT INTO daily_bars
       (isin, session_date, open, high, low, close, volume, value, adj_open, adj_high, adj_low, adj_close, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?3, ?4, ?5, ?6, ?9)`,
  );
  await env.DB.batch(
    rows.map((row) =>
      insert.bind(
        isin,
        row.sessionDate,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume ?? 0,
        row.value ?? null,
        row.source ?? "test",
      ),
    ),
  );
}

export async function seedCalendar(rows: CalendarSeedRow[]): Promise<void> {
  const insert = env.DB.prepare("INSERT INTO market_calendar (date, kind, open_time, close_time) VALUES (?1, ?2, ?3, ?4)");
  await env.DB.batch(rows.map((row) => insert.bind(row.date, row.kind, row.openTime ?? null, row.closeTime ?? null)));
}
