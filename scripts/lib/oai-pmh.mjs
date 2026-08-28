export const OAI_NS = "http://www.openarchives.org/OAI/2.0/";
export const OAI_DC_NS = "http://www.openarchives.org/OAI/2.0/oai_dc/";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const OAI_SCHEMA_URL = "http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd";
export const OAI_DC_SCHEMA_URL = "http://www.openarchives.org/OAI/2.0/oai_dc.xsd";
export const OAI_METADATA_PREFIX = "oai_dc";

const SUPPORTED_VERBS = new Set([
	"Identify",
	"ListMetadataFormats",
	"ListSets",
	"GetRecord",
	"ListIdentifiers",
	"ListRecords",
]);
const LIST_BATCH_SIZE = 100;

function asArray(value) {
	if (Array.isArray(value)) return value;
	if (value === null || value === undefined) return [];
	return [value];
}

function isNonEmpty(value) {
	return String(value ?? "").trim().length > 0;
}

function cleanValue(value) {
	return String(value ?? "").trim();
}

function normalizeDateOnly(value) {
	const raw = cleanValue(value);
	if (!raw) return "";
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

function parseRequestDateArg(value, granularity = "YYYY-MM-DD") {
	const raw = cleanValue(value);
	if (!raw) return null;
	if (granularity === "YYYY-MM-DD") {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
		const date = new Date(`${raw}T00:00:00Z`);
		if (Number.isNaN(date.getTime())) return null;
		return date.toISOString().slice(0, 10) === raw ? raw : null;
	}
	return null;
}

function hasOnlyAllowedArgs(params, allowedKeys) {
	for (const key of Object.keys(params)) {
		if (!allowedKeys.has(key)) return false;
	}
	return true;
}

function hasAnyArgs(params, keys) {
	for (const key of keys) {
		if (isNonEmpty(params[key])) return true;
	}
	return false;
}

function escapeXml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function normalizeParams(input) {
	if (input instanceof URLSearchParams) {
		const out = {};
		for (const [key, value] of input.entries()) {
			out[key] = key in out ? [out[key], value] : value;
		}
		return out;
	}
	if (!input || typeof input !== "object") return {};
	const out = {};
	for (const [key, value] of Object.entries(input)) {
		out[key] = Array.isArray(value) ? value.map((entry) => String(entry ?? "")) : String(value ?? "");
	}
	return out;
}

function sortRecords(records) {
	return [...records].sort((a, b) => {
		const ad = normalizeDateOnly(a?.datestamp);
		const bd = normalizeDateOnly(b?.datestamp);
		if (ad !== bd) return ad.localeCompare(bd);
		return cleanValue(a?.identifier).localeCompare(cleanValue(b?.identifier));
	});
}

function buildRequestAttrs(params, allowedKeys = null) {
	const attrs = {};
	for (const [key, value] of Object.entries(params || {})) {
		if (allowedKeys && !allowedKeys.has(key)) continue;
		const cleaned = cleanValue(value);
		if (!cleaned) continue;
		attrs[key] = cleaned;
	}
	return attrs;
}

function renderRequestElement(baseURL, attrs = {}) {
	const attrString = Object.entries(attrs)
		.filter(([, value]) => isNonEmpty(value))
		.map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
		.join("");
	return `<request${attrString}>${escapeXml(baseURL)}</request>`;
}

function renderEnvelope(baseURL, requestAttrs, bodyXml, responseDate = new Date().toISOString()) {
	const lines = [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<OAI-PMH xmlns="${OAI_NS}"`,
		`         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
		`         xsi:schemaLocation="${OAI_NS} ${OAI_SCHEMA_URL}">`,
		`  <responseDate>${escapeXml(responseDate)}</responseDate>`,
		`  ${renderRequestElement(baseURL, requestAttrs)}`,
		...String(bodyXml || "").split("\n").map((line) => (line ? `  ${line}` : "")),
		`</OAI-PMH>`,
	];
	return `${lines.join("\n")}\n`;
}

function renderError(code, message) {
	return `<error code="${escapeXml(code)}">${escapeXml(message)}</error>`;
}

function renderMetadataFormatBlock() {
	return [
		`<ListMetadataFormats>`,
		`  <metadataFormat>`,
		`    <metadataPrefix>${OAI_METADATA_PREFIX}</metadataPrefix>`,
		`    <schema>${OAI_DC_SCHEMA_URL}</schema>`,
		`    <metadataNamespace>${OAI_DC_NS}</metadataNamespace>`,
		`  </metadataFormat>`,
		`</ListMetadataFormats>`,
	].join("\n");
}

export function buildOaiDcMetadata(record) {
	const lines = [
		`<oai_dc:dc xmlns:oai_dc="${OAI_DC_NS}"`,
		`           xmlns:dc="${DC_NS}"`,
		`           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
		`           xsi:schemaLocation="${OAI_DC_NS} ${OAI_DC_SCHEMA_URL}">`,
	];

	if (isNonEmpty(record.title)) lines.push(`  <dc:title>${escapeXml(record.title)}</dc:title>`);
	for (const creator of asArray(record.creators)) {
		if (isNonEmpty(creator)) lines.push(`  <dc:creator>${escapeXml(creator)}</dc:creator>`);
	}
	for (const subject of asArray(record.subjects)) {
		if (isNonEmpty(subject)) lines.push(`  <dc:subject>${escapeXml(subject)}</dc:subject>`);
	}
	if (isNonEmpty(record.description)) lines.push(`  <dc:description>${escapeXml(record.description)}</dc:description>`);
	if (isNonEmpty(record.publisher)) lines.push(`  <dc:publisher>${escapeXml(record.publisher)}</dc:publisher>`);
	for (const contributor of asArray(record.contributors)) {
		if (isNonEmpty(contributor)) lines.push(`  <dc:contributor>${escapeXml(contributor)}</dc:contributor>`);
	}
	if (isNonEmpty(record.date)) lines.push(`  <dc:date>${escapeXml(record.date)}</dc:date>`);
	if (isNonEmpty(record.type)) lines.push(`  <dc:type>${escapeXml(record.type)}</dc:type>`);
	if (isNonEmpty(record.format)) lines.push(`  <dc:format>${escapeXml(record.format)}</dc:format>`);
	for (const identifier of asArray(record.identifiers)) {
		if (isNonEmpty(identifier)) lines.push(`  <dc:identifier>${escapeXml(identifier)}</dc:identifier>`);
	}
	for (const source of asArray(record.sources)) {
		if (isNonEmpty(source)) lines.push(`  <dc:source>${escapeXml(source)}</dc:source>`);
	}
	if (isNonEmpty(record.language)) lines.push(`  <dc:language>${escapeXml(record.language)}</dc:language>`);
	for (const relation of asArray(record.relations)) {
		if (isNonEmpty(relation)) lines.push(`  <dc:relation>${escapeXml(relation)}</dc:relation>`);
	}
	for (const coverage of asArray(record.coverages)) {
		if (isNonEmpty(coverage)) lines.push(`  <dc:coverage>${escapeXml(coverage)}</dc:coverage>`);
	}
	if (isNonEmpty(record.rights)) lines.push(`  <dc:rights>${escapeXml(record.rights)}</dc:rights>`);

	lines.push(`</oai_dc:dc>`);
	return lines.join("\n");
}

function renderHeader(record) {
	const status = cleanValue(record.status);
	const statusAttr = status === "deleted" ? ` status="deleted"` : "";
	const lines = [
		`<header${statusAttr}>`,
		`  <identifier>${escapeXml(record.identifier)}</identifier>`,
		`  <datestamp>${escapeXml(record.datestamp)}</datestamp>`,
	];
	for (const setSpec of asArray(record.setSpecs)) {
		if (isNonEmpty(setSpec)) lines.push(`  <setSpec>${escapeXml(setSpec)}</setSpec>`);
	}
	lines.push(`</header>`);
	return lines.join("\n");
}

function renderRecord(record, includeMetadata = true) {
	const lines = [`<record>`, ...renderHeader(record).split("\n").map((line) => `  ${line}`)];
	if (includeMetadata && cleanValue(record.status) !== "deleted") {
		lines.push(`  <metadata>`);
		lines.push(...buildOaiDcMetadata(record).split("\n").map((line) => `    ${line}`));
		lines.push(`  </metadata>`);
	}
	lines.push(`</record>`);
	return lines.join("\n");
}

function renderResumptionTokenElement(token, cursor, completeListSize) {
	if (!isNonEmpty(token)) return "";
	return `<resumptionToken completeListSize="${escapeXml(completeListSize)}" cursor="${escapeXml(cursor)}">${escapeXml(token)}</resumptionToken>`;
}

function renderListRecords(records, resumptionTokenXml = "") {
	const lines = [`<ListRecords>`];
	for (const record of records) {
		lines.push(...renderRecord(record, true).split("\n").map((line) => `  ${line}`));
	}
	if (isNonEmpty(resumptionTokenXml)) lines.push(`  ${resumptionTokenXml}`);
	lines.push(`</ListRecords>`);
	return lines.join("\n");
}

function renderListIdentifiers(records, resumptionTokenXml = "") {
	const lines = [`<ListIdentifiers>`];
	for (const record of records) {
		lines.push(...renderHeader(record).split("\n").map((line) => `  ${line}`));
	}
	if (isNonEmpty(resumptionTokenXml)) lines.push(`  ${resumptionTokenXml}`);
	lines.push(`</ListIdentifiers>`);
	return lines.join("\n");
}

function renderGetRecord(record) {
	const lines = [`<GetRecord>`];
	lines.push(...renderRecord(record, true).split("\n").map((line) => `  ${line}`));
	lines.push(`</GetRecord>`);
	return lines.join("\n");
}

function renderIdentify(baseURL, identify) {
	const adminEmails = asArray(identify.adminEmails).filter((entry) => isNonEmpty(entry));
	const lines = [
		`<Identify>`,
		`  <repositoryName>${escapeXml(identify.repositoryName)}</repositoryName>`,
		`  <baseURL>${escapeXml(baseURL)}</baseURL>`,
		`  <protocolVersion>${escapeXml(identify.protocolVersion || "2.0")}</protocolVersion>`,
	];
	for (const adminEmail of adminEmails) {
		lines.push(`  <adminEmail>${escapeXml(adminEmail)}</adminEmail>`);
	}
	lines.push(`  <earliestDatestamp>${escapeXml(identify.earliestDatestamp)}</earliestDatestamp>`);
	lines.push(`  <deletedRecord>${escapeXml(identify.deletedRecord || "no")}</deletedRecord>`);
	lines.push(`  <granularity>${escapeXml(identify.granularity || "YYYY-MM-DD")}</granularity>`);
	for (const compression of asArray(identify.compressions)) {
		if (isNonEmpty(compression)) lines.push(`  <compression>${escapeXml(compression)}</compression>`);
	}
	lines.push(`</Identify>`);
	return lines.join("\n");
}

function buildIdentifyDefaults(records, identify = {}) {
	const sorted = sortRecords(records);
	const earliest = identify.earliestDatestamp || normalizeDateOnly(sorted[0]?.datestamp) || "1999-01-01";
	return {
		repositoryName: identify.repositoryName || "Victor Taylor",
		adminEmails: asArray(identify.adminEmails).filter((value) => isNonEmpty(value)).length
			? asArray(identify.adminEmails)
			: ["carl.raschke@jcrt.org"],
		earliestDatestamp: earliest,
		deletedRecord: identify.deletedRecord || "no",
		granularity: identify.granularity || "YYYY-MM-DD",
		protocolVersion: identify.protocolVersion || "2.0",
		compressions: asArray(identify.compressions).filter((value) => isNonEmpty(value)).length
			? asArray(identify.compressions)
			: ["gzip"],
	};
}

function findRecord(records, identifier) {
	const target = cleanValue(identifier);
	if (!target) return null;
	return records.find((record) => cleanValue(record.identifier) === target) || null;
}

function filterByDateRange(records, from, until) {
	if (!from && !until) return records;
	return records.filter((record) => {
		const datestamp = normalizeDateOnly(record.datestamp);
		if (!datestamp) return false;
		if (from && datestamp < from) return false;
		if (until && datestamp > until) return false;
		return true;
	});
}

function paginate(records, offset = 0, batchSize = LIST_BATCH_SIZE) {
	const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
	const pageSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : LIST_BATCH_SIZE;
	const page = records.slice(safeOffset, safeOffset + pageSize);
	const nextOffset = safeOffset + page.length;
	const hasMore = nextOffset < records.length;
	return {
		page,
		cursor: safeOffset,
		completeListSize: records.length,
		nextOffset: hasMore ? nextOffset : null,
	};
}

function encodeResumptionToken({ verb, metadataPrefix, from = "", until = "", offset = 0 }) {
	return [
		`v=${encodeURIComponent(cleanValue(verb))}`,
		`m=${encodeURIComponent(cleanValue(metadataPrefix))}`,
		`f=${encodeURIComponent(cleanValue(from))}`,
		`u=${encodeURIComponent(cleanValue(until))}`,
		`o=${encodeURIComponent(String(offset))}`,
	].join("|");
}

function decodeResumptionToken(token) {
	const raw = cleanValue(token);
	if (!raw) return null;
	const parts = raw.split("|");
	const out = {};
	for (const part of parts) {
		if (!part.includes("=")) continue;
		const [key, value = ""] = part.split("=", 2);
		if (!key) continue;
		try {
			out[key] = decodeURIComponent(value);
		} catch {
			return null;
		}
	}
	const verb = cleanValue(out.v);
	const metadataPrefix = cleanValue(out.m);
	const from = cleanValue(out.f);
	const until = cleanValue(out.u);
	const offset = Number.parseInt(cleanValue(out.o), 10);
	if (!verb || !metadataPrefix || !Number.isInteger(offset) || offset < 0) return null;
	return { verb, metadataPrefix, from, until, offset };
}

export function renderStaticListRecordsResponse({
	baseURL,
	records,
	responseDate = new Date().toISOString(),
}) {
	const requestAttrs = {
		verb: "ListRecords",
		metadataPrefix: OAI_METADATA_PREFIX,
	};
	const body = renderListRecords(sortRecords(records));
	return renderEnvelope(baseURL, requestAttrs, body, responseDate);
}

export function handleOaiRequest({
	baseURL,
	params,
	records,
	identify,
	responseDate = new Date().toISOString(),
}) {
	const normalizedParams = normalizeParams(params);
	const hasRepeatedArgs = Object.values(normalizedParams).some(Array.isArray);
	const verb = cleanValue(normalizedParams.verb);
	const sortedRecords = sortRecords(asArray(records).filter((record) => record && typeof record === "object"));
	const identifyConfig = buildIdentifyDefaults(sortedRecords, identify);
	const recordIds = new Set(sortedRecords.map((record) => cleanValue(record.identifier)));

	const errorResponse = (code, message, requestAttrs = buildRequestAttrs(normalizedParams)) => {
		const safeRequestAttrs = code === "badArgument" || code === "badVerb" ? {} : requestAttrs;
		return {
			status: 200,
			headers: { "content-type": "text/xml; charset=UTF-8" },
			xml: renderEnvelope(baseURL, safeRequestAttrs, renderError(code, message), responseDate),
		};
	};

	if (hasRepeatedArgs) {
		return errorResponse("badArgument", "The request includes a repeated argument.");
	}

	if (!verb || !SUPPORTED_VERBS.has(verb)) {
		return errorResponse("badVerb", "The request includes an illegal verb or is missing the verb argument.", {});
	}

	switch (verb) {
		case "Identify": {
			const allowed = new Set(["verb"]);
			if (!hasOnlyAllowedArgs(normalizedParams, allowed)) {
				return errorResponse("badArgument", "The request includes illegal arguments.");
			}
			const body = renderIdentify(baseURL, identifyConfig);
			return {
				status: 200,
				headers: { "content-type": "text/xml; charset=UTF-8" },
				xml: renderEnvelope(baseURL, { verb }, body, responseDate),
			};
		}

		case "ListMetadataFormats": {
			const allowed = new Set(["verb", "identifier"]);
			if (!hasOnlyAllowedArgs(normalizedParams, allowed)) {
				return errorResponse("badArgument", "The request includes illegal arguments.");
			}
			const identifier = cleanValue(normalizedParams.identifier);
			if (identifier && !recordIds.has(identifier)) {
				return errorResponse("idDoesNotExist", "The value of the identifier argument is unknown or illegal in this repository.");
			}
			return {
				status: 200,
				headers: { "content-type": "text/xml; charset=UTF-8" },
				xml: renderEnvelope(baseURL, buildRequestAttrs(normalizedParams, allowed), renderMetadataFormatBlock(), responseDate),
			};
		}

		case "ListSets": {
			const allowed = new Set(["verb", "resumptionToken"]);
			if (!hasOnlyAllowedArgs(normalizedParams, allowed)) {
				return errorResponse("badArgument", "The request includes illegal arguments.");
			}
			if (isNonEmpty(normalizedParams.resumptionToken)) {
				return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
			}
			return errorResponse("noSetHierarchy", "This repository does not support sets.", { verb });
		}

		case "GetRecord": {
			const allowed = new Set(["verb", "identifier", "metadataPrefix"]);
			if (!hasOnlyAllowedArgs(normalizedParams, allowed)) {
				return errorResponse("badArgument", "The request includes illegal arguments.");
			}
			const identifier = cleanValue(normalizedParams.identifier);
			const metadataPrefix = cleanValue(normalizedParams.metadataPrefix);
			if (!identifier || !metadataPrefix) {
				return errorResponse("badArgument", "The request is missing required arguments.");
			}
			if (metadataPrefix !== OAI_METADATA_PREFIX) {
				return errorResponse("cannotDisseminateFormat", "The requested metadataPrefix is not supported by this repository.");
			}
			const record = findRecord(sortedRecords, identifier);
			if (!record) {
				return errorResponse("idDoesNotExist", "The value of the identifier argument is unknown or illegal in this repository.");
			}
			const body = renderGetRecord(record);
			return {
				status: 200,
				headers: { "content-type": "text/xml; charset=UTF-8" },
				xml: renderEnvelope(baseURL, buildRequestAttrs(normalizedParams, allowed), body, responseDate),
			};
		}

		case "ListIdentifiers":
		case "ListRecords": {
			const allowed = new Set(["verb", "from", "until", "set", "metadataPrefix", "resumptionToken"]);
			if (!hasOnlyAllowedArgs(normalizedParams, allowed)) {
				return errorResponse("badArgument", "The request includes illegal arguments.");
			}

			const granularity = identifyConfig.granularity || "YYYY-MM-DD";
			const tokenRaw = cleanValue(normalizedParams.resumptionToken);
			let from = null;
			let until = null;
			let requestAttrs = {};
			let offset = 0;
			let metadataPrefix = cleanValue(normalizedParams.metadataPrefix);

			if (isNonEmpty(normalizedParams.resumptionToken)) {
				if (hasAnyArgs(normalizedParams, ["from", "until", "set", "metadataPrefix"])) {
					return errorResponse("badArgument", "The request includes illegal arguments.");
				}
				const token = decodeResumptionToken(tokenRaw);
				if (!token || token.verb !== verb || token.metadataPrefix !== OAI_METADATA_PREFIX) {
					return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
				}
				offset = token.offset;
				metadataPrefix = token.metadataPrefix;
				if (token.from) {
					from = parseRequestDateArg(token.from, granularity);
					if (!from) return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
				}
				if (token.until) {
					until = parseRequestDateArg(token.until, granularity);
					if (!until) return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
				}
				if (from && until && from > until) {
					return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
				}
				requestAttrs = { verb, resumptionToken: tokenRaw };
			} else {
				if (!metadataPrefix) {
					return errorResponse("badArgument", "The request is missing required arguments.");
				}
				if (isNonEmpty(normalizedParams.set)) {
					return errorResponse("noSetHierarchy", "This repository does not support sets.");
				}
				from = isNonEmpty(normalizedParams.from)
					? parseRequestDateArg(normalizedParams.from, granularity)
					: null;
				until = isNonEmpty(normalizedParams.until)
					? parseRequestDateArg(normalizedParams.until, granularity)
					: null;
				if (isNonEmpty(normalizedParams.from) && !from) {
					return errorResponse("badArgument", "The from argument has an illegal value.");
				}
				if (isNonEmpty(normalizedParams.until) && !until) {
					return errorResponse("badArgument", "The until argument has an illegal value.");
				}
				if (from && until && from > until) {
					return errorResponse("badArgument", "The from argument must be less than or equal to the until argument.");
				}
				requestAttrs = buildRequestAttrs(normalizedParams, allowed);
			}

			if (metadataPrefix !== OAI_METADATA_PREFIX) {
				return errorResponse("cannotDisseminateFormat", "The requested metadataPrefix is not supported by this repository.");
			}

			const filtered = filterByDateRange(sortedRecords, from, until);
			if (filtered.length === 0) {
				return errorResponse("noRecordsMatch", "The combination of the supplied values results in an empty list.");
			}
			if (offset >= filtered.length) {
				return errorResponse("badResumptionToken", "The value of the resumptionToken argument is invalid or expired.");
			}

			const page = paginate(filtered, offset, LIST_BATCH_SIZE);
			const nextToken = page.nextOffset === null
				? ""
				: encodeResumptionToken({
					verb,
					metadataPrefix,
					from: from || "",
					until: until || "",
					offset: page.nextOffset,
				});
			const resumptionTokenXml = renderResumptionTokenElement(nextToken, page.cursor, page.completeListSize);

			const body = verb === "ListIdentifiers"
				? renderListIdentifiers(page.page, resumptionTokenXml)
				: renderListRecords(page.page, resumptionTokenXml);
			return {
				status: 200,
				headers: { "content-type": "text/xml; charset=UTF-8" },
				xml: renderEnvelope(baseURL, requestAttrs, body, responseDate),
			};
		}

		default:
			return errorResponse("badVerb", "The request includes an illegal verb.", {});
	}
}

export function buildOaiRecord(entry, {
	issn,
	publisher,
	rights,
	sourceTitle,
} = {}) {
	const dateOnly = normalizeDateOnly(entry?.datestamp || entry?.date || "");
	const canonicalUrl = cleanValue(entry?.canonicalUrl || entry?.url || "");
	const sources = [];
	if (sourceTitle) sources.push(String(sourceTitle));
	if (isNonEmpty(entry?.citation)) sources.push(String(entry.citation));

	const identifiers = [];
	if (issn) identifiers.push(String(issn));
	if (canonicalUrl) identifiers.push(canonicalUrl);

	const relations = [];
	if (isNonEmpty(entry?.pdfUrl)) relations.push(String(entry.pdfUrl));

	return {
		identifier: cleanValue(entry?.identifier),
		datestamp: dateOnly || "1999-01-01",
		title: cleanValue(entry?.title),
		creators: asArray(entry?.creators || entry?.authors).filter((value) => isNonEmpty(value)),
		subjects: asArray(entry?.subjects || entry?.keywords).filter((value) => isNonEmpty(value)),
		description: cleanValue(entry?.description),
		publisher: cleanValue(entry?.publisher || publisher),
		date: dateOnly || "1999-01-01",
		type: cleanValue(entry?.type || "article"),
		format: cleanValue(entry?.format || "text/html"),
		language: cleanValue(entry?.language || "en"),
		identifiers,
		sources,
		relations,
		rights: cleanValue(entry?.rights || rights),
	};
}

export { escapeXml };
