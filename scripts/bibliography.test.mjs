import assert from 'node:assert/strict';
import test from 'node:test';
import nunjucks from '@11ty/nunjucks';
import { makeRecord, parsePageRange, preciseDate, normalizeDoi, bibliographyPage, articleSchema, jsonLd } from '../_config/bibliography.js';

test('bibliographic facts retain precision, author identity, and HTML/PDF separation', async () => {
  for (const [value, start, end] of [['1', '1', '1'], ['10—21', '10', '21'], ['iv–xii', 'iv', 'xii'], ['12-15','12','15'], ['', '', '']]) {
    assert.deepEqual(parsePageRange(value), { start, end });
  }
  for (const date of ['1999', '1999-06', '1999-06-15']) assert.equal(preciseDate(date), date);
  assert.equal(preciseDate(undefined), '');
  assert.equal(preciseDate('2026-02-30'), '');
  assert.equal(preciseDate('2026-13'), '');
  assert.equal(JSON.parse(jsonLd({ name: '</script>' })).name, '</script>');
  assert.ok(!jsonLd({ name: '</script>' }).includes('<'));
  assert.equal(normalizeDoi(' https://dx.doi.org/10.1234/example '), '10.1234/example');
  const data = { title: 'An *article* & its title', author: 'Hent de Vries; Editors', doi: 'doi: 10.1234/example',
    nanoid: 'ABC123', pages: 'iv–xii', pdf: 'example.pdf', abstract: 'Full abstract. '.repeat(80), keywords: ['ethics', 'religion'] };
  const context = { url: '/archives/25.2/example/', archive: true, baseUrl: 'https://jcrt.org', filesUrl: 'https://files.jcrt.org',
    authors: { 'hent-vries': { given_name: 'Hent', family_name: 'de Vries' } } };
  const bib = makeRecord(data, { volume: 25, issue: 2, year: 2026, season: 'Summer' }, context);
  assert.equal(bib.publicationDate, '2026');
  assert.equal(bib.pdfUrl, 'https://files.jcrt.org/archives/25.2/example.pdf');
  assert.equal(bib.creators[0].citation, 'de Vries, Hent');
  assert.equal(bib.creators[1].collective, true);
  const schema = articleSchema(bib, context.baseUrl);
  assert.equal(schema.author[0].familyName, 'de Vries');
  assert.equal(schema.author[1]['@type'], 'Organization');
  assert.equal(schema.abstract, data.abstract.trim());
  assert.deepEqual(schema.identifier.map(i => i.propertyID), ['nanoid', 'DOI']);
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('_includes'), { autoescape: true });
  const html = await env.render('partials/bibliographic-meta.njk', { bib });
  assert.match(html, /citation_abstract_html_url" content="https:\/\/jcrt.org\/archives\/25.2\/example\//);
  assert.doesNotMatch(html, /citation_fulltext_html_url/);
  assert.equal((html.match(/property="dc:creator"/g) || []).length, 2);
  assert.ok(html.includes(data.abstract.trim()));
  const theory = makeRecord({ title: 'A post', author: 'Writer', date: '2026-08-18' }, {}, { ...context, archive: false, url: '/religioustheory/posts/example/', body: 'Full post' });
  const post = await env.render('partials/bibliographic-meta.njk', { bib: theory });
  assert.match(post, /blogPost/);
  assert.match(post, /citation_fulltext_html_url/);
  assert.doesNotMatch(post, /citation_doi|citation_pdf_url|citation_volume|citation_issue|citation_issn/);
  const index = { baseUrl: context.baseUrl, records: {}, issues: { '25.2': { volume:25, issue:2, year:2026, title:'Issue', url:'https://jcrt.org/archives/25.2/' } } };
  const issue = bibliographyPage(index, { url:'/archives/25.2/', inputPath:'./content/archives/25.2/index.njk' },
    { archiveArticlesByIssue: { './content/archives/25.2/': { toc: [{ url:context.url, data }] } } });
  const issueHtml = await env.render('partials/bibliographic-meta.njk', { bib: issue });
  assert.doesNotMatch(issueHtml, /citation_author|citation_title|zotero:itemType/);
  assert.equal(issue.schema.mainEntity.hasPart[0].url, bib.url);
  assert.equal(issue.schema.mainEntity.isPartOf.volumeNumber, '25');
});
