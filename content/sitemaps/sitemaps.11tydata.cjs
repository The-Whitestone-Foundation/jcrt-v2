module.exports = {
	layout: false,
	eleventyExcludeFromCollections: true,
	eleventyComputed: {
		// Serve mode includes sitemaps by default so local checks match deploy behavior.
		// Set SKIP_SITEMAPS_IN_SERVE=1 only when you explicitly want a faster local cycle.
		permalink: (data) => {
			const skipInServe =
				process.env.ELEVENTY_RUN_MODE === "serve" &&
				String(process.env.SKIP_SITEMAPS_IN_SERVE || "") === "1";
			return skipInServe ? false : data.permalink;
		},
	},
};
