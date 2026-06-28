/**
 * WAF module — shared between jcrt-v2 (jcrt.org) Cloudflare Worker instances.
 * Keep in sync with jcrt-files/src/waf.js.
 *
 * Exports
 * ───────
 *   isTrustedOrigin(origin)          → boolean
 *   wafInspect(request)              → { blocked, reason, status }
 *   blockResponse(status, reason)    → Response
 *   setCorsHeaders(headers, origin)  → void
 *   TRUSTED_ORIGIN_RE                regex
 *   INDEXING_BOT_RE                  regex
 */

// ─── Trusted domain family ────────────────────────────────────────────────────

export const TRUSTED_ORIGIN_RE =
  /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?(?:jcrt\.org|thenewpolis\.com|thewhitestonefoundation\.org|esthesis\.org)(?::\d{1,5})?$/i;

export function isTrustedOrigin(origin) {
  return !!origin && TRUSTED_ORIGIN_RE.test(origin);
}

// ─── Known indexing bots ──────────────────────────────────────────────────────

export const INDEXING_BOT_RE =
  /googlebot|google-extended|adsbot-google|googleother|claudebot|claude-searchbot|anthropic-ai|chatgpt-user|oai-searchbot|gptbot|bingbot|msnbot|applebot|baiduspider|duckassistbot|duckduckbot|bytespider|perplexitybot|ccbot/i;

// ─── Malicious scanner / exploit-tool User-Agents ────────────────────────────

const MALICIOUS_UA_RE =
  /sqlmap|nikto|nmap|masscan|nuclei|nessus|openvas|acunetix|qualys|burp[\s-]?suite|zaproxy|havij|pangolin|w3af|skipfish|dirbuster|gobuster|wfuzz|ffuf|hydra|medusa|metasploit|msfconsole|armitage|meterpreter|empire|cobalt[\s-]?strike|beef(?:xss)?|xsser|commix|wpscan|joomscan|drupwn|arachni|webscarab|paros|ratproxy|grabber|vega|wikto|libwhisker|httrack|webzip|teleport[\s-]?pro|offline[\s-]?explorer|siteripper/i;

// ─── Attack signature patterns ────────────────────────────────────────────────

const PATH_TRAVERSAL_RE =
  /(?:\.\.\/|\.\.\\|%2e%2e(?:%2f|\/)|%252e%252e(?:%252f|\/)|\.%2e\/|%2e\.\/)/i;

const NULL_BYTE_RE = /%00|\x00/;

const SQLI_RE =
  /(?:union[\s+]+(?:all[\s+]+)?select|exec[\s(]+['"]|xp_cmdshell|information_schema\s*\.|sys\.(?:tables|columns|objects)|;\s*(?:drop|truncate|delete)\s+(?:table|database|schema)\b|'\s*or\s*'1'\s*=\s*'1|--\s+)/i;

const XSS_RE =
  /(?:<\s*script[^>]*>|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|on(?:error|load|click|mouse(?:over|out|move|down|up)|key(?:down|up|press)|focus|blur|change|submit|reset|unload|abort|drag|drop|copy|cut|paste|wheel|touch|pointer|animation|transition)\s*=|<\s*(?:iframe|object|embed|applet)[^>]*>)/i;

const SHELL_INJECT_RE =
  /(?:;\s*(?:cat|ls|pwd|id|whoami|uname|ps\s+-|netstat|wget\s|curl\s|bash\s|sh\s|cmd\.exe|powershell)\b|`[^`]{1,200}`|\$\([^)]{1,200}\)|\|\s*(?:bash|sh|cmd|powershell)\b)/i;

// ─── WAF engine ───────────────────────────────────────────────────────────────

/**
 * @param {Request} request
 * @returns {{ blocked: boolean, reason?: string, status?: number }}
 */
export function wafInspect(request) {
  const ua = request.headers.get('User-Agent') ?? '';

  if (MALICIOUS_UA_RE.test(ua)) {
    return { blocked: true, reason: 'malicious-ua', status: 403 };
  }

  const url     = new URL(request.url);
  const rawPath = url.pathname;
  const decoded = (() => { try { return decodeURIComponent(rawPath); } catch { return rawPath; } })();
  const query   = url.search;

  if (PATH_TRAVERSAL_RE.test(rawPath) || PATH_TRAVERSAL_RE.test(decoded)) {
    return { blocked: true, reason: 'path-traversal', status: 400 };
  }

  if (NULL_BYTE_RE.test(rawPath) || NULL_BYTE_RE.test(query)) {
    return { blocked: true, reason: 'null-byte', status: 400 };
  }

  if (SQLI_RE.test(decoded) || SQLI_RE.test(query)) {
    return { blocked: true, reason: 'sql-injection', status: 400 };
  }

  if (XSS_RE.test(decoded) || XSS_RE.test(query)) {
    return { blocked: true, reason: 'xss', status: 400 };
  }

  if (query && SHELL_INJECT_RE.test(query)) {
    return { blocked: true, reason: 'shell-injection', status: 400 };
  }

  return { blocked: false };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/** @param {number} status  @param {string} reason  @returns {Response} */
export function blockResponse(status, reason) {
  return new Response(
    JSON.stringify({ error: 'Blocked', reason }),
    {
      status,
      headers: {
        'Content-Type':   'application/json; charset=utf-8',
        'X-Block-Reason': reason,
        'Cache-Control':  'no-store',
      },
    },
  );
}

/** @param {Headers} headers  @param {string} origin */
export function setCorsHeaders(headers, origin) {
  headers.set('Access-Control-Allow-Origin',      origin);
  headers.set('Access-Control-Allow-Methods',     'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
  headers.set('Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, Accept-Language, X-Requested-With, ' +
    'X-Bot-Allowed, X-Bot-Verified, X-Bot-Name');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age',           '86400');
  headers.set('Vary',                             'Origin');
}
