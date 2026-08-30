#!/usr/bin/env node
/**
 * Append missing entries to CHANGELOG.md — one entry per commit, versions
 * incrementing by one from 00.00.00 at the initial commit (two-digit fields,
 * carry at 100). Append-only: existing entries and their hand-written notes are
 * never touched; new commits get a mechanical note from the subject line.
 *
 * Run `npm run changelog` before committing (or `npm run changelog:check` in
 * CI) so the changelog stays current without anyone maintaining it by hand.
 * The commit that carries the changelog update lands in the NEXT run's entries
 * (a file cannot contain its own commit); that one-commit lag is inherent.
 *
 * Usage: node scripts/update-changelog.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(
	import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
	"..",
);
const CHANGELOG = path.join(REPO_ROOT, "CHANGELOG.md");
const CHECK_MODE = process.argv.includes("--check");

function git(args) {
	return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Version for commit index i (0-based from the initial commit): i increments of the last field, carrying at 100. */
function versionFor(index) {
	const patch = index % 100;
	const minor = Math.floor(index / 100) % 100;
	const major = Math.floor(index / 10000) % 100;
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(major)}.${pad(minor)}.${pad(patch)}`;
}

function main() {
	const text = fs.readFileSync(CHANGELOG, "utf8");
	const existing = (text.match(/^## \[/gm) || []).length;
	const commits = git(["log", "--reverse", "--format=%H|%ad|%s", "--date=short"])
		.split("\n")
		.filter(Boolean);

	if (commits.length < existing) {
		console.error(
			`[changelog] ${existing} entries but only ${commits.length} commits — history rewritten? Refusing to guess.`,
		);
		process.exit(1);
	}
	if (commits.length === existing) {
		console.log(`[changelog] current (${existing} entries).`);
		return;
	}

	const missing = commits.slice(existing);
	if (CHECK_MODE) {
		console.error(`[changelog] ${missing.length} commit(s) missing. Run: node scripts/update-changelog.mjs`);
		process.exit(1);
	}

	// New entries, newest first, inserted directly above the current top entry.
	const block = missing
		.map((line, offset) => {
			const [, date, ...subjectParts] = line.split("|");
			const subject = subjectParts.join("|");
			const version = versionFor(existing + offset);
			return `## [${version}] — ${date}\n${subject}\n- Notes: ${subject}.\n`;
		})
		.reverse()
		.join("\n");

	const anchor = text.indexOf("## [");
	if (anchor === -1) {
		console.error("[changelog] no existing entries found; refusing to guess the insertion point.");
		process.exit(1);
	}
	fs.writeFileSync(CHANGELOG, text.slice(0, anchor) + block + "\n" + text.slice(anchor));
	console.log(`[changelog] appended ${missing.length} entr${missing.length === 1 ? "y" : "ies"}; top is now ${versionFor(commits.length - 1)}.`);
}

main();
