import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { handleOaiRequest, OAI_METADATA_PREFIX } from "./lib/oai-pmh.mjs";

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, "_site");
const OAI_XML_PATH = path.join(SITE_DIR, "sitemaps", "oai_dc.xml");
const OAI_INDEX_PATH = path.join(SITE_DIR, "sitemaps", "oai-records.json");
const SCHEMA_DIR = path.join(ROOT, "scripts", "schemas", "oai");
const OAI_PMH_SCHEMA = path.join(SCHEMA_DIR, "OAI-PMH.xsd");
const OAI_DC_SCHEMA = path.join(SCHEMA_DIR, "oai_dc.xsd");
const VALIDATE_LEVEL = String(process.env.OAI_VALIDATE_LEVEL || "full").trim().toLowerCase();
const IS_QUICK_VALIDATE = VALIDATE_LEVEL === "quick";
const REQUIRE_XSD = String(process.env.OAI_REQUIRE_XSD || "0").trim() === "1";

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function mustExist(filePath) {
	assert(fs.existsSync(filePath), `Missing required file: ${filePath}`);
}

function runXmllint(args, label) {
	const result = spawnSync("xmllint", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		throw new Error(`[oai:validate] xmllint failed for ${label}\n${detail}`);
	}
}

function hasXmllint() {
	const result = spawnSync("xmllint", ["--version"], {
		encoding: "utf8",
	});
	return result.status === 0;
}

function schemasAvailable() {
	return fs.existsSync(OAI_PMH_SCHEMA) && fs.existsSync(OAI_DC_SCHEMA);
}

function patchOaiDcSchemaLocation(xml) {
	return String(xml).replaceAll(
		"http://www.openarchives.org/OAI/2.0/oai_dc.xsd",
		OAI_DC_SCHEMA,
	);
}

function stripMetadataBlocks(xml) {
	return String(xml).replace(/<metadata>[\s\S]*?<\/metadata>/g, "");
}

function extractOaiDcBlocks(xml) {
	return String(xml).match(/<oai_dc:dc\b[\s\S]*?<\/oai_dc:dc>/g) || [];
}

function writeTempXml(dir, name, xml) {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, patchOaiDcSchemaLocation(xml), "utf8");
	return filePath;
}

function validateAgainstOaiSchema(tempDir, label, xml) {
	const filePath = writeTempXml(tempDir, `${label}.xml`, stripMetadataBlocks(xml));
	runXmllint(["--noout", filePath], `${label} (well-formed)`);
	runXmllint(["--noout", "--schema", OAI_PMH_SCHEMA, filePath], `${label} (schema)`);
}

function validateOaiDcBlocks(tempDir, label, xml) {
	const blocks = extractOaiDcBlocks(xml);
	assert(blocks.length > 0, `No oai_dc:dc blocks found for ${label}`);
	for (let i = 0; i < blocks.length; i += 1) {
		const filePath = writeTempXml(tempDir, `${label}-oai-dc-${i + 1}.xml`, blocks[i]);
		runXmllint(["--noout", filePath], `${label} oai_dc block #${i + 1} (well-formed)`);
		runXmllint(["--noout", "--schema", OAI_DC_SCHEMA, filePath], `${label} oai_dc block #${i + 1} (schema)`);
	}
}

function runProtocolChecks({ baseURL, records, identify }) {
	const firstId = String(records?.[0]?.identifier || "").trim();
	assert(firstId, "No OAI records found in oai-records.json.");

	const cases = [
		{
			name: "Identify",
			params: { verb: "Identify" },
			contains: ["<Identify>", `<baseURL>${baseURL}</baseURL>`, "<deletedRecord>"],
		},
		{
			name: "ListMetadataFormats",
			params: { verb: "ListMetadataFormats" },
			contains: ["<ListMetadataFormats>", `<metadataPrefix>${OAI_METADATA_PREFIX}</metadataPrefix>`],
		},
		{
			name: "ListSets noSetHierarchy",
			params: { verb: "ListSets" },
			contains: ['<error code="noSetHierarchy">'],
		},
		{
			name: "ListIdentifiers",
			params: { verb: "ListIdentifiers", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<ListIdentifiers>", "<header>"],
		},
		{
			name: "ListRecords",
			params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<ListRecords>", "<oai_dc:dc"],
		},
		{
			name: "GetRecord",
			params: { verb: "GetRecord", identifier: firstId, metadataPrefix: OAI_METADATA_PREFIX },
			contains: ["<GetRecord>", firstId],
		},
		{
			name: "Unknown Verb",
			params: { verb: "Nope" },
			contains: ['<error code="badVerb">'],
		},
		{
			name: "Repeated Argument",
			params: new URLSearchParams("verb=Identify&verb=Identify"),
			contains: [`<request>${baseURL}</request>`, '<error code="badArgument">'],
			notContains: ['<request verb='],
		},
		{
			name: "Unsupported Metadata Prefix",
			params: { verb: "ListRecords", metadataPrefix: "mods" },
			contains: ['<error code="cannotDisseminateFormat">'],
		},
		{
			name: "Unknown Identifier",
			params: { verb: "GetRecord", identifier: "oai:jcrt.org:missing", metadataPrefix: OAI_METADATA_PREFIX },
			contains: ['<error code="idDoesNotExist">'],
		},
		{
			name: "No Records Match",
			params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, from: "2100-01-01" },
			contains: ['<error code="noRecordsMatch">'],
		},
	];

	const outputs = [];
	for (const testCase of cases) {
		const result = handleOaiRequest({
			baseURL,
			params: testCase.params,
			records,
			identify,
		});
		for (const expected of testCase.contains) {
			assert(
				String(result.xml || "").includes(expected),
				`Protocol check failed: ${testCase.name} missing '${expected}'`,
			);
		}
		for (const unexpected of testCase.notContains || []) {
			assert(
				!String(result.xml || "").includes(unexpected),
				`Protocol check failed: ${testCase.name} unexpectedly contains '${unexpected}'`,
			);
		}
		outputs.push({ name: testCase.name, xml: result.xml });
	}
	return outputs;
}

