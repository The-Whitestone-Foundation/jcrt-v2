/**
 * Production build orchestrator, and the single registry of build steps.
 *
 *   Phase A   test → nanoids:check → standard:check → cms:check   (read-only validators, ~1s
 *             total; serial so a failure is the last thing on screen, not interleaved)
 *             then sitemaps:generate                (must precede Eleventy: _data/sitemapIndex.js
 *                                                    and the public/ passthrough read its output)
 *   Phase B   eleventy
 *   Phase C   { css:purge → css:optimize } ∥ run-pagefind ∥ { sitemaps:check → oai:validate:quick }
 *
 * Phase C members are genuinely independent: pagefind reads _site HTML and never CSS; the
 * CSS chain rewrites only _site/css/*.css; the validators read public/sitemaps and _site XML.
 *
 * Flags:
 *   --serial         run every step one after another in the canonical order (readable logs
 *                    when debugging a failure)
 *   --only <step>    run a single step from STEPS (this is how `npm run css:purge` works, so
 *                    the purgecss arguments live in exactly one place)
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

// Insertion order is the canonical serial order.
const STEPS = {
	test: ["node", ["--test", "scripts/**/*.test.mjs"], {}],
	"nanoids:check": ["node", ["scripts/generate-nanoids.mjs", "--check"], {}],
	"standard:check": ["node", ["scripts/check-standard-site.mjs"], {}],
	"cms:check": ["node", ["scripts/check-cms-fields.mjs"], {}],
	"sitemaps:generate": ["node", ["scripts/generate-local-sitemaps.mjs"], {}],
	eleventy: [path.join(BIN, "eleventy"), ["--quiet"], ELEVENTY_ENV],
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
	"sitemaps:check": ["node", ["scripts/check-sitemaps.mjs"], {}],
	"oai:validate:quick": ["node", ["scripts/validate-oai-pmh.mjs"], { OAI_VALIDATE_LEVEL: "quick" }],
};

const PHASE_A = ["test", "nanoids:check", "standard:check", "cms:check", "sitemaps:generate"];
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

async function series(...names) {
	for (const name of names) await run(name);
}

async function main() {
	const argv = process.argv.slice(2);
	const only = argv[argv.indexOf("--only") + 1];
	if (argv.includes("--only")) {
		await run(only);
		return;
	}

	const wallStart = Date.now();
	if (argv.includes("--serial")) {
		await series(...PHASE_A);
		await rm("_site", { recursive: true, force: true });
		await series(...Object.keys(STEPS).filter((name) => !PHASE_A.includes(name)));
	} else {
		await series(...PHASE_A);
		await rm("_site", { recursive: true, force: true });
		await run("eleventy");
		await Promise.all([
			series("css:purge", "css:optimize"),
			run("pagefind"),
			series("sitemaps:check", "oai:validate:quick"),
		]);
	}

	const total = ((Date.now() - wallStart) / 1000).toFixed(1);
	console.log(`\n[build] step times: ${timings.map((t) => `${t.name} ${t.seconds}s`).join(", ")}`);
	console.log(`[build] wall clock: ${total}s`);
}

main().catch((error) => {
	console.error(`[build] FAILED: ${error.message}`);
	process.exitCode = 1;
});
