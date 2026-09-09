#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import nunjucks from '@11ty/nunjucks';
import { loadBibliography } from '../_config/bibliography.js';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.split('=');
  return [key, rest.join('=')];
}));
const translatorPath = args.get('--translator');
if (!translatorPath) {
  console.error('usage: node scripts/check-zotero-import-shape.mjs --translator=/path/to/Embedded\\ Metadata.js');
  process.exit(2);
}

const require = createRequire(import.meta.url);
globalThis.Zotero = { Prefs: null };
const utilitiesPath = args.get('--utilities')
  || '/Applications/Zotero.app/Contents/PlugIns/ZoteroSafariExtension.appex/Contents/Resources/safari/utilities/utilities.js';
const typeSchemaPath = args.get('--schema')
  || '/Applications/Zotero.app/Contents/PlugIns/ZoteroSafariExtension.appex/Contents/Resources/safari/utilities/resource/zoteroTypeSchemaData.js';
const U = require(utilitiesPath);
const schema = require(typeSchemaPath);
delete globalThis.Zotero;

const itemTypeId = Object.fromEntries(Object.entries(schema.itemTypes).map(([id, item]) => [item[0], id]));
const fieldId = Object.fromEntries(Object.entries(schema.fields).map(([id, field]) => [field[0], id]));
const fieldIsValidForType = (field, type) => (schema.itemTypes[itemTypeId[type]]?.[3] || []).includes(Number(fieldId[field]));
const local = value => JSON.parse(JSON.stringify(value));

class MetaNode {
  constructor(attrs) {
    this.attrs = attrs;
    this.content = attrs.content;
    this.textContent = attrs.content;
    this.nodeValue = attrs.content;
  }
  getAttribute(name) { return this.attrs[name] || ''; }
}

const decode = value => value
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const metaAttrs = html => [...html.matchAll(/<meta\b([^>]*)>/gi)].map(match => Object.fromEntries(
  [...match[1].matchAll(/([^\s=/>]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)])
));
const metaValue = (metas, key) => metas.find(meta => (meta.name || meta.property) === key)?.content || '';

function documentFor(html, url) {
  const metas = metaAttrs(html).map(attrs => new MetaNode(attrs));
  const byName = name => metas.filter(meta => meta.attrs.name?.endsWith(name));
  return {
    metas,
    title: '',
    location: new URL(url),
    documentElement: { getAttribute: () => '' },
    head: { getAttribute: () => '' },
    getElementsByTagName: () => [],
    querySelectorAll(selector) {
      const match = selector.match(/meta\[name(?:\$)?="([^"]+)"/i);
      return match ? byName(match[1]) : [];
    },
  };
}

function xpath(doc, expression) {
  const name = expression.match(/\)="([^"]+)"\]/)?.[1] || expression.match(/@name="([^"]+)"/)?.[1];
  return name ? doc.metas.filter(meta => meta.attrs.name?.endsWith(name)) : [];
}

function loadTranslatorApi(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/^\s*\{[\s\S]*?\}\s*\/\*/, '/*');
  const sandbox = {
    console,
    Zotero: { parentTranslator: false },
    Z: { debug() {} },
    ZU: {
      ...U,
      fieldIsValidForType,
      xpath,
      xpathText: () => '',
      resolveURL: null,
      strToISO: U.strToISO || (value => value),
    },
    attr: (doc, selector, name) => doc.querySelectorAll(selector)[0]?.[name] || '',
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__jcrt = { addHighwireMetadata, finalDataCleanup };`, sandbox, { filename: file });
  return sandbox.__jcrt;
}

const zotero = loadTranslatorApi(translatorPath);
const index = loadBibliography(new URL('..', import.meta.url).pathname);
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('_includes'), { autoescape: true });

async function imported(route) {
  const bib = index.records[route];
  assert.ok(bib, `missing source record ${route}`);
  const html = await env.render('partials/bibliographic-meta.njk', { bib });
  const metas = metaAttrs(html);
  const itemType = metaValue(metas, 'zotero:itemType') || (metaValue(metas, 'citation_journal_title') ? 'journalArticle' : 'webpage');
  const item = { itemType, creators: [], tags: [], attachments: [], complete() {} };
  zotero.addHighwireMetadata(documentFor(html, bib.url), item, itemType === 'journalArticle' ? itemType : undefined);
  zotero.finalDataCleanup(documentFor(html, bib.url), item);
  return { route, item, raw: Object.fromEntries(['citation_author', 'citation_doi', 'citation_keywords', 'citation_pdf_url', 'citation_fulltext_html_url', 'citation_abstract_html_url'].map(key => [key, metas.filter(meta => meta.name === key).map(meta => meta.content)])) };
}

const archive = await imported('/archives/15.1/raschke/');
assert.equal(archive.item.itemType, 'journalArticle');
assert.equal(archive.item.DOI, '10.17613/p80rm-6cc72');
assert.equal(archive.item.url, 'https://jcrt.org/archives/15.1/raschke/');
assert.equal(archive.item.attachments[0].url, 'https://files.jcrt.org/archives/15.1/raschke.pdf');
assert.equal(archive.item.publicationTitle, 'Journal for Cultural & Religious Theory');
assert.equal(archive.item.ISSN, '1530-5228');

const multi = await imported('/archives/01.1/lambert/');
assert.deepEqual(local(multi.item.creators.map(author => `${author.lastName}, ${author.firstName}`)), ['Lambert, Gregg', 'Sicre, Jorge']);
assert.equal(multi.item.pages, '2-13');

const theoryDoi = await imported('/religioustheory/posts/9780593493205/');
assert.equal(theoryDoi.item.itemType, 'blogPost');
assert.equal(theoryDoi.item.DOI, '10.17613/wp4v1-zde78');
assert.equal(theoryDoi.item.extra, 'DOI: 10.17613/wp4v1-zde78');
assert.equal(theoryDoi.item.url, 'https://jcrt.org/religioustheory/posts/9780593493205/');
assert.equal(theoryDoi.item.attachments[0].url, 'https://files.jcrt.org/religioustheory/9780593493205.pdf');
assert.deepEqual(local(theoryDoi.item.tags), []);

const theoryNoDoi = await imported('/religioustheory/posts/760/');
assert.equal(theoryNoDoi.item.itemType, 'blogPost');
assert.equal(theoryNoDoi.item.DOI || '', '');
assert.equal(theoryNoDoi.item.extra || '', '');
assert.equal(theoryNoDoi.item.attachments[0].title, 'Snapshot');

const suffixes = await Promise.all(['/archives/14.2/mulder/', '/archives/19.1/cobb/', '/archives/20.1/willis/'].map(imported));
assert.deepEqual(local(suffixes.map(result => result.item.creators[0])), [
  { firstName: 'Jack Jr', lastName: 'Mulder', creatorType: 'author' },
  { firstName: 'John B. Jr', lastName: 'Cobb', creatorType: 'author' },
  { firstName: 'James E. III', lastName: 'Willis', creatorType: 'author' },
]);

console.log(JSON.stringify({ archive, multi, theoryDoi, theoryNoDoi, suffixes }, null, 2));
