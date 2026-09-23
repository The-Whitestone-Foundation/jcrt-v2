/**
 * Netlify build plugin: purge the Cloudflare edge cache after a production deploy.
 *
 * jcrt.org is orange-clouded through Cloudflare, and the Cache Rules in
 * jcrt-meta/docs/cloudflare-cache.md give HTML/XML/JSON a long edge TTL that ignores the origin's
 * `max-age=0, must-revalidate`, so without this the new deploy stays invisible at the edge until
 * that TTL expires.
 *
 * onSuccess runs after the deploy stage, so the purge lands once the new content is live.
 * It cannot call utils.build.failBuild() -- the deploy has already shipped -- so a purge
 * failure is reported with failPlugin and leaves the deploy alone.
 *
 * Requires CLOUDFLARE_API_TOKEN (Zone -> Cache Purge -> Purge, jcrt.org only) and
 * CLOUDFLARE_ZONE_ID as Netlify environment variables.
 *
 * Manual purge from a shell with the same two variables: `npm run cf:purge`.
 */

import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.cloudflare.com/client/v4";

function credentials() {
	return {
		token: String(process.env.CLOUDFLARE_API_TOKEN || "").trim(),
		zoneId: String(process.env.CLOUDFLARE_ZONE_ID || "").trim(),
	};
}

// Not exported: Netlify treats every named export of a plugin as a lifecycle event and fails
// the build on any name it does not know ("Invalid event 'purgeEverything'").
async function purgeEverything({ token, zoneId }) {
	const response = await fetch(`${API_ROOT}/zones/${zoneId}/purge_cache`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ purge_everything: true }),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || payload.success === false) {
		const detail = (payload.errors || []).map((error) => `${error.code}: ${error.message}`).join("; ");
		throw new Error(`Cloudflare purge failed (${response.status})${detail ? ` — ${detail}` : ""}`);
	}
	return payload;
}

export const onSuccess = async ({ utils }) => {
	if (process.env.CONTEXT !== "production") {
		console.log(`cloudflare-purge: context is "${process.env.CONTEXT}", skipping.`);
		return;
	}
	const { token, zoneId } = credentials();
	if (!token || !zoneId) {
		console.log("cloudflare-purge: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set, skipping.");
		return;
	}
	try {
		await purgeEverything({ token, zoneId });
		console.log("cloudflare-purge: purged everything.");
	} catch (error) {
		utils.build.failPlugin(`cloudflare-purge: ${error.message}`);
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { token, zoneId } = credentials();
	if (!token || !zoneId) {
		console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required.");
		process.exitCode = 1;
	} else {
		await purgeEverything({ token, zoneId }).then(
			() => console.log("Purged everything."),
			(error) => { console.error(error.message); process.exitCode = 1; },
		);
	}
}
