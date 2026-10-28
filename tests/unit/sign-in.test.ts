import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { signInGoogleUser } from "../../src/http/sign-in";
import { createSqliteD1 } from "../helpers/sqlite-d1";

const NOW = 1_792_000_000;
const NEW_USER_WORST_CASE_ROWS = 4;
const IDENTITY = { sub: "google-sub-1", email: "user@example.com", name: null };

describe("signInGoogleUser", () => {
  let env: Env;
  let sqlite: DatabaseSync;

  beforeEach(() => {
    const created = createSqliteD1();
    sqlite = created.sqlite;
    env = { DB: created.db } as Env;
  });

  function config(personalDailyRows: number): Config {
    return { personalDailyRows } as Config;
  }

  function userCount(): number {
    return (sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  it("creates the user and returns ok with its id", async () => {
    const result = await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS), IDENTITY, NOW);

    const row = sqlite.prepare("SELECT id FROM users WHERE google_sub = ?1").get(IDENTITY.sub) as { id: string };
    expect(result).toEqual({ kind: "ok", id: row.id });
  });

  it("returns the same id for a returning user", async () => {
    const first = await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS), IDENTITY, NOW);
    const second = await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS), IDENTITY, NOW);

    expect(second).toEqual(first);
    expect(userCount()).toBe(1);
  });

  it("returns capacity and creates no user when the personal cap would be passed", async () => {
    const result = await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS - 1), IDENTITY, NOW);

    expect(result).toEqual({ kind: "capacity" });
    expect(userCount()).toBe(0);
  });

  it("returns deleted for a soft-deleted account", async () => {
    await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS), IDENTITY, NOW);
    sqlite.prepare("UPDATE users SET deleted_at = ?1 WHERE google_sub = ?2").run(NOW, IDENTITY.sub);

    const result = await signInGoogleUser(env, config(NEW_USER_WORST_CASE_ROWS), IDENTITY, NOW);

    expect(result).toEqual({ kind: "deleted" });
  });
});
