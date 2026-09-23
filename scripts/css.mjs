/**
 * Post-Eleventy CSS step, in one process:
 *
 *   node scripts/css.mjs            purge then optimize (what the build runs)
 *   node scripts/css.mjs purge      PurgeCSS over _site/css/bs.css against the built HTML
 *   node scripts/css.mjs optimize   css-dedup (safe mode) + lightningcss minify over _site/css/*.css
 *
 * Purge scans every HTML file except the ~4,900 template-generated taxonomy pages (one tag, one
 * keyword, one category per template), which are all rendered from the same layout as their
 * siblings. One sample from each skipped directory is still scanned so a class used only on that
 * layout survives. Measured: byte-identical output, ~4,900 fewer files read.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dedup } from "css-dedup";
import { transform } from "lightningcss";
import { PurgeCSS } from "purgecss";

const SITE_DIR = "_site";
const PURGE_TARGET = `${SITE_DIR}/css/bs.css`;
const SAFELIST = ["show", "showing", "collapsing", "collapse", "modal-backdrop", "fade", "offcanvas-backdrop"];
// Directories whose per-term pages are all instances of one paginated template.
const TAXONOMY_DIRS = ["archives/keywords", "tags", "religioustheory/tags", "religioustheory/categories"];
const CSS_FILES = ["_site/css/bs.css", "_site/css/index.css", "_site/css/font.css", "_site/css/speedup.css"];

export function optimizeCss(css, filename = "style.css") {
	const deduped = dedup(css, { from: filename, aggressive: false, savingsOnly: true });
	const { code } = transform({ filename, code: Buffer.from(deduped.css), minify: true });
	return { css: code.toString(), applied: deduped.applied.length, skipped: deduped.skipped.length };
}

export function optimizeFiles(files = CSS_FILES) {
	const outputs = files.map((file) => {
		const input = fs.readFileSync(file, "utf8");
		return { file, before: Buffer.byteLength(input), ...optimizeCss(input, file) };
	});
	for (const output of outputs) {
		fs.writeFileSync(output.file, output.css);
		const after = Buffer.byteLength(output.css);
		console.log(`[css:optimize] ${path.basename(output.file)}: ${output.before} -> ${after} bytes; ${output.applied} safe merge(s), ${output.skipped} skipped`);
	}
	return outputs;
}

/** Content globs for PurgeCSS: everything, minus the taxonomy term pages, plus one sample of each. */
export function purgeContent(siteDir = SITE_DIR) {
	const content = [`${siteDir}/**/*.html`];
	const skippedContentGlobs = [];
	for (const dir of TAXONOMY_DIRS) {
		const full = path.join(siteDir, dir);
		if (!fs.existsSync(full)) continue;
		// Only names of four or more characters are term pages; the A–Z / 0-9 letter index pages
		// under archives/keywords use a different template and must keep being scanned.
		const sample = fs.readdirSync(full, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name.length >= 4)
			.map((entry) => entry.name)
			.sort()
			.find((name) => fs.existsSync(path.join(full, name, "index.html")));
		if (!sample) continue;
		skippedContentGlobs.push(`${siteDir}/${dir}/????*/index.html`);
		// A literal path that exists bypasses skippedContentGlobs (purgecss checks it first).
		content.push(`${siteDir}/${dir}/${sample}/index.html`);
	}
	return { content, skippedContentGlobs };
}

export async function purgeFiles({ css = PURGE_TARGET, siteDir = SITE_DIR } = {}) {
	const { content, skippedContentGlobs } = purgeContent(siteDir);
	const [result] = await new PurgeCSS().purge({ css: [css], content, skippedContentGlobs, safelist: SAFELIST });
	fs.writeFileSync(css, result.css);
	console.log(`[css:purge] ${path.basename(css)}: ${Buffer.byteLength(result.css)} bytes (${skippedContentGlobs.length} taxonomy globs skipped)`);
	return result;
}

const commands = {
	purge: purgeFiles,
	optimize: async () => optimizeFiles(),
	all: async () => { await purgeFiles(); optimizeFiles(); },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const name = process.argv[2] || "all";
	if (!commands[name]) {
		console.error(`usage: node scripts/css.mjs [${Object.keys(commands).join("|")}]`);
		process.exit(2);
	}
	try {
		await commands[name]();
	} catch (error) {
		console.error(`[css] ${error.message}`);
		process.exitCode = 1;
	}
}
