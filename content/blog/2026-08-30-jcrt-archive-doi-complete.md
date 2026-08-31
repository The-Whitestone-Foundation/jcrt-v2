---
nanoid: "BCyJEX"
doi:
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

Your article has a permanent identifier. Cite it, put it on your CV, and give it to a database, and it will keep resolving even if our site moves, our URLs change, or the journal outlives its current hosting arrangements — which, given that JCRT has been publishing since 1999, is not a hypothetical concern.

You do not need to do anything. The DOI already appears on your article's page here and in the citation exports linked from it. If you want the deposited copy, every issue collection is public at `works.hcommons.org/collections/`, and the article page links to it.

One clarification, because the distinction matters and gets muddled constantly: **a DOI identifies a work, not a person.** The identifier that belongs to *you* rather than to your article is an [ORCID iD](https://orcid.org/). Those are a separate project, described below, and it is not finished.

## Correcting our earlier announcement

Our July post said the DOIs would be registered through Crossref. That is not what happened. JCRT's DOIs are DataCite DOIs registered through Knowledge Commons Works, under the prefix `10.17613`. They resolve exactly as any DOI does, and they are registered with the same permanence commitments; the registration agency is simply the other one. We have corrected the earlier post.

## What it took

Assigning a DOI is the last step of the process, not the first. A repository will not accept a deposit without complete, structured, machine-readable metadata for every record, which meant that the archive had to be brought to a consistent standard first — an archive assembled over twenty-seven years, by a series of editors, through at least three site migrations.

That work included:

- **Normalizing the archive source.** Missing volume, issue, and year values were restored. Malformed author affiliations were repaired. Damage inherited from earlier platform migrations — mangled brackets, broken block quotations, orphaned footnotes — was corrected against the original PDFs. Where a filename, title, or byline disagreed with the article it named, the PDF settled it.
- **Adding subject metadata.** The archive now carries 3,601 controlled subject headings drawn from [FAST](https://www.oclc.org/research/areas/data-science/fast.html) and [Homosaurus](https://homosaurus.org/), verified term by term. Where no authority record genuinely matched, we left the term off rather than guess, because a wrong authority heading is worse than none.
- **Building the PDFs that never existed.** 103 articles had been published as web pages only, with no PDF of record. Those now have one, generated from the article source through a Pandoc and LuaLaTeX pipeline built for the purpose.
- **Standardizing every PDF.** All 795 archive PDFs now open with a JCRT cover sheet carrying the title, authors, stable URL, publisher, ISSN, and rights statement, with matching embedded metadata and PDF bookmarks. To be plain about the limits: this does not make a 2003 scan conformant with modern accessibility standards. Many of our oldest files are page images, and no amount of metadata turns an image into text. Improving them is a separate, slower project.
- **Fixing our own identity.** Our OAI-PMH endpoint had been identifying the repository as a person rather than as a journal. It now identifies itself correctly as the Journal for Cultural and Religious Theory.

## Where the archive can now be found

Alongside the deposits, the archive publishes structured metadata in the formats that discovery systems actually consume: OAI-PMH for harvesters, a DOAJ feed, Schema.org metadata on every article page, and RIS and CSL JSON citation files for all 829 archive articles and 373 Religious Theory posts. Article pages are marked up so that Zotero recognizes them as journal articles rather than as generic web pages, with correct authors, pagination, and journal title.

The practical effect is that JCRT scholarship is now legible to citation managers, indexes, and library systems without anyone retyping anything.

## What comes next

**ORCID iDs for our authors.** We have 648 author profiles in the archive. 38 currently carry an ORCID iD. Connecting the rest is the next phase, and it is slower work than DOIs were, because it cannot be automated safely — matching a person to an identifier on the basis of a name alone is how records get corrupted. We are working through them with evidence, in reviewed batches, and some authors will simply not have an ORCID record to connect. If you have an ORCID iD and want it on your JCRT profile, [tell us](/contact/) and we will add it immediately, which is by far the fastest path.

**A decision about the rest of the site.** The 829 articles above are the formal, numbered journal archive. Religious Theory posts and journal announcements are a different kind of publication, and whether they warrant repository deposits and DOIs is an editorial question we have not yet settled.

Our aim, stated plainly: every published JCRT work has a DOI, and every JCRT author who has an ORCID iD is connected to it. The first half is now true.
