import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkFiles, isMarkdown } from "./walk.mjs";

function fixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-"));
	fs.mkdirSync(path.join(dir, "b", ".hidden"), { recursive: true });
	fs.mkdirSync(path.join(dir, "a"), { recursive: true });
	fs.writeFileSync(path.join(dir, "b", "two.md"), "");
	fs.writeFileSync(path.join(dir, "a", "one.md"), "");
	fs.writeFileSync(path.join(dir, "a", "note.PDF"), "");
	fs.writeFileSync(path.join(dir, ".DS_Store"), "");
	fs.writeFileSync(path.join(dir, "b", ".hidden", "secret.md"), "");
	return dir;
}

test("missing directory yields an empty list, no throw", () => {
	assert.deepEqual(walkFiles(path.join(os.tmpdir(), "does-not-exist-" + Date.now())), []);
});

test("sorted by default, filtered by match", () => {
	const dir = fixture();
	const md = walkFiles(dir, { match: isMarkdown }).map((f) => path.relative(dir, f));
	assert.deepEqual(md, ["a/one.md", "b/.hidden/secret.md", "b/two.md"]);
	const pdf = walkFiles(dir, { match: (n) => n.toLowerCase().endsWith(".pdf") }).map((f) => path.relative(dir, f));
	assert.deepEqual(pdf, ["a/note.PDF"]);
	assert.equal(walkFiles(dir).length, 5);
});

test("skipDotfiles drops dot files and dot directories", () => {
	const dir = fixture();
	const all = walkFiles(dir, { skipDotfiles: true }).map((f) => path.relative(dir, f));
	assert.deepEqual(all, ["a/note.PDF", "a/one.md", "b/two.md"]);
});
