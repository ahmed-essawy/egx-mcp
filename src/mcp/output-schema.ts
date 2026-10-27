import { z } from "zod";

export const metaSchema = z.object({
  label: z.enum(["delayed", "end_of_day", "daily_nav", "owner_entered", "personal"]),
  dataTime: z.string().nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  session: z.object({ date: z.string(), status: z.string() }).nullable(),
  notAvailable: z.array(z.object({ field: z.string(), reason: z.string() })),
});

export function envelopeSchema<D extends z.ZodType>(data: D) {
  return z.object({ data, meta: metaSchema, notice: z.string() });
}
