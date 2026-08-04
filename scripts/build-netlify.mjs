import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTEXT = String(process.env.CONTEXT || "").trim().toLowerCase();
const BRANCH = String(process.env.BRANCH || process.env.HEAD || "").trim();
const IS_PRODUCTION_CONTEXT = CONTEXT === "production" || BRANCH === "main" || BRANCH === "master";
const FORCE_FULL_BUILD = String(process.env.FORCE_FULL_NETLIFY_BUILD || "").trim() === "1";
const FORCE_FAST_BUILD = String(process.env.FORCE_FAST_NETLIFY_BUILD || "").trim() === "1";

function runCommand(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env,
	});
	if (result.status !== 0) {
		process.exit(result.status || 1);
	}
}

function runNpmScript(scriptName, envOverrides = {}) {
	const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
	runCommand(npmCmd, ["run", scriptName], {
		...process.env,
		...envOverrides,
	});
}

function runGit(args) {
	const result = spawnSync("git", args, {
		encoding: "utf8",
	});
	if (result.status !== 0) return null;
	return String(result.stdout || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function changedFiles() {
	const commitRef = String(process.env.COMMIT_REF || "").trim();
	const cachedCommitRef = String(process.env.CACHED_COMMIT_REF || "").trim();

	if (commitRef && cachedCommitRef && commitRef !== cachedCommitRef) {
		const files = runGit(["diff", "--name-only", `${cachedCommitRef}...${commitRef}`]);
		if (files) return files;
	}

	const previousCommitFiles = runGit(["show", "--pretty=", "--name-only", "HEAD"]);
	if (previousCommitFiles) return previousCommitFiles;

	return null;
}

function isImpactfulBuildChange(filePath) {
	const file = String(filePath || "").trim();
	if (!file) return false;

	// Run full checks when core content/templates/config/build surface changed.
	if (
		file.startsWith("content/") ||
		file.startsWith("_includes/") ||
		file.startsWith("_data/") ||
		file.startsWith("_config/") ||
		file.startsWith("public/") ||
		file.startsWith("netlify/") ||
		file === "eleventy.config.js" ||
		file === "netlify.toml" ||
		file === "package.json" ||
		file === "package-lock.json"
	) {
		return true;
	}

	return /\.(md|njk|html|xml|yaml|yml|json|js|cjs|mjs)$/i.test(file);
}

function runFullBuild() {
	console.log("[build:netlify] Mode: full");
	runNpmScript("build:netlify:full");
}

function runFastBuild() {
	console.log("[build:netlify] Mode: fast");
	runNpmScript("build:netlify:fast");
}

function runContentBuild() {
	console.log("[build:netlify] Mode: content");
	runNpmScript("build:netlify:content");
}

function isFullBuildOnlyChange(filePath) {
	const file = String(filePath || "").trim();
	if (!file) return false;

	// Infrastructure and build pipeline changes must run all validations.
	if (
		file.startsWith("scripts/") ||
		file.startsWith("netlify/") ||
		file.startsWith("_config/") ||
		file === "eleventy.config.js" ||
		file === "netlify.toml" ||
		file === "package.json" ||
		file === "package-lock.json"
	) {
		return true;
	}

	return false;
}

function main() {
	fs.mkdirSync(".cache", { recursive: true });

	const files = changedFiles();
	const canDetectChanges = Array.isArray(files);
	const impactfulFiles = canDetectChanges ? files.filter(isImpactfulBuildChange) : [];
	const fullBuildOnlyFiles = canDetectChanges ? impactfulFiles.filter(isFullBuildOnlyChange) : [];
	const hasImpactfulChanges = canDetectChanges ? impactfulFiles.length > 0 : IS_PRODUCTION_CONTEXT;
	const hasFullBuildOnlyChanges = canDetectChanges ? fullBuildOnlyFiles.length > 0 : IS_PRODUCTION_CONTEXT;

	console.log(`[build:netlify] Context: ${CONTEXT || "unknown"} (branch: ${BRANCH || "unknown"})`);
	if (canDetectChanges) {
		console.log(`[build:netlify] Changed files: ${files.length}`);
		console.log(`[build:netlify] Impactful files: ${impactfulFiles.length}`);
		console.log(`[build:netlify] Full-build-only files: ${fullBuildOnlyFiles.length}`);
		if (impactfulFiles.length > 0) {
			const preview = impactfulFiles.slice(0, 10);
			for (const file of preview) console.log(`[build:netlify] file: ${file}`);
			if (impactfulFiles.length > preview.length) {
				console.log(`[build:netlify] file: ...and ${impactfulFiles.length - preview.length} more`);
			}
		}
	} else {
		console.log("[build:netlify] Unable to detect changed files; defaulting to safe mode.");
	}

	const shouldRunFull = IS_PRODUCTION_CONTEXT && hasFullBuildOnlyChanges;
	const shouldRunContent = IS_PRODUCTION_CONTEXT && hasImpactfulChanges && !hasFullBuildOnlyChanges;
	if (FORCE_FULL_BUILD && FORCE_FAST_BUILD) {
		console.error("[build:netlify] FORCE_FULL_NETLIFY_BUILD and FORCE_FAST_NETLIFY_BUILD cannot both be 1.");
		process.exit(1);
	}
	if (FORCE_FULL_BUILD) {
		console.log("[build:netlify] FORCE_FULL_NETLIFY_BUILD=1, running full production checks.");
		runFullBuild();
		return;
	}
	if (FORCE_FAST_BUILD) {
		console.log("[build:netlify] FORCE_FAST_NETLIFY_BUILD=1, running fast checks.");
		runFastBuild();
		return;
	}
	if (shouldRunFull) {
		console.log("[build:netlify] Running full production checks (infrastructure/build files changed).");
		runFullBuild();
		return;
	}

	if (shouldRunContent) {
		console.log("[build:netlify] Running content mode (content/templates changed, infra unchanged).");
		runContentBuild();
		return;
	}

	console.log("[build:netlify] Running fast checks (no impactful changes or non-production context).");
	runFastBuild();
}

main();
