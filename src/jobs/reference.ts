import { raiseNotices } from "../store/d1/events";
import { getSnapshot, putSnapshotIfChanged } from "../store/kv";
import { refreshMetalsFx } from "./metals-fx";

const JOB = "reference";

async function metalsFxStep(env: Env, now: number): Promise<void> {
  const snapshot = await getSnapshot(env);
  if (snapshot === null) return;
  const { fx, metals, notices } = await refreshMetalsFx(JOB, snapshot, now, true);
  await putSnapshotIfChanged(env, { ...snapshot, fx, metals });
  await raiseNotices(env.DB, notices);
}

export async function referenceJob(env: Env, now: number): Promise<void> {
  await metalsFxStep(env, now);
}
