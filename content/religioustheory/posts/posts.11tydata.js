export default {
	tags: [
		"theoryPosts"
	],
	"layout": "archive-post.njk",
	eleventyComputed: {
		doiUrl: (data) => {
			const doi = String(data?.doi ?? "").trim();
			if (!doi) return null;
			const bare = doi
				.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
				.replace(/^doi:\s*/i, "")
				.trim();
			if (!bare) return null;
			return `https://doi.org/${bare}`;
		},
		risCitationUrl: (data) => {
			const slug = data?.page?.fileSlug;
			if (!slug) return null;
			return `https://files.jcrt.org/citations/religioustheory/${slug}.ris`;
		},
		jsonCitationUrl: (data) => {
			const slug = data?.page?.fileSlug;
			if (!slug) return null;
			return `https://files.jcrt.org/citations/religioustheory/${slug}.csl.json`;
		},
	},
};
