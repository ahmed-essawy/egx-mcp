# Contract: public HTML page and structured data

## Document

```html
<!doctype html>
<html lang="{lang}" dir="{ltr|rtl}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{origin}{path}">
<link rel="alternate" hreflang="en" href="{origin}{english path}">     (only when alternatesOf(page) is not empty, one per alternate,
<link rel="alternate" hreflang="ar" href="{origin}{arabic path}">      English first, then x-default to the English page)
<link rel="alternate" hreflang="x-default" href="{origin}{english path}">
<link rel="alternate" type="text/markdown" href="{origin}{markdown path}">
<meta property="og:site_name" content="EGX MCP">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">                            (ar_EG on Arabic pages)
<meta property="og:locale:alternate" content="ar_EG">                  (only when an alternate exists; en_US on Arabic pages)
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{origin}{path}">
<meta property="og:image" content="{origin}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="{SITE.previewImageAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{origin}/og-image.png">
<meta name="twitter:image:alt" content="{SITE.previewImageAlt}">
{icon links, unchanged from spec 007}
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">{json-ld}</script>
</head>
<body>
<a class="skip-link" href="#main">{Skip to main content | Arabic skipLink}</a>
<header>{brand link to the home of the page language, affiliation in the page language}</header>
<main id="main">
<h1>{h1}</h1>                                 (home: the hero section holds the h1)
{lead paragraphs, sections, related section}
<p class="notice">{notice}</p>                 (kinds home, content, guide, faq; not legal)
<p class="updated">Last updated: <time datetime="{updated}">{updated}</time></p>
</main>
<footer><nav aria-label="Site">{FOOTER_LINKS[lang], then the language link when an alternate exists}</nav></footer>
</body>
</html>
```

