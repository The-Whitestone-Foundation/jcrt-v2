// Stages every publishable content page as a flat .sequoia/content/*.md file with the
// minimal front matter sequoia-cli publishes to AT Protocol (Standard.site documents).
import fs from "node:fs";
import path from "node:path";

import { stripMarkdown } from "../_config/markdownTitle.js";
import { parseFrontMatter } from "./lib/frontmatter.mjs";
import { walkFiles, isMarkdown } from "./lib/walk.mjs";
import { documentPathFor } from "./lib/paths.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const OUT_DIR = path.join(ROOT, ".sequoia", "content");
const SITE_NAME = "The Journal for Cultural and Religious Theory";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function writeRecord(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontMatter(source);
  // documentPathFor already drops drafts, unpublished pages, non-article issue pages and
  // anything outside the publishable subtrees.
  const standardPath = documentPathFor(path.relative(CONTENT_DIR, filePath), data);
  if (!standardPath) return false;
  const title = stripMarkdown(data.title || data.name || path.basename(filePath, ".md"));
  const description = data.description || data.abstract || data.bio || "";
  const date = data.date || (data.year ? `${data.year}-01-01` : "1999-01-01");
  const tags = [...new Set([...listValue(data.tags), ...listValue(data.keywords), ...listValue(data.categories)])];
  const outName = `${slugify(standardPath) || slugify(title)}.md`;
  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `date: ${yamlString(date)}`,
    `standardPath: ${yamlString(standardPath)}`,
    `publicationName: ${yamlString(SITE_NAME)}`,
    tags.length ? `tags: [${tags.map(yamlString).join(", ")}]` : "",
    "draft: false",
    "---",
    "",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(OUT_DIR, outName), `${frontmatter}
${body.trim()}\n`);
  return true;
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const filePath of walkFiles(CONTENT_DIR, { match: isMarkdown })) {
  if (writeRecord(filePath)) count += 1;
}
console.log(`[sequoia] staged ${count} documents in ${path.relative(ROOT, OUT_DIR)}`);
