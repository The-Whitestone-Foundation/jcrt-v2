#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBibliography, plain, preciseDate } from '../_config/bibliography.js';
import { parseFrontMatter } from './lib/frontmatter.mjs';
import { documentPathFor } from './lib/paths.mjs';
import { isMarkdown, walkFiles } from './lib/walk.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const verbose = process.argv.includes('--verbose');
const failures = new Map(), notes = new Map();
const add = (map, rule, route, detail = '') => (map.get(rule) || map.set(rule, []).get(rule)).push(`${route}${detail ? `: ${detail}` : ''}`);
const fail = (rule, route, detail) => add(failures, rule, route, detail);
const note = (rule, route, detail) => add(notes, rule, route, detail);

function decode(value = '') {
  return value.replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi, (_, number, named) => {
    if (number) {
      const hex = number[0].toLowerCase() === 'x';
      return String.fromCodePoint(Number.parseInt(hex ? number.slice(1) : number, hex ? 16 : 10));
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' }[named.toLowerCase()];
  });
}

function attributes(source) {
  const out = {};
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
}

function parseHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const metas = [...html.matchAll(/<meta\b([^>]*)>/gi)].map(match => attributes(match[1]));
  const links = [...html.matchAll(/<link\b([^>]*)>/gi)].map(match => attributes(match[1]));
  const json = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.type?.toLowerCase() !== 'application/ld+json') continue;
    try { json.push(JSON.parse(match[2])); }
    catch (error) { json.push({ error: error.message }); }
  }
  return { html, metas, links, json };
}

const values = (doc, attribute, key) => doc.metas
  .filter(meta => meta[attribute]?.toLowerCase() === key.toLowerCase())
  .map(meta => meta.content ?? '');
const named = (doc, key) => values(doc, 'name', key);
const property = (doc, key) => values(doc, 'property', key);
const hrefs = (doc, rel) => doc.links.filter(link => link.rel?.toLowerCase() === rel).map(link => link.href ?? '');
const same = (actual, expected) => actual.length === expected.length && actual.every((value, i) => value === expected[i]);
const show = value => JSON.stringify(value);

function expectValues(doc, route, kind, key, expected) {
  const actual = kind === 'name' ? named(doc, key) : property(doc, key);
  if (!same(actual, expected)) fail(`${kind}:${key}`, route, `expected ${show(expected)}, received ${show(actual)}`);
}

function graphNodes(doc, route) {
  const nodes = [];
  for (const value of doc.json) {
    if (value.error) fail('json-ld-parse', route, value.error);
    else nodes.push(...(Array.isArray(value?.['@graph']) ? value['@graph'] : [value]));
  }
  if (!doc.json.length) fail('json-ld-missing', route);
  return nodes;
}

function checkNoEmptyTags(doc, route) {
  for (const meta of doc.metas) {
    const key = meta.name || meta.property || '';
    if (/^(?:dc:|dcterms:|citation_|prism\.|zotero:)/i.test(key) && !(meta.content || '').trim()) {
      fail('empty-bibliography-tag', route, key);
    }
  }
}

function readRoute(route) {
  const file = path.join(SITE, route.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(file)) { fail('missing-built-page', route, path.relative(ROOT, file)); return null; }
  const doc = parseHtml(file);
  checkNoEmptyTags(doc, route);
  return doc;
}

