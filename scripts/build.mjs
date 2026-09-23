/**
 * Production build orchestrator, and the single registry of build steps.
 *
 *   Phase A   test → nanoids:check → standard:check → cms:check   (read-only validators, ~1s
 *             total; serial so a failure is the last thing on screen, not interleaved)
 *             then sitemaps:generate                (must precede Eleventy: _data/sitemapIndex.js
 *                                                    and the public/ passthrough read its output)
 *   Phase B   eleventy
 *   Phase C   css ∥ pagefind ∥ { sitemaps:check → oai:validate:quick → bibliography:check }
 *
 * Phase C members are genuinely independent: pagefind reads _site HTML and never CSS; css
 * rewrites only _site/css/*.css; the validators read public/sitemaps and _site XML.
 *
 * Flags:
 *   --serial   run every step one after another in the canonical order (readable logs when
 *              debugging a failure)
 */

import { spawn } from "node:child_process";
import { access, rename, rm } from "node:fs/promises";
import path from "node:path";

const BIN = path.join(process.cwd(), "node_modules", ".bin");

const ELEVENTY_ENV = {
	SKIP_IMAGE_PROCESSING: "1",
	NODE_OPTIONS: "--max-old-space-size=4096",
	ELEVENTY_RUN_MODE: "build",
};

// Pagefind indexes every HTML file under _site. The Google verification file is HTML too and
// must not be in the search index, so it is parked under a dotfile name for the duration.
const VERIFICATION_FILE = path.join("_site", "googlebfdcfddbdbfcbd99.html");
const PARKED_FILE = path.join("_site", ".googlebfdcfddbdbfcbd99.html.pagefind-skip");

const exists = (file) => access(file).then(() => true, () => false);

async function pagefind() {
	if (await exists(VERIFICATION_FILE)) await rename(VERIFICATION_FILE, PARKED_FILE);
	try {
		await spawnStep(path.join(BIN, "pagefind"), [
			"--site", "_site",
			"--force-language", "en",
			"--root-selector", "[data-pagefind-body]",
			"--exclude-selectors", ".tag-list,aside,[data-pagefind-ignore],.keywords,.categories",
			"--quiet",
		], {});
	} finally {
		if (await exists(PARKED_FILE)) await rename(PARKED_FILE, VERIFICATION_FILE);
	}
}

// Insertion order is the canonical serial order. A step is [command, args, env] or a function.
const STEPS = {
	test: ["node", ["--test", "scripts/**/*.test.mjs"], {}],
	"nanoids:check": ["node", ["scripts/generate-nanoids.mjs", "--check"], {}],
	"standard:check": ["node", ["scripts/check.mjs", "standard"], {}],
	"cms:check": ["node", ["scripts/check.mjs", "cms"], {}],
	"sitemaps:generate": ["node", ["scripts/generate-local-sitemaps.mjs"], {}],
	eleventy: [path.join(BIN, "eleventy"), ["--quiet"], ELEVENTY_ENV],
	css: ["node", ["scripts/css.mjs"], {}],
	pagefind,
	"sitemaps:check": ["node", ["scripts/check.mjs", "sitemaps"], {}],
	"oai:validate:quick": ["node", ["scripts/check.mjs", "oai"], {}],
	"bibliography:check": ["node", ["scripts/check.mjs", "bibliography"], {}],
};

const PHASE_A = ["test", "nanoids:check", "standard:check", "cms:check", "sitemaps:generate"];
const timings = [];

function spawnStep(command, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exited with code ${code}`))));
	});
}

async function run(name) {
	const step = STEPS[name];
	if (!step) throw new Error(`unknown build step: ${name}`);
	const started = Date.now();
	try {
		if (typeof step === "function") await step();
		else await spawnStep(...step);
	} catch (error) {
		throw new Error(`${name} ${error.message}`);
	} finally {
		timings.push({ name, seconds: ((Date.now() - started) / 1000).toFixed(1) });
	}
	console.log(`[build] ${name} ok (${timings.at(-1).seconds}s)`);
}

async function series(...names) {
	for (const name of names) await run(name);
}

async function main() {
	const argv = process.argv.slice(2);
	const wallStart = Date.now();
	await series(...PHASE_A);
	await rm("_site", { recursive: true, force: true });
	if (argv.includes("--serial")) {
		await series(...Object.keys(STEPS).filter((name) => !PHASE_A.includes(name)));
	} else {
		await run("eleventy");
		await Promise.all([
			run("css"),
			run("pagefind"),
			series("sitemaps:check", "oai:validate:quick", "bibliography:check"),
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
