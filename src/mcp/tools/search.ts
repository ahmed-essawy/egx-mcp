import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import { toCairoIso } from "../../domain/calendar";
import { getDirectory, type Directory, type DirectoryFund, type DirectorySymbol } from "../../store/kv";
import { defineTool } from "../define-tool";
import { ok, type Meta, type Provenance } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { computedProvenance, DIRECTORY_SOURCE } from "../provenance";
import { MAX_SYMBOL_INPUT_LENGTH, searchDirectory, type SearchHit } from "../resolve";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const RESULTS_FIELD = "results";
const DIRECTORY_EMPTY_REASON = "directory not built yet";

const inputSchema = z.object({
  query: z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH),
  type: z.enum(["stock", "fund", "any"]).default("any"),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const stockResultSchema = z.object({
  type: z.literal("stock"),
  isin: z.string(),
  ticker: z.string(),
  nameAr: z.string().nullable(),
  nameEn: z.string().nullable(),
  sector: z.string().nullable(),
  status: z.enum(["pending", "active", "inactive"]),
});

const fundResultSchema = z.object({
  type: z.literal("fund"),
  fundId: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  manager: z.string().nullable(),
});

const outputSchema = envelopeSchema(
  z.object({ results: z.array(z.discriminatedUnion("type", [stockResultSchema, fundResultSchema])) }),
);

type SearchResult = z.infer<typeof stockResultSchema> | z.infer<typeof fundResultSchema>;

function stockResult([isin, ticker, nameAr, nameEn, sector, status]: DirectorySymbol): SearchResult {
  return { type: "stock", isin, ticker, nameAr, nameEn, sector, status };
}

function fundResult([fundId, nameAr, nameEn, manager]: DirectoryFund): SearchResult {
  return { type: "fund", fundId, nameAr, nameEn, manager };
}

function toResult(hit: SearchHit): SearchResult {
  return hit.type === "stock" ? stockResult(hit.entry) : fundResult(hit.entry);
}

function isEmpty(directory: Directory | null): boolean {
  return directory === null || (directory.symbols.length === 0 && directory.funds.length === 0);
}

function provenanceFor(directory: Directory | null): Provenance[] {
  if (directory === null || isEmpty(directory)) return [];
  return [computedProvenance([RESULTS_FIELD], DIRECTORY_SOURCE, toCairoIso(directory.builtAt), "fetched", false)];
}

function metaFor(directory: Directory | null): Meta {
  return {
    label: "delayed",
    dataTime: directory ? toCairoIso(directory.builtAt) : null,
    source: DIRECTORY_SOURCE,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: isEmpty(directory) ? [{ field: DIRECTORY_SOURCE, reason: DIRECTORY_EMPTY_REASON }] : [],
    provenance: provenanceFor(directory),
  };
}

export function registerSearchTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "search",
      description: "Find Egyptian stocks and mutual funds by ticker, ISIN, or Arabic or English name.",
      inputSchema,
      outputSchema,
      readOnly: true,
      handler: async ({ query, type, limit }, ctx) => {
        const directory = await getDirectory(ctx.env);
        const hits = directory ? searchDirectory(directory, query, type, limit) : [];
        return ok({ results: hits.map(toResult) }, metaFor(directory));
      },
    },
    env,
    auth,
  );
}
