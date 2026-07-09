import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import queryCanonicalRedirects from "../netlify/edge-functions/query-canonical-redirects.js";
import archiveLegacyRedirects from "../netlify/edge-functions/archive-legacy-redirects.js";
import assetCanonicalRedirects from "../netlify/edge-functions/asset-canonical-redirects.js";

const require = createRequire(import.meta.url);
const redirector = require("netlify-redirector");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const redirectsPath = path.join(repoRoot, "public", "_redirects");
const netlifyTomlPath = path.join(repoRoot, "netlify.toml");
const searchConsole403FixturePath = path.join(repoRoot, "scripts", "fixtures", "search-console-403-urls.txt");
const searchConsole404FixturePath = path.join(repoRoot, "scripts", "fixtures", "search-console-404-urls.txt");
const searchConsoleQueryRedirectFixturePath = path.join(
	repoRoot,
	"scripts",
	"fixtures",
	"search-console-query-redirect-urls.txt",
);

function loadRedirectsText() {
	return fs.readFileSync(redirectsPath, "utf8");
}

function loadRuleLines(redirectsText) {
	return redirectsText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("#"));
}

function parseRule(line) {
	const [from, to, status = ""] = line.split(/\s+/);
	return { from, to, status };
}

function findRuleIndex(ruleLines, from, to) {
	return ruleLines.findIndex((line) => {
		const rule = parseRule(line);
		return rule.from === from && rule.to === to;
	});
}

function findRule(ruleLines, from, to) {
	const index = findRuleIndex(ruleLines, from, to);
	return index === -1 ? null : parseRule(ruleLines[index]);
}

function assertPresent(failures, ruleLines, from, to) {
	if (findRuleIndex(ruleLines, from, to) === -1) {
		failures.push(`missing _redirects rule: ${from} -> ${to}`);
	}
}

function assertPresentStatus(failures, ruleLines, from, to, status) {
	const rule = findRule(ruleLines, from, to);
	if (!rule) {
		failures.push(`missing _redirects rule: ${from} -> ${to}`);
		return;
	}
	if (String(rule.status) !== String(status)) {
		failures.push(`_redirects rule ${from} -> ${to}: expected status ${status}, got ${rule.status || "<empty>"}`);
	}
}

function assertAbsent(failures, ruleLines, from, to) {
	if (findRuleIndex(ruleLines, from, to) !== -1) {
		failures.push(`stale _redirects rule still present: ${from} -> ${to}`);
	}
}

function assertOrderedBefore(failures, ruleLines, left, right) {
	const leftIndex = findRuleIndex(ruleLines, left[0], left[1]);
	const rightIndex = findRuleIndex(ruleLines, right[0], right[1]);
	if (leftIndex === -1 || rightIndex === -1) return;
	if (leftIndex >= rightIndex) {
		failures.push(
			`rule order incorrect: ${left[0]} -> ${left[1]} must appear before ${right[0]} -> ${right[1]}`
		);
	}
}

function assertNoArchivePlaceholderSuffixes(failures, ruleLines) {
	for (const line of ruleLines) {
		const rule = parseRule(line);
		if (!rule.from.startsWith("/archives/")) continue;

		const segments = rule.from.split("/").filter(Boolean);
		for (const segment of segments) {
			if (!segment.startsWith(":")) continue;
			if (/^:[A-Za-z0-9_]+(?:\.[A-Za-z0-9]+)?$/.test(segment)) continue;
			failures.push(`invalid archive placeholder segment in _redirects "from": ${rule.from}`);
		}
	}
}

function toMatcherRequest(url) {
	let decodedPath = url.pathname;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		decodedPath = url.pathname;
	}

	return {
		scheme: url.protocol.replace(/:$/, ""),
		host: url.hostname,
		path: decodedPath,
		query: url.search.slice(1),
		headers: {},
		cookieValues: {},
		getHeader: () => "",
		getCookie: () => "",
	};
}

function toRedirectTarget(rule, url) {
	const target = new URL(rule.to, `${url.origin}/`);
	if (target.search === "" && url.search !== "") target.search = url.search;
	return target.toString();
}