function checkArticle(record, metadataOnlyAbstracts) {
  const route = record.path, doc = readRoute(route);
  if (!doc) return;
  expectValues(doc, route, 'property', 'dc:title', [record.title]);
  expectValues(doc, route, 'property', 'dc:type', ['Text']);
  expectValues(doc, route, 'property', 'dc:date', record.publicationDate ? [record.publicationDate] : []);
  expectValues(doc, route, 'property', 'dc:language', [record.language]);
  expectValues(doc, route, 'property', 'dc:publisher', [record.publisher]);
  expectValues(doc, route, 'property', 'dc:source', [record.publication]);
  expectValues(doc, route, 'property', 'dcterms:abstract', record.abstract ? [record.abstract] : []);
  expectValues(doc, route, 'property', 'dc:description', record.abstract || record.description ? [record.abstract || record.description] : []);
  expectValues(doc, route, 'property', 'article:published_time', record.publicationDate ? [record.publicationDate] : []);
  expectValues(doc, route, 'property', 'dc:creator', record.creators.map(author => author.name));
  expectValues(doc, route, 'name', 'citation_author', record.creators.map(author => author.citation));
  expectValues(doc, route, 'name', 'citation_title', [record.title]);
  expectValues(doc, route, 'name', 'citation_publisher', [record.publisher]);
  expectValues(doc, route, 'name', 'citation_language', [record.language]);
  expectValues(doc, route, 'name', 'citation_public_url', [record.url]);
  expectValues(doc, route, 'name', 'citation_fulltext_html_url', record.fulltext ? [record.url] : []);
  expectValues(doc, route, 'name', 'citation_abstract_html_url', record.fulltext ? [] : [record.url]);
  expectValues(doc, route, 'name', 'citation_pdf_url', record.pdfUrl ? [record.pdfUrl] : []);
  expectValues(doc, route, 'name', 'citation_doi', record.doi ? [record.doi] : []);
  expectValues(doc, route, 'name', 'citation_date', record.publicationDate ? [record.publicationDate] : []);
  expectValues(doc, route, 'name', 'citation_publication_date', record.publicationDate ? [record.publicationDate] : []);
  expectValues(doc, route, 'name', 'citation_cover_date', record.coverDate ? [record.coverDate] : []);
  expectValues(doc, route, 'name', 'citation_firstpage', record.pages.start ? [record.pages.start] : []);
  expectValues(doc, route, 'name', 'citation_lastpage', record.pages.end ? [record.pages.end] : []);
  expectValues(doc, route, 'name', 'citation_abstract', record.abstract ? [record.abstract] : []);
  expectValues(doc, route, 'name', 'citation_keywords', record.keywords.length ? [record.keywords.join('; ')] : []);
  expectValues(doc, route, 'name', 'citation_journal_title', record.archive ? [record.publication] : []);
  expectValues(doc, route, 'name', 'citation_issn', record.issn ? [record.issn] : []);
  expectValues(doc, route, 'name', 'citation_volume', record.volume ? [record.volume] : []);
  expectValues(doc, route, 'name', 'citation_issue', record.issue ? [record.issue] : []);
  expectValues(doc, route, 'property', 'dc:identifier', [record.url, ...(record.doi ? [`doi:${record.doi}`] : []), `nanoid:${record.nanoid}`]);
  const subjects = property(doc, 'dc:subject');
  if (!same(subjects.slice(0, record.keywords.length), record.keywords)) fail('dc-keywords', route, `expected prefix ${show(record.keywords)}, received ${show(subjects)}`);

  const citeAs = hrefs(doc, 'cite-as');
  if (!same(citeAs, [record.url])) fail('cite-as-html-url', route, `expected ${record.url}, received ${show(citeAs)}`);
  if ([...named(doc, 'citation_public_url'), ...named(doc, 'citation_fulltext_html_url'), ...named(doc, 'citation_abstract_html_url')].some(url => url === record.pdfUrl)) {
    fail('html-pdf-url-separation', route, record.pdfUrl);
  }
  if (record.doi && (/^(?:doi:|https?:)/i.test(record.doi) || !/^10\.\d{4,9}\/[\S]+$/i.test(record.doi))) {
    fail('doi-normalization', route, record.doi);
  }
  if (record.keywords.some(keyword => ['theoryposts', 'archives', 'posts', 'nav', 'all'].includes(keyword.toLowerCase()))) {
    fail('internal-keyword-leak', route, show(record.keywords));
  }
  if (metadataOnlyAbstracts.has(route)) {
    const { expected, hasVisibleAbstract } = metadataOnlyAbstracts.get(route);
    if (record.abstract !== expected) fail('metadata-only-abstract-source', route, `expected ${show(expected)}, received ${show(record.abstract)}`);
    if (!hasVisibleAbstract && /<section\b[^>]*class="[^"]*\bjcrt-abstract\b/.test(doc.html)) {
      fail('metadata-only-abstract-visible', route);
    }
  }

  const nodes = graphNodes(doc, route);
  const schema = nodes.filter(node => node?.['@id'] === `${record.url}#article`);
  if (schema.length !== 1) { fail('article-json-ld-node', route, `expected 1, received ${schema.length}`); return; }
  const article = schema[0];
  const type = record.archive ? 'ScholarlyArticle' : 'BlogPosting';
  for (const [key, expected] of [['@type', type], ['url', record.url], ['name', record.title], ['headline', record.title], ['inLanguage', record.language]]) {
    if (article[key] !== expected) fail(`json-ld-${key}`, route, `expected ${show(expected)}, received ${show(article[key])}`);
  }
  const authors = Array.isArray(article.author) ? article.author : [];
  if (authors.length !== record.creators.length) fail('json-ld-authors', route, `expected ${record.creators.length}, received ${authors.length}`);
  record.creators.forEach((creator, i) => {
    const author = authors[i] || {};
    const expectedType = creator.collective ? 'Organization' : 'Person';
    if (author.name !== creator.name || author['@type'] !== expectedType || author.givenName !== (creator.given || undefined) || author.familyName !== (creator.family || undefined)) {
      fail('json-ld-structured-author', route, `${show(creator)} received ${show(author)}`);
    }
    if (!creator.collective && (!creator.given || !creator.family)) note('source-author-name-unstructured', route, creator.name);
    if (!creator.collective && creator.given && creator.family) {
      const squash = value => value.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (squash(`${creator.given}${creator.family}`) !== squash(creator.name)) note('source-author-display-differs-from-parts', route, show(creator));
    }
  });
  if (article.abstract !== (record.abstract || undefined)) fail('json-ld-abstract', route, `expected ${show(record.abstract || undefined)}, received ${show(article.abstract)}`);
  if (article.pageStart !== (record.pages.start || undefined) || article.pageEnd !== (record.pages.end || undefined)) fail('json-ld-pages', route);
  const identifiers = Array.isArray(article.identifier) ? article.identifier : article.identifier ? [article.identifier] : [];
  const nanoids = identifiers.filter(item => item?.propertyID === 'nanoid').map(item => item.value);
  const dois = identifiers.filter(item => item?.propertyID === 'DOI');
  if (!same(nanoids, [record.nanoid])) fail('json-ld-nanoid', route, show(nanoids));
  if (record.doi) {
    if (dois.length !== 1 || dois[0].value !== record.doi || dois[0].url !== `https://doi.org/${record.doi}` || article.sameAs !== `https://doi.org/${record.doi}`) fail('json-ld-doi', route);
  } else if (dois.length || article.sameAs?.startsWith('https://doi.org/')) fail('json-ld-unexpected-doi', route);
  const pdfs = (Array.isArray(article.encoding) ? article.encoding : article.encoding ? [article.encoding] : []).filter(item => item?.encodingFormat === 'application/pdf').map(item => item.contentUrl);
  if (!same(pdfs, record.pdfUrl ? [record.pdfUrl] : [])) fail('json-ld-pdf', route, `expected ${show(record.pdfUrl ? [record.pdfUrl] : [])}, received ${show(pdfs)}`);
}

