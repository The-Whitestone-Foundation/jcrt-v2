function wantsMarkdown(request) {
	const accept = request.headers.get("accept") || "";
	return /(?:^|,|\s)text\/markdown(?:\s*;|\s*(?:,|$))/i.test(accept);
}

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

function appendVary(headers, value) {
	const current = headers.get("vary");
	if (!current) {
		headers.set("vary", value);
		return;
	}
	const values = current.toLowerCase().split(",").map((part) => part.trim());
	if (values.includes(value.toLowerCase())) {
		return;
	}
	headers.set("vary", `${current}, ${value}`);
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
	headers.set("x-markdown-tokens", String(estimateTokens(markdown)));
	appendVary(headers, "Accept");
	// Cloudflare only varies its cache key on Accept-Encoding, so an HTML page and its
	// Markdown twin share one key. `no-store` stops any shared cache keeping the Markdown
	// variant and serving it to browsers. The `bypass-markdown-negotiation` Cache Rule in
	// jcrt-meta/docs/cloudflare-cache.md is the primary guard; this is the origin-side backstop.
	headers.set("cache-control", "private, no-store");
	return new Response(markdown, { status: htmlResponse.status, headers });
}

export default async (request, context) => {
	if (!wantsMarkdown(request)) {
		return context.next();
	}

	const response = await context.next();
	const contentType = response.headers.get("content-type") || "";
	if (!/text\/html/i.test(contentType)) {
		return response;
	}

	const html = await response.text();
	const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	const bodyHtml = bodyMatch ? bodyMatch[1] : html;
	const markdown = `${markdownizeBlocks(bodyHtml)}\n`;
	return markdownResponseFrom(response, markdown);
};