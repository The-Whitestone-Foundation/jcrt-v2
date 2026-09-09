import fs from "node:fs";
import path from "node:path";
import { normalizeUrl } from "./lib/paths.mjs";

const SITE_DIR = path.resolve(process.cwd(), "_site");
const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "indexnow-urls.json");
const DEFAULT_SITE_URL = "https://jcrt.org";
const DEFAULT_ENDPOINTS = ["https://api.indexnow.org/indexnow"];
const MAX_URLS_PER_REQUEST = 10000;

const normalizeSiteUrl = (url) => normalizeUrl(url, DEFAULT_SITE_URL);

function readUrlsFromSitemapXml(xml) {
	const urls = [];
	const re = /<loc>([^<]+)<\/loc>/g;
	let match;
	while ((match = re.exec(xml)) !== null) {
		const raw = String(match[1] || "").trim();
		if (!raw) continue;
		if (!/^https?:\/\//i.test(raw)) continue;
		if (raw.endsWith(".xml") || raw.endsWith(".rss") || raw.endsWith(".json") || raw.endsWith(".txt") || raw.endsWith(".xsl")) {
			continue;
		}
		urls.push(raw);
	}
	return urls;
}

function loadCurrentUrlSet() {
	const sitemapFiles = [
		path.join(SITE_DIR, "sitemaps", "sitemap.xml"),
		path.join(SITE_DIR, "religioustheory", "sitemap.xml"),
		path.join(SITE_DIR, "sitemaps", "keywords", "keywords-sitemap.xml"),
	];
	const all = new Set();
	for (const filePath of sitemapFiles) {
		if (!fs.existsSync(filePath)) continue;
		const xml = fs.readFileSync(filePath, "utf8");
		for (const url of readUrlsFromSitemapXml(xml)) {
			all.add(url);
		}
	}
	return all;
}

function loadPreviousUrlSet() {
	if (!fs.existsSync(CACHE_FILE)) return new Set();
	try {
		const raw = fs.readFileSync(CACHE_FILE, "utf8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed?.urls)) return new Set();
		return new Set(parsed.urls.map((u) => String(u || "").trim()).filter(Boolean));
	} catch {
		return new Set();
	}
}

function saveCurrentUrlSet(urlSet) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	fs.writeFileSync(
		CACHE_FILE,
		JSON.stringify({ updatedAt: new Date().toISOString(), urls: [...urlSet].sort() }, null, 2)
	);
}

function chunk(array, size) {
	const out = [];
	for (let i = 0; i < array.length; i += size) {
		out.push(array.slice(i, i + size));
	}
	return out;
}

async function postIndexNow(endpoint, payload) {
	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(payload),
	});
	const body = await res.text();
	return { ok: res.ok, status: res.status, body };
}

async function postWorkerSubmission(endpoint, urls) {
	const body = `${urls.join("\n")}\n`;
	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "text/plain; charset=utf-8",
		},
		body,
	});
	const text = await res.text();
	return { ok: res.ok, status: res.status, body: text };
}

async function run() {
	const indexNowKey = String(process.env.INDEXNOW_KEY || "").trim();
	if (!indexNowKey) {
		console.log("[indexnow] INDEXNOW_KEY not set; skipping submission.");
		return;
	}

	if (!fs.existsSync(SITE_DIR)) {
		console.log("[indexnow] _site directory not found; skipping submission.");
		return;
	}

	const siteUrl = normalizeSiteUrl(process.env.SITE_URL || process.env.URL || DEFAULT_SITE_URL);
	const endpoints = String(process.env.INDEXNOW_ENDPOINTS || "")
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
	const targetEndpoints = endpoints.length > 0 ? endpoints : DEFAULT_ENDPOINTS;
	const workerEndpoint = String(process.env.INDEXNOW_WORKER_ENDPOINT || "").trim();
	const keyLocation = String(process.env.INDEXNOW_KEY_LOCATION || `${siteUrl}/${indexNowKey}.txt`).trim();

	const keyFilePath = path.join(SITE_DIR, `${indexNowKey}.txt`);
	fs.writeFileSync(keyFilePath, `${indexNowKey}\n`);

	const current = loadCurrentUrlSet();
	const previous = loadPreviousUrlSet();
	const submitAll = String(process.env.INDEXNOW_SUBMIT_ALL || "").toLowerCase() === "true";

	let changedUrls = [...current].filter((url) => !previous.has(url));
	if (changedUrls.length === 0 && submitAll) {
		changedUrls = [...current];
	}

	if (changedUrls.length === 0) {
		console.log("[indexnow] No changed URLs detected; nothing to submit.");
		saveCurrentUrlSet(current);
		return;
	}

	changedUrls.sort();
	const batches = chunk(changedUrls, MAX_URLS_PER_REQUEST);
	console.log(`[indexnow] Preparing ${changedUrls.length} URL(s) in ${batches.length} batch(es).`);

	let accepted = 0;
	let rejected = 0;

	for (const batch of batches) {
		const payload = {
			host: new URL(siteUrl).hostname,
			key: indexNowKey,
			keyLocation,
			urlList: batch,
		};
		for (const endpoint of targetEndpoints) {
			try {
				const result = await postIndexNow(endpoint, payload);
				if (result.ok) {
					accepted += 1;
					console.log(`[indexnow] Success ${result.status} -> ${endpoint} (${batch.length} URLs)`);
				} else {
					rejected += 1;
					console.warn(`[indexnow] Non-fatal failure ${result.status} -> ${endpoint}: ${result.body.slice(0, 300)}`);
				}
			} catch (error) {
				rejected += 1;
				console.warn(`[indexnow] Non-fatal request error -> ${endpoint}: ${error?.message || error}`);
			}
		}
		if (workerEndpoint) {
			try {
				const result = await postWorkerSubmission(workerEndpoint, batch);
				if (result.ok) {
					accepted += 1;
					console.log(`[indexnow] Worker accepted ${result.status} -> ${workerEndpoint} (${batch.length} URLs)`);
				} else {
					rejected += 1;
					console.warn(`[indexnow] Worker non-fatal failure ${result.status} -> ${workerEndpoint}: ${result.body.slice(0, 300)}`);
				}
			} catch (error) {
				rejected += 1;
				console.warn(`[indexnow] Worker non-fatal request error -> ${workerEndpoint}: ${error?.message || error}`);
			}
		}
	}

	console.log(`[indexnow] ${accepted} submission(s) accepted, ${rejected} rejected.`);

	if (accepted === 0 && rejected > 0) {
		// A search-engine ping must never break the build, so stay exit 0 — but a run where
		// nothing at all was accepted used to look green while announcing nothing, which is
		// how a 403 SiteVerificationNotCompleted went unnoticed. Surface it as an annotation.
		console.log("::warning title=IndexNow::Every submission was rejected; no URLs were announced.");
		// And do NOT advance the watermark: recording these as submitted would mean they are
		// never retried, so the next run would report "nothing to submit" and drop them.
		return;
	}

	saveCurrentUrlSet(current);
}

run().catch((error) => {
	console.warn(`[indexnow] Non-fatal unexpected error: ${error?.message || error}`);
});
