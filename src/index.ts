import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { oauthOptions } from "./auth/oauth-options";
import { loadConfig, resolvePublicOrigin } from "./config";
import { nowSeconds } from "./domain/calendar";
import { defaultHandler, internalErrorResponse } from "./http/routes";
import { scheduled } from "./jobs/dispatch";
import { guardOauthEntry } from "./limits/oauth-guard";

function createProvider(origin: string): OAuthProvider<Env> {
  return new OAuthProvider<Env>(oauthOptions(origin));
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
  try {
    return await guardOauthEntry(env, loadConfig(env), request, nowSeconds());
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
