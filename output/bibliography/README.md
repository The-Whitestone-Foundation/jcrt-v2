# JCRT bibliography metadata

This directory records the source research and validation for the bibliographic metadata emitted on archive articles, issue collections, and Religious Theory posts. The implementation is in [`_config/bibliography.js`](../../_config/bibliography.js), [`_includes/partials/bibliographic-meta.njk`](../../_includes/partials/bibliographic-meta.njk), and the page JSON-LD helpers. Archive records remain `journalArticle`/`ScholarlyArticle`; Religious Theory records remain `blogPost`/`BlogPosting`.

The generated metadata includes one ordered creator entry per author, structured given/family names where verified, precise publication dates, issue and page data, complete published abstracts, keywords, absolute article and PDF URLs, normalized DOI identifiers, language, publication identity, publisher, ISSN, and nanoid identifiers. Collection pages expose issue and ordered article relationships without article-level citation tags. Missing facts are omitted rather than inferred, and a post's HTML URL is identified as full text only when the page has verified full text.

## Provenance inventory

- [`provenance.json`](provenance.json): 1,215 field-level bibliography changes, sourced from existing front matter and issue data, local article PDFs, JCRT issue/article pages, DOI records, and official author or institutional profiles.
- [`pdf-provenance.json`](pdf-provenance.json) and [`pdf-research.json`](pdf-research.json): 100 printed page-range backfills, 35 published PDF abstracts, and 95 HTML full-text confirmations. The PDF manifest contains 814 files with no manifest errors; 18 non-article records were excluded.
- [`author-provenance.json`](author-provenance.json): 22 source-backed archive author updates. [`theory-author-provenance.json`](theory-author-provenance.json): 41 source-backed Religious Theory author updates. Compound surnames, initials, collective creators, and suffixes were preserved when supported.
- [`publisher-corrections.json`](publisher-corrections.json): the two volume 18.3 Roberts/Hayden records now both use the publisher-confirmed DOI `10.17613/my21r-51v31`; routes and nanoids were preserved.

## Unresolved or intentionally omitted facts

- [`pdf-research.json`](pdf-research.json) lists 357 archive records whose printed page range could not be verified from the available PDFs. No range was inferred from wrapper pages or file length.
- [`author-research.json`](author-research.json) retains the existing DOI `10.17613/hcm64-85h06` on the David Roome book review because DataCite returns 404 and Crossref has no exact title-author match. It remains pending publisher confirmation.
- [`theory-author-research.json`](theory-author-research.json) records two identity limits: David Roome has no local author profile, and the byline spelling “Ludger Hagerdorn” conflicts with the complete canonical profile for Ludger Hagedorn. No profile or byline correction was invented.
- Other absent abstracts, pages, dates, DOI values, and name components remain absent. DOI deposit dates were not substituted for publication or cover dates, and journal volume, issue, pagination, and ISSN were not assigned to Religious Theory posts without evidence.

## Verification

[`scripts/bibliography.test.mjs`](../../scripts/bibliography.test.mjs) covers date precision, page-range variants, DOI normalization, ordered/structured creators, complete abstracts, HTML/PDF separation, DOI presence and absence, nanoids, and article-versus-collection output. The final rendered audit passed for 1,186 articles/posts and 97 collections; the source-integrity check confirmed all 792 modified source bodies and nanoids were preserved.

[`zotero-verification.json`](zotero-verification.json) contains representative archive, multi-author, suffix-name, Theory-with-DOI, and Theory-without-DOI fixtures. Zotero compatibility was checked by invoking the official translator functions `addHighwireMetadata` and `finalDataCleanup` from the installed translator against rendered metadata. This is a parser-shape check using synthetic documents; it does not perform a live Zotero library import.
