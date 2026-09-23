/**
 * Build-time validators, one subcommand each. All are read-only; each prints its own report
 * and throws CheckFailed on failure, so the CLI exits 1 and the Eleventy after-build hook
 * (eleventy.config.js) fails the build. Never process.exit: the module is imported.
 *
 *   node scripts/check.mjs pre             standard + cms (before Eleventy; npm run build:netlify)
 *   node scripts/check.mjs standard        _data/standardSite.js output + standardSiteRecords.yaml
 *   node scripts/check.mjs cms             every front-matter key is declared in public/admin/config.yml
 *   node scripts/check.mjs sitemaps        every same-host <loc> in the _site sitemap tree exists (case-exact)
 *   node scripts/check.mjs oai             OAI-PMH protocol checks over the built feed and records index
 *   node scripts/check.mjs bibliography [--verbose]   <meta>/JSON-LD on every built article and collection page
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

import standardSite from "../_data/standardSite.js";
import { loadBibliography, plain, preciseDate } from "../_config/bibliography.js";
import { parseFrontMatter, readYaml } from "./lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "./lib/walk.mjs";
import { NON_ARTICLE_SLUGS, documentPathFor, normalizeUrl, sitemapLocs } from "./lib/paths.mjs";
import { handleOaiRequest, OAI_METADATA_PREFIX, renderPrimoListRecordsResponse } from "./lib/oai-pmh.mjs";
import { publicationRecord, readStandardSiteConfig, PUBLICATION_ICON_FILE } from "./sequoia.mjs";

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, "_site");
const CONTENT_DIR = path.join(ROOT, "content");

/** Thrown after a check has already printed its own report; the CLI does not print it again. */
export class CheckFailed extends Error {}

// ================================================================ standard

