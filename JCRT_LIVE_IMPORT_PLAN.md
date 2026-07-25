# Import JCRT Live into Its Own Content Folder

Status: implemented and verified on 2026-07-25.

## Content

- [x] Move all 27 drafts from `_drafts/jcrt-live/` to `content/religioustheory/live/`.
- [x] Remove the leading date from each filename while retaining a quoted `YYYY-MM-DD` front-matter date.
- [x] Publish each post at `/religioustheory/live/<filename>/` without a separate Live landing page.
- [x] Add unique nanoids, corrected titles, 150–160-character descriptions, `Live` categories, `theoryPosts`, and 4–6 lowercase topic tags.
- [x] Remove retired Typepad source metadata and replace the one Typepad article link with its local JCRT permalink.
- [x] Normalize imported Markdown while preserving historical prose and closing biographies.

## Authors

- [x] Verify every attribution from the article text and closing biography.
- [x] Reuse existing author profiles and `/editors/`.
- [x] Add source-era profiles for Faisal Devji, Daniel Douglas Miller, and Artur Sebastian Rosman.
- [x] Preserve the existing Victor Taylor and Colbey Emmerson Reid profile URLs while normalizing their display names.
- [x] Credit “Post-America: An Exchange” to David Hale and Carl A. Raschke.

## Integration

- [x] Reuse the existing Religious Theory post defaults through `live.11tydata.js`.
- [x] Include `live/` in feed input, taxonomy and author indexing, sitemap/OAI, DataCite, FAIR, Standard.site, Sequoia, ATProto, and subject-enrichment scanners.
- [x] Make generated consumers honor explicit permalinks.
- [x] Render Live articles as `BlogPosting` pages with normal Religious Theory Pagefind weight and `/religioustheory/` breadcrumbs.
- [x] Regenerate the tracked sitemap, OAI, DOAJ, and citation-sitemap artifacts.

## Verification

- [x] Validate 27 sources, 27 built pages, no duplicate `/posts/` pages, and no Live landing page.
- [x] Validate metadata, author resolution, nanoids, routes, rendered Markdown, SEO, Pagefind, taxonomies, DataCite, FAIR, Standard.site, Sequoia, sitemap, and OAI output.
- [x] Pass `npm run nanoids:check`, `npm run build:local`, `npm run sitemaps:check`, `npm run oai:validate:quick`, `npm run standard:check`, and the production-style local build.
- [ ] `npm run subjects:check` remains blocked by the repository-wide baseline: it reports 358 unrelated files needing enrichment and 31 ambiguous FAST terms.
