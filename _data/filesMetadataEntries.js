import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const LOCAL_METADATA_DIR = path.resolve(ROOT, "..", "jcrt-files", "metadata");
const DEFAULT_FILES_URL = "https://files.jcrt.org";

function readYaml(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || {};
	} catch {
		return {};
	}
}

function normalizeFilesUrl(metadata) {
	const url = String(metadata?.files_url || DEFAULT_FILES_URL).trim();
	return url.replace(/\/+$/, "");
}

function toDateOnly(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

function walkFiles(dirPath) {
	const out = [];
	const stack = [dirPath];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.isFile()) out.push(fullPath);
		}
	}
	return out;
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
	const filesUrl = normalizeFilesUrl(metadata);
	const entries = [];

	if (fs.existsSync(LOCAL_METADATA_DIR)) {
		const files = walkFiles(LOCAL_METADATA_DIR);
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