function safeDecode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function buildRedirectsResponse(url, matcher) {
	const rule = matcher.match(toMatcherRequest(url));
	if (!rule) return new Response("Not found", { status: 404 });

	const status = Number(rule.status || 200);
	if (status >= 300 && status < 400) {
		return new Response(null, {
			status,
			headers: {
				location: toRedirectTarget(rule, url),
			},
		});
	}

	if (status === 200) {
		return new Response("Rewrite match", {
			status: 200,
			headers: {
				"x-rewrite-target": toRedirectTarget(rule, url),
			},
		});
	}

	return new Response("Rule match", { status });
}

async function simulateNetlifyRequest(matcher, pathAndQuery) {
	const url = new URL(pathAndQuery, "https://jcrt.org");
	const request = new Request(url.toString(), { method: "GET" });
	const response = await queryCanonicalRedirects(request, {
		next: async () =>
			archiveLegacyRedirects(request, {
				next: async () =>
					assetCanonicalRedirects(request, {
						next: async () => buildRedirectsResponse(url, matcher),
					}),
			}),
	});

	return {
		status: response.status,
		location: response.headers.get("location"),
		rewriteTarget: response.headers.get("x-rewrite-target"),
	};
}

function assertRedirectPath(failures, result, expectedPath, label) {
	if (!(result.status >= 300 && result.status < 400)) {
		failures.push(`${label}: expected redirect status, got ${result.status}`);
		return;
	}
	if (!result.location) {
		failures.push(`${label}: expected redirect location header`);
		return;
	}
	const locationUrl = new URL(result.location, "https://jcrt.org");
	if (locationUrl.pathname !== expectedPath) {
		failures.push(`${label}: expected redirect path ${expectedPath}, got ${locationUrl.pathname}`);
	}
	if (locationUrl.pathname.includes(":slug") || locationUrl.toString().includes(":slug")) {
		failures.push(`${label}: redirect leaked literal placeholder in location (${result.location})`);
	}
}

function assertRedirectHostPath(failures, result, expectedHost, expectedPath, label) {
	if (!(result.status >= 300 && result.status < 400)) {
		failures.push(`${label}: expected redirect status, got ${result.status}`);
		return;
	}
	if (!result.location) {
		failures.push(`${label}: expected redirect location header`);
		return;
	}
	const locationUrl = new URL(result.location, "https://jcrt.org");
	if (locationUrl.host !== expectedHost || locationUrl.pathname !== expectedPath) {
		failures.push(
			`${label}: expected redirect ${expectedHost}${expectedPath}, got ${locationUrl.host}${locationUrl.pathname}`
		);
	}
	if (locationUrl.pathname.includes(":slug") || locationUrl.toString().includes(":slug")) {
		failures.push(`${label}: redirect leaked literal placeholder in location (${result.location})`);
	}
}

function assertRedirectUrl(failures, result, expectedUrl, label) {
	if (!(result.status >= 300 && result.status < 400)) {
		failures.push(`${label}: expected redirect status, got ${result.status}`);
		return;
	}
	if (!result.location) {
		failures.push(`${label}: expected redirect location header`);
		return;
	}
	const actual = new URL(result.location, "https://jcrt.org").toString();
	const expected = new URL(expectedUrl).toString();
	if (actual !== expected) {
		failures.push(`${label}: expected redirect ${expected}, got ${actual}`);
	}
}

function assertStatus(failures, result, expectedStatus, label) {
	if (result.status !== expectedStatus) {
		failures.push(`${label}: expected status ${expectedStatus}, got ${result.status}`);
	}
}

function loadJcrtFilesTrackedPaths() {
	const filesRepo = path.resolve(repoRoot, "..", "jcrt-files");
	try {
		const out = execFileSync("git", ["-C", filesRepo, "ls-files"], { encoding: "utf8" });
		return new Set(out.split(/\r?\n/).filter(Boolean));
	} catch {
		return null;
	}
}

