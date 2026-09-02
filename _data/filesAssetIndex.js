import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

function parseFrontMatter(content) {
	if (!content.startsWith("---")) return {};
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return {};
	try {
		return yaml.load(match[1]) || {};
	} catch {
		return {};
	}
}

function readYaml(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || {};
	} catch {
		return {};
	}
}

function walkContentFiles(rootDir) {
	const out = [];
	const stack = [rootDir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name.endsWith(".md") || entry.name.endsWith(".njk")) {
				out.push(fullPath);
			}
		}
	}
	return out;
}

function toDateOnly(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

function normalizeFilesUrl(metadata) {
	const url = String(metadata?.files_url || "https://files.jcrt.org").trim();
	return url.replace(/\/+$/, "");
}

function normalizeAssetUrl(raw, filesUrl) {
	const value = String(raw || "").trim();
	if (!value) return "";
	if (/^https?:\/\//i.test(value)) return value;
	if (!value.startsWith("/")) return "";
	return `${filesUrl}${value}`;
}

function normalizePdfUrl(directory, rawPdf, filesUrl) {
	const value = String(rawPdf || "").trim();
	if (!value) return "";
	return `${filesUrl}/${directory}/${value}`;
}

export default function filesAssetIndex() {
	const metadata = readYaml(METADATA_FILE);
	const filesUrl = normalizeFilesUrl(metadata);
	const imagesMap = new Map();
	const pdfsMap = new Map();

	const metadataImage = normalizeAssetUrl(metadata?.image, filesUrl);
	const metadataFavicon = normalizeAssetUrl(metadata?.favicon, filesUrl);
	if (metadataImage) imagesMap.set(metadataImage, { loc: metadataImage, lastmod: "" });
	if (metadataFavicon) imagesMap.set(metadataFavicon, { loc: metadataFavicon, lastmod: "" });

	const files = walkContentFiles(CONTENT_DIR);
	for (const filePath of files) {
		const src = fs.readFileSync(filePath, "utf8");
		const data = parseFrontMatter(src);
		if (!data || typeof data !== "object") continue;
		if (data.published === false) continue;

		let stat;
		try {
			stat = fs.statSync(filePath);
		} catch {
			stat = null;
		}
		const lastmod = stat ? toDateOnly(stat.mtime) : "";

		const imageUrl = normalizeAssetUrl(data.image, filesUrl);
		if (imageUrl && IMAGE_EXT_RE.test(imageUrl)) {
			imagesMap.set(imageUrl, { loc: imageUrl, lastmod });
		}

		const rel = path.relative(CONTENT_DIR, filePath);
		const relParts = rel.split(path.sep);
		const pdfDirectory = relParts[0] === "archives" && relParts[1]?.includes(".")
			? `archives/${relParts[1]}`
			: relParts[0] === "religioustheory" && relParts[1] === "posts"
				? "religioustheory"
				: "";
		if (pdfDirectory) {
			const pdfUrl = normalizePdfUrl(pdfDirectory, data.pdf, filesUrl);
			if (pdfUrl.toLowerCase().endsWith(".pdf")) {
				pdfsMap.set(pdfUrl, { loc: pdfUrl, lastmod });
			}
		}
	}

	const images = [...imagesMap.values()].sort((a, b) => a.loc.localeCompare(b.loc));
	const pdfs = [...pdfsMap.values()].sort((a, b) => a.loc.localeCompare(b.loc));
	return { images, pdfs };
}
