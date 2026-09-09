## Bibliography & SEO Metadata Review

### `_config/bibliography.js`

1. **Keyword exclusion filter is broken (bug)** — line 43-44: `.filter(k => !['theoryPosts', 'archives', 'posts', 'nav', 'all'].includes(k))` is case-sensitive and camelCased (`theoryPosts`), but actual tag/category values are lowercase (`filterTagList` in `_config/filters.js:177` normalizes to `theoryposts`). Internal collection tags like `theoryposts` leak into `citation_keywords`/`dc:subject` on blog posts. Also missing `authors` from the exclusion set.

2. **Synthetic-date risk pattern shared with seo.njk** — `preciseDate()` (line 13-18) only matches ISO-ish `YYYY[-MM[-DD]]`. Non-ISO front-matter dates (`"June 2026"`, `2026/06/15`) silently resolve to `''`, producing records with no `publicationDate`/`datePublished` instead of a warning.

3. **`fulltext` flag depends on manual opt-in** (line 51) — archive pages need `html_fulltext: true` set explicitly even if the body contains genuine full text; if an editor forgets, `citation_abstract_html_url` is emitted instead of `citation_fulltext_html_url`, which is an accuracy issue with no validation guard.

4. **Collective-author detection is a hardcoded name regex** (line 34): `/^(?:editors?|jcrt editors|religious theory editors|whitestone publications)$/i`. Any other institutional/guest-editor byline (e.g., "Guest Editors", "Symposium Editors") is misclassified as a `Person` in schema.org output (`articleSchema`, line 123).

5. **Archive-index sort can produce NaN comparisons** — `bibliographyPage` line 108: `Number(b.volume)-Number(a.volume) || Number(b.issue)-Number(a.issue)` breaks silently (unstable order) if any issue lacks volume/issue metadata.

6. **Issue-slug resolution assumes fixed depth** — line 77: `issues[rel.split('/')[1]]`. Any nested archive content structure beyond one directory level silently loses issue association (no volume/issue/date inherited).

7. **PDF URL resolution untested for non-archive path** and not defensive against `data.pdf` already being an absolute or root-relative URL producing an unexpected join with `filesUrl`.

### `_includes/partials/bibliographic-meta.njk`

8. **No citation meta for collection/index pages** — `bib.article` gates the whole author/citation block (line 13-44). Combined with seo.njk's own guard (`not bib` before emitting `dc:creator`, seo.njk:62), archive-issue and theory-index pages end up with **zero** `dc:creator`/author attribution anywhere.
9. `plain()`'s HTML-stripping regex (`bibliography.js:11`, used for abstract/description here) is a naive `<[^>]*>` strip — malformed markup with `>` inside attribute values can leave stray fragments in `citation_abstract`/`dc:description`.

### `_includes/partials/seo.njk`

10. **Synthetic "today" date bug (high impact)** — `isoDate` filter (`_config/filters.js:284-287`) returns `new Date().toISOString()` when given a falsy value, and seo.njk:42 (`publishedDate = ... else metadata.buildTime`) plus `citationPublicationDate` (line 112) propagate this. Any page missing a real date front-matter field gets stamped with the **build/crawl date** as `datePublished`/`citation_publication_date`/`prism.publicationDate` instead of failing loudly — a real accuracy risk for citation indexers and Google Scholar.
11. **Duplicate/divergent metadata logic** — the non-bib fallback branch (lines 124-213) reimplements DOI, date, author, and page-range handling independently of `bibliography.js`. It does **not** run `doi` through `normalizeDoi()`, so a front-matter DOI like `https://doi.org/10.1234/x` is emitted raw in `citation_doi`/`dc:identifier`, inconsistent with bib-driven pages.
12. **Author schema type inconsistency** — JSON-LD fallback branch (line 293-309) always emits `"@type": "Person"` for every name in `schemaAuthors`, unlike `articleSchema()` in bibliography.js which distinguishes `Organization` vs `Person`. Institutional/editor bylines on non-bib pages get incorrect structured data.
13. **Fragile URL-shape heuristics** — `isArchivesArticlePage`/`isTheoryArticlePage` (lines 4-5) depend on `pageParts.length == 5`. Any future path restructuring (e.g., adding a subsection segment) silently disables all citation/PRISM/JSON-LD metadata for that page type with no test to catch the regression.
14. **`/religioustheory/live/` index has no bib coverage** — `theoryIndex` regex (bibliography.js, used via filter) only matches `posts/`, not `live/`, so that index page falls through to the generic (non-bib) schema branch, losing parity with the posts index.

### `scripts/bibliography.test.mjs` — coverage gaps

- No test for `preciseDate` with a `Date` object, or malformed/non-ISO strings (only well-formed inputs are tested) — the case that produces `''`/fallback-date behavior is never exercised.
- No test for the keyword-exclusion bug described in #1 (would have caught the `theoryPosts` vs `theoryposts` mismatch).
- No test for `bibliographyPage`'s `archiveIndex` branch (root `/archives/` listing) — misses the NaN-sort bug (#5).
- No test for `pdfUrl` resolution on non-archive (blog) records — only the archive path is asserted (test line 19).
- No test for `normalizeDoi` edge cases beyond one `dx.doi.org` example (e.g., bare DOI, `doi.org` without protocol, trailing slash).
- No test for `parsePageRange` with unsupported formats (`"12ff"`, `"12, 15"`, `"n/a"`) confirming graceful `{start:'', end:''}`.
- No coverage at all for `_includes/partials/seo.njk` — all the divergent fallback logic in items #10-13 is completely untested; only `bibliographic-meta.njk` is rendered/asserted in tests.
- No test asserting `articleSchema`/`bib.schema` for a blog/theory record (only archive record's schema and the issue-collection schema are asserted).
- No negative test for `bibliographyPage` returning `null` on an unrelated URL.

**Priority for CTO:** #10 (synthetic date), #1 (keyword filter case bug), and #11/#12 (bib vs. non-bib divergence in seo.njk) are the most consequential — they produce inaccurate, publicly-visible metadata today, not just theoretical edge cases.

