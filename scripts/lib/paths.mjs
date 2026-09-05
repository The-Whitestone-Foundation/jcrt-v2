// Canonical URL paths for content files. Every script that maps content/**/*.md to a
// site path (Standard.site records, Sequoia staging, ATProto front matter) must agree
// byte-for-byte, so the rule lives here once.
import path from "node:path";

/** Issue-level pages that are not articles. */
export const NON_ARTICLE_SLUGS = new Set(["index", "bios", "author-bios", "table-of-contents", "abstracts"]);

/** content/ subtrees that publish as Standard.site documents. */
export const DOCUMENT_PREFIXES = ["archives/", "authors/", "blog/", "religioustheory/posts/", "religioustheory/live/"];

/** "/a/b?x#y" → "/a/b/", "" → "" */
export function normalizePath(value) {
	const raw = String(value || "").split("?")[0].split("#")[0].trim();
	if (!raw) return "";
	const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

/** Site base URL without trailing slashes; fallback when empty. */
export function normalizeUrl(value, fallback = "") {
	const trimmed = String(value || "").trim().replace(/\/+$/, "");
	return trimmed || String(fallback || "").trim().replace(/\/+$/, "");
}

/**
 * Canonical site path for a content file, or "" when the file does not publish.
 * @param {string} relPath  path relative to content/ (either separator)
 * @param {object} data     parsed front matter
 */
export function documentPathFor(relPath, data = {}) {
	const rel = String(relPath || "").split(/[\\/]/).join("/");
	if (!DOCUMENT_PREFIXES.some((prefix) => rel.startsWith(prefix))) return "";
	if (data?.draft === true || data?.published === false) return "";

	const slug = path.posix.basename(rel, ".md");
	if (NON_ARTICLE_SLUGS.has(slug.toLowerCase())) return "";
	if (typeof data?.permalink === "string" && data.permalink.startsWith("/")) return normalizePath(data.permalink);

	if (rel.startsWith("archives/")) {
		const parts = rel.split("/");
		// Only volume.issue directories hold articles; content/archives/keywords/ does not.
		return parts.length >= 3 && parts[1].includes(".") ? normalizePath(`/archives/${parts[1]}/${slug}/`) : "";
	}
	const prefix = DOCUMENT_PREFIXES.find((candidate) => rel.startsWith(candidate));
	return normalizePath(`/${prefix}${data?.slug || slug}/`);
}
