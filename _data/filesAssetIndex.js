import fs from "node:fs";
import path from "node:path";
import { parseFrontMatter, readYaml } from "../scripts/lib/frontmatter.mjs";
import { walkFiles } from "../scripts/lib/walk.mjs";
import { normalizeUrl } from "../scripts/lib/paths.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

const walkContentFiles = (rootDir) =>
	walkFiles(rootDir, { match: (name) => name.endsWith(".md") || name.endsWith(".njk") });

function toDateOnly(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
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
	const filesUrl = normalizeUrl(metadata?.files_url, "https://files.jcrt.org");
	const imagesMap = new Map();
	const pdfsMap = new Map();

	const metadataImage = normalizeAssetUrl(metadata?.image, filesUrl);
	const metadataFavicon = normalizeAssetUrl(metadata?.favicon, filesUrl);
	if (metadataImage) imagesMap.set(metadataImage, { loc: metadataImage, lastmod: "" });
	if (metadataFavicon) imagesMap.set(metadataFavicon, { loc: metadataFavicon, lastmod: "" });

	const files = walkContentFiles(CONTENT_DIR);
	for (const filePath of files) {
		const src = fs.readFileSync(filePath, "utf8");
		const { data } = parseFrontMatter(src);
		if (!data || typeof data !== "object") continue;
		if (data.published === false) continue;

		let stat;
		try {
			stat = fs.statSync(filePath);
		} catch {
			stat = null;
		}
		const lastmod = stat ? toDateOnly(stat.mtime) : "";

		// Several pages can share an asset; keep the newest page date so the value does not
		// depend on walk order.
		const keepNewest = (map, loc) => {
			const existing = map.get(loc);
			if (!existing || lastmod > existing.lastmod) map.set(loc, { loc, lastmod });
		};
		const imageUrl = normalizeAssetUrl(data.image, filesUrl);
		if (imageUrl && IMAGE_EXT_RE.test(imageUrl)) keepNewest(imagesMap, imageUrl);

		const rel = path.relative(CONTENT_DIR, filePath);
		const relParts = rel.split(path.sep);
		const pdfDirectory = relParts[0] === "archives" && relParts[1]?.includes(".")
			? `archives/${relParts[1]}`
			: relParts[0] === "religioustheory" && relParts[1] === "posts"
				? "religioustheory"
				: "";
		if (pdfDirectory) {
			const pdfUrl = normalizePdfUrl(pdfDirectory, data.pdf, filesUrl);
			if (pdfUrl.toLowerCase().endsWith(".pdf")) keepNewest(pdfsMap, pdfUrl);
		}
	}

	const images = [...imagesMap.values()].sort((a, b) => a.loc.localeCompare(b.loc));
	const pdfs = [...pdfsMap.values()].sort((a, b) => a.loc.localeCompare(b.loc));
	return { images, pdfs };
}
