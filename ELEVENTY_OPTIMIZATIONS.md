# Build and deploy performance

Last verified: 2026-08-29 (against a real Netlify production deploy log)

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
