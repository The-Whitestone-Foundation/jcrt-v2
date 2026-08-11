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

## EBSCO
contact ebsco have link to pages or pdfs

## increase incoming links

## CHANGELOG
~~1. check author pages especially mine prove they are working~~

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
