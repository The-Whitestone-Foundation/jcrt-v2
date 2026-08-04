#!/usr/bin/env node
/**
 * Archive-wide validator for built archive pages in _site/archives/.
 *
 * Checks:
 * - Broken internal links across built archive HTML
 * - Broken files.jcrt.org PDF and citation links against ../jcrt-files
 * - Expected author page/link, keyword page/link, PDF link, and citation links
 *   for each published archive article source file
 *
 * Usage:
 *   node scripts/check-archive-links.mjs
 *   node scripts/check-archive-links.mjs --issue 25.1
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { authorSlug, splitAuthors } from "../_config/authorSlug.js";

const ROOT = process.cwd();
const SITE_DIR = path.resolve(ROOT, "_site");
const ARCHIVES_SITE_DIR = path.join(SITE_DIR, "archives");
const CONTENT_ARCHIVES_DIR = path.join(ROOT, "content", "archives");
const FILES_ROOT = path.resolve(ROOT, "..", "jcrt-files");
const SITE_URL = "https://jcrt.org";
const FILES_URL = "https://files.jcrt.org";
const REPORT_PATH = path.join(ROOT, "docs", "archive-link-validation.md");

function parseArgs(argv) {
	let issue = "";
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--issue") {
			issue = String(argv[i + 1] || "").trim();
			i++;
		}
	}
	return { issue };
}

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

function isPublished(data) {
	if (data?.published === false) return false;
	return String(data?.published || "").trim().toLowerCase() !== "false";
}

function ensureArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map((item) => String(item || "").trim()).filter(Boolean);
	}
	return String(value)
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function slugifyKeyword(value) {
	return String(value || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function collectHtmlFiles(dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectHtmlFiles(full));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".html")) {
			results.push(full);
		}
	}
	return results;
}

function walkMarkdown(dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(path.join(entry.parentPath || entry.path, entry.name));
		}
	}
	return results;
}

function extractHrefs(html) {
	const hrefs = [];
	const pattern = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
	let match;
	while ((match = pattern.exec(html)) !== null) {
		hrefs.push(match[1]);
	}
	return hrefs;
}

function buildSiteIndex() {
	const index = new Set();
	function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			const rel = `/${path.relative(SITE_DIR, full).split(path.sep).join("/")}`;
			if (entry.isDirectory()) {
				index.add(rel);
				index.add(`${rel}/`);
				walk(full);
				continue;
			}
			index.add(rel);
		}
	}
	walk(SITE_DIR);
	return index;
}

function linkExists(target, siteIndex) {
	if (siteIndex.has(target)) return true;
	if (siteIndex.has(`${target}/`)) return true;
	if (siteIndex.has(`${target}/index.html`)) return true;
	if (siteIndex.has(`${target}index.html`)) return true;
	if (target.endsWith("/") && siteIndex.has(target.slice(0, -1))) return true;
	if (!target.endsWith(".html") && siteIndex.has(`${target}.html`)) return true;
	return false;
}

function classifyHref(href, pageRelPath) {
	if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return null;

	const clean = href.split("#")[0].split("?")[0];
	if (!clean) return null;

	if (/^https?:\/\//i.test(clean)) {
		try {
			const url = new URL(clean);
			if (url.origin === SITE_URL) {
				return { type: "internal", target: url.pathname || "/" };
			}
			if (url.origin === FILES_URL) {
				return {
					type: "files",
					target: path.join(FILES_ROOT, url.pathname.replace(/^\/+/, "")),
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	if (clean.startsWith("/")) {
		return { type: "internal", target: clean };
	}

	const pageDir = path.posix.dirname(pageRelPath);
	const target = path.posix.normalize(path.posix.join(pageDir, clean));
	return { type: "internal", target: target.startsWith("/") ? target : `/${target}` };
}

function formatPageRel(filePath) {
	return `/${path.relative(SITE_DIR, filePath).split(path.sep).join("/")}`;
}

function hasHref(html, href) {
	return html.includes(`href="${href}"`) || html.includes(`href='${href}'`);
}

function pushIssue(issues, page, kind, details) {
	issues.push({ page, kind, details });
}

function main() {
	const { issue: issueFilter } = parseArgs(process.argv.slice(2));

	if (!fs.existsSync(SITE_DIR)) {
		console.error(`Missing build output: ${SITE_DIR}`);
		console.error("Run the site build first.");
		process.exit(1);
	}

	if (!fs.existsSync(FILES_ROOT)) {
		console.error(`Missing sibling files repo: ${FILES_ROOT}`);
		process.exit(1);
	}

	const scanRoot = issueFilter
		? path.join(ARCHIVES_SITE_DIR, issueFilter)
		: ARCHIVES_SITE_DIR;

	if (!fs.existsSync(scanRoot)) {
		console.error(`Archive build output not found: ${scanRoot}`);
		process.exit(1);
	}

	const siteIndex = buildSiteIndex();
	const htmlFiles = collectHtmlFiles(scanRoot);
	const genericIssues = [];
	let genericChecked = 0;

	for (const filePath of htmlFiles) {
		const html = fs.readFileSync(filePath, "utf8");
		const pageRel = formatPageRel(filePath);
		for (const href of extractHrefs(html)) {
			const classified = classifyHref(href, pageRel);
			if (!classified) continue;
			genericChecked++;

			if (classified.type === "internal" && !linkExists(classified.target, siteIndex)) {
				pushIssue(genericIssues, pageRel, "broken-internal-link", `${href} -> ${classified.target}`);
			}

			if (classified.type === "files" && !fs.existsSync(classified.target)) {
				pushIssue(
					genericIssues,
					pageRel,
					"missing-files-link-target",
					`${href} -> ${classified.target}`,
				);
			}
		}
	}

	const sourceIssues = [];
	let articlesChecked = 0;
	const articleFiles = walkMarkdown(CONTENT_ARCHIVES_DIR);

	for (const filePath of articleFiles) {
		const rel = path.relative(CONTENT_ARCHIVES_DIR, filePath);
		const parts = rel.split(path.sep);
		if (parts.length < 2) continue;

		const issueSlug = parts[0];
		if (!issueSlug.includes(".")) continue;
		if (issueFilter && issueSlug !== issueFilter) continue;

		const slug = path.basename(filePath, ".md");
		if (slug === "index") continue;

		const content = fs.readFileSync(filePath, "utf8");
		const data = parseFrontMatter(content);
		if (!isPublished(data)) continue;

		articlesChecked++;
		const pagePath = path.join(SITE_DIR, "archives", issueSlug, slug, "index.html");
		const pageRel = `/archives/${issueSlug}/${slug}/`;
		if (!fs.existsSync(pagePath)) {
			pushIssue(sourceIssues, pageRel, "missing-article-page", pagePath);
			continue;
		}

		const html = fs.readFileSync(pagePath, "utf8");
		const authors = splitAuthors(data.author);
		const keywords = ensureArray(data.keywords);
		const pdfFile = String(data.pdf || "").trim().replace(/^["']|["']$/g, "");
		const citationStem = pdfFile.toLowerCase().endsWith(".pdf")
			? pdfFile.slice(0, -4)
			: slug;

		for (const name of authors) {
			const sluggedAuthor = authorSlug(name);
			const authorHref = `/authors/${sluggedAuthor}/`;
			const authorPagePath = path.join(SITE_DIR, "authors", sluggedAuthor, "index.html");

			if (!fs.existsSync(authorPagePath)) {
				pushIssue(sourceIssues, pageRel, "missing-author-page", `${name} -> ${authorPagePath}`);
				continue;
			}

			if (!hasHref(html, authorHref) && !hasHref(html, `${SITE_URL}${authorHref}`)) {
				pushIssue(sourceIssues, pageRel, "missing-author-link", `${name} -> ${authorHref}`);
			}
		}

		if (pdfFile) {
			const pdfHref = `${FILES_URL}/archives/${issueSlug}/${pdfFile}`;
			const pdfPath = path.join(FILES_ROOT, "archives", issueSlug, pdfFile);
			if (!fs.existsSync(pdfPath)) {
				pushIssue(sourceIssues, pageRel, "missing-pdf-file", pdfPath);
			}
			if (!hasHref(html, pdfHref)) {
				pushIssue(sourceIssues, pageRel, "missing-pdf-link", pdfHref);
			}
		}

		for (const ext of [".ris", ".csl.json"]) {
			const citationHref = `${FILES_URL}/citations/archives/${issueSlug}/${citationStem}${ext}`;
			const citationPath = path.join(FILES_ROOT, "citations", "archives", issueSlug, `${citationStem}${ext}`);
			if (!fs.existsSync(citationPath)) {
				pushIssue(sourceIssues, pageRel, "missing-citation-file", citationPath);
			}
			if (!hasHref(html, citationHref)) {
				pushIssue(sourceIssues, pageRel, "missing-citation-link", citationHref);
			}
		}

		for (const keyword of keywords) {
			const keywordSlug = slugifyKeyword(keyword);
			const keywordHref = `/archives/keywords/${keywordSlug}/`;
			const keywordPagePath = path.join(SITE_DIR, "archives", "keywords", keywordSlug, "index.html");
			if (!fs.existsSync(keywordPagePath)) {
				pushIssue(sourceIssues, pageRel, "missing-keyword-page", `${keyword} -> ${keywordPagePath}`);
			}
			if (!hasHref(html, keywordHref) && !hasHref(html, `${SITE_URL}${keywordHref}`)) {
				pushIssue(sourceIssues, pageRel, "missing-keyword-link", `${keyword} -> ${keywordHref}`);
			}
		}
	}

	const allIssues = [...genericIssues, ...sourceIssues];
	const scopeLabel = issueFilter ? `Issue ${issueFilter}` : "All archives";

	console.log("=".repeat(72));
	console.log(`ARCHIVE LINK VALIDATION — ${scopeLabel}`);
	console.log(`Built HTML files scanned: ${htmlFiles.length}`);
	console.log(`Anchor hrefs checked:     ${genericChecked}`);
	console.log(`Published articles checked: ${articlesChecked}`);
	console.log(`Generic link issues:      ${genericIssues.length}`);
	console.log(`Source-aware issues:      ${sourceIssues.length}`);
	console.log(`Total issues:             ${allIssues.length}`);
	console.log("=".repeat(72));

	const lines = [
		`# Archive Link Validation`,
		"",
		`> Scope: ${scopeLabel}`,
		`> Generated: ${new Date().toISOString()}`,
		"",
		`| Metric | Count |`,
		`|--------|-------|`,
		`| Built HTML files scanned | ${htmlFiles.length} |`,
		`| Anchor hrefs checked | ${genericChecked} |`,
		`| Published articles checked | ${articlesChecked} |`,
		`| Generic link issues | ${genericIssues.length} |`,
		`| Source-aware issues | ${sourceIssues.length} |`,
		`| Total issues | ${allIssues.length} |`,
		"",
	];

	if (allIssues.length === 0) {
		console.log("\nNo archive link issues found.");
		lines.push("No archive link issues found.", "");
		fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
		fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
		return;
	}

	const grouped = new Map();
	for (const issue of allIssues) {
		if (!grouped.has(issue.page)) grouped.set(issue.page, []);
		grouped.get(issue.page).push(issue);
	}

	for (const [page, issues] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		console.log(`\n${page}`);
		lines.push(`## ${page}`, "", `| Kind | Details |`, `|------|---------|`);
		for (const issue of issues) {
			console.log(`  - ${issue.kind}: ${issue.details}`);
			lines.push(`| ${issue.kind} | \`${String(issue.details).replace(/\|/g, "\\|")}\` |`);
		}
		lines.push("");
	}

	fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
	fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
	console.log(`\nReport written to ${REPORT_PATH}`);
	process.exitCode = 1;
}

main();
