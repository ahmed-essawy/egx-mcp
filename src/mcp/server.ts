import { McpServer } from "@modelcontextprotocol/server";
import type { AuthProps } from "../auth/api-keys";
import { registerMarketTools } from "./tools/market";
import { registerPriceTools } from "./tools/prices";
import { registerPersonalTools } from "./tools/personal";
import { registerQuoteTools } from "./tools/quotes";
import { registerSearchTools } from "./tools/search";

export { defineTool, type ToolContext, type ToolDefinition } from "./define-tool";

const SERVER_NAME = "egx-mcp";
const SERVER_VERSION = "1.0.0";

export function createServer(env: Env, auth: AuthProps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerSearchTools(server, env, auth);
  registerQuoteTools(server, env, auth);
  registerMarketTools(server, env, auth);
  registerPriceTools(server, env, auth);
  registerPersonalTools(server, env, auth);
  return server;
}
