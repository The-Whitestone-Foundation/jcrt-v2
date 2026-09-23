// OAI-PMH, DOAJ and citation-sitemap feeds, computed once per build from content/**. Rendered
// byte-exact by content/sitemaps/oai-feeds.11ty.js (one output file per entry of `files`).
// This replaced scripts/generate-local-sitemaps.mjs and the five generated files it kept in
// public/sitemaps/: the outputs are now built, not committed, so they cannot go stale.
//
// The OAI edge function (netlify/edge-functions/oai-pmh.js) fetches /sitemaps/oai-records.json
// from the live site at request time; the path is unchanged.
//
// Env: OAI_REPOSITORY_NAME, OAI_ADMIN_EMAIL.
import fs from "node:fs";
import path from "node:path";
import { isCcBy, rightsText } from "../_config/license.js";
import { subjectLabels } from "../_config/subjects.js";
import {
	buildOaiRecord,
	escapeXml,
	OAI_METADATA_PREFIX,
	OAI_PHILOSOPHY_SET,
	renderStaticListRecordsResponse,
} from "../scripts/lib/oai-pmh.mjs";
import { parseFrontMatter } from "../scripts/lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "../scripts/lib/walk.mjs";

const ROOT = process.cwd();
const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const THEORY_DIRS = ["posts", "live"].map((directory) => path.join(ROOT, "content", "religioustheory", directory));
const BASE_URL = "https://jcrt.org";
const FILES_URL = "https://files.jcrt.org";

const ISSN_PLAIN = "15305228";
const ISSN_DASH = "1530-5228";
const PUBLISHER = "Whitestone Publications";
const JOURNAL_TITLE_DOAJ = "The Journal for Cultural and Religious Theory";
const JOURNAL_TITLE_OAI = "Journal for Cultural & Religious Theory";
const DOAJ_SKIP_SLUGS = new Set(["index", "author-bios", "table-of-contents", "abstracts", "bios"]);
const OAI_SKIP_SLUGS = new Set(["author-bios", "abstracts"]);
// ponytail: metadata heuristic; set `philpapers: true` or `false` in front matter for edge cases.
const PHILOSOPHY_METADATA = /\b(?:philosoph\w*|metaphys\w*|ontolog\w*|epistemolog\w*|phenomenolog\w*|hermeneut\w*|deconstruct\w*|ethics?|aesthetics?|derrida|caputo|[zž][\s-]*i[\s-]*[zž][\s-]*ek\w*|deleuze|hegel|kant|nietzsche|levinas|marion|badiou|agamben|foucault|lacan|kierkegaard|heidegger|husserl|schelling|spinoza|benjamin|ricoeur|vattimo|ranciere|aristotle|plato|descartes|leibniz|whitehead|guattari)\b/i;

function isPhilosophyEntry(entry) {
	if (typeof entry.philpapers === "boolean") return entry.philpapers;
	return PHILOSOPHY_METADATA.test(
		[entry.title, entry.description, ...entry.authors, ...entry.keywords, ...entry.subjects]
			.join(" ")
			.normalize("NFKD")
			.replace(/\p{Diacritic}/gu, "")
			.replace(/[Žž]/g, "z"),
	);
}

const walkMarkdown = (dir) => walkFiles(dir, { match: isMarkdown });

