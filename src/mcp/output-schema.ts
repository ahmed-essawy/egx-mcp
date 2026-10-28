import { z } from "zod";

export const provenanceSchema = z.object({
  fields: z.array(z.string()).min(1),
  source: z.string(),
  dataTime: z.string().nullable(),
  timeKind: z.enum(["trade", "fetched", "close", "period"]),
  stale: z.boolean(),
  basis: z.enum(["primary", "backup", "computed"]),
});

export const metaSchema = z.object({
  label: z.enum(["delayed", "end_of_day", "daily_nav", "owner_entered", "personal"]),
  dataTime: z.string().nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  session: z.object({ date: z.string(), status: z.string() }).nullable(),
  notAvailable: z.array(z.object({ field: z.string(), reason: z.string() })),
  provenance: z.array(provenanceSchema),
});

export function envelopeSchema<D extends z.ZodType>(data: D) {
  return z.object({ data, meta: metaSchema, notice: z.string() });
}
