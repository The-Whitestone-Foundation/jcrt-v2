import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const siteDir = path.join(process.cwd(), "_site");
const verificationFileName = "googlebfdcfddbdbfcbd99.html";
const verificationFilePath = path.join(siteDir, verificationFileName);
const parkedFilePath = path.join(siteDir, `.${verificationFileName}.pagefind-skip`);

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
	// The index is rebuilt from _site on every build; the old signature-based
	// cache (.cache/pagefind-index) risked restoring an index that no longer
	// matched the deployed pagefind.js or HTML, so it was removed.
	const hadVerificationFile = await fileExists(verificationFilePath);
	if (hadVerificationFile) {
		await fs.rename(verificationFilePath, parkedFilePath);
	}

	try {
		await runPagefind();
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
