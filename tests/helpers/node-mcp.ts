import type { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/server";
import wrangler from "../../wrangler.jsonc?raw";
import type { AuthProps } from "../../src/auth/api-keys";
import { createServer } from "../../src/mcp/server";
import { __resetKvMemo } from "../../src/store/kv";
import { createSqliteD1 } from "./sqlite-d1";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "node-harness", version: "1.0.0" };
const INITIALIZE_ID = 1;
const REQUEST_ID = 2;

export const NODE_AUTH: AuthProps = {
  userId: "node-user",
  email: "node@example.com",
  via: "key",
  keyId: "node-key",
  scopes: ["mcp:write"],
};

export type NodeStores = { env: Env; sqlite: DatabaseSync; kv: Map<string, string> };

export type ListedTool = { name: string; description?: string; annotations?: { readOnlyHint?: boolean } };

type RpcResponse = { id?: number; result?: unknown; error?: { code: number; message: string } };

function varsOfWrangler(): Record<string, string> {
  return (JSON.parse(wrangler) as { vars: Record<string, string> }).vars;
}

function createKv(kv: Map<string, string>): KVNamespace {
  return {
    async get(key: string) {
      const text = kv.get(key);
      return text === undefined ? null : JSON.parse(text);
    },
    async put(key: string, text: string) {
      kv.set(key, text);
    },
    async delete(key: string) {
      kv.delete(key);
    },
  } as unknown as KVNamespace;
}

export function createNodeStores(): NodeStores {
  const { db, sqlite } = createSqliteD1();
  const kv = new Map<string, string>();
  sqlite
    .prepare("INSERT INTO users (id, google_sub, email, created_at) VALUES (?1, ?2, ?3, ?4)")
    .run(NODE_AUTH.userId, `sub-${NODE_AUTH.userId}`, NODE_AUTH.email, 0);
  const env = {
    ...varsOfWrangler(),
    PUBLIC_ORIGIN: "",
    DB: db,
    DATA: createKv(kv),
    RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  __resetKvMemo();
  return { env, sqlite, kv };
}

export function putJson(stores: NodeStores, key: string, value: unknown): void {
  stores.kv.set(key, JSON.stringify(value));
}

async function request<T>(env: Env, method: string, params?: Record<string, unknown>): Promise<T> {
  const server = createServer(env, NODE_AUTH);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const responses = new Map<number, RpcResponse>();
  clientTransport.onmessage = (message) => {
    const response = message as RpcResponse;
    if (response.id !== undefined) responses.set(response.id, response);
  };
  await server.connect(serverTransport);
  await clientTransport.start();
  await clientTransport.send({
    jsonrpc: "2.0",
    id: INITIALIZE_ID,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await clientTransport.send({ jsonrpc: "2.0", id: REQUEST_ID, method, params });
  await vi.waitFor(() => {
    if (!responses.has(REQUEST_ID)) throw new Error(`no response to ${method}`);
  });
  await server.close();
  const response = responses.get(REQUEST_ID)!;
  if (response.error) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result as T;
}

export async function listNodeTools(env: Env): Promise<ListedTool[]> {
  const result = await request<{ tools: ListedTool[] }>(env, "tools/list");
  return result.tools;
}

export async function callNodeTool(env: Env, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  __resetKvMemo();
  return request<CallToolResult>(env, "tools/call", { name, arguments: args });
}