Rules:
- `{h1}`: `tools` "Tool catalog", `connect-claude` "Connect EGX MCP to Claude", `connect-chatgpt` "Connect EGX MCP to ChatGPT", `connect-claude-code` "Connect EGX MCP to Claude Code", `connect-cursor` "Connect EGX MCP to Cursor", `faq` "Questions and answers", `data` "Data sources and limits", `privacy` "Privacy policy", `terms` "Terms of use" (legal h1 and body unchanged); Arabic: `ar-tools` "أدوات EGX MCP", `ar-faq` "أسئلة وأجوبة", `ar-data` "مصادر البيانات وحدودها", `ar-home` "EGX MCP". The h1 is stored on the page record as `heading` (add the field `heading: string` to `PublicPage`).
- Heading order: one `h1`; sections are `<section aria-labelledby="{id}"><h2 id="{id}">`; tool blocks use `h3` inside their group section; no level is skipped.
- Every value is escaped with `escapeHtml`; the JSON-LD text is `JSON.stringify(graph)` with `<` as `<`, `>` as `>` and `&` as `&`.
- The only `<script>` is the one `application/ld+json` block; no inline `style`, no `<style>`, no external URL in `src` or `href` except the GitHub links and the absolute `{origin}` URLs in head tags.
- Links: descriptive text (no "click here", no bare URL as link text except inside `<code>`).
- Legal pages: the `<main>` body is what `legal.ts` renders today (h1, last updated, sections); the generic `updated` paragraph is not added (the legal body already has its own "Last updated" line).
- Home: `<main>` is `heroSection()` and `connectSection(mcpUrl)` from `views.ts` (markup unchanged), then the `examples` and `learn-more` sections, then the notice paragraph (same markup as today's `noticeSection()`), then the updated line.
- CSS added to `STYLESHEET` (no new file): `[dir="rtl"] th, [dir="rtl"] td { text-align: right; }`, `pre { overflow-x: auto; padding: 0.75rem; border: 1px solid var(--border); background: var(--surface); }`, `.updated { color: var(--muted); font-size: 0.875rem; }`, and `h3 code { font-size: 1rem; }`. No other style change.

## JSON-LD graphs

`{site}` = `{origin}/#website`, `{org}` = `{origin}/#organization`, `{page}` = `{origin}{path}#webpage`.

Home (`kind: home`, English and Arabic):

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "{org}", "name": "EGX MCP", "url": "{origin}/", "logo": { "@type": "ImageObject", "url": "{origin}/icon-512.png", "width": 512, "height": 512 }, "sameAs": ["https://github.com/ahmed-essawy/egx-mcp"], "contactPoint": { "@type": "ContactPoint", "contactType": "customer support", "url": "https://github.com/ahmed-essawy/egx-mcp/issues" } },
    { "@type": "WebSite", "@id": "{site}", "name": "EGX MCP", "url": "{origin}/", "inLanguage": ["en", "ar"], "publisher": { "@id": "{org}" } },
    { "@type": "SoftwareApplication", "@id": "{origin}/#software", "name": "EGX MCP", "description": "{SITE.oneLine}", "url": "{origin}/", "image": "{origin}/og-image.png", "applicationCategory": "FinanceApplication", "operatingSystem": "Any", "isAccessibleForFree": true, "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }, "publisher": { "@id": "{org}" } },
    { "@type": "WebPage", "@id": "{page}", "url": "{origin}{path}", "name": "{title}", "description": "{description}", "inLanguage": "{lang}", "dateModified": "{updated}", "isPartOf": { "@id": "{site}" }, "about": { "@id": "{origin}/#software" } }
  ]
}
```

`WebSite.inLanguage` is `["en"]` until the Arabic group adds `"ar"` (it is derived from the languages present in `PAGES`). The Arabic home uses the Arabic `oneLine` for its WebPage `description` only; the Organization, WebSite and SoftwareApplication nodes are identical on both homes.

Every other page (legal pages included): the `WebPage` node above with `"breadcrumb": { "@id": "{origin}{path}#breadcrumb" }` and:

```json
{ "@type": "BreadcrumbList", "@id": "{origin}{path}#breadcrumb", "itemListElement": [
  { "@type": "ListItem", "position": 1, "name": "{home breadcrumb label}", "item": "{origin}{home path of the language}" },
  { "@type": "ListItem", "position": 2, "name": "{breadcrumb label}", "item": "{origin}{path}" }
] }
```

The visible page shows the same trail as `<nav aria-label="Breadcrumb"><ol class="breadcrumb">` with the home link and the current label as `aria-current="page"`, placed at the top of `<main>` before the h1, so the structured data restates visible content. CSS: `.breadcrumb { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; padding: 0; margin: 0 0 1rem; font-size: 0.875rem; }`.

FAQ pages add:

```json
{ "@type": "FAQPage", "@id": "{origin}{path}#faq", "mainEntity": [
  { "@type": "Question", "name": "{question}", "acceptedAnswer": { "@type": "Answer", "text": "{answer}" } }
] }
```

and the `WebPage` node gets `"mainEntity": { "@id": "{origin}{path}#faq" }`. `name` and `text` are the rendered plain strings (placeholders filled, backticks removed) and equal the visible `<h2>` and `<p>` text after HTML tags are stripped and entities decoded.

Guides add:

```json
{ "@type": "HowTo", "@id": "{origin}{path}#howto", "name": "{steps block name}", "step": [
  { "@type": "HowToStep", "position": 1, "name": "Step 1", "text": "{step text}" }
] }
```

`text` equals the visible `<li>` text after stripping tags (backticks removed). `name` of each step is `Step {n}`.

## Tests on this contract

`tests/unit/site-html.test.ts` (Workers pool) for every page in `PAGES`: one `<h1>`; title, description, canonical, `og:*` and `twitter:*` present with the values above; unique titles and descriptions; `lang` and `dir`; exactly one `<script` and it is `type="application/ld+json"`; the JSON parses; FAQ and HowTo texts equal visible text; breadcrumb names equal the visible trail; every internal `href` resolves to a route that answers 200; every page reachable from its home within two clicks; html plus `/styles.css` plus the header logo bytes under 100 KB (`TextEncoder` length).
