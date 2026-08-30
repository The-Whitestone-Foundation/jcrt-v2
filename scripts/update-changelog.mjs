#!/usr/bin/env node
/**
 * Append missing entries to CHANGELOG.md — one entry per commit, versions
 * incrementing by one from 00.00.00 at the initial commit (two-digit fields,
 * carry at 100).
 *
 * A changelog that logs its own maintenance commits is a commit generator:
 * writing an entry makes a commit, that commit needs an entry, which makes
 * another commit, forever. So commits that touch NOTHING BUT CHANGELOG.md are
 * skipped and never get an entry. That is what terminates the loop; do not
 * "fix" it by removing the filter.
 *
 * The companion rule lives in the tooling that calls this: never create a
 * commit whose only content is the changelog. The prepare-commit-msg hook puts
 * each entry inside the commit it describes, and CI only commits the changelog
 * alongside something else.
 *
 * Append-only: existing entries and any hand-written notes under them are never
 * touched; new commits get a mechanical note from the subject line.
 *
 * Usage: node scripts/update-changelog.mjs [--check] [--pending "<subject>"]
 *   --check    exit non-zero if entries are missing (CI guard)
 *   --pending  also write an entry for a commit being made right now, using
 *              this subject; used by the prepare-commit-msg hook
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
const pendingIdx = process.argv.indexOf("--pending");
const PENDING = pendingIdx === -1 ? null : process.argv[pendingIdx + 1];

const RS = "\x1e"; // record separator; safe inside a git pretty format

function git(args) {
	return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Version for entry index i (0-based): i increments of the last field, carrying at 100. */
function versionFor(index) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(Math.floor(index / 10000) % 100)}.${pad(Math.floor(index / 100) % 100)}.${pad(index % 100)}`;
}

/** Commits oldest-first, excluding those whose entire diff is CHANGELOG.md. */
function loggableCommits() {
	const raw = git(["log", "--reverse", `--format=${RS}%H|%ad|%s`, "--name-only", "--date=short"]);
	const out = [];
	for (const record of raw.split(RS)) {
		if (!record.trim()) continue;
		const [header, ...rest] = record.split("\n");
		const [, date, ...subjectParts] = header.split("|");
		const files = rest.map((f) => f.trim()).filter(Boolean);
		// Merge commits list no files under --name-only; they are real commits, so
		// only an explicitly changelog-only diff is skipped.
		if (files.length > 0 && files.every((f) => f === "CHANGELOG.md")) continue;
		out.push({ date, subject: subjectParts.join("|") });
	}
	return out;
}

function entryFor(index, date, subject) {
	return `## [${versionFor(index)}] — ${date}\n${subject}\n- Notes: ${subject}.\n`;
}

function main() {
	const text = fs.readFileSync(CHANGELOG, "utf8");
	const existing = (text.match(/^## \[/gm) || []).length;
	const commits = loggableCommits();

	if (commits.length < existing) {
		console.error(
			`[changelog] ${existing} entries but only ${commits.length} loggable commits — history rewritten? Refusing to guess.`,
		);
		process.exit(1);
	}

	const missing = commits.slice(existing);
	const pending = PENDING ? [{ date: new Date().toISOString().slice(0, 10), subject: PENDING }] : [];
	const toWrite = [...missing, ...pending];

	if (toWrite.length === 0) {
		if (!CHECK_MODE) console.log(`[changelog] current (${existing} entries).`);
		return;
	}
	if (CHECK_MODE) {
		console.error(`[changelog] ${missing.length} commit(s) missing. Run: npm run changelog`);
		process.exit(1);
	}

	const block = toWrite
		.map((c, offset) => entryFor(existing + offset, c.date, c.subject))
		.reverse()
		.join("\n");

	const anchor = text.indexOf("## [");
	if (anchor === -1) {
		console.error("[changelog] no existing entries found; refusing to guess the insertion point.");
		process.exit(1);
	}
	fs.writeFileSync(CHANGELOG, text.slice(0, anchor) + block + "\n" + text.slice(anchor));
	console.log(
		`[changelog] added ${toWrite.length} entr${toWrite.length === 1 ? "y" : "ies"}; top is now ${versionFor(existing + toWrite.length - 1)}.`,
	);
}

main();
