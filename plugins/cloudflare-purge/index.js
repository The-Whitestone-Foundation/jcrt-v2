/**
 * Netlify build plugin: purge the Cloudflare edge cache after a production deploy.
 *
 * The Cache Rules in jcrt-meta/docs/cloudflare-cache.md give HTML/XML/JSON a long edge TTL that
 * ignores the origin's `max-age=0, must-revalidate`, so without this the new deploy stays
 * invisible at the edge until that TTL expires.
 *
 * onSuccess runs after the deploy stage, so the purge lands once the new content is live.
 * It cannot call utils.build.failBuild() -- the deploy has already shipped -- so a purge
 * failure is reported with failPlugin and leaves the deploy alone.
 *
 * Requires CLOUDFLARE_API_TOKEN (Zone -> Cache Purge -> Purge) and CLOUDFLARE_ZONE_ID as
 * Netlify environment variables.
 */

import { purgeEverything } from "../../scripts/cloudflare-purge.mjs";

export const onSuccess = async ({ utils }) => {
	if (process.env.CONTEXT !== "production") {
		console.log(`cloudflare-purge: context is "${process.env.CONTEXT}", skipping.`);
		return;
	}

	const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
	const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim();
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