async function standard() {
	const RECORDS_FILE = path.join(ROOT, "_data", "standardSiteRecords.yaml");
	const METADATA_FILE = path.join(ROOT, "_data", "metadata.yaml");
	const ARCHIVES_DIR = path.join(CONTENT_DIR, "archives");
	const SEO_TEMPLATE_FILE = path.join(ROOT, "_includes", "partials", "seo.njk");
	const errors = [];
	const assert = (condition, message) => { if (!condition) errors.push(message); };
	const load = (filePath) => readYaml(filePath, {
		onError: (error) => errors.push(`Unable to read ${path.relative(ROOT, filePath)}: ${error.message}`),
	});
	const isValidIsoTimestamp = (value) => {
		if (typeof value !== "string" || !value) return false;
		const date = new Date(value);
		return !Number.isNaN(date.getTime()) && date.toISOString() === value;
	};
	const isAtUri = (value) => typeof value === "string" && value.startsWith("at://");

	const expectedArchivePdfMap = (filesUrl) => {
		const out = new Map();
		for (const filePath of walkFiles(ARCHIVES_DIR, { match: isMarkdown })) {
			const rel = path.relative(ARCHIVES_DIR, filePath);
			const [issueSlug, fileName] = rel.split(path.sep);
			const slug = path.basename(fileName || "", ".md");
			if (!issueSlug?.includes(".") || NON_ARTICLE_SLUGS.has(slug.toLowerCase())) continue;
			const { data } = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
			if (data?.published === false || data?.draft === true) continue;
			const pdf = String(data?.pdf || "").trim();
			if (!pdf || !pdf.toLowerCase().endsWith(".pdf") || /^https?:\/\//i.test(pdf)) continue;
			out.set(`/archives/${issueSlug}/${slug}/`, `${filesUrl}/archives/${issueSlug}/${pdf.replace(/^\/+/, "")}`);
		}
		return out;
	};

	const records = load(RECORDS_FILE);
	const metadata = load(METADATA_FILE);
	const filesUrl = normalizeUrl(metadata.files_url, "https://files.jcrt.org");
	const expectedArchivePdfs = expectedArchivePdfMap(filesUrl);
	const payload = standardSite();
	const documentPaths = new Set();
	const documentsByPath = new Map();

	assert(payload?.publication?.$type === "site.standard.publication", "Publication record must use site.standard.publication.");
	assert(payload?.publication?.name, "Publication record is missing name.");
	assert(payload?.publication?.url, "Publication record is missing url.");
	assert(fs.existsSync(PUBLICATION_ICON_FILE), "Standard.site publication icon is missing.");
	assert(publicationRecord(readStandardSiteConfig(), { $type: "blob" }).icon?.$type === "blob", "Standard.site publication record is missing its icon blob.");

	for (const record of payload.documents || []) {
		const label = record?.path || record?.title || "(unknown document)";
		assert(record?.$type === "site.standard.document", `${label} must use site.standard.document.`);
		assert(record?.site, `${label} is missing site.`);
		assert(record?.title, `${label} is missing title.`);
		assert(record?.publishedAt, `${label} is missing publishedAt.`);
		assert(isValidIsoTimestamp(record?.publishedAt), `${label} publishedAt must be a valid ISO timestamp.`);
		assert(record?.path?.startsWith("/"), `${label} path must start with "/".`);
		assert(record?.path?.endsWith("/"), `${label} path must use the canonical JCRT trailing slash.`);
		assert(!documentPaths.has(record.path), `Duplicate Standard.site document path: ${record.path}`);
		if (record?.updatedAt) assert(isValidIsoTimestamp(record.updatedAt), `${label} updatedAt must be a valid ISO timestamp.`);
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
	for (const href of ["/standard.site/publication.json", "/standard.site/documents.json", "/standard.site/manifest.json"]) {
		assert(seoTemplate.includes(href), `Missing Standard.site discovery link for ${href}.`);
	}

	for (const [documentPath, atUri] of Object.entries(records || {})) {
		assert(documentPath.startsWith("/"), `Standard.site record key must start with "/": ${documentPath}`);
		assert(isAtUri(atUri), `Standard.site record for ${documentPath} must be an at:// URI.`);
		assert(documentPaths.has(documentPath), `Standard.site record key does not match a generated document path: ${documentPath}`);
	}

	if (errors.length) {
		console.error("Standard.site validation failed:");
		for (const error of errors) console.error(`- ${error}`);
		throw new CheckFailed(`Standard.site validation failed (${errors.length} error(s)).`);
	}
	console.log(`Standard.site validation passed (${payload.documents.length} documents).`);
}

// ================================================================ cms
// Decap writes back ONLY the fields declared in public/admin/config.yml. Any key present in a
// content file but missing from its collection's `fields` is dropped the first time an editor
// saves that entry.

async function cms() {
	const CONFIG = path.join(ROOT, "public", "admin", "config.yml");
	const cfg = yaml.load(fs.readFileSync(CONFIG, "utf8"));
	let failures = 0;

	const readData = (file) => {
		const text = fs.readFileSync(file, "utf8");
		if (file.endsWith(".yaml") || file.endsWith(".yml")) return yaml.load(text);
		return parseFrontMatter(text).data;
	};
	const check = (file, data, fields, prefix = "") => {
		if (!data || typeof data !== "object" || Array.isArray(data)) return;
		const declared = new Map((fields || []).map((f) => [f.name, f]));
		for (const [key, value] of Object.entries(data)) {
			const field = declared.get(key);
			if (!field) {
				console.error(`  undeclared: ${path.relative(ROOT, file)} :: ${prefix}${key}`);
				failures++;
				continue;
			}
			if (field.widget === "object" && field.fields) check(file, value, field.fields, `${prefix}${key}.`);
			if (field.widget === "list" && field.fields && Array.isArray(value)) {
				for (const item of value) check(file, item, field.fields, `${prefix}${key}[].`);
			}
		}
	};

	for (const collection of cfg.collections) {
		if (collection.folder) {
			const dir = path.join(ROOT, collection.folder);
			if (!fs.existsSync(dir)) {
				console.error(`  missing folder: ${collection.folder}`);
				failures++;
				continue;
			}
			const files = walkFiles(dir, { match: isMarkdown });
			for (const file of files) {
				let data;
				try { data = readData(file); } catch { continue; }
				check(file, data, collection.fields);
			}
			console.log(`${collection.name}: ${files.length} files`);
		}
		for (const file of collection.files || []) {
			const full = path.join(ROOT, file.file);
			if (!fs.existsSync(full)) {
				console.error(`  missing file: ${file.file}`);
				failures++;
				continue;
			}
			check(full, readData(full), file.fields);
			console.log(`${collection.name}: ${file.file}`);
		}
	}

	if (failures) {
		console.error(`\ncheck-cms-fields: ${failures} undeclared key(s) — editing these entries in the CMS would delete them.`);
		throw new CheckFailed(`check-cms-fields: ${failures} undeclared key(s).`);
	}
	console.log("\ncheck-cms-fields: every front matter key is declared in public/admin/config.yml");
}

// ================================================================ pre
// Everything that must hold before Eleventy runs; serial so a failure is the last thing printed.

async function pre() {
	await standard();
	await cms();
}

// ================================================================ sitemaps
// Walks the whole sitemap tree in _site starting at /sitemap.xml and checks that every same-host
// <loc> resolves to a built file. Nested indexes are followed; any sitemap with zero <loc>
// entries fails (a <sitemapindex> child must be a <urlset>). Other hosts are counted, not checked.

async function sitemaps() {
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

	// macOS (APFS) is case-insensitive; Netlify's Linux builder is not. fs.existsSync is therefore
	// true here and false on CI for a mis-cased <loc>, which is exactly how /Copyright/ shipped.
	// readdirSync reports the TRUE on-disk casing, so resolve against that, never the kernel.
	const dirEntries = new Map();
	const namesIn = (dir) => {
		let names = dirEntries.get(dir);
		if (!names) {
			try { names = new Set(fs.readdirSync(dir)); } catch { names = new Set(); }
			dirEntries.set(dir, names);
		}
		return names;
	};
	const existsExactCase = (file) => {
		const rel = path.relative(SITE_DIR, file);
		if (rel === "" || rel === ".") return fs.existsSync(SITE_DIR);
		if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
		let dir = SITE_DIR;
		for (const segment of rel.split(path.sep)) {
			if (!namesIn(dir).has(segment)) return false;
			dir = path.join(dir, segment);
		}
		return true;
	};
	const caseHint = (file) => {
		let dir = SITE_DIR;
		for (const segment of path.relative(SITE_DIR, file).split(path.sep)) {
			const names = namesIn(dir);
			if (!names.has(segment)) {
				const actual = [...names].find((name) => name.toLowerCase() === segment.toLowerCase());
				return actual ? ` (on disk it is "${actual}", not "${segment}")` : "";
			}
			dir = path.join(dir, segment);
		}
		return "";
	};
	const toLocalPath = (url, siteUrl) => {
		try {
			const parsed = new URL(url);
			return parsed.hostname === new URL(siteUrl).hostname ? parsed.pathname : null;
		} catch {
			return null;
		}
	};
	const resolveOutputFile = (pathname) => {
		const rel = String(pathname || "").replace(/^\/+/, "");
		// "" is the homepage: resolve it to _site/index.html, not to _site itself.
		if (rel === "" || rel.endsWith("/")) return path.join(SITE_DIR, rel, "index.html");
		return path.join(SITE_DIR, rel);
	};

	try {
		const siteUrl = String(process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
		const seen = new Set();
		const missing = [];
		const empty = [];
		let count = 0;
		let checked = 0;
		let external = 0;

		const walk = (pathname) => {
			if (seen.has(pathname)) return;
			seen.add(pathname);
			const file = resolveOutputFile(pathname);
			if (!existsExactCase(file)) {
				missing.push({ loc: `${siteUrl}${pathname}`, outputFile: file });
				return;
			}
			if (!file.endsWith(".xml")) return;
			// Only <urlset>/<sitemapindex> documents are sitemaps; other XML locs (JATS article
			// metadata, DataCite payloads) just have to exist.
			const xml = fs.readFileSync(file, "utf8");
			if (!/<(?:urlset|sitemapindex)[\s>]/.test(xml)) return;
			count += 1;
			const locs = sitemapLocs(xml);
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
			if (!existsExactCase(resolveOutputFile(requiredPath))) {
				missing.push({ loc: `${siteUrl}${requiredPath}`, outputFile: resolveOutputFile(requiredPath) });
			}
		}

		if (empty.length > 0) {
			console.error(`[sitemaps:check] ${empty.length} sitemap(s) contain no <loc>: ${empty.join(", ")}`);
		}
		if (missing.length > 0) {
			console.error(`[sitemaps:check] Missing ${missing.length} local file(s):`);
			for (const row of missing) console.error(`- ${row.loc} -> ${row.outputFile}${caseHint(row.outputFile)}`);
		}
		if (empty.length > 0 || missing.length > 0) throw new Error("Sitemap validation failed.");
		console.log(`[sitemaps:check] ${count} sitemap files, ${checked} local locs checked, ${external} external locs skipped, 0 missing.`);
	} catch (error) {
		console.error(`[sitemaps:check] ${error?.message || error}`);
		throw new CheckFailed(`[sitemaps:check] ${error?.message || error}`);
	}
}

// ================================================================ oai

async function oai() {
	const OAI_XML_PATH = path.join(SITE_DIR, "sitemaps", "oai_dc.xml");
	const OAI_INDEX_PATH = path.join(SITE_DIR, "sitemaps", "oai-records.json");

	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const mustExist = (filePath) => assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);

	const runProtocolChecks = ({ baseURL, records, identify }) => {
		const firstId = String(records?.[0]?.identifier || "").trim();
		assert(firstId, "No OAI records found in oai-records.json.");
		const cases = [
			{ name: "Identify", params: { verb: "Identify" }, contains: ["<Identify>", `<baseURL>${baseURL}</baseURL>`, "<deletedRecord>"] },
			{ name: "ListMetadataFormats", params: { verb: "ListMetadataFormats" }, contains: ["<ListMetadataFormats>", `<metadataPrefix>${OAI_METADATA_PREFIX}</metadataPrefix>`] },
			{ name: "ListSets", params: { verb: "ListSets" }, contains: ["<ListSets>", "<setSpec>philosophy</setSpec>"] },
			{ name: "ListIdentifiers", params: { verb: "ListIdentifiers", metadataPrefix: OAI_METADATA_PREFIX }, contains: ["<ListIdentifiers>", "<header>"] },
			{ name: "ListRecords", params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX }, contains: ["<ListRecords>", "<oai_dc:dc"] },
			{ name: "Philosophy Set", params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, set: "philosophy" }, contains: ["<ListRecords>", "<setSpec>philosophy</setSpec>"] },
			{ name: "GetRecord", params: { verb: "GetRecord", identifier: firstId, metadataPrefix: OAI_METADATA_PREFIX }, contains: ["<GetRecord>", firstId] },
			{ name: "Unknown Verb", params: { verb: "Nope" }, contains: ['<error code="badVerb">'] },
			{ name: "Repeated Argument", params: new URLSearchParams("verb=Identify&verb=Identify"), contains: [`<request>${baseURL}</request>`, '<error code="badArgument">'], notContains: ["<request verb="] },
			{ name: "Unsupported Metadata Prefix", params: { verb: "ListRecords", metadataPrefix: "mods" }, contains: ['<error code="cannotDisseminateFormat">'] },
			{ name: "Unknown Identifier", params: { verb: "GetRecord", identifier: "oai:jcrt.org:missing", metadataPrefix: OAI_METADATA_PREFIX }, contains: ['<error code="idDoesNotExist">'] },
			{ name: "No Records Match", params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, from: "2100-01-01" }, contains: ['<error code="noRecordsMatch">'] },
			{ name: "Unknown Set", params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, set: "not-a-set" }, contains: ['<error code="noRecordsMatch">'] },
		];
		const outputs = [];
		for (const testCase of cases) {
			const result = handleOaiRequest({ baseURL, params: testCase.params, records, identify });
			for (const expected of testCase.contains) {
				assert(String(result.xml || "").includes(expected), `Protocol check failed: ${testCase.name} missing '${expected}'`);
			}
			for (const unexpected of testCase.notContains || []) {
				assert(!String(result.xml || "").includes(unexpected), `Protocol check failed: ${testCase.name} unexpectedly contains '${unexpected}'`);
			}
			outputs.push({ name: testCase.name, xml: result.xml });
		}
		return outputs;
	};
	const extractDatestamps = (xml) => [...String(xml || "").matchAll(/<datestamp>([^<]+)<\/datestamp>/g)].map((match) => String(match[1] || "").trim());
	const assertIncrementalDayGranularity = ({ baseURL, records, identify }) => {
		const from = "2026-03-03";
		const result = handleOaiRequest({ baseURL, params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, from }, records, identify });
		if (String(result?.xml || "").includes('code="noRecordsMatch"')) return;
		const datestamps = extractDatestamps(result?.xml || "");
		assert(datestamps.length > 0, "Incremental ListRecords check returned no datestamps.");
		const older = datestamps.find((value) => value < from);
		assert(!older, `Incremental day-granularity check failed: datestamp ${older} is older than from=${from}.`);
	};
	const assertResumptionFlow = ({ baseURL, records, identify }) => {
		if (!Array.isArray(records) || records.length <= 120) return;
		for (const set of ["", "philosophy"]) {
			const first = handleOaiRequest({ baseURL, params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, ...(set ? { set } : {}) }, records, identify });
			const tokenMatch = String(first?.xml || "").match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
			const token = String(tokenMatch?.[1] || "").trim();
			assert(token, `Expected resumptionToken in ${set || "complete"} ListRecords response but none was found.`);
			const second = handleOaiRequest({ baseURL, params: { verb: "ListRecords", resumptionToken: token }, records, identify });
			assert(!String(second?.xml || "").includes('code="badResumptionToken"'), "Resumption token follow-up returned badResumptionToken.");
			assert(String(second?.xml || "").includes("<ListRecords>"), "Resumption token follow-up did not return ListRecords.");
			if (set) assert(String(second?.xml || "").includes(`<setSpec>${set}</setSpec>`), `Resumption token lost the ${set} set.`);
		}
	};
	const runQuickChecks = ({ baseURL, records, identify }) => {
		const staticXml = fs.readFileSync(OAI_XML_PATH, "utf8");
		assert(staticXml.includes("<OAI-PMH"), "Static OAI XML is missing OAI-PMH root.");
		assert(staticXml.includes("<ListRecords>"), "Static OAI XML is missing ListRecords.");
		assert(staticXml.includes("<oai_dc:dc"), "Static OAI XML is missing oai_dc metadata.");
		const primoXml = renderPrimoListRecordsResponse({ records });
		assert(primoXml.includes("<ListRecords>"), "Primo VE XML is missing ListRecords root.");
		assert(!primoXml.includes("<OAI-PMH"), "Primo VE XML must not include an OAI-PMH envelope.");
		assert(primoXml.includes("<oai_dc:dc"), "Primo VE XML is missing oai_dc metadata.");
		runProtocolChecks({ baseURL, records, identify });
		assertIncrementalDayGranularity({ baseURL, records, identify });
		assertResumptionFlow({ baseURL, records, identify });
	};

	try {
		mustExist(OAI_XML_PATH);
		mustExist(OAI_INDEX_PATH);
		const index = JSON.parse(fs.readFileSync(OAI_INDEX_PATH, "utf8"));
		const records = Array.isArray(index.records) ? index.records : [];
		assert(records.length > 0, "oai-records.json is empty.");
		const baseURL = String(index.baseURL || "https://jcrt.org/sitemaps/oai_dc.xml").trim();
		const identify = {
			repositoryName: index.repositoryName,
			adminEmails: index.adminEmails,
			earliestDatestamp: index.earliestDatestamp,
			deletedRecord: index.deletedRecord,
			granularity: index.granularity,
			protocolVersion: index.protocolVersion,
			compressions: index.compressions,
		};

		runQuickChecks({ baseURL, records, identify });
		console.log(`[oai:validate] Quick protocol checks passed (${records.length} record(s)).`);
	} catch (error) {
		console.error(String(error?.message || error));
		throw new CheckFailed(String(error?.message || error));
	}
}

