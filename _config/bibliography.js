import fs from 'node:fs';
import path from 'node:path';
import { parseFrontMatter, readYaml } from '../scripts/lib/frontmatter.mjs';
import { walkFiles, isMarkdown } from '../scripts/lib/walk.mjs';
import { documentPathFor } from '../scripts/lib/paths.mjs';
import { splitAuthors, authorSlug } from './authorSlug.js';
import { stripMarkdown } from './markdownTitle.js';

export const JOURNAL = 'Journal for Cultural & Religious Theory';
export const ISSN = '1530-5228';
export const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
export const plain = value => stripMarkdown(String(value ?? '').replace(/<[^>]*>/g, '')).trim();
export const normalizeDoi = value => String(value ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
export function preciseDate(value) {
  if (value instanceof Date) return Number.isNaN(+value) ? '' : value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?=$|T)/);
  if (!match || (match[2] && (+match[2] < 1 || +match[2] > 12))) return '';
  if (match[3]) {
    const date = new Date(`${match[0]}T00:00:00Z`);
    if (Number.isNaN(+date) || date.toISOString().slice(0, 10) !== match[0]) return '';
  }
  return match[0];
}
export function parsePageRange(value) {
  const match = String(value ?? '').trim().match(/^(\d+|[ivxlcdm]+)(?:\s*[-–—]\s*(\d+|[ivxlcdm]+))?$/i);
  return match ? { start: match[1], end: match[2] || match[1] } : { start: '', end: '' };
}
const list = value => (Array.isArray(value) ? value : String(value || '').split(/[,;]/)).map(plain).filter(Boolean);
const absolute = (value, base) => value ? new URL(value, base).href : '';

export function makeRecord(data, issueData, context) {
  const { url, archive, body = '', authors = {}, baseUrl, filesUrl } = context;
  const volume = String(data.volume || (archive && issueData.volume) || '');
  const issue = String(data.issue || (archive && issueData.issue) || '');
  const names = [...new Set(splitAuthors(data.author || data.authors))];
  const creators = names.map(name => {
    const author = authors[authorSlug(name)] || {};
    const given = plain(author.given_name), family = plain(author.family_name), suffix = plain(author.name_suffix);
    const collective = author.collective === true || /^(?:editors?|jcrt editors|religious theory editors|whitestone publications)$/i.test(name);
    return { name, given, family, suffix, collective, citation: given && family && !collective ? `${family}, ${[given, suffix].filter(Boolean).join(' ')}` : name,
      url: author.url || '', affiliation: plain(data.affiliation || data.affilation || author.affiliation) };
  });
  const publicationDate = preciseDate(data.publication_date || data.date || issueData.date || data.year || issueData.year);
  const coverDate = plain(data.cover_date || issueData.cover_date || [data.season || issueData.season, data.year || issueData.year].filter(Boolean).join(' '));
  const pdf = typeof data.pdf === 'string' ? data.pdf.trim() : '';
  const pdfBase = archive ? absolute(url, filesUrl) : `${filesUrl}/religioustheory/`;
  const pdfUrl = pdf ? absolute(pdf, archive ? pdfBase.replace(/[^/]+\/$/, '') : pdfBase) : '';
  const keywords = [...new Set([...list(data.keywords), ...(!archive ? [...list(data.tags), ...list(data.categories)] : [])])]
    .filter(k => !['theoryposts', 'archives', 'posts', 'nav', 'all', 'authors'].includes(k.toLowerCase()));
  return { url: absolute(url, baseUrl), path: url, archive, article: true, title: plain(data.title), creators,
    publication: archive ? JOURNAL : 'JCRT - Religious Theory Blog', publisher: 'Whitestone Publications',
    issn: archive ? ISSN : plain(data.issn), volume, issue, publicationDate, coverDate,
    pages: parsePageRange(data.pages), abstract: plain(data.bibliographic_abstract || data.abstract), description: plain(data.description), keywords,
    language: plain(data.language || data.lang) || 'en', nanoid: plain(data.nanoid), doi: normalizeDoi(data.doi), pdfUrl,
    // Explicit opt-in for archive full text: many substantial Markdown bodies are only summaries.
    fulltext: data.html_fulltext === true || (!archive && !!body.trim()),
  };
}

