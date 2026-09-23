/**
 * Standard.site / AT Protocol tooling, one file, one subcommand each:
 *
 *   node scripts/sequoia.mjs stage          content/** → .sequoia/content/*.md (sequoia-cli's input)
 *   node scripts/sequoia.mjs publication    put the site.standard.publication record (+ icon blob)
 *   node scripts/sequoia.mjs records        .sequoia/content atUri → _data/standardSiteRecords.yaml
 *   node scripts/sequoia.mjs prune          delete orphaned site.standard.document records on the PDS
 *                                           (--dry-run lists without login; --max N caps deletes, default 4000)
 *
 * Why `stage` writes an atUri line — read this before touching it.
 * sequoia-cli decides per staged file: no state entry → create; state.contentHash ≠ sha256(file) →
 * frontmatter.atUri ? update : create. After a create it inserts `atUri: "<uri>"` as the last line
 * before the closing `---` and stores the hash of THAT text. A staging step that regenerates files
 * without the line therefore mismatches every hash, finds no atUri, and re-creates every document
 * with a fresh record key on every run (1,666 new records per push, the PDS hourly write limit,
 * and a second full Netlify deploy each time). Emitting the line byte-for-byte as the CLI would
 * makes unchanged documents hash-match ("All posts are up to date") and edited ones update in
 * place. scripts/sequoia.test.mjs pins the byte format against a copy of the CLI's inserter.
 *
 * Env (publication/prune): ATP_SERVICE (default https://bsky.social), ATP_IDENTIFIER (default
 * jcrt.org), ATP_APP_PASSWORD.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

import { stripMarkdown } from "../_config/markdownTitle.js";
import { parseFrontMatter, readYaml } from "./lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "./lib/walk.mjs";
import { documentPathFor, normalizePath } from "./lib/paths.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const STAGE_DIR = path.join(ROOT, ".sequoia", "content");
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const SEQUOIA_CONFIG_FILE = path.join(ROOT, "sequoia.json");
export const PUBLICATION_ICON_FILE = path.join(ROOT, "public", "images", "logos", "standard-site-icon.webp");
const DEFAULT_SERVICE = "https://bsky.social";
const SITE_NAME = "The Journal for Cultural and Religious Theory";
const DOCUMENT_COLLECTION = "site.standard.document";

// ---------------------------------------------------------------- shared helpers

function requireEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function serviceUrl() {
	return String(process.env.ATP_SERVICE || DEFAULT_SERVICE).replace(/\/$/, "");
}

async function xrpc(service, method, body, accessJwt = "") {
	const response = await fetch(`${service}/xrpc/${method}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(accessJwt ? { authorization: `Bearer ${accessJwt}` } : {}),
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	const data = text ? JSON.parse(text) : {};
	if (!response.ok) {
		const detail = data?.message || data?.error || text || response.statusText;
		throw new Error(`${method} failed (${response.status}): ${detail}`);
	}
	return { data, headers: response.headers };
}

async function createSession(service) {
	const identifier = String(process.env.ATP_IDENTIFIER || "jcrt.org").trim();
	const password = requireEnv("ATP_APP_PASSWORD");
	const { data: session } = await xrpc(service, "com.atproto.server.createSession", { identifier, password });
	const { did } = readStandardSiteConfig();
	if (did && session.did !== did) {
		throw new Error(`Authenticated DID ${session.did} does not match configured DID ${did}.`);
	}
	return session;
}

export function readStandardSiteConfig() {
	const metadata = readYaml(METADATA_FILE);
	const standard = metadata.standard_site || {};
	return {
		name: String(standard.name || metadata.title || "JCRT").trim(),
		url: String(standard.url || metadata.url || "https://jcrt.org").trim(),
		description: String(standard.description || metadata.description || "").trim(),
		did: String(standard.did || "").trim(),
		publicationAtUri: String(standard.publication_at_uri || "").trim(),
	};
}

/** The site.standard.publication record as put on the PDS. `icon` is the uploaded blob ref. */
export function publicationRecord(config, icon) {
	return {
		$type: "site.standard.publication",
		name: config.name,
		url: config.url,
		description: config.description,
		icon,
	};
}