// ================================================================ bibliography

async function bibliography(args) {
	const verbose = args.includes("--verbose");
	const failures = new Map();
	const notes = new Map();
	const add = (map, rule, route, detail = "") => (map.get(rule) || map.set(rule, []).get(rule)).push(`${route}${detail ? `: ${detail}` : ""}`);
	const fail = (rule, route, detail) => add(failures, rule, route, detail);
	const note = (rule, route, detail) => add(notes, rule, route, detail);

	const decode = (value = "") => value.replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi, (_, number, named) => {
		if (number) {
			const hex = number[0].toLowerCase() === "x";
			return String.fromCodePoint(Number.parseInt(hex ? number.slice(1) : number, hex ? 16 : 10));
		}
		return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[named.toLowerCase()];
	});
	const attributes = (source) => {
		const out = {};
		for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
			out[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
		}
		return out;
	};
	const parseHtml = (file) => {
		const html = fs.readFileSync(file, "utf8");
		const metas = [...html.matchAll(/<meta\b([^>]*)>/gi)].map((match) => attributes(match[1]));
		const links = [...html.matchAll(/<link\b([^>]*)>/gi)].map((match) => attributes(match[1]));
		const json = [];
		for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
			const attrs = attributes(match[1]);
			if (attrs.type?.toLowerCase() !== "application/ld+json") continue;
			try { json.push(JSON.parse(match[2])); } catch (error) { json.push({ error: error.message }); }
		}
		return { html, metas, links, json };
	};
	const values = (doc, attribute, key) => doc.metas.filter((meta) => meta[attribute]?.toLowerCase() === key.toLowerCase()).map((meta) => meta.content ?? "");
	const named = (doc, key) => values(doc, "name", key);
	const property = (doc, key) => values(doc, "property", key);
	const hrefs = (doc, rel) => doc.links.filter((link) => link.rel?.toLowerCase() === rel).map((link) => link.href ?? "");
	const same = (actual, expected) => actual.length === expected.length && actual.every((value, i) => value === expected[i]);
	const show = (value) => JSON.stringify(value);
	const expectValues = (doc, route, kind, key, expected) => {
		const actual = kind === "name" ? named(doc, key) : property(doc, key);
		if (!same(actual, expected)) fail(`${kind}:${key}`, route, `expected ${show(expected)}, received ${show(actual)}`);
	};
	const graphNodes = (doc, route) => {
		const nodes = [];
		for (const value of doc.json) {
			if (value.error) fail("json-ld-parse", route, value.error);
			else nodes.push(...(Array.isArray(value?.["@graph"]) ? value["@graph"] : [value]));
		}
		if (!doc.json.length) fail("json-ld-missing", route);
		return nodes;
	};
	const checkNoEmptyTags = (doc, route) => {
		for (const meta of doc.metas) {
			const key = meta.name || meta.property || "";
			if (/^(?:dc:|dcterms:|citation_|prism\.|zotero:)/i.test(key) && !(meta.content || "").trim()) fail("empty-bibliography-tag", route, key);
		}
	};
	const readRoute = (route) => {
		const file = path.join(SITE_DIR, route.replace(/^\//, ""), "index.html");
		if (!fs.existsSync(file)) { fail("missing-built-page", route, path.relative(ROOT, file)); return null; }
		const doc = parseHtml(file);
		checkNoEmptyTags(doc, route);
		return doc;
	};

	const checkArticle = (record, metadataOnlyAbstracts) => {
		const route = record.path;
		const doc = readRoute(route);
		if (!doc) return;
		expectValues(doc, route, "property", "dc:title", [record.title]);
		expectValues(doc, route, "property", "dc:type", ["Text"]);
		expectValues(doc, route, "property", "dc:date", record.publicationDate ? [record.publicationDate] : []);
		expectValues(doc, route, "property", "dc:language", [record.language]);
		expectValues(doc, route, "property", "dc:publisher", [record.publisher]);
		expectValues(doc, route, "property", "dc:source", [record.publication]);
		expectValues(doc, route, "property", "dcterms:abstract", record.abstract ? [record.abstract] : []);
		expectValues(doc, route, "property", "dc:description", record.abstract || record.description ? [record.abstract || record.description] : []);
		expectValues(doc, route, "property", "article:published_time", record.publicationDate ? [record.publicationDate] : []);
		expectValues(doc, route, "property", "dc:creator", record.creators.map((author) => author.name));
		expectValues(doc, route, "name", "citation_author", record.creators.map((author) => author.citation));
		expectValues(doc, route, "name", "citation_title", [record.title]);
		expectValues(doc, route, "name", "citation_publisher", [record.publisher]);
		expectValues(doc, route, "name", "citation_language", [record.language]);
		expectValues(doc, route, "name", "citation_public_url", [record.url]);
		expectValues(doc, route, "name", "citation_fulltext_html_url", record.fulltext ? [record.url] : []);
		expectValues(doc, route, "name", "citation_abstract_html_url", record.fulltext ? [] : [record.url]);
		expectValues(doc, route, "name", "citation_pdf_url", record.pdfUrl ? [record.pdfUrl] : []);
		expectValues(doc, route, "name", "citation_doi", record.doi ? [record.doi] : []);
		expectValues(doc, route, "name", "citation_date", record.publicationDate ? [record.publicationDate] : []);
		expectValues(doc, route, "name", "citation_publication_date", record.publicationDate ? [record.publicationDate] : []);
		expectValues(doc, route, "name", "citation_cover_date", record.coverDate ? [record.coverDate] : []);
		expectValues(doc, route, "name", "citation_firstpage", record.pages.start ? [record.pages.start] : []);
		expectValues(doc, route, "name", "citation_lastpage", record.pages.end ? [record.pages.end] : []);
		expectValues(doc, route, "name", "citation_abstract", record.abstract ? [record.abstract] : []);
		expectValues(doc, route, "name", "citation_keywords", record.keywords.length ? [record.keywords.join("; ")] : []);
		expectValues(doc, route, "name", "citation_journal_title", record.archive ? [record.publication] : []);
		expectValues(doc, route, "name", "citation_issn", record.issn ? [record.issn] : []);
		expectValues(doc, route, "name", "citation_volume", record.volume ? [record.volume] : []);
		expectValues(doc, route, "name", "citation_issue", record.issue ? [record.issue] : []);
		expectValues(doc, route, "property", "dc:identifier", [record.url, ...(record.doi ? [`doi:${record.doi}`] : []), `nanoid:${record.nanoid}`]);
		const subjects = property(doc, "dc:subject");
		if (!same(subjects.slice(0, record.keywords.length), record.keywords)) fail("dc-keywords", route, `expected prefix ${show(record.keywords)}, received ${show(subjects)}`);

		const citeAs = hrefs(doc, "cite-as");
		if (!same(citeAs, [record.url])) fail("cite-as-html-url", route, `expected ${record.url}, received ${show(citeAs)}`);
		if ([...named(doc, "citation_public_url"), ...named(doc, "citation_fulltext_html_url"), ...named(doc, "citation_abstract_html_url")].some((url) => url === record.pdfUrl)) {
			fail("html-pdf-url-separation", route, record.pdfUrl);
		}
		if (record.doi && (/^(?:doi:|https?:)/i.test(record.doi) || !/^10\.\d{4,9}\/[\S]+$/i.test(record.doi))) fail("doi-normalization", route, record.doi);
		if (record.keywords.some((keyword) => ["theoryposts", "archives", "posts", "nav", "all"].includes(keyword.toLowerCase()))) fail("internal-keyword-leak", route, show(record.keywords));
		if (metadataOnlyAbstracts.has(route)) {
			const { expected, hasVisibleAbstract } = metadataOnlyAbstracts.get(route);
			if (record.abstract !== expected) fail("metadata-only-abstract-source", route, `expected ${show(expected)}, received ${show(record.abstract)}`);
			if (!hasVisibleAbstract && /<section\b[^>]*class="[^"]*\bjcrt-abstract\b/.test(doc.html)) fail("metadata-only-abstract-visible", route);
		}

		const nodes = graphNodes(doc, route);
		const schema = nodes.filter((node) => node?.["@id"] === `${record.url}#article`);
		if (schema.length !== 1) { fail("article-json-ld-node", route, `expected 1, received ${schema.length}`); return; }
		const article = schema[0];
		const type = record.archive ? "ScholarlyArticle" : "BlogPosting";
		for (const [key, expected] of [["@type", type], ["url", record.url], ["name", record.title], ["headline", record.title], ["inLanguage", record.language]]) {
			if (article[key] !== expected) fail(`json-ld-${key}`, route, `expected ${show(expected)}, received ${show(article[key])}`);
		}
		const authors = Array.isArray(article.author) ? article.author : [];
		if (authors.length !== record.creators.length) fail("json-ld-authors", route, `expected ${record.creators.length}, received ${authors.length}`);
		record.creators.forEach((creator, i) => {
			const author = authors[i] || {};
			const expectedType = creator.collective ? "Organization" : "Person";
			if (author.name !== creator.name || author["@type"] !== expectedType || author.givenName !== (creator.given || undefined) || author.familyName !== (creator.family || undefined)) {
				fail("json-ld-structured-author", route, `${show(creator)} received ${show(author)}`);
			}
			if (!creator.collective && (!creator.given || !creator.family)) note("source-author-name-unstructured", route, creator.name);
			if (!creator.collective && creator.given && creator.family) {
				const squash = (value) => value.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
				if (squash(`${creator.given}${creator.family}`) !== squash(creator.name)) note("source-author-display-differs-from-parts", route, show(creator));
			}
		});
		if (article.abstract !== (record.abstract || undefined)) fail("json-ld-abstract", route, `expected ${show(record.abstract || undefined)}, received ${show(article.abstract)}`);
		if (article.pageStart !== (record.pages.start || undefined) || article.pageEnd !== (record.pages.end || undefined)) fail("json-ld-pages", route);
		const identifiers = Array.isArray(article.identifier) ? article.identifier : article.identifier ? [article.identifier] : [];
		const nanoids = identifiers.filter((item) => item?.propertyID === "nanoid").map((item) => item.value);
		const dois = identifiers.filter((item) => item?.propertyID === "DOI");
		if (!same(nanoids, [record.nanoid])) fail("json-ld-nanoid", route, show(nanoids));
		if (record.doi) {
			if (dois.length !== 1 || dois[0].value !== record.doi || dois[0].url !== `https://doi.org/${record.doi}` || article.sameAs !== `https://doi.org/${record.doi}`) fail("json-ld-doi", route);
		} else if (dois.length || article.sameAs?.startsWith("https://doi.org/")) fail("json-ld-unexpected-doi", route);
		const pdfs = (Array.isArray(article.encoding) ? article.encoding : article.encoding ? [article.encoding] : []).filter((item) => item?.encodingFormat === "application/pdf").map((item) => item.contentUrl);
		if (!same(pdfs, record.pdfUrl ? [record.pdfUrl] : [])) fail("json-ld-pdf", route, `expected ${show(record.pdfUrl ? [record.pdfUrl] : [])}, received ${show(pdfs)}`);
	};

	const absoluteLinks = (fragment, baseUrl) => [...fragment.matchAll(/<a\b([^>]*)>/gi)].map((match) => attributes(match[1]).href).filter(Boolean).map((href) => new URL(href, baseUrl).href);

	const checkCollection = (route, index) => {
		const doc = readRoute(route);
		if (!doc) return;
		const issueSlug = route.match(/^\/archives\/(\d+\.\d+)\/$/)?.[1];
		const expectedTitle = issueSlug ? String(index.issues[issueSlug]?.title || "").trim() : property(doc, "dc:title")[0];
		expectValues(doc, route, "property", "dc:title", [expectedTitle]);
		expectValues(doc, route, "property", "dc:type", ["Collection"]);
		const issueData = index.issues[issueSlug] || {};
		const expectedDate = issueSlug ? preciseDate(issueData.date || issueData.year) : "";
		expectValues(doc, route, "property", "dc:date", expectedDate ? [expectedDate] : []);
		expectValues(doc, route, "property", "article:published_time", []);
		for (const key of ["citation_title", "citation_author"]) expectValues(doc, route, "name", key, []);
		expectValues(doc, route, "property", "zotero:itemType", []);
		const nodes = graphNodes(doc, route);
		const pages = nodes.filter((node) => node?.["@id"] === `${index.baseUrl}${route}#webpage`);
		if (pages.length !== 1) { fail("collection-json-ld-node", route, `expected 1, received ${pages.length}`); return; }
		const page = pages[0];
		if (page["@type"] !== "CollectionPage" || page.url !== `${index.baseUrl}${route}` || page.name !== expectedTitle) fail("collection-json-ld-fields", route);
		if (!issueSlug) return;
		const issue = page.mainEntity;
		if (issue?.["@type"] !== "PublicationIssue" || String(issue.issueNumber) !== String(index.issues[issueSlug].issue) || String(issue.isPartOf?.volumeNumber) !== String(index.issues[issueSlug].volume)) {
			fail("issue-json-ld-fields", route);
		}
		const schemaUrls = (Array.isArray(issue?.hasPart) ? issue.hasPart : []).map((item) => item.url);
		const toc = doc.html.match(/<section\b[^>]*class="[^"]*\bissue-toc\b[^"]*"[^>]*>([\s\S]*?)<\/section>/i)?.[1] || "";
		const visibleUrls = absoluteLinks(toc, index.baseUrl).filter((url) => url.startsWith(`${index.baseUrl}/archives/${issueSlug}/`));
		if (!same(schemaUrls, visibleUrls)) fail("issue-json-ld-toc-order", route, `schema ${schemaUrls.length}, visible ${visibleUrls.length}`);
		const recordUrls = Object.values(index.records).filter((record) => record.archive && record.path.startsWith(`/archives/${issueSlug}/`)).map((record) => record.url);
		for (const url of visibleUrls.filter((url) => !recordUrls.includes(url))) note("toc-page-excluded-from-bibliography", route, url);
		for (const url of recordUrls.filter((url) => !visibleUrls.includes(url))) fail("bibliography-record-missing-from-toc", route, url);
	};

	const report = (map, heading) => {
		if (!map.size) return;
		console.log(`\n${heading}:`);
		for (const [rule, items] of [...map].sort(([a], [b]) => a.localeCompare(b))) {
			console.log(`- ${rule}: ${items.length}`);
			for (const item of items.slice(0, verbose ? items.length : 5)) console.log(`  ${item}`);
			if (!verbose && items.length > 5) console.log(`  ... ${items.length - 5} more (use --verbose)`);
		}
	};

	if (!fs.existsSync(SITE_DIR)) {
		console.error("check-bibliography: _site is missing; build Eleventy first.");
		throw new CheckFailed("check-bibliography: _site is missing.");
	}

	const index = loadBibliography(ROOT);
	const metadataOnlyAbstracts = new Map();
	for (const file of walkFiles(path.join(CONTENT_DIR, "archives"), { match: isMarkdown })) {
		const { data } = parseFrontMatter(fs.readFileSync(file, "utf8"));
		if (!data.bibliographic_abstract) continue;
		const route = documentPathFor(path.relative(CONTENT_DIR, file), data);
		const expected = plain(data.bibliographic_abstract);
		if (route) metadataOnlyAbstracts.set(route, { expected, hasVisibleAbstract: Boolean(data.abstract) });
	}
	for (const record of Object.values(index.records)) checkArticle(record, metadataOnlyAbstracts);
	const builtRoutes = walkFiles(SITE_DIR, { match: (name) => name === "index.html" }).map((file) => {
		const rel = path.relative(SITE_DIR, path.dirname(file)).split(path.sep).join("/");
		return `/${rel ? `${rel}/` : ""}`;
	});
	const collectionRoutes = builtRoutes.filter((route) => route === "/archives/" || /^\/archives\/(?:\d+|\d+\.\d+)\/$/.test(route) || /^\/religioustheory\/(?:$|(?:posts|live)\/$|(?:posts|live)\/page\/\d+\/$)/.test(route));
	for (const route of collectionRoutes) checkCollection(route, index);

	for (const route of builtRoutes.filter((route) => /^\/archives\/\d+\.\d+\/[^/]+\/$/.test(route) || /^\/religioustheory\/(?:posts|live)\/[^/]+\/$/.test(route))) {
		if (!index.records[route]) note("built-page-excluded-from-bibliography", route);
	}
	for (const record of Object.values(index.records)) {
		if (record.archive && !record.abstract) note("source-archive-abstract-missing", record.path);
		if (!record.title || !record.creators.length || !record.nanoid) fail("source-required-fields", record.path, `title=${show(record.title)} creators=${record.creators.length} nanoid=${show(record.nanoid)}`);
		// Google Scholar inclusion floor for archive articles: title + author (above), a dated
		// citation_publication_date, and a public citation_pdf_url. Computo shipped for months
		// without the PDF tag and nobody noticed — https://computo-journal.org/blog/2026-07-26-google-scholar/
		if (record.archive && (!record.publicationDate || !record.pdfUrl)) fail("google-scholar-required", record.path, `date=${show(record.publicationDate)} pdf=${show(record.pdfUrl)}`);
		if (record.archive && !record.doi) note("source-archive-doi-missing", record.path);
	}

	report(notes, "Coverage notes");
	report(failures, "Failures");
	const total = Object.values(index.records).length;
	const summary = `${total} articles/posts and ${collectionRoutes.length} collection pages audited`;
	if (failures.size) {
		const count = [...failures.values()].reduce((sum, items) => sum + items.length, 0);
		console.error(`\ncheck-bibliography: failed (${count} findings; ${summary}).`);
		throw new CheckFailed(`check-bibliography: ${count} finding(s).`);
	}
	console.log(`\ncheck-bibliography: passed (${summary}).`);
}

// ================================================================ CLI

export { pre, standard, cms, sitemaps, oai, bibliography };
const commands = { pre, standard, cms, sitemaps, oai, bibliography };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [name = "", ...args] = process.argv.slice(2);
	if (!commands[name]) {
		console.error(`usage: node scripts/check.mjs <${Object.keys(commands).join("|")}> [flags]`);
		process.exit(2);
	}
	try {
		await commands[name](args);
	} catch (error) {
		if (!(error instanceof CheckFailed)) console.error(error.message);
		process.exitCode = 1;
	}
}
