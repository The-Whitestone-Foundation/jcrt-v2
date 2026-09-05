# Credits

Third-party work that ships in this repository or shaped it. Licenses are quoted as the
upstream projects state them; check the linked sources if you redistribute.

## Icons

Every icon on jcrt.org is an inline SVG symbol in
[`_includes/partials/icon-sprite.njk`](_includes/partials/icon-sprite.njk). No icon font is
loaded. Symbol ids keep a historical `fa-` prefix because content front matter refers to
them; the artwork is not Font Awesome.

- **[Phosphor Icons](https://phosphoricons.com/)** by Helena Zhang and Tobias Fried, regular
  weight. Used for the hamburger (`list`), navigation arrows, the PDF, link and envelope
  glyphs, the social logos (Facebook, Instagram, Mastodon, LinkedIn, YouTube, the butterfly
  for Bluesky), RSS, globe, scales, microphone, bookmark, phone and house.
  License: [MIT](https://github.com/phosphor-icons/core/blob/main/LICENSE).
- **[Academicons](https://jpswalsh.github.io/academicons/)** by James Walsh. Used for the
  ORCID iD glyph on author pages. Glyphs are licensed under the
  [SIL Open Font License 1.1](https://github.com/jpswalsh/academicons/blob/master/LICENSE);
  the accompanying code is MIT.

Earlier versions of the site used [Font Awesome](https://fontawesome.com/) (CC BY 4.0 icons,
SIL OFL 1.1 fonts, MIT code). It has been fully retired.

## Design and typography

- **[Editorial](https://html5up.net/editorial)** by [HTML5 UP](https://html5up.net/) (ajlkn),
  the template the layout descends from. License:
  [Creative Commons Attribution 3.0](https://html5up.net/license). The attribution also
  appears in the site footer.
- **[Modern Font Stacks](https://modernfontstacks.com/)** for the system font stacks
  (Old Style for body copy, Slab Serif for headings). No fonts are downloaded.

## Build

- [Eleventy](https://www.11ty.dev/) (MIT), [Pagefind](https://pagefind.app/) (MIT),
  [Bootstrap](https://getbootstrap.com/) CSS (MIT), [js-yaml](https://github.com/nodeca/js-yaml)
  (MIT), [markdown-it](https://github.com/markdown-it/markdown-it) (MIT),
  [Lightning CSS](https://lightningcss.dev/) (MPL 2.0), [PurgeCSS](https://purgecss.com/) (MIT).
- Build performance audit and recommendations by
  [Brennan Kenneth Brown](https://github.com/brennankbrown).
- The build-speed pattern was inspired by
  [11tybundle.dev](https://github.com/bobmonsour/11tybundle.dev) by Bob Monsour.

## Licenses of this repository

The site's own code is [MIT](LICENSE). Articles are open access under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and authors retain copyright;
article images and PDFs belong to their authors and the Whitestone Foundation.
