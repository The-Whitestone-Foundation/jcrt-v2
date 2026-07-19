import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import standardSite from "../_data/standardSite.js";

const ROOT = process.cwd();
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");
const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
const PUBLICATION_SCRIPT_FILE = path.join(ROOT, "scripts", "publish-standard-publication.mjs");
const PUBLICATION_ICON_FILE = path.join(ROOT, "public", "images", "logos", "standard-site-icon.webp");
const ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const SEO_TEMPLATE_FILE = path.join(ROOT, "_includes", "partials", "seo.njk");
const NON_ARTICLE_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);
const errors = [];

function readYaml(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || {};
	} catch (error) {
		errors.push(`Unable to read ${path.relative(ROOT, filePath)}: ${error.message}`);
		return {};
	}
}

function assert(condition, message) {
	if (!condition) errors.push(message);
}

function isAtUri(value) {
	return typeof value === "string" && value.startsWith("at://");
}

function parseFrontMatter(source) {
	if (!source.startsWith("---")) return {};
	const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
	if (!match) return {};
	try {
		return yaml.load(match[1]) || {};
	} catch {
		return {};
	}
}

function walkMarkdown(dir) {
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(fullPath);
			else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
		}
	}
	return files.sort();
}

function normalizeUrl(value, fallback) {
	return String(value || fallback || "").trim().replace(/\/+$/, "");
}

function expectedArchivePdfMap(filesUrl) {
	const out = new Map();
	for (const filePath of walkMarkdown(ARCHIVES_DIR)) {
		const rel = path.relative(ARCHIVES_DIR, filePath);
		const [issueSlug, fileName] = rel.split(path.sep);
		const slug = path.basename(fileName || "", ".md");
		if (!issueSlug?.includes(".") || NON_ARTICLE_SLUGS.has(slug.toLowerCase())) continue;

		const data = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
		if (data?.published === false || data?.draft === true) continue;

		const pdf = String(data?.pdf || "").trim();
		if (!pdf || !pdf.toLowerCase().endsWith(".pdf") || /^https?:\/\//i.test(pdf)) continue;
		out.set(`/archives/${issueSlug}/${slug}/`, `${filesUrl}/archives/${issueSlug}/${pdf.replace(/^\/+/, "")}`);
	}
	return out;
}

function validateRecordMap(records, documentPaths) {
	for (const [documentPath, atUri] of Object.entries(records || {})) {
		assert(documentPath.startsWith("/"), `Standard.site record key must start with "/": ${documentPath}`);
		assert(isAtUri(atUri), `Standard.site record for ${documentPath} must be an at:// URI.`);
		assert(documentPaths.has(documentPath), `Standard.site record key does not match a generated document path: ${documentPath}`);
	}
}

function main() {
	const records = readYaml(RECORDS_FILE);
	const metadata = readYaml(METADATA_FILE);
	const filesUrl = normalizeUrl(metadata.files_url, "https://files.jcrt.org");
	const expectedArchivePdfs = expectedArchivePdfMap(filesUrl);
	const payload = standardSite();
	const documentPaths = new Set();
	const documentsByPath = new Map();

	assert(payload?.publication?.$type === "site.standard.publication", "Publication record must use site.standard.publication.");
	assert(payload?.publication?.name, "Publication record is missing name.");
	assert(payload?.publication?.url, "Publication record is missing url.");
	const publicationScript = fs.readFileSync(PUBLICATION_SCRIPT_FILE, "utf8");
	assert(fs.existsSync(PUBLICATION_ICON_FILE), "Standard.site publication icon is missing.");
	assert(publicationScript.includes("com.atproto.repo.uploadBlob"), "Standard.site publication icon must be uploaded as an ATProto blob.");
	assert(publicationScript.includes("icon,"), "Standard.site publication record is missing its icon blob.");

	for (const record of payload.documents || []) {
		const label = record?.path || record?.title || "(unknown document)";
		assert(record?.$type === "site.standard.document", `${label} must use site.standard.document.`);
		assert(record?.site, `${label} is missing site.`);
		assert(record?.title, `${label} is missing title.`);
		assert(record?.publishedAt, `${label} is missing publishedAt.`);
		assert(record?.path?.startsWith("/"), `${label} path must start with "/".`);
		assert(record?.path?.endsWith("/"), `${label} path must use the canonical JCRT trailing slash.`);
		assert(!documentPaths.has(record.path), `Duplicate Standard.site document path: ${record.path}`);
		if (record?.pdfUrl) {
			assert(record.pdfUrl.startsWith("https://"), `${label} pdfUrl must start with https://.`);
			assert(record.pdfUrl.toLowerCase().endsWith(".pdf"), `${label} pdfUrl must end with .pdf.`);
		}
		documentPaths.add(record.path);
		documentsByPath.set(record.path, record);
	}

	for (const [documentPath, pdfUrl] of expectedArchivePdfs.entries()) {
		const record = documentsByPath.get(documentPath);
		assert(record, `Archive PDF source has no generated Standard.site record: ${documentPath}`);
		assert(record?.pdfUrl === pdfUrl, `${documentPath} pdfUrl should be ${pdfUrl}, received ${record?.pdfUrl || "(missing)"}.`);
	}

	const seoTemplate = fs.existsSync(SEO_TEMPLATE_FILE) ? fs.readFileSync(SEO_TEMPLATE_FILE, "utf8") : "";
	assert(seoTemplate.includes("{% if standardSiteEnabled %}"), "Standard.site JSON discovery links must be gated by standardSiteEnabled.");
	for (const href of [
		"/standard.site/publication.json",
		"/standard.site/documents.json",
		"/standard.site/manifest.json",
	]) {
		assert(seoTemplate.includes(href), `Missing Standard.site discovery link for ${href}.`);
	}

	validateRecordMap(records, documentPaths);

	if (errors.length) {
		console.error("Standard.site validation failed:");
		for (const error of errors) console.error(`- ${error}`);
		process.exit(1);
	}

	console.log(`Standard.site validation passed (${payload.documents.length} documents).`);
}

main();
