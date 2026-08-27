function xml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function publicationDate(record) {
	const [year, month, day] = String(record.dateIssued || record.publicationYear || "1999").split("-");
	return [
		'      <pub-date date-type="pub" publication-format="electronic">',
		day ? `        <day>${xml(day)}</day>` : "",
		month ? `        <month>${xml(month)}</month>` : "",
		`        <year>${xml(year || "1999")}</year>`,
		"      </pub-date>",
	].filter(Boolean).join("\n");
}

function pageElements(pages) {
	const [first = "", last = ""] = String(pages || "").replace(/[–—]/g, "-").split("-", 2).map((part) => part.trim());
	if (!first) return "";
	return `      <fpage>${xml(first)}</fpage>${last ? `\n      <lpage>${xml(last)}</lpage>` : ""}`;
}

export default class JatsMetadataTemplate {
	data() {
		return {
			pagination: {
				data: "dataciteArchives",
				size: 1,
				alias: "record",
				before: (records) => records.filter((record) => record.section === "archives"),
			},
			permalink: ({ record }) => record.jatsPath,
			layout: false,
			eleventyExcludeFromCollections: true,
		};
	}

	render({ record }) {
		const contributors = record.creators.map((creator) => [
			'        <contrib contrib-type="author">',
			`          <string-name>${xml(creator)}</string-name>`,
			record.affiliation ? '          <xref ref-type="aff" rid="aff1"/>' : "",
			"        </contrib>",
		].filter(Boolean).join("\n")).join("\n");
		const keywords = [...record.keywords, ...record.subjects.map((subject) => subject.label)];
		const doiId = record.doi
			? `\n      <article-id pub-id-type="doi" assigning-authority="datacite">${xml(record.doi)}</article-id>`
			: "";
		const abstract = record.description
			? `\n      <abstract abstract-type="summary"><p>${xml(record.description)}</p></abstract>`
			: "";
		const keywordGroup = keywords.length
			? `\n      <kwd-group kwd-group-type="author-generated">\n${keywords.map((keyword) => `        <kwd>${xml(keyword)}</kwd>`).join("\n")}\n      </kwd-group>`
			: "";
		const pdfLink = record.pdfUrl
			? `\n      <self-uri content-type="pdf" xlink:href="${xml(record.pdfUrl)}"/>`
			: "";

		return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD v1.4 20241031//EN" "https://jats.nlm.nih.gov/publishing/1.4/JATS-journalpublishing1-4.dtd">
<!-- JATS 1.4 metadata record only. Not a PMC deposit: full text and submission assets are not included. -->
<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="other" dtd-version="1.4" xml:lang="en" specific-use="metadata-only-not-pmc-deposit">
  <front>
    <journal-meta>
      <journal-id journal-id-type="publisher-id">jcrt</journal-id>
      <journal-title-group><journal-title>The Journal for Cultural and Religious Theory</journal-title></journal-title-group>
      <issn publication-format="electronic">1530-5228</issn>
      <publisher><publisher-name>Whitestone Publications</publisher-name></publisher>
    </journal-meta>
    <article-meta>
      <article-id pub-id-type="publisher-id">${xml(`${record.issueSlug}.${record.slug}`)}</article-id>${doiId}
      <article-categories><subj-group subj-group-type="heading"><subject>Article metadata</subject></subj-group></article-categories>
      <title-group><article-title>${xml(record.title)}</article-title></title-group>
      <contrib-group>
${contributors}
      </contrib-group>${record.affiliation ? `\n      <aff id="aff1">${xml(record.affiliation)}</aff>` : ""}
${publicationDate(record)}
      <volume>${xml(record.volume)}</volume>
      <issue>${xml(record.issue)}</issue>
${pageElements(record.pages)}
      <permissions><copyright-statement>Copyright held by the author(s). All rights reserved.</copyright-statement></permissions>
      <self-uri content-type="html" xlink:href="${xml(record.pageUrl)}"/>${pdfLink}${abstract}${keywordGroup}
      <custom-meta-group>
        <custom-meta><meta-name>PMC deposit status</meta-name><meta-value>Not deposit ready: metadata only; complete article text and submission assets are required.</meta-value></custom-meta>
      </custom-meta-group>
    </article-meta>
  </front>
</article>
`;
	}
}
