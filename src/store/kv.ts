import type { CorporateActionKind } from "../domain/adjust";
import type { SessionStatus } from "../domain/calendar";
import { sha256Hex } from "../domain/crypto";

export type QuoteEntry = {
  t: string;
  p: number;
  o: number | null;
  h: number | null;
  l: number | null;
  pc: number | null;
  ch: number | null;
  chp: number | null;
  v: number;
  val: number | null;
  tt: number;
  td: string;
  src: string;
};

export type IndexEntry = { v: number; chp: number | null; tt: number; src: string };

export type FxEntry = { v: number; tt: number; src: string; kind: "market" };

export type SpotMetalEntry = { v: number; unit: string; tt: number; src: string };

export type BuySell = { buy: number; sell: number };

export type EgyptMetals = {
  src: string;
  fetchedAt: number;
  unit: string;
  gold: Record<string, BuySell>;
  silver: Record<string, BuySell>;
};

export type Snapshot = {
  v: 1;
  generatedAt: number;
  session: {
    date: string;
    status: SessionStatus;
    tz: string;
    opensAt: string;
    closesAt: string;
    noTradesToday: boolean;
  };
  delay: { label: string; minutes: number | null };
  sources: { stocks: string; primaryFailed: boolean; primaryError?: string };
  quotes: Record<string, QuoteEntry>;
  indices: Record<string, IndexEntry>;
  fx: Record<string, FxEntry>;
  metals: {
    XAUUSD?: SpotMetalEntry;
    XAGUSD?: SpotMetalEntry;
    egypt?: EgyptMetals;
  };
  breadth: { advancers: number; decliners: number; unchanged: number };
  totals: { volume: number; value: number };
  top: {
    gainers: string[];
    losers: string[];
    byVolume: string[];
    byValue: string[];
  };
};

export type SymbolStatus = "pending" | "active" | "inactive";

export type DirectorySymbol = [
  isin: string,
  ticker: string,
  nameAr: string | null,
  nameEn: string | null,
  sector: string | null,
  status: SymbolStatus,
  normAr: string,
  normEn: string,
  aliasesNorm: string[],
];

export type DirectoryFund = [
  fundId: string,
  nameAr: string,
  nameEn: string | null,
  manager: string | null,
  currency: string | null,
  normAr: string,
  normEn: string,
];

export type Directory = {
  v: 1;
  builtAt: number;
  symbols: DirectorySymbol[];
  tickerToIsin: Record<string, string>;
  funds: DirectoryFund[];
};

export type StatsReturns = {
  "1d": number | null;
  "1w": number | null;
  "1m": number | null;
  "3m": number | null;
  ytd: number | null;
  "1y": number | null;
};

export type PendingAdjustment = {
  actionId: number;
  kind: Extract<CorporateActionKind, "bonus" | "split" | "reverse_split">;
  exDate: string;
  state: "needs_ratio" | "queued";
  adjAffected: boolean;
};

export type SymbolStats = {
  h52: number;
  h52d: string;
  l52: number;
  l52d: string;
  avgVol20: number;
  ret: StatsReturns;
  pendingAdj: PendingAdjustment[];
};

export type Stats = {
  v: 1;
  asOf: string;
  symbols: Record<string, SymbolStats>;
};

const SNAPSHOT_KEY = "snapshot:v1";
const DIRECTORY_KEY = "directory:v1";
const STATS_KEY = "stats:v1";
const LAST_SESSION_KEY = "snapshot:last-session";
const PURGE_CURSOR_KEY = "oauth:purge-cursor";

const SNAPSHOT_TTL_SECONDS = 30;
const REFERENCE_TTL_SECONDS = 300;
const MS_PER_SECOND = 1000;

type Memo<T> = { value: T; hash: string | null; expiresAt: number };

const memos = new Map<string, Memo<unknown>>();

export function __resetKvMemo(): void {
  memos.clear();
}

function readMemo<T>(key: string): Memo<T> | null {
  const memo = memos.get(key) as Memo<T> | undefined;
  if (!memo || memo.expiresAt <= Date.now()) return null;
  return memo;
}

