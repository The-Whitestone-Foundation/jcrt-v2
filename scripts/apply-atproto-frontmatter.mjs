// Copies each document's AT-URI from _data/standardSiteRecords.yaml into its content
// file as an `atproto:` front matter line. Pure string surgery on the raw block: no YAML
// re-serialisation, so quotes, comments and key order in content/** are untouched.
import fs from "node:fs";
import path from "node:path";
import { parseFrontMatter, readYaml } from "./lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "./lib/walk.mjs";
import { documentPathFor } from "./lib/paths.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");

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

const records = readYaml(RECORDS_FILE);
let scanned = 0;
let matched = 0;
let added = 0;
let updated = 0;

for (const filePath of walkFiles(CONTENT_DIR, { match: isMarkdown })) {
	const source = fs.readFileSync(filePath, "utf8");
	// A previously written atproto: line is the one thing allowed to be malformed.
	const parsed = parseFrontMatter(source, { repairKeys: ["atproto"] });
	if (!parsed.hasFrontMatter) continue;
	scanned += 1;

	const documentPath = documentPathFor(path.relative(CONTENT_DIR, filePath), parsed.data);
	const atUri = records[documentPath];
	if (!atUri) continue;
	matched += 1;

	const nextFrontmatter = setAtproto(parsed.block, atUri);
	if (nextFrontmatter === parsed.block) continue;
	if (/^atproto:\s*.*$/m.test(parsed.block)) updated += 1;
	else added += 1;
	fs.writeFileSync(filePath, `---\n${nextFrontmatter}\n---\n${source.slice(parsed.bodyStart)}`, "utf8");
}

console.log(`ATProto frontmatter sync: ${matched} matched records across ${scanned} files.`);
console.log(`ATProto frontmatter sync: ${added} added, ${updated} updated.`);
