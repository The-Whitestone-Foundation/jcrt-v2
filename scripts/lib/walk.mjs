// Recursive file listing shared by scripts/ and _data/. Iterative, tolerant of a missing
// directory (returns []), sorted by default so output never depends on readdir order
// (APFS and Netlify's ext4 disagree).
import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} dir
 * @param {{ match?: (name: string, fullPath: string) => boolean, sort?: boolean, skipDotfiles?: boolean }} [options]
 * @returns {string[]} absolute paths
 */
export function walkFiles(dir, { match, sort = true, skipDotfiles = false } = {}) {
	const files = [];
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			if (skipDotfiles && entry.name.startsWith(".")) continue;
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(fullPath);
			else if (entry.isFile() && (!match || match(entry.name, fullPath))) files.push(fullPath);
		}
	}
	return sort ? files.sort() : files;
}

export const isMarkdown = (name) => name.endsWith(".md");
