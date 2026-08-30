/**
 * Search the ORCID public registry for JCRT authors that have no `orcid:` in
 * their front matter, and report ranked candidate iDs with a confidence score.
 *
 * This script NEVER edits content. It writes a review file; a second pass
 * (--apply) writes only the rows a human has marked `confirm: true`.
 *
 *   node scripts/orcid-lookup.mjs                    # look up missing, write report
 *   node scripts/orcid-lookup.mjs --limit 25         # try a sample first
 *   node scripts/orcid-lookup.mjs --only holdier     # slug substring filter
 *   node scripts/orcid-lookup.mjs --deep             # check candidate works for JCRT articles
 *   node scripts/orcid-lookup.mjs --openalex         # add OpenAlex corroboration
 *   node scripts/orcid-lookup.mjs --apply            # write confirmed rows to front matter
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const AUTHORS_DIR = path.join(ROOT, "content", "authors");
const CACHE_DIR = path.join(ROOT, ".cache", "orcid");
// Deliberately NOT in _data/ — Eleventy would load it into the global data cascade.
const REPORT_FILE = path.join(ROOT, "output", "orcid-candidates.yaml");

const ORCID_API = "https://pub.orcid.org/v3.0/expanded-search/";
const OPENALEX_API = "https://api.openalex.org/authors";
const MAILTO = "adam@adamdjbrett.com"; // OpenAlex polite pool
const TOKEN = process.env.ORCID_ACCESS_TOKEN || ""; // optional: raises rate limits
const THROTTLE_MS = Number(process.env.ORCID_THROTTLE_MS || 500);

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f) => {
	const i = argv.indexOf(f);
	return i === -1 ? null : argv[i + 1];
};

/* ------------------------------------------------------------------ files */

function parseFrontMatter(source) {
	const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return null;
	let data = {};
	try {
		data = yaml.load(match[1]) || {};
	} catch {
		return null;
	}
	return { block: match[1], bodyStart: match[0].length, data };
}

function readAuthors() {
	return fs
		.readdirSync(AUTHORS_DIR)
		.filter((n) => n.endsWith(".md") && n !== "index.md")
		.sort()
		.map((name) => {
			const file = path.join(AUTHORS_DIR, name);
			const parsed = parseFrontMatter(fs.readFileSync(file, "utf8"));
			if (!parsed?.data?.name) return null;
			return {
				slug: name.replace(/\.md$/, ""),
				file,
				name: String(parsed.data.name).trim(),
				affiliation: String(parsed.data.affiliation || "").trim(),
				orcid: String(parsed.data.orcid || "").trim(),
			};
		})
		.filter(Boolean);
}

/* ------------------------------------------------------------------ names */

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "ph.d.", "dr"]);

function splitName(full) {
	const parts = full
		.replace(/[,]/g, " ")
		.split(/\s+/)
		.map((p) => p.trim())
		.filter(Boolean)
		.filter((p) => !NAME_SUFFIXES.has(p.toLowerCase().replace(/\./g, "")));
	if (parts.length === 0) return null;
	if (parts.length === 1) return { given: "", family: parts[0], givenParts: [] };
	const family = parts[parts.length - 1];
	const givenParts = parts.slice(0, -1);
	return { given: givenParts.join(" "), family, givenParts };
}

const isInitial = (token) => /^[A-Za-z]\.?$/.test(token);
const initialOf = (token) => token.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();

/* ------------------------------------------------- institution comparison */

const ORG_STOPWORDS = new Set([
	"university", "universite", "universität", "universidad", "college", "school",
	"institute", "institut", "academy", "center", "centre", "department", "dept",
	"faculty", "seminary", "of", "the", "at", "for", "and", "in", "de", "la", "des",
	"state", "national", "international", "research", "studies", "program", "usa",
	"us", "uk", "inc", "llc", "foundation", "society", "association", "graduate",
	"katholieke", "universiteit", "hochschule", "campus", "system",
]);

