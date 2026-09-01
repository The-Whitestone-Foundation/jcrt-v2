# Build and deploy performance

Last verified: 2026-08-29 (against a real Netlify production deploy log)

## 2026-09-01 pass

`build:netlify` is now `node scripts/build.mjs` — one orchestrator instead of a serial `&&`
chain of eight `npm run` spawns. Independent post-Eleventy steps overlap:

```
Phase A  nanoids:check ∥ standard:check  →  sitemaps:generate
Phase B  eleventy
Phase C  { css:purge → css:optimize } ∥ pagefind ∥ { sitemaps:check → oai:validate:quick }
```

Measured back-to-back on one workstation: **50.4s serial → 24.6s orchestrated**. The old
chain is kept as `npm run build:serial` for comparison and fallback. Every step is still
its own `npm run <name>`. Ordering constraints preserved: `sitemaps:generate` before
Eleventy, `css:purge` before `css:optimize`, and `oai:validate:quick` alone in its group
because `scripts/validate-oai-pmh.mjs` writes to the XML it validates.

Two O(n·m) template scans removed, both now served by one `archiveArticlesByIssue`
collection (`eleventy.config.js`, beside `archivesToc`):

- `content/archives/index.njk` sorted all ~2,000 `collections.all` entries per issue per
  page — 70 full sorts, ~1.8M operations — then filtered to ~12. The 14 listing pages
  roughly halved (e.g. `/archives/7/` 191 KB → 98 KB).
- `_includes/partials/archive_issue_toc.njk` scanned all 831 archive items on each of 68
  issue pages (56,508 iterations for ~830 rows), rebuilding a twelve-statement sort key for
  the ~820 it discarded. That key now lives in `archiveTocSortKey()` and runs once per
  article. The 68 issue pages shed 421 KB.

**This also fixed a real ordering bug.** `sort(…, 'data.articleNumber')` over
`collections.all` compared ~1,967 entries that have no such property; `undefined` compares
equal to every number, so the comparator was incoherent and V8 returned arbitrary order.
Issue 25.2 listed article 05 first. All 67 issue blocks now sort correctly by
`article_number`.

`/archives/keywords/` split into A–Z letter pages (720 KB → 43 KB entry point) using
`tagIndex.archiveKeywords.byLetter`, which already existed unused. `/authors/` was left as
one page deliberately — it is a flat loop with no nested scan, and `collections.authors`
carries `affiliation`/`organization` that `tagIndex.authors` does not.

### Sitemap defects fixed in the same pass

- `/sitemaps/sitemaps.xml` was a **completely empty sitemap index** that `robots.txt`
  advertised to crawlers. `content/sitemaps/sitemaps.xml.njk:9` passed a *string* where a
  regex literal belongs — `RegExp` built from `'/\/sitemaps\/…$/'` puts a literal `/` after
  the `$` anchor and can never match — and its `<loc>` values were relative paths anyway.
  Template and robots.txt line both removed; the working `/sitemap.xml` index remains.
- **570 global tag pages appeared in no sitemap at all.** `content/tag-pages.njk` sets
  `eleventyExcludeFromCollections`, so every `collections.all` sweep missed them. New
  `content/sitemaps/tags-sitemap.xml.njk` builds from `tagIndex.globalTags.list`.
- **151 of 152 religioustheory author pages were missing, and one arbitrary page leaked in.**
  Eleventy adds only the *first* page of a paginated template to `collections.all`. New
  `content/sitemaps/religioustheory/authors-sitemap.xml.njk`, and `sitemapIgnore: true` on
  `authors.njk`, `category-pages.njk` and `tag-pages.njk` to stop the partial leak.
- The root `<sitemapindex>` listed two RSS feeds and `/feed/twtxt.txt` as child sitemaps.
  An index entry must resolve to a `<urlset>`; `ALWAYS_INCLUDE_FEEDS` and the hardcoded
  philpapers entry are gone from `_data/sitemapIndex.js`.