function writeMemo<T>(key: string, value: T, hash: string | null, ttlSeconds: number): void {
  memos.set(key, { value, hash, expiresAt: Date.now() + ttlSeconds * MS_PER_SECOND });
}

async function readCached<T>(env: Env, key: string, ttlSeconds: number): Promise<T | null> {
  const memo = readMemo<T | null>(key);
  if (memo) return memo.value;
  const value = await env.DATA.get<T>(key, { type: "json", cacheTtl: ttlSeconds });
  writeMemo(key, value, null, ttlSeconds);
  return value;
}

async function writeIfChanged<T>(
  env: Env,
  key: string,
  next: T,
  ttlSeconds: number,
  hashOf: (value: T) => Promise<string>,
): Promise<boolean> {
  const nextHash = await hashOf(next);
  const memo = readMemo<T | null>(key);
  const stored = memo?.hash ? null : await env.DATA.get<T>(key, { type: "json" });
  const storedHash = memo?.hash ?? (stored ? await hashOf(stored) : null);
  if (storedHash === nextHash) {
    if (memo) memo.hash = nextHash;
    else writeMemo(key, stored, nextHash, ttlSeconds);
    return false;
  }
  await env.DATA.put(key, JSON.stringify(next));
  writeMemo(key, next, nextHash, ttlSeconds);
  return true;
}

function snapshotHash(snapshot: Snapshot): Promise<string> {
  const { generatedAt: _generatedAt, ...content } = snapshot;
  return sha256Hex(JSON.stringify(content));
}

function directoryHash(directory: Directory): Promise<string> {
  const { builtAt: _builtAt, ...content } = directory;
  return sha256Hex(JSON.stringify(content));
}

export function getSnapshot(env: Env): Promise<Snapshot | null> {
  return readCached<Snapshot>(env, SNAPSHOT_KEY, SNAPSHOT_TTL_SECONDS);
}

export function putSnapshotIfChanged(env: Env, next: Snapshot): Promise<boolean> {
  return writeIfChanged(env, SNAPSHOT_KEY, next, SNAPSHOT_TTL_SECONDS, snapshotHash);
}

export async function putLastSessionSnapshot(env: Env, snapshot: Snapshot): Promise<boolean> {
  const stored = await env.DATA.get<Snapshot>(LAST_SESSION_KEY, { type: "json" });
  if (stored?.session.date === snapshot.session.date) return false;
  await env.DATA.put(LAST_SESSION_KEY, JSON.stringify(snapshot));
  writeMemo(LAST_SESSION_KEY, snapshot, null, REFERENCE_TTL_SECONDS);
  return true;
}

export function getLastSessionSnapshot(env: Env): Promise<Snapshot | null> {
  return readCached<Snapshot>(env, LAST_SESSION_KEY, REFERENCE_TTL_SECONDS);
}

export function getDirectory(env: Env): Promise<Directory | null> {
  return readCached<Directory>(env, DIRECTORY_KEY, REFERENCE_TTL_SECONDS);
}

export function putDirectoryIfChanged(env: Env, directory: Directory): Promise<boolean> {
  return writeIfChanged(env, DIRECTORY_KEY, directory, REFERENCE_TTL_SECONDS, directoryHash);
}

export function getStats(env: Env): Promise<Stats | null> {
  return readCached<Stats>(env, STATS_KEY, REFERENCE_TTL_SECONDS);
}

export async function putStats(env: Env, stats: Stats): Promise<void> {
  await env.DATA.put(STATS_KEY, JSON.stringify(stats));
  writeMemo(STATS_KEY, stats, null, REFERENCE_TTL_SECONDS);
}

export function getPurgeCursor(env: Env): Promise<string | null> {
  return readCached<string>(env, PURGE_CURSOR_KEY, REFERENCE_TTL_SECONDS);
}

export async function putPurgeCursor(env: Env, cursor: string | null): Promise<void> {
  if (cursor === null) await env.DATA.delete(PURGE_CURSOR_KEY);
  else await env.DATA.put(PURGE_CURSOR_KEY, JSON.stringify(cursor));
  writeMemo(PURGE_CURSOR_KEY, cursor, null, REFERENCE_TTL_SECONDS);
}
