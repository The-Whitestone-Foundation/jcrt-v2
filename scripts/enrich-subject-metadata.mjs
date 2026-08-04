#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import * as yaml from "js-yaml";
import { controlledSubjects } from "../_config/subjects.js";

const ROOT = process.cwd();
const DATASET = path.resolve(ROOT, "..", "FAST_Dataset_Download");
const FAST_DIR = path.join(DATASET, "FASTAll.marcxml");
const HOMOSAURUS_FILE = path.join(DATASET, "homosaurus_v5.jsonld");
const sectionArg = process.argv.indexOf("--section");
const section = sectionArg >= 0 ? process.argv[sectionArg + 1] : "archives";
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");

if (!new Set(["archives", "religioustheory", "all"]).has(section)) {
	throw new Error("--section must be archives, religioustheory, or all");
}

const theoryRoots = ["posts", "live"].map((directory) => path.join(ROOT, "content", "religioustheory", directory));
const roots = section === "all"
	? [path.join(ROOT, "content", "archives"), ...theoryRoots]
	: section === "archives" ? [path.join(ROOT, "content", "archives")] : theoryRoots;

function walk(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
	});
}

function parse(file) {
	const raw = fs.readFileSync(file, "utf8");
	const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
	if (!match) return { raw, match: null, data: {} };
	return { raw, match, data: yaml.load(match[1]) || {} };
}

