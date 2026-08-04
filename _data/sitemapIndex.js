import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = path.join(process.cwd(), "content", "sitemaps");
const EXTERNAL_SEARCH_SITEMAP_URL = "https://files.jcrt.org/metadata/search-sitemap.xml";
const PROTECTED_SITEMAPS = [
	"/feed/philpapers.xml",
	"/sitemaps/oai_dc.xml",
	"/sitemaps/doaj-archives.xml"
];
const EXCLUDED_FROM_MAIN_INDEX = new Set([
	"/sitemaps/sitemaps.xml",
	"/media-sitemap.xml",
]);
const LOCAL_METADATA_SITEMAPS = [
	{ path: "/sitemaps/doaj-archives.xml", file: path.join("public", "sitemaps", "doaj-archives.xml") },
	{ path: "/sitemaps/oai_dc.xml", file: path.join("public", "sitemaps", "oai_dc.xml") },
	{ path: "/sitemaps/citations/ris-sitemap.xml", file: path.join("public", "sitemaps", "citations", "ris-sitemap.xml") },
	{ path: "/sitemaps/citations/csl-json-sitemap.xml", file: path.join("public", "sitemaps", "citations", "csl-json-sitemap.xml") },
];
const ALWAYS_INCLUDE_FEEDS = [
	"/feed/firehose.xml",
	"/feed/twtxt.txt",
];
const JCRT_FILES_METADATA = path.resolve(process.cwd(), "..", "jcrt-files", "metadata");

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile() && entry.name.endsWith(".xml.njk")) out.push(full);
	}
	return out;
}

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

function toDateOnly(value) {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

function getFallbackLastmod() {
	return toDateOnly(new Date());
}

function getFileLastmodOrEmpty(filePath) {
	try {
		const stat = fs.statSync(filePath);
		return toDateOnly(stat.mtime);
	} catch {
		return "";
	}
}

/**
 * Build the sitemap index, ensuring all sitemaps/feeds are included with no duplicates,
 * except for protected sitemaps/feeds (philpapers.xml, oai_dc.xml, doaj-archives.xml),
 * which are always included even if they would otherwise be deduplicated.
 */
export default function sitemapIndex() {
	let files = [];
	try {
		files = walk(ROOT);
	} catch {
		return [];
	}

	const fallbackLastmod = getFallbackLastmod();
	const entries = [];
	for (const filePath of files) {
		const raw = fs.readFileSync(filePath, "utf8");
		const fm = parseFrontMatter(raw);
		const permalink = String(fm.permalink || "").trim();
		if (!permalink || !permalink.endsWith(".xml")) continue;
		if (EXCLUDED_FROM_MAIN_INDEX.has(permalink)) continue;
		let lastmod = "";
		try {
			const stat = fs.statSync(filePath);
			lastmod = toDateOnly(stat.mtime);
		} catch {
			lastmod = "";
		}
		entries.push({
			path: permalink,
			lastmod: lastmod || fallbackLastmod,
		});
	}

	// Always include the external search sitemap
	entries.push({
		loc: EXTERNAL_SEARCH_SITEMAP_URL,
		path: EXTERNAL_SEARCH_SITEMAP_URL,
		lastmod: getFileLastmodOrEmpty(path.join(JCRT_FILES_METADATA, "search-sitemap.xml")) || fallbackLastmod,
	});

	// Always include local metadata sitemaps
	for (const ext of LOCAL_METADATA_SITEMAPS) {
		entries.push({
			path: ext.path,
			lastmod: getFileLastmodOrEmpty(path.resolve(process.cwd(), ext.file)) || fallbackLastmod,
		});
	}

	// Always include philpapers.xml (protected feed)
	entries.push({
		path: "/feed/philpapers.xml",
		lastmod: getFallbackLastmod(), // fallback, as we don't have a file stat here
	});

	for (const feedPath of ALWAYS_INCLUDE_FEEDS) {
		entries.push({
			path: feedPath,
			lastmod: getFallbackLastmod(),
		});
	}

	// Deduplicate, but allow protected sitemaps/feeds to appear even if duplicated
	const unique = new Map();
	for (const item of entries) {
		const key = item.loc || item.path;
		if (PROTECTED_SITEMAPS.includes(key)) {
			// Always allow protected sitemaps/feeds
			unique.set(key + "#protected", item);
		} else {
			if (!unique.has(key)) unique.set(key, item);
		}
	}
	return [...unique.values()].sort((a, b) => (a.loc || a.path).localeCompare(b.loc || b.path));
}
