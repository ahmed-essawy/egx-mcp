import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { toCairoIso } from "../../domain/calendar";
import { getSnapshot, type BuySell, type EgyptMetals, type FxEntry, type Snapshot, type SpotMetalEntry } from "../../store/kv";
import { defineTool } from "../define-tool";
import { fail, ok, type Meta, type Provenance } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { groupBySource } from "../provenance";
import { roundPrice } from "../rounding";
import { newestDataTime } from "../shared";

const NOT_AVAILABLE_REASON = "not available from current sources";
const SNAPSHOT_MISSING_MESSAGE = "The market snapshot is not built yet.";
const FX_MISSING_MESSAGE = "The USD/EGP rate is not available from current sources.";
const FX_PAIR = "USDEGP";
const FETCHED_KIND = "fetched";
const POUND_UNIT = "EGP/piece";
const GLOBAL_CODES = ["XAUUSD", "XAGUSD"] as const;
const SECONDS_PER_HOUR = 3600;
const EGYPT_RETAIL_STALE_HOURS = 26;
const SPOT_STALE_HOURS = 72;
const EGYPT_RETAIL_STALE_SECONDS = EGYPT_RETAIL_STALE_HOURS * SECONDS_PER_HOUR;
const SPOT_STALE_SECONDS = SPOT_STALE_HOURS * SECONDS_PER_HOUR;

const emptyInputSchema = z.object({});

const notAvailableSchema = z.object({ status: z.literal("not_available"), reason: z.string() });

const egyptItemSchema = z.object({
  buy: z.number(),
  sell: z.number(),
  unit: z.string(),
  dataTime: z.string(),
  dataTimeKind: z.literal(FETCHED_KIND),
  source: z.string(),
});

const globalItemSchema = z.object({
  value: z.number(),
  unit: z.string(),
  dataTime: z.string(),
  source: z.string(),
});

const metalsOutputSchema = envelopeSchema(
  z.object({
    egypt: z.record(z.string(), z.union([egyptItemSchema, notAvailableSchema])),
    global: z.record(z.string(), z.union([globalItemSchema, notAvailableSchema])),
  }),
);

const fxOutputSchema = envelopeSchema(
  z.object({
    rate: z.number(),
    kind: z.literal("market"),
    dataTime: z.string(),
    source: z.string(),
  }),
);

type NotAvailable = z.infer<typeof notAvailableSchema>;
type EgyptItem = z.infer<typeof egyptItemSchema>;
type GlobalItem = z.infer<typeof globalItemSchema>;
type EgyptGroup = "gold" | "silver";
type EgyptItemSpec = { key: string; group: EgyptGroup; unitKey: string; reportedUnit: string | null };

const NOT_AVAILABLE: NotAvailable = { status: "not_available", reason: NOT_AVAILABLE_REASON };

const EGYPT_ITEMS: EgyptItemSpec[] = [
  { key: "gold18k", group: "gold", unitKey: "18", reportedUnit: null },
  { key: "gold21k", group: "gold", unitKey: "21", reportedUnit: null },
  { key: "gold24k", group: "gold", unitKey: "24", reportedUnit: null },
  { key: "goldPound", group: "gold", unitKey: "pound", reportedUnit: POUND_UNIT },
  { key: "silver925", group: "silver", unitKey: "925", reportedUnit: null },
  { key: "silver999", group: "silver", unitKey: "999", reportedUnit: null },
];

function egyptItemOf(egypt: EgyptMetals, quote: BuySell | undefined, reportedUnit: string | null): EgyptItem | NotAvailable {
  if (!quote) return NOT_AVAILABLE;
  return {
    buy: roundPrice(quote.buy),
    sell: roundPrice(quote.sell),
    unit: reportedUnit ?? egypt.unit,
    dataTime: toCairoIso(egypt.fetchedAt),
    dataTimeKind: FETCHED_KIND,
    source: egypt.src,
  };
}

function egyptSection(egypt: EgyptMetals | undefined): Record<string, EgyptItem | NotAvailable> {
  return Object.fromEntries(
    EGYPT_ITEMS.map(({ key, group, unitKey, reportedUnit }) => [
      key,
      egypt ? egyptItemOf(egypt, egypt[group][unitKey], reportedUnit) : NOT_AVAILABLE,
    ]),
  );
}

function globalItemOf(entry: SpotMetalEntry | undefined): GlobalItem | NotAvailable {
  if (!entry) return NOT_AVAILABLE;
  return { value: roundPrice(entry.v), unit: entry.unit, dataTime: toCairoIso(entry.tt), source: entry.src };
}

function globalSection(metals: Snapshot["metals"]): Record<string, GlobalItem | NotAvailable> {
  return Object.fromEntries(GLOBAL_CODES.map((code) => [code, globalItemOf(metals[code])]));
}

