// Markdown twin of every HTML page, served at `<path>index.md`.
//
// This used to content-negotiate on the page's own URL: `Accept: text/markdown` on
// /archives/25.2/ returned Markdown with `Vary: Accept`. Cloudflare only varies its cache
// key on Accept-Encoding, so the HTML page and its Markdown twin shared one cache key and
// a single agent request could poison the entry for everyone -- which is exactly what
// happened to /archives/25.2/, where browsers were served raw Markdown. The origin-side
// `Cache-Control: private, no-store` backstop did not help: rule 4 of the Cloudflare Cache
// Rules ("Ignore cache-control header and use this TTL") overrides it.
//
// Giving Markdown its own URL is the fix jcrt-meta/docs/cloudflare-cache.md prescribes for
// this case. Two URLs cannot share a cache key, so no Cache Rule has to be load-bearing.
// Discovery moves to the static `<link rel="alternate" type="text/markdown">` emitted by
// _includes/partials/seo.njk.

const MARKDOWN_SUFFIX = "index.md";

function decodeEntities(value) {
	return String(value || "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&#39;/g, "'")
		.replace(/&#160;/gi, " ");
}

function stripTags(value) {
	return decodeEntities(value).replace(/<[^>]+>/g, "");
}

function inlineMarkdown(value) {
	let output = String(value || "");
	output = output.replace(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, text) => {
		const label = inlineMarkdown(text);
		return label ? `[${label}](${href})` : href;
	});
	output = output.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, text) => `**${inlineMarkdown(text)}**`);
	output = output.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, text) => `*${inlineMarkdown(text)}*`);
	output = output.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, text) => `\`${stripTags(text).trim()}\``);
	output = output.replace(/<img\b[^>]*alt=(['"])(.*?)\1[^>]*>/gi, (_match, _quote, alt) => (alt ? `![${decodeEntities(alt)}]` : ""));
	output = output.replace(/<br\b[^>]*\/?>(?![^<]*>)/gi, "\n");
	return stripTags(output).replace(/\s+/g, " ").trim();
}

function markdownizeBlocks(html) {
	let output = String(html || "");

	output = output.replace(/<!--[\s\S]*?-->/g, "");
	output = output.replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	output = output.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, text) => {
		const code = decodeEntities(text.replace(/<code\b[^>]*>|<\/code>/gi, "").replace(/<[^>]+>/g, "")).trimEnd();
		return "\n\n```\n" + code + "\n```\n\n";
	});
	output = output.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, text) => `\n\n${"#".repeat(Number(level))} ${inlineMarkdown(text)}\n\n`);
	output = output.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, text) => `\n\n${inlineMarkdown(text)}\n\n`);
	output = output.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, text) => {
		const lines = inlineMarkdown(text)
			.split(/\n+/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => `> ${line}`);
		return lines.length ? `\n\n${lines.join("\n")}\n\n` : "";
	});
	output = output.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, text) => `\n- ${inlineMarkdown(text)}\n`);
	output = output.replace(/<\/(?:ul|ol|div|section|article|main|header|footer|nav|aside|figure|figcaption|details|summary|table|thead|tbody|tfoot|tr|td|th)>/gi, "\n");
	output = output.replace(/<br\b[^>]*\/?>(?![^<]*>)/gi, "\n");
	output = output.replace(/<hr\b[^>]*\/?>(?![^<]*>)/gi, "\n\n---\n\n");
	output = output.replace(/<img\b[^>]*>/gi, (imageTag) => {
		const altMatch = imageTag.match(/\balt=(['"])(.*?)\1/i);
		const srcMatch = imageTag.match(/\bsrc=(['"])(.*?)\1/i);
		const altText = decodeEntities(altMatch?.[2] || "").trim();
		const src = decodeEntities(srcMatch?.[2] || "").trim();
		if (!src && !altText) return "";
		if (altText && src) return `![${altText}](${src})`;
		if (src) return `![](${src})`;
		return altText;
	});
	output = output.replace(/<[^>]+>/g, "");
	output = decodeEntities(output);
	output = output.replace(/[ \t]+\n/g, "\n");
	output = output.replace(/\n{3,}/g, "\n\n");
	return output.trim();
}

function estimateTokens(markdown) {
	return Math.max(1, Math.ceil(String(markdown || "").length / 4));
}

function markdownResponseFrom(htmlResponse, markdown) {
	const headers = new Headers(htmlResponse.headers);
	headers.set("content-type", "text/markdown; charset=utf-8");
	headers.delete("content-length");
	headers.delete("content-encoding");
	headers.delete("etag");
	headers.delete("content-md5");
	headers.delete("content-range");
	headers.delete("accept-ranges");
	headers.delete("vary");
	headers.set("x-markdown-tokens", String(estimateTokens(markdown)));
	// Safe to cache now that this body has a URL of its own. Freshness comes from the
	// deploy purge in plugins/cloudflare-purge/, the same as for the HTML page.
	return new Response(markdown, { status: htmlResponse.status, headers });
}

export default async (request, context) => {
	const url = new URL(request.url);
	if (!url.pathname.endsWith(`/${MARKDOWN_SUFFIX}`)) {
		return context.next();
	}

	const htmlUrl = new URL(url);
	htmlUrl.pathname = url.pathname.slice(0, -MARKDOWN_SUFFIX.length);

	const response = await context.rewrite(htmlUrl);
	const contentType = response.headers.get("content-type") || "";
	if (!response.ok || !/text\/html/i.test(contentType)) {
		return response;
	}

	const html = await response.text();
	const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	const bodyHtml = bodyMatch ? bodyMatch[1] : html;
	const markdown = `${markdownizeBlocks(bodyHtml)}\n`;
	return markdownResponseFrom(response, markdown);
};
