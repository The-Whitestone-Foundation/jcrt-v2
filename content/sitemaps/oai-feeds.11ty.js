// One output file per entry of _data/oaiFeeds.js `files`, written byte-exact (a JavaScript
// template: no Nunjucks pass, no trailing-newline surprises). These feeds are <records> /
// JSON payloads, not <urlset>s, so _data/sitemapIndex.js keeps them out of the root index.
export default {
	data: {
		pagination: { data: "oaiFeeds.files", size: 1, alias: "feed" },
		permalink: (data) => data.feed.path,
		eleventyExcludeFromCollections: true,
	},
	render: (data) => data.feed.body,
};
