import fs from "node:fs";
import path from "node:path";

const SITE_DIR = path.resolve(process.cwd(), "_site");
const MAIN_SITEMAP = path.join(SITE_DIR, "sitemap.xml");
const DEFAULT_SITE_URL = "https://jcrt.org";
const REQUIRED_LOCAL_PATHS = [
	"/sitemap.xml",
	"/sitemaps/sitemap.xml",
	"/sitemaps/keywords/keywords-sitemap.xml",
	"/religioustheory/sitemap.xml",
	"/feed/philpapers.xml",
	"/sitemaps/oai_dc.xml",
	"/sitemaps/oai-records.json",
	"/sitemaps/doaj-archives.xml",
	"/sitemaps/datacite.xml",
	"/sitemaps/jats-sitemap.xml",
];

function getLocs(xml) {
	const out = [];
	const re = /<loc>([^<]+)<\/loc>/g;
	let m;
	while ((m = re.exec(xml)) !== null) {
		const value = String(m[1] || "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.trim();
		if (value) out.push(value);
	}
	return out;
}

function toLocalPath(url, siteUrl) {
	const parsed = new URL(url);
	const base = new URL(siteUrl);
	if (parsed.hostname !== base.hostname) return null;
	return parsed.pathname;
}

function resolveOutputFile(pathname) {
	const rel = String(pathname || "").replace(/^\/+/, "");
	if (rel.endsWith("/")) return path.join(SITE_DIR, rel, "index.html");
	return path.join(SITE_DIR, rel);
}

function verifyFilesystem(siteUrl) {
	if (!fs.existsSync(MAIN_SITEMAP)) {
		throw new Error(`Missing main sitemap: ${MAIN_SITEMAP}`);
	}

	const xml = fs.readFileSync(MAIN_SITEMAP, "utf8");
	const locs = getLocs(xml);
	if (locs.length === 0) {
		throw new Error("Main sitemap index is empty.");
	}

	const missing = [];
	for (const loc of locs) {
		let localPath = null;
		try {
			localPath = toLocalPath(loc, siteUrl);
		} catch {
			continue;
		}
		if (!localPath) continue;
		const outputFile = resolveOutputFile(localPath);
		if (!fs.existsSync(outputFile)) {
			missing.push({ loc, outputFile });
		}
	}

	for (const requiredPath of REQUIRED_LOCAL_PATHS) {
		const outputFile = resolveOutputFile(requiredPath);
		if (!fs.existsSync(outputFile)) {
			missing.push({
				loc: `${siteUrl}${requiredPath}`,
				outputFile,
			});
		}
	}

	const jatsSitemap = path.join(SITE_DIR, "sitemaps", "jats-sitemap.xml");
	if (fs.existsSync(jatsSitemap)) {
		const jatsLocs = getLocs(fs.readFileSync(jatsSitemap, "utf8"));
		if (jatsLocs.length === 0) {
			throw new Error("JATS metadata sitemap is empty.");
		}
		for (const loc of jatsLocs) {
			const localPath = toLocalPath(loc, siteUrl);
			if (!localPath) continue;
			const outputFile = resolveOutputFile(localPath);
			if (!fs.existsSync(outputFile)) missing.push({ loc, outputFile });
		}
	}

	if (missing.length > 0) {
		console.error(`[sitemaps:check] Missing ${missing.length} local sitemap file(s):`);
		for (const row of missing) {
			console.error(`- ${row.loc} -> ${row.outputFile}`);
		}
		throw new Error("Filesystem sitemap validation failed.");
	}

	console.log(`[sitemaps:check] Filesystem validation passed (${locs.length} loc entries checked).`);
}

async function verifyHttp(baseUrl) {
	const checks = REQUIRED_LOCAL_PATHS.map((p) => `${baseUrl}${p}`);
	let failures = 0;
	for (const url of checks) {
		try {
			const res = await fetch(url, { redirect: "follow" });
			if (!res.ok) {
				failures += 1;
				console.error(`[sitemaps:check] HTTP ${res.status} ${url}`);
			}
		} catch (error) {
			failures += 1;
			console.error(`[sitemaps:check] HTTP request error ${url}: ${error?.message || error}`);
		}
	}

	if (failures > 0) {
		throw new Error(`HTTP sitemap validation failed (${failures} endpoint(s)).`);
	}
	console.log(`[sitemaps:check] HTTP validation passed (${checks.length} endpoint(s)).`);
}

async function run() {
	const siteUrl = String(process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
	verifyFilesystem(siteUrl);

	const checkBaseUrl = String(process.env.SITEMAP_CHECK_BASE_URL || "").trim().replace(/\/+$/, "");
	if (checkBaseUrl) {
		await verifyHttp(checkBaseUrl);
	}
}

run().catch((error) => {
	console.error(`[sitemaps:check] ${error?.message || error}`);
	process.exitCode = 1;
});
