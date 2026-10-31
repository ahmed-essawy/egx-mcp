# Quickstart: validate search and AI discoverability

Run from `D:/Work/EGX MCP` in PowerShell on this machine. Never deploy, never write to the live Worker, never submit to a registry or search engine without the owner's go-ahead.

## 1. Tests and typecheck (release gates SC-001, SC-003 partly, SC-004 to SC-008)

```powershell
npm run typecheck
npm test
npm run check:readme
```

Expected: typecheck PASS, `npm test` 0 failures (only failures beyond the recorded baseline count), `check:readme` PASS. The suites that carry the gates: `tests/unit/site-pages.test.ts`, `site-html.test.ts`, `site-content.test.ts`, `site-freshness.test.ts`, `site-drift.test.ts` (Node pool), `crawl.test.ts`, `discovery.test.ts`, `public-routes.test.ts`, `listing.test.ts`, `tests/integration/public-no-io.test.ts`, and after Phase 7 `site-arabic.test.ts`.

## 2. Local Worker

```powershell
npm run dev
```

Wrangler prints the local address (usually `http://localhost:8787`). Local only: `wrangler dev` without `--remote`. `PUBLIC_ORIGIN` from `wrangler.jsonc` points at the production address, so canonical URLs in local pages show `https://egx-mcp.essawy.workers.dev`; that is expected. To see local origins instead, start with `npx wrangler dev --var PUBLIC_ORIGIN:http://localhost:8787`.

## 3. curl checks (use `curl.exe`, not the PowerShell alias)

Set `$o = "http://localhost:8787"` first.

| Command | Expected |
|---|---|
| `curl.exe -s -o NUL -w "%{http_code}" "$o/"` | 200 |
| `curl.exe -sI "$o/tools"` | `cache-control: public, max-age=3600`, `etag`, `vary: Accept`, `link` to the Markdown twin; no `set-cookie`, no `x-robots-tag` |
| `curl.exe -s "$o/tools" \| Select-String -Pattern '<link rel="canonical"\|og:image\|application/ld\+json'` | the canonical link, the `og:image` tags and one JSON-LD block |
| `$etag = (curl.exe -sI "$o/faq" \| Select-String -Pattern '^etag: (.+)$').Matches.Groups[1].Value.Trim()` then `curl.exe -s -o NUL -w "%{http_code}" -H "If-None-Match: $etag" "$o/faq"` | 304 |
| `curl.exe -s -H "Accept: text/markdown" "$o/data"` | the Markdown twin, first line `# Data sources and limits` |
| `curl.exe -s "$o/connect/claude.md"` | Markdown ending with the `Canonical:` and `Last updated:` lines |
| `curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" "$o/Tools/"` | `301` to `.../tools` |
| `curl.exe -s -o NUL -w "%{http_code}" "$o/no-such-page"` | 404 |
| `curl.exe -sI "$o/no-such-page"` | `x-robots-tag: noindex, nofollow` and `cache-control: no-store` |
| `curl.exe -sI "$o/dashboard/login"` | the same redirect to Google as before |
| `curl.exe -s "$o/robots.txt"` | the format of contracts/text-files.md |
| `curl.exe -s "$o/sitemap.xml"` | every page once with its `lastmod` |
| `curl.exe -s "$o/llms.txt"` and `curl.exe -s "$o/llms-full.txt"` | the formats of contracts/text-files.md |
| `curl.exe -s "$o/.well-known/ai-catalog.json"` | the catalog with the server card inline |
| `curl.exe -sI "$o/mcp/server-card"` | 200, `application/mcp-server-card+json`, `access-control-allow-origin: *` |
| `curl.exe -s -o NUL -w "%{http_code}" -X POST "$o/mcp"` | 401, as before |
| `curl.exe -s "$o/c60c57998197b5e5b4a9fc2f935a3c44.txt"` | the key |
| `curl.exe -s -o "$env:TEMP\og.png" -w "%{http_code} %{size_download}" "$o/og-image.png"` | 200 and at most 61,440 bytes |
| `curl.exe -sI "$o/llms.txt"` | 200 headers (HEAD), no body |

## 4. Page weight (SC-006)

