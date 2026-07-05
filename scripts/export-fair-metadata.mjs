#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(process.cwd());
const TARGET_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(ROOT, "..", "jcrt-files");
const OUT_ROOT = path.join(TARGET_ROOT, "metadata");
const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const THEORY_DIR = path.join(ROOT, "content", "religioustheory", "posts");
const metadata = yaml.load(fs.readFileSync(path.join(ROOT, "_data", "metadata.yaml"), "utf8")) || {};
const SITE_URL = String(metadata.url || "https://jcrt.org").replace(/\/+$/, "");
const FILES_URL = String(metadata.files_url || "https://files.jcrt.org").replace(/\/+$/, "");
const PUBLISHER = metadata.publisher || "Whitestone Publications";
const ISSN = "1530-5228";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function parseFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return { data: {}, body: raw };
  return {
    data: yaml.load(match[1]) || {},
    body: raw.slice(match[0].length),
  };
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[#*_`>{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraph(body) {
  return cleanText(String(body || "").split(/\n\s*\n/).find((part) => cleanText(part)) || "");
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function splitAuthors(value) {
  if (Array.isArray(value)) return value.flatMap(splitAuthors);
  return String(value || "")
    .split(/\s*;\s*|\s+and\s+|,\s+(?=[A-Z][^,]+$)/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ "@type": "Person", name }));
}

function dateOnly(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function absoluteUrl(value) {
  if (!value) return "";
  const text = String(value);
  if (/^https?:\/\//i.test(text)) return text;
  return `${SITE_URL}/${text.replace(/^\/+/, "")}`;
}

function archivePdfUrl(issue, slug, data) {
  if (!data.pdf) return "";
  const fileName = typeof data.pdf === "string" ? data.pdf.trim() : `${slug}.pdf`;
  if (!fileName) return "";
  if (/^https?:\/\//i.test(fileName)) return fileName;
  return `${FILES_URL}/archives/${issue}/${fileName.replace(/^\/+/, "")}`;
}

function writeJson(relativeDir, schema) {
  const outDir = path.join(OUT_ROOT, relativeDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "metadata.json"), `${JSON.stringify(schema, null, 2)}\n`);
}

function baseSchema({ type, url, title, description, date, image, authors, citations }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}#article`,
    name: title,
    headline: title,
    description,
    url,
    inLanguage: metadata.language || "en",
    datePublished: date,
    dateModified: date,
    image: image ? absoluteUrl(image) : `${FILES_URL}/images/jcrt-open-graph.webp`,
    author: authors.length ? authors : [{ "@type": "Organization", name: "JCRT" }],
    publisher: {
      "@type": "Organization",
      name: PUBLISHER,
      url: "https://thewhitestonefoundation.org/",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  };
  if (citations) schema.citation = citations;
  return schema;
}

function exportArchives() {
  let count = 0;
  for (const filePath of walk(ARCHIVES_DIR).filter((file) => file.endsWith(".md"))) {
    const slug = normalizeSlug(path.basename(filePath, ".md"));
    if (!slug || slug === "index") continue;
    const issue = path.basename(path.dirname(filePath));
    const { data, body } = parseFrontMatter(filePath);
    const url = `${SITE_URL}/archives/${issue}/${slug}/`;
    const description = cleanText(data.description || data.abstract || firstParagraph(body)).slice(0, 500);
    const date = dateOnly(data.date || data.year);
    const authors = splitAuthors(data.author || data.authors);
    const pdfUrl = archivePdfUrl(issue, slug, data);
    const schema = {
      ...baseSchema({
        type: "ScholarlyArticle",
        url,
        title: data.title || slug,
        description,
        date,
        image: data.image,
        authors,
        citations: data.citations,
      }),
      abstract: description,
      isPartOf: {
        "@type": "Periodical",
        name: "The Journal for Cultural and Religious Theory",
        url: SITE_URL,
        issn: ISSN,
      },
      identifier: data.doi || data.nanoid || url,
    };
    if (data.volume) schema.volumeNumber = String(data.volume);
    if (data.issue) schema.issueNumber = String(data.issue);
    if (data.pages) schema.pagination = String(data.pages);
    if (pdfUrl) {
      schema.encoding = {
        "@type": "MediaObject",
        encodingFormat: "application/pdf",
        contentUrl: pdfUrl,
      };
    }
    writeJson(`archives/${issue}/${slug}`, schema);
    count += 1;
  }
  return count;
}

function exportTheory() {
  let count = 0;
  for (const filePath of walk(THEORY_DIR).filter((file) => file.endsWith(".md"))) {
    const fileSlug = normalizeSlug(path.basename(filePath, ".md"));
    const { data, body } = parseFrontMatter(filePath);
    const slug = normalizeSlug(data.slug || fileSlug);
    if (!slug) continue;
    const url = `${SITE_URL}/religioustheory/posts/${slug}/`;
    const description = cleanText(data.description || firstParagraph(body)).slice(0, 500);
    const date = dateOnly(data.date);
    const authors = splitAuthors(data.author || data.authors);
    const schema = {
      ...baseSchema({
        type: "BlogPosting",
        url,
        title: data.title || slug,
        description,
        date,
        image: data.image,
        authors,
        citations: data.citations,
      }),
      isPartOf: {
        "@type": "Blog",
        "@id": `${SITE_URL}/religioustheory/`,
        name: "Religious Theory",
        url: `${SITE_URL}/religioustheory/`,
      },
      identifier: data.doi || data.nanoid || url,
    };
    writeJson(`religioustheory/posts/${slug}`, schema);
    count += 1;
  }
  return count;
}

fs.mkdirSync(OUT_ROOT, { recursive: true });
const archiveCount = exportArchives();
const theoryCount = exportTheory();
console.log(`Exported ${archiveCount} archive metadata files and ${theoryCount} Religious Theory metadata files to ${OUT_ROOT}`);
