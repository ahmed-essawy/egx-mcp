import type { GoogleIdentity } from "../auth/google";
import type { Config } from "../config";
import { utcDay } from "../domain/calendar";
import { checkPersonalWrite } from "../limits/usage";
import { addPersonalRows, readGlobal } from "../store/d1/usage";
import { upsertUserByGoogleSub } from "../store/d1/users";
import { STATUS_FORBIDDEN } from "./status";
import { messageResponse } from "./responses";

const NEW_USER_WORST_CASE_ROWS = 4;
const ACCOUNT_DELETED_TITLE = "Account deleted";
const ACCOUNT_DELETED_MESSAGE = "This account has been deleted and cannot sign in.";

export type SignInResult = { kind: "capacity" } | { kind: "deleted" } | { kind: "ok"; id: string };

export async function hasCapacity(env: Env, cfg: Config, now: number, worstCaseRows: number): Promise<boolean> {
  return checkPersonalWrite(await readGlobal(env.DB, utcDay(now)), cfg, worstCaseRows);
}

export async function recordPersonalRows(env: Env, now: number, rowsWritten: number): Promise<void> {
  if (rowsWritten > 0) await addPersonalRows(env.DB, utcDay(now), rowsWritten);
}

export function accountDeletedResponse(cookies: string[]): Response {
  return messageResponse(ACCOUNT_DELETED_TITLE, ACCOUNT_DELETED_MESSAGE, STATUS_FORBIDDEN, cookies);
}

export async function signInGoogleUser(
  env: Env,
  cfg: Config,
  identity: GoogleIdentity,
  now: number,
): Promise<SignInResult> {
  if (!(await hasCapacity(env, cfg, now, NEW_USER_WORST_CASE_ROWS))) return { kind: "capacity" };
  const { id, deletedAt, rowsWritten } = await upsertUserByGoogleSub(env.DB, identity, now);
  await recordPersonalRows(env, now, rowsWritten);
  return deletedAt === null ? { kind: "ok", id } : { kind: "deleted" };
}
