import { SELF } from "cloudflare:test";
import { expect } from "vitest";

const MCP_URL = "https://egx.test/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "egx-test", version: "1.0.0" };
const DATA_PREFIX = "data: ";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

export type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

type JsonRpcResponse = { result?: ToolResult; error?: { code: number; message: string } };

export function postMcp(body: JsonRpcRequest, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return SELF.fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

async function parseRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text) as JsonRpcResponse;
  }
  const dataLine = text.split("\n").find((line) => line.startsWith(DATA_PREFIX));
  if (!dataLine) throw new Error(`MCP response has no data event: ${text}`);
  return JSON.parse(dataLine.slice(DATA_PREFIX.length)) as JsonRpcResponse;
}

function initializeRequest(bearer: string): Promise<Response> {
  return postMcp(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    },
    bearer,
  );
}

export async function initialize(bearer: string): Promise<Record<string, unknown>> {
  return (await parseRpc(await initializeRequest(bearer))).result as unknown as Record<string, unknown>;
}

export async function callTool(name: string, args: Record<string, unknown>, bearer: string): Promise<ToolResult> {
  await initializeRequest(bearer);
  const response = await postMcp(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
    bearer,
  );
  const rpc = await parseRpc(response);
  if (!rpc.result) throw new Error(`MCP call ${name} failed: ${rpc.error?.message ?? response.status}`);
  return rpc.result;
}

export function errorCodeOf(result: ToolResult): string {
  return (result.structuredContent as { error: { code: string } }).error.code;
}

export function payloadOf<T>(result: ToolResult): T {
  expect(result.isError).toBeFalsy();
  return result.structuredContent as unknown as T;
}
