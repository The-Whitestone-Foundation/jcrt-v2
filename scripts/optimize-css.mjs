import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dedup } from "css-dedup";
import { transform } from "lightningcss";

const CSS_FILES = ["_site/css/bs.css", "_site/css/index.css", "_site/css/font.css"];

export function optimizeCss(css, filename = "style.css") {
	const deduped = dedup(css, {
		from: filename,
		aggressive: false,
		savingsOnly: true,
	});
	const { code } = transform({
		filename,
		code: Buffer.from(deduped.css),
		minify: true,
	});

	return {
		css: code.toString(),
		applied: deduped.applied.length,
		skipped: deduped.skipped.length,
	};
}

export function optimizeFiles(files = CSS_FILES) {
	const outputs = files.map((file) => {
		const input = fs.readFileSync(file, "utf8");
		return { file, before: Buffer.byteLength(input), ...optimizeCss(input, file) };
	});

	for (const output of outputs) {
		fs.writeFileSync(output.file, output.css);
		const after = Buffer.byteLength(output.css);
		console.log(
			`[css:optimize] ${path.basename(output.file)}: ${output.before} -> ${after} bytes; ` +
			`${output.applied} safe merge(s), ${output.skipped} skipped`,
		);
	}

	return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		optimizeFiles();
	} catch (error) {
		console.error(`[css:optimize] ${error.message}`);
		process.exitCode = 1;
	}
}
