import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveApiKey } from "../../src/auth/api-keys";
import { clearState } from "../helpers/bindings";
import { seedKey, seedUser } from "../helpers/seed";

const USER_EMAIL = "reader@example.com";
const DELETED_AT = 1700000000;

async function setDeletedAt(userId: string, deletedAt: number | null): Promise<void> {
  await env.DB.prepare("UPDATE users SET deleted_at = ?1 WHERE id = ?2").bind(deletedAt, userId).run();
}

describe("resolveApiKey", () => {
  beforeEach(async () => {
    await clearState();
  });

  it("resolves the key of an active user", async () => {
    const userId = await seedUser(USER_EMAIL);
    const key = await seedKey(userId);

    const auth = await resolveApiKey(env, key);

    expect(auth).toMatchObject({ userId, email: USER_EMAIL, via: "key" });
  });

  it("returns null for the key of a deleted user and never caches it", async () => {
    const userId = await seedUser(USER_EMAIL);
    const key = await seedKey(userId);
    await setDeletedAt(userId, DELETED_AT);

    expect(await resolveApiKey(env, key)).toBeNull();

    await setDeletedAt(userId, null);
    expect(await resolveApiKey(env, key)).toMatchObject({ userId });
  });
});
