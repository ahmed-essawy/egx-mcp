# Contract: crawler, summary and plain-text formats

Examples use `{origin}` = `https://egx-mcp.essawy.workers.dev`. Every file ends with exactly one `\n`. Line endings are `\n`.

## `/robots.txt`

```
User-agent: *
Allow: /
Allow: /mcp/server-card
Disallow: /dashboard
Disallow: /authorize
Disallow: /callback/
Disallow: /token
Disallow: /register
Disallow: /mcp

User-agent: Googlebot
User-agent: Bingbot
... one line per entry of CRAWLERS, in the order of research.md R1 ...
User-agent: Amzn-User
Allow: /
Allow: /mcp/server-card
Disallow: /dashboard
Disallow: /authorize
Disallow: /callback/
Disallow: /token
Disallow: /register
Disallow: /mcp

Sitemap: {origin}/sitemap.xml
```

The rule lines come from one list (`ROBOTS_RULES`) written twice. Test checks: every `CRAWLERS` token appears once as `User-agent: <token>`; with a small RFC 9309 matcher in the test (longest match wins, `Allow` wins ties), every public page path, every Markdown twin, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/.well-known/ai-catalog.json` and `/mcp/server-card` is allowed and `/dashboard`, `/dashboard/login`, `/authorize`, `/callback/google`, `/token`, `/register` and `/mcp` are disallowed, for `*` and for every named token.

## `/sitemap.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>{origin}/</loc><lastmod>2026-11-02</lastmod><xhtml:link rel="alternate" hreflang="en" href="{origin}/"/><xhtml:link rel="alternate" hreflang="ar" href="{origin}/ar"/><xhtml:link rel="alternate" hreflang="x-default" href="{origin}/"/></url>
<url><loc>{origin}/tools</loc><lastmod>...</lastmod>...</url>
...
</urlset>
```

One `<url>` per `PAGES` entry in order, `loc` = `{origin}{path}`, `lastmod` = `updated`. `xhtml:link` lines only when `alternatesOf(page)` is not empty: one per alternate (`hreflang` = its `lang`, English first) plus `x-default` pointing at the English alternate. Values are XML escaped (`&`, `<`, `>`, `"`, `'`). Before the Arabic group no entry has `xhtml:link`.

## `/llms.txt`

```markdown
# EGX MCP

> EGX MCP is a free MCP server that lets AI assistants answer questions about Egyptian Exchange stocks, indices and funds with delayed data.

It is for investors, analysts and developers ... Server address: {origin}/mcp. Transport: Streamable HTTP. Sign-in: Google sign-in (OAuth) or an API key sent as `Authorization: Bearer <your key>`. Data is delayed (about 15 minutes during the session), unofficial and for information only. It is not investment advice, and EGX MCP is not affiliated with the Egyptian Exchange.

Last updated: {newest updated of all pages}

## Pages

- [EGX MCP: Egyptian Exchange data for AI assistants]({origin}/index.md): Free MCP server for Claude, ...
- [Tool catalog: the 30 EGX MCP tools and what they return]({origin}/tools.md): Every EGX MCP tool ...
- ... every English page of kind home, content, guide, faq in PAGES order ...

## Tools

- `search`: Find Egyptian stocks and mutual funds by ticker, ISIN, or Arabic or English name.
- ... every toolEntries() item, description = TOOL_DESCRIPTIONS ...

## Arabic

- [{Arabic title}]({origin}/ar.md): {Arabic description}
- ... (section present only once Arabic pages exist)

## Optional

- [Privacy policy: EGX MCP]({origin}/privacy.md): How EGX MCP handles ...
- [Terms of use: EGX MCP]({origin}/terms.md): The terms for using ...
- [Full content]({origin}/llms-full.txt): Every page, the tool list and the questions and answers in one file
- [MCP server card]({origin}/mcp/server-card): Machine-readable server address, transport and sign-in
- [AI catalog]({origin}/.well-known/ai-catalog.json): Discovery entry for the MCP server card
```

## `/llms-full.txt`

The `/llms.txt` header (H1, blockquote, paragraph, `Last updated`), a blank line, then for each page of kind home, content, guide or faq (English, then Arabic) in `PAGES` order:

```markdown
---

# {title}

Source: {origin}{path}
Last updated: {updated}

{page Markdown body}
```

Then:

```markdown
---

# Legal pages

- [Privacy policy: EGX MCP]({origin}/privacy): {description}
- [Terms of use: EGX MCP]({origin}/terms): {description}
```

## Markdown twin (`<path>.md`, `/index.md`)

```markdown
# {h1 text}

{lead paragraphs, blank line between}

## {section heading}

{blocks}

## Related pages

- [{title}]({origin}{path}): {description}

{notice}

Canonical: {origin}{path}
Last updated: {updated}
```

Block rendering: paragraph as text; list as `- item`; steps as `1. item` (numbered); table as a GitHub table with a `|---|` row; code as a fenced block with its language; links as `- [label]({origin}{href}): note`; tool as `### \`name\``, then description, `Ask: "example"`, `Returns: returns` on separate lines. FAQ pairs as `## question` then the answer. Legal twins: `# Privacy policy` or `# Terms of use`, `Last updated` line, each section as `## title` and its paragraphs converted by `legalParagraphToText` (links as `[text](href)`). The home twin's H1 is `EGX MCP` and its first section is "Connect your assistant" with the server URL and header in fenced `text` blocks. `{notice}` is `NOTICE` (English) or the Arabic notice; legal twins have no notice line. Arabic twins use the Arabic labels (`صفحات ذات صلة`, `آخر تحديث`) and the canonical line `Canonical: {origin}{path}` keeps the Latin word for parsers.
