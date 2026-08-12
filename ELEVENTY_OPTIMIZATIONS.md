# Eleventy build performance

Last verified: 2026-08-11

JCRT's Eleventy render is already fast for the amount of generated content. Optimize only from measured benchmark output; do not add caches or duplicate data sources speculatively.

## Current measurements

Measurements use three consecutive warm-cache runs on the same workstation. CPU time is the comparison metric because wall time on a shared machine varied substantially during validation.

| Build | Outputs | Before cleanup | After cleanup | Change |
| --- | ---: | ---: | ---: | ---: |
| Full Eleventy render | 6,800 | 15.73s CPU | 16.05s CPU | +2.0% |
| Latest issue | 1,129 | 4.30s CPU | 4.50s CPU | +4.7% |

Both remain inside the 5% no-regression threshold. The existing 13,793-file `_site` tree was byte-for-byte identical after the dependency cleanup.

These numbers cover Eleventy rendering, not the complete production pipeline. `npm run build` also stages Standard.site data, generates and validates sitemaps, validates OAI-PMH, purges CSS, and runs Pagefind.

## Supported commands

```bash
# Complete production build and validation pipeline
npm run build

# Full Eleventy benchmark with per-operation diagnostics
npm run perf:benchmark

# Lean benchmark that omits expensive secondary outputs
npm run perf:benchmark:lean

# Latest-issue build for local iteration
npm run build:latest

# Latest-issue development server
npm run build:local:latest

# Incremental development server
npm run dev
```

Eleventy 4 alpha currently logs benchmarks under `Eleventy::Benchmark`; the scripts use `DEBUG=Eleventy:*Benchmark*` to match that namespace. Benchmark output is intentionally verbose and identifies transforms, filters, data files, and individual templates.

## Current implementation

### Markdown

- `markdown-it-anchor` generates heading anchors.
- `markdown-it-footnote` is required by hundreds of content files.
- `eleventy-plugin-toc` supplies the `toc` filter used by layouts.
- Markdown rendering and slug generation are memoized in memory.
- `markdown-it-attrs` was removed because no content uses its attribute syntax.
- `markdown-it-table-of-contents` was removed because it was installed but never configured.

### Collections and templates

- Authors are loaded with `getFilteredByGlob("content/authors/*.md")`.
- `getAuthorObj` builds one memoized `Map` per authors collection; benchmark output shows author lookup is not a material hotspot.
- Expensive secondary collections are already omitted from lean builds.
- Latest-issue and benchmark preprocessors already restrict the rendered content set.

Do not add a second authors database or a general collection cache. In particular, a cache key containing `Date.now()` changes on every lookup and can never produce a cache hit.

### Assets and generated output

- Image dimensions, resolved image paths, responsive thumbnails, and Markdown fragments have in-process caches.
- Thumbnail and Pagefind caches persist under `.cache`.
- Static assets use long-lived browser cache headers.
- HTML minification remains disabled because its per-page transform cost exceeded its build-time benefit.

## Latest benchmark findings

A representative full diagnostic run identified these aggregate costs:

- PostHTML transformation: about 24%.
- Template rendering: about 17%.
- HTML transformer plugin: about 14%.
- Data-file loading: about 7%.
- Template writes: about 6%.
- `ensure-img-alt`: about 6%.
- Author lookup: roughly 33ms total, below 1%.
- TOC rendering: roughly 9ms total, below 1%.

Percentages vary between runs and may overlap because Eleventy records nested operations. Use them to select an investigation target, not to predict additive savings.

## Optimization policy

Leave collection and template structure alone while the median full Eleventy render stays below 20 seconds. If it exceeds that threshold:

1. Run `npm run perf:benchmark` three times with warm caches.
2. Select one repeated hotspot that materially affects total time.
3. Make the smallest change that addresses that hotspot.
4. Compare three before and three after runs on the same machine.
5. Verify output counts and representative footnotes, heading anchors, TOCs, archive pages, and author links.
6. Reject changes that regress the median by more than 5% or alter rendered output unintentionally.

Do not combine includes, convert YAML to JSON, precompute authors, or refactor archive loops without benchmark evidence that the specific change will address a current hotspot.
