import test from "node:test";
import assert from "node:assert/strict";
import { normalizePath, normalizeUrl, documentPathFor } from "./paths.mjs";

test("normalizePath adds slashes and strips query/hash", () => {
	assert.equal(normalizePath("/a/b?x=1#y"), "/a/b/");
	assert.equal(normalizePath("a/b"), "/a/b/");
	assert.equal(normalizePath(""), "");
});

test("normalizeUrl strips every trailing slash and falls back when empty", () => {
	assert.equal(normalizeUrl("https://x.org//"), "https://x.org");
	assert.equal(normalizeUrl("", "https://jcrt.org/"), "https://jcrt.org");
});

test("documentPathFor follows the site's routing rules", () => {
	assert.equal(documentPathFor("archives/24.2/callan.md", {}), "/archives/24.2/callan/");
	assert.equal(documentPathFor("archives/keywords/x.md", {}), "");
	assert.equal(documentPathFor("archives/24.2/index.md", {}), "");
	assert.equal(documentPathFor("religioustheory/posts/file.md", { slug: "9781" }), "/religioustheory/posts/9781/");
	assert.equal(documentPathFor("blog/post.md", { permalink: "/custom" }), "/custom/");
	assert.equal(documentPathFor("authors/jane.md", { draft: true }), "");
	assert.equal(documentPathFor("authors/jane.md", { published: false }), "");
	assert.equal(documentPathFor("pages/about.md", {}), "");
	assert.equal(documentPathFor("archives\\24.2\\win.md", {}), "/archives/24.2/win/");
});
