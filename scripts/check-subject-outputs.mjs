#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const ROOT = process.cwd();
const ARCHIVES = path.join(ROOT, "content", "archives");
const HTML = path.join(ROOT, "_site", "archives");
const V2_OAI = fs.readFileSync(path.join(ROOT, "public", "sitemaps", "oai_dc.xml"), "utf8");
const FILES_OAI = fs.readFileSync(path.resolve(ROOT, "..", "jcrt-files", "metadata", "oai_dc.xml"), "utf8");

function frontMatter(file) {
	const match = fs.readFileSync(file, "utf8").match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
	if (!match) throw new Error(`Missing front matter: ${file}`);
	return yaml.load(match[1]) || {};
}

function escape(value) {
	return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeXml(value) {
	return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function record(xml, identifier) {
	const start = xml.indexOf(`<identifier>${escapeXml(identifier)}</identifier>`);
	if (start < 0) return "";
	const blockStart = xml.lastIndexOf("<record>", start);
	return xml.slice(blockStart, xml.indexOf("</record>", start) + 9);
}

let articles = 0;
let v2Records = 0;
for (const issue of fs.readdirSync(ARCHIVES).filter((name) => /^\d+\.\d+$/.test(name))) {
	for (const name of fs.readdirSync(path.join(ARCHIVES, issue)).filter((file) => file.endsWith(".md"))) {
		const file = path.join(ARCHIVES, issue, name);
		const data = frontMatter(file);
		if (data.published === false) continue;
		articles += 1;
		const slug = path.basename(name, ".md");
		const subjects = (data.subjects || []).filter((subject) => subject?.scheme === "FAST");
		if (!subjects.length) throw new Error(`Missing FAST subjects: ${file}`);
		const htmlFile = path.join(HTML, issue, slug, "index.html");
		const html = fs.readFileSync(htmlFile, "utf8");
		const id = `oai:jcrt.org:archives:${issue}:${slug}`;
		const filesRecord = record(FILES_OAI, id);
		if (!filesRecord) throw new Error(`Missing jcrt-files OAI record: ${id}`);
		const v2Record = record(V2_OAI, id);
		if (v2Record) v2Records += 1;
		for (const subject of subjects) {
			if (!html.includes(`content="${escape(subject.label)}" data-subject-scheme="FAST"`)) throw new Error(`HTML missing FAST subject ${subject.label}: ${htmlFile}`);
			const dc = `<dc:subject>${escapeXml(subject.label)}</dc:subject>`;
			if (!filesRecord.includes(dc)) throw new Error(`jcrt-files OAI missing FAST subject ${subject.label}: ${id}`);
			if (v2Record && !v2Record.includes(dc)) throw new Error(`jcrt-v2 OAI missing FAST subject ${subject.label}: ${id}`);
		}
	}
}

if (articles !== 819 || v2Records !== 810) throw new Error(`Expected 819 HTML/jcrt-files records and 810 jcrt-v2 archive OAI records; found ${articles} and ${v2Records}`);
console.log(`Verified FAST subjects for ${articles} HTML/jcrt-files records and ${v2Records} jcrt-v2 archive OAI records.`);
