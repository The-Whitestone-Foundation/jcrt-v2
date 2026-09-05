import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontMatter, readYaml } from "./frontmatter.mjs";

test("no front matter: body is the whole source, data is empty", () => {
	const result = parseFrontMatter("# Just markdown\n");
	assert.equal(result.hasFrontMatter, false);
	assert.deepEqual(result.data, {});
	assert.equal(result.body, "# Just markdown\n");
	assert.equal(result.bodyStart, 0);
});

test("block, bodyStart and body reconstruct the original file byte for byte", () => {
	const source = "---\ntitle: One\nnanoid: \"abc\"\n---\nBody text\n";
	const { block, bodyStart, body, data } = parseFrontMatter(source);
	assert.equal(data.title, "One");
	assert.equal(source.slice(bodyStart), body);
	assert.equal(`---\n${block}\n---\n${body}`, source);
});

test("YAML scalars keep their types: folded titles, bare dates, booleans", () => {
	const { data } = parseFrontMatter("---\ntitle: >-\n  Folded\n  title\ndate:\npublished: false\nyear: 2004\n---\n");
	assert.equal(data.title, "Folded title");
	assert.equal(data.date, null);
	assert.equal(data.published, false);
	assert.equal(data.year, 2004);
});

test("malformed YAML never throws; repairKeys retries without the named lines", () => {
	const broken = "---\ntitle: Ok\natproto: at://x'y: [\n---\n";
	assert.deepEqual(parseFrontMatter(broken).data, {});
	assert.equal(parseFrontMatter(broken, { repairKeys: ["atproto"] }).data.title, "Ok");
});

test("readYaml returns the fallback and reports the error", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
	const file = path.join(dir, "x.yaml");
	fs.writeFileSync(file, "a: 1\n");
	assert.deepEqual(readYaml(file), { a: 1 });
	let reported = null;
	assert.deepEqual(readYaml(path.join(dir, "missing.yaml"), { fallback: { none: true }, onError: (e) => (reported = e) }), { none: true });
	assert.ok(reported);
});