function orgTokens(text) {
	return new Set(
		String(text || "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2 && !ORG_STOPWORDS.has(t))
	);
}

/**
 * Token overlap alone is not enough: "University of New South Wales" and "All
 * Wales Higher Surgical Training Programme" share a token but are not the same
 * place. So we also require the two names to be substantially the SAME name --
 * measured as shared/union over distinctive tokens. A single incidental token
 * inside two otherwise-different names scores as weak, not as a match.
 *
 * The JCRT `affiliation` field is often a comma-separated list of several
 * institutions, so each segment is compared separately and the best wins.
 */
function institutionOverlap(affiliation, institutionNames) {
	const segments = String(affiliation || "")
		.split(",")
		.map((seg) => orgTokens(seg))
		.filter((set) => set.size > 0);
	const whole = orgTokens(affiliation);
	if (whole.size) segments.push(whole);

	let best = { score: 0, matched: null, shared: [], ratio: 0, strong: false };
	for (const inst of institutionNames || []) {
		const have = orgTokens(inst);
		if (!have.size) continue;
		for (const want of segments) {
			const shared = [...want].filter((t) => have.has(t));
			if (!shared.length) continue;
			const union = new Set([...want, ...have]).size;
			const ratio = shared.length / union;
			if (ratio > best.ratio || (ratio === best.ratio && shared.length > best.score)) {
				best = {
					score: shared.length,
					matched: inst,
					shared,
					ratio,
					strong: ratio >= 0.5 || shared.length >= 2,
				};
			}
		}
	}
	return best;
}

/* -------------------------------------------------------------- http/cache */

fs.mkdirSync(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

function cacheKey(url) {
	return path.join(CACHE_DIR, Buffer.from(url).toString("base64url").slice(0, 180) + ".json");
}

async function getJson(url, headers = {}) {
	const cached = cacheKey(url);
	if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));

	for (let attempt = 0; attempt < 5; attempt += 1) {
		const wait = THROTTLE_MS - (Date.now() - lastCall);
		if (wait > 0) await sleep(wait);
		lastCall = Date.now();

		const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
		if (res.ok) {
			const json = await res.json();
			fs.writeFileSync(cached, JSON.stringify(json));
			return json;
		}
		if (res.status === 429 || res.status >= 500) {
			const backoff = 2000 * 2 ** attempt;
			process.stderr.write(`  ${res.status} — backing off ${backoff}ms\n`);
			await sleep(backoff);
			continue;
		}
		throw new Error(`${res.status} ${res.statusText} for ${url}`);
	}
	throw new Error(`gave up after retries: ${url}`);
}

function orcidSearch(query, rows = 20) {
	const url = `${ORCID_API}?${new URLSearchParams({ q: query, rows: String(rows) })}`;
	return getJson(url, TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {});
}

/* ------------------------------------------------------------------ score */

