import type { NewIndexValue } from "../store/d1/bars";
import type { Snapshot } from "../store/kv";
import { cairoParts } from "./calendar";
import { INDEX_CODES } from "./indices";

export function indexClosesOf(snapshot: Pick<Snapshot, "indices" | "session">, date: string): NewIndexValue[] {
  if (snapshot.session.date !== date) return [];
  return INDEX_CODES.flatMap((indexCode) => {
    const entry = snapshot.indices[indexCode];
    if (entry === undefined || cairoParts(entry.tt).date !== date) return [];
    return [{ indexCode, sessionDate: date, close: entry.v, changePct: entry.chp, source: entry.src }];
  });
}
