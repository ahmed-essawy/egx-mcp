import { describe, expect, it } from "vitest";
import { mcpIcons } from "../../src/http/icons";
import { SERVER_VERSION } from "../../src/mcp/server";
import { aiCatalog, serverCard } from "../../src/site/discovery";
import { SITE } from "../../src/site/identity";
import { newestUpdated } from "../../src/site/pages";
import { toolEntries } from "../../src/site/tool-catalog";
import { TEST_CONTEXT } from "../helpers/site";

const ORIGIN = TEST_CONTEXT.origin;
const MAX_DESCRIPTION_LENGTH = 100;
const PREFIX = SITE.registryName.split("/")[0];

describe("server card", () => {
  const card = serverCard(TEST_CONTEXT);

  it("equals the contract field by field", () => {
    expect(Object.keys(card)).toEqual([
      "$schema",
      "name",
      "version",
      "title",
      "description",
      "websiteUrl",
      "repository",
      "icons",
      "remotes",
      "_meta",
    ]);
    expect(card.$schema).toBe("https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json");
    expect(card.name).toBe(SITE.registryName);
    expect(card.version).toBe(SERVER_VERSION);
    expect(card.title).toBe(SITE.name);
    expect(card.description).toBe(SITE.registryDescription);
    expect(card.websiteUrl).toBe(`${ORIGIN}/`);
    expect(card.repository).toEqual({ url: SITE.repositoryUrl, source: "github" });
    expect(card.icons).toEqual(mcpIcons(ORIGIN));
    expect(card.remotes).toEqual([
      {
        type: "streamable-http",
        url: `${ORIGIN}/mcp`,
        headers: [
          {
            name: "Authorization",
            description: `Optional. Bearer API key from ${ORIGIN}/dashboard, sent as Bearer <your key>. Leave it out to sign in with Google through OAuth.`,
            isRequired: false,
            isSecret: true,
          },
        ],
      },
    ]);
  });

  it("describes the auth, tools, notice and update date in _meta", () => {
    expect(card._meta).toEqual({
      [`${PREFIX}/auth`]: {
        oauth: {
          protectedResourceMetadata: `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
          authorizationServerMetadata: `${ORIGIN}/.well-known/oauth-authorization-server`,
          identityProvider: "Google",
        },
        apiKey: { header: "Authorization", format: "Bearer <your key>", createAt: `${ORIGIN}/dashboard` },
      },
      [`${PREFIX}/tools`]: toolEntries().map(({ name, description }) => ({ name, description })),
      [`${PREFIX}/data-notice`]: SITE.dataLimits,
      [`${PREFIX}/updated`]: newestUpdated(),
    });
  });

  it("keeps the registry name shape and description limit", () => {
    expect(card.name.split("/")).toHaveLength(2);
    expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });
});

describe("ai catalog", () => {
  it("holds exactly the server card", () => {
    const catalog = aiCatalog(TEST_CONTEXT);

    expect(catalog.specVersion).toBe("1.0");
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toEqual({
      identifier: "urn:air:egx-mcp:mcp:egx-mcp",
      type: "application/mcp-server-card+json",
      data: serverCard(TEST_CONTEXT),
    });
  });
});
