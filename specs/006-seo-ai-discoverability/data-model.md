# Data model: Search and AI discoverability

No database table, KV key, binding or migration is added. Every entity below is a TypeScript constant or a pure function in `src/site/` (plus one constant in `src/mcp/`), built from source and the parsed `env` vars only.

## Module map

| Module | Holds | Imports (only) |
|---|---|---|
| `src/site/identity.ts` | `SITE` (site identity), `RATE_LIMIT_PER_MINUTE`, `INDEXNOW_KEY_PATH` | nothing |
| `src/site/paths.ts` | every public path constant, `markdownPath(path)`, `FOOTER_LINKS` | `./identity` |
| `src/mcp/tool-descriptions.ts` | `TOOL_DESCRIPTIONS` | `./tool-names`, `../store/d1/personal` (`MAX_ITEMS_PER_USER`), `../store/d1/events` (`MAX_SINCE_AGE_DAYS`) |
| `src/site/content-model.ts` | `Inline`, `Block`, `Section`, `PageContent`, `SiteContext` types | `./paths` (type of path) |
| `src/site/tool-catalog.ts` | `TOOL_GROUPS`, `TOOL_GUIDE`, `toolEntries()` | `../mcp/tool-names`, `../mcp/tool-descriptions` |
| `src/site/content/en.ts` | English content builders | `../content-model`, `../tool-catalog`, `../identity` (`SITE`, `LOCALIZED`, `RATE_LIMIT_PER_MINUTE`), `../paths`, `../../http/views` (`VALUE_LINE`, `CONNECT_NOTE`, `BEARER_HEADER`, exported by T012, for the home twin's connect section), `../../store/d1/personal` (`MAX_ITEMS_PER_USER`), `../../store/d1/users` (`MAX_ACTIVE_KEYS`) |
| `src/site/content/ar.ts` | Arabic content builders (Arabic group) | same as `en.ts` |
| `src/site/pages.ts` | `PAGES`, `pageByPath`, `alternatesOf`, `contentPages` | `./content/en`, `./content/ar`, `../http/legal` (legal sections) |
| `src/site/render-html.ts` | `renderPageHtml(page, ctx)` | `./pages`, `./structured-data`, `../http/views` |
| `src/site/render-markdown.ts` | `renderPageMarkdown`, `llmsTxt`, `llmsFullTxt` | `./pages`, `./identity`, `./tool-catalog` |
| `src/site/structured-data.ts` | `structuredData(page, ctx)`, `jsonLdScript(graph)` | `./pages`, `./identity`, `../http/icons` |
| `src/site/crawl.ts` | `CRAWLERS`, `PRIVATE_PREFIXES`, `robotsTxt`, `sitemapXml` | `./pages`, `./paths` |
| `src/site/discovery.ts` | `serverCard(ctx)`, `aiCatalog(ctx)` | `./identity`, `./tool-catalog`, `../http/icons`, `../mcp/server` (`SERVER_VERSION`) |
| `src/http/public.ts` | `PUBLIC_ROUTES`, `canonicalRedirect`, `serverCardResponse`, response helpers | `./status`, `./views`, `../config`, `../site/*` |

No module in `src/site/` imports `src/store/kv.ts`, any `src/store/d1/*` function, `src/limits/*` or `src/providers/*`; only exported number constants from `src/store/d1/personal.ts`, `src/store/d1/users.ts` and `src/store/d1/events.ts` are imported. A test (`tests/unit/site-isolation.test.ts`) reads the source of every `src/site/*.ts` file with `?raw` and fails on an import of `store/kv`, `limits/`, `providers/` or a named import from `store/d1/` other than `MAX_ITEMS_PER_USER`, `MAX_ACTIVE_KEYS` and `MAX_SINCE_AGE_DAYS`.

## SiteIdentity (`SITE`)

```ts
type SiteIdentity = {
  readonly name: string;
  readonly oneLine: string;
  readonly registryDescription: string;
  readonly shortDescription: string;
  readonly audience: string;
  readonly longDescription: string;
  readonly keywords: readonly string[];
  readonly publisherName: string;
  readonly repositoryUrl: string;
  readonly issuesUrl: string;
  readonly registryName: string;
  readonly previewImageAlt: string;
  readonly previewImageWidth: number;
  readonly previewImageHeight: number;
  readonly indexNowKey: string;
  readonly transportLabel: string;
  readonly signInMethods: string;
  readonly dataLimits: string;
};
```

Values: content-en.md section 1. The preview image path is `PREVIEW_IMAGE_PATH` (`/og-image.png`) in `paths.ts`, not a `SITE` field; width 1200, height 630.

Validation (test guarded): `registryDescription.length <= 100`; `shortDescription.length <= 160`; `oneLine.length <= 160`; no `@` character and no personal name in any field (test asserts the strings `Essawy`, `gmail` and `@` are absent from every field except `repositoryUrl`, `issuesUrl` and `registryName`, which hold the GitHub handle by owner decision); `registryName` matches `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`; `indexNowKey` matches `^[a-f0-9]{32}$`.

`SITE.name` replaces `PRODUCT_NAME` and `SITE.repositoryUrl` replaces `GITHUB_URL` in `src/http/views.ts` (same values).

## Paths (`src/site/paths.ts`)

```ts
export const HOME_PATH = "/";
export const TOOLS_PATH = "/tools";
export const CONNECT_CLAUDE_PATH = "/connect/claude";
export const CONNECT_CHATGPT_PATH = "/connect/chatgpt";
export const CONNECT_CLAUDE_CODE_PATH = "/connect/claude-code";
export const CONNECT_CURSOR_PATH = "/connect/cursor";
export const FAQ_PATH = "/faq";
export const DATA_PATH = "/data";
export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";
export const AR_HOME_PATH = "/ar";
export const AR_TOOLS_PATH = "/ar/tools";
export const AR_FAQ_PATH = "/ar/faq";
export const AR_DATA_PATH = "/ar/data";
export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";
export const LLMS_PATH = "/llms.txt";
export const LLMS_FULL_PATH = "/llms-full.txt";
export const AI_CATALOG_PATH = "/.well-known/ai-catalog.json";
export const SERVER_CARD_PATH = "/mcp/server-card";
export const PREVIEW_IMAGE_PATH = "/og-image.png";
export const MARKDOWN_SUFFIX = ".md";
export const HOME_MARKDOWN_PATH = "/index.md";
export function markdownPath(path: string): string;
export type FooterLink = { label: string; href: string };
export function absoluteHref(origin: string, href: string): string;
export const FOOTER_LINKS: Readonly<Record<"en" | "ar", readonly FooterLink[]>>;
```

`markdownPath("/")` is `/index.md`; any other path `p` gives `p + ".md"`. `HOME_PATH`, `PRIVACY_PATH` and `TERMS_PATH` move here from `src/http/views.ts`; `views.ts` imports them. English `FOOTER_LINKS.en` holds the 10 site links of content-en.md section 1 plus GitHub (`SITE.repositoryUrl`); the Arabic group adds `FOOTER_LINKS.ar`. The "العربية" or "English" language link is not in `FOOTER_LINKS`; `render-html.ts` appends it from `alternatesOf(page)`.

## Content model (`src/site/content-model.ts`)

```ts
import type { Lang } from "./identity";
export type SiteContext = {
  origin: string;
  mcpUrl: string;
  dashboardUrl: string;
  limits: { userDailyCalls: number; globalDailyCalls: number };
};
export type LinkItem = { href: string; label: string; note?: string };
export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "steps"; name: string; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "links"; items: readonly LinkItem[] }
  | { kind: "tool"; name: string; description: string; askLabel: string; example: string; returnsLabel: string; returns: string };
export type Section = { id: string; heading: string; blocks: readonly Block[]; level?: 2 | 3 };
export type QuestionAnswer = { question: string; answer: string };
export type PageContent = {
  lead: readonly string[];
  sections: readonly Section[];
  faq?: readonly QuestionAnswer[];
};
```

Rules:
- Text strings are plain text; a backtick span is inline code. The HTML renderer escapes with `escapeHtml` then turns each backtick pair into `<code>...</code>`; the Markdown renderer leaves text as is.
- `steps` renders as `<ol>` in HTML and a numbered list in Markdown, and is the only source of HowTo steps.
- `faq` pairs render as one `<section>` per pair with `<h2>` question and `<p>` answer, and are the only source of FAQPage entries.
- `tool` renders as `<h3><code>name</code></h3>` then `<p>description</p>`, `<p>askLabel "example"</p>`, `<p>returnsLabel returns</p>` (quotes are the ASCII `"` in both renderers).
- `level` 3 is used only for tool blocks inside a group section (the group is level 2).
- Placeholders of content-en.md are substituted inside the content builders (template literals from `ctx`), never in the renderers.

## Tool entry (`src/site/tool-catalog.ts`)

```ts
export type ToolGroupId = "find" | "market" | "history" | "funds" | "company" | "metals" | "personal" | "owner";
export type ToolGuide = { group: ToolGroupId; example: string; returns: string };
export const TOOL_GUIDE: Readonly<Record<ToolName, ToolGuide>>;
export const TOOL_GROUPS: readonly { id: ToolGroupId; label: string; intro: string }[];
export type ToolEntry = { name: ToolName; description: string; group: ToolGroupId; example: string; returns: string };
export function toolEntries(): readonly ToolEntry[];
```

`toolEntries()` returns one entry per name in `TOOL_GROUPS` order, then content-en.md table order inside each group, with `description` = `TOOL_DESCRIPTIONS[name]`. Validation (tests): the entry names equal `TOOL_NAMES` as a set and have no duplicates; every registered tool description from `listNodeTools` equals `` `${TOOL_DESCRIPTIONS[name]} ${NOTICE}` `` (MCP `NOTICE` from `src/mcp/envelope.ts`, as `defineTool` builds it today). `{maxItems}` intro text in the personal group uses `MAX_ITEMS_PER_USER`.

Arabic (Arabic group): `TOOL_GUIDE_AR: Readonly<Record<ToolName, { description: string; example: string; returns: string }>>` and `TOOL_GROUPS_AR` with the same ids, in `src/site/content/ar.ts`.

`TOOL_DESCRIPTIONS` (`src/mcp/tool-descriptions.ts`):

```ts
export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>>;
```

Each value is the exact string the tool file passes today (template literals keep their constants). `MAX_SINCE_AGE_DAYS = 30` moves from `src/mcp/tools/personal.ts` to `src/store/d1/events.ts` (exported) and `personal.ts` imports it.

## Public page (`src/site/pages.ts`)

```ts
export type PageKind = "home" | "content" | "guide" | "faq" | "legal";
export type PublicPage = {
  id: string;
  topic: string;
  lang: Lang;
  path: string;
  title: (ctx: SiteContext) => string;
  heading: string;
  description: string;
  breadcrumb: string;
  updated: string;
  kind: PageKind;
  related: readonly string[];
  content: (ctx: SiteContext) => PageContent;
};
export const PAGES: readonly PublicPage[];
export function pageByPath(path: string): PublicPage | undefined;
export function alternatesOf(page: PublicPage): readonly PublicPage[];
export function homeOf(lang: Lang): PublicPage;
```

- `PAGES` order (English group): `home`, `tools`, `connect-claude`, `connect-chatgpt`, `connect-claude-code`, `connect-cursor`, `faq`, `data`, `privacy`, `terms`; the Arabic group appends `ar-home`, `ar-tools`, `ar-faq`, `ar-data`.
- `topic` links translations: `home`, `tools`, `faq`, `data` are shared by the English and Arabic records; `alternatesOf(page)` returns every page with the same `topic` (itself included) when there are at least two, else an empty list.
- `kind` decides layout and structured data: `home` (hero layout, home graph), `content` (`tools`, `data`), `guide` (HowTo from the first `steps` block), `faq` (FAQPage from `faq`), `legal` (privacy and terms: body from `src/http/legal.ts`, no notice, no related section).
- `title` is a function only because the tools title holds `{toolCount}`; every other record returns a constant.
- `updated` is an ISO date. Initial values: every new page `2026-11-02` placeholder replaced by the implementer with the delivery date; `privacy` and `terms` use `LEGAL_LAST_UPDATED`.
- Legal records: `content` returns an empty `PageContent`. The renderers and the freshness pin read the exported `PRIVACY_SECTIONS` and `TERMS_SECTIONS` of `legal.ts` through `LEGAL_SECTIONS` and `legalSectionsOf(page)`. The Markdown twin converts paragraph HTML with `legalParagraphToMarkdown(html, origin)`: `<a href="x">y</a>` becomes the Markdown link `[y](x)`, and an `x` starting with `/` becomes absolute with the origin. The HTML body stays the one `legal.ts` renders today.

Validation (tests, SC-001, SC-004): ids, paths, titles and descriptions unique; `title(ctx).length <= 60`; `70 <= description.length <= 160`; every path matches `^/[a-z0-9/-]*$` and has no trailing slash except `/`; every `related` id exists; every page except home has a breadcrumb parent (its language's home); every page is linked from its language's home within two clicks (home `learn-more` links, footer or related sections).

## Freshness pin

```ts
type ContentPin = readonly [path: string, updated: string, sha256: string];
```

Lives in `tests/unit/site-freshness.test.ts` as `CONTENT_PINS`. The hash is SHA-256 (lower-case hex) of `JSON.stringify({ title, description, content })` for the page rendered with `TEST_CONTEXT` (origin `https://egx.example.com`, limits from `wrangler.jsonc` vars). A pin mismatch fails with a message naming the path, the new hash and "bump updated in src/site/pages.ts and this pin together".

## Response representations

| Representation | Built by | Content type |
|---|---|---|
| HTML page | `renderPageHtml(page, ctx)` | `text/html; charset=utf-8` |
| Markdown twin | `renderPageMarkdown(page, ctx)` | `text/markdown; charset=utf-8` |
| Site summary | `llmsTxt(ctx)` | `text/plain; charset=utf-8` |
| Full content | `llmsFullTxt(ctx)` | `text/plain; charset=utf-8` |
| Crawler rules | `robotsTxt(ctx)` | `text/plain; charset=utf-8` |
| Sitemap | `sitemapXml(ctx)` | `application/xml; charset=utf-8` |
| Server card | `serverCard(ctx)` | `application/mcp-server-card+json` |
| AI catalog | `aiCatalog(ctx)` | `application/ai-catalog+json` |
| IndexNow key | `SITE.indexNowKey` | `text/plain; charset=utf-8` |
| Preview image | `ICONS.get(PREVIEW_IMAGE_PATH)` | `image/png` |

Exact formats: contracts/.

## Listing (`docs/listing/`)

Not code. `docs/listing/registries.md` holds one row per listing: name, URL, submission method, text to use (pointer to `descriptions.md`), status (`not submitted`, `submitted YYYY-MM-DD`, `live YYYY-MM-DD`, `rejected`), notes. State transitions: `not submitted` to `submitted` only after the owner's go-ahead; `submitted` to `live` or `rejected` when observed. The planner and implementers never change a status away from `not submitted`.
