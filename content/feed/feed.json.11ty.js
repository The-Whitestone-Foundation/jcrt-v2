import { stripMarkdown } from "../../_config/markdownTitle.js";
function toPlainText(input = "") {
	return String(input)
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export default class FeedJsonTemplate {
	data() {
		return {
			permalink: "/feed/feed.json",
			layout: false,
			eleventyExcludeFromCollections: true,
		};
	}

	render(data) {
		const siteUrl = data?.metadata?.url || "";
		const items = [...(data?.collections?.feed || [])].reverse().slice(0, 50);

		const payload = {
			version: "https://jsonfeed.org/version/1.1",
			title: data?.metadata?.title || "Feed",
			home_page_url: siteUrl,
			feed_url: `${siteUrl}/feed/feed.json`,
			description: data?.metadata?.description || "",
			items: items.map((item) => {
				const url = `${siteUrl}${item.url || ""}`;
				// Avoid scanning full rendered templateContent for faster feed generation.
				const summarySource = item?.data?.excerpt || item?.data?.description || "";
				const content = toPlainText(summarySource);
				return {
					id: url,
					url,
					title: stripMarkdown(item?.data?.title || item?.fileSlug || item?.url || "Untitled"),
					date_published:
						item?.date instanceof Date ? item.date.toISOString() : new Date().toISOString(),
					content_text: content,
				};
			}),
		};

		return JSON.stringify(payload);
	}
}
