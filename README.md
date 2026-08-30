# [JCRT](https://jcrt.org)
[![Netlify Status](https://api.netlify.com/api/v1/badges/738f8dd4-3a98-4ce6-9857-537c268780a8/deploy-status)](https://app.netlify.com/projects/jcrt/deploys)[![Sync Assets To jcrt-files](https://github.com/The-Whitestone-Foundation/jcrt-v2/actions/workflows/sync-jcrt-files.yml/badge.svg)](https://github.com/The-Whitestone-Foundation/jcrt-v2/actions/workflows/sync-jcrt-files.yml)

Developed by Adam DJ Brett

## Sitemap + IndexNow
- Runbook: `docs/sitemaps-and-indexnow-runbook.md`
- Local sitemap-safe serve: `npm run start`
- Build-time sitemap integrity check: `npm run sitemaps:check`

## Acknowledgments
- Build performance optimization audit and recommendations by [Brennan Kenneth Brown](https://github.com/brennankbrown)
- Credit to [11tybundle.dev](https://github.com/bobmonsour/11tybundle.dev) for the build-speed pattern that inspired the faster local JCRT workflow. Their latest-issue / cache-first approach helped reduce local iteration time by roughly 60-70% in practice, and the JCRT build now uses the same idea via the `build:latest` and `build:local:latest` fast paths.

## Next Steps
5. idea: use RT for book reviews
6. add pagination to 24.2 and 25.1 pdfs
7. **Apply the ORCID iDs.** Review `output/orcid-candidates.yaml`, set `confirm: true` on
   accepted rows, run `node scripts/orcid-lookup.mjs --apply`. Suggested order: the 29 rows
   whose reason says `ORCID record lists a JCRT work` (near-certain), then the rest of the
   `high` rows, then the 17 `medium` by hand. Known-soft: `andrew-w-metcalfe`,
   `james-c-james-craig-livingston`, `mark-murphy` are probably **wrong**; `simon-clark`
   is borderline (shares only "london").
8. **Sweep author affiliations for typos.** Auditing 109 rows found three. Where a `high`
   ORCID match's institution disagrees with ours, one of the two is wrong.
9. **Look for more duplicate author files.** The four found were surfaced by accident (two
   slugs sharing one ORCID iD). A deliberate pass would likely find others.
10. **Clean up orphaned AT Protocol records** for the four deleted author pages — local keys
    are gone so the build passes, but nothing removed them from the PDS.

## EBSCO
contact ebsco have link to pages or pdfs

## increase incoming links

## CHANGELOG
~~1. check author pages especially mine prove they are working~~

### 2026-08-30 — ORCID tooling, author dedup, OAI-PMH fix
Full notes: `~/github/personal/jcrt-author-merge-and-orcid-notes.md`

**Added `scripts/orcid-lookup.mjs`** — finds ORCID iDs for the 638 authors with no `orcid:`
in front matter. Writes a reviewable report to `output/orcid-candidates.yaml`; it never
edits content unless you pass `--apply`. Full pass: 105 high, 17 medium, 319 low, 197 none.

```bash
node scripts/orcid-lookup.mjs --deep     # regenerate the report (instant when cached)
node scripts/orcid-lookup.mjs --apply    # write rows you marked `confirm: true`
```

**Fixed `/oai` identifying the journal as a person.** `repositoryName` was `"Victor Taylor"`,
a hardcoded fallback in `scripts/generate-local-sitemaps.mjs` and `scripts/lib/oai-pmh.mjs`
with `OAI_REPOSITORY_NAME` never set anywhere. Now `"Journal for Cultural and Religious
Theory"`. The rest of the endpoint (all six verbs, resumption tokens across 1194 records)
was checked and is healthy — `/oai` with no verb returning `badVerb` is correct behavior,
not a bug. **Needs a deploy to reach the live endpoint.**

**Merged four duplicate author records** onto the byline with the middle initial:
`roger-green` + `rodger-k-green` → `roger-k-green` (16 items now on one page),
`jason-alvis` → `jason-w-alvis`, `christopher-demuth-rodkey` → `christopher-d-rodkey`.
Also: 20 bylines normalized, 4 dead `/authors/` links in issue bios repaired, 16 redirects
added, affiliation typos fixed (`Lindenwood Uniiversity`, a stray leading `:`,
`Udger Hagedorn`, and Richard Kearney who is at Boston College, not Boston University).

> **Author slugs:** `_config/authorSlug.js` now has a `CANONICAL_SLUGS` map (the old
> one-off `victor-e-taylor` case, generalized). Author pages are keyed by `authorSlug()` of
> the **article byline**, not by the author file — see `_data/tagIndex.js:127`. If you
> delete or rename an author file, add its old slug to that map or existing bylines will
> link to a page that no longer builds.

> **Deleting any content file:** remove its key from `_data/standardSiteRecords.yaml` too,
> or `npm run standard:check` fails and `build:netlify` aborts.

### 2026-08-30 (later) — author page/byline reconciliation
Applied **28 ORCID iDs** — every one corroborated by a JCRT publication already on that
person's own ORCID record. 77 `high` and 17 `medium` rows still await review in
`output/orcid-candidates.yaml`.

Swept every published byline against the author files and closed **17 orphan bylines** —
articles whose byline linked to an author page that did not exist, which also left the
author's own page empty (and `_includes/authors.njk` hides bio, affiliation and ORCID on an
article-less page, so those were invisible too).

- **Renamed to canonical slugs:** `reginald-bell` → `reginald-bell-jr`,
  `carl-a-raschke` → `carl-raschke`, `senart-skof` → `lenart-skof` (slug typo).
- **Carl A. Raschke normalized** — one page at `/authors/carl-raschke/` now holding **49
  items**; all bylines and bio links show "Carl A. Raschke".
- **Removed 4 dead author pages:** `michael-grimshaw`, `mike-sugimotor`, `dashan-datar`
  (duplicates of pages that had the articles) and `john_dhoe` (placeholder).
- **Created 7 author files** that never existed: CJ Gordon, Jean Leclercq, Joyce Ann
  Konigsburg, Manuel Mejido Costoya, Manuel Vasquez, N.N. Trakikis, Nicholas Wolterstorff.
- **7 aliases** for bylines that belong to an existing page (S.J. Cowan, Ben Stahlberg,
  Charles Winquist, Hent de Vries, Jonathan Scott Lee, Peter Heltzel, Carl A. Raschke).
- **Byline typos fixed:** "Stephen Benko" → "Steven A. Benko" (the Buffy article is the
  Meredith College Benko), "Jean Leclerq" → "Jean Leclercq" (matches `leclercq.md`).
- 24 redirects added; 8 files relinked off dead `/authors/` URLs.

> **`_data/tagIndex.js` caches each file's computed author slugs, and `CACHE_VERSION` must
> be bumped whenever `authorSlug()` changes.** Otherwise files whose *content* did not change
> keep serving their old slugs — and because `netlify-plugin-cache` persists `.cache` across
> deploys, a stale cache survives into production. This silently swallowed the Raschke merge
> (his page built with 2 articles instead of 49) until the version was bumped to 6.


## Needs
~~1. netlify integration~~
- after the domain name is activated impliement a DAM for pdfs and citations
- Find ways to decrease production build times
- add git-lfs
CHANGELOG

## Questions for Carl and Vic 
- TODO archives 22.1 files dont look right at all, bios.md missing, none of the articles match the live site
- TODO archives17.2 Jean Leclerq How to do things with words (of God)? Michel Henry’s Phenomenology of Religion - original site lists it but has a dead link, new build has no files on it whatsoever, would be sort id 04
- TODO archives 16.1, original lists "Review of Judith Butler’s Senses of the Subject Matt Waggoner", no files in original or new site exist, would be last item on page sort id 10
- TODO archives 3.3 "The City and the Stars: Politics and Alterity in Heidegger, Levinas and Blanchot. By Lars Iyer, University of Newcastle upon Tyne." original article missing entirely would be sort_id: 02





### Need Help or Have Project ?? Contact Me
- adamdjbrett.com
- info@adamdjbrett.com


## Version additions
### v0.6
- autogenerate citations as *.rs and *.csl.json
### v0.5
- Archives Post Layout
- Sidebar Nav Fixed

### v0.4
- Integration with github API religioustheroy repo (Auto Update 1 Day Schemes)


## Editorial Theme nicely coded examples
- [ghost](https://editorial.ghost.io/)
- [last update 2 weeks ago jekyll option](https://github.com/TurkuNLP/turkunlp.github.io)
- [andrew - older but still good css](https://andrewbanchich.github.io/editorial-jekyll-theme/)
