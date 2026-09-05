import fs from "node:fs";
import path from "node:path";
import { readYaml } from "../scripts/lib/frontmatter.mjs";
import { walkFiles } from "../scripts/lib/walk.mjs";
import { normalizeUrl } from "../scripts/lib/paths.mjs";

const ROOT = process.cwd();
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const LOCAL_METADATA_DIR = path.resolve(ROOT, "..", "jcrt-files", "metadata");
const DEFAULT_FILES_URL = "https://files.jcrt.org";

function toDateOnly(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

const FALLBACK_PATHS = [
	"/metadata/search-sitemap.xml",
	"/metadata/oai_dc.xml",
	"/metadata/doaj-archives.xml",
	"/metadata/ris-sitemap.xml",
	"/metadata/csl-json-sitemap.xml",
];

export default function filesMetadataEntries() {
	const metadata = readYaml(METADATA_FILE);
	const filesUrl = normalizeUrl(metadata?.files_url, DEFAULT_FILES_URL);
	const entries = [];

	if (fs.existsSync(LOCAL_METADATA_DIR)) {
		// skipDotfiles: a stray .DS_Store used to ship as a <loc> in metadata-sitemap.xml.
		const files = walkFiles(LOCAL_METADATA_DIR, { skipDotfiles: true });
		for (const filePath of files) {
			const rel = path.relative(LOCAL_METADATA_DIR, filePath).split(path.sep).join("/");
			const loc = `${filesUrl}/metadata/${rel}`;
			let lastmod = "";
			try {
				lastmod = toDateOnly(fs.statSync(filePath).mtime);
			} catch {
				lastmod = "";
			}
			entries.push({ loc, lastmod });
		}
	} else {
		for (const p of FALLBACK_PATHS) {
			entries.push({ loc: `${filesUrl}${p}`, lastmod: "" });
		}
	}

	entries.sort((a, b) => a.loc.localeCompare(b.loc));
	return entries;
}
