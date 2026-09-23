import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as yaml from "js-yaml";
import { stagedDocument } from "./sequoia.mjs";
import { readYaml } from "./lib/frontmatter.mjs";

// Verbatim copy of sequoia-cli 0.5.7's updateFrontmatterWithAtUri (dist/index.js). The CLI stores
// the content hash of the file AFTER this insertion, so `stage` must emit exactly these bytes or
// every document is re-created on every run.
function cliInsertAtUri(rawContent, atUri) {
	const delimiterMatch = rawContent.match(/^(---|\+\+\+|\*\*\*)/);
	const delimiter = delimiterMatch?.[1] ?? "---";
	const isToml = delimiter === "+++";
	const atUriEntry = isToml ? `atUri = "${atUri}"` : `atUri: "${atUri}"`;
	if (rawContent.includes("atUri:") || rawContent.includes("atUri =")) {
		return rawContent.replace(/atUri\s*[=:]\s*["']?[^"'\n]+["']?\n?/, `${atUriEntry}\n`);
	}
	const frontmatterEndIndex = rawContent.indexOf(delimiter, 4);
	if (frontmatterEndIndex === -1) throw new Error("Could not find frontmatter end");
	return `${rawContent.slice(0, frontmatterEndIndex)}${atUriEntry}\n${rawContent.slice(frontmatterEndIndex)}`;
}

const URI = "at://did:plc:e24okfpxr7ctcbmruijop5gp/site.standard.document/3mw4khlrdqx27";
const frontMatterOf = (text) => yaml.load(text.match(/^---\n([\s\S]*?)\n---\n/)[1]);

test("staged atUri line is byte-identical to what sequoia-cli would insert", () => {
	const cases = {
		"religioustheory/posts/plain.md": "---\ntitle: Plain\ndate: 2026-01-01\n---\nBody.\n",
		"religioustheory/posts/tagged.md": "---\ntitle: Tagged\ndate: 2026-01-01\ntags: [a, b]\nkeywords: c, d\n---\nBody.\n",
		"authors/dashes.md": "---\nname: Dashes\nbio: \"Before --- after ---- end\"\n---\nBio.\n",
	};
	for (const [rel, source] of Object.entries(cases)) {
		const without = stagedDocument(rel, source, {});
		const withUri = stagedDocument(rel, source, { [without.standardPath]: URI });
		assert.equal(withUri.text, cliInsertAtUri(without.text, URI), rel);
		assert.equal(frontMatterOf(withUri.text).atUri, URI, rel);
		assert.doesNotMatch(withUri.text.slice(3), /---[\s\S]*---[\s\S]*---/, `${rel}: a --- inside the front matter would misplace the CLI's insert`);
	}
	const dashes = stagedDocument("authors/dashes.md", cases["authors/dashes.md"], {});
	assert.equal(frontMatterOf(dashes.text).description, "Before --- after ---- end");
	assert.equal(stagedDocument("religioustheory/posts/draft.md", "---\ntitle: D\ndraft: true\n---\n", {}), null);
});

// The CLI always CREATES when state.posts has no entry for a staged file, even if the file
// carries an atUri. So a truncated or rebuilt .sequoia-state.json would re-mint every mapped
// document. Guard: every staged file whose path is in the records map has a state entry.
// Skipped when .sequoia/content is absent (it is gitignored; Netlify never stages).
test("every staged document with a mapped URI has a .sequoia-state.json entry", (t) => {
	const root = path.resolve(import.meta.dirname, "..");
	const stageDir = path.join(root, ".sequoia", "content");
	if (!fs.existsSync(stageDir)) return t.skip(".sequoia/content not staged");
	const records = readYaml(path.join(root, "_data", "standardSiteRecords.yaml"));
	const state = JSON.parse(fs.readFileSync(path.join(root, ".sequoia-state.json"), "utf8"));
	const missing = [];
	for (const file of fs.readdirSync(stageDir)) {
		if (!file.endsWith(".md")) continue;
		const standardPath = fs.readFileSync(path.join(stageDir, file), "utf8").match(/^standardPath: "(.*)"$/m)?.[1];
		if (records[standardPath] && !state.posts?.[`.sequoia/content/${file}`]) missing.push(standardPath);
	}
	assert.deepEqual(missing.slice(0, 10), [], `${missing.length} mapped document(s) have no state entry and would be re-created`);
});
