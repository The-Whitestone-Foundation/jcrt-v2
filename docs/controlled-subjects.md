# Controlled subject metadata

Article front matter stores controlled terms in `subjects`. Each entry records a
label, vocabulary scheme, identifier, canonical URI, and FAST authority
category. Existing `keywords`, `categories`, and `tags` remain the editorial
source terms.

Generate archive subjects first, then Religious Theory subjects:

```sh
npm run subjects:archives
npm run subjects:theory
```

The generator reads the local FAST MARCXML and Homosaurus JSON-LD datasets from
`../FAST_Dataset_Download`. Matching is deliberately conservative: normalized
exact preferred labels beat alternate labels, FAST beats Homosaurus, and
unresolved ambiguity is reported instead of guessed. Homosaurus is considered
only when an explicit keyword, category, or non-structural tag matches an
English preferred or alternate label.

Metadata precedence is DataCite, FAIR, FAST, then Homosaurus. DataCite and FAIR
are output models rather than thesauri, so this means existing identifiers and
descriptive fields are preserved; FAST and then Homosaurus enrich their subject
fields without replacing editorial metadata.

Run `npm run subjects:check` in validation workflows. It exits nonzero when
committed front matter differs from deterministic regeneration.
