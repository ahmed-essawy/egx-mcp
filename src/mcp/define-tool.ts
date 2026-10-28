import type { CallToolResult, McpServer, StandardSchemaWithJSON, ToolCallback } from "@modelcontextprotocol/server";
import type { AuthProps } from "../auth/api-keys";
import { loadConfig, type Config } from "../config";
import { checkLimits, finishCall, RowsCounter } from "../limits/usage";
import { nowSeconds } from "../domain/calendar";
import type { UsageSnapshot } from "../store/d1/usage";
import { fail, NOTICE } from "./envelope";
import type { ToolName } from "./tool-names";

const INTERNAL_ERROR_MESSAGE = "Temporarily unavailable.";
const ISSUE_SEPARATOR = "; ";
const PATH_SEPARATOR = ".";
const PATH_PREFIX_SEPARATOR = ": ";
const INVALID_INPUT = Symbol("invalid_input");

type Issue = { message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };
type InvalidInput = { [INVALID_INPUT]: string };

export type ToolContext = {
  env: Env;
  cfg: Config;
  auth: AuthProps;
  rows: RowsCounter;
  usage: UsageSnapshot;
  now: number;
};

export type ToolDefinition<I extends StandardSchemaWithJSON, O extends StandardSchemaWithJSON> = {
  name: ToolName;
  description: string;
  inputSchema: I;
  outputSchema: O;
  readOnly: boolean;
  handler: (args: StandardSchemaWithJSON.InferOutput<I>, ctx: ToolContext) => Promise<CallToolResult>;
};

function isInvalidInput(args: unknown): args is InvalidInput {
  return typeof args === "object" && args !== null && INVALID_INPUT in args;
}

function describeIssue(issue: Issue): string {
  const path = (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment));
  return path.length === 0 ? issue.message : `${path.join(PATH_SEPARATOR)}${PATH_PREFIX_SEPARATOR}${issue.message}`;
}

function reportInvalidInput<S extends StandardSchemaWithJSON>(schema: S): S {
  const standard = schema["~standard"];
  const validate: typeof standard.validate = async (value, options) => {
    const result = await standard.validate(value, options);
    if (!result.issues) return result;
    const invalid: InvalidInput = {
      [INVALID_INPUT]: result.issues.map(describeIssue).join(ISSUE_SEPARATOR),
    };
    return { value: invalid };
  };
  return Object.create(schema, { "~standard": { value: { ...standard, validate } } }) as S;
}

function logToolFailure(name: string, error: unknown): void {
  console.error("tool_failed", name, error instanceof Error ? error.message : "unknown");
}

async function serveCall<I extends StandardSchemaWithJSON, O extends StandardSchemaWithJSON>(
  tool: ToolDefinition<I, O>,
  args: StandardSchemaWithJSON.InferOutput<I>,
  env: Env,
  auth: AuthProps,
): Promise<CallToolResult> {
  const cfg = loadConfig(env);
  const rows = new RowsCounter();
  const now = nowSeconds();
  const limits = await checkLimits(env, cfg, auth, now, rows);
  if (!limits.ok) return fail(limits.code, limits.message, { retryAt: limits.retryAt });
  let result: CallToolResult;
  try {
    result = await tool.handler(args, { env, cfg, auth, rows, usage: limits.usage, now });
  } catch (error) {
    logToolFailure(tool.name, error);
    result = fail("not_available", INTERNAL_ERROR_MESSAGE);
  }
  await finishCall(env, auth, tool.name, rows, now, limits.usage);
  return result;
}

export function defineTool<I extends StandardSchemaWithJSON, O extends StandardSchemaWithJSON>(
  server: McpServer,
  tool: ToolDefinition<I, O>,
  env: Env,
  auth: AuthProps,
): void {
  server.registerTool<O, I>(
    tool.name,
    {
      description: `${tool.description} ${NOTICE}`,
      inputSchema: reportInvalidInput(tool.inputSchema),
      outputSchema: tool.outputSchema,
      annotations: { readOnlyHint: tool.readOnly },
    },
    (async (args: StandardSchemaWithJSON.InferOutput<I> | InvalidInput) => {
      if (isInvalidInput(args)) return fail("invalid_input", args[INVALID_INPUT]);
      try {
        return await serveCall(tool, args, env, auth);
      } catch (error) {
        logToolFailure(tool.name, error);
        return fail("not_available", INTERNAL_ERROR_MESSAGE);
      }
    }) as ToolCallback<I>,
  );
}
