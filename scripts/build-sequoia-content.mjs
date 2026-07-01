import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const OUT_DIR = path.join(ROOT, ".sequoia", "content");
const SITE_NAME = "The Journal for Cultural and Religious Theory";

const INCLUDE_PREFIXES = [
  "archives/",
  "authors/",
  "blog/",
  "religioustheory/posts/",
];

const EXCLUDED_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function parseFrontMatter(source) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { data: {}, body: source };
  const data = {};
  let currentList = null;
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\t/g, "  ");
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentList) {
      data[currentList].push(cleanScalar(listItem[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    if (rawValue === "") {
      data[key] = [];
      currentList = key;
      continue;
    }
    if (rawValue === "|" || rawValue === ">") {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        i += 1;
        block.push(lines[i].trim());
      }
      data[key] = cleanScalar(block.join(rawValue === ">" ? " " : "\n"));
      currentList = null;
      continue;
    }
    currentList = null;
    data[key] = cleanScalar(rawValue);
  }
  return { data, body: source.slice(match[0].length) };
}

function cleanScalar(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^>\-\s*/, "")
    .replace(/^\|\s*/, "");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function outputPathFor(filePath, data) {
  const rel = path.relative(CONTENT_DIR, filePath).split(path.sep).join("/");
  const slug = path.basename(rel, ".md");
  if (EXCLUDED_SLUGS.has(slug.toLowerCase())) return "";
  if (typeof data.permalink === "string" && data.permalink.startsWith("/")) return data.permalink;
  if (rel.startsWith("archives/")) {
    const parts = rel.split("/");
    if (parts.length >= 3) return `/archives/${parts[1]}/${slug}/`;
  }
  if (rel.startsWith("religioustheory/posts/")) {
    return `/religioustheory/posts/${data.slug || slug}/`;
  }
  if (rel.startsWith("blog/")) {
    return `/blog/${data.slug || slug}/`;
  }
  if (rel.startsWith("authors/")) {
    return `/authors/${data.slug || slug}/`;
  }
  return "";
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
  const rel = path.relative(CONTENT_DIR, filePath).split(path.sep).join("/");
  if (!INCLUDE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false;
  if (data.draft === "true" || data.published === "false") return false;
  const standardPath = outputPathFor(filePath, data);
  if (!standardPath) return false;
  const title = data.title || data.name || path.basename(filePath, ".md");
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
for (const filePath of walk(CONTENT_DIR)) {
  if (writeRecord(filePath)) count += 1;
}
console.log(`[sequoia] staged ${count} documents in ${path.relative(ROOT, OUT_DIR)}`);
