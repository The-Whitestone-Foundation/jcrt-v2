import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nunjucks from "@11ty/nunjucks";
import filters from "../_config/filters.js";
import theoryData from "../content/religioustheory/posts/posts.11tydata.js";

test("archive and Theory metadata renders calendar and optional DOI in its intended scope", async () => {
  const source = readFileSync(new URL("../_includes/partials/archive_article.njk", import.meta.url), "utf8");
  const setup = source.slice(source.indexOf("{% set urlParts"), source.indexOf('<article class='));
  const meta = source.slice(source.indexOf('<div class="jcrt-action-row jcrt-action-row--meta">'), source.indexOf('</header>'));
  const env = new nunjucks.Environment(null, { autoescape: true });
  const addFilter = (name, fn) => env.addFilter(name, fn);
  filters({ addFilter, addNunjucksFilter: addFilter, addCollection() {} });
  const render = (page, doi) => env.renderString(setup + meta, {
    page, doi, date: new Date("2015-01-01T00:00:00Z"),
    tags: page.url.startsWith('/religioustheory/') ? ['theoryPosts'] : [],
    doiUrl: theoryData.eleventyComputed.doiUrl({ doi }),
    pdfUrl: "/article.pdf", risCitationUrl: "/article.ris", jsonCitationUrl: "/article.json",
  });
  const article = { url: "/archives/15.1/raschke/", inputPath: "./content/archives/15.1/raschke.md" };
  const html = await render(article, "10.17613/p80rm-6cc72");
  assert.match(html, /aria-hidden="true"><use href="#fa-calendar"/);
  assert.match(html, /<\/span>\s*<span aria-hidden="true"> \| <\/span><svg[^>]+><use href="#ai-doi"/);
  assert.match(html, /<a href="https:\/\/doi.org\/10.17613\/p80rm-6cc72">doi.org\/10.17613\/p80rm-6cc72<\/a>/);
  assert.doesNotMatch(html, /bi-calendar3/);
  assert.match(html, /<\/div>\s*<div class="jcrt-action-row">\s*<a href="\/article.pdf"/);
  for (const label of ["Download Article", "Download Citation (RIS)", "Download Citation (JSON)"]) assert.ok(html.includes(label));
  const withoutDoi = await render(article);
  assert.match(withoutDoi, /#fa-calendar/);
  assert.doesNotMatch(withoutDoi, /#ai-doi|doi\.org|\|/);
  const theory = { url: "/religioustheory/example/", inputPath: "./content/religioustheory/posts/example.md" };
  for (const doi of ["10.17613/example", "https://doi.org/10.17613/example", "doi: 10.17613/example"]) {
    const post = await render(theory, doi);
    assert.match(post, /#fa-calendar/);
    assert.match(post, /#ai-doi/);
    assert.match(post, /<a href="https:\/\/doi.org\/10.17613\/example">doi.org\/10.17613\/example<\/a>/);
    assert.match(post, /<\/div>\s*<div class="jcrt-action-row">/);
  }
  for (const doi of [undefined, null, "", "   "]) {
    const post = await render(theory, doi);
    assert.match(post, /#fa-calendar/);
    assert.doesNotMatch(post, /#ai-doi|doi\.org|\|/);
  }
  for (const page of [
    { url: "/archives/15.1/", inputPath: "./content/archives/15.1/index.njk" },
    { ...article, inputPath: "./content/archives/15.1/example.njk" },
  ]) {
    const other = await render(page, "10.17613/example");
    assert.match(other, /bi bi-calendar3/);
    assert.doesNotMatch(other, /#fa-calendar|#ai-doi|doi\.org|\|/);
  }
});
