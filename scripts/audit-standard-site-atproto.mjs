import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import standardSite from "../_data/standardSite.js";

const ROOT = process.cwd();
const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");
const FILES_ROOT = path.resolve(ROOT, "..", "jcrt-files");
const FILES_URL = "https://files.jcrt.org";
const PRIORITY_PREFIXES = ["/blog/", "/religioustheory/", "/archives/", "/authors/"];

function readYaml(filePath) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || {};
	} catch {
		return {};
	}
}

function walkPdfs(dir) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(fullPath);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(fullPath);
		}
	}
	return files.sort();
}

function bucketFor(documentPath) {
	return PRIORITY_PREFIXES.find((prefix) => documentPath.startsWith(prefix)) || "(other)";
}

const records = readYaml(RECORDS_FILE);
const documents = standardSite().documents;
const pdfUrlsInDocuments = new Set(documents.map((record) => record.pdfUrl).filter(Boolean));
const pdfFiles = walkPdfs(FILES_ROOT).map((filePath) => {
	const relativePath = path.relative(FILES_ROOT, filePath).split(path.sep).join("/");
	return `${FILES_URL}/${relativePath}`;
});

const byPrefix = new Map(PRIORITY_PREFIXES.map((prefix) => [prefix, { documents: 0, withAtUri: 0, missingAtUri: 0 }]));
byPrefix.set("(other)", { documents: 0, withAtUri: 0, missingAtUri: 0 });

for (const document of documents) {
	const bucket = bucketFor(document.path);
	const row = byPrefix.get(bucket);
	row.documents += 1;
	if (records[document.path]) row.withAtUri += 1;
	else row.missingAtUri += 1;
}

const missingDocuments = documents.filter((document) => !records[document.path]);
const missingPdfFiles = pdfFiles.filter((url) => !pdfUrlsInDocuments.has(url));

const report = {
	generatedAt: new Date().toISOString(),
	documents: {
		total: documents.length,
		withAtUri: documents.length - missingDocuments.length,
		missingAtUri: missingDocuments.length,
		byPriority: Object.fromEntries(byPrefix),
		firstMissingAtUri: missingDocuments.slice(0, 25).map((document) => document.path),
	},
	pdfs: {
		totalFiles: pdfFiles.length,
		attachedToStandardSiteDocuments: pdfUrlsInDocuments.size,
		missingStandaloneOrDocumentAttachment: missingPdfFiles.length,
		firstMissing: missingPdfFiles.slice(0, 25),
	},
};

console.log(JSON.stringify(report, null, 2));
