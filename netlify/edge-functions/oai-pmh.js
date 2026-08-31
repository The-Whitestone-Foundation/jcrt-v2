import {
	handleOaiRequest,
	renderPrimoListRecordsResponse,
	renderStaticListRecordsResponse,
} from "../../scripts/lib/oai-pmh.mjs";

const CANONICAL_OAI_PATH = "/oai";
const OAI_FEED_PATH = "/sitemaps/oai_dc.xml";
const PRIMO_OAI_PATH = "/sitemap/oai_dc.xml";
const OAI_PATHS = new Set([
	CANONICAL_OAI_PATH,
	OAI_FEED_PATH,
	PRIMO_OAI_PATH,
]);
const OAI_RECORDS_PATH = "/sitemaps/oai-records.json";

function redirectPath(url, pathname) {
	url.pathname = pathname;
	return Response.redirect(url, 308);
}

async function loadOaiIndex(origin) {
	const indexUrl = new URL(OAI_RECORDS_PATH, origin).toString();
	const response = await fetch(indexUrl, {
		headers: {
			accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to load OAI records index (${response.status})`);
	}
	return response.json();
}

export default async (request, context) => {
	const url = new URL(request.url);
	if (url.pathname === `${CANONICAL_OAI_PATH}/`) return redirectPath(url, CANONICAL_OAI_PATH);
	if (!OAI_PATHS.has(url.pathname)) return context.next();

	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "POST" && method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: {
				allow: "GET, HEAD, POST",
			},
		});
	}

	// Protocol responses always advertise the one canonical OAI-PMH base URL.
	const baseURL = `${url.origin}${CANONICAL_OAI_PATH}`;
	try {
		const index = await loadOaiIndex(url.origin);
		if (url.pathname === PRIMO_OAI_PATH) {
			const xml = renderPrimoListRecordsResponse({ records: index?.records || [] });
			return new Response(method === "HEAD" ? null : xml, {
				status: 200,
				headers: {
					"content-type": "application/xml; charset=UTF-8",
					"cache-control": "public,max-age=0,must-revalidate",
				},
			});
		}
		const params = new URLSearchParams(url.searchParams);
		if (method === "POST") {
			for (const [key, value] of new URLSearchParams(await request.text())) params.append(key, value);
		}
		if (url.pathname !== CANONICAL_OAI_PATH && !params.has("verb")) {
			const xml = renderStaticListRecordsResponse({
				baseURL,
				records: index?.records || [],
			});
			const headers = new Headers({
				"content-type": "text/xml; charset=UTF-8",
				"cache-control": "public,max-age=0,must-revalidate",
			});
			if (method === "HEAD") {
				return new Response(null, {
					status: 200,
					headers,
				});
			}
			return new Response(xml, {
				status: 200,
				headers,
			});
		}

		const result = handleOaiRequest({
			baseURL,
			params,
			records: index?.records || [],
			identify: {
				repositoryName: index?.repositoryName,
				adminName: index?.adminName,
				adminEmails: index?.adminEmails,
				earliestDatestamp: index?.earliestDatestamp,
				deletedRecord: index?.deletedRecord,
				granularity: index?.granularity,
				protocolVersion: index?.protocolVersion,
				compressions: index?.compressions,
			},
		});

		const headers = new Headers(result?.headers || {});
		headers.set("content-type", "text/xml; charset=UTF-8");
		headers.set("cache-control", "public,max-age=0,must-revalidate");

		if (method === "HEAD") {
			return new Response(null, {
				status: result?.status || 200,
				headers,
			});
		}

		return new Response(result?.xml || "", {
			status: result?.status || 200,
			headers,
		});
	} catch (error) {
		const body = `<?xml version="1.0" encoding="UTF-8"?>\n<error>OAI-PMH runtime error: ${String(error?.message || error)}</error>\n`;
		return new Response(body, {
			status: 500,
			headers: {
				"content-type": "text/xml; charset=UTF-8",
				"cache-control": "no-store",
			},
		});
	}
};
