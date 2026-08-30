import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSIONED_FILES = ["css/bs.css", "public/css/index.css", "public/css/font.css"];

function getAssetContentHash() {
	const hash = crypto.createHash("sha256");
	let hashedAny = false;

	for (const relativePath of VERSIONED_FILES) {
		try {
			const absolutePath = path.join(process.cwd(), relativePath);
			hash.update(relativePath);
			hash.update(fs.readFileSync(absolutePath));
			hashedAny = true;
		} catch {
			// A missing source stylesheet must not change the token for the others.
		}
	}

	return hashedAny ? hash.digest("hex").slice(0, 12) : "";
}

function getLatestAssetMtime() {
	return VERSIONED_FILES.reduce((latest, relativePath) => {
		try {
			const absolutePath = path.join(process.cwd(), relativePath);
			const stat = fs.statSync(absolutePath);
			return Math.max(latest, Math.trunc(stat.mtimeMs));
		} catch {
			return latest;
		}
	}, 0);
}

export default function () {
	// Derive `?v=` from stylesheet CONTENT, not from COMMIT_REF. Keying on the commit
	// changed the token on every deploy, so all ~7,000 pages differed byte-for-byte and
	// Netlify re-uploaded and re-post-processed the entire site for a one-article change.
	//
	// Note this hashes the *source* stylesheets. `_site/css/bs.css` is later purged
	// against the built HTML, so its bytes can shift without a source change. That is why
	// the served cache policy in `public/_headers` is max-age + stale-while-revalidate
	// rather than `immutable` — a purge-only change self-heals within the revalidation
	// window instead of being pinned for a year.
	const contentHash = getAssetContentHash();
	if (contentHash) {
		return contentHash;
	}

	const latestAssetMtime = getLatestAssetMtime();
	if (latestAssetMtime > 0) {
		return latestAssetMtime.toString(36);
	}

	return String(Date.now()).slice(0, 12);
}