```powershell
foreach ($p in "/", "/tools", "/connect/claude", "/connect/chatgpt", "/connect/claude-code", "/connect/cursor", "/faq", "/data", "/privacy", "/terms") {
  $html = (curl.exe -s "$o$p" | Out-String).Length
  "$p $html"
}
curl.exe -s -o NUL -w "css %{size_download}\nlogo " "$o/styles.css"; curl.exe -s -o NUL -w "%{size_download}\n" "$o/logo-96.png"
```

Each page's HTML plus CSS plus logo must be under 102,400 bytes (the test asserts the same).

## 5. Lighthouse (SC-002)

Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`. With `npm run dev` running and `PUBLIC_ORIGIN` set to the local address (section 2):

```powershell
$out = "D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/lighthouse"
New-Item -ItemType Directory -Force $out | Out-Null
foreach ($p in "", "tools", "connect/claude", "connect/chatgpt", "connect/claude-code", "connect/cursor", "faq", "data", "privacy", "terms") {
  $name = if ($p -eq "") { "home" } else { $p -replace "/", "-" }
  npx --yes lighthouse@13 "http://localhost:8787/$p" --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate --only-categories=seo,accessibility,best-practices,performance --output=json --output-path="$out/$name.json" --chrome-flags="--headless=new" --quiet
}
Get-ChildItem $out -Filter *.json | ForEach-Object { $j = Get-Content $_.FullName -Raw | ConvertFrom-Json; "{0} seo={1} a11y={2} bp={3} perf={4}" -f $_.BaseName, $j.categories.seo.score, $j.categories.accessibility.score, $j.categories.'best-practices'.score, $j.categories.performance.score }
```

Expected: seo 1, accessibility, best-practices and performance 0.95 or more on every page. The output folder is inside `.git`, so it is never committed. Note: on `localhost` the "is crawlable" audit passes and the HTTPS audit is skipped; the deployed site check is QA-030.

## 6. Structured data (SC-003)

Offline syntax pass on saved pages:

```powershell
$sd = "D:/Work/EGX MCP/.git/pipeline/seo-ai-discoverability/sd"
New-Item -ItemType Directory -Force $sd | Out-Null
foreach ($p in "", "tools", "connect/claude", "faq", "data", "privacy") { $n = if ($p -eq "") { "home" } else { $p -replace "/", "-" }; curl.exe -s "http://localhost:8787/$p" -o "$sd/$n.html" }
Get-ChildItem $sd -Filter *.html | ForEach-Object { npx --yes structured-data-testing-tool@4.5.0 --file $_.FullName }
```

Expected: every JSON-LD block parsed, no errors (the tool's Google presets are dated 2020; failures that only concern retired rich results are not counted). After deploy (owner or QA, read only): paste each public URL into https://validator.schema.org (0 errors, 0 warnings) and https://search.google.com/test/rich-results (no error on Breadcrumb and Organization; FAQ, HowTo and Software app may show not eligible).

## 7. Render check (FR-S12)

Open each page at 375, 1024 and 1440 px wide in light and dark (Chrome DevTools device toolbar, or the `run` skill), plus `/ar` pages after Phase 7: no horizontal scroll, header and footer wrap cleanly, RTL tables right-aligned, focus outline visible on Tab.

## 8. IndexNow (owner, after a deploy that changed pages)

```powershell
$urls = ([xml](curl.exe -s https://egx-mcp.essawy.workers.dev/sitemap.xml)).urlset.url.loc
$body = @{ host = "egx-mcp.essawy.workers.dev"; key = "c60c57998197b5e5b4a9fc2f935a3c44"; keyLocation = "https://egx-mcp.essawy.workers.dev/c60c57998197b5e5b4a9fc2f935a3c44.txt"; urlList = $urls } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.indexnow.org/indexnow" -ContentType "application/json; charset=utf-8" -Body $body
```

Expected: HTTP 200 or 202. This is an outward-facing submission: owner only.

## 9. Registry manifest dry check (owner tooling, no publish)

```powershell
Get-Content docs/listing/server.json -Raw | ConvertFrom-Json | Select-Object name, title, version, description
```

Publishing (`mcp-publisher login github`, `mcp-publisher publish`) is an owner task (plan.md, Owner-only tasks).
