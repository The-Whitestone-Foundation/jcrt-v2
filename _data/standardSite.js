import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const NON_ARTICLE_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);

function readYamlFile(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || {};
	} catch {
		return {};
	}
}

function parseFrontMatter(source) {
	if (!source.startsWith("---")) return { data: {}, body: source };
	const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
	if (!match) return { data: {}, body: source };
	try {
		return {
			data: yaml.load(match[1]) || {},
			body: match[2] || "",
		};
	} catch {
		return { data: {}, body: match[2] || "" };
	}
}

function walkMarkdown(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				files.push(fullPath);
			}
		}
	}
	return files.sort();
}

function stripHtml(value) {
	return String(value || "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function markdownToPlainText(value) {
	return stripHtml(value)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^[>\-*+]\s+/gm, "")
		.replace(/[*_~]{1,3}/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeUrl(value, fallback = "https://jcrt.org") {
	const raw = String(value || fallback).trim();
	return (raw || fallback).replace(/\/+$/, "");
}

function normalizePath(value) {
	const raw = String(value || "").split("?")[0].split("#")[0].trim();
	if (!raw) return "";
	const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function normalizeDate(value) {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString();
}

function normalizeTags(value) {
	const raw = Array.isArray(value) ? value : String(value || "").split(",");
	return [...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))];
}

function isPublished(data) {
	return data?.published !== false && data?.draft !== true;
}

function readMetadata() {
	const metadata = readYamlFile(METADATA_FILE);
	const standardConfig = metadata.standard_site || {};
	const siteUrl = normalizeUrl(standardConfig.url || metadata.url);
	const filesUrl = normalizeUrl(metadata.files_url || "https://files.jcrt.org", "https://files.jcrt.org");
	return {
		metadata,
		standardConfig,
		siteUrl,
		filesUrl,
		publicationSite: String(standardConfig.publication_at_uri || "").trim() || siteUrl,
	};
}

function readIssueMetadata(issueSlug, cache) {
	if (cache.has(issueSlug)) return cache.get(issueSlug);
	const issuePath = path.join(CONTENT_DIR, "archives", issueSlug, "index.njk");
	if (!fs.existsSync(issuePath)) {
		cache.set(issueSlug, {});
		return {};
	}
	const { data } = parseFrontMatter(fs.readFileSync(issuePath, "utf8"));
	cache.set(issueSlug, data || {});
	return cache.get(issueSlug);
}

function archivePdfUrl(filesUrl, issueSlug, pdf) {
	const fileName = String(pdf || "").trim();
	if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) return "";
	if (/^https:\/\//i.test(fileName)) return fileName;
	if (/^https?:\/\//i.test(fileName)) return "";
	const cleanFileName = fileName.replace(/^\/+/, "");
	return `${filesUrl}/archives/${issueSlug}/${cleanFileName}`;
}

function documentRecord({ site, path: documentPath, title, description, publishedAt, updatedAt, tags, textContent, pdfUrl }) {
	const record = {
		$type: "site.standard.document",
		site,
		path: documentPath,
		title,
		publishedAt,
	};
	if (description) record.description = description;
	if (updatedAt && updatedAt !== publishedAt) record.updatedAt = updatedAt;
	if (tags?.length) record.tags = tags;
	if (textContent) record.textContent = textContent;
	if (pdfUrl) record.pdfUrl = pdfUrl;
	return record;
}

function archiveDocuments(publicationSite, filesUrl) {
	const archivesRoot = path.join(CONTENT_DIR, "archives");
	const issueCache = new Map();
	return walkMarkdown(archivesRoot)
		.map((filePath) => {
			const rel = path.relative(archivesRoot, filePath);
			const parts = rel.split(path.sep);
			if (parts.length < 2) return null;
			const issueSlug = parts[0];
			const slug = path.basename(filePath, ".md");
			if (!issueSlug.includes(".") || NON_ARTICLE_SLUGS.has(slug.toLowerCase())) return null;

			const source = fs.readFileSync(filePath, "utf8");
			const { data, body } = parseFrontMatter(source);
			if (!isPublished(data)) return null;

			const issueData = readIssueMetadata(issueSlug, issueCache);
			const publishedAt = normalizeDate(data.date) || normalizeDate(issueData.date) || normalizeDate(data.year ? `${data.year}-01-01` : "");
			const title = String(data.title || slug).trim();
			const description = stripHtml(data.description || data.abstract || "");

			return documentRecord({
				site: publicationSite,
				path: `/archives/${issueSlug}/${slug}/`,
				title,
				description,
				publishedAt,
				updatedAt: normalizeDate(data.updated || data.modified || data.lastmod),
				tags: normalizeTags(data.keywords),
				textContent: markdownToPlainText(body),
				pdfUrl: archivePdfUrl(filesUrl, issueSlug, data.pdf),
			});
		})
		.filter(Boolean);
}

function blogDocuments(publicationSite) {
	return walkMarkdown(path.join(CONTENT_DIR, "blog"))
		.map((filePath) => {
			const slug = path.basename(filePath, ".md");
			const { data, body } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
			if (!isPublished(data)) return null;
			const publishedAt = normalizeDate(data.date);
			return documentRecord({
				site: publicationSite,
				path: `/blog/${slug}/`,
				title: String(data.title || slug).trim(),
				description: stripHtml(data.description || data.excerpt || data.abstract || ""),
				publishedAt,
				updatedAt: normalizeDate(data.updated || data.modified || data.lastmod),
				tags: normalizeTags(data.tags),
				textContent: markdownToPlainText(body),
			});
		})
		.filter(Boolean);
}

function theoryDocuments(publicationSite) {
	return walkMarkdown(path.join(CONTENT_DIR, "religioustheory", "posts"))
		.map((filePath) => {
			const slug = path.basename(filePath, ".md");
			const { data, body } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
			if (!isPublished(data)) return null;
			const publishedAt = normalizeDate(data.date);
			return documentRecord({
				site: publicationSite,
				path: `/religioustheory/posts/${slug}/`,
				title: String(data.title || slug).trim(),
				description: stripHtml(data.description || data.excerpt || data.abstract || ""),
				publishedAt,
				updatedAt: normalizeDate(data.updated || data.modified || data.lastmod),
				tags: normalizeTags([...(normalizeTags(data.categories)), ...(normalizeTags(data.tags))]),
				textContent: markdownToPlainText(body),
			});
		})
		.filter(Boolean);
}

function authorDocuments(publicationSite) {
	return walkMarkdown(path.join(CONTENT_DIR, "authors"))
		.map((filePath) => {
			const slug = path.basename(filePath, ".md");
			const { data, body } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
			if (!isPublished(data)) return null;
			const publishedAt = normalizeDate(data.date) || normalizeDate("1999-01-01");
			const title = String(data.title || data.name || slug).trim();
			const description = stripHtml(data.description || data.bio || "");
			return documentRecord({
				site: publicationSite,
				path: `/authors/${data.slug || slug}/`,
				title,
				description,
				publishedAt,
				updatedAt: normalizeDate(data.updated || data.modified || data.lastmod),
				tags: normalizeTags(["author", ...(normalizeTags(data.tags))]),
				textContent: markdownToPlainText(body || data.bio || description),
			});
		})
		.filter(Boolean);
}

function byPathThenDate(a, b) {
	return String(a.path).localeCompare(String(b.path)) || String(a.publishedAt).localeCompare(String(b.publishedAt));
}

export default function standardSite() {
	const { metadata, standardConfig, siteUrl, filesUrl, publicationSite } = readMetadata();
	const name = String(standardConfig.name || "The Journal for Cultural and Religious Theory").trim();
	const description = String(standardConfig.description || metadata.description || "").trim();
	const publication = {
		$type: "site.standard.publication",
		name,
		url: siteUrl,
		description,
	};
	if (standardConfig.did) publication.did = String(standardConfig.did).trim();
	if (standardConfig.publication_at_uri) publication.atUri = String(standardConfig.publication_at_uri).trim();

	const documents = [
		...archiveDocuments(publicationSite, filesUrl),
		...authorDocuments(publicationSite),
		...blogDocuments(publicationSite),
		...theoryDocuments(publicationSite),
	]
		.filter((record) => record.publishedAt)
		.sort(byPathThenDate);

	return {
		enabled: Boolean(standardConfig.enabled),
		publication,
		documents,
		manifest: {
			$type: "site.standard.manifest",
			publication,
			documentCount: documents.length,
			documents: documents.map((record) => ({
				path: normalizePath(record.path),
				title: record.title,
				publishedAt: record.publishedAt,
				...(record.pdfUrl ? { pdfUrl: record.pdfUrl } : {}),
			})),
		},
	};
}
