# Build and deploy performance

Last verified: 2026-08-29 (against a real Netlify production deploy log)

## 2026-09-23 pass — the deploy was doubling itself

### The finding that outranks every build-step tweak

Every content push produced **two** production deploys. `publish-standard-site.yml` ran
`sequoia publish` and committed back; each of those bot commits (21 between 2026-08-23 and
2026-09-22) changed ~1,666 files, because it rewrote the `atproto:` line of every article with
a **new** record key. `_includes/partials/seo.njk` renders that URI on 1,830 pages, so deploy
#2 re-uploaded ~1,850 HTML files and re-ran post-processing, and every content mtime moved,
so the `tagIndex` cache missed too.

Root cause, from the sequoia-cli 0.5.7 source: per staged file, `no state entry → create`;
`state hash ≠ hash(file) → frontmatter.atUri ? update : create`. After a create the CLI
inserts `atUri: "…"` as the last front-matter line and stores the hash of *that* text. The
staging step wiped `.sequoia/content` and regenerated every file **without** the line, so every
run mismatched every hash, found no atUri, and created all ~1,826 documents again. Run
35748190114 (a 20-file push): `Found 1826 posts / 1826 posts to publish / Errors: 160 (Rate
Limit Exceeded)` — 1,666 creates × 3 points is the PDS 5,000-point hourly budget. The PDS
holds 76,239 document records for 1,816 real ones.

