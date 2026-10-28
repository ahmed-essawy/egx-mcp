import { OAuthProvider, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { API_KEY_SCOPES, resolveApiKey, type AuthProps } from "./auth/api-keys";
import { loadConfig, resolvePublicOrigin } from "./config";
import { nowSeconds } from "./domain/calendar";
import { defaultHandler, internalErrorResponse } from "./http/routes";
import { MCP_PATH, mcpUrl } from "./http/views";
import { scheduled } from "./jobs/dispatch";
import { guardOauth, oauthWriteCost } from "./limits/oauth-guard";
import { createServer } from "./mcp/server";

const AUTHORIZE_ROUTE = "/authorize";
const TOKEN_ROUTE = "/token";
const REGISTER_ROUTE = "/register";
const ACCESS_TOKEN_TTL_SECONDS = 86_400;

const mcpHandler: Required<Pick<ExportedHandler<Env>, "fetch">> = {
  fetch(request, env, ctx) {
    const { auth: grant, props: rawProps } = ctx as OAuthResourceContext<unknown>;
    const props = rawProps as Omit<AuthProps, "scopes"> & Partial<Pick<AuthProps, "scopes">>;
    const auth: AuthProps = { ...props, scopes: props.via === "oauth" ? grant.scope : (props.scopes ?? []) };
    return createMcpHandler(() => createServer(env, auth))(request, env, ctx);
  },
};

function createProvider(origin: string): OAuthProvider<Env> {
  const resource = mcpUrl(origin);
  return new OAuthProvider<Env>({
    apiRoute: MCP_PATH,
    apiHandler: mcpHandler,
    defaultHandler,
    authorizeEndpoint: AUTHORIZE_ROUTE,
    tokenEndpoint: TOKEN_ROUTE,
    clientRegistrationEndpoint: REGISTER_ROUTE,
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

function providerFor(request: Request, env: Env): OAuthProvider<Env> | null {
  try {
    const origin = resolvePublicOrigin(request, env);
    if (origin === null) return null;
    if (cachedProvider?.origin !== origin) cachedProvider = { origin, provider: createProvider(origin) };
    return cachedProvider.provider;
  } catch (error) {
    console.error("provider_failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

async function guardedResponse(request: Request, env: Env): Promise<Response | null> {
  if (oauthWriteCost(request) === 0) return null;
  try {
    return await guardOauth(env, loadConfig(env), request, nowSeconds());
  } catch (error) {
    console.error("oauth_guard_failed", error instanceof Error ? error.message : "unknown");
    return internalErrorResponse();
  }
}

export default {
  fetch: async (request, env, ctx) => {
    const refused = await guardedResponse(request, env);
    if (refused !== null) return refused;
    const provider = providerFor(request, env);
    return provider === null ? internalErrorResponse() : provider.fetch(request, env, ctx);
  },
  scheduled,
} satisfies ExportedHandler<Env>;
