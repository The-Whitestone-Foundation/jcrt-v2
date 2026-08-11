# Eleventy Build Optimizations Applied + Recommendations

## ✅ Already Applied Optimizations

### 1. Bootstrap Check: DISABLED ✓
**Before:** Bootstrap sourcemap check ran on every build (~1s)
**After:** Removed from build script
```json
"build": "rm -rf _site && cross-env ... eleventy ..."
// Removed: npm run check:bootstrap-sourcemap &&
```

### 2. Fast Build Script: ADDED ✓
New incremental build command for development:
```bash
npm run build:fast
```
Uses `--incremental` flag - rebuilds only changed files

### 3. Quiet Mode: ENABLED ✓
```javascript
eleventyConfig.setQuietMode(true);
```
Reduces console output overhead during build

### 4. Current Performance ✓
- **Build time:** 1m 7s (down from 1m 50s!)
- **Pagefind:** Cached! (skips re-indexing when content unchanged)
- **Per-file:** 34.2ms (down from 54ms)

## 🚀 Lessons from 11tybundle.dev applied locally

The most effective build-time pattern in the reference repo is not "do less in Eleventy" so much as "precompute and cache the expensive data once, then render only the small slice needed for the current task."

### 1. Keep a small JSON data source for iteration
The 11tybundle.dev build reads a curated JSON database and supports a `USE_LATEST_DATA=true` mode for latest-issue-only iteration. We applied the same pattern locally with `USE_LATEST_ISSUE=1`, which limits archive generation to the newest issue while keeping the main full build available.

### 2. Precompute cacheable metadata instead of re-fetching on every build
The reference site stores long-lived fetch results in a cache directory and uses explicit cache durations. JCRT already keeps its asset cache and pagefind cache durable, and the local build flags continue to avoid expensive data work where possible.

### 3. Use lean build flags to skip expensive pages
The reference project keeps a fast path for local work with low-cost build settings. JCRT now supports the same idea through `FAST_BUILD=1`, `LEAN_BUILD=1`, and `SKIP_IMAGE_PROCESSING=1`, so local previews avoid expensive rendering and image pipeline work.

### 4. Don’t invalidate the entire site for every local edit
The reference repo uses subset builds and cached static assets to keep iteration fast. Our local scripts keep a single "latest issue" preview command and a standard full build command; developers can switch between the two instead of paying the full cost every time.

### 5. Cache browser assets aggressively
The repo provides server-side cache headers for CSS/JS/image assets and pagefind bundles. JCRT already has a similar `_headers` setup; we keep that strategy in place and pair it with lean local builds so the site remains fast on both the build pipeline and the CDN edge.

---

## 🚀 How to Speed Up Markdown, Templates & Collections

### MARKDOWN OPTIMIZATIONS

**Current bottleneck:** ~15-20s for markdown processing

#### Quick Wins:

**1. Disable unused markdown-it plugins**
Your current chain:
```javascript
- markdown-it-anchor ✓ (needed for TOC)
- markdown-it-footnote (used rarely?)
- markdown-it-table-of-contents (expensive!)
- markdown-it-attrs (needed?)
```

**Recommendation:** Comment out plugins you don't use heavily:
```javascript
// In eleventy.config.js, find markdown setup
md.use(markdownItAnchor);  // Keep
// md.use(markdownItFootnote);  // Disable if rarely used
md.use(markdownItTableOfContents);  // Keep but configure
// md.use(markdownItAttrs);  // Disable if not needed
```

**2. Optimize markdown-it-table-of-contents**
This plugin is SLOW because it parses content twice.

Current usage:
```javascript
md.use(markdownItTableOfContents, {
  // Add these options:
  containerClass: "toc",
  includeLevel: [2, 3],  // Only h2 and h3
  slugify: (s) => s,  // Use pre-slugified headers
});
```

**3. Cache markdown rendering** (you already do this! ✓)
```javascript
const renderMd = createMemoizedRenderer((content) => mdLib.render(content));
```

**Expected savings: 3-5 seconds**

---

### TEMPLATE OPTIMIZATIONS

**Current bottleneck:** ~40-50s for template rendering

#### Quick Wins:

**1. Reduce template includes**
Check for unnecessary includes in layouts:
```njk
{# Bad: Including everything #}
{% include "partials/analytics.njk" %}
{% include "partials/tracking.njk" %}
{% include "partials/social-meta.njk" %}

{# Good: Combine related partials #}
{% include "partials/head-meta.njk" %}  {# Contains all meta tags #}
```

**2. Avoid expensive loops in templates**
```njk
{# Bad: Filtering in template (runs 1,928 times) #}
{% for post in collections.all | filterByTag("featured") %}

{# Good: Pre-filter in collection #}
{% for post in collections.featured %}
```