export function loadBibliography(root = process.cwd()) {
  const meta = readYaml(path.join(root, '_data/metadata.yaml'));
  const baseUrl = String(meta.url || 'https://jcrt.org').replace(/\/$/, '');
  const filesUrl = String(meta.files_url || baseUrl).replace(/\/$/, '');
  const authors = {};
  for (const file of walkFiles(path.join(root, 'content/authors'), { match: isMarkdown })) {
    const { data } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
    const entry = { ...data, url: `${baseUrl}/authors/${path.basename(file, '.md')}/` };
    for (const name of [data.name, data.title, path.basename(file, '.md')]) if (name) authors[authorSlug(name)] = entry;
  }
  const issues = {}, records = {};
  for (const file of walkFiles(path.join(root, 'content/archives'), { match: name => name === 'index.njk' })) {
    const slug = path.basename(path.dirname(file)); if (!/^\d+\.\d+$/.test(slug)) continue;
    const { data } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
    issues[slug] = { ...data, url: `${baseUrl}/archives/${slug}/` };
  }
  for (const directory of ['archives', 'religioustheory/posts', 'religioustheory/live']) {
    for (const file of walkFiles(path.join(root, 'content', directory), { match: isMarkdown })) {
      const { data, body } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
      const rel = path.relative(path.join(root, 'content'), file);
      const url = documentPathFor(rel, data); if (!url) continue;
      const archive = directory === 'archives';
      const issueData = archive ? issues[rel.split('/')[1]] || {} : {};
      records[url] = makeRecord(data, issueData, { url, archive, body, authors, baseUrl, filesUrl });
    }
  }
  return { baseUrl, records, issues };
}

