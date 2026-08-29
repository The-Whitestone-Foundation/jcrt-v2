import assert from "node:assert/strict";
import test from "node:test";
import { transform } from "lightningcss";
import { optimizeCss, optimizeFiles } from "./optimize-css.mjs";

test("CSS optimization applies only safe, shrinking deduplication", () => {
	const safe = optimizeCss(".a{color:red}.b{color:red}");
	assert.equal(safe.css, ".a,.b{color:red}");
	assert.equal(safe.applied, 1);

	const unsafeInput = ".a{color:red}.x{color:blue}.b{color:red}";
	const unsafe = optimizeCss(unsafeInput);
	assert.match(unsafe.css, /\.a\{color:red\}/);
	assert.match(unsafe.css, /\.b\{color:red\}/);
	assert.doesNotMatch(unsafe.css, /\.a,\.b/);
	assert.equal(unsafe.skipped, 1);

	assert.throws(() => optimizeFiles(["_site/css/does-not-exist.css"]), /ENOENT/);
	assert.doesNotThrow(() => transform({ code: Buffer.from(safe.css), minify: true }));
});