// ---------------------------------------------------------------- stage

function slugify(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Double-quoted YAML scalar. A "---" inside the string would be found by sequoia-cli's
// front-matter-end search (first "---" after index 4) and the atUri line would land mid-string,
// so runs of three or more dashes are escaped; js-yaml decodes - back to "-".
function yamlString(value) {
	return JSON.stringify(String(value || "")).replace(/-(?=--)/g, "\\u002d");
}

function listValue(value) {
	if (Array.isArray(value)) return value;
	if (!value) return [];
	return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * The staged file for one content file, or null when it does not publish.
 * Pure: exported for scripts/sequoia.test.mjs.
 * @param {string} relPath  path relative to content/
 * @param {string} source   file contents
 * @param {Record<string,string>} records  standardPath → at:// URI (from standardSiteRecords.yaml)
 * @returns {{ outName: string, standardPath: string, text: string } | null}
 */
export function stagedDocument(relPath, source, records = {}) {
	const { data, body } = parseFrontMatter(source);
	// documentPathFor already drops drafts, unpublished pages, non-article issue pages and
	// anything outside the publishable subtrees.
	const standardPath = documentPathFor(relPath, data);
	if (!standardPath) return null;
	const title = stripMarkdown(data.title || data.name || path.posix.basename(relPath, ".md"));
	const description = data.description || data.abstract || data.bio || "";
	const date = data.date || (data.year ? `${data.year}-01-01` : "1999-01-01");
	const tags = [...new Set([...listValue(data.tags), ...listValue(data.keywords), ...listValue(data.categories)])];
	const atUri = records[standardPath];
	const frontmatter = [
		"---",
		`title: ${yamlString(title)}`,
		`description: ${yamlString(description)}`,
		`date: ${yamlString(date)}`,
		`standardPath: ${yamlString(standardPath)}`,
		`publicationName: ${yamlString(SITE_NAME)}`,
		tags.length ? `tags: [${tags.map(yamlString).join(", ")}]` : "",
		"draft: false",
		// Must be the last line and byte-identical to what sequoia-cli inserts after a create
		// (`atUri: "<uri>"` directly before the closing delimiter) so the stored hash matches.
		atUri ? `atUri: ${JSON.stringify(atUri)}` : "",
		"---",
		"",
	].filter(Boolean).join("\n");
	return {
		outName: `${slugify(standardPath) || slugify(title)}.md`,
		standardPath,
		text: `${frontmatter}\n${body.trim()}\n`,
	};
}

async function stage() {
	const records = readYaml(RECORDS_FILE);
	fs.rmSync(STAGE_DIR, { recursive: true, force: true });
	fs.mkdirSync(STAGE_DIR, { recursive: true });
	let count = 0;
	let withUri = 0;
	for (const filePath of walkFiles(CONTENT_DIR, { match: isMarkdown })) {
		const staged = stagedDocument(path.relative(CONTENT_DIR, filePath), fs.readFileSync(filePath, "utf8"), records);
		if (!staged) continue;
		fs.writeFileSync(path.join(STAGE_DIR, staged.outName), staged.text);
		count += 1;
		if (records[staged.standardPath]) withUri += 1;
	}
	console.log(`[sequoia] staged ${count} documents in ${path.relative(ROOT, STAGE_DIR)} (${withUri} carry an existing atUri, ${count - withUri} new)`);
}

// ---------------------------------------------------------------- publication

async function uploadIcon(service, accessJwt) {
	const response = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
		method: "POST",
		headers: { "content-type": "image/webp", authorization: `Bearer ${accessJwt}` },
		body: fs.readFileSync(PUBLICATION_ICON_FILE),
	});
	const data = await response.json();
	if (!response.ok) throw new Error(`Icon upload failed (${response.status}): ${data?.message || data?.error || response.statusText}`);
	return data.blob;
}

