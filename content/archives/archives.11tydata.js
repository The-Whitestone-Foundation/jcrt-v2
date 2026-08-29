import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const issueMetaCache = new Map();

let _filesUrl;
function getFilesUrl() {
  if (_filesUrl !== undefined) return _filesUrl;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "_data", "metadata.yaml"), "utf8");
    const parsed = yaml.load(raw);
    _filesUrl = String(parsed?.files_url || "").trim().replace(/\/+$/, "") || "";
  } catch { _filesUrl = ""; }
  return _filesUrl;
}

function readIssueMetadata(issue) {
  if (!issue) return null;
  if (issueMetaCache.has(issue)) return issueMetaCache.get(issue);

  const issueIndexPath = path.join(process.cwd(), "content", "archives", issue, "index.njk");
  if (!fs.existsSync(issueIndexPath)) {
    issueMetaCache.set(issue, null);
    return null;
  }

  const src = fs.readFileSync(issueIndexPath, "utf8");
  const yearMatch = src.match(/^\s*year:\s*['"]?(\d{4})['"]?\s*$/m);
  const seasonMatch = src.match(/^\s*season:\s*['"]?(.+?)['"]?\s*$/m);
  const volumeMatch = src.match(/^\s*volume:\s*['"]?(.+?)['"]?\s*$/m);
  const issueMatch = src.match(/^\s*issue:\s*['"]?(.+?)['"]?\s*$/m);

  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const meta = {
    year: Number.isFinite(year) ? year : null,
    season: seasonMatch ? seasonMatch[1].trim() : null,
    volume: volumeMatch ? volumeMatch[1].trim() : null,
    issue: issueMatch ? issueMatch[1].trim() : null
  };
  issueMetaCache.set(issue, meta);
  return meta;
}

function getIssueFromData(data) {
  const stem = String(data?.page?.filePathStem || "");
  const parts = stem.split("/");
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

function archivePdfUrl(data) {
  const slug = data?.page?.fileSlug;
  if (!slug || slug === "index") return null;
  const rawPdf = data?.pdf;
  if (typeof rawPdf === "string" && rawPdf.trim() === "") return null;
  if (rawPdf === false || rawPdf === null) return null;
  if (typeof rawPdf !== "string") return null;
  const fileName = rawPdf.trim();
  const folder = data.page.filePathStem.substring(0, data.page.filePathStem.lastIndexOf('/'));
  return `${getFilesUrl()}${folder}/${fileName}`;
}

export default {
  title: "Journal for Cultural and Religious Theory",
  layout: "archive-post.njk",
  eleventyComputed: {
    canonical_url: (data) => data?.html_canonical ? data?.page?.url : archivePdfUrl(data) || data?.page?.url || null,
    date: (data) => {
      if (data?.date) return data.date;
      const directYear = Number.parseInt(data?.year, 10);
      if (Number.isFinite(directYear) && directYear > 0) return `${directYear}-01-01`;

      const issue = getIssueFromData(data);
      const issueMeta = readIssueMetadata(issue);
      if (Number.isFinite(issueMeta?.year) && issueMeta.year > 0) return `${issueMeta.year}-01-01`;

      return data?.page?.date || null;
    },
    season: (data) => {
      if (data?.season) return data.season;
      const issue = getIssueFromData(data);
      const issueMeta = readIssueMetadata(issue);
      return issueMeta?.season || null;
    },
    volume: (data) => {
      if (data?.volume) return data.volume;
      const issue = getIssueFromData(data);
      const issueMeta = readIssueMetadata(issue);
      return issueMeta?.volume || null;
    },
    issue: (data) => {
      if (data?.issue) return data.issue;
      const issue = getIssueFromData(data);
      const issueMeta = readIssueMetadata(issue);
      return issueMeta?.issue || null;
    },
    pdfUrl: (data) => {
      return archivePdfUrl(data);
    },
    risCitationUrl: (data) => {
      const slug = data.page.fileSlug;
      if (!slug || slug === "index") return null;
      const issue = (data.page.filePathStem || "").split("/").slice(-2, -1)[0];
      if (!issue) return null;
      return `${getFilesUrl()}/citations/archives/${issue}/${slug}.ris`;
    },
    jsonCitationUrl: (data) => {
      const slug = data.page.fileSlug;
      if (!slug || slug === "index") return null;
      const issue = (data.page.filePathStem || "").split("/").slice(-2, -1)[0];
      if (!issue) return null;
      return `${getFilesUrl()}/citations/archives/${issue}/${slug}.csl.json`;
    },
    articleNumber: (data) => parseInt(data.article_number, 10) || 999,
    archiveKeywords: (data) => {
      const keywords = data.keywords ?? [];
      const keywordArray = Array.isArray(keywords) ? keywords : String(keywords).split(",");
      return [...new Set(keywordArray.map((t) => String(t).trim()).filter(Boolean))];
    },
    tags: (data) => {
      const manualTags = Array.isArray(data.tags) ? data.tags : [];
      const essentialTags = ["archives"];
      // Keep archive keywords out of Eleventy tag collections.
      // Keyword pages are powered by the incremental `tagIndex.archiveKeywords` data.
      const combined = [...manualTags, ...essentialTags];
      return [...new Set(combined.map(t => String(t).trim()).filter(Boolean))];
    }
  }
};
