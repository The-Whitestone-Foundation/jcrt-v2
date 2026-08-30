export function splitAuthors(authorField) {
	if (!authorField) return [];
	if (Array.isArray(authorField)) return authorField.flatMap(splitAuthors);

	const raw = String(authorField).trim();
	if (!raw) return [];

	// Prefer explicit semicolons; they are the canonical separator in this project.
	if (raw.includes(";")) {
		return raw
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean);
	}

	// Handle natural-language separators used in some archive files.
	let normalized = raw;
	if (/,\s*(?:and|AND|&)\s+/i.test(normalized)) {
		// Oxford-comma style lists: "A, B, and C"
		normalized = normalized.replace(/,\s*(?:and|AND|&)\s+/gi, "; ");
		normalized = normalized.replace(/,\s*/g, "; ");
	} else if (/\s+(?:and|AND|&)\s+/i.test(normalized)) {
		// Two-author style: "A and B"
		normalized = normalized.replace(/\s+(?:and|AND|&)\s+/gi, "; ");
	} else if ((normalized.match(/,/g) || []).length >= 2) {
		// Fallback for comma-delimited lists without a conjunction.
		normalized = normalized.replace(/,\s*/g, "; ");
	}

	return normalized
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * Several contributors are bylined more than one way across the archive
 * ("Jason Alvis" and "Jason W. Alvis" are the same person). Left alone, each
 * spelling builds its own author page holding a fraction of their work, so we
 * fold every variant onto one canonical slug -- the form with the middle
 * initial. Article front matter keeps whatever byline the issue printed; only
 * the slug is normalized.
 */
const CANONICAL_SLUGS = new Map([
	["victor-e-taylor", "victor-taylor"],
	["christopher-demuth-rodkey", "christopher-d-rodkey"],
	["jason-alvis", "jason-w-alvis"],
	["roger-green", "roger-k-green"],
	["rodger-k-green", "roger-k-green"],
]);

export function authorSlug(name) {
	if (!name) return "";
	let value = String(name).trim();
	if (!value) return "";

	// Normalize and strip diacritics.
	value = value.normalize("NFKD");

	// Handle a few common non-diacritic latin characters/ligatures.
	value = value
		.replace(/ß/g, "ss")
		.replace(/Æ/g, "AE")
		.replace(/æ/g, "ae")
		.replace(/Œ/g, "OE")
		.replace(/œ/g, "oe")
		.replace(/Ø/g, "O")
		.replace(/ø/g, "o")
		.replace(/Ð/g, "D")
		.replace(/ð/g, "d")
		.replace(/Þ/g, "Th")
		.replace(/þ/g, "th")
		.replace(/Ł/g, "L")
		.replace(/ł/g, "l");

	value = value.replace(/[\u0300-\u036f]/g, "");
	value = value.toLowerCase();

	// Only keep the 26 english letters; everything else becomes a hyphen.
	value = value.replace(/[^a-z]+/g, "-");
	value = value.replace(/-+/g, "-").replace(/^-|-$/g, "");
	return CANONICAL_SLUGS.get(value) || value;
}
