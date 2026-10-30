import type { OAuthProviderOptions, OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import type { Icon } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { mcpIcons } from "../http/icons";
import { defaultHandler } from "../http/routes";
import { MCP_PATH, mcpUrl } from "../http/views";
import { createServer } from "../mcp/server";
import { API_KEY_SCOPES, resolveApiKey, type AuthProps } from "./api-keys";

const AUTHORIZE_ROUTE = "/authorize";
const TOKEN_ROUTE = "/token";
const REGISTER_ROUTE = "/register";
const ACCESS_TOKEN_TTL_SECONDS = 86_400;

function mcpApiHandler(icons: Icon[]): Required<Pick<ExportedHandler<Env>, "fetch">> {
  return {
    fetch(request, env, ctx) {
      const { auth: grant, props: rawProps } = ctx as OAuthResourceContext<unknown>;
      const props = rawProps as Omit<AuthProps, "scopes"> & Partial<Pick<AuthProps, "scopes">>;
      const auth: AuthProps = { ...props, scopes: props.via === "oauth" ? grant.scope : (props.scopes ?? []) };
      return createMcpHandler(() => createServer(env, auth, icons))(request, env, ctx);
    },
  };
}

export function oauthOptions(origin: string): OAuthProviderOptions<Env> {
  const resource = mcpUrl(origin);
  return {
    apiRoute: MCP_PATH,
    apiHandler: mcpApiHandler(mcpIcons(origin)),
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
  };
}
