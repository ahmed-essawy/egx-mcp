import { env } from "cloudflare:test";
import { __resetKvMemo } from "../../src/store/kv";
import { setNow } from "./seed";
import { cairoSummerEpoch } from "./time";

export type Upstream = () => Response | Promise<Response>;
export type StoredNotice = { kind: string; subject: string; details: Record<string, unknown> };

export const fixtureResponse =
  (body: unknown): Upstream =>
  () =>
    Response.json(body);
export const failingUpstream: Upstream = () => {
  throw new Error("connection reset");
};
export const notFound: Upstream = () => new Response("not found", { status: 404 });

export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function bindMember(target: object, property: string | symbol): unknown {
  const member = Reflect.get(target, property);
  return typeof member === "function" ? member.bind(target) : member;
}

export function instrumentEnv() {
  const statements: string[] = [];
  const kvWrites: string[] = [];
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property !== "prepare") return bindMember(target, property);
      return (sql: string) => {
        statements.push(sql);
        return target.prepare(sql);
      };
    },
  });
  const data = new Proxy(env.DATA, {
    get(target, property) {
      if (property !== "put") return bindMember(target, property);
      return (key: string, ...rest: unknown[]) => {
        kvWrites.push(key);
        return (target.put as (...args: unknown[]) => Promise<void>)(key, ...rest);
      };
    },
  });
  const instrumented = Object.create(env, { DB: { value: db }, DATA: { value: data } }) as Env;
  return { instrumented, statements, kvWrites };
}

export async function readNotices(kind: string): Promise<StoredNotice[]> {
  const { results } = await env.DB
    .prepare("SELECT kind, subject, details FROM notices WHERE kind = ?1 ORDER BY id")
    .bind(kind)
    .all<{ kind: string; subject: string; details: string }>();
  return results.map((row) => ({ ...row, details: JSON.parse(row.details) as Record<string, unknown> }));
}

type RunDefaults = { date: string; time: string };

export function createJobRunner(job: (env: Env, now: number) => Promise<unknown>, defaults: RunDefaults) {
  const { instrumented, statements, kvWrites } = instrumentEnv();

  async function run(time: string = defaults.time, date: string = defaults.date): Promise<unknown> {
    const now = cairoSummerEpoch(date, time);
    setNow(now);
    return job(instrumented, now);
  }

  return { run, statements, kvWrites };
}

export async function clearStores(kvKeys: string[], tables: string[]): Promise<void> {
  await Promise.all(kvKeys.map((key) => env.DATA.delete(key)));
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  __resetKvMemo();
}