function extractDatestamps(xml) {
	return [...String(xml || "").matchAll(/<datestamp>([^<]+)<\/datestamp>/g)].map((match) => String(match[1] || "").trim());
}

function assertIncrementalDayGranularity({ baseURL, records, identify }) {
	const from = "2026-03-03";
	const result = handleOaiRequest({
		baseURL,
		params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX, from },
		records,
		identify,
	});
	if (String(result?.xml || "").includes('code="noRecordsMatch"')) return;
	const datestamps = extractDatestamps(result?.xml || "");
	assert(datestamps.length > 0, "Incremental ListRecords check returned no datestamps.");
	const older = datestamps.find((value) => value < from);
	assert(!older, `Incremental day-granularity check failed: datestamp ${older} is older than from=${from}.`);
}

function assertResumptionFlow({ baseURL, records, identify }) {
	if (!Array.isArray(records) || records.length <= 120) return;
	const first = handleOaiRequest({
		baseURL,
		params: { verb: "ListRecords", metadataPrefix: OAI_METADATA_PREFIX },
		records,
		identify,
	});
	const tokenMatch = String(first?.xml || "").match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
	const token = String(tokenMatch?.[1] || "").trim();
	assert(token, "Expected resumptionToken in first ListRecords response but none was found.");
	const second = handleOaiRequest({
		baseURL,
		params: { verb: "ListRecords", resumptionToken: token },
		records,
		identify,
	});
	assert(!String(second?.xml || "").includes('code="badResumptionToken"'), "Resumption token follow-up returned badResumptionToken.");
	assert(String(second?.xml || "").includes("<ListRecords>"), "Resumption token follow-up did not return ListRecords.");
}

function runQuickChecks({ baseURL, records, identify }) {
	const staticXml = fs.readFileSync(OAI_XML_PATH, "utf8");
	assert(staticXml.includes("<OAI-PMH"), "Static OAI XML is missing OAI-PMH root.");
	assert(staticXml.includes("<ListRecords>"), "Static OAI XML is missing ListRecords.");
	assert(staticXml.includes("<oai_dc:dc"), "Static OAI XML is missing oai_dc metadata.");
	runProtocolChecks({ baseURL, records, identify });
	assertIncrementalDayGranularity({ baseURL, records, identify });
	assertResumptionFlow({ baseURL, records, identify });
}

function run() {
	mustExist(OAI_XML_PATH);
	mustExist(OAI_INDEX_PATH);

	const index = JSON.parse(fs.readFileSync(OAI_INDEX_PATH, "utf8"));
	const records = Array.isArray(index.records) ? index.records : [];
	assert(records.length > 0, "oai-records.json is empty.");

	const baseURL = String(index.baseURL || "https://jcrt.org/sitemaps/oai_dc.xml").trim();
	const identify = {
		repositoryName: index.repositoryName,
		adminEmails: index.adminEmails,
		earliestDatestamp: index.earliestDatestamp,
		deletedRecord: index.deletedRecord,
		granularity: index.granularity,
		protocolVersion: index.protocolVersion,
		compressions: index.compressions,
	};

	if (IS_QUICK_VALIDATE) {
		runQuickChecks({ baseURL, records, identify });
		console.log(`[oai:validate] Quick protocol checks passed (${records.length} record(s)).`);
		return;
	}

	const hasSchemas = schemasAvailable();
	const lintAvailable = hasXmllint();
	if (!hasSchemas || !lintAvailable) {
		if (REQUIRE_XSD) {
			if (!hasSchemas) {
				throw new Error("[oai:validate] XSD validation is required but schema files are missing.");
			}
			throw new Error("[oai:validate] XSD validation is required but xmllint is not available in PATH.");
		}
		const reason = [
			!hasSchemas ? "schema files missing" : "",
			!lintAvailable ? "xmllint missing" : "",
		].filter(Boolean).join(", ");
		console.warn(`[oai:validate] XSD checks skipped (${reason}); running quick protocol checks instead.`);
		runQuickChecks({ baseURL, records, identify });
		console.log(`[oai:validate] Quick protocol checks passed (${records.length} record(s)).`);
		return;
	}

	mustExist(OAI_PMH_SCHEMA);
	mustExist(OAI_DC_SCHEMA);

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jcrt-oai-validate-"));
	try {
		const staticXml = fs.readFileSync(OAI_XML_PATH, "utf8");
		validateAgainstOaiSchema(tempDir, "static-listrecords", staticXml);
		validateOaiDcBlocks(tempDir, "static-listrecords", staticXml);

		const protocolOutputs = runProtocolChecks({ baseURL, records, identify });
		for (const output of protocolOutputs) {
			const safeName = output.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
			validateAgainstOaiSchema(tempDir, `protocol-${safeName}`, output.xml);
			if (output.xml.includes("<oai_dc:dc")) {
				validateOaiDcBlocks(tempDir, `protocol-${safeName}`, output.xml);
			}
		}
		assertIncrementalDayGranularity({ baseURL, records, identify });
		assertResumptionFlow({ baseURL, records, identify });
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}

	console.log(`[oai:validate] Protocol and XSD checks passed (${records.length} record(s)).`);
}

try {
	run();
} catch (error) {
	console.error(String(error?.message || error));
	process.exitCode = 1;
}
