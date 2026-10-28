import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { toCairoIso } from "../../domain/calendar";
import { getSnapshot, type BuySell, type EgyptMetals, type FxEntry, type Snapshot, type SpotMetalEntry } from "../../store/kv";
import { defineTool } from "../define-tool";
import { fail, ok, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { roundPrice } from "../rounding";
import { newestDataTime } from "../shared";

const NOT_AVAILABLE_REASON = "not available from current sources";
const SNAPSHOT_MISSING_MESSAGE = "The market snapshot is not built yet.";
const FX_MISSING_MESSAGE = "The USD/EGP rate is not available from current sources.";
const FX_PAIR = "USDEGP";
const FETCHED_KIND = "fetched";
const GOLD_KARATS = ["18", "21", "24"] as const;
const SILVER_FINENESS = ["925", "999"] as const;
const GLOBAL_CODES = ["XAUUSD", "XAGUSD"] as const;

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
type EgyptEntries = [string, EgyptItem | NotAvailable][];

const NOT_AVAILABLE: NotAvailable = { status: "not_available", reason: NOT_AVAILABLE_REASON };

function egyptItemOf(egypt: EgyptMetals, quote: BuySell | undefined): EgyptItem | NotAvailable {
  if (!quote) return NOT_AVAILABLE;
  return {
    buy: roundPrice(quote.buy),
    sell: roundPrice(quote.sell),
    unit: egypt.unit,
    dataTime: toCairoIso(egypt.fetchedAt),
    dataTimeKind: FETCHED_KIND,
    source: egypt.src,
  };
}

function egyptSection(egypt: EgyptMetals | undefined): Record<string, EgyptItem | NotAvailable> {
  const entries: EgyptEntries = [
    ...GOLD_KARATS.map((karat): [string, EgyptItem | NotAvailable] => [
      `gold${karat}k`,
      egypt ? egyptItemOf(egypt, egypt.gold[karat]) : NOT_AVAILABLE,
    ]),
    ...SILVER_FINENESS.map((fineness): [string, EgyptItem | NotAvailable] => [
      `silver${fineness}`,
      egypt ? egyptItemOf(egypt, egypt.silver[fineness]) : NOT_AVAILABLE,
    ]),
  ];
  return Object.fromEntries(entries);
}

function globalItemOf(entry: SpotMetalEntry | undefined): GlobalItem | NotAvailable {
  if (!entry) return NOT_AVAILABLE;
  return { value: roundPrice(entry.v), unit: entry.unit, dataTime: toCairoIso(entry.tt), source: entry.src };
}

function globalSection(metals: Snapshot["metals"]): Record<string, GlobalItem | NotAvailable> {
  return Object.fromEntries(GLOBAL_CODES.map((code) => [code, globalItemOf(metals[code])]));
}

function metalsMeta(metals: Snapshot["metals"]): Meta {
  const spots = GLOBAL_CODES.flatMap((code) => (metals[code] ? [metals[code]] : []));
  const timestamps = [...spots.map((spot) => spot.tt), ...(metals.egypt ? [metals.egypt.fetchedAt] : [])];
  return {
    label: "delayed",
    dataTime: newestDataTime(timestamps),
    source: spots[0]?.src ?? metals.egypt?.src ?? null,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: [],
  };
}

function fxMeta(entry: FxEntry): Meta {
  return {
    label: "delayed",
    dataTime: toCairoIso(entry.tt),
    source: entry.src,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: [],
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
        return ok({ egypt: egyptSection(metals.egypt), global: globalSection(metals) }, metalsMeta(metals));
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
        return ok(data, fxMeta(entry));
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