function toDateOnly(value) {
	if (!value) return "";
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function normalizeNum(v) {
	const raw = String(v || "").trim();
	if (!raw) return "";
	const n = parseInt(raw, 10);
	return Number.isNaN(n) ? raw : String(n);
}

function parsePages(pages) {
	const raw = String(pages || "").trim();
	if (!raw) return { sp: "", ep: "" };
	const [sp = "", ep = ""] = raw.replace(/\s+/g, "").replace(/[–—]/g, "-").split("-", 2);
	return { sp, ep };
}

function splitAuthors(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.flatMap(splitAuthors);
	const s = String(value).trim();
	if (!s) return [];
	if (s.includes(";")) return s.split(";").map((p) => p.trim()).filter(Boolean);
	if (/\s+and\s+/i.test(s)) return s.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
	return [s];
}

function splitKeywords(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((k) => String(k).trim()).filter(Boolean);
	return String(value).split(",").map((k) => k.trim()).filter(Boolean);
}

function issueSort(a, b) {
	const [av, ai] = a.issue.split(".").map(Number);
	const [bv, bi] = b.issue.split(".").map(Number);
	if (av !== bv) return av - bv;
	if (ai !== bi) return ai - bi;
	return a.slug.localeCompare(b.slug);
}

function getIssueMeta(issueSlug, cache) {
	if (cache.has(issueSlug)) return cache.get(issueSlug);
	let meta = {};
	try {
		meta = parseFrontMatter(fs.readFileSync(path.join(ARCHIVES_DIR, issueSlug, "index.njk"), "utf8")).data;
	} catch {
		meta = {};
	}
	cache.set(issueSlug, meta || {});
	return cache.get(issueSlug);
}

function readArchiveEntries() {
	const cache = new Map();
	const entries = [];
	for (const filePath of walkMarkdown(ARCHIVES_DIR)) {
		const parts = path.relative(ARCHIVES_DIR, filePath).split(path.sep);
		if (parts.length < 2) continue;
		const issueSlug = parts[0];
		if (!issueSlug.includes(".")) continue;

		const slug = path.basename(filePath, ".md");
		const { data } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		if (!data || typeof data !== "object") continue;

		const issueMeta = getIssueMeta(issueSlug, cache);
		const [dirVol, dirIss] = issueSlug.split(".");
		const { sp, ep } = parsePages(data.pages);
		let dateStr = toDateOnly(data.date);
		if (!dateStr && issueMeta.year) dateStr = `${issueMeta.year}-01-01`;
		if (!dateStr && data.year) dateStr = `${data.year}-01-01`;

		const pdfFile = String(data.pdf || "").trim();
		const pageUrl = `${BASE_URL}/archives/${issueSlug}/${slug}/`;
		const pdfUrl = pdfFile ? `${FILES_URL}/archives/${issueSlug}/${pdfFile}` : "";
		entries.push({
			issue: issueSlug,
			slug,
			title: String(data.title || "").trim(),
			authors: splitAuthors(data.author),
			keywords: splitKeywords(data.keywords),
			subjects: subjectLabels(data),
			description: String(data.description || data.abstract || "").trim(),
			volume: normalizeNum(data.volume || issueMeta.volume || dirVol),
			issueNum: normalizeNum(data.issue || issueMeta.issue || dirIss),
			sp,
			ep,
			dateStr,
			citationStem: slug,
			pdfUrl,
			canonicalUrl: pdfUrl || pageUrl,
			canonicalFormat: pdfUrl ? "application/pdf" : "text/html",
			published: data.published !== false,
			ccBy: isCcBy(data, dateStr),
			sitemapIgnore: !!data.sitemapIgnore,
			section: "archives",
			philpapers: data.philpapers,
		});
	}
	return entries.sort(issueSort);
}

function readTheoryEntries() {
	return THEORY_DIRS.flatMap(walkMarkdown).flatMap((filePath) => {
		const { data } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		if (!data || typeof data !== "object") return [];
		const slug = String(data.slug || path.basename(filePath, ".md")).trim();
		const title = String(data.title || "").trim();
		if (!slug || !title) return [];
		const dateStr = toDateOnly(data.date);
		const authors = splitAuthors(data.author || data.authors);
		const directory = path.basename(path.dirname(filePath));
		const pagePath = String(data.permalink || "").startsWith("/") ? data.permalink : `/religioustheory/${directory}/${slug}/`;
		const pageUrl = `${BASE_URL}${pagePath}`;
		const pdfFile = String(data.pdf || "").trim();
		const pdfUrl = pdfFile ? `${FILES_URL}/religioustheory/${pdfFile}` : "";
		return [{
			issue: "religioustheory",
			slug,
			title,
			authors: authors.length ? authors : ["JCRT Editors"],
			keywords: [...splitKeywords(data.categories), ...splitKeywords(data.tags)].filter((value) => value !== "theoryPosts"),
			subjects: subjectLabels(data),
			description: String(data.description || data.abstract || "").trim(),
			volume: "",
			issueNum: "",
			sp: "",
			ep: "",
			dateStr,
			ccBy: isCcBy(data, dateStr),
			citationStem: "",
			pdfUrl,
			canonicalUrl: pdfUrl || pageUrl,
			canonicalFormat: pdfUrl ? "application/pdf" : "text/html",
			published: data.published !== false && !data.draft,
			sitemapIgnore: !!data.sitemapIgnore,
			section: "religioustheory",
			philpapers: data.philpapers,
		}];
	});
}

function doajXml(entries) {
	const lines = [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<records xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
		`         xsi:noNamespaceSchemaLocation="https://jcrt.org/sitemaps/doajArticles.xsd">`,
	];
	for (const e of entries.filter((e) => e.published && e.title && !DOAJ_SKIP_SLUGS.has(e.slug.toLowerCase()))) {
		lines.push(`  <record>`);
		lines.push(`    <language>eng</language>`);
		lines.push(`    <publisher>${escapeXml(PUBLISHER)}</publisher>`);
		lines.push(`    <journalTitle>${escapeXml(JOURNAL_TITLE_DOAJ)}</journalTitle>`);
		lines.push(`    <issn>${ISSN_PLAIN}</issn>`);
		lines.push(`    <publicationDate>${escapeXml(e.dateStr)}</publicationDate>`);
		lines.push(`    <volume>${escapeXml(e.volume)}</volume>`);
		lines.push(`    <issue>${escapeXml(e.issueNum)}</issue>`);
		lines.push(`    <startPage>${escapeXml(e.sp)}</startPage>`);
		lines.push(`    <endPage>${escapeXml(e.ep)}</endPage>`);
		lines.push(`    <publisherRecordId>${escapeXml(e.slug)}</publisherRecordId>`);
		lines.push(`    <documentType>article</documentType>`);
		lines.push(`    <title language="eng">${escapeXml(e.title)}</title>`);
		if (e.authors.length) {
			lines.push(`    <authors>`);
			for (const author of e.authors) lines.push(`      <author><name>${escapeXml(author)}</name></author>`);
			lines.push(`    </authors>`);
		}
		if (e.description) lines.push(`    <abstract language="eng">${escapeXml(e.description)}</abstract>`);
		lines.push(`    <fullTextUrl format="${e.pdfUrl ? "pdf" : "html"}">${escapeXml(e.canonicalUrl)}</fullTextUrl>`);
		if (e.keywords.length) {
			lines.push(`    <keywords language="eng">`);
			for (const kw of e.keywords) lines.push(`      <keyword>${escapeXml(kw)}</keyword>`);
			lines.push(`    </keywords>`);
		}
		lines.push(`  </record>`);
	}
	lines.push(`</records>`);
	return `${lines.join("\n")}\n`;
}

function oaiFeed(entries) {
	const today = new Date().toISOString().slice(0, 10);
	const records = entries
		.filter((e) => e.published && !e.sitemapIgnore && !OAI_SKIP_SLUGS.has(String(e.slug || "").toLowerCase())
			&& String(e.title || "").trim() && Array.isArray(e.authors) && e.authors.length > 0)
		.map((e) => buildOaiRecord(
			{
				identifier: e.section === "religioustheory" ? `oai:jcrt.org:religioustheory:${e.slug}` : `oai:jcrt.org:archives:${e.issue}:${e.slug}`,
				datestamp: e.dateStr || today,
				title: e.title,
				authors: e.authors,
				subjects: e.subjects?.length ? e.subjects : e.keywords,
				description: e.description,
				canonicalUrl: e.canonicalUrl,
				pdfUrl: e.pdfUrl,
				format: e.canonicalFormat,
				citation: e.volume
					? `Vol. ${e.volume}${e.issueNum ? `, No. ${e.issueNum}` : ""}${e.sp ? `, pp. ${e.sp}${e.ep ? `-${e.ep}` : ""}` : ""}`
					: "",
				setSpecs: isPhilosophyEntry(e) ? [OAI_PHILOSOPHY_SET] : [],
			},
			{
				issn: ISSN_DASH,
				publisher: PUBLISHER,
				rights: rightsText(e.ccBy, (e.dateStr || "").slice(0, 4)),
				sourceTitle: `${JOURNAL_TITLE_OAI}, ISSN ${ISSN_DASH}`,
			},
		));

	const datestamps = records.map((record) => String(record.datestamp || "")).filter(Boolean).sort();
	const baseURL = `${BASE_URL}/oai`;
	const index = {
		baseURL,
		metadataPrefix: OAI_METADATA_PREFIX,
		repositoryName: String(process.env.OAI_REPOSITORY_NAME || "Journal for Cultural and Religious Theory").trim(),
		adminEmails: [String(process.env.OAI_ADMIN_EMAIL || "carl.raschke@jcrt.org").trim()],
		earliestDatestamp: datestamps[0] || today,
		deletedRecord: "no",
		granularity: "YYYY-MM-DD",
		protocolVersion: "2.0",
		compressions: ["gzip"],
		records,
	};
	// The static file is a build artefact, not a live response: the edge function re-renders
	// responseDate per request. Stamp it with the newest record datestamp so the bytes only
	// change when a record does.
	const xml = renderStaticListRecordsResponse({ baseURL, records, responseDate: `${datestamps.at(-1) || today}T00:00:00Z` });
	return { xml, json: `${JSON.stringify(index, null, 2)}\n` };
}

function citationSitemap(entries, extension) {
	const urls = new Set();
	for (const e of entries) {
		if (!e.published || e.sitemapIgnore || !e.citationStem) continue;
		urls.add(`${FILES_URL}/citations/archives/${e.issue}/${e.citationStem}${extension}`);
	}
	const lines = [`<?xml version="1.0" encoding="utf-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`];
	for (const url of [...urls].sort()) lines.push(`  <url><loc>${escapeXml(url)}</loc></url>`);
	lines.push(`</urlset>`);
	return `${lines.join("\n")}\n`;
}

export default function oaiFeeds() {
	const archives = readArchiveEntries();
	const oai = oaiFeed([...archives, ...readTheoryEntries()]);
	return {
		files: [
			{ path: "/sitemaps/doaj-archives.xml", body: doajXml(archives) },
			{ path: "/sitemaps/oai_dc.xml", body: oai.xml },
			{ path: "/sitemaps/oai-records.json", body: oai.json },
			{ path: "/sitemaps/citations/ris-sitemap.xml", body: citationSitemap(archives, ".ris") },
			{ path: "/sitemaps/citations/csl-json-sitemap.xml", body: citationSitemap(archives, ".csl.json") },
		],
	};
}