async function validateSearchConsole403Fixtures(failures, matcher) {
	if (!fs.existsSync(searchConsole403FixturePath)) return 0;

	const urls = fs
		.readFileSync(searchConsole403FixturePath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const trackedFiles = loadJcrtFilesTrackedPaths();

	for (const rawUrl of urls) {
		const result = await simulateNetlifyRequest(matcher, rawUrl);
		const sourceUrl = new URL(rawUrl);
		const sourcePath = safeDecode(sourceUrl.pathname);

		if (result.status === 403) {
			failures.push(`403 fixture ${rawUrl}: still returns 403`);
			continue;
		}

		if (sourcePath === "/images" || sourcePath === "/images/") {
			if (result.status !== 410) {
				failures.push(`403 fixture ${rawUrl}: expected 410 for bare images directory, got ${result.status}`);
			}
			continue;
		}

		if (sourcePath === "/archives/05.2/taylor/") {
			if (result.status !== 200) {
				failures.push(`403 fixture ${rawUrl}: expected archive article to remain 200, got ${result.status}`);
			}
			continue;
		}

		if (sourcePath === "/images/logos/site.webmanifest") {
			if (result.status !== 200) {
				failures.push(`403 fixture ${rawUrl}: expected local manifest to remain 200, got ${result.status}`);
			}
			continue;
		}

		const shouldRedirectToFiles = sourcePath.startsWith("/citations/");
		if (!shouldRedirectToFiles) {
			failures.push(`403 fixture ${rawUrl}: unexpected path in fixture`);
			continue;
		}

		if (!(result.status >= 300 && result.status < 400) || !result.location) {
			failures.push(`403 fixture ${rawUrl}: expected files.jcrt.org redirect, got ${result.status}`);
			continue;
		}

		const locationUrl = new URL(result.location, "https://jcrt.org");
		if (locationUrl.host !== "files.jcrt.org") {
			failures.push(`403 fixture ${rawUrl}: expected files.jcrt.org redirect, got ${locationUrl.host}`);
		}
		if (locationUrl.search) {
			failures.push(`403 fixture ${rawUrl}: expected clean redirect without query, got ${locationUrl.toString()}`);
		}

		if (trackedFiles && sourcePath.startsWith("/citations/")) {
			const targetPath = safeDecode(locationUrl.pathname).replace(/^\/+/, "");
			if (!trackedFiles.has(targetPath)) {
				failures.push(`403 fixture ${rawUrl}: redirect target is not tracked in jcrt-files (${targetPath})`);
			}
		}
	}

	return urls.length;
}

async function validateSearchConsole404Fixtures(failures, matcher) {
	if (!fs.existsSync(searchConsole404FixturePath)) return 0;

	const cases = fs
		.readFileSync(searchConsole404FixturePath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const [rawUrl, status, target = ""] = line.split("|").map((part) => part.trim());
			return { rawUrl, status: Number(status), target };
		});

	for (const testCase of cases) {
		const result = await simulateNetlifyRequest(matcher, testCase.rawUrl);
		if (result.status !== testCase.status) {
			failures.push(`404 fixture ${testCase.rawUrl}: expected ${testCase.status}, got ${result.status}`);
			continue;
		}

		if (testCase.status >= 300 && testCase.status < 400) {
			if (!result.location) {
				failures.push(`404 fixture ${testCase.rawUrl}: expected redirect location`);
				continue;
			}
			if (testCase.target && testCase.target !== "redirect") {
				const actual = new URL(result.location, testCase.rawUrl).toString();
				const expected = new URL(testCase.target, testCase.rawUrl).toString();
				if (actual !== expected) {
					failures.push(`404 fixture ${testCase.rawUrl}: expected ${expected}, got ${actual}`);
				}
			}
		}

		if (testCase.status === 410 && result.location) {
			failures.push(`404 fixture ${testCase.rawUrl}: 410 should not include redirect location`);
		}
	}

	return cases.length;
}

