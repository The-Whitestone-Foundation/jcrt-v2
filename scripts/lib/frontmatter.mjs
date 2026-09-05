// Front matter and YAML helpers shared by scripts/ and _data/. One parser, one contract:
// parseFrontMatter always returns an object, never throws, and gives callers both the
// parsed data and the raw block/body offsets so they can rewrite a file without
// re-serialising YAML (apply-atproto-frontmatter.mjs depends on that).
import fs from "node:fs";
import * as yaml from "js-yaml";

const FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

/**
 * @param {string} source  full file contents
 * @param {{ repairKeys?: string[] }} [options]  keys whose lines are stripped and the block
 *        re-parsed once if the YAML is malformed (used for a broken `atproto:` line)
 * @returns {{ hasFrontMatter: boolean, data: any, body: string, block: string, bodyStart: number }}
 */
export function parseFrontMatter(source, { repairKeys = [] } = {}) {
	const text = String(source ?? "");
	const match = text.startsWith("---") ? text.match(FRONT_MATTER) : null;
	if (!match) return { hasFrontMatter: false, data: {}, body: text, block: "", bodyStart: 0 };

	const block = match[1];
	let data = {};
	try {
		data = yaml.load(block) || {};
	} catch {
		if (repairKeys.length) {
			const stripped = block.replace(new RegExp(`^(?:${repairKeys.join("|")}):[^\\n]*(?:\\n|$)`, "gm"), "");
			try {
				data = yaml.load(stripped) || {};
			} catch {
				data = {};
			}
		}
	}
	return { hasFrontMatter: true, data, body: text.slice(match[0].length), block, bodyStart: match[0].length };
}

/** Load a YAML file; on any error call onError (if given) and return fallback. */
export function readYaml(filePath, { fallback = {}, onError } = {}) {
	try {
		return yaml.load(fs.readFileSync(filePath, "utf8")) || fallback;
	} catch (error) {
		if (onError) onError(error);
		return fallback;
	}
}