function absoluteLinks(fragment, baseUrl) {
  return [...fragment.matchAll(/<a\b([^>]*)>/gi)].map(match => attributes(match[1]).href).filter(Boolean).map(href => new URL(href, baseUrl).href);
}

function checkCollection(route, index) {
  const doc = readRoute(route);
  if (!doc) return;
  const issueSlug = route.match(/^\/archives\/(\d+\.\d+)\/$/)?.[1];
  const expectedTitle = issueSlug ? String(index.issues[issueSlug]?.title || '').trim() : property(doc, 'dc:title')[0];
  expectValues(doc, route, 'property', 'dc:title', [expectedTitle]);
  expectValues(doc, route, 'property', 'dc:type', ['Collection']);
  const issueData = index.issues[issueSlug] || {};
  const expectedDate = issueSlug ? preciseDate(issueData.date || issueData.year) : '';
  expectValues(doc, route, 'property', 'dc:date', expectedDate ? [expectedDate] : []);
  expectValues(doc, route, 'property', 'article:published_time', []);
  for (const key of ['citation_title', 'citation_author']) expectValues(doc, route, 'name', key, []);
  expectValues(doc, route, 'property', 'zotero:itemType', []);
  const nodes = graphNodes(doc, route);
  const pages = nodes.filter(node => node?.['@id'] === `${index.baseUrl}${route}#webpage`);
  if (pages.length !== 1) { fail('collection-json-ld-node', route, `expected 1, received ${pages.length}`); return; }
  const page = pages[0];
  if (page['@type'] !== 'CollectionPage' || page.url !== `${index.baseUrl}${route}` || page.name !== expectedTitle) fail('collection-json-ld-fields', route);
  if (!issueSlug) return;
  const issue = page.mainEntity;
  if (issue?.['@type'] !== 'PublicationIssue' || String(issue.issueNumber) !== String(index.issues[issueSlug].issue) || String(issue.isPartOf?.volumeNumber) !== String(index.issues[issueSlug].volume)) {
    fail('issue-json-ld-fields', route);
  }
  const schemaUrls = (Array.isArray(issue?.hasPart) ? issue.hasPart : []).map(item => item.url);
  const toc = doc.html.match(/<section\b[^>]*class="[^"]*\bissue-toc\b[^"]*"[^>]*>([\s\S]*?)<\/section>/i)?.[1] || '';
  const visibleUrls = absoluteLinks(toc, index.baseUrl).filter(url => url.startsWith(`${index.baseUrl}/archives/${issueSlug}/`));
  if (!same(schemaUrls, visibleUrls)) fail('issue-json-ld-toc-order', route, `schema ${schemaUrls.length}, visible ${visibleUrls.length}`);
  const recordUrls = Object.values(index.records).filter(record => record.archive && record.path.startsWith(`/archives/${issueSlug}/`)).map(record => record.url);
  for (const url of visibleUrls.filter(url => !recordUrls.includes(url))) note('toc-page-excluded-from-bibliography', route, url);
  for (const url of recordUrls.filter(url => !visibleUrls.includes(url))) fail('bibliography-record-missing-from-toc', route, url);
}