async function validateSearchConsoleQueryRedirectFixtures(failures, matcher) {
	if (!fs.existsSync(searchConsoleQueryRedirectFixturePath)) return 0;

	const cases = fs
		.readFileSync(searchConsoleQueryRedirectFixturePath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const [rawUrl, status, target = ""] = line.split("|").map((part) => part.trim());
			return { rawUrl, status: Number(status), target };
		});

	for (const testCase of cases) {
		const result = await simulateNetlifyRequest(matcher, testCase.rawUrl);
		if (result.status !== testCase.status) {
			failures.push(`query fixture ${testCase.rawUrl}: expected ${testCase.status}, got ${result.status}`);
			continue;
		}

		if (testCase.status >= 300 && testCase.status < 400) {
			if (!result.location) {
				failures.push(`query fixture ${testCase.rawUrl}: expected redirect location`);
				continue;
			}
			const actual = new URL(result.location, testCase.rawUrl).toString();
			const expected = new URL(testCase.target, testCase.rawUrl).toString();
			if (actual !== expected) {
				failures.push(`query fixture ${testCase.rawUrl}: expected ${expected}, got ${actual}`);
			}
			if (new URL(actual).search) {
				failures.push(`query fixture ${testCase.rawUrl}: redirect target should not include query (${actual})`);
			}
		}

		if (testCase.status === 410 && result.location) {
			failures.push(`query fixture ${testCase.rawUrl}: 410 should not include redirect location`);
		}
	}

	return cases.length;
}

const redirectsText = loadRedirectsText();
const ruleLines = loadRuleLines(redirectsText);
const failures = [];

const archiveExceptions = [
	["/archives/01.2/vahanian", "/archives/01.2/nvahanian/"],
	["/archives/01.2/vahanian/", "/archives/01.2/nvahanian/"],
	["/archives/01.2/wyschograd_raschke.shtml", "/archives/01.2/wyschogrod_raschke/"],
	["/archives/02.1/reinhard.shtml", "/archives/02.1/reinhard_lupton/"],
	["/archives/02.1/intro_reinhard_lupton.shtml", "/archives/02.1/lupton/"],
	["/archives/03.1/taylor.shtml", "/archives/03.1/"],
	["/archives/04.1/manolopoulos.shtml", "/archives/04.1/markmanolopoulos/"],
	["/archives/04.2/%20pecora.shtml", "/archives/04.2/pecora/"],
	["/archives/07.1/zizek-taylor.shtml", "/archives/07.1/taylor/"],
	["/archives/07.2/mdex.shtml", "/archives/07.2/"],
];

const archiveIndexRules = [
	["/archives/:issue/index2/:slug/", "/archives/:issue/:slug/"],
	["/archives/:issue/index.shtml", "/archives/:issue/"],
	["/archives/:issue/index.html", "/archives/:issue/"],
	["/archives/:issue/index", "/archives/:issue/"],
];

const removedArchiveRules = [
	["/archives/:issue/:slug.shtml", "/archives/:issue/:slug/"],
	["/archives/:issue/:slug.html", "/archives/:issue/:slug/"],
	["/archives/:issue/:slug.pdf", "https://files.jcrt.org/archives/:issue/:slug.pdf"],
];

const archiveRewriteRule = ["/archives/:issue/:slug/", "/archives/:issue/:slug/index.html"];

const nonArchiveRules = [
	["/religioustheory/abstracts/:file", "https://files.jcrt.org/docs/:file"],
	["/authors/carl-raschke%20copy/", "/authors/carl-raschke/"],
];

const assetBridgeRules = [
	["/images/logos/site.webmanifest", "/images/logos/site.webmanifest", 200],
	["/images/*", "https://files.jcrt.org/images/:splat", 301],
	["/docs/*", "https://files.jcrt.org/docs/:splat", 301],
	["/citations/*", "https://files.jcrt.org/citations/:splat", 301],
];

const malformedPdfRules = [
	["/archives/18.3/Roberts%20and%20Hayden.pdf", "/archives/18.3/robertsandhayden.pdf"],
	["/archives/17.2/Hagedorn%20and%20Staudigl.pdf", "/archives/17.2/Hagedorn-and-Staudigl.pdf"],
	["/archives/05%20.3/flato.pdf", "/archives/05.3/flato.pdf"],
	["/archives/13.1/lugones.pdf-", "/archives/13.1/lugones.pdf"],
	["/archives/17.2/Leclerq.pdf", "/archives/17.2/leclercq.pdf"],
	["/archives/17.3/Datan.pdf", "/archives/17.3/Datar.pdf"],
];