async function publication() {
	const service = serviceUrl();
	const session = await createSession(service);
	const icon = await uploadIcon(service, session.accessJwt);
	const { data: result } = await xrpc(
		service,
		"com.atproto.repo.putRecord",
		{
			repo: session.did,
			collection: "site.standard.publication",
			rkey: "jcrt",
			record: publicationRecord(readStandardSiteConfig(), icon),
			validate: false,
		},
		session.accessJwt,
	);
	console.log(`Published Standard.site publication record: ${result.uri}`);
}

// ---------------------------------------------------------------- records

async function records() {
	const map = readYaml(RECORDS_FILE);
	let added = 0;
	let updated = 0;
	let missing = 0;
	for (const filePath of walkFiles(STAGE_DIR, { match: isMarkdown })) {
		const { data } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		const documentPath = normalizePath(data.standardPath);
		const atUri = String(data.atUri || data.standard_site_document || "").trim();
		if (!documentPath) continue;
		if (!atUri.startsWith("at://")) {
			missing += 1;
			continue;
		}
		if (!map[documentPath]) added += 1;
		else if (map[documentPath] !== atUri) updated += 1;
		map[documentPath] = atUri;
	}
	const header = [
		"# Map canonical JCRT paths to published Standard.site document AT-URIs.",
		"# Generated from .sequoia/content by scripts/sequoia.mjs records.",
		"",
	].join("\n");
	fs.writeFileSync(RECORDS_FILE, `${header}${yaml.dump(map, { lineWidth: 1000, noRefs: true, sortKeys: true })}`, "utf8");
	console.log(`Standard.site records: ${added} added, ${updated} updated, ${Object.keys(map).length} total.`);
	if (missing) console.warn(`Warning: ${missing} staged Sequoia documents do not have atUri values yet.`);
}

// ---------------------------------------------------------------- prune

// TIDs are 13 chars of sortable base32; value >> 10 is microseconds since the epoch.
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
function tidToDate(rkey) {
	let value = 0n;
	for (const char of String(rkey)) {
		const digit = TID_ALPHABET.indexOf(char);
		if (digit < 0) return null;
		value = (value << 5n) | BigInt(digit);
	}
	return new Date(Number((value >> 10n) / 1000n));
}

async function resolvePds(did) {
	const response = await fetch(`https://plc.directory/${did}`);
	if (!response.ok) throw new Error(`plc.directory lookup failed (${response.status}) for ${did}`);
	const doc = await response.json();
	const service = (doc.service || []).find((entry) => entry.id === "#atproto_pds");
	if (!service?.serviceEndpoint) throw new Error(`No #atproto_pds service in the DID document for ${did}`);
	return String(service.serviceEndpoint).replace(/\/$/, "");
}

async function listDocuments(pds, did) {
	const out = [];
	let cursor = "";
	do {
		const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
		url.searchParams.set("repo", did);
		url.searchParams.set("collection", DOCUMENT_COLLECTION);
		url.searchParams.set("limit", "100");
		if (cursor) url.searchParams.set("cursor", cursor);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`listRecords failed (${response.status}) at cursor "${cursor}"`);
		const page = await response.json();
		out.push(...(page.records || []));
		cursor = page.cursor || "";
	} while (cursor);
	return out;
}

function yamlLastCommitTime() {
	const result = spawnSync("git", ["log", "-1", "--format=%cI", "--", path.relative(ROOT, RECORDS_FILE)], { encoding: "utf8" });
	const iso = String(result.stdout || "").trim();
	return iso ? new Date(iso) : new Date();
}

