// Walks the whole sitemap tree in _site starting at /sitemap.xml and checks that every
// same-host <loc> resolves to a built file. Nested indexes are followed; any sitemap with
// zero <loc> entries fails the build (a <sitemapindex> child must be a <urlset>).
// Locs on other hosts (files.jcrt.org) are counted but not checked.
import fs from "node:fs";
import path from "node:path";

const SITE_DIR = path.resolve(process.cwd(), "_site");
const DEFAULT_SITE_URL = "https://jcrt.org";
// Assets no sitemap links to but harvesters and the OAI edge function depend on.
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
	try {
		const parsed = new URL(url);
		return parsed.hostname === new URL(siteUrl).hostname ? parsed.pathname : null;
	} catch {
		return null;
	}
}

function resolveOutputFile(pathname) {
	const rel = String(pathname || "").replace(/^\/+/, "");
	if (rel.endsWith("/")) return path.join(SITE_DIR, rel, "index.html");
	return path.join(SITE_DIR, rel);
}

function verify(siteUrl) {
	const seen = new Set();
	const missing = [];
	const empty = [];
	let sitemaps = 0;
	let checked = 0;
	let external = 0;

	const walk = (pathname) => {
		if (seen.has(pathname)) return;
		seen.add(pathname);
		const file = resolveOutputFile(pathname);
		if (!fs.existsSync(file)) {
			missing.push({ loc: `${siteUrl}${pathname}`, outputFile: file });
			return;
		}
		if (!file.endsWith(".xml")) return;
		// Only <urlset>/<sitemapindex> documents are sitemaps; other XML locs (JATS article
		// metadata, DataCite payloads) just have to exist.
		const xml = fs.readFileSync(file, "utf8");
		if (!/<(?:urlset|sitemapindex)[\s>]/.test(xml)) return;
		sitemaps += 1;
		const locs = getLocs(xml);
		if (locs.length === 0) empty.push(pathname);
		for (const loc of locs) {
			const local = toLocalPath(loc, siteUrl);
			if (!local) {
				external += 1;
				continue;
			}
			checked += 1;
			walk(local);
		}
	};

	walk("/sitemap.xml");
	for (const requiredPath of REQUIRED_LOCAL_PATHS) {
		if (!fs.existsSync(resolveOutputFile(requiredPath))) {
			missing.push({ loc: `${siteUrl}${requiredPath}`, outputFile: resolveOutputFile(requiredPath) });
		}
	}

	if (empty.length > 0) {
		console.error(`[sitemaps:check] ${empty.length} sitemap(s) contain no <loc>: ${empty.join(", ")}`);
	}
	if (missing.length > 0) {
		console.error(`[sitemaps:check] Missing ${missing.length} local file(s):`);
		for (const row of missing) console.error(`- ${row.loc} -> ${row.outputFile}`);
	}
	if (empty.length > 0 || missing.length > 0) {
		throw new Error("Sitemap validation failed.");
	}
	console.log(
		`[sitemaps:check] ${sitemaps} sitemap files, ${checked} local locs checked, ${external} external locs skipped, 0 missing.`,
	);
}

try {
	verify(String(process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, ""));
} catch (error) {
	console.error(`[sitemaps:check] ${error?.message || error}`);
	process.exitCode = 1;
}