- `/folder-sitemap.xml` served **raw Nunjucks source** — front matter and `{% %}` tags as
  XML. The source lacked a `.njk` extension so it was passthrough-copied verbatim, from two
  places (`content/sitemaps/` and `public/`). Both deleted; nothing referenced it.
- 22 duplicate `<loc>` values (12 in `/sitemaps/sitemap.xml`, 10 in
  `/religioustheory/sitemap.xml`) — a `collections.all` sweep plus an unconditional
  hardcoded canonical list. Both now carry a `seen` guard.
- `/religioustheory/taxonomy/` renders `noindex` but was still listed. Removed.

Verified after: **0 duplicate `<loc>` in any sitemap, 0 dead links across 7,757
jcrt.org-hosted entries, 0 noindex pages advertised** (28 noindex pages exist; none is in a
sitemap). Tag coverage 570/570, author coverage 152/152.

One audit finding was **not** acted on. The `seen`-array dedup in
`categories-tags-sitemap.xml.njk` was reported as provably dead because `tagIndex.*.list`
is unique. It dedups on *slugified* URLs, though, and two distinct terms can slugify
identically. No collisions exist today (checked all four domains), but it is a correctness
guard costing ~193K trivial comparisons once per build. Kept.

`scripts/check-sitemaps.mjs` still only validates the root index — 21 entries against
~11,800 real `<loc>` values. It structurally could not have caught any defect above. Worth
widening; not done here.

### Forms detection: disabled 2026-09-01

The 4m 08s Forms figure below was re-verified on 2026-09-01: **7,007 of 7,009** built pages
contain a `<form>` (the `<noscript>` search form in `_includes/partials/sidebar.njk`), and
**zero** carry `data-netlify`/`netlify-honeypot`.

Form detection was switched off in the Netlify UI on 2026-09-01. The next production
deploy log should show post-processing drop from ~4m 08s to near zero, taking total deploy
time from ~5m 28s to roughly **1m 20s**. Confirm this on the next deploy — if the
post-processing line is still minutes long, the setting did not take.

Do not re-enable it. Nothing on this site is a Netlify form; the real forms post to
Formspree.

## Read this first: the build was never the bottleneck

Earlier revisions of this document optimized the Eleventy render. Measured against an actual
Netlify deploy, the Eleventy render is about 9% of wall-clock time. Do not tune it without
evidence from a deploy log.

Baseline production deploy, total **5m 27.9s**:

| Stage | Time | Share |
| --- | ---: | ---: |
| Init + `npm install` (cached, 887 ms) | 12s | 4% |
| `build.command` total | **30.7s** | **9%** |
| — Eleventy render (7,822 files) | 17.2s | |
| — `css:purge` | 6s | |
| — `run-pagefind.js` | 5s | |
| — nanoids / sitemaps / standard / oai validation, combined | ~2s | |
| Edge Functions bundling + secrets scan | 2s | 1% |
| Deploy site | **4m 29s** | **82%** |
| — calculate + upload 7,162 files | 17s | |
| — **post-processing ("Forms")** | **4m 08s** | **76%** |
| Lighthouse plugin | 10s | 3% |

### The 4m 08s

Netlify's Forms detection parses every uploaded HTML file containing a `<form>` tag.
`_includes/partials/sidebar.njk` puts a `<noscript>` GET search form in the sidebar of every
page, so **6,980 of 6,982 pages** qualify. None of them is a Netlify form — the site's real
forms post to Formspree (`content/pages/contact.njk`) and Buttondown
(`_includes/partials/buttondown_contact_form.njk`).

**Fix: disable Form detection in the Netlify UI** (Site configuration → Forms → Form
detection). This is a site setting; `[build.processing] skip_processing` in `netlify.toml`
governs asset optimization only and does not affect it.

### Why the whole site was re-processed every deploy

`_data/assetVersion.js` used to prefer `COMMIT_REF`, and `_includes/partials/seo.njk` stamps
that value into `?v=` on every page. Every commit therefore changed every page's bytes, so
all ~7,000 files were "new" and were re-uploaded and re-post-processed even for a
one-article change.