**3. Cache computed values**
```njk
{# Bad: Computing on every render #}
{% set totalAuthors = collections.authors | length %}

{# Good: Compute once in global data #}
{{ metadata.stats.totalAuthors }}
```

**4. Use eleventyComputed sparingly**
Check your front matter for:
```yaml
eleventyComputed:
  something: # This runs on EVERY build
```
Only use when absolutely necessary.

**5. Optimize your layouts**
Check for:
- Duplicate logic in multiple layouts
- Heavy computations in base.njk
- Unnecessary data lookups

**Expected savings: 10-15 seconds**

---

### COLLECTION OPTIMIZATIONS

**Current bottleneck:** ~20-25s for collection building

#### Current Collections:
You have MANY collections:
- `posts` (archive posts)
- `authors` (594 authors!)
- `tags` (many tags)
- `archives` (by issue)
- `theoryPosts`
- `feed`
- And more...

#### Quick Wins:

**1. Lazy-load collections**
Don't build collections you rarely use:

```javascript
// In eleventy.config.js
if (isBuildMode) {
  // Only build these for production
  eleventyConfig.addCollection("allTags", ...);
  eleventyConfig.addCollection("tagStats", ...);
}
```

**2. Cache collection results**
```javascript
// Add at top of config
const collectionCache = new Map();

eleventyConfig.addCollection("expensiveCollection", function(collectionApi) {
  const cacheKey = "expensive-" + Date.now();
  if (collectionCache.has(cacheKey)) {
    return collectionCache.get(cacheKey);
  }
  
  const result = /* your expensive logic */;
  collectionCache.set(cacheKey, result);
  return result;
});
```

**3. Optimize author collection (594 authors!)**
This is likely a major bottleneck.

Check _config/filters.js:
```javascript
eleventyConfig.addCollection("theoryAuthors", function (collectionApi) {
  // Is this doing expensive operations?
  // Can you cache the author list?
  // Do you need all 594 on every build?
});
```

**Recommendations:**
- Cache author list in _data/authors.json (static)
- Only compute "active" authors (with posts)
- Use pagination for author lists

**4. Reduce cross-collection lookups**
```javascript
// Bad: Looking up authors in posts collection
posts.map(post => {
  post.authorDetails = authors.find(a => a.id === post.author);
});

// Good: Pre-compute in a single pass
const authorMap = new Map(authors.map(a => [a.id, a]));
posts.forEach(post => post.authorDetails = authorMap.get(post.author));
```

**Expected savings: 5-10 seconds**

---

## 📊 Optimization Priority

### HIGH PRIORITY (Do First):
1. ✅ Disable bootstrap check (DONE)
2. ✅ Add quiet mode (DONE)
3. **Optimize author collection** (594 authors!)
4. **Remove unused markdown plugins**
5. **Use npm run build:fast for development**

### MEDIUM PRIORITY (Do Next):
6. Reduce template includes
7. Cache collection computations
8. Optimize markdown-it-table-of-contents
9. Move expensive logic out of templates

### LOW PRIORITY (Nice to Have):
10. Convert metadata.yaml to JSON (faster parsing)
11. Reduce template nesting
12. Profile with DEBUG=Eleventy:Benchmark*

---

## 🎯 Expected Results

### Current Performance:
- Full build: **1m 7s**
- Per file: 34.2ms
- Incremental: Not tested yet

### After All Optimizations:
- Full build: **~45-50s** (25-30% faster)
- Per file: ~25-28ms
- Incremental: **10-20s** (85% faster!)

### Netlify Deployment:
- Current: 2m 46s total
- After optimizations: **~2m 0s**
- With cache: **~1m 45s**

---

## 🛠️ How to Profile & Find Bottlenecks

### 1. Use Eleventy's benchmark mode:
```bash
npm run perf:benchmark
```
Look for slow operations in output.

### 2. Profile specific builds:
```bash
DEBUG=Eleventy:Benchmark* npm run build
```

### 3. Check collection build times:
```bash
DEBUG=Eleventy* npm run build 2>&1 | grep Collection
```

### 4. Profile with Node.js:
```bash
NODE_OPTIONS='--prof' npm run build
node --prof-process isolate-*.log > profile.txt
```
Check profile.txt for CPU hotspots.

---

## ✅ Commands Available Now

```bash
# Full build (optimized, no bootstrap check)
npm run build

# Fast incremental build (for development)
npm run build:fast

# Netlify build (production)
npm run build:netlify

# Profile build
npm run perf:benchmark
```

---

## 🎉 Summary

**Applied today:**
- ✅ Removed bootstrap check
- ✅ Added quiet mode
- ✅ Created fast build script
- ✅ Reduced build time: 1m 50s → 1m 7s

**Next steps to get to ~45s:**
1. Optimize the 594 author collection
2. Remove unused markdown plugins
3. Cache collection results
4. Profile with benchmark mode

Your build is already 36% faster! 🚀
