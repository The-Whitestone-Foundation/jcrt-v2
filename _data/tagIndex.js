import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { authorSlug, splitAuthors } from "../_config/authorSlug.js";

const CACHE_PATH = path.join(process.cwd(), ".cache", "tag-index-cache.json");
const CONTENT_ROOT = path.join(process.cwd(), "content");
const LEAN_BUILD = Boolean(process.env.LEAN_BUILD);
const CACHE_VERSION = 5;

const GLOBAL_TAG_EXCLUDED = new Set(["all", "posts", "authors", "nav", "theoryposts", "archives"]);
const THEORY_TAG_EXCLUDED = new Set(["all", "posts", "theoryposts", "archives", "nav"]);

function isExcluded(tag, excludedSet) {
	return excludedSet.has(String(tag || "").trim().toLowerCase());
}

function ensureArray(value) {
	if (Array.isArray(value)) {
		return value.map((v) => String(v || "").trim()).filter(Boolean);
	}
	if (value === null || value === undefined) return [];
	return String(value)
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

function uniq(values) {
	return [...new Set(values)];
}

function readJson(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseFrontMatter(raw) {
	if (!raw.startsWith("---")) return {};
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return {};
	try {
		return yaml.load(match[1]) || {};
	} catch {
		return {};
	}
}

function walkMarkdownFiles(dir) {
	const files = [];
	if (!fs.existsSync(dir)) return files;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

function normalizeDate(data) {
	const raw = data?.date || data?.year || null;
	if (!raw) return "";
	if (typeof raw === "number") return `${raw}-01-01`;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString();
}

function inferSectionAndUrl(absPath, data) {
	const rel = path.relative(CONTENT_ROOT, absPath).replace(/\\/g, "/");
	const parts = rel.split("/");
	const slugFromFile = path.basename(absPath, ".md");

	if (rel.startsWith("archives/")) {
		const issue = parts[1] || "";
		const slug = String(data?.slug || slugFromFile).trim();
		return {
			section: "archives",
			url: slug && slug !== "index" ? `/archives/${issue}/${slug}/` : "",
		};
	}
	if (rel.startsWith("blog/")) {
		const slug = String(data?.slug || slugFromFile).trim();
		return {
			section: "blog",
			url: slug && slug !== "index" ? `/blog/${slug}/` : "",
		};
	}
	if (rel.startsWith("religioustheory/posts/") || rel.startsWith("religioustheory/live/")) {
		const slug = String(data?.slug || slugFromFile).trim();
		const directory = parts[1] || "posts";
		const permalink = String(data?.permalink || "").trim();
		return {
			section: "theory",
			url: slug && slug !== "index" ? (permalink.startsWith("/") ? permalink : `/religioustheory/${directory}/${slug}/`) : "",
		};
	}
	return { section: "other", url: "" };
}

function buildFileRecord(absPath) {
	const raw = fs.readFileSync(absPath, "utf8");
	const data = parseFrontMatter(raw);
	const { section, url } = inferSectionAndUrl(absPath, data);
	const tags = ensureArray(data?.tags);
	const archiveKeywords = section === "archives" ? ensureArray(data?.keywords) : [];
	const theoryTags = section === "theory" ? tags.filter((t) => !isExcluded(t, THEORY_TAG_EXCLUDED)) : [];
	const theoryCategories = section === "theory" ? ensureArray(data?.categories) : [];
	const globalTags = tags.filter((t) => !isExcluded(t, GLOBAL_TAG_EXCLUDED));

	const authorRaw = String(data?.author || "").trim();
	const authorNames = splitAuthors(authorRaw).map((name) => {
		const slug = authorSlug(name) || name.toLowerCase();
		return { name: name.trim(), slug };
	});

	return {
		section,
		url,
		title: String(data?.title || path.basename(absPath, ".md")).trim(),
		author: authorRaw,
		authorNames,
		description: String(data?.description || data?.excerpt || data?.abstract || "").trim(),
		image: String(data?.image || "").trim(),
		date: normalizeDate(data),
		globalTags: uniq(globalTags),
		archiveKeywords: uniq(archiveKeywords),
		theoryTags: uniq(theoryTags),
		theoryCategories: uniq(theoryCategories),
	};
}

function addToMap(map, key, entry) {
	if (!key || !entry?.url) return;
	if (!map[key]) map[key] = [];
	map[key].push(entry);
}

function sortEntriesDesc(entries) {
	return entries.sort((a, b) => {
		const aTime = a?.date ? new Date(a.date).getTime() : 0;
		const bTime = b?.date ? new Date(b.date).getTime() : 0;
		if (bTime !== aTime) return bTime - aTime;
		return String(a?.title || "").localeCompare(String(b?.title || ""));
	});
}

const MAX_TAG_PAGES = Number.parseInt(process.env.MAX_TAG_PAGES || "9999", 10);

function finalizeDomain(map, affectedSet) {
	const list = Object.keys(map).sort((a, b) => a.localeCompare(b));
	for (const key of list) {
		sortEntriesDesc(map[key]);
	}
	const affected = [...affectedSet].filter((t) => map[t]).sort((a, b) => a.localeCompare(b));
	// Limit pagination to top N tags by post count to reduce page output
	const topN = list
		.map((key) => ({ key, count: map[key].length }))
		.sort((a, b) => b.count - a.count)
		.slice(0, MAX_TAG_PAGES)
		.map((x) => x.key)
		.sort((a, b) => a.localeCompare(b));
	return {
		list,
		affected,
		paginationList: LEAN_BUILD ? affected : topN,
		map,
		counts: Object.fromEntries(list.map((key) => [key, map[key].length])),
	};
}

function addAll(set, values) {
	for (const value of values || []) set.add(value);
}

function sortAuthorEntriesBySection(entries) {
	const groups = { archives: [], religioustheory: [], blog: [], other: [] };
	for (const entry of entries) {
		if (entry.section === "archives") groups.archives.push(entry);
		else if (entry.section === "theory") groups.religioustheory.push(entry);
		else if (entry.section === "blog") groups.blog.push(entry);
		else groups.other.push(entry);
	}
	for (const arr of Object.values(groups)) sortEntriesDesc(arr);
	return [...groups.archives, ...groups.religioustheory, ...groups.blog, ...groups.other];
}

function buildAuthorMaps(nextFiles) {
	const allMap = {};
	const theoryMap = {};

	const nameBySlug = {};

	for (const rel of Object.keys(nextFiles)) {
		const rec = nextFiles[rel]?.record;
		if (!rec?.url || !rec.authorNames?.length) continue;

		const entry = {
			url: rec.url,
			title: rec.title,
			author: rec.author,
			description: rec.description,
			image: rec.image,
			date: rec.date,
			section: rec.section,
		};

		for (const { slug, name } of rec.authorNames) {
			if (!nameBySlug[slug]) nameBySlug[slug] = name;
			addToMap(allMap, slug, entry);
			if (rec.section === "theory") addToMap(theoryMap, slug, entry);
		}
	}

	for (const posts of Object.values(allMap)) {
		const sorted = sortAuthorEntriesBySection(posts);
		posts.length = 0;
		posts.push(...sorted);
	}
	for (const posts of Object.values(theoryMap)) sortEntriesDesc(posts);

	const allList = Object.keys(allMap).sort();
	const theoryList = Object.keys(theoryMap).sort();

	return {
		all: { map: allMap, list: allList, counts: Object.fromEntries(allList.map((k) => [k, allMap[k].length])), names: nameBySlug },
		theory: { map: theoryMap, list: theoryList, counts: Object.fromEntries(theoryList.map((k) => [k, theoryMap[k].length])), names: nameBySlug },
	};
}

function withPagination(domain) {
	if (!domain || typeof domain !== "object") return finalizeDomain({}, new Set());
	const list = Array.isArray(domain.list) ? domain.list : [];
	const affected = Array.isArray(domain.affected) ? domain.affected : [];
	const map = domain.map && typeof domain.map === "object" ? domain.map : {};
	const counts = domain.counts && typeof domain.counts === "object" ? domain.counts : {};
	const topN = list
		.map((key) => ({ key, count: counts[key] || (map[key] || []).length }))
		.sort((a, b) => b.count - a.count)
		.slice(0, MAX_TAG_PAGES)
		.map((x) => x.key)
		.sort((a, b) => a.localeCompare(b));
	return {
		list,
		affected,
		paginationList: LEAN_BUILD ? affected : topN,
		map,
		counts,
	};
}

function stripPagination(domain) {
	if (!domain || typeof domain !== "object") return domain;
	const { paginationList, ...rest } = domain;
	return rest;
}

let inProcessMemo = {
	key: "",
	value: null,
};

export default async function tagIndexData() {
	const prev = readJson(CACHE_PATH, { version: CACHE_VERSION, files: {} });
	const prevFiles = prev?.version === CACHE_VERSION && prev?.files && typeof prev.files === "object" ? prev.files : {};

	const files = [
		...walkMarkdownFiles(path.join(CONTENT_ROOT, "archives")),
		...walkMarkdownFiles(path.join(CONTENT_ROOT, "blog")),
		...walkMarkdownFiles(path.join(CONTENT_ROOT, "religioustheory", "posts")),
		...walkMarkdownFiles(path.join(CONTENT_ROOT, "religioustheory", "live")),
	];
	files.sort((a, b) => a.localeCompare(b));

	const nextFiles = {};
	const changedPaths = new Set();
	let generated = 0;
	let reused = 0;
	const signatureParts = [];

	for (const absPath of files) {
		const rel = path.relative(process.cwd(), absPath).replace(/\\/g, "/");
		const stat = fs.statSync(absPath);
		const signature = `${stat.size}|${Math.trunc(stat.mtimeMs)}`;
		signatureParts.push(`${rel}:${signature}`);
		const prior = prevFiles[rel];

		if (prior?.signature === signature && prior?.record) {
			nextFiles[rel] = prior;
			reused += 1;
			continue;
		}

		nextFiles[rel] = {
			signature,
			record: buildFileRecord(absPath),
		};
		changedPaths.add(rel);
		generated += 1;
	}

	const removedPaths = Object.keys(prevFiles).filter((rel) => !nextFiles[rel]);
	for (const rel of removedPaths) changedPaths.add(rel);
	for (const rel of removedPaths) signatureParts.push(`removed:${rel}`);

	const signatureKey = `${LEAN_BUILD ? "lean" : "full"}|${signatureParts.join("|")}`;
	if (inProcessMemo.key === signatureKey && inProcessMemo.value) {
		return inProcessMemo.value;
	}

	if (
		changedPaths.size === 0 &&
		prev?.version === CACHE_VERSION &&
		prev?.domains?.globalTags &&
		prev?.domains?.archiveKeywords &&
		prev?.domains?.theory?.tags &&
		prev?.domains?.theory?.categories &&
		prev?.domains?.authors
	) {
		const result = {
			generatedAt: new Date().toISOString(),
			summary: {
				totalFiles: files.length,
				reusedFiles: reused,
				generatedFiles: generated,
				removedFiles: 0,
				changedFiles: 0,
				cacheHit: true,
			},
			globalTags: withPagination(prev.domains.globalTags),
			archiveKeywords: withPagination(prev.domains.archiveKeywords),
			theory: {
				tags: withPagination(prev.domains.theory.tags),
				categories: withPagination(prev.domains.theory.categories),
			},
			authors: prev.domains.authors,
		};
		inProcessMemo = { key: signatureKey, value: result };
		return result;
	}

	const affectedGlobal = new Set();
	const affectedArchiveKeywords = new Set();
	const affectedTheoryTags = new Set();
	const affectedTheoryCategories = new Set();

	if (Object.keys(prevFiles).length === 0) {
		for (const rel of Object.keys(nextFiles)) {
			const rec = nextFiles[rel]?.record;
			addAll(affectedGlobal, rec?.globalTags);
			addAll(affectedArchiveKeywords, rec?.archiveKeywords);
			addAll(affectedTheoryTags, rec?.theoryTags);
			addAll(affectedTheoryCategories, rec?.theoryCategories);
		}
	} else {
		for (const rel of changedPaths) {
			const prevRec = prevFiles[rel]?.record;
			const nextRec = nextFiles[rel]?.record;
			addAll(affectedGlobal, [...(prevRec?.globalTags || []), ...(nextRec?.globalTags || [])]);
			addAll(affectedArchiveKeywords, [...(prevRec?.archiveKeywords || []), ...(nextRec?.archiveKeywords || [])]);
			addAll(affectedTheoryTags, [...(prevRec?.theoryTags || []), ...(nextRec?.theoryTags || [])]);
			addAll(affectedTheoryCategories, [...(prevRec?.theoryCategories || []), ...(nextRec?.theoryCategories || [])]);
		}
	}

	const globalMap = {};
	const archiveKeywordMap = {};
	const theoryTagMap = {};
	const theoryCategoryMap = {};

	for (const rel of Object.keys(nextFiles)) {
		const rec = nextFiles[rel]?.record;
		if (!rec?.url) continue;

		const entry = {
			url: rec.url,
			title: rec.title,
			author: rec.author,
			description: rec.description,
			image: rec.image,
			date: rec.date,
			section: rec.section,
		};

		for (const tag of rec.globalTags) addToMap(globalMap, tag, entry);
		for (const keyword of rec.archiveKeywords) addToMap(archiveKeywordMap, keyword, entry);
		for (const tag of rec.theoryTags) addToMap(theoryTagMap, tag, entry);
		for (const category of rec.theoryCategories) addToMap(theoryCategoryMap, category, entry);
	}

	const authors = buildAuthorMaps(nextFiles);

	const result = {
		generatedAt: new Date().toISOString(),
		summary: {
			totalFiles: files.length,
			reusedFiles: reused,
			generatedFiles: generated,
			removedFiles: removedPaths.length,
			changedFiles: changedPaths.size,
			cacheHit: false,
		},
		globalTags: finalizeDomain(globalMap, affectedGlobal),
		archiveKeywords: finalizeDomain(archiveKeywordMap, affectedArchiveKeywords),
		theory: {
			tags: finalizeDomain(theoryTagMap, affectedTheoryTags),
			categories: finalizeDomain(theoryCategoryMap, affectedTheoryCategories),
		},
		authors,
	};

	writeJson(CACHE_PATH, {
		version: CACHE_VERSION,
		generatedAt: result.generatedAt,
		files: nextFiles,
		domains: {
			globalTags: stripPagination(result.globalTags),
			archiveKeywords: stripPagination(result.archiveKeywords),
			theory: {
				tags: stripPagination(result.theory.tags),
				categories: stripPagination(result.theory.categories),
			},
			authors,
		},
	});

	inProcessMemo = { key: signatureKey, value: result };
	return result;
}
