import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const ICON_FILE = path.join(ROOT, "public", "images", "logos", "standard-site-icon.webp");
const DEFAULT_SERVICE = "https://bsky.social";

function requireEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function readStandardSiteConfig() {
	const metadata = yaml.load(fs.readFileSync(METADATA_FILE, "utf8")) || {};
	const standardSite = metadata.standard_site || {};
	return {
		name: String(standardSite.name || metadata.title || "JCRT").trim(),
		url: String(standardSite.url || metadata.url || "https://jcrt.org").trim(),
		description: String(standardSite.description || metadata.description || "").trim(),
		did: String(standardSite.did || "").trim(),
	};
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
	return data;
}

async function uploadIcon(service, accessJwt) {
	const response = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
		method: "POST",
		headers: {
			"content-type": "image/webp",
			authorization: `Bearer ${accessJwt}`,
		},
		body: fs.readFileSync(ICON_FILE),
	});
	const data = await response.json();
	if (!response.ok) throw new Error(`Icon upload failed (${response.status}): ${data?.message || data?.error || response.statusText}`);
	return data.blob;
}

const service = String(process.env.ATP_SERVICE || DEFAULT_SERVICE).replace(/\/$/, "");
const identifier = String(process.env.ATP_IDENTIFIER || "jcrt.org").trim();
const password = requireEnv("ATP_APP_PASSWORD");
const standardSite = readStandardSiteConfig();

const session = await xrpc(service, "com.atproto.server.createSession", {
	identifier,
	password,
});

if (standardSite.did && session.did !== standardSite.did) {
	throw new Error(`Authenticated DID ${session.did} does not match configured DID ${standardSite.did}.`);
}

const icon = await uploadIcon(service, session.accessJwt);

const record = {
	$type: "site.standard.publication",
	name: standardSite.name,
	url: standardSite.url,
	description: standardSite.description,
	icon,
};

const result = await xrpc(
	service,
	"com.atproto.repo.putRecord",
	{
		repo: session.did,
		collection: "site.standard.publication",
		rkey: "jcrt",
		record,
		validate: false,
	},
	session.accessJwt,
);

console.log(`Published Standard.site publication record: ${result.uri}`);
