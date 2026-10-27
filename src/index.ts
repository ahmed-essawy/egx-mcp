import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { API_KEY_SCOPES, resolveApiKey, type AuthProps } from "./auth/api-keys";
import { loadConfig, parseOrigin } from "./config";
import { defaultHandler, internalErrorResponse } from "./http/routes";
import { scheduled } from "./jobs/dispatch";
import { createServer } from "./mcp/server";

const MCP_ROUTE = "/mcp";
const AUTHORIZE_ROUTE = "/authorize";
const TOKEN_ROUTE = "/token";
const ACCESS_TOKEN_TTL_SECONDS = 86_400;

const mcpHandler: Required<Pick<ExportedHandler<Env>, "fetch">> = {
  fetch(request, env, ctx) {
    const auth = ctx.props as AuthProps;
    return createMcpHandler(() => createServer(env, auth))(request, env, ctx);
  },
};

function createProvider(origin: string): OAuthProvider<Env> {
  const resource = new URL(MCP_ROUTE, origin).href;
  return new OAuthProvider<Env>({
    apiRoute: MCP_ROUTE,
    apiHandler: mcpHandler,
    defaultHandler,
    authorizeEndpoint: AUTHORIZE_ROUTE,
    tokenEndpoint: TOKEN_ROUTE,
    scopesSupported: [...API_KEY_SCOPES],
    resourceMetadata: { resource },
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    resolveExternalToken: async ({ token, env }) => {
      const props = await resolveApiKey(env, token);
      return props === null ? null : { props, audience: resource };
    },
  });
}

let cachedProvider: { origin: string; provider: OAuthProvider<Env> } | undefined;

function resolveOrigin(request: Request, env: Env): string | null {
  const configured = loadConfig(env).publicOrigin;
  return configured === "" ? new URL(request.url).origin : parseOrigin(configured);
}

function providerFor(request: Request, env: Env): OAuthProvider<Env> | null {
  try {
    const origin = resolveOrigin(request, env);
    if (origin === null) return null;
    if (cachedProvider?.origin !== origin) cachedProvider = { origin, provider: createProvider(origin) };
    return cachedProvider.provider;
  } catch (error) {
    console.error("provider_failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export default {
  fetch: (request, env, ctx) => {
    const provider = providerFor(request, env);
    return provider === null ? internalErrorResponse() : provider.fetch(request, env, ctx);
  },
  scheduled,
} satisfies ExportedHandler<Env>;
