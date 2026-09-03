---
nanoid: "BCyJEX"
doi:
atproto: 'at://did:plc:e24okfpxr7ctcbmruijop5gp/site.standard.document/3mulbbaeptq2n'
title: "Every Article in the JCRT Archive Now Has a DOI"
description: "All 829 articles in the numbered JCRT archive, from volume 1 in 1999 through volume 25 in 2026, now carry a Digital Object Identifier and are deposited in Knowledge Commons Works as 67 public issue collections."
image: /images/jcrt-open-graph.webp
thumbnail: /images/jcrt-open-graph.webp
date: 2026-08-30T10:00:00.000-04:00
tags:
  - updates
author: adam-dj-brett
toc: false
---
In July we announced that JCRT was assigning Digital Object Identifiers to every article we publish, and that we would work backward through the archive until the whole run was covered. That retroactive project is now finished.

Every article in the numbered JCRT archive has a DOI. That is **829 articles across 67 issues**, from volume 1, issue 1 in 1999 through volume 25, issue 2 in 2026. Each one is deposited in [Knowledge Commons Works](https://works.hcommons.org/), the open scholarly repository run by [Knowledge Commons](https://hcommons.org/), where it sits in a public collection for its issue alongside its PDF and its full metadata.

## What this means if you have published with us

Your article has a permanent identifier. Cite it, put it on your CV, and give it to a database; it will keep resolving even if our site moves, our URLs change, or the journal outlives its current hosting arrangements (a journal publishing since 1999 has already outlived several).

You do not need to do anything. The DOI already appears on your article's page here and in the citation exports linked from it. If you want the deposited copy, every issue collection is public at `works.hcommons.org/collections/`, and the article page links to it.

One clarification, because the two get muddled constantly: **a DOI identifies a work, not a person.** The identifier that belongs to *you* rather than to your article is an [ORCID iD](https://orcid.org/). Connecting those is a separate project.

## Correcting our earlier announcement

Our July post said the DOIs would be registered through Crossref. We decided instead to go with DataCite and KC Works. JCRT's DOIs are DataCite DOIs registered through Knowledge Commons Works, under the prefix `10.17613`. They resolve exactly as any DOI does, and they carry the same permanence commitments; the registration agency is the other one. We have corrected the earlier post.

## What it took

Assigning a DOI is the last step of the process, not the first. A repository will not accept a deposit without complete, structured, machine-readable metadata for every record, so the archive had to be brought to a consistent standard first. Ours was assembled over twenty-seven years, by a series of editors, through at least three site migrations, and it showed.

The first task was normalizing the archive source. We restored missing volume, issue, and year values; repaired malformed author affiliations; and corrected damage inherited from earlier platform migrations (mangled brackets, broken block quotations, orphaned footnotes) against the original PDFs. Where a filename, a title, and a byline disagreed about which article they named, the PDF settled it.

The second was subject metadata. The archive now carries 3,601 controlled subject headings drawn from [FAST](https://www.oclc.org/research/areas/data-science/fast.html) and [Homosaurus](https://homosaurus.org/), verified term by term. Where no authority record genuinely matched, we left the term off rather than guess; a wrong authority heading is worse than none.

The third was the PDFs themselves. The archive held 103 articles published as web pages only, with no PDF of record; those now have one, generated from the article source through a Pandoc and LuaLaTeX pipeline built for the purpose. All 795 archive PDFs now open with a JCRT cover sheet carrying the title, authors, stable URL, publisher, ISSN, and rights statement, with matching embedded metadata and PDF bookmarks. 

## Where the archive can now be found

Alongside the deposits, the archive publishes structured metadata in the formats that discovery systems actually consume: OAI-PMH for LOCKSS based repositories, a DOAJ feed, Schema.org metadata on every article page, and RIS and CSL JSON citation files for all 829 archive articles and 373 Religious Theory posts. Article pages are marked up so that Zotero recognizes them as journal articles rather than as generic web pages, with correct authors, pagination, and journal title.

The practical effect: JCRT scholarship is now legible to citation managers, indexes, and library systems, and nobody has to retype anything.

## What comes next

**ORCID iDs for our authors.** We have 648 author profiles in the archive; 38 currently carry an ORCID iD. Connecting the rest is the next phase, and it is slower work than DOIs were because it cannot be automated safely. Matching a person to an identifier on the basis of a name alone is how records get corrupted. We are working through the profiles with evidence, in reviewed batches, and some authors will simply not have an ORCID record to connect. If you have an ORCID iD and want it on your JCRT profile, [tell us](/contact/) and we will add it immediately (by far the fastest path).
