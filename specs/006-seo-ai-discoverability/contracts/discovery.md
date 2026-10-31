# Contract: MCP discovery files and registry manifest

`{origin}` as in routes.md. `{version}` is `SERVER_VERSION` exported from `src/mcp/server.ts` (`1.0.0` today). `{icons}` is `mcpIcons(origin)` from `src/http/icons.ts` (32, 192 and 512 px PNGs). Key order in the JSON is the order shown; output is `JSON.stringify(value, null, 2)` plus `\n`.

## `GET /mcp/server-card` (SEP-2127 Server Card)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  "name": "io.github.ahmed-essawy/egx-mcp",
  "version": "{version}",
  "title": "EGX MCP",
  "description": "Delayed Egyptian Exchange (EGX) stocks, indices, funds, gold and USD/EGP data for AI assistants.",
  "websiteUrl": "{origin}/",
  "repository": { "url": "https://github.com/ahmed-essawy/egx-mcp", "source": "github" },
  "icons": [{ "src": "{origin}/favicon-32.png", "mimeType": "image/png", "sizes": ["32x32"] }, "... {icons}"],
  "remotes": [
    {
      "type": "streamable-http",
      "url": "{origin}/mcp",
      "headers": [
        {
          "name": "Authorization",
          "description": "Optional. Bearer API key from {origin}/dashboard, sent as Bearer <your key>. Leave it out to sign in with Google through OAuth.",
          "isRequired": false,
          "isSecret": true
        }
      ]
    }
  ],
  "_meta": {
    "io.github.ahmed-essawy/auth": {
      "oauth": { "protectedResourceMetadata": "{origin}/.well-known/oauth-protected-resource/mcp", "authorizationServerMetadata": "{origin}/.well-known/oauth-authorization-server", "identityProvider": "Google" },
      "apiKey": { "header": "Authorization", "format": "Bearer <your key>", "createAt": "{origin}/dashboard" }
    },
    "io.github.ahmed-essawy/tools": [{ "name": "search", "description": "Find Egyptian stocks and mutual funds by ticker, ISIN, or Arabic or English name." }, "... one per toolEntries() item"],
    "io.github.ahmed-essawy/data-notice": "Data is delayed (about 15 minutes during the session), unofficial and for information only. It is not investment advice, and EGX MCP is not affiliated with the Egyptian Exchange.",
    "io.github.ahmed-essawy/updated": "{newest updated of all pages}"
  }
}
```

The `protectedResourceMetadata` path is the RFC 9728 URL the provider builds for the resource `{origin}/mcp` (`getConfiguredResourceMetadataUrl` in `@cloudflare/workers-oauth-provider` 1.2.4 appends the resource path to `/.well-known/oauth-protected-resource`, checked by the planner). A test fetches both `_meta` OAuth URLs through `src/index.ts` and asserts `200`, so a library change that moves them fails the build.

## `GET /.well-known/ai-catalog.json` (AI Catalog)

```json
{
  "specVersion": "1.0",
  "entries": [
    {
      "identifier": "urn:air:egx-mcp:mcp:egx-mcp",
      "type": "application/mcp-server-card+json",
      "data": { "... exactly the server card object above ..." }
    }
  ]
}
```

## `docs/listing/server.json` (official MCP Registry manifest, committed file)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.ahmed-essawy/egx-mcp",
  "title": "EGX MCP",
  "description": "Delayed Egyptian Exchange (EGX) stocks, indices, funds, gold and USD/EGP data for AI assistants.",
  "version": "1.0.0",
  "websiteUrl": "https://egx-mcp.essawy.workers.dev/",
  "repository": { "url": "https://github.com/ahmed-essawy/egx-mcp", "source": "github" },
  "icons": [
    { "src": "https://egx-mcp.essawy.workers.dev/icon-512.png", "mimeType": "image/png", "sizes": ["512x512"] }
  ],
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://egx-mcp.essawy.workers.dev/mcp",
      "headers": [
        {
          "name": "Authorization",
          "description": "Optional. Bearer API key from https://egx-mcp.essawy.workers.dev/dashboard. Leave it out to sign in with Google through OAuth.",
          "isRequired": false,
          "isSecret": true
        }
      ]
    }
  ]
}
```

Test (`tests/unit/listing.test.ts`, reads the file with `?raw`): `name`, `title`, `description`, `version` and `repository.url` equal the server card for origin `https://egx-mcp.essawy.workers.dev` (the `wrangler.jsonc` `PUBLIC_ORIGIN`); `remotes[0].url` equals that card's remote URL; `description.length <= 100`; `name` matches the registry pattern. The file is static because the registry needs the production address; a custom domain later means editing it and the test follows `wrangler.jsonc`.
