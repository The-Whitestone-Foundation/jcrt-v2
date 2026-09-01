/**
 * Purge the Cloudflare edge cache for jcrt.org after a Netlify deploy.
 *
 * jcrt.org is orange-clouded through Cloudflare, and the Cache Rules in
 * jcrt-meta/docs/cloudflare-cache.md give HTML/XML/JSON a long edge TTL that ignores the
 * origin's `max-age=0, must-revalidate`. Without a purge, a new deploy is
 * invisible at the edge until that TTL expires.
 *
 * Usage:
 *   node scripts/cloudflare-purge.mjs                 # purge everything
 *   node scripts/cloudflare-purge.mjs --urls a.html b/  # purge specific paths
 *   node scripts/cloudflare-purge.mjs --dry-run
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   token with Zone → Cache Purge → Purge (jcrt.org only)
 *   CLOUDFLARE_ZONE_ID     zone id for jcrt.org
 *   SITE_URL               defaults to https://jcrt.org
 */

import { pathToFileURL } from "node:url";

const DEFAULT_SITE_URL = "https://jcrt.org";
const API_ROOT = "https://api.cloudflare.com/client/v4";
const MAX_URLS_PER_REQUEST = 30; // Free/Pro plan limit for purge-by-URL

function normalizeSiteUrl(url) {
	const trimmed = String(url || "").trim();
	if (!trimmed) return DEFAULT_SITE_URL;
	return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function parseArgs(argv) {
	const args = { dryRun: false, urls: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--urls") {
			args.urls = argv.slice(i + 1).filter((value) => !value.startsWith("--"));
			i += args.urls.length;
		}
	}
	return args;
}

function toAbsolute(siteUrl, value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	if (/^https?:\/\//i.test(raw)) return raw;
	return `${siteUrl}/${raw.replace(/^\/+/, "")}`;
}

function chunk(items, size) {
	const out = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function purge(zoneId, token, body) {
	const response = await fetch(`${API_ROOT}/zones/${zoneId}/purge_cache`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.success === false) {
		const detail = (payload.errors || []).map((error) => `${error.code}: ${error.message}`).join("; ");
		throw new Error(`Cloudflare purge failed (${response.status})${detail ? ` — ${detail}` : ""}`);
	}
	return payload;
}

// Exported for plugins/cloudflare-purge, which runs on Netlify's onSuccess event.
export async function purgeEverything({ token, zoneId }) {
	return purge(zoneId, token, { purge_everything: true });
}

export async function purgeUrls({ token, zoneId, urls, siteUrl = DEFAULT_SITE_URL }) {
	const absolute = urls.map((value) => toAbsolute(normalizeSiteUrl(siteUrl), value)).filter(Boolean);
	const results = [];
	for (const files of chunk(absolute, MAX_URLS_PER_REQUEST)) {
		results.push(await purge(zoneId, token, { files }));
	}
	return results;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const siteUrl = normalizeSiteUrl(process.env.SITE_URL);
	const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
	const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim();

	const batches = args.urls.length
		? chunk(args.urls.map((value) => toAbsolute(siteUrl, value)).filter(Boolean), MAX_URLS_PER_REQUEST).map((files) => ({ files }))
		: [{ purge_everything: true }];

	if (args.dryRun) {
		for (const body of batches) console.log(JSON.stringify(body, null, 2));
		return;
	}

	if (!token || !zoneId) {
		console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required (use --dry-run to inspect the payload).");
		process.exitCode = 1;
		return;
	}

	for (const body of batches) {
		await purge(zoneId, token, body);
		console.log(body.purge_everything ? "Purged everything." : `Purged ${body.files.length} url(s).`);
	}
}

// Only run the CLI when invoked directly -- plugins/cloudflare-purge imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