export function bibliographyPage(index, page, collections = {}, title = '') {
  if (!index || !page?.url) return null;
  const record = index.records[page.url];
  if (record) return { ...record, schema: articleSchema(record, index.baseUrl) };
  const issueSlug = page.url.match(/^\/archives\/(\d+\.\d+)\/$/)?.[1];
  const archiveIndex = /^\/archives\/(?:\d+\/)?$/.test(page.url);
  const theoryIndex = /^\/religioustheory\/(?:posts\/|posts\/page\/\d+\/)?$/.test(page.url);
  if (!issueSlug && !archiveIndex && !theoryIndex) return null;
  const data = index.issues[issueSlug] || {};
  const url = absolute(page.url, index.baseUrl);
  const bib = { article: false, url, title: plain(data.title || title) || (theoryIndex ? 'Religious Theory Posts' : 'Journal Archives'), language: 'en', publisher: 'Whitestone Publications',
    publication: theoryIndex ? 'JCRT - Religious Theory Blog' : JOURNAL, issn: theoryIndex ? '' : ISSN,
    publicationDate: preciseDate(data.date || data.year), coverDate: plain(data.cover_date || [data.season, data.year].filter(Boolean).join(' ')),
    volume: data.volume, issue: data.issue, description: plain(data.description), keywords: list(data.keywords) };
  let mainEntity;
  if (issueSlug) {
    const key = String(page.inputPath).replace(/index\.(?:njk|md)$/, '');
    const entries = collections.archiveArticlesByIssue?.[key]?.toc || [];
    mainEntity = { '@type': 'PublicationIssue', '@id': `${url}#issue`, name: bib.title, url,
      issueNumber: String(data.issue), isPartOf: { '@type': 'PublicationVolume', volumeNumber: String(data.volume), isPartOf: periodical(index.baseUrl) },
      hasPart: entries.map(entry => ({ '@id': `${absolute(entry.url, index.baseUrl)}#${index.records[entry.url] ? 'article' : 'webpage'}`, url: absolute(entry.url, index.baseUrl), name: plain(entry.data.title) })) };
    if (bib.publicationDate) mainEntity.datePublished = bib.publicationDate;
    if (bib.coverDate) mainEntity.temporalCoverage = bib.coverDate;
  } else {
    const entries = archiveIndex ? Object.values(index.issues).sort((a,b) => Number(b.volume)-Number(a.volume) || Number(b.issue)-Number(a.issue))
      : (collections.theoryPosts || []).map(e => ({ url: absolute(e.url, index.baseUrl), title: plain(e.data.title) }));
    mainEntity = { '@type': 'ItemList', itemListElement: entries.map((e,i) => ({ '@type': 'ListItem', position: i+1, item: { '@id': e.url + (archiveIndex ? '#issue' : '#article'), url: e.url, name: plain(e.title) } })) };
  }
  bib.schema = { '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: bib.title, inLanguage: bib.language,
    publisher: { '@type': 'Organization', name: bib.publisher },
    mainEntity, isPartOf: theoryIndex ? { '@type': 'Blog', '@id': `${index.baseUrl}/religioustheory/#blog`, name: bib.publication } : periodical(index.baseUrl) };
  if (bib.description) bib.schema.description = bib.description;
  if (bib.keywords.length) bib.schema.keywords = bib.keywords;
  return bib;
}
function periodical(baseUrl) {
  return { '@type': 'Periodical', '@id': `${baseUrl}/#journal`, name: JOURNAL, issn: ISSN };
}
export function articleSchema(bib, baseUrl) {
  const node = { '@type': bib.archive ? 'ScholarlyArticle' : 'BlogPosting', '@id': `${bib.url}#article`, url: bib.url,
    name: bib.title, headline: bib.title, inLanguage: bib.language, mainEntityOfPage: { '@id': `${bib.url}#webpage` },
    publisher: { '@type': 'Organization', name: bib.publisher },
    author: bib.creators.map(a => ({ '@type': a.collective ? 'Organization' : 'Person', name: a.name,
      ...(a.given && !a.collective ? { givenName: a.given } : {}), ...(a.family && !a.collective ? { familyName: a.family } : {}),
      ...(a.suffix && !a.collective ? { honorificSuffix: a.suffix } : {}),
      ...(a.url ? { url: a.url } : {}), ...(a.affiliation ? { affiliation: { '@type': 'Organization', name: a.affiliation } } : {}) })),
    isPartOf: bib.archive ? { '@type': 'PublicationIssue', '@id': `${new URL('../', bib.url).href}#issue`, issueNumber: bib.issue,
      isPartOf: { '@type': 'PublicationVolume', volumeNumber: bib.volume, isPartOf: periodical(baseUrl) } }
      : { '@type': 'Blog', '@id': `${baseUrl}/religioustheory/#blog`, name: bib.publication },
  };
  if (bib.publicationDate) node.datePublished = bib.publicationDate;
  if (bib.coverDate) node.temporalCoverage = bib.coverDate;
  if (bib.abstract) node.abstract = bib.abstract;
  if (bib.description || bib.abstract) node.description = bib.description || bib.abstract;
  if (bib.keywords.length) node.keywords = bib.keywords;
  if (bib.pages.start) { node.pageStart = bib.pages.start; node.pageEnd = bib.pages.end; }
  const identifiers = [];
  if (bib.nanoid) identifiers.push({ '@type': 'PropertyValue', propertyID: 'nanoid', value: bib.nanoid });
  if (bib.doi) { identifiers.push({ '@type': 'PropertyValue', propertyID: 'DOI', value: bib.doi, url: `https://doi.org/${bib.doi}` }); node.sameAs = `https://doi.org/${bib.doi}`; }
  if (identifiers.length) node.identifier = identifiers;
  if (bib.pdfUrl) node.encoding = { '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: bib.pdfUrl };
  return node;
}
