import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, ".sequoia", "content");
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");

function parseFrontMatter(source) {
	const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return {};
	return yaml.load(match[1]) || {};
}

function walkMarkdown(dir) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(fullPath);
			else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
		}
	}
	return files.sort();
}

function normalizePath(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
	return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function readExistingRecords() {
	try {
		return yaml.load(fs.readFileSync(RECORDS_FILE, "utf8")) || {};
	} catch {
		return {};
	}
}

const records = readExistingRecords();
let added = 0;
let updated = 0;
let missing = 0;

for (const filePath of walkMarkdown(CONTENT_DIR)) {
	const data = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
	const documentPath = normalizePath(data.standardPath);
	const atUri = String(data.atUri || data.standard_site_document || "").trim();
	if (!documentPath) continue;
	if (!atUri.startsWith("at://")) {
		missing += 1;
		continue;
	}
	if (!records[documentPath]) added += 1;
	else if (records[documentPath] !== atUri) updated += 1;
	records[documentPath] = atUri;
}

const header = [
	"# Map canonical JCRT paths to published Standard.site document AT-URIs.",
	"# Generated from .sequoia/content by scripts/apply-sequoia-records.mjs.",
	"",
].join("\n");
const body = yaml.dump(records, {
	lineWidth: 1000,
	noRefs: true,
	sortKeys: true,
});

fs.writeFileSync(RECORDS_FILE, `${header}${body}`, "utf8");
console.log(`Standard.site records: ${added} added, ${updated} updated, ${Object.keys(records).length} total.`);
if (missing) {
	console.warn(`Warning: ${missing} staged Sequoia documents do not have atUri values yet.`);
}