Fix: `scripts/sequoia.mjs stage` emits `atUri: "<uri>"` from `_data/standardSiteRecords.yaml`
byte-for-byte as the CLI would have inserted it (`scripts/sequoia.test.mjs` pins the bytes
against a copy of the CLI's inserter). `sequoia publish --dry-run` now plans 1,811 skips, 11
creates (documents the rate limit had always blocked) and 5 one-time in-place updates. The
workflow commits only the records map and state, marks state-only commits `[skip netlify]`,
and no longer touches `content/`. A content-only push therefore gets **one** deploy.

Orphan cleanup is a separate, hand-run job (`npm run sequoia:prune` lists; `node
scripts/sequoia.mjs prune --max 4000` deletes within the rate budget). Do not run
`sequoia:sync` before it finishes: sync lets the last-listed duplicate win.

### Build command: measured, then mostly left alone

Local, two consecutive baseline builds, 0 differing files:

| Step | Before | After |
| --- | ---: | ---: |
| Eleventy | 10.5–11.9s | 9.7–10.1s (noise) |
| css (purge → optimize) | 8.6–8.8s ∥ | 8.4s ∥ (2.1s serial) |
| pagefind | 6.1–6.5s ∥ | 7.1–8.4s ∥ |
| validators + tests, Phase A + C | ~2.6s | ~2.6s |
| **wall clock** | **20.9–22.8s** | **20.4s** |

- PurgeCSS runs through its JS API in one process with `css-dedup` + `lightningcss`, and
  skips the ~4,900 template-generated taxonomy term pages (`archives/keywords/*`, `tags/*`,
  `religioustheory/tags/*`, `religioustheory/categories/*`, names ≥ 4 chars; one sample of
  each directory is still scanned, and the A–Z letter pages always are). Output verified
  byte-identical to the CLI-over-everything result.
- Pagefind runs from Eleventy's `eleventy.after` hook (see the round-2 note below);
  `_config/run-pagefind.js` is gone. The old "park the Google verification file" dance was
  dropped too: Pagefind only indexes inside `[data-pagefind-body]`, which that file lacks
  (verified: zero references to it in the index without parking).
- `.npm-cache` dropped from `netlify-plugin-cache` and `NPM_CONFIG_CACHE` removed: they
  duplicated Netlify's own npm/node_modules cache (`npm install` was 887 ms in the log).
- `_data/tagIndex.js` prints `[tagIndex] {…cacheHit…}` in build mode. Read it in the next
  deploy log: it settles whether Netlify's checkout preserves the mtimes the cache key uses.
- Not done, with reasons: parallelising Phase A (~1s, loses "failure is the last line on
  screen"); dropping sharp/eleventy-img (imports cost 21–114 ms; Netlify caches
  node_modules); render tuning (see the 2026-09-03 negative result below).

### Round 2, same day: delete work instead of merging it

`scripts/` went from 14 top-level files to 11, `lib/` from 8 to 7, and `schemas/oai/` (4 XSDs)
is gone. Concretely:

- **No orchestrator.** `scripts/build.mjs` is deleted. `npm run build:netlify` is four
  commands: `npm test` → `nanoids:check` → `check.mjs pre` (standard + cms) → `eleventy`.
  Everything that used to be Phase C (css purge → minify ∥ pagefind ∥ sitemaps → oai →
  bibliography checks) runs inside `eleventyConfig.on("eleventy.after")`, gated on
  `runMode === "build"` so `npm run dev` never pays for it. Checks throw `CheckFailed`
  instead of setting an exit code; a throw in the hook fails the Eleventy process (verified
  exit 1 on a throwaway config). The one-line `[build] after Eleventy: css 2.1s ∥ pagefind
  7.0s ∥ checks 1.9s` log replaces the old step table. `--serial` is gone; run the checks
  by hand (`node scripts/check.mjs <name>`) when debugging.
- **Feeds are built, not committed.** `scripts/generate-local-sitemaps.mjs` (418 lines) and the
  five generated files it kept in `public/sitemaps/` are deleted. `_data/oaiFeeds.js` computes
  the DOAJ feed, the OAI-PMH static feed, its records index and the two citation sitemaps
  once per build; `content/sitemaps/oai-feeds.11ty.js` (a JavaScript template, so no Nunjucks
  pass) writes each one byte-exact. All five compared identical to the last committed
  copies. This also removes a Phase A step and the failure mode where the committed copies
  lag the content (they were stale when this pass started). The OAI edge function fetches
  `/sitemaps/oai-records.json` from the live site, so nothing there changes.
- **XSD validation dropped.** It only ever ran by hand. `check.mjs oai` keeps the 13 protocol
  cases, day-granularity and resumption-token checks; the xmllint path, `--xsd` and
  `scripts/schemas/oai/` are gone (about 150 lines and four files).
- **Deleted outright:** `scripts/orcid-lookup.mjs` (paused manual migration; in git history at
  `8757b76d2`), `sequoia.mjs audit` (no caller), `lib/nanoid.mjs` (17 lines, one caller,
  inlined into `generate-nanoids.mjs`).
- **Lighthouse PWA audits** (the plugin's three complaints): `<meta name="theme-color">` in
  the static head, a 512×512 PNG icon in the web manifest (rendered once from the SVG with
  sharp, 11 KB), and a service worker that registers, claims the page and caches nothing.
  A journal of record must never serve a stale article from a browser cache, so the worker's
  fetch listener is empty on purpose. `/sw.js` is served with `max-age=0`.

Local build after round 2: 19.1 s wall (the Phase A commands add ~2 s before Eleventy's own
14 s). Output diff vs the previous build: only the two PWA lines on every page plus the
`site.standard.document` links the fixed workflow added to the 11 never-published articles.

### IndexNow moved out of GitHub Actions

`indexnow.yml` ran `npm ci` and the **whole production build** on every push to main (~55s,
`fetch-depth: 0` for nothing) to read three Eleventy-rendered sitemaps, then announced 5,541
URLs before Netlify had deployed them. It is deleted. `plugins/indexnow` runs on Netlify's
`onSuccess`, after the deploy is live and after the Cloudflare purge, and submits only URLs
that were not in the previous deploy (watermark `.indexnow-urls.json`, carried by
`utils.cache`; it does not depend on `netlify-plugin-cache` running after it). The first
deploy after this lands announces everything once; later ones announce deltas.

### What to read in the next production deploy log

1. Exactly one deploy per content push (the Deploys list), and no bot commit unless a
   document was added or edited.
2. "Deploy site" file count ≈ the pages you touched plus listing pages, not ~1,850.
3. Post-processing near zero (Forms detection was switched off 2026-09-01; still unverified).
4. `[tagIndex] … "cacheHit": true|false`.
5. `indexnow: Preparing N URL(s)` on the first deploy, then `No new URLs since the last deploy`.
6. `build.command` total: expect it under 30s (it was 30.7s on 2026-08-29 with the old
   serial purge/pagefind).

## 2026-09-03 pass — template size, and a negative result on render speed

### The render is 8.5s, and the DEBUG benchmark numbers are not it

`npm run perf:benchmark` reported a 16.65s render with `Render` at 4,252 ms / 26%. The same
build without `DEBUG=Eleventy:*Benchmark*` takes **8.5s**. The instrumentation roughly
doubles the render, and it inflates the render-tree lines specifically — so the profile
points at exactly the thing the profiler is charging for. Use `perf:benchmark` to find
*which* operations are hot relative to each other; never quote its totals as build time.

Measured on one workstation, `SKIP_IMAGE_PROCESSING=1`, 7,889 files, minimum of 4 runs
(the median is unusable — background load produced 30s outliers):

| Variant | Render |
| --- | ---: |
| Baseline | 8.50s |
| Static `<head>` extracted, memoized shortcode | 8.01s |
| Static `<head>` extracted, plain `{% include %}` | 8.30s |

That spread is ~5% at best and is not separable from noise on this machine. **Hoisting
static markup out of a per-page partial does not measurably speed up Eleventy.** Nunjucks
compiles literal text to string appends; the cost was never the markup.

Two more structural measurements, both negative:

- Deleting `content/archives/keywords/tag-pages.njk` drops 3,626 pages and takes the render
  from 8.5s to **6.3s** — 0.63 ms per taxonomy page. The 4,759 `size: 1` taxonomy pages
  cost ~3s combined. Roughly 5s of the render is fixed cost (filesystem walk, global data,
  collections) that no template change touches.
- Filters are ~800 ms in total across 250,000 calls. `postDate` (208 ms / 5,254 calls) is
  the most expensive per call; nothing here is worth memoizing.

Conclusion, consistent with the 2026-08-29 deploy-log finding: **the Eleventy render has no
remaining lever worth pulling.** It is ~8.5s of a deploy that is dominated elsewhere. Do not
optimize it further without a deploy log showing otherwise.

### What was changed anyway (size, not speed)

- Deleted three templates that nothing references: `_includes/archives-index.njk`,
  `_includes/postslist.njk`, `_includes/partials/content.njk` (99 lines). The `postslist`
  matches elsewhere are a local variable in `content/tag-pages.njk`, not the template.
- `_includes/partials/seo.njk` 470 → 360 lines. The build-invariant part of the `<head>` —
  verification and fediverse meta, `og:site_name`, the favicon set, the deferred-manifest
  script, the site-wide `alternate`/`sitemap` links, `language`/`locale`/`generator`, the
  Dublin Core base triple, both `<style>` blocks, the preconnect and the versioned CSS links
  — moved to `_includes/partials/head_static.njk`, rendered once by the memoized `headStatic`
  shortcode in `eleventy.config.js`. Same contract as the `sidebar` shortcode above it: if
  you add a per-page variable to that partial, every page gets stale markup.

  Verified safe: with the partial in place, all 7,889 output files are present and **7,046
  of 7,046 differing HTML files have an identical multiset of lines** — the change is a pure
  reordering of the `<head>`, with zero content difference.

  The real win is browser-side, not build-side: `/css/bs.css` and the critical `<style>`
  blocks now sit at the top of the `<head>` instead of ~6 KB in, so the preload scanner
  finds them sooner.

## 2026-09-01 pass

`build:netlify` is now `node scripts/build.mjs` — one orchestrator instead of a serial `&&`
chain of eight `npm run` spawns. Independent post-Eleventy steps overlap:

```
Phase A  test → nanoids:check → standard:check → cms:check → sitemaps:generate   (serial)
Phase B  eleventy
Phase C  css (purge → optimize, one process) ∥ pagefind ∥ { sitemaps:check → oai:validate:quick → bibliography:check }
```

Measured back-to-back on one workstation: **50.4s serial → 24.6s orchestrated**. The same
steps run one at a time with `node scripts/build.mjs --serial` (readable logs when
debugging); `scripts/build.mjs` is the only place
the steps are defined. Every step is still its own `npm run <name>`. Ordering constraints
preserved: `sitemaps:generate` before Eleventy, `css:purge` before `css:optimize`.

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

`scripts/check.mjs sitemaps` (then `check-sitemaps.mjs`) at the time validated only the root index — 21 entries against
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
| — pagefind (then `_config/run-pagefind.js`, now a step in `build.mjs`) | 5s | |
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
npm run build:netlify    # what Netlify runs: npm test → nanoids:check → check.mjs pre → eleventy
                         # (css, pagefind and the post-build checks run in eleventy.after)
npm run dev              # incremental dev server on :8080 (QUICK_DEV=1); no post-build work
npm run dev:full         # full-site dev server on :8080
npm test                 # script tests (also the first build step)
npm run perf:benchmark   # Eleventy per-operation diagnostics

# Individual checks (scripts/check.mjs; the post-build ones need a built _site)
npm run standard:check | cms:check | nanoids:check | sitemaps:check | oai:validate | bibliography:check
npm run css              # purge + optimize _site/css in one process (css:purge, css:optimize separately)

# Standard.site / AT Protocol (scripts/sequoia.mjs)
npm run sequoia:publish:dry   # what the workflow would do, without touching the PDS
npm run sequoia:prune         # list orphaned document records on the PDS (read-only)
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
  reuses `/opt/build/repo` between builds. Since 2026-09-23 the build log prints
  `[tagIndex] {… "cacheHit": …}`; read that before changing anything.
