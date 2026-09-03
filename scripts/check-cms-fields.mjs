#!/usr/bin/env node
//
// check-cms-fields.mjs — guard against Decap CMS silently deleting front matter.
//
// Decap writes back ONLY the fields declared in public/admin/config.yml. Any key
// present in a content file but missing from its collection's `fields` is dropped
// the first time an editor saves that entry. This walks every collection (folder
// and file based, including nested object/list widgets) and fails if any key in
// the corpus is undeclared.
//
//   node scripts/check-cms-fields.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(REPO_ROOT, "public", "admin", "config.yml");

const cfg = yaml.load(fs.readFileSync(CONFIG, "utf8"));
let failures = 0;

function readData(file) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return yaml.load(text);
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? yaml.load(match[1]) : {};
}

function check(file, data, fields, prefix = "") {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const declared = new Map((fields || []).map((f) => [f.name, f]));
  for (const [key, value] of Object.entries(data)) {
    const field = declared.get(key);
    if (!field) {
      console.error(`  undeclared: ${path.relative(REPO_ROOT, file)} :: ${prefix}${key}`);
      failures++;
      continue;
    }
    if (field.widget === "object" && field.fields) check(file, value, field.fields, `${prefix}${key}.`);
    if (field.widget === "list" && field.fields && Array.isArray(value)) {
      for (const item of value) check(file, item, field.fields, `${prefix}${key}[].`);
    }
  }
}

function walkMarkdown(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

for (const collection of cfg.collections) {
  if (collection.folder) {
    const dir = path.join(REPO_ROOT, collection.folder);
    if (!fs.existsSync(dir)) {
      console.error(`  missing folder: ${collection.folder}`);
      failures++;
      continue;
    }
    const files = [];
    walkMarkdown(dir, files);
    for (const file of files) {
      let data;
      try { data = readData(file); } catch { continue; }
      check(file, data, collection.fields);
    }
    console.log(`${collection.name}: ${files.length} files`);
  }
  for (const file of collection.files || []) {
    const full = path.join(REPO_ROOT, file.file);
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
  process.exit(1);
}
console.log("\ncheck-cms-fields: every front matter key is declared in public/admin/config.yml");
