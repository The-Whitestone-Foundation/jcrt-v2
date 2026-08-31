import assert from "node:assert/strict";
import test from "node:test";
import handleOaiRequest from "./oai-pmh.js";

test("keeps the three OAI URLs distinct and canonical", async () => {
	const context = { next: () => assert.fail("unexpected context.next()") };

	const slash = await handleOaiRequest(
		new Request("https://jcrt.org/oai/?verb=Identify", { method: "POST" }),
		context,
	);
	assert.equal(slash.status, 308);
	assert.equal(slash.headers.get("location"), "https://jcrt.org/oai?verb=Identify");

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({
		records: [{
			identifier: "oai:jcrt.org:test",
			datestamp: "2026-08-31",
			title: "Test record",
		}],
	}));
	try {
		const primo = await handleOaiRequest(
			new Request("https://jcrt.org/sitemap/oai_dc.xml"),
			context,
		);
		const xml = await primo.text();
		assert.equal(primo.status, 200);
		assert.equal(primo.headers.get("content-type"), "application/xml; charset=UTF-8");
		assert.match(xml, /<ListRecords>/);
		assert.doesNotMatch(xml, /<OAI-PMH/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