for (const rule of [...archiveExceptions, ...archiveIndexRules, archiveRewriteRule, ...nonArchiveRules, ...malformedPdfRules]) {
	assertPresent(failures, ruleLines, rule[0], rule[1]);
}

for (const rule of assetBridgeRules) {
	assertPresentStatus(failures, ruleLines, rule[0], rule[1], rule[2]);
}

for (const rule of removedArchiveRules) {
	assertAbsent(failures, ruleLines, rule[0], rule[1]);
}

for (const exceptionRule of archiveExceptions) {
	assertOrderedBefore(failures, ruleLines, exceptionRule, archiveRewriteRule);
}

assertNoArchivePlaceholderSuffixes(failures, ruleLines);

assertAbsent(failures, ruleLines, "/archives/15.2/valente2", "/archives/15.2/valente/");

const netlifyToml = fs.readFileSync(netlifyTomlPath, "utf8");
if (netlifyToml.includes('function = "legacy-redirects"')) {
	failures.push('netlify.toml still references "legacy-redirects"');
}
if (!netlifyToml.includes('function = "archive-legacy-redirects"')) {
	failures.push('netlify.toml is missing edge function "archive-legacy-redirects"');
}
if (!netlifyToml.includes('function = "asset-canonical-redirects"')) {
	failures.push('netlify.toml is missing edge function "asset-canonical-redirects"');
}
if (!netlifyToml.includes('function = "query-canonical-redirects"')) {
	failures.push('netlify.toml is missing edge function "query-canonical-redirects"');
}

for (const deletedPath of [
	path.join(repoRoot, "netlify", "edge-functions", "legacy-redirects.js"),
	path.join(repoRoot, "netlify", "edge-functions", "archive-route-manifest.js"),
]) {
	if (fs.existsSync(deletedPath)) {
		failures.push(`deleted file still exists: ${path.relative(repoRoot, deletedPath)}`);
	}
}

const matcher = await redirector.parsePlain(redirectsText, {});

const cognitiveWarfareShortlink = await simulateNetlifyRequest(matcher, "/cw");
assertRedirectPath(
	failures,
	cognitiveWarfareShortlink,
	"/blog/2026-04-22-religion-politics-and-cognitive-warfare-information-interpretation-conspiracy-and-the-struggle-for-reality/",
	"runtime /cw"
);

const cognitiveWarfareShortlinkSlash = await simulateNetlifyRequest(matcher, "/cw/");
assertRedirectPath(
	failures,
	cognitiveWarfareShortlinkSlash,
	"/blog/2026-04-22-religion-politics-and-cognitive-warfare-information-interpretation-conspiracy-and-the-struggle-for-reality/",
	"runtime /cw/"
);

const deanShtml = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.shtml");
assertRedirectPath(failures, deanShtml, "/archives/03.1/dean/", "runtime /archives/03.1/dean.shtml");

const deanHtml = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.html");
assertRedirectPath(failures, deanHtml, "/archives/03.1/dean/", "runtime /archives/03.1/dean.html");

const deanPdf = await simulateNetlifyRequest(matcher, "/archives/03.1/dean.pdf");
assertRedirectHostPath(
	failures,
	deanPdf,
	"files.jcrt.org",
	"/archives/03.1/dean.pdf",
	"runtime /archives/03.1/dean.pdf"
);

const malformedPdf = await simulateNetlifyRequest(matcher, "/archives/18.3/Roberts%20and%20Hayden.pdf");
assertRedirectPath(
	failures,
	malformedPdf,
	"/archives/18.3/robertsandhayden.pdf",
	"runtime /archives/18.3/Roberts%20and%20Hayden.pdf"
);

const articlePdfException = await simulateNetlifyRequest(matcher, "/archives/24.2/trinkauskait%C4%97.pdf");
assertRedirectPath(
	failures,
	articlePdfException,
	"/archives/24.2/trinkauskaite/",
	"runtime /archives/24.2/trinkauskait%C4%97.pdf"
);

