/**
 * Production build orchestrator.
 *
 * Replaces the serial `&&` chain that `build:netlify` used to be. Two savings:
 * independent post-Eleventy steps now overlap, and ~8 `npm run` process spawns are gone.
 *
 *   Phase A   nanoids:check ∥ standard:check      (read-only validators)
 *             then sitemaps:generate              (must precede Eleventy: _data/sitemapIndex.js
 *                                                  and the public/ passthrough read its output)
 *   Phase B   eleventy
 *   Phase C   { css:purge → css:optimize } ∥ run-pagefind ∥ { sitemaps:check → oai:validate }
 *
 * Phase C members are genuinely independent: pagefind reads _site HTML and never CSS; the
 * CSS chain rewrites only _site/css/*.css; the validators read public/sitemaps and _site XML.
 * oai:validate:quick is kept in its own serial group because scripts/validate-oai-pmh.mjs
 * writes (it patches the XML schemaLocation) and nothing else may touch that file concurrently.
 *
 * Every step remains available as its own `npm run <name>` for standalone debugging; the
 * definitions here mirror package.json.
 */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const BIN = path.join(process.cwd(), "node_modules", ".bin");

const ELEVENTY_ENV = {
	SKIP_IMAGE_PROCESSING: "1",
	NODE_OPTIONS: "--max-old-space-size=4096",
	ELEVENTY_RUN_MODE: "build",
};

const STEPS = {
	"nanoids:check": ["node", ["scripts/generate-nanoids.mjs", "--check"], {}],
	"standard:check": ["node", ["scripts/check-standard-site.mjs"], {}],
	"sitemaps:generate": ["node", ["scripts/generate-local-sitemaps.mjs"], {}],
	eleventy: [path.join(BIN, "eleventy"), ["--quiet"], ELEVENTY_ENV],
	"sitemaps:check": ["node", ["scripts/check-sitemaps.mjs"], {}],
	"oai:validate:quick": ["node", ["scripts/validate-oai-pmh.mjs"], { OAI_VALIDATE_LEVEL: "quick" }],
	"css:purge": [
		path.join(BIN, "purgecss"),
		[
			"--css", "_site/css/bs.css",
			"--content", "_site/**/*.html",
			"--output", "_site/css/",
			"--safelist", "show", "showing", "collapsing", "collapse", "modal-backdrop", "fade", "offcanvas-backdrop",
		],
		{},
	],
	"css:optimize": ["node", ["scripts/optimize-css.mjs"], {}],
	pagefind: ["node", ["_config/run-pagefind.js"], { NODE_OPTIONS: "--max-old-space-size=4096" }],
};

const timings = [];

function run(name) {
	const step = STEPS[name];
	if (!step) return Promise.reject(new Error(`unknown build step: ${name}`));
	const [command, args, env] = step;
	const started = Date.now();

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			env: { ...process.env, ...env },
		});
		child.on("error", reject);
		child.on("close", (code) => {
			const seconds = ((Date.now() - started) / 1000).toFixed(1);
			timings.push({ name, seconds });
			if (code === 0) {
				console.log(`[build] ${name} ok (${seconds}s)`);
				resolve();
			} else {
				reject(new Error(`${name} exited with code ${code}`));
			}
		});
	});
}

// Run steps one after another; used for the ordered groups inside a parallel phase.
async function series(...names) {
	for (const name of names) await run(name);
}

async function main() {
	const wallStart = Date.now();

	// Phase A -- validators are read-only and independent of each other.
	await Promise.all([run("nanoids:check"), run("standard:check")]);
	// Ordering constraint: Eleventy reads what this writes.
	await run("sitemaps:generate");

	// Phase B
	await rm("_site", { recursive: true, force: true });
	await run("eleventy");

	// Phase C -- three independent chains.
	await Promise.all([
		series("css:purge", "css:optimize"),
		run("pagefind"),
		series("sitemaps:check", "oai:validate:quick"),
	]);

	const total = ((Date.now() - wallStart) / 1000).toFixed(1);
	console.log(`\n[build] step times: ${timings.map((t) => `${t.name} ${t.seconds}s`).join(", ")}`);
	console.log(`[build] wall clock: ${total}s`);
}

main().catch((error) => {
	console.error(`[build] FAILED: ${error.message}`);
	process.exitCode = 1;
});
