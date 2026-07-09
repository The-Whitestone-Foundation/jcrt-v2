const FILES_BASE_URL = "https://files.jcrt.org";

const CITATION_ALIASES = new Map([
	["/citations/archives/01.2/vahanian.csl.json", "/citations/archives/01.2/nvahanian.csl.json"],
	["/citations/archives/01.2/vahanian.ris", "/citations/archives/01.2/nvahanian.ris"],
	["/citations/archives/08.3/Eisenstadt.csl.json", "/citations/archives/08.3/eisenstadt.csl.json"],
	["/citations/archives/08.3/Eisenstadt.ris", "/citations/archives/08.3/eisenstadt.ris"],
	["/citations/archives/08.3/Lupton.csl.json", "/citations/archives/08.3/lupton.csl.json"],
	["/citations/archives/09.1/Hyman.csl.json", "/citations/archives/09.1/hyman.csl.json"],
	["/citations/archives/09.1/Large.ris", "/citations/archives/09.1/large.ris"],
	["/citations/archives/09.1/Malabou.csl.json", "/citations/archives/09.1/malabou.csl.json"],
	["/citations/archives/09.1/Pound.csl.json", "/citations/archives/09.1/pound.csl.json"],
	["/citations/archives/16.1/Carson.ris", "/citations/archives/16.1/carson.ris"],
	["/citations/archives/16.1/InterviewUlmer.ris", "/citations/archives/16.1/interviewulmer.ris"],
	["/citations/archives/16.1/Obrien.ris", "/citations/archives/16.1/obrien.ris"],
	["/citations/archives/16.2/Dubilet.csl.json", "/citations/archives/16.2/dubilet.csl.json"],
	["/citations/archives/16.2/Intro-Marovich.csl.json", "/citations/archives/16.2/intro-marovich.csl.json"],
	["/citations/archives/17.1/Caputo.csl.json", "/citations/archives/17.1/caputo.csl.json"],
	["/citations/archives/17.1/Dean.csl.json", "/citations/archives/17.1/dean.csl.json"],
	["/citations/archives/17.1/Muraca.csl.json", "/citations/archives/17.1/muraca.csl.json"],
	["/citations/archives/17.1/Raschke.csl.json", "/citations/archives/17.1/raschke.csl.json"],
	["/citations/archives/17.2/OMurchadha.ris", "/citations/archives/17.2/Omurchadha.ris"],
	["/citations/archives/17.2/Rivera.ris", "/citations/archives/17.2/rivera.ris"],
	["/citations/archives/17.3/Beddard.csl.json", "/citations/archives/17.3/beddard.csl.json"],
	["/citations/archives/17.3/Yonker.ris", "/citations/archives/17.3/yonker.ris"],
	["/citations/archives/18.1/Bios.csl.json", "/citations/archives/18.1/bios.csl.json"],
	["/citations/archives/18.1/Pederson.csl.json", "/citations/archives/18.1/pederson.csl.json"],
	["/citations/archives/18.1/Richard.ris", "/citations/archives/18.1/richard.ris"],
	["/citations/archives/18.2/DeRoo.ris", "/citations/archives/18.2/deroo.ris"],
	["/citations/archives/18.2/Pessin.ris", "/citations/archives/18.2/pessin.ris"],
	["/citations/archives/18.2/Stanton.csl.json", "/citations/archives/18.2/stanton.csl.json"],
	["/citations/archives/18.3/Murphy.ris", "/citations/archives/18.3/murphy.ris"],
	["/citations/archives/19.1/Cobb.csl.json", "/citations/archives/19.1/cobb.csl.json"],
	["/citations/archives/19.1/Hass.ris", "/citations/archives/19.1/hass.ris"],
	["/citations/archives/19.1/Quasha.csl.json", "/citations/archives/19.1/quasha.csl.json"],
	["/citations/archives/19.2/Hackett.csl.json", "/citations/archives/19.2/hackett.csl.json"],
	["/citations/archives/19.2/Murphy.csl.json", "/citations/archives/19.2/murphy.csl.json"],
	["/citations/archives/19.3/8-Weidner.csl.json", "/citations/archives/19.3/8-weidner.csl.json"],
	["/citations/archives/20.1/Conroy.csl.json", "/citations/archives/20.1/conroy.csl.json"],
	["/citations/archives/21.2/Taylor.ris", "/citations/archives/21.2/taylor.ris"],
	["/citations/archives/21.3/Bradley5.csl.json", "/citations/archives/21.3/bradley5.csl.json"],
	["/citations/archives/22.1/Grane.ris", "/citations/archives/22.1/grane.ris"],
	["/citations/archives/22.1/Hujing.ris", "/citations/archives/22.1/hujing.ris"],
	["/citations/archives/22.1/Magnasco.csl.json", "/citations/archives/22.1/magnasco.csl.json"],
	["/citations/archives/22.1/Patry.csl.json", "/citations/archives/22.1/patry.csl.json"],
	["/citations/archives/22.1/Quell.csl.json", "/citations/archives/22.1/quell.csl.json"],
	["/citations/archives/22.1/Wurts.csl.json", "/citations/archives/22.1/wurts.csl.json"],
	["/citations/archives/23.1/Grane.csl.json", "/citations/archives/23.1/grane.csl.json"],
	["/citations/archives/24.1/Grane.csl.json", "/citations/archives/24.1/grane.csl.json"],
	["/citations/archives/24.1/Grane.ris", "/citations/archives/24.1/grane.ris"],
	["/citations/archives/25.1/brett-and-hill.ris", "/citations/archives/25.1/postscript.ris"],
	["/citations/archives/25.1/d_errico.csl.json", "/citations/archives/25.1/derrico.csl.json"],
]);

function safeDecodePath(pathname) {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

function normalizePathname(pathname) {
	return safeDecodePath(pathname)
		.replace(/\u00A0/g, " ")
		.replace(/\/{2,}/g, "/")
		.trim();
}

function redirectToFiles(pathname) {
	const target = new URL(FILES_BASE_URL);
	target.pathname = pathname;
	target.search = "";
	const headers = new Headers({ location: target.toString() });
	if (/\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(pathname)) {
		headers.set("x-robots-tag", "noindex");
	}
	return new Response(null, { status: 301, headers });
}

function gone() {
	return new Response("Gone", {
		status: 410,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"x-robots-tag": "noindex",
		},
	});
}

export default async (request, context) => {
	const method = String(request.method || "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return context.next();

	const requestUrl = new URL(request.url);
	const pathname = normalizePathname(requestUrl.pathname);

	if (pathname === "/images" || pathname === "/images/") {
		return gone();
	}

	if (pathname === "/images/logos/site.webmanifest") {
		return context.next();
	}

	if (pathname.startsWith("/citations/")) {
		return redirectToFiles(CITATION_ALIASES.get(pathname) || pathname);
	}

	if (pathname.startsWith("/images/") || pathname.startsWith("/docs/")) {
		return redirectToFiles(pathname);
	}

	return context.next();
};