`assetVersion` now hashes the *content* of `css/bs.css`, `public/css/index.css`, and
`public/css/font.css`. It hashes the **source** stylesheets; `_site/css/bs.css` is later
purged against the built HTML, so the served bytes can shift without a source change. That is
why `public/_headers` uses `max-age` + `stale-while-revalidate` rather than `immutable` —
a purge-only change self-heals within the revalidation window.

Cache-Control and CORS for static assets live in `public/_headers` only. `netlify.toml` used
to define overlapping rules for `/css/*`, `/js/*`, and `/images/*` with different values;
two sources of truth for one path have undefined precedence. Do not reintroduce them.

## Current implementation notes

### Rendering

- One HTML transform, `jcrt-html` (`eleventy.config.js`), which runs `ensureImageAltAttributes`
  and `demoteRedundantH1s`. The PostHTML/Font Awesome transform and HTML minification were
  removed; `HtmlBasePlugin`, `InputPathToUrlTransformPlugin`, and `IdAttributePlugin` are
  commented out. Any profile citing those as hotspots is stale.
- Markdown rendering and slug generation are memoized in memory.
- `markdown-it-footnote` is required by hundreds of content files; `eleventy-plugin-toc`
  supplies the `toc` filter used by layouts.

### The sidebar

`_includes/partials/sidebar.njk` has no per-page inputs — it is driven entirely by
`metadata.sidebar.*`. Hashing the rendered `<section id="sidebar-container">` across a
300-page sample yields exactly one distinct rendering. It is therefore rendered once by the
memoized `sidebar` shortcode in `eleventy.config.js` and reused, rather than re-executed
7,000 times. If you add a per-page variable to that partial, the shortcode must be changed or
the memoization will serve stale markup to every page.

### Assets

- Production sets `SKIP_IMAGE_PROCESSING=1`; content images resolve to `files.jcrt.org`.
  `eleventy-img` and `sharp` are effectively unused during a Netlify build.
- The Duotrope badge is self-hosted from `/badges/` with a CSS-only hover swap. It previously
  loaded `cdn.duotrope.com` behind ~1.5 KB of inline handlers on every page.
- Sidebar images carry no inline `onerror`; the delegated handler in `_includes/base.njk`
  covers them via `data-fallback-src`.

## Supported commands

```bash
npm run build            # full production pipeline (alias of build:netlify)
npm run build:netlify    # what Netlify runs
npm run dev              # incremental dev server (QUICK_DEV=1)
npm run start            # dev server with sitemaps regenerated first
npm run perf:benchmark   # Eleventy per-operation diagnostics
```

Eleventy 4 alpha logs benchmarks under `Eleventy::Benchmark`; `perf:benchmark` uses
`DEBUG=Eleventy:*Benchmark*` to match.

## Optimization policy

1. **Start from a deploy log, not a local render.** The local Eleventy time has repeatedly
   pointed at the wrong stage.
2. Identify the stage that actually dominates wall clock.
3. Make the smallest change that addresses it.
4. Verify output safety by diffing `_site` before and after; the expected diff should be
   enumerable in one sentence.
5. Reject changes that alter permalinks or rendered content unintentionally.

Known costs that are **not** worth optimizing at current scale, with measurements:

- Collapsing the ~4,975 `size: 1` taxonomy pages. `MAX_TAG_PAGES` (`_data/tagIndex.js`)
  would throttle them, but the whole render is 17s and this deletes indexed URLs from a
  journal of record. Treat as a content/SEO decision, not a performance one.
- `git filter-repo` on the 462 MB pack (440 MB is deleted PDFs/TIFFs in history). Netlify
  logs `Building with cache` and does not pay a cold clone.
- Pagefind index caching — the whole Pagefind step is 5s.
- The six full walks of `content/**/*.md` across scripts and `_data/` — ~3-5s combined.
- `_data/tagIndex.js`'s mtime-based cache key looks broken under git checkout, but Netlify
  reuses `/opt/build/repo` between builds. **Verify before changing it.**
