/**
 * Netlify Edge Function: Allow Indexing Bot Traffic  (jcrt-v2 / jcrt.org)
 *
 * Runs first on every request.  When a known indexing bot is detected:
 *   - Verifies the connecting IP against the provider's published CIDR ranges
 *     (fetched once per function instance and held in module-level memory)
 *   - Injects x-bot-allowed / x-bot-name / x-bot-verified headers so downstream
 *     edge functions and the origin can trust the identity
 *
 * Non-bot traffic passes through untouched.
 *
 * Deploy: register in netlify.toml BEFORE other catch-all edge functions.
 */

// ─── CIDR helpers ─────────────────────────────────────────────────────────────

function ip4ToInt(ip) {
  return ip.split('.').reduce((n, o) => n * 256 + parseInt(o, 10), 0) >>> 0;
}

function cidr4Contains(cidr, ip) {
  const [net, bits] = cidr.split('/');
  const mask = bits ? (~0 << (32 - +bits)) >>> 0 : 0xffffffff;
  return (ip4ToInt(ip) & mask) === (ip4ToInt(net) & mask);
}

function ip6Expand(ip) {
  if (!ip.includes('::')) return ip;
  const [left, right] = ip.split('::');
  const l = left ? left.split(':') : [];
  const r = right ? right.split(':') : [];
  return [...l, ...Array(8 - l.length - r.length).fill('0'), ...r].join(':');
}

function ip6ToBigInt(ip) {
  return ip6Expand(ip)
    .split(':')
    .reduce((n, g) => (n << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
}

function cidr6Contains(cidr, ip) {
  const [net, bits] = cidr.split('/');
  const len  = BigInt(bits ?? 128);
  const mask = len === 0n ? 0n : (~0n << (128n - len)) & ((1n << 128n) - 1n);
  return (ip6ToBigInt(ip) & mask) === (ip6ToBigInt(net) & mask);
}

function cidrContains(cidr, ip) {
  try {
    return cidr.includes(':') ? cidr6Contains(cidr, ip) : cidr4Contains(cidr, ip);
  } catch {
    return false;
  }
}

// ─── Static fallback ranges ───────────────────────────────────────────────────

const STATIC_RANGES = {
  google:      ['66.249.64.0/19', '66.249.80.0/20', '2001:4860::/32'],
  bing:        ['157.55.39.0/24', '207.46.12.0/23', '40.77.167.0/24',
                '13.66.139.0/24', '13.67.10.16/28',  '52.167.144.0/24',
                '40.77.188.0/22', '40.77.202.0/24'],
  openai:      ['20.171.207.16/28', '52.230.152.0/22',
                '40.83.2.64/28',    '13.65.240.240/28'],
  apple:       ['17.0.0.0/8'],
  baidu:       ['180.76.15.0/24', '119.63.196.0/22', '106.12.185.0/24'],
  duckduckgo:  ['72.94.249.32/27'],
  bytedance:   ['121.14.0.0/16', '163.177.0.0/16'],
  commoncrawl: ['66.249.64.0/19'],
  anthropic:   [],
  perplexity:  [],
};

// ─── In-memory range cache (per function instance) ────────────────────────────
// Netlify Edge Functions have no persistent Cache API, so we cache in module
// scope for the lifetime of the isolate (typically minutes to hours).

const RANGE_SOURCES = [
  {
    key:   'google',
    url:   'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
    parse: (text) =>
      JSON.parse(text).prefixes
        .map(p => p.ipv4Prefix || p.ipv6Prefix)
        .filter(Boolean),
  },
  {
    key:   'openai',
    url:   'https://openai.com/gptbot-ranges.txt',
    parse: (text) =>
      text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')),
  },
];

// rangeMap is built once per isolate then reused
let rangeMapPromise = null;

function buildRangeMap() {
  if (rangeMapPromise) return rangeMapPromise;

  rangeMapPromise = (async () => {
    const map = structuredClone(STATIC_RANGES);
    await Promise.all(
      RANGE_SOURCES.map(async (src) => {
        try {
          const res = await fetch(src.url);
          if (!res.ok) return;
          const ranges = src.parse(await res.text());
          if (ranges?.length) map[src.key] = ranges;
        } catch {
          // Keep static fallback
        }
      }),
    );
    return map;
  })();

  return rangeMapPromise;
}

// ─── Bot registry ─────────────────────────────────────────────────────────────

const BOT_CONFIGS = [
  { name: 'Googlebot',        uaPattern: /googlebot|google-extended|adsbot-google|googleother/i, rangeKeys: ['google']      },
  { name: 'Claude-SearchBot', uaPattern: /claudebot|claude-searchbot|anthropic-ai/i,             rangeKeys: ['anthropic'],  uaOnly: true },
  { name: 'ChatGPT-User',     uaPattern: /chatgpt-user|oai-searchbot|gptbot/i,                   rangeKeys: ['openai']      },
  { name: 'BingBot',          uaPattern: /bingbot|msnbot/i,                                      rangeKeys: ['bing']        },
  { name: 'Applebot',         uaPattern: /applebot/i,                                            rangeKeys: ['apple']       },
  { name: 'Baiduspider',      uaPattern: /baiduspider/i,                                         rangeKeys: ['baidu']       },
  { name: 'DuckAssistBot',    uaPattern: /duckassistbot|duckduckbot/i,                           rangeKeys: ['duckduckgo']  },
  { name: 'Bytespider',       uaPattern: /bytespider/i,                                          rangeKeys: ['bytedance']   },
  { name: 'PerplexityBot',    uaPattern: /perplexitybot/i,                                       rangeKeys: ['perplexity'], uaOnly: true },
  { name: 'CCBot',            uaPattern: /ccbot/i,                                               rangeKeys: ['commoncrawl'] },
];

// ─── Edge function export ─────────────────────────────────────────────────────

export default async function allowIndexingBots(request, context) {
  const ua  = request.headers.get('user-agent') ?? '';
  const ip  = context.ip ?? '';
  const bot = BOT_CONFIGS.find(b => b.uaPattern.test(ua));

  if (!bot) return context.next();

  let verified = false;

  if (!bot.uaOnly && ip) {
    try {
      const rangeMap = await buildRangeMap();
      const ranges   = bot.rangeKeys.flatMap(k => rangeMap[k] ?? []);
      verified = ranges.length > 0 && ranges.some(cidr => cidrContains(cidr, ip));
    } catch {
      // Verification failure is non-fatal — still allow the bot through
    }
  }

  const modifiedReq = new Request(request, {
    headers: new Headers({
      ...Object.fromEntries(request.headers),
      'x-bot-allowed':  'true',
      'x-bot-name':      bot.name,
      'x-bot-verified':  verified ? 'true' : 'false',
    }),
  });

  return context.next(modifiedReq);
}
