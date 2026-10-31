import { mcpIcons } from "../http/icons";
import { SERVER_VERSION } from "../mcp/server";
import type { SiteContext } from "./content-model";
import { SITE } from "./identity";
import { newestUpdated } from "./pages";
import { toolEntries } from "./tool-catalog";

const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const CATALOG_SPEC_VERSION = "1.0";
const CATALOG_IDENTIFIER = "urn:air:egx-mcp:mcp:egx-mcp";
const SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";
const AUTHORIZATION_HEADER = "Authorization";
const BEARER_FORMAT = "Bearer <your key>";
const META_NAMESPACE = SITE.registryName.split("/")[0];
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource/mcp";
const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

export function serverCard(ctx: SiteContext) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: SITE.registryName,
    version: SERVER_VERSION,
    title: SITE.name,
    description: SITE.registryDescription,
    websiteUrl: `${ctx.origin}/`,
    repository: { url: SITE.repositoryUrl, source: "github" },
    icons: mcpIcons(ctx.origin),
    remotes: [
      {
        type: "streamable-http",
        url: ctx.mcpUrl,
        headers: [
          {
            name: AUTHORIZATION_HEADER,
            description: `Optional. Bearer API key from ${ctx.dashboardUrl}, sent as ${BEARER_FORMAT}. Leave it out to sign in with Google through OAuth.`,
            isRequired: false,
            isSecret: true,
          },
        ],
      },
    ],
    _meta: {
      [`${META_NAMESPACE}/auth`]: {
        oauth: {
          protectedResourceMetadata: `${ctx.origin}${PROTECTED_RESOURCE_PATH}`,
          authorizationServerMetadata: `${ctx.origin}${AUTHORIZATION_SERVER_PATH}`,
          identityProvider: "Google",
        },
        apiKey: { header: AUTHORIZATION_HEADER, format: BEARER_FORMAT, createAt: ctx.dashboardUrl },
      },
      [`${META_NAMESPACE}/tools`]: toolEntries().map(({ name, description }) => ({ name, description })),
      [`${META_NAMESPACE}/data-notice`]: SITE.dataLimits,
      [`${META_NAMESPACE}/updated`]: newestUpdated(),
    },
  };
}

export function aiCatalog(ctx: SiteContext) {
  return {
    specVersion: CATALOG_SPEC_VERSION,
    entries: [{ identifier: CATALOG_IDENTIFIER, type: SERVER_CARD_MEDIA_TYPE, data: serverCard(ctx) }],
  };
}
