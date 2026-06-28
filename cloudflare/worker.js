/**
 * Cloudflare Worker — WAF Security Gateway for jcrt.org
 *
 * Sits in front of the Netlify-hosted jcrt.org site.  When Cloudflare DNS is
 * orange-clouded for jcrt.org, this Worker intercepts every request before it
 * reaches Netlify, applies WAF checks, then proxies clean traffic through.
 *
 * Netlify Edge Functions (oai-pmh, query-canonical-redirects, etc.) continue
 * to run on the Netlify side after this Worker passes the request through.
 *
 * Deploy:
 *   cd jcrt-v2
 *   wrangler deploy --config cloudflare/wrangler.toml
 */

import {
  isTrustedOrigin,
  wafInspect,
  blockResponse,
  setCorsHeaders,
  INDEXING_BOT_RE,
} from './waf.js';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);

export default {
  async fetch(request) {
    const method = request.method;
    const origin = request.headers.get('Origin') ?? '';
    const ua     = request.headers.get('User-Agent') ?? '';

    // ── Method guard ──────────────────────────────────────────────────────────
    if (!ALLOWED_METHODS.has(method)) {
      return blockResponse(405, 'method-not-allowed');
    }

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      if (!isTrustedOrigin(origin)) {
        return blockResponse(403, 'untrusted-origin-preflight');
      }
      const headers = new Headers({ 'Cache-Control': 'public, max-age=86400' });
      setCorsHeaders(headers, origin);
      return new Response(null, { status: 204, headers });
    }

    // ── Indexing bot fast-path (skip WAF) ────────────────────────────────────
    if (INDEXING_BOT_RE.test(ua)) {
      const response = await fetch(request);
      const mutable  = new Response(response.body, response);
      mutable.headers.set('x-bot-allowed', 'true');
      return mutable;
    }

    // ── WAF inspection ────────────────────────────────────────────────────────
    // Applied to all traffic including trusted origins, so a compromised
    // sibling site cannot attack jcrt.org through the cross-domain trust path.
    const waf = wafInspect(request);
    if (waf.blocked) return blockResponse(waf.status, waf.reason);

    // ── Proxy to Netlify origin ───────────────────────────────────────────────
    const response = await fetch(request);

    // Attach CORS headers for trusted cross-origin requests
    if (origin && isTrustedOrigin(origin)) {
      const mutable = new Response(response.body, response);
      setCorsHeaders(mutable.headers, origin);
      return mutable;
    }

    return response;
  },
};