function isEgyptStale(egypt: EgyptMetals, now: number): boolean {
  return now - egypt.fetchedAt > EGYPT_RETAIL_STALE_SECONDS;
}

function isSpotStale(tt: number, now: number): boolean {
  return now - tt > SPOT_STALE_SECONDS;
}

function metalsStaleReason(egypt: EgyptMetals | undefined, staleSpots: SpotMetalEntry[], now: number): string | null {
  if (egypt && isEgyptStale(egypt, now)) {
    return `Egypt retail prices fetched at ${toCairoIso(egypt.fetchedAt)} are older than ${EGYPT_RETAIL_STALE_HOURS} hours.`;
  }
  if (staleSpots.length === 0) return null;
  const oldest = Math.min(...staleSpots.map((spot) => spot.tt));
  return `Spot prices dated ${toCairoIso(oldest)} are older than ${SPOT_STALE_HOURS} hours.`;
}

function metalsProvenance(egypt: EgyptMetals | undefined, spots: SpotMetalEntry[], now: number): Provenance[] {
  const egyptEntries: Provenance[] = egypt
    ? [
        {
          fields: ["egypt"],
          source: egypt.src,
          dataTime: toCairoIso(egypt.fetchedAt),
          timeKind: "fetched",
          stale: isEgyptStale(egypt, now),
          basis: "primary",
        },
      ]
    : [];
  const spotEntries = [...groupBySource(spots, (spot) => spot.src)].map(([source, group]): Provenance => ({
    fields: ["global"],
    source,
    dataTime: toCairoIso(Math.max(...group.map((spot) => spot.tt))),
    timeKind: "trade",
    stale: group.some((spot) => isSpotStale(spot.tt, now)),
    basis: "primary",
  }));
  return [...egyptEntries, ...spotEntries];
}

function metalsMeta(metals: Snapshot["metals"], now: number): Meta {
  const spots = GLOBAL_CODES.flatMap((code) => (metals[code] ? [metals[code]] : []));
  const staleSpots = spots.filter((spot) => isSpotStale(spot.tt, now));
  const staleReason = metalsStaleReason(metals.egypt, staleSpots, now);
  const timestamps = [...spots.map((spot) => spot.tt), ...(metals.egypt ? [metals.egypt.fetchedAt] : [])];
  return {
    label: "delayed",
    dataTime: newestDataTime(timestamps),
    source: spots[0]?.src ?? metals.egypt?.src ?? null,
    stale: staleReason !== null,
    staleReason,
    session: null,
    notAvailable: [],
    provenance: metalsProvenance(metals.egypt, spots, now),
  };
}

function fxMeta(entry: FxEntry, now: number): Meta {
  const stale = isSpotStale(entry.tt, now);
  const dataTime = toCairoIso(entry.tt);
  return {
    label: "delayed",
    dataTime,
    source: entry.src,
    stale,
    staleReason: stale ? `The USD/EGP rate dated ${dataTime} is older than ${SPOT_STALE_HOURS} hours.` : null,
    session: null,
    notAvailable: [],
    provenance: [{ fields: ["rate"], source: entry.src, dataTime, timeKind: "trade", stale, basis: "primary" }],
  };
}

function registerMetals(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_metals",
      description: "Get delayed Egyptian gold and silver prices per gram and global gold and silver spot prices in USD.",
      inputSchema: emptyInputSchema,
      outputSchema: metalsOutputSchema,
      readOnly: true,
      handler: async (_args, ctx) => {
        const snapshot = await getSnapshot(ctx.env);
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        const { metals } = snapshot;
        return ok({ egypt: egyptSection(metals.egypt), global: globalSection(metals) }, metalsMeta(metals, ctx.now));
      },
    },
    env,
    auth,
  );
}

function registerUsdEgp(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "get_usd_egp",
      description: "Get the delayed USD to EGP market exchange rate.",
      inputSchema: emptyInputSchema,
      outputSchema: fxOutputSchema,
      readOnly: true,
      handler: async (_args, ctx) => {
        const snapshot = await getSnapshot(ctx.env);
        if (snapshot === null) return fail("not_available", SNAPSHOT_MISSING_MESSAGE);
        const entry = snapshot.fx[FX_PAIR];
        if (!entry) return fail("not_available", FX_MISSING_MESSAGE);
        const data = { rate: roundPrice(entry.v), kind: entry.kind, dataTime: toCairoIso(entry.tt), source: entry.src };
        return ok(data, fxMeta(entry, ctx.now));
      },
    },
    env,
    auth,
  );
}

export function registerPriceTools(server: McpServer, env: Env, auth: AuthProps): void {
  registerMetals(server, env, auth);
  registerUsdEgp(server, env, auth);
}