const marionTaylorPdf = await simulateNetlifyRequest(
	matcher,
	"http://www.jcrt.org/archives/07.2/marion-taylor-intro.pdf"
);
assertRedirectUrl(
	failures,
	marionTaylorPdf,
	"https://jcrt.org/archives/07.2/taylor/",
	"runtime http://www.jcrt.org/archives/07.2/marion-taylor-intro.pdf"
);

const marionTaylorPdfQuery = await simulateNetlifyRequest(
	matcher,
	"http://www.jcrt.org/archives/07.2/marion-taylor-intro.pdf?iframe=true&width=80%25&height=80%25"
);
assertRedirectUrl(
	failures,
	marionTaylorPdfQuery,
	"https://jcrt.org/archives/07.2/taylor/",
	"runtime http://www.jcrt.org/archives/07.2/marion-taylor-intro.pdf?iframe=true&width=80%&height=80%"
);

const index2Dean = await simulateNetlifyRequest(matcher, "/archives/03.1/index2/dean/");
assertRedirectPath(failures, index2Dean, "/archives/03.1/dean/", "runtime /archives/03.1/index2/dean/");

const citationCaseAlias = await simulateNetlifyRequest(matcher, "/citations/archives/17.1/Muraca.csl.json");
assertRedirectUrl(
	failures,
	citationCaseAlias,
	"https://files.jcrt.org/citations/archives/17.1/muraca.csl.json",
	"runtime /citations/archives/17.1/Muraca.csl.json"
);

const citationPassthrough = await simulateNetlifyRequest(matcher, "/citations/archives/05.2/conroy.ris");
assertRedirectUrl(
	failures,
	citationPassthrough,
	"https://files.jcrt.org/citations/archives/05.2/conroy.ris",
	"runtime /citations/archives/05.2/conroy.ris"
);

const citationStaleAlias = await simulateNetlifyRequest(matcher, "/citations/archives/01.2/vahanian.ris");
assertRedirectUrl(
	failures,
	citationStaleAlias,
	"https://files.jcrt.org/citations/archives/01.2/nvahanian.ris",
	"runtime /citations/archives/01.2/vahanian.ris"
);

const citationPostscriptAlias = await simulateNetlifyRequest(matcher, "/citations/archives/25.1/brett-and-hill.ris");
assertRedirectUrl(
	failures,
	citationPostscriptAlias,
	"https://files.jcrt.org/citations/archives/25.1/postscript.ris",
	"runtime /citations/archives/25.1/brett-and-hill.ris"
);

const manifestRedirect = await simulateNetlifyRequest(matcher, "/images/logos/site.webmanifest");
assertStatus(failures, manifestRedirect, 200, "runtime /images/logos/site.webmanifest");

const imagesRoot = await simulateNetlifyRequest(matcher, "/images/");
assertStatus(failures, imagesRoot, 410, "runtime /images/");

const archiveTaylor = await simulateNetlifyRequest(matcher, "/archives/05.2/taylor/");
assertStatus(failures, archiveTaylor, 200, "runtime /archives/05.2/taylor/");

const searchConsole403Count = await validateSearchConsole403Fixtures(failures, matcher);
const searchConsole404Count = await validateSearchConsole404Fixtures(failures, matcher);
const searchConsoleQueryRedirectCount = await validateSearchConsoleQueryRedirectFixtures(failures, matcher);

const missingArticle = await simulateNetlifyRequest(matcher, "/archives/03.1/does-not-exist/");
if (missingArticle.status >= 300 && missingArticle.status < 400) {
	failures.push(
		`runtime /archives/03.1/does-not-exist/: unexpected redirect ${missingArticle.status} -> ${
			missingArticle.location || "<none>"
		}`
	);
}
if ((missingArticle.location || "").includes(":slug")) {
	failures.push(
		`runtime /archives/03.1/does-not-exist/: literal placeholder leaked (${missingArticle.location})`
	);
}

if (failures.length > 0) {
	console.error("Redirect validation failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log(
	`Validated ${archiveExceptions.length} archive exceptions, ${archiveIndexRules.length} archive index rules, ${searchConsole403Count} Search Console 403 fixtures, ${searchConsole404Count} Search Console 404 fixtures, ${searchConsoleQueryRedirectCount} Search Console query/redirect fixtures, runtime matcher behavior, and edge redirects.`
);
