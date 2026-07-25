import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");
const INCLUDE_PREFIXES = [
	"archives/",
	"authors/",
	"blog/",
	"religioustheory/posts/",
	"religioustheory/live/",
];
const EXCLUDED_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);

function walkMarkdown(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(fullPath);
			else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
		}
	}
	return files.sort();
}

function parseFrontMatter(source) {
	const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return null;
	let data = {};
	try {
		data = yaml.load(match[1]) || {};
	} catch {
		data = yaml.load(match[1].replace(/^atproto:\s*.*(?:\n|$)/gm, "")) || {};
	}
	return {
		block: match[1],
		bodyStart: match[0].length,
		data,
	};
}

function normalizePath(value) {
	const raw = String(value || "").split("?")[0].split("#")[0].trim();
	if (!raw) return "";
	const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function documentPathFor(filePath, data) {
	const rel = path.relative(CONTENT_DIR, filePath).split(path.sep).join("/");
	if (!INCLUDE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return "";
	if (data?.draft === true || data?.published === false) return "";

	const slug = path.basename(rel, ".md");
	if (EXCLUDED_SLUGS.has(slug.toLowerCase())) return "";
	if (typeof data.permalink === "string" && data.permalink.startsWith("/")) return normalizePath(data.permalink);
	if (rel.startsWith("archives/")) {
		const parts = rel.split("/");
		if (parts.length >= 3 && parts[1].includes(".")) return normalizePath(`/archives/${parts[1]}/${slug}/`);
	}
	if (rel.startsWith("religioustheory/posts/")) return normalizePath(`/religioustheory/posts/${data.slug || slug}/`);
	if (rel.startsWith("religioustheory/live/")) return normalizePath(`/religioustheory/live/${data.slug || slug}/`);
	if (rel.startsWith("blog/")) return normalizePath(`/blog/${data.slug || slug}/`);
	if (rel.startsWith("authors/")) return normalizePath(`/authors/${data.slug || slug}/`);
	return "";
}

function quoteAtUri(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

function setAtproto(frontmatter, atUri) {
	const line = `atproto: ${quoteAtUri(atUri)}`;
	const withoutAtproto = frontmatter.replace(/^atproto:[^\r\n]*(?:\r?\n)?/gm, "");
	if (/^doi:[^\r\n]*$/m.test(withoutAtproto)) {
		return withoutAtproto.replace(/^doi:[^\r\n]*$/m, (match) => `${match}\n${line}`);
	}
	if (/^nanoid:[^\r\n]*$/m.test(withoutAtproto)) {
		return withoutAtproto.replace(/^nanoid:[^\r\n]*$/m, (match) => `${match}\n${line}`);
	}
	return `${line}\n${withoutAtproto}`;
}

const records = yaml.load(fs.readFileSync(RECORDS_FILE, "utf8")) || {};
let scanned = 0;
let matched = 0;
let added = 0;
let updated = 0;

for (const filePath of walkMarkdown(CONTENT_DIR)) {
	const source = fs.readFileSync(filePath, "utf8");
	const parsed = parseFrontMatter(source);
	if (!parsed) continue;
	scanned += 1;

	const documentPath = documentPathFor(filePath, parsed.data);
	const atUri = records[documentPath];
	if (!atUri) continue;
	matched += 1;

	const nextFrontmatter = setAtproto(parsed.block, atUri);
	if (nextFrontmatter === parsed.block) continue;
	if (/^atproto:\s*.*$/m.test(parsed.block)) updated += 1;
	else added += 1;
	const nextSource = `---\n${nextFrontmatter}\n---\n${source.slice(parsed.bodyStart)}`;
	fs.writeFileSync(filePath, nextSource, "utf8");
}

console.log(`ATProto frontmatter sync: ${matched} matched records across ${scanned} files.`);
console.log(`ATProto frontmatter sync: ${added} added, ${updated} updated.`);