function normalize(value) {
	return String(value || "")
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[‐‑‒–—-]+/g, " ")
		.replace(/[^\p{L}\p{N}+]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function inputs(data, theory) {
	const list = (value) => (Array.isArray(value) ? value : value ? String(value).split(",") : []);
	return [...list(data.keywords), ...(theory ? [...list(data.categories), ...list(data.tags)] : [])]
		.map((value) => String(value || "").trim())
		.filter((value) => value && value !== "theoryPosts");
}

function decodeXml(value) {
	return String(value || "")
		.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
}

function subfields(xml, tag) {
	const field = [...xml.matchAll(new RegExp(`<mx:datafield\\s+tag="${tag}"[\\s\\S]*?<\\/mx:datafield>`, "g"))];
	return field.map((match) => [...match[0].matchAll(/<mx:subfield\s+code="[a-z0-9]">([\s\S]*?)<\/mx:subfield>/g)]
		.map((part) => decodeXml(part[1]).trim()).filter(Boolean).join(" "));
}

const fastFiles = [
	["FASTTopical.marcxml", "topical", "150", "450"],
	["FASTFormGenre.marcxml", "form-genre", "155", "455"],
	["FASTGeographic.marcxml", "geographic", "151", "451"],
	["FASTChronological.marcxml", "chronological", "148", "448"],
	["FASTPersonal.marcxml", "personal", "100", "400"],
	["FASTCorporate.marcxml", "corporate", "110", "410"],
	["FASTMeeting.marcxml", "meeting", "111", "411"],
	["FASTEvent.marcxml", "event", "147", "447"],
	["FASTTitle.marcxml", "title", "130", "430"],
];

async function fastMatches(wanted) {
	const found = new Map();
	for (const [name, category, preferredTag, alternateTag] of fastFiles) {
		const stream = fs.createReadStream(path.join(FAST_DIR, name), { encoding: "utf8" });
		const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
		let record = "";
		for await (const line of lines) {
			if (line.includes("<mx:record>")) record = "";
			if (record !== null) record += `${line}\n`;
			if (!line.includes("</mx:record>")) continue;
			const preferred = subfields(record, preferredTag)[0];
			if (preferred) {
				const labels = [preferred, ...subfields(record, alternateTag)];
				const keys = [...new Set(labels.map(normalize).filter((key) => wanted.has(key)))];
				if (keys.length) {
					const identifier = record.match(/<mx:controlfield\s+tag="001">(fst\d+)<\/mx:controlfield>/)?.[1] || "";
					const numeric = identifier.replace(/^fst0*/, "");
					const subject = { label: preferred, scheme: "FAST", identifier, uri: `https://id.worldcat.org/fast/${numeric}`, category };
					for (const key of keys) {
						if (!found.has(key)) found.set(key, []);
						found.get(key).push({ ...subject, matchQuality: normalize(preferred) === key ? 0 : 1 });
					}
				}
			}
			record = null;
		}
	}
	return found;
}

const categoryPriority = new Map(fastFiles.map(([, category], index) => [category, index]));

function resolveFast(options, key) {
	const unique = [...new Map(options.map((item) => [item.identifier, item])).values()];
	const broadFacets = new Set(["topical", "form-genre", "geographic", "chronological"]);
	const eligible = unique.filter((item) => broadFacets.has(item.category) || key.includes(" "));
	if (!eligible.length) return [];
	const bestMatch = Math.min(...eligible.map((item) => item.matchQuality));
	const byMatch = eligible.filter((item) => item.matchQuality === bestMatch);
	const bestCategory = Math.min(...byMatch.map((item) => categoryPriority.get(item.category) ?? 99));
	return byMatch.filter((item) => (categoryPriority.get(item.category) ?? 99) === bestCategory);
}

function homosaurusMatches(wanted) {
	const graph = JSON.parse(fs.readFileSync(HOMOSAURUS_FILE, "utf8"))["@graph"] || [];
	const found = new Map();
	const english = (value) => (Array.isArray(value) ? value : value ? [value] : [])
		.filter((item) => item?.["@language"] === "en" && item?.["@value"])
		.map((item) => item["@value"]);
	for (const concept of graph) {
		const preferred = english(concept["skos:prefLabel"])[0];
		if (!preferred) continue;
		const keys = [preferred, ...english(concept["skos:altLabel"])].map(normalize).filter((key) => wanted.has(key));
		if (!keys.length) continue;
		const uri = String(concept["@id"] || "");
		const subject = { label: preferred, scheme: "Homosaurus", identifier: String(concept["dc:identifier"] || ""), uri, category: "topical" };
		for (const key of keys) {
			if (!found.has(key)) found.set(key, []);
			found.get(key).push(subject);
		}
	}
	return found;
}

function yamlSubjects(subjects) {
	return yaml.dump({ subjects }, { noRefs: true, lineWidth: -1, quotingType: '"', forceQuotes: true }).trimEnd();
}

const files = roots.flatMap(walk);
const parsed = files.map((file) => ({ file, ...parse(file), theory: file.includes(`${path.sep}religioustheory${path.sep}`) }));
const wanted = new Set(parsed.flatMap((entry) => inputs(entry.data, entry.theory).map(normalize)).filter(Boolean));
console.error(`Scanning FAST for ${wanted.size} distinct source terms...`);
const fast = await fastMatches(wanted);
const homosaurus = homosaurusMatches(wanted);
let changed = 0;
let fastCount = 0;
let homosaurusCount = 0;
const ambiguous = new Set();

for (const entry of parsed) {
	if (!entry.match) continue;
	const generated = [];
	for (const term of inputs(entry.data, entry.theory)) {
		const key = normalize(term);
		const fastOptions = resolveFast(fast.get(key) || [], key);
		const homoOptions = homosaurus.get(key) || [];
		if (fastOptions.length === 1) generated.push(fastOptions[0]);
		else if (fastOptions.length > 1) ambiguous.add(`FAST\t${term}\t${fastOptions.map((item) => item.label).join(" | ")}`);
		// FAST wins a cross-vocabulary ambiguity; Homosaurus is only added when FAST did not match.
		if (fastOptions.length === 0 && homoOptions.length === 1) generated.push(homoOptions[0]);
		else if (fastOptions.length === 0 && homoOptions.length > 1) ambiguous.add(`Homosaurus\t${term}\t${homoOptions.map((item) => item.label).join(" | ")}`);
	}
	const subjects = controlledSubjects(generated);
	fastCount += subjects.filter((item) => item.scheme === "FAST").length;
	homosaurusCount += subjects.filter((item) => item.scheme === "Homosaurus").length;
	const withoutOld = entry.match[1].replace(/\n?subjects:\n(?:^[ \t]+.*\n?)*/m, "").trimEnd();
	const frontmatter = subjects.length ? `${withoutOld}\n${yamlSubjects(subjects)}` : withoutOld;
	const next = entry.raw.replace(entry.match[0], `---\n${frontmatter}\n---\n`);
	if (next === entry.raw) continue;
	changed += 1;
	if (write) fs.writeFileSync(entry.file, next);
}

for (const line of [...ambiguous].sort()) console.log(`AMBIGUOUS\t${line}`);
console.log(`${write ? "Updated" : "Would update"} ${changed} files; FAST=${fastCount}; Homosaurus=${homosaurusCount}; ambiguous=${ambiguous.size}`);
if (check && changed) process.exitCode = 1;
