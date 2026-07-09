import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const siteDir = path.join(process.cwd(), "_site");
const verificationFileName = "googlebfdcfddbdbfcbd99.html";
const verificationFilePath = path.join(siteDir, verificationFileName);
const parkedFilePath = path.join(siteDir, `.${verificationFileName}.pagefind-skip`);
const cacheDir = path.join(process.cwd(), ".cache");
const pagefindCacheDir = path.join(cacheDir, "pagefind-index");
const pagefindStatePath = path.join(cacheDir, "pagefind-state.json");
const sourceRoots = [
	path.join(process.cwd(), "content", "archives"),
	path.join(process.cwd(), "content", "blog"),
	path.join(process.cwd(), "content", "religioustheory"),
	path.join(process.cwd(), "_config", "run-pagefind.js"),
];
const sourceExts = new Set([".md", ".njk", ".html", ".11ty.js", ".js", ".json", ".yaml", ".yml", ".txt", ".xml"]);

function pagefindBinPath() {
	const binName = process.platform === "win32" ? "pagefind.cmd" : "pagefind";
	return path.join(process.cwd(), "node_modules", ".bin", binName);
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function ensureDir(dirPath) {
	await fs.mkdir(dirPath, { recursive: true });
}

async function removePath(targetPath) {
	await fs.rm(targetPath, { recursive: true, force: true });
}

async function copyDir(fromDir, toDir) {
	await ensureDir(toDir);
	const entries = await fs.readdir(fromDir, { withFileTypes: true });
	for (const entry of entries) {
		const from = path.join(fromDir, entry.name);
		const to = path.join(toDir, entry.name);
		if (entry.isDirectory()) {
			await copyDir(from, to);
		} else if (entry.isFile()) {
			await ensureDir(path.dirname(to));
			await fs.copyFile(from, to);
		}
	}
}

function sha256(input) {
	return crypto.createHash("sha256").update(input).digest("hex");
}

async function hashFile(filePath) {
	const stat = await fs.stat(filePath);
	return `${filePath}|${stat.size}|${Math.trunc(stat.mtimeMs)}`;
}

async function hashTree(rootPath, lines) {
	const stat = await fs.stat(rootPath);
	if (stat.isFile()) {
		lines.push(await hashFile(rootPath));
		return;
	}
	const entries = await fs.readdir(rootPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			await hashTree(fullPath, lines);
			continue;
		}
		if (!entry.isFile()) continue;
		const ext = path.extname(entry.name).toLowerCase();
		if (!sourceExts.has(ext)) continue;
		lines.push(await hashFile(fullPath));
	}
}

async function computeSourceSignature() {
	const lines = [];
	for (const sourcePath of sourceRoots) {
		if (!(await fileExists(sourcePath))) continue;
		await hashTree(sourcePath, lines);
	}
	// A pagefind upgrade must invalidate the cached index (index format follows the binary version).
	try {
		const pagefindPkg = JSON.parse(
			await fs.readFile(path.join(process.cwd(), "node_modules", "pagefind", "package.json"), "utf8"),
		);
		lines.push(`pagefind-version|${pagefindPkg.version}`);
	} catch {
		lines.push(`pagefind-version|unknown-${Date.now()}`);
	}
	lines.sort((a, b) => a.localeCompare(b));
	return sha256(lines.join("\n"));
}

async function loadPagefindState() {
	if (!(await fileExists(pagefindStatePath))) {
		return { sourceSignature: "" };
	}
	try {
		const raw = await fs.readFile(pagefindStatePath, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		// Ignore invalid cache state.
	}
	return { sourceSignature: "" };
}

async function savePagefindState(state) {
	await ensureDir(path.dirname(pagefindStatePath));
	await fs.writeFile(pagefindStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function restoreCachedPagefind() {
	if (!(await fileExists(pagefindCacheDir))) return false;
	await removePath(path.join(siteDir, "pagefind"));
	await copyDir(pagefindCacheDir, path.join(siteDir, "pagefind"));
	return true;
}

async function cacheBuiltPagefind() {
	const builtDir = path.join(siteDir, "pagefind");
	if (!(await fileExists(builtDir))) return;
	await removePath(pagefindCacheDir);
	await copyDir(builtDir, pagefindCacheDir);
}

async function runPagefind() {
	const binPath = pagefindBinPath();
	const args = [
		"--site",
		"_site",
		"--force-language",
		"en",
		"--root-selector",
		"[data-pagefind-body]",
		"--exclude-selectors",
		".tag-list,aside,[data-pagefind-ignore],.keywords,.categories",
		"--quiet",
	];

	await new Promise((resolve, reject) => {
		const child = spawn(binPath, args, {
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`pagefind exited with code ${code}`));
		});
	});
}

async function main() {
	const sourceSignature = await computeSourceSignature();
	const prev = await loadPagefindState();
	const shouldReuseCache = prev.sourceSignature === sourceSignature;

	if (shouldReuseCache && (await restoreCachedPagefind())) {
		console.log("[Pagefind] Skipped: source signature unchanged, restored cached index.");
		return;
	}

	const hadVerificationFile = await fileExists(verificationFilePath);
	if (hadVerificationFile) {
		await fs.rename(verificationFilePath, parkedFilePath);
	}

	try {
		await runPagefind();
		await cacheBuiltPagefind();
		await savePagefindState({ sourceSignature });
	} finally {
		if (await fileExists(parkedFilePath)) {
			await fs.rename(parkedFilePath, verificationFilePath);
		}
	}
}

main().catch((error) => {
	console.error("[Pagefind] Failed:", error);
	process.exit(1);
});