const esc = (s) => s.replace(/["\\]/g, " ").trim();

function buildQueries(parsed, affiliation) {
	const family = esc(parsed.family);
	const queries = [];
	const spelled = parsed.givenParts.filter((p) => !isInitial(p));
	if (spelled.length) {
		queries.push(`family-name:"${family}" AND given-names:"${esc(spelled[0])}"`);
	}
	// Common surnames drown the bare family-name search, so scope one tier by
	// the institution we already know about.
	for (const org of String(affiliation || "").split(",").map((o) => esc(o)).filter(Boolean).slice(0, 2)) {
		queries.push(`family-name:"${family}" AND affiliation-org-name:"${org}"`);
	}
	// Initials-only names ("A. G. Holdier"): family name alone, then rank the
	// candidates on initials + affiliation.
	queries.push(`family-name:"${family}"`);
	return queries;
}

function scoreCandidate(author, parsed, result) {
	const given = String(result["given-names"] || "");
	const credit = String(result["credit-name"] || "");
	const institutions = result["institution-name"] || [];
	const reasons = [];
	let score = 0;

	const ourFirst = parsed.givenParts[0] || "";
	const theirFirst = given.split(/\s+/)[0] || "";
	if (ourFirst && theirFirst) {
		if (ourFirst.toLowerCase() === theirFirst.toLowerCase()) {
			score += 3;
			reasons.push("given name matches");
		} else if (isInitial(ourFirst) && initialOf(ourFirst) === initialOf(theirFirst)) {
			score += 1;
			reasons.push(`initial ${initialOf(ourFirst)}. matches "${theirFirst}"`);
		} else if (credit.toLowerCase().includes(author.name.toLowerCase())) {
			score += 2;
			reasons.push("credit name matches");
		} else {
			score -= 2;
			reasons.push(`given name differs ("${theirFirst}")`);
		}
	}

	const inst = institutionOverlap(author.affiliation, institutions);
	if (inst.strong) {
		score += 3 + Math.min(inst.score - 1, 2);
		reasons.push(`affiliation matches "${inst.matched}"`);
	} else if (inst.score > 0) {
		score += 1;
		reasons.push(
			`affiliation only loosely matches "${inst.matched}" ` +
				`(shares just ${inst.shared.map((t) => `"${t}"`).join(", ")}) — verify by hand`
		);
	} else if (author.affiliation && institutions.length) {
		reasons.push("no affiliation overlap");
	} else if (!institutions.length) {
		reasons.push("record lists no institution");
	}

	return { score, reasons, institutions };
}

/**
 * A matching name alone is NOT evidence — ORCID holds millions of records and
 * JCRT has authors listed by initials. "high" requires corroboration beyond the
 * name: a shared institution, a JCRT work on the record, or both.
 */
function confidenceOf(score) {
	if (score >= 6) return "high";
	if (score >= 4) return "medium";
	return "low";
}

/* ------------------------------------------------------ jcrt works index */

const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const JOURNAL_MARKERS = [/cultural and religious theory/i, /\bjcrt\b/i];

const normalizeTitle = (t) =>
	String(t || "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

const normalizeName = (n) => normalizeTitle(n).replace(/\b[a-z]\b/g, "").replace(/\s+/g, " ").trim();

function buildJcrtTitleIndex() {
	const index = new Map();
	const stack = [ARCHIVES_DIR];
	while (stack.length) {
		const dir = stack.pop();
		if (!dir || !fs.existsSync(dir)) continue;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const parsed = parseFrontMatter(fs.readFileSync(full, "utf8"));
			const data = parsed?.data;
			if (!data?.title || !data.author) continue;
			const names = Array.isArray(data.author) ? data.author : [data.author];
			for (const raw of names) {
				const key = normalizeName(raw);
				if (!key || key === "editors") continue;
				if (!index.has(key)) index.set(key, []);
				index.get(key).push(normalizeTitle(data.title));
			}
		}
	}
	return index;
}

/**
 * The decisive check: does this ORCID record already list a JCRT publication —
 * either by journal name, or by the exact title of a JCRT article we credit to
 * this author? A name coincidence will not survive it.
 */
async function checkWorksForJcrt(orcidId, ourTitles) {
	let data;
	try {
		data = await getJson(
			`https://pub.orcid.org/v3.0/${orcidId}/works`,
			TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
		);
	} catch {
		return null;
	}
	const wanted = new Set(ourTitles || []);
	for (const group of data.group || []) {
		for (const summary of group["work-summary"] || []) {
			const title = summary?.title?.title?.value || "";
			const journal = summary?.["journal-title"]?.value || "";
			if (JOURNAL_MARKERS.some((re) => re.test(journal) || re.test(title))) {
				return { kind: "journal", evidence: journal || title };
			}
			const norm = normalizeTitle(title);
			if (norm && wanted.has(norm)) return { kind: "title", evidence: title };
		}
	}
	return null;
}

/* -------------------------------------------------------------- openalex */

async function openAlexCorroborate(author) {
	const url =
		`${OPENALEX_API}?${new URLSearchParams({
			filter: `display_name.search:${author.name}`,
			"per-page": "5",
			mailto: MAILTO,
		})}`;
	try {
		const data = await getJson(url);
		return (data.results || [])
			.filter((a) => a.orcid)
			.map((a) => ({
				orcid: a.orcid.replace(/^https?:\/\/orcid\.org\//, ""),
				name: a.display_name,
				works: a.works_count,
				institutions: (a.last_known_institutions || []).map((i) => i.display_name),
			}));
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------------ apply */

function applyConfirmed() {
	if (!fs.existsSync(REPORT_FILE)) {
		console.error(`No report at ${path.relative(ROOT, REPORT_FILE)} — run without --apply first.`);
		process.exit(1);
	}
	const report = yaml.load(fs.readFileSync(REPORT_FILE, "utf8")) || {};
	let written = 0;
	for (const entry of report.authors || []) {
		if (!entry.confirm) continue;
		const chosen = entry.confirm === true ? entry.candidates?.[0]?.orcid : String(entry.confirm);
		if (!chosen || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(chosen)) {
			console.warn(`skip ${entry.slug}: confirm value is not an ORCID iD`);
			continue;
		}
		const file = path.join(AUTHORS_DIR, `${entry.slug}.md`);
		const source = fs.readFileSync(file, "utf8");
		const parsed = parseFrontMatter(source);
		if (!parsed || parsed.data.orcid) continue;
		const line = `orcid: https://orcid.org/${chosen}`;
		// insert after affiliation:, else before the closing fence
		const block = /^affiliation:.*$/m.test(parsed.block)
			? parsed.block.replace(/^(affiliation:.*)$/m, `$1\n${line}`)
			: `${parsed.block}\n${line}`;
		fs.writeFileSync(file, `---\n${block}\n---\n${source.slice(parsed.bodyStart)}`);
		written += 1;
		console.log(`  wrote ${chosen} → ${entry.slug}`);
	}
	console.log(`\nApplied ${written} ORCID iD(s).`);
}

/* ------------------------------------------------------------------- main */

async function main() {
	if (hasFlag("--apply")) return applyConfirmed();

	const only = flagValue("--only");
	const limit = Number(flagValue("--limit") || 0);
	const withOpenAlex = hasFlag("--openalex");
	const deep = hasFlag("--deep");
	const jcrtTitles = deep ? buildJcrtTitleIndex() : new Map();

	let authors = readAuthors().filter((a) => !a.orcid);
	if (only) authors = authors.filter((a) => a.slug.includes(only));
	if (limit > 0) authors = authors.slice(0, limit);

	console.log(`Checking ${authors.length} author(s) without an ORCID iD…\n`);

	const out = [];
	const tally = { high: 0, medium: 0, low: 0, none: 0 };

	for (const [i, author] of authors.entries()) {
		const parsed = splitName(author.name);
		if (!parsed?.family) continue;

		const seen = new Map();
		let crowded = null;
		for (const query of buildQueries(parsed, author.affiliation)) {
			let data;
			try {
				data = await orcidSearch(query);
			} catch (error) {
				process.stderr.write(`  ${author.slug}: ${error.message}\n`);
				continue;
			}
			const results = data["expanded-result"] || [];
			// A bare family-name search that returns a crowd is not evidence.
			if (data["num-found"] > 40) {
				crowded = data["num-found"];
				continue;
			}
			for (const result of results) {
				if (!seen.has(result["orcid-id"])) seen.set(result["orcid-id"], result);
			}
			if ([...seen.values()].some((r) => scoreCandidate(author, parsed, r).score >= 6)) break;
		}

		const candidates = [...seen.values()]
			.map((result) => {
				const { score, reasons, institutions } = scoreCandidate(author, parsed, result);
				return {
					orcid: result["orcid-id"],
					name: [result["given-names"], result["family-names"]].filter(Boolean).join(" "),
					institutions,
					score,
					why: reasons.join("; "),
				};
			})
			.filter((c) => c.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5);

		// Deep pass: ask each plausible candidate's ORCID record whether it already
		// lists a JCRT publication. This is what turns a guess into a match.
		if (deep && candidates.length) {
			const ourTitles = jcrtTitles.get(normalizeName(author.name)) || [];
			for (const candidate of candidates.slice(0, 3)) {
				const proof = await checkWorksForJcrt(candidate.orcid, ourTitles);
				if (!proof) continue;
				candidate.score += 6;
				candidate.why += `; ORCID record lists a JCRT work (${proof.kind}: "${proof.evidence}")`;
			}
			candidates.sort((a, b) => b.score - a.score);
		}

		const confidence = candidates.length
			? confidenceOf(candidates[0].score)
			: "none";
		tally[confidence] += 1;

		const entry = {
			slug: author.slug,
			name: author.name,
			affiliation: author.affiliation || null,
			confidence,
			confirm: false,
			candidates,
		};
		if (crowded && confidence !== "high") {
			entry.note =
				`"${parsed.family}" matches ${crowded} ORCID records; only the narrow ` +
				`(given-name / affiliation) queries were used, so "none" here means ` +
				`"not found by those", not "not registered".`;
		}

		if (withOpenAlex && confidence !== "high") {
			const alex = await openAlexCorroborate(author);
			if (alex.length) entry.openalex = alex;
			for (const a of alex) {
				const hit = candidates.find((c) => c.orcid === a.orcid);
				if (hit) {
					hit.score += 2;
					hit.why += "; corroborated by OpenAlex";
				}
			}
			entry.candidates.sort((a, b) => b.score - a.score);
			if (entry.candidates.length) {
				entry.confidence = confidenceOf(entry.candidates[0].score);
			}
		}

		out.push(entry);
		const top = entry.candidates[0];
		console.log(
			`[${i + 1}/${authors.length}] ${author.name} → ${entry.confidence}` +
				(top ? ` ${top.orcid} (${top.why})` : " no candidate")
		);
	}

	fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
	fs.writeFileSync(
		REPORT_FILE,
		`# Generated by scripts/orcid-lookup.mjs — review, then set \`confirm: true\`\n` +
			`# (or confirm: 0000-0000-0000-0000 to pick a non-top candidate) and run --apply.\n` +
			yaml.dump({ authors: out }, { lineWidth: 100, noRefs: true })
	);

	console.log(
		`\nhigh ${tally.high} · medium ${tally.medium} · low ${tally.low} · none ${tally.none}` +
			`\nReport: ${path.relative(ROOT, REPORT_FILE)}`
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
