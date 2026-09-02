// Single source of truth for "is this item CC BY?" — reads `license` from _data/metadata.yaml.
// Front matter `license: cc-by` forces on (e.g. a backfile author who consented);
// `license: none` forces off. Otherwise: dated on/after metadata.license.since.
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

let cached;
export function siteLicense() {
	if (!cached) {
		const raw = fs.readFileSync(path.join(process.cwd(), "_data", "metadata.yaml"), "utf8");
		cached = yaml.load(raw)?.license || {};
	}
	return cached;
}

export function isCcBy(frontMatter, date) {
	const flag = String(frontMatter?.license || "").toLowerCase();
	if (flag === "cc-by") return true;
	if (flag === "none") return false;
	const since = siteLicense().since;
	if (!since || !date) return false;
	const d = new Date(date);
	if (Number.isNaN(d.getTime())) return false;
	return d.toISOString().slice(0, 10) >= String(since);
}

export function rightsText(ccBy, year) {
	const lic = siteLicense();
	return ccBy
		? `© ${year ? `${year} ` : ""}the author(s). Published in the Journal for Cultural and Religious Theory under a ${lic.long_name || "Creative Commons Attribution 4.0 International"} license (${lic.url}). Authors retain copyright.`
		: "Copyright held by the author(s). Published in the Journal for Cultural and Religious Theory. https://jcrt.org/copyright/";
}
