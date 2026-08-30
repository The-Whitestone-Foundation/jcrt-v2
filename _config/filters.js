import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";

export default function(eleventyConfig) {
    const isLeanBuild = Boolean(process.env.LEAN_BUILD);
    const SITE_SUFFIX = " | The Journal for Cultural and Religious Theory | JCRT";
    const SHORT_TITLE_MIN = 22;
    const DESCRIPTION_MIN = 70;
    const DEFAULT_DESCRIPTION = "The Journal for Cultural and Religious Theory is an open-access, peer-reviewed publication for scholarship in religion, culture, critical theory, philosophy, politics, and public life.";

    const normalizeText = (value) => String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

    const cleanTitle = (value) => {
        const variants = [
            " | The Journal for Cultural and Religious Theory | JCRT",
            " | Journal for Cultural and Religious Theory | JCRT",
            " | JCRT",
        ];
        let baseTitle = normalizeText(value);
        for (const variant of variants) {
            const pattern = new RegExp(`${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
            baseTitle = baseTitle.replace(pattern, "").trim();
        }
        return baseTitle;
    };

    const issueLabel = (volume, issue, season) => {
        const parts = [];
        if (volume && issue) parts.push(`Volume ${volume}, Issue ${issue}`);
        else if (volume) parts.push(`Volume ${volume}`);
        else if (issue) parts.push(`Issue ${issue}`);
        if (season) parts.push(String(season).trim());
        return parts.filter(Boolean).join(" ");
    };

    const pageContextLabel = (pageUrl = "", volume = "", issue = "", season = "") => {
        const url = String(pageUrl || "");
        if (url === "/" || url === "") return "Open Access Journal";
        if (url.startsWith("/archives/keywords/")) return "Archive Keyword";
        if (url.startsWith("/archives/")) {
            const label = issueLabel(volume, issue, season);
            return label ? `JCRT Archive ${label}` : "JCRT Archive";
        }
        if (url.startsWith("/authors/")) return "JCRT Contributor Profile";
        if (url.startsWith("/religioustheory/categories/")) return "Religious Theory Category";
        if (url.startsWith("/religioustheory/tags/")) return "Religious Theory Tag";
        if (url.startsWith("/religioustheory/posts/") || url.startsWith("/religioustheory/live/")) return "Religious Theory Article";
        if (url.startsWith("/religioustheory/")) return "Religious Theory Archive";
        if (url.startsWith("/blog/")) return "JCRT News";
        if (url.startsWith("/tags/")) return "JCRT Tag";
        return "JCRT";
    };

    const expandShortTitle = (value, pageUrl = "", author = "", volume = "", issue = "", season = "") => {
        const baseTitle = cleanTitle(value);
        const context = pageContextLabel(pageUrl, volume, issue, season);
        const authorText = normalizeText(author);
        const hasNamedAuthor = authorText
            && authorText.length > 2
            && !["editors", "editor", "editors_religioustheory"].includes(authorText.toLowerCase())
            && !/editors?$/i.test(authorText);
        if (!baseTitle || /^home$/i.test(baseTitle)) return "The Journal for Cultural and Religious Theory";
        if (/^jcrt$/i.test(baseTitle)) return "JCRT - Journal for Cultural and Religious Theory";
        if (/^blog$/i.test(baseTitle)) return "Religious Theory and JCRT News";
        if (/^archives?$/i.test(baseTitle)) return "JCRT Journal Archives";
        if (/^authors?$/i.test(baseTitle)) return "JCRT Contributor Profiles";
        if (baseTitle.length >= SHORT_TITLE_MIN) return baseTitle;
        if (pageUrl.startsWith("/authors/")) return `${baseTitle} - JCRT Contributor Profile`;
        if (hasNamedAuthor) {
            return `${baseTitle} by ${authorText}`;
        }
        return `${baseTitle} - ${context}`;
    };

    const sentenceCaseContext = (pageUrl = "", volume = "", issue = "", season = "") => {
        const context = pageContextLabel(pageUrl, volume, issue, season);
        return context.replace(/^JCRT /, "JCRT ").replace(/^Religious Theory /, "Religious Theory ");
    };

    const buildSeoDescription = (source, title, pageUrl = "", author = "", volume = "", issue = "", season = "", siteDescription = "") => {
        const candidate = normalizeText(source);
        if (candidate.length >= DESCRIPTION_MIN) return candidate.slice(0, 220).trim();

        const titleText = expandShortTitle(title, pageUrl, author, volume, issue, season);
        const rawTitleText = cleanTitle(title) || titleText;
        const authorText = normalizeText(author);
        const hasNamedAuthor = authorText
            && authorText.length > 2
            && !["editors", "editor", "editors_religioustheory"].includes(authorText.toLowerCase())
            && !/editors?$/i.test(authorText);
        const context = sentenceCaseContext(pageUrl, volume, issue, season);
        const issueText = issueLabel(volume, issue, season);
        let generated = "";

        if (String(pageUrl || "").startsWith("/authors/")) {
            generated = `Read the JCRT contributor profile for ${rawTitleText || "this author"}, including affiliated scholarship, archive appearances, and related work in cultural and religious theory.`;
        } else if (String(pageUrl || "").startsWith("/archives/") && issueText && /\/archives\/[^/]+\/$/.test(String(pageUrl || ""))) {
            generated = `Browse ${issueText} of the Journal for Cultural and Religious Theory, including peer-reviewed articles, issue materials, and archive resources from JCRT.`;
        } else if (String(pageUrl || "").startsWith("/archives/")) {
            generated = `Read ${rawTitleText}${hasNamedAuthor ? ` by ${authorText}` : ""} in the Journal for Cultural and Religious Theory archive, with article metadata, citations, and related issue resources.`;
        } else if (String(pageUrl || "").startsWith("/religioustheory/posts/") || String(pageUrl || "").startsWith("/religioustheory/live/")) {
            generated = `Read ${rawTitleText}${hasNamedAuthor ? ` by ${authorText}` : ""} in Religious Theory, the JCRT archive for essays, reviews, conversations, and critical scholarship on religion and culture.`;
        } else if (String(pageUrl || "").startsWith("/religioustheory/")) {
            generated = `Explore ${titleText}, part of Religious Theory at JCRT, with essays, reviews, categories, tags, and archived scholarship on religion, theory, and culture.`;
        } else if (String(pageUrl || "").startsWith("/blog/")) {
            generated = `Read ${titleText} from JCRT news and updates, including calls for papers, publication announcements, and scholarship in religion, culture, and theory.`;
        } else if (String(pageUrl || "").includes("/tags/") || String(pageUrl || "").includes("/categories/")) {
            generated = `Browse ${titleText} in the ${context}, collecting related JCRT scholarship, archive entries, and Religious Theory posts for readers and researchers.`;
        } else {
            generated = `${titleText} from the Journal for Cultural and Religious Theory, an open-access publication for scholarship in religion, culture, philosophy, critical theory, and public life.`;
        }

        const fallback = normalizeText(siteDescription) || DEFAULT_DESCRIPTION;
        return (normalizeText(generated).length >= DESCRIPTION_MIN ? normalizeText(generated) : fallback).slice(0, 220).trim();
    };
    // --- Date Filters ---
    eleventyConfig.addFilter("readableDate", (dateObj, format, zone) => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(new Date(dateObj), { zone: zone || "utc" }).toFormat(format || "dd LLLL yyyy");
    });

    eleventyConfig.addFilter("htmlDateString", (dateObj) => {
        if (!dateObj) return "";
        return DateTime.fromJSDate(new Date(dateObj), { zone: "utc" }).toFormat('yyyy-LL-dd');
    });
    
    eleventyConfig.addNunjucksFilter("limit", (arr, limit) => (arr || []).slice(0, limit));

    eleventyConfig.addFilter("head", (array, n) => {
        if (!Array.isArray(array) || array.length === 0) return [];
        if (n < 0) return array.slice(n);
        return array.slice(0, n);
    });

    // --- Utility Filters ---
    eleventyConfig.addFilter("min", (...numbers) => Math.min.apply(null, numbers));

    eleventyConfig.addFilter("getKeys", target => (target ? Object.keys(target) : []));

    const filterTagList = (tags) => {
        const excluded = new Set(["all", "posts", "authors", "nav", "theoryposts", "archives"]);
        const seen = new Set();

        return (tags || []).reduce((acc, tag) => {
            const trimmed = String(tag || "").trim();
            if (!trimmed) return acc;

            const normalized = trimmed.toLowerCase();
            if (excluded.has(normalized) || seen.has(normalized)) return acc;

            seen.add(normalized);
            acc.push(trimmed);
            return acc;
        }, []);
    };

    eleventyConfig.addFilter("filterTagList", filterTagList);

    eleventyConfig.addFilter("sortAlphabetically", (strings) =>
        [...(strings || [])].sort((a, b) =>
            String(a ?? "").localeCompare(String(b ?? ""))
        )
    );
    eleventyConfig.addFilter("seoTitle", (value, pageUrl = "", author = "", volume = "", issue = "", season = "") => {
        const baseTitle = expandShortTitle(value, pageUrl, author, volume, issue, season);
        if (!baseTitle) {
            return `The Journal for Cultural and Religious Theory | JCRT`;
        }
        return `${baseTitle}${SITE_SUFFIX}`;
    });
    eleventyConfig.addFilter("seoDescription", buildSeoDescription);
eleventyConfig.addFilter("validImage", function(imgUrl, fallback) {
    if (!imgUrl || imgUrl === "" || imgUrl === "null" || imgUrl === undefined) {
        return fallback;
    }
    return imgUrl;
});

eleventyConfig.addFilter("unique", function(array) {
    if (!Array.isArray(array)) return [];
    return [...new Set(array)];
});
    // --- Custom Business Logic Filters ---
    eleventyConfig.addFilter("filterByTag", (collection, tag) => {
        if (!tag || !collection) return collection;
        return collection.filter(item => {
            const tags = item.data.tags || [];
            return Array.isArray(tags) ? tags.includes(tag) : tags === tag;
        });
    });
// Every caller in content/sitemaps/ passes `page.inputPath` / `entry.inputPath` — a path
// string, not a date. `new Date("./content/...")` is NaN, so this used to fall through to
// `new Date()` and stamp every sitemap <lastmod> with the build timestamp. Resolve a path
// to its file mtime; only genuinely unresolvable input falls back to now.
const fileMtimeCache = new Map();

function statMtimeIso(candidate) {
  if (typeof candidate !== "string" || candidate === "") return null;
  if (fileMtimeCache.has(candidate)) return fileMtimeCache.get(candidate);

  let result = null;
  try {
    const stat = fs.statSync(path.resolve(process.cwd(), candidate));
    if (stat.isFile()) {
      result = new Date(stat.mtimeMs).toISOString();
    }
  } catch {
    result = null;
  }

  fileMtimeCache.set(candidate, result);
  return result;
}

// Reduce a URL to its registrable domain for display: subdomains, paths and query
// dropped — "https://profile.hcommons.org/members/kevg020/" renders as "hcommons.org".
// Non-http schemes (mailto:) return "" so templates can fall back to the item title.
const SECOND_LEVEL_TLDS = new Set(["co.uk", "ac.uk", "org.uk", "com.au", "co.jp", "co.nz", "com.br"]);
eleventyConfig.addFilter("mainDomain", (value) => {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const labels = url.hostname.replace(/^www\./, "").split(".");
    if (labels.length <= 2) return labels.join(".");
    const lastTwo = labels.slice(-2).join(".");
    return SECOND_LEVEL_TLDS.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
  } catch {
    return "";
  }
});

eleventyConfig.addFilter("lastModifiedDate", (dateObj) => {
  const date = new Date(dateObj);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  return statMtimeIso(dateObj) || new Date().toISOString();
});

eleventyConfig.addFilter("getAllTags", (collection) => {
  let tagSet = new Set();
  for (let item of collection) {
    (item.data.tags || []).forEach(tag => tagSet.add(tag));
  }
  return Array.from(tagSet);
});
eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return new Date().toISOString();
    return new Date(dateObj).toISOString();
});
    eleventyConfig.addFilter("postDate", (dateObj) => {
        return new Date(dateObj).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  });
  eleventyConfig.addFilter("currentYear", () => DateTime.now().toFormat("yyyy"));

eleventyConfig.addFilter("categoryTheory", function(posts) {
    let catSet = new Set();
    if (!Array.isArray(posts)) return [];
    
    posts.forEach(post => {
        
        const categories = post.data?.categories; 
        if (categories && Array.isArray(categories)) {
            categories.forEach(cat => {
                if (cat) catSet.add(cat);
            });
        }
    });
    return Array.from(catSet).sort();
});


eleventyConfig.addFilter("tagTheory", function(posts) {
    let tagSet = new Set();
    const excluded = new Set(["posts", "theoryposts", "all", "archives", "nav"]);
    if (!Array.isArray(posts)) return [];
    
    posts.forEach(post => {
        
        const tags = post.data?.tags;
        if (tags && Array.isArray(tags)) {
            tags.forEach(tag => {
                const trimmed = String(tag || "").trim();
                if (!trimmed) return;
                const normalized = trimmed.toLowerCase();

                if (!excluded.has(normalized)) {
                    tagSet.add(trimmed);
                }
            });
        }
    });
    return Array.from(tagSet).sort();
});

eleventyConfig.addFilter("hasTagTheory", function(post, targetTag) {
    const tags = post?.data?.tags || [];
    return Array.isArray(tags) && tags.includes(targetTag);
});

eleventyConfig.addFilter("hasCategoryTheory", function(post, targetCategory) {
    const categories = post?.data?.categories || [];
    return Array.isArray(categories) && categories.includes(targetCategory);
});
  
if (!isLeanBuild) {
eleventyConfig.addCollection("issueList", function(collectionApi) {
    const allEntries = collectionApi.getAll();
    const issues = [];
    const archivePath = "/archives/"; 

    allEntries.forEach(entry => {
        if (entry.inputPath.includes(archivePath) && entry.inputPath.endsWith('/index.njk')) {
            const parts = entry.inputPath.split('/');
            if (parts.length > 3) { 
                const season = String(entry.data.season || "0").padStart(3, '0');
                const issue = String(entry.data.issue || "0").padStart(3, '0');
                issues.push({
                    entry: entry,
                    sortKey: `${season}.${issue}`
                });
            }
        }
    });

    return issues.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
});

eleventyConfig.addCollection("onlyIssues", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/archives/**/index.njk").sort((a, b) => {
        const aKey = `${String(a.data.season).padStart(3, '0')}.${String(a.data.issue).padStart(3, '0')}`;
        const bKey = `${String(b.data.season).padStart(3, '0')}.${String(b.data.issue).padStart(3, '0')}`;
        return bKey.localeCompare(aKey);
    });
});
}
if (!isLeanBuild) {
eleventyConfig.addCollection("archivesSorted", function(collectionApi) {
  const items = collectionApi.getFilteredByGlob("content/archives/**/*.md");

  return items.sort((a, b) => {
    const vA = a.data.volume || 0;
    const iA = a.data.issue || 0;
    const vB = b.data.volume || 0;
    const iB = b.data.issue || 0;

    const aKey = `${String(vA).padStart(3, '0')}.${String(iA).padStart(3, '0')}`;
    const bKey = `${String(vB).padStart(3, '0')}.${String(iB).padStart(3, '0')}`;
    
    return bKey.localeCompare(aKey);
  });
});
}

};