function report(map, heading) {
  if (!map.size) return;
  console.log(`\n${heading}:`);
  for (const [rule, items] of [...map].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`- ${rule}: ${items.length}`);
    for (const item of items.slice(0, verbose ? items.length : 5)) console.log(`  ${item}`);
    if (!verbose && items.length > 5) console.log(`  ... ${items.length - 5} more (use --verbose)`);
  }
}

if (!fs.existsSync(SITE)) {
  console.error('check-bibliography: _site is missing; build Eleventy first.');
  process.exit(1);
}

const index = loadBibliography(ROOT);
const metadataOnlyAbstracts = new Map();
for (const file of walkFiles(path.join(ROOT, 'content', 'archives'), { match: isMarkdown })) {
  const { data } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  if (!data.bibliographic_abstract) continue;
  const route = documentPathFor(path.relative(path.join(ROOT, 'content'), file), data);
  const expected = plain(data.bibliographic_abstract);
  if (route) metadataOnlyAbstracts.set(route, { expected, hasVisibleAbstract: Boolean(data.abstract) });
}
for (const record of Object.values(index.records)) checkArticle(record, metadataOnlyAbstracts);
const builtRoutes = walkFiles(SITE, { match: name => name === 'index.html' }).map(file => {
  const rel = path.relative(SITE, path.dirname(file)).split(path.sep).join('/');
  return `/${rel ? `${rel}/` : ''}`;
});
const collectionRoutes = builtRoutes.filter(route => route === '/archives/' || /^\/archives\/(?:\d+|\d+\.\d+)\/$/.test(route) || /^\/religioustheory\/(?:$|(?:posts|live)\/$|(?:posts|live)\/page\/\d+\/$)/.test(route));
for (const route of collectionRoutes) checkCollection(route, index);

for (const route of builtRoutes.filter(route => /^\/archives\/\d+\.\d+\/[^/]+\/$/.test(route) || /^\/religioustheory\/(?:posts|live)\/[^/]+\/$/.test(route))) {
  if (!index.records[route]) note('built-page-excluded-from-bibliography', route);
}
for (const record of Object.values(index.records)) {
  if (record.archive && !record.abstract) note('source-archive-abstract-missing', record.path);
  if (!record.title || !record.creators.length || !record.nanoid) fail('source-required-fields', record.path, `title=${show(record.title)} creators=${record.creators.length} nanoid=${show(record.nanoid)}`);
}

report(notes, 'Coverage notes');
report(failures, 'Failures');
const total = Object.values(index.records).length;
const summary = `${total} articles/posts and ${collectionRoutes.length} collection pages audited`;
if (failures.size) {
  console.error(`\ncheck-bibliography: failed (${[...failures.values()].reduce((sum, items) => sum + items.length, 0)} findings; ${summary}).`);
  process.exit(1);
}
console.log(`\ncheck-bibliography: passed (${summary}).`);
