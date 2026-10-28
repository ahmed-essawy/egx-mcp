import { isaghaRetail } from "../providers/gold-egypt";
import { EMPTY_SPOT, EMPTY_USD_EGP, fetchFxMetals, tradingViewFxMetals, type FxMetals } from "../providers/tradingview";
import type { SpotPrice } from "../providers/types";
import type { NewNotice } from "../store/d1/events";
import type { EgyptMetals, FxEntry, Snapshot, SpotMetalEntry } from "../store/kv";
import { errorMessage, jobFailedNotice } from "./errors";

const METALS_FX_STEP = "metalsFx";
const USD_EGP = "USDEGP";
const SPOT_UNIT = "USD/oz";
const RETAIL_UNIT = "EGP/g";

type Spot = Pick<Snapshot["metals"], "XAUUSD" | "XAGUSD">;
type Fetched<T> = { value: T } | { source: string; error: string };

export type MetalsFxRefresh = {
  fx: Snapshot["fx"];
  metals: Snapshot["metals"];
  notices: NewNotice[];
};

async function attempt<T>(source: string, load: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { value: await load() };
  } catch (error) {
    return { source, error: errorMessage(error) };
  }
}

function toSpotEntry(price: SpotPrice | null, source: string): SpotMetalEntry | undefined {
  if (price === null) return undefined;
  return { v: price.value, unit: SPOT_UNIT, tt: price.tradeTime, src: source };
}

function toFx({ usdEgp }: FxMetals, source: string): Fetched<Snapshot["fx"]> {
  if (usdEgp === null) return { source, error: EMPTY_USD_EGP };
  const entry: FxEntry = { v: usdEgp.rate, tt: usdEgp.tradeTime, src: source, kind: usdEgp.kind };
  return { value: { [USD_EGP]: entry } };
}

function toSpot({ spot }: FxMetals, source: string): Fetched<Spot> {
  const gold = toSpotEntry(spot.XAUUSD, source);
  const silver = toSpotEntry(spot.XAGUSD, source);
  if (gold === undefined && silver === undefined) return { source, error: EMPTY_SPOT };
  return { value: { ...(gold && { XAUUSD: gold }), ...(silver && { XAGUSD: silver }) } };
}

function splitScan(scan: Fetched<FxMetals>): [Fetched<Snapshot["fx"]>, Fetched<Spot>] {
  if ("value" in scan) return [toFx(scan.value, tradingViewFxMetals.id), toSpot(scan.value, tradingViewFxMetals.id)];
  return [scan, scan];
}

async function fetchEgypt(now: number): Promise<EgyptMetals> {
  const { gold, silver } = await isaghaRetail.fetchRetail();
  return { src: isaghaRetail.id, fetchedAt: now, unit: RETAIL_UNIT, gold, silver };
}

function failureNotices(job: string, now: number, results: Fetched<unknown>[]): NewNotice[] {
  return results.flatMap((result) =>
    "error" in result ? [jobFailedNotice(job, METALS_FX_STEP, result.source, result.error, now)] : [],
  );
}

export async function refreshMetalsFx(
  job: string,
  previous: Pick<Snapshot, "fx" | "metals">,
  now: number,
  includeRetail: boolean,
): Promise<MetalsFxRefresh> {
  const [scan, egypt] = await Promise.all([
    attempt(tradingViewFxMetals.id, fetchFxMetals),
    includeRetail ? attempt(isaghaRetail.id, () => fetchEgypt(now)) : Promise.resolve(null),
  ]);
  const [fx, spot] = splitScan(scan);
  return {
    fx: "value" in fx ? { ...previous.fx, ...fx.value } : previous.fx,
    metals: {
      ...previous.metals,
      ...("value" in spot ? spot.value : {}),
      ...(egypt !== null && "value" in egypt ? { egypt: egypt.value } : {}),
    },
    notices: failureNotices(job, now, egypt === null ? [fx, spot] : [fx, spot, egypt]),
  };
}
