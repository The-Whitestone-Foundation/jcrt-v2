import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import standardSite from "../_data/standardSite.js";

const LIMIT = 298;
const SITE_URL = "https://jcrt.org";
const STATE_FILE = new URL("../.social-publish-state.json", import.meta.url);
const CONTENT_PREFIXES = ["/archives/", "/blog/", "/religioustheory/posts/", "/religioustheory/live/"];
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const graphemes = (value) => [...graphemeSegmenter.segment(String(value))].map(({ segment }) => segment);
const length = (value) => graphemes(value).length;

function stableTid(value) {
	const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
	let number = crypto.createHash("sha256").update(value).digest().readBigUInt64BE();
	let tid = "";
	for (let i = 0; i < 13; i += 1) {
		tid = alphabet[Number(number & 31n)] + tid;
		number >>= 5n;
	}
	return tid;
}

function formatPost(document, now = new Date()) {
	const url = `${SITE_URL}${document.path}`;
	const old = now.getTime() - new Date(document.publishedAt).getTime() > 33 * 86_400_000;
	const prefix = old ? "#ICYMI " : "";
	const suffix = ` #acrel #aarsbl ${url}`;
	const cleanTitle = String(document.title).replace(/\s+/g, " ").trim();
	const available = LIMIT - length(prefix) - length(suffix);
	if (available < 2) throw new Error(`URL is too long for a social post: ${url}`);
	const titleParts = graphemes(cleanTitle);
	const title = titleParts.length <= available ? cleanTitle : `${titleParts.slice(0, available - 1).join("")}…`;
	const text = `${prefix}${title}${suffix}`;
	assert(length(text) <= LIMIT, `Post exceeds ${LIMIT} characters.`);
	return { text, url };
}

function facets(text, url) {
	const items = [
		[url, { $type: "app.bsky.richtext.facet#link", uri: url }],
		...["#ICYMI", "#acrel", "#aarsbl"]
			.filter((tag) => text.includes(tag))
			.map((tag) => [tag, { $type: "app.bsky.richtext.facet#tag", tag: tag.slice(1) }]),
	];
	return items.map(([value, feature]) => {
		const start = text.lastIndexOf(value);
		return {
			index: {
				byteStart: Buffer.byteLength(text.slice(0, start)),
				byteEnd: Buffer.byteLength(text.slice(0, start) + value),
			},
			features: [feature],
		};
	});
}

function candidates(now = new Date()) {
	return standardSite().documents
		.filter((document) => CONTENT_PREFIXES.some((prefix) => document.path.startsWith(prefix)))
		.filter((document) => new Date(document.publishedAt) <= now)
		.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.path.localeCompare(b.path));
}

function nextDocument(published, now = new Date()) {
	return candidates(now).find((document) => !published.has(`${SITE_URL}${document.path}`));
}

function readState() {
	try {
		const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
		return { mastodon: state.mastodon || [], bluesky: state.bluesky || [] };
	} catch (error) {
		if (error.code === "ENOENT") return { mastodon: [], bluesky: [] };
		throw error;
	}
}

async function requestJson(url, options) {
	const response = await fetch(url, options);
	const body = await response.text();
	const data = body ? JSON.parse(body) : {};
	if (!response.ok) throw new Error(`${url} failed (${response.status}): ${data.error || data.message || body}`);
	return data;
}

async function publishMastodon(post) {
	const token = process.env.MASTODON_ACCESS_TOKEN;
	if (!token) throw new Error("MASTODON_ACCESS_TOKEN is required.");
	await requestJson("https://mastodon.social/api/v1/statuses", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/x-www-form-urlencoded",
			"idempotency-key": crypto.createHash("sha256").update(post.url).digest("hex"),
		},
		body: new URLSearchParams({ status: post.text, visibility: "public" }),
	});
}

async function publishBluesky(post) {
	const password = process.env.ATPROTO_PASSWORD;
	if (!password) throw new Error("ATPROTO_PASSWORD is required.");
	const session = await requestJson("https://bsky.social/xrpc/com.atproto.server.createSession", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ identifier: process.env.ATPROTO_IDENTIFIER || "jcrt.org", password }),
	});
	await requestJson("https://bsky.social/xrpc/com.atproto.repo.putRecord", {
		method: "POST",
		headers: { authorization: `Bearer ${session.accessJwt}`, "content-type": "application/json" },
		body: JSON.stringify({
			repo: session.did,
			collection: "app.bsky.feed.post",
			rkey: stableTid(post.url),
			record: {
				$type: "app.bsky.feed.post",
				text: post.text,
				facets: facets(post.text, post.url),
				langs: ["en"],
				createdAt: new Date().toISOString(),
			},
			validate: true,
		}),
	});
}

async function main() {
	const state = readState();
	const errors = [];
	for (const [name, publish] of [["mastodon", publishMastodon], ["bluesky", publishBluesky]]) {
		const document = nextDocument(new Set(state[name]));
		if (!document) {
			console.log(`[social] ${name}: nothing left to publish.`);
			continue;
		}
		const post = formatPost(document);
		try {
			await publish(post);
			state[name].push(post.url);
			console.log(`[social] ${name}: ${post.text}`);
		} catch (error) {
			errors.push(new Error(`${name}: ${error.message}`));
		}
	}
	fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
	if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join("\n"));
}

function selfTest() {
	const recent = { title: "é".repeat(400), path: "/blog/example/", publishedAt: new Date().toISOString() };
	const recentPost = formatPost(recent);
	assert.equal(length(recentPost.text), LIMIT);
	assert(!recentPost.text.startsWith("#ICYMI"));
	const oldPost = formatPost({ ...recent, publishedAt: "2000-01-01T00:00:00.000Z" });
	assert(oldPost.text.startsWith("#ICYMI "));
	assert.equal(length(oldPost.text), LIMIT);
	assert.equal(facets(recentPost.text, recentPost.url).at(-1).features[0].tag, "aarsbl");
	assert.match(stableTid(recentPost.url), /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
	const newest = nextDocument(new Set());
	assert(newest && length(formatPost(newest).text) <= LIMIT);
	console.log(`[social] next: ${formatPost(newest).text}`);
	console.log("Social publishing checks passed.");
}

if (process.argv.includes("--test")) selfTest();
else main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
