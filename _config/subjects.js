export const SUBJECT_PRIORITY = Object.freeze({
	datacite: 0,
	fair: 1,
	FAST: 2,
	Homosaurus: 3,
});

export function asList(value) {
	if (!value) return [];
	return (Array.isArray(value) ? value : String(value).split(","))
		.map((item) => String(item || "").trim())
		.filter(Boolean);
}

export function controlledSubjects(value) {
	if (!Array.isArray(value)) return [];
	const seen = new Set();
	return value
		.filter((subject) => subject && typeof subject === "object" && subject.label)
		.map((subject) => ({
			label: String(subject.label).trim(),
			scheme: String(subject.scheme || "").trim(),
			identifier: String(subject.identifier || "").trim(),
			uri: String(subject.uri || "").trim(),
			category: String(subject.category || "").trim(),
		}))
		.filter((subject) => {
			const key = `${subject.scheme.toLowerCase()}\0${subject.label.toLowerCase()}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) =>
			(SUBJECT_PRIORITY[a.scheme] ?? 99) - (SUBJECT_PRIORITY[b.scheme] ?? 99) ||
			a.label.localeCompare(b.label),
		);
}

export function subjectLabels(data) {
	const legacy = [
		...asList(data?.keywords),
		...asList(data?.categories),
		...asList(data?.tags).filter((tag) => tag !== "theoryPosts"),
	];
	return [...new Set([...legacy, ...controlledSubjects(data?.subjects).map((subject) => subject.label)])];
}
