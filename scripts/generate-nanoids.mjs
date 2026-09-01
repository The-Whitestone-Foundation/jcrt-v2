#!/usr/bin/env node
//
// generate-nanoids.mjs — ensure every content page carries a stable nanoid on
// line 2 of its front matter. New ids use the configured default length.
//
//   node scripts/generate-nanoids.mjs            bulk: fill every content/**/*.md
//                                                that is missing an id
//   node scripts/generate-nanoids.mjs --staged   only fill git-staged content md,
//                                                then re-stage them (pre-commit hook)
//   node scripts/generate-nanoids.mjs --check     report missing ids / duplicates and
//                                                exit non-zero; write nothing (CI guard)
//
// Existing ids are never changed, so ids are permanent once committed. New ids
// are deduped against every id already in use across content/.
//
// Ordering (bulk mode): content/index.md receives the first id, then the
// remaining files are processed by folder, alphabetically.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { NANOID_SIZE, newNanoid } from "./lib/nanoid.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(REPO_ROOT, "content");

const flags = new Set(process.argv.slice(2));
const CHECK = flags.has("--check");
const STAGED = flags.has("--staged");

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
	}
	return out;
}

// Inspect the front matter block for a nanoid key.
//   hasFrontmatter — the file opens with a `---` fenced block
//   nanoidLine     — 0-based index of the `nanoid:` line, or null if absent
//   value          — the current id (quotes stripped), or "" if the key is empty
function inspect(lines) {
	if ((lines[0] ?? "").replace(/\r$/, "") !== "---") {
		return { hasFrontmatter: false, nanoidLine: null, value: "" };
	}
	let fmEnd = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].replace(/\r$/, "") === "---") {
			fmEnd = i;
			break;
		}
	}
	if (fmEnd === -1) return { hasFrontmatter: false, nanoidLine: null, value: "" };
	for (let i = 1; i < fmEnd; i++) {
		const m = lines[i].match(/^nanoid:\s*(.*)$/);
		if (m) {
			const value = m[1].trim().replace(/^["']|["']$/g, "").trim();
			return { hasFrontmatter: true, nanoidLine: i, value };
		}
	}
	return { hasFrontmatter: true, nanoidLine: null, value: "" };
}

// content/index.md first, then everything else by folder, alphabetically.
function order(files) {
	const rel = (f) => path.relative(CONTENT_DIR, f);
	const index = files.filter((f) => rel(f) === "index.md");
	const rest = files
		.filter((f) => rel(f) !== "index.md")
		.sort((a, b) => rel(a).localeCompare(rel(b), "en"));
	return [...index, ...rest];
}

function stagedContentMd() {
	const res = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	return new Set(
		String(res.stdout || "")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((p) => p.startsWith("content/") && p.endsWith(".md"))
			.map((p) => path.join(REPO_ROOT, p)),
	);
}

function main() {
	if (!fs.existsSync(CONTENT_DIR)) {
		console.error(`[nanoids] content dir not found: ${CONTENT_DIR}`);
		process.exit(1);
	}

	const allFiles = walk(CONTENT_DIR);

	// Build the in-use id set across ALL content (needed for dedupe even in
	// --staged mode) and flag any duplicates already committed.
	const used = new Set();
	const duplicates = [];
	for (const file of allFiles) {
		const { value } = inspect(fs.readFileSync(file, "utf8").split("\n"));
		if (!value) continue;
		if (used.has(value)) duplicates.push({ file, value });
		else used.add(value);
	}

	let targets = allFiles;
	if (STAGED) {
		const staged = stagedContentMd();
		targets = allFiles.filter((f) => staged.has(f));
	}

	const assigned = [];
	const missing = [];
	const noFrontmatter = [];

	for (const file of order(targets)) {
		const lines = fs.readFileSync(file, "utf8").split("\n");
		const info = inspect(lines);
		if (info.value) continue; // already has a stable id
		if (!info.hasFrontmatter) {
			noFrontmatter.push(file);
			continue;
		}

		if (CHECK) {
			missing.push(file);
			continue;
		}

		let id;
		do {
			id = newNanoid();
		} while (used.has(id));
		used.add(id);

		if (info.nanoidLine !== null) {
			lines[info.nanoidLine] = `nanoid: "${id}"`;
		} else {
			lines.splice(1, 0, `nanoid: "${id}"`); // line 2, just after the opening ---
		}
		fs.writeFileSync(file, lines.join("\n"));
		assigned.push({ file, id });
	}

	const rel = (f) => path.relative(REPO_ROOT, f);
	for (const d of duplicates) console.warn(`[nanoids] DUPLICATE id ${d.value} -> ${rel(d.file)}`);
	for (const f of noFrontmatter) console.warn(`[nanoids] no front matter, skipped: ${rel(f)}`);

	if (CHECK) {
		for (const f of missing) console.error(`[nanoids] MISSING nanoid: ${rel(f)}`);
		if (missing.length || duplicates.length) {
			console.error(
				`[nanoids] check failed: ${missing.length} missing, ${duplicates.length} duplicate(s). ` +
					`Run \`npm run nanoids:generate\` and commit the result.`,
			);
			process.exit(1);
		}
		console.log(`[nanoids] check passed: all content pages have a unique id (new ids use ${NANOID_SIZE} characters).`);
		return;
	}

	if (STAGED && assigned.length) {
		spawnSync("git", ["add", "--", ...assigned.map((a) => rel(a.file))], {
			cwd: REPO_ROOT,
			stdio: "inherit",
		});
	}

	for (const a of assigned) console.log(`[nanoids] ${a.id}  ${rel(a.file)}`);
	console.log(
		`[nanoids] assigned ${assigned.length} id(s); ${used.size} total in use` +
			(duplicates.length ? `; ${duplicates.length} duplicate(s) need attention` : ""),
	);
}

main();
