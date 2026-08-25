import markdownIt from "markdown-it";

// Titles may carry light inline markdown — most often *italics* for a cited
// work, e.g. "Voyeurism and Performance in Augustine's *Confessions*".
// `html: false` means author-supplied angle brackets and ampersands are
// escaped for us, so the rendered result is safe to mark `| safe` in a
// template. Block syntax never applies: `renderInline` emits no <p> wrapper.
const inlineMd = markdownIt({ html: false, linkify: false, typographer: false });

const ENTITIES = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&#x27;": "'",
	"&nbsp;": " ",
};

/** Render inline markdown in a title to HTML (no block wrapper). */
export function renderInlineMarkdown(value) {
	if (value === null || value === undefined) return "";
	const raw = String(value);
	if (!raw) return "";
	return inlineMd.renderInline(raw);
}

/**
 * Plain-text form of a title, for <title>, meta tags, feeds, sitemaps and
 * citation records — anywhere markup would be wrong. Derived from the same
 * renderer as `renderInlineMarkdown` so the two can never disagree about
 * what counts as emphasis.
 */
export function stripMarkdown(value) {
	const html = renderInlineMarkdown(value);
	if (!html) return "";
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;|&nbsp;/g, (m) => ENTITIES[m] || m);
}
