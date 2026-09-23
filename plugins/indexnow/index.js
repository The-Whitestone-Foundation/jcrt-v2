/**
 * Netlify build plugin: announce new sitemap URLs to IndexNow (Bing and friends) once the
 * production deploy is live.
 *
 * onSuccess runs after the deploy stage (and after the UI-installed Cloudflare purge), so crawlers that follow
 * the ping find the new pages instead of the previous deploy. This replaced a GitHub Action
 * that rebuilt the whole site on every push and pinged ~55 s after the push, before Netlify had
 * deployed anything.
 *
 * Only URLs that were not in the previous deploy's sitemaps are submitted. The watermark
 * (.indexnow-urls.json, gitignored) is carried between builds with utils.cache, so this plugin
 * does not depend on netlify-plugin-cache running after it.
 *
 * Env: INDEXNOW_KEY (required; the key is public by protocol and is served at /<key>.txt from
 * public/), INDEXNOW_ENDPOINTS (comma-separated, default https://api.indexnow.org/indexnow),
 * INDEXNOW_KEY_LOCATION, SITE_URL. Skips quietly without the key.
 *
 * Manual run against a built _site: `INDEXNOW_KEY=… npm run indexnow:submit`.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUrl, sitemapLocs } from "../../scripts/lib/paths.mjs";

const DEFAULT_SITE_URL = "https://jcrt.org";
const DEFAULT_ENDPOINTS = ["https://api.indexnow.org/indexnow"];
const MAX_URLS_PER_REQUEST = 10000;
const STATE_FILE = ".indexnow-urls.json";
// Eleventy-rendered sitemaps whose <loc>s are pages (not the OAI/DOAJ/citation feeds).
const SITEMAPS = ["sitemaps/sitemap.xml", "religioustheory/sitemap.xml", "sitemaps/keywords/keywords-sitemap.xml"];

function pageUrls(siteDir) {
	const all = new Set();
	for (const rel of SITEMAPS) {
		const file = path.join(siteDir, rel);
		if (!fs.existsSync(file)) continue;
		for (const url of sitemapLocs(fs.readFileSync(file, "utf8"))) {
			if (!/^https?:\/\//i.test(url) || /\.(?:xml|rss|json|txt|xsl)$/.test(url)) continue;
			all.add(url);
		}
	}
	return all;
}

function readState(stateFile) {
	try {
		const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		return new Set((parsed?.urls || []).map((u) => String(u || "").trim()).filter(Boolean));
	} catch {
		return new Set();
	}
}

function writeState(stateFile, urls) {
	fs.writeFileSync(stateFile, JSON.stringify({ updatedAt: new Date().toISOString(), urls: [...urls].sort() }, null, 2));
}

/**
 * Submit every page URL that is new since the last recorded run. Never throws: a search-engine
 * ping must not fail a deploy. Returns counts for logging.
 *
 * Not exported: Netlify treats every named export of a plugin as a lifecycle event and fails
 * the build on any name it does not know. Only onSuccess may be exported from this file.
 */
async function submitIndexNow({ siteDir = "_site", stateFile = STATE_FILE, env = process.env } = {}) {
	const key = String(env.INDEXNOW_KEY || "").trim();
	if (!key) {
		console.log("[indexnow] INDEXNOW_KEY not set; skipping submission.");
		return { skipped: true };
	}
	if (!fs.existsSync(siteDir)) {
		console.log(`[indexnow] ${siteDir} not found; skipping submission.`);
		return { skipped: true };
	}
	const siteUrl = normalizeUrl(env.SITE_URL || env.URL, DEFAULT_SITE_URL);
	const endpoints = String(env.INDEXNOW_ENDPOINTS || "").split(",").map((v) => v.trim()).filter(Boolean);
	const targets = endpoints.length ? endpoints : DEFAULT_ENDPOINTS;
	const keyLocation = String(env.INDEXNOW_KEY_LOCATION || `${siteUrl}/${key}.txt`).trim();

	const current = pageUrls(siteDir);
	const previous = readState(stateFile);
	const changed = [...current].filter((url) => !previous.has(url)).sort();
	if (changed.length === 0) {
		console.log("[indexnow] No new URLs since the last deploy; nothing to submit.");
		writeState(stateFile, current);
		return { changed: 0, accepted: 0, rejected: 0 };
	}

	const batches = [];
	for (let i = 0; i < changed.length; i += MAX_URLS_PER_REQUEST) batches.push(changed.slice(i, i + MAX_URLS_PER_REQUEST));
	console.log(`[indexnow] Preparing ${changed.length} URL(s) in ${batches.length} batch(es).`);

	let accepted = 0;
	let rejected = 0;
	for (const batch of batches) {
		const payload = { host: new URL(siteUrl).hostname, key, keyLocation, urlList: batch };
		for (const endpoint of targets) {
			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "content-type": "application/json; charset=utf-8" },
					body: JSON.stringify(payload),
				});
				const body = await response.text();
				if (response.ok) {
					accepted += 1;
					console.log(`[indexnow] Success ${response.status} -> ${endpoint} (${batch.length} URLs)`);
				} else {
					rejected += 1;
					console.warn(`[indexnow] Non-fatal failure ${response.status} -> ${endpoint}: ${body.slice(0, 300)}`);
				}
			} catch (error) {
				rejected += 1;
				console.warn(`[indexnow] Non-fatal request error -> ${endpoint}: ${error?.message || error}`);
			}
		}
	}
	console.log(`[indexnow] ${accepted} submission(s) accepted, ${rejected} rejected.`);

	// Do NOT advance the watermark when nothing was accepted: recording these as submitted would
	// mean they are never retried (this is how a 403 SiteVerificationNotCompleted went unnoticed).
	if (accepted > 0 || rejected === 0) writeState(stateFile, current);
	return { changed: changed.length, accepted, rejected };
}

export const onSuccess = async ({ utils, constants }) => {
	if (process.env.CONTEXT !== "production") {
		console.log(`indexnow: context is "${process.env.CONTEXT}", skipping.`);
		return;
	}
	try {
		await utils.cache.restore(STATE_FILE);
		await submitIndexNow({ siteDir: constants.PUBLISH_DIR || "_site", stateFile: STATE_FILE });
		if (fs.existsSync(STATE_FILE)) await utils.cache.save(STATE_FILE);
	} catch (error) {
		utils.build.failPlugin(`indexnow: ${error.message}`);
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await submitIndexNow();
}
