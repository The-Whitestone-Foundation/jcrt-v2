import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { controlledSubjects } from "../_config/subjects.js";

import { stripMarkdown } from "../_config/markdownTitle.js";
const ROOT = process.cwd();
const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const THEORY_DIRS = ["posts", "live"].map((directory) => path.join(ROOT, "content", "religioustheory", directory));
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const NON_ARTICLE_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);

function parseFrontMatter(content) {
	if (!content.startsWith("---")) return {};
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return {};
	try {
		return yaml.load(match[1]) || {};
	} catch {
		return {};
	}
}

function readMetadataUrls() {
	try {
		const raw = fs.readFileSync(METADATA_FILE, "utf8");
		const parsed = yaml.load(raw) || {};
		const url = String(parsed.url || "").trim();
		const filesUrl = String(parsed.files_url || "").trim();
		return {
			baseUrl: url ? url.replace(/\/+$/, "") : "https://jcrt.org",
			filesUrl: filesUrl ? filesUrl.replace(/\/+$/, "") : "https://files.jcrt.org",
		};
	} catch {
		return { baseUrl: "https://jcrt.org", filesUrl: "https://files.jcrt.org" };
	}
}

function walkMarkdown(dir) {
	const out = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		const items = fs.readdirSync(current, { withFileTypes: true });
		for (const item of items) {
			const full = path.join(current, item.name);
			if (item.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (item.isFile() && item.name.endsWith(".md")) {
				out.push(full);
			}
		}
	}
	return out;
}

function parseIssueNumber(issue) {
	const [majorRaw = "0", minorRaw = "0"] = String(issue || "").split(".");
	const major = Number.parseInt(majorRaw, 10);
	const minor = Number.parseInt(minorRaw, 10);
	return {
		major: Number.isFinite(major) ? major : 0,
		minor: Number.isFinite(minor) ? minor : 0,
	};
}

function issueSortDesc(a, b) {
	if (a.issueMajor !== b.issueMajor) return b.issueMajor - a.issueMajor;
	if (a.issueMinor !== b.issueMinor) return b.issueMinor - a.issueMinor;
	return a.slug.localeCompare(b.slug);
}

function normalizeYear(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	if (/^\d{4}$/.test(raw)) return raw;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return "";
	return String(d.getUTCFullYear());
}

function normalizeDate(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

function splitAuthors(value) {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value
			.map((v) => String(v || "").trim())
			.filter(Boolean);
	}
	const text = String(value).trim();
	if (!text) return [];
	if (text.includes(";")) return text.split(";").map((s) => s.trim()).filter(Boolean);
	if (/\s+and\s+/i.test(text)) return text.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
	return [text];
}

function splitKeywords(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
	return String(value)
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

function readIssueMetadata(issueSlug, cache) {
	if (cache.has(issueSlug)) return cache.get(issueSlug);
	const filePath = path.join(ARCHIVES_DIR, issueSlug, "index.njk");
	if (!fs.existsSync(filePath)) {
		cache.set(issueSlug, {});
		return {};
	}
	const data = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
	cache.set(issueSlug, data || {});
	return cache.get(issueSlug);
}

export default function dataciteArchives() {
	const { baseUrl, filesUrl } = readMetadataUrls();
	const issueCache = new Map();
	const files = walkMarkdown(ARCHIVES_DIR);
	const records = [];

	for (const filePath of files) {
		const rel = path.relative(ARCHIVES_DIR, filePath);
		const parts = rel.split(path.sep);
		if (parts.length < 2) continue;

		const issueSlug = parts[0];
		if (!issueSlug.includes(".")) continue;

		const slug = path.basename(filePath, ".md");
		if (NON_ARTICLE_SLUGS.has(slug.toLowerCase())) continue;

		const data = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		if (!data || typeof data !== "object") continue;
		if (data.published === false) continue;

		const pdfFile = String(data.pdf || "").trim();
		if (!pdfFile) continue;

		const issueData = readIssueMetadata(issueSlug, issueCache);
		const dateIssued = normalizeDate(data.date) || normalizeDate(issueData.date);
		const publicationYear =
			normalizeYear(data.year) ||
			normalizeYear(issueData.year) ||
			(dateIssued ? dateIssued.slice(0, 4) : "");

		const title = stripMarkdown(String(data.title || "").trim()) || slug;
		const creators = splitAuthors(data.author);
		const keywords = splitKeywords(data.keywords);
		const subjects = controlledSubjects(data.subjects);
		const description = String(data.description || data.abstract || "").trim();
		const pageUrl = `${baseUrl}/archives/${issueSlug}/${slug}/`;
		const pdfUrl = `${filesUrl}/archives/${issueSlug}/${pdfFile}`;
		const issueNumbers = parseIssueNumber(issueSlug);

		records.push({
			slug,
			issueSlug,
			issueMajor: issueNumbers.major,
			issueMinor: issueNumbers.minor,
			title,
			creators: creators.length ? creators : ["Whitestone Publications"],
			publisher: "Whitestone Publications",
			publicationYear: publicationYear || "1999",
			resourceType: "JournalArticle",
			resourceTypeGeneral: "Text",
			identifier: pdfUrl,
			identifierType: "URL",
			pageUrl,
			pdfUrl,
			dateIssued,
			description,
			keywords,
			subjects,
			section: "archives",
		});
	}

	for (const filePath of THEORY_DIRS.flatMap(walkMarkdown)) {
		const data = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		if (!data || typeof data !== "object" || data.published === false || data.draft) continue;
		const fileSlug = path.basename(filePath, ".md");
		const slug = String(data.slug || fileSlug).trim();
		if (!slug) continue;
		const title = stripMarkdown(String(data.title || "").trim());
		if (!title) continue;
		const directory = path.basename(path.dirname(filePath));
		const pagePath = String(data.permalink || "").startsWith("/") ? data.permalink : `/religioustheory/${directory}/${slug}/`;
		const pageUrl = `${baseUrl}${pagePath}`;
		const dateIssued = normalizeDate(data.date);
		records.push({
			slug,
			issueSlug: "religioustheory",
			issueMajor: -1,
			issueMinor: -1,
			title,
			creators: splitAuthors(data.author).length ? splitAuthors(data.author) : ["JCRT Editors"],
			publisher: "Whitestone Publications",
			publicationYear: normalizeYear(data.date) || "1999",
			resourceType: "BlogPosting",
			resourceTypeGeneral: "Text",
			identifier: pageUrl,
			identifierType: "URL",
			pageUrl,
			pdfUrl: "",
			dateIssued,
			description: String(data.description || data.abstract || "").trim(),
			keywords: [...splitKeywords(data.categories), ...splitKeywords(data.tags)].filter((value) => value !== "theoryPosts"),
			subjects: controlledSubjects(data.subjects),
			section: "religioustheory",
		});
	}

	records.sort(issueSortDesc);
	return records;
}
