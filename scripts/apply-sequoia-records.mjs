import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { parseFrontMatter, readYaml } from "./lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "./lib/walk.mjs";
import { normalizePath } from "./lib/paths.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, ".sequoia", "content");
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");

const records = readYaml(RECORDS_FILE);
let added = 0;
let updated = 0;
let missing = 0;

for (const filePath of walkFiles(CONTENT_DIR, { match: isMarkdown })) {
	const { data } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
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