async function prune(args) {
	const dryRun = args.includes("--dry-run");
	const max = Number(args[args.indexOf("--max") + 1]) || 4000;
	const keep = new Set(Object.values(readYaml(RECORDS_FILE)));
	if (keep.size < 1500) throw new Error(`Refusing to prune: only ${keep.size} URIs in ${path.relative(ROOT, RECORDS_FILE)} (expected ≥ 1500).`);

	const sequoiaConfig = JSON.parse(fs.readFileSync(SEQUOIA_CONFIG_FILE, "utf8"));
	const publicationUri = String(sequoiaConfig.publicationUri || readStandardSiteConfig().publicationAtUri || "").trim();
	const did = publicationUri.match(/^at:\/\/([^/]+)\//)?.[1];
	if (!did) throw new Error(`Cannot derive the DID from publicationUri "${publicationUri}".`);

	const pds = await resolvePds(did);
	console.log(`[prune] listing ${DOCUMENT_COLLECTION} records on ${pds} for ${did} …`);
	const listed = await listDocuments(pds, did);
	const listedUris = new Set(listed.map((record) => record.uri));
	const missingKeep = [...keep].filter((uri) => !listedUris.has(uri));
	if (missingKeep.length) {
		throw new Error(`Refusing to prune: ${missingKeep.length} URI(s) in the records map are not on the PDS, e.g. ${missingKeep.slice(0, 3).join(", ")}`);
	}

	// Never delete anything minted after the records map was last committed: a publish run may
	// be in flight and its new URIs are not in the map yet.
	const cutoff = yamlLastCommitTime();
	const candidates = [];
	let skippedRecent = 0;
	let skippedOtherSite = 0;
	for (const record of listed) {
		if (keep.has(record.uri)) continue;
		if (record.value?.site && publicationUri && record.value.site !== publicationUri) {
			skippedOtherSite += 1;
			continue;
		}
		const rkey = record.uri.split("/").pop();
		const minted = tidToDate(rkey);
		if (minted && minted > cutoff) {
			skippedRecent += 1;
			continue;
		}
		candidates.push({ uri: record.uri, rkey });
	}
	console.log(`[prune] listed ${listed.length}, keep ${keep.size}, orphans ${candidates.length}, skipped ${skippedRecent} minted after ${cutoff.toISOString()}, ${skippedOtherSite} other site.`);
	if (dryRun) {
		console.log(`[prune] dry run: would delete up to ${Math.min(max, candidates.length)} of ${candidates.length} orphan(s). Nothing changed.`);
		return;
	}

	const service = serviceUrl();
	const session = await createSession(service);
	if (session.did !== did) throw new Error(`Logged in as ${session.did}, expected ${did}.`);
	let deleted = 0;
	for (let i = 0; i < candidates.length && deleted < max; i += 200) {
		const batch = candidates.slice(i, Math.min(i + 200, candidates.length, i + (max - deleted)));
		const { headers } = await xrpc(service, "com.atproto.repo.applyWrites", {
			repo: session.did,
			writes: batch.map(({ rkey }) => ({ $type: "com.atproto.repo.applyWrites#delete", collection: DOCUMENT_COLLECTION, rkey })),
		}, session.accessJwt);
		deleted += batch.length;
		for (const { uri } of batch) console.log(`[prune] deleted ${uri}`);
		const remaining = Number(headers.get("ratelimit-remaining"));
		if (Number.isFinite(remaining) && remaining < 700) {
			const reset = Number(headers.get("ratelimit-reset"));
			console.log(`[prune] stopping: ${remaining} rate-limit points left; resets at ${Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : "unknown"}.`);
			break;
		}
	}
	console.log(`[prune] deleted ${deleted} orphan record(s); ${candidates.length - deleted} remain.`);
}

// ---------------------------------------------------------------- CLI

const commands = { stage, publication, records, prune };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [name = "", ...args] = process.argv.slice(2);
	if (!commands[name]) {
		console.error(`usage: node scripts/sequoia.mjs <${Object.keys(commands).join("|")}> [flags]`);
		process.exit(2);
	}
	try {
		await commands[name](args);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
