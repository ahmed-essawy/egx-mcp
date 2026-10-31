# Registry and directory checklist

Every row stays `not submitted` until the owner submits it and records the date. Nothing here is submitted by the build or by the pipeline.

| Listing | URL | Method | Text to use | Status | Date | Notes |
|---|---|---|---|---|---|---|
| Official MCP Registry | https://registry.modelcontextprotocol.io/ | `mcp-publisher login github`, then `mcp-publisher publish docs/listing/server.json` | docs/listing/server.json (registry description) | not submitted | - | Submit first: PulseMCP, Glama and the GitHub MCP registry sync from it. The registry is marked preview. |
| Smithery | https://smithery.ai/new | Submit the server URL https://egx-mcp.essawy.workers.dev/mcp on the new server form | Short description | not submitted | - | Free listing by URL. |
| PulseMCP | https://www.pulsemcp.com/submit | Submit form (skip if the official registry sync already lists it) | Short description | not submitted | - | Syncs from the official registry. |
| mcp.so | https://mcp.so/submit | Submit form, free reviewed entry only | Short description | not submitted | - | Never choose the paid option. |
| Glama | https://glama.ai/mcp/servers | Crawls GitHub; claim the listing once it appears | Short description | not submitted | - | Claim to edit the text. |
| awesome-remote-mcp-servers | https://github.com/jaw9c/awesome-remote-mcp-servers | Pull request adding one entry | Short description | not submitted | - | Follow the list's contribution rules. |
| GitHub repository description and topics | https://github.com/ahmed-essawy/egx-mcp | Repository settings: description, website and topics | Short description; keywords as topics | not submitted | - | Set the website to https://egx-mcp.essawy.workers.dev/. |
| Google Search Console | https://search.google.com/search-console | Add a URL-prefix property for https://egx-mcp.essawy.workers.dev/, verify, submit https://egx-mcp.essawy.workers.dev/sitemap.xml, request indexing of the home page | - | not submitted | - | A domain property is impossible on workers.dev. |
| Bing Webmaster Tools | https://www.bing.com/webmasters | Import from Search Console or verify, then submit the sitemap | - | not submitted | - | Also feeds Copilot and DuckDuckGo. |
| IndexNow | https://www.indexnow.org/ | After each deploy that changes pages, run the command in specs/006-seo-ai-discoverability/quickstart.md section 8 | - | not submitted | - | Key file served at https://egx-mcp.essawy.workers.dev/c60c57998197b5e5b4a9fc2f935a3c44.txt. |

The texts are in [descriptions.md](descriptions.md). The manifest is [server.json](server.json).

## Owner steps

1. Google Search Console: add the property for https://egx-mcp.essawy.workers.dev/ (a URL-prefix property, because a domain property is impossible on workers.dev), verify it with the HTML tag or file method, submit https://egx-mcp.essawy.workers.dev/sitemap.xml and request indexing of the home page.
2. Bing Webmaster Tools: import the site from Search Console or verify it, then submit the sitemap. This also feeds Copilot and DuckDuckGo.
3. IndexNow: after each deploy that changes pages, run the command in specs/006-seo-ai-discoverability/quickstart.md section 8 (Bing, Yandex, Seznam, Naver, Yep).
4. Custom domain: the largest remaining ranking and trust factor. Buying one is the owner's decision. When one is added, set `PUBLIC_ORIGIN`, update `docs/listing/server.json`, add the new Search Console property and keep the workers.dev address redirecting or declaring the canonical.
5. Registry and directory submissions, one at a time and after the owner's go-ahead: the official MCP Registry first (`mcp-publisher login github`, then `mcp-publisher publish docs/listing/server.json`), then Smithery, PulseMCP, mcp.so (free option only), the Glama claim and the awesome-remote-mcp-servers pull request. Update the Status and Date columns each time.
6. GitHub repository: set the description to the short description, set the website to https://egx-mcp.essawy.workers.dev/ and add topics from the keyword set.
