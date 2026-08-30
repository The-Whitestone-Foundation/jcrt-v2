export default {
	tags: [
		"theoryPosts"
	],
	"layout": "archive-post.njk",
	eleventyComputed: {
		// Set `pdf: <filename>.pdf` in a post's front matter to surface a download button.
		// Unlike archives — which derive the folder from filePathStem — theory PDFs live in
		// a flat /religioustheory/ directory on files.jcrt.org, not under /posts/.
		pdfUrl: (data) => {
			const rawPdf = data?.pdf;
			if (typeof rawPdf !== "string") return null;
			const fileName = rawPdf.trim();
			if (!fileName) return null;
			return `https://files.jcrt.org/religioustheory/${fileName}`;
		},
		// Book reviews get an accurate button label; everything else keeps "Article".
		pdfLabel: (data) => {
			const categories = Array.isArray(data?.categories) ? data.categories : [];
			const isBookReview = categories.some((c) => /book[\s._-]*review/i.test(String(c)));
			return isBookReview ? "Book Review" : "Article";
		},
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
