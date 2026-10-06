// The website check: opens one business website and reports whether it's a real website at all,
// and what the lead score and the audit need to know about it.
//
// First, whether it's a website: a Facebook or booking page, a domain that's for sale or parked
// (often an expired one a reseller bought), an expired or unregistered domain, a placeholder
// ("coming soon", a host's default page, "account suspended"), or a page that never names the
// business. Then, for a real site: phones, booking, https, copyright year, search basics (title,
// description, hidden from Google, business details for Google, the business's area and phone on
// the page), accessibility basics, the tools it already uses and any email address on the page.
//
// It runs in a Cloudflare Worker on the free plan, and two limits shape it (see README.md):
//   - 50 subrequests per call. Redirects are followed by hand, at most MAX_HOPS of them, so one site
//     costs at most 1 + 4 redirects + 2 for the registry lookup.
//   - 10 ms of CPU per call. A page is read up to SITE_MAX_BYTES, and every vendor signature is found
//     in one pass of one pattern over the page's linked hosts, not the whole page.
import {
  PROFILE_HOSTS, MARKETS, SALE_HOSTS, SALE_WORDS, HOST_HOMES, FREE_HOSTS, TOOLS, EXTRAS, BUILDERS, PARKED_CODE, PARKED_WORDS,
  PLACEHOLDERS, PLACEHOLDER_RE, SOON, BIZ_TYPES, COMMON_WORDS, FILLER, BAD_EMAIL,
} from './signatures.js';
import { registrable, withDomain } from './domain.js';
import { discard, readCapped } from './http.js';

export const SITE_TIMEOUT_MS = 7000;
export const SITE_MAX_BYTES = 120000;
export const MAX_HOPS = 4;
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; LeadFinderCheck/1.0)';

// ---------------------------------------------------------------- matching many strings at once

// isHost('m.facebook.com', 'facebook.com') is true; isHost('notfacebook.com', 'facebook.com') isn't.
const isHost = (host, d) => host === d || host.endsWith('.' + d);
// Many strings found in one pass: a lookahead, so overlapping ones all count ("img1.wsimg.com" and
// "wsimg.com/parking-lander" in the same link), longest first where two start at the same place.
// One pattern instead of one per signature also keeps the first check in a fresh worker inside
// the CPU limit.
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n');
export const finder = (list) =>
  new RegExp(`(?=(${[...new Set(list)].sort((a, b) => b.length - a.length).map(escapeRe).join('|')}))`, 'g');
export const findAll = (text, re) => {
  const out = new Set();
  for (const m of text.matchAll(re)) out.add(m[1]);
  return out;
};
// Every tool, extra, builder and parking signature, compiled once per worker.
let linkPattern = null;
export const LINK_SIGNATURES = [
  ...TOOLS.flatMap((t) => t[1]), ...EXTRAS.flatMap((e) => e[2]), ...BUILDERS.flatMap((b) => b[1]), ...PARKED_CODE.flatMap((c) => c[0]),
];
const linkSignatures = () => linkPattern || (linkPattern = finder(LINK_SIGNATURES));

// ---------------------------------------------------------------- names and trades

// The distinctive words of a business name: what its own website should mention somewhere.
const nameTokens = (name) =>
  [...new Set(String(name || '').split(/[^a-z0-9'’]+/).map((w) => w.replace(/['’]s?$/, '')).filter((w) => w.length >= 3 && !COMMON_WORDS.has(w)))].slice(0, 6);
// The trade in a name ("auto", "repair", "grooming"), for telling a rebranded site from someone else's.
const tradeWords = (name) => String(name || '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && COMMON_WORDS.has(w) && !FILLER.has(w));

// ---------------------------------------------------------------- the check

export function profileOf(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const hit = PROFILE_HOSTS.find(([ds]) => ds.some((d) => isHost(host, d)));
  return hit ? hit[1] : '';
}

// A redirect to a marketplace, a parking service or a host's homepage: not a website.
export function notASiteAt(hostname, from, path = '') {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  path = path.toLowerCase();
  const market = MARKETS.find(([ds]) => ds.some((d) => isHost(host, d)));
  if (market) return { kind: 'parked', by: market[1], sale: SALE_HOSTS.has(market[1]) || /for-?sale|buy/.test(path) };
  if (HOST_HOMES[host]) return { kind: 'placeholder', reason: 'host home', by: HOST_HOMES[host] };
  // ww12.example.com is how ad-parking services serve a parked domain
  if (/^ww\d+\./.test(host) && registrable(host) === registrable(from)) return { kind: 'parked', by: '', sale: false };
  return null;
}

// raw: the website as listed ("example.com", "http://www.example.com/home").
// hint: { name, places, phone }, lowercased, only ever searched for on the page (see cleanHint).
// Returns { url: raw, kind, ... }. kind is one of: site, profile, parked, placeholder, blocked, down,
// unregistered, expired, error.
export async function checkSite(raw, hint, { userAgent = DEFAULT_USER_AGENT } = {}) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return { url: raw, kind: 'error', error: 'not a valid address' };
  }
  if (!/^https?:$/.test(u.protocol)) return { url: raw, kind: 'error', error: 'not a web address' };
  const profile = profileOf(u.hostname);
  if (profile) return { url: raw, kind: 'profile', profile };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SITE_TIMEOUT_MS);
  const started = Date.now();
  let result = null;
  try {
    let url = u.toString();
    let res;
    // Redirects are followed by hand: each one is a subrequest, so the chain is capped, and a hop to
    // a marketplace, parking service or profile ends the check without loading that page.
    for (let hop = 0; ; hop++) {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : '';
      if (!loc) break;
      discard(res);
      if (hop >= MAX_HOPS) return { url: raw, kind: 'down', error: 'it redirects in a loop' };
      let next;
      try {
        next = new URL(loc, url);
      } catch {
        next = null;
      }
      if (!next || !/^https?:$/.test(next.protocol)) return { url: raw, kind: 'down', error: 'it redirects to a broken address' };
      const moved = profileOf(next.hostname);
      if (moved) return { url: raw, kind: 'profile', profile: moved };
      const elsewhere = notASiteAt(next.hostname, u.hostname, next.pathname + next.search);
      if (elsewhere) {
        result = { url: raw, ...elsewhere, finalUrl: next.toString() };
        break;
      }
      url = next.toString();
    }
    if (!result && res.status >= 400) {
      discard(res);
      // 401/403/429 is usually a bot filter, not a broken site: don't call it broken.
      result = [401, 403, 429].includes(res.status)
        ? { url: raw, kind: 'blocked', status: res.status }
        : { url: raw, kind: 'down', status: res.status, error: `the page answers with error ${res.status}` };
    }
    if (!result) {
      const host = new URL(url).hostname.toLowerCase();
      const html = await readCapped(res, SITE_MAX_BYTES);
      result = {
        url: raw, kind: 'site', finalUrl: url, https: url.startsWith('https:'), ms: Date.now() - started,
        ...inspect(html, hint, host, res.headers.get('x-robots-tag') || ''),
      };
      if (result.page) {
        // a for-sale or placeholder page
        Object.assign(result, result.page);
        delete result.page;
      }
      const free = FREE_HOSTS.find(([ds]) => ds.some((d) => host.endsWith('.' + d)));
      if (free) result.freeHost = free[1];
      if (registrable(host) !== registrable(u.hostname)) result.movedTo = host.replace(/^www\./, '');
    }
  } catch (e) {
    result = { url: raw, kind: 'down', error: e && e.name === 'AbortError' ? 'it did not load within 7 seconds' : 'it could not be reached' };
  } finally {
    clearTimeout(timer);
  }
  return result.kind === 'site' ? result : withDomain(result, u.hostname);
}

// What a page says about the business. html: up to SITE_MAX_BYTES of it; host: where it ended up.
export function inspect(html, hint, host, robotsHeader) {
  const low = html.toLowerCase();

  // Every linked host (plus the start of its path), pulled out in one pass. Matching tool and
  // builder signatures against this short list instead of the whole page keeps a check around
  // a millisecond of CPU; the free plan allows 10 per call. \/\/ catches links inside JSON.
  const seen = new Set();
  for (const m of low.matchAll(/(?:\/\/|\\\/\\\/)([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:(?:\/|\\\/)[\w.-]{1,30})?)/g)) {
    if (seen.size < 2000) seen.add(m[1].replace(/\\\//g, '/'));
  }
  if (low.includes('/wp-content/')) seen.add('wp-content');
  const hosts = '\n' + [...seen].join('\n') + '\n';
  const hits = findAll(hosts, linkSignatures());
  const linked = (sigs) => sigs.some((x) => hits.has(x));
  const title = html.match(/<title[^>]*>([^<]{0,200})/i);
  const titleText = title ? decodeEntities(title[1]).trim() : '';

  const page = notASite(low, linked, titleText, host);
  if (page) return { bytes: html.length, title: titleText, page };

  // Email addresses: mailto links, then anything around an @ (anchoring on the @ is far cheaper
  // than scanning every word for a possible address).
  const emails = new Set();
  const add = (e) => {
    e = decodeSafe(e).toLowerCase().trim();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e)) emails.add(e);
  };
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) add(m[1]);
  let n = 0;
  for (const m of html.matchAll(/@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    if (++n > 300 || emails.size >= 3) break;
    let j = m.index;
    while (j > 0 && m.index - j < 64 && /[A-Za-z0-9._%+-]/.test(html[j - 1])) j--;
    if (j < m.index) add(html.slice(j, m.index) + m[0]);
  }

  const years = [...low.matchAll(/(?:©|&copy;|&#169;|copyright)[^<]{0,40}?((?:19|20)\d{2})(?:\s*(?:-|–|&ndash;|to)\s*((?:19|20)\d{2}))?/g)]
    .flatMap((m) => [m[1], m[2]])
    .filter(Boolean)
    .map(Number);

  // Search basics, from the <head>: the description Google shows under the name, and a "noindex"
  // that keeps the site out of Google altogether (builders leave it on by mistake).
  const end = low.indexOf('</head>');
  const head = low.slice(0, end > 0 ? Math.min(end, 60000) : 20000);
  let desc = 0, viewport = false, noZoom = false, og = false, noindex = /noindex/.test(String(robotsHeader).toLowerCase());
  for (const m of head.matchAll(/<meta\b[^>]*>/g)) {
    const tag = m[0], key = (tag.match(/\b(?:name|property)\s*=\s*["']?([\w:.-]+)/) || [])[1];
    if (!key) continue;
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/), val = c ? c[1] ?? c[2] ?? c[3] ?? '' : '';
    if (key === 'description') desc = decodeEntities(val).trim().length;
    else if (key === 'robots' || key === 'googlebot') noindex = noindex || val.includes('noindex');
    else if (key === 'viewport') {
      viewport = true;
      noZoom = /user-scalable\s*=\s*(?:no|0)\b|maximum-scale\s*=\s*1(?:\.0*)?(?![.\d])/.test(val); // zooming blocked: an accessibility failure
    } else if (key === 'og:title' || key === 'og:image') og = true;
  }
  let schema = low.includes('schema.org/localbusiness') || low.includes('schema.org/autorepair');
  for (let i = low.indexOf('application/ld+json'), k = 0; !schema && i >= 0 && k < 8; i = low.indexOf('application/ld+json', i + 19), k++) {
    schema = BIZ_TYPES.test(low.slice(i, i + 6000));
  }

  const extras = {};
  for (const [group, name, sigs] of EXTRAS) {
    if (linked(sigs) && !(extras[group] || []).includes(name)) (extras[group] = extras[group] || []).push(name);
  }
  if (!extras.analytics && (low.includes("fbq('init'") || low.includes('fbq("init"'))) extras.analytics = ['Meta Pixel'];
  if (!extras.form && low.includes('<form') && /<textarea|type=["']?(?:email|tel)\b|name=["']?(?:e-?mail|phone|message)\b/.test(low)) extras.form = ['form'];

  // The numbers the page's call buttons dial, so the audit can name one that isn't the listing's.
  const phones = [];
  for (const m of low.matchAll(/href\s*=\s*["']?tel:([^"'>]{7,40})/g)) {
    const d = decodeSafe(m[1]).split(/[;,pw]/)[0].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d.length === 10 && !phones.includes(d)) phones.push(d);
    if (phones.length >= 3) break;
  }
  // Images with no description at all (alt text): screen readers and image search skip them.
  // alt="" is a deliberate "decorative" mark, and 1-pixel tracking images don't count.
  let imgs = 0, noAlt = 0;
  for (const m of low.matchAll(/<img\b[^>]*>/g)) {
    if (/\b(?:width|height)\s*=\s*["']?1["'\s/>]/.test(m[0])) continue;
    imgs++;
    if (!/\balt\s*=/.test(m[0])) noAlt++;
    if (imgs >= 500) break;
  }
  // Template filler ("lorem ipsum") left where visitors can read it: in the page's text, not in a
  // script, a style or a tag's attributes.
  let filler = false;
  for (let i = low.indexOf('lorem ipsum'), k = 0; i >= 0 && k < 5 && !filler; i = low.indexOf('lorem ipsum', i + 11), k++) {
    filler = low.lastIndexOf('<script', i) <= low.lastIndexOf('</script', i) && low.lastIndexOf('<style', i) <= low.lastIndexOf('</style', i) &&
      low.lastIndexOf('<', i) < low.lastIndexOf('>', i);
  }

  // The business's own name, area and phone on the page (hints from the Lead Finder). "Not there"
  // only counts when the whole page was read; a cut-off page says nothing either way.
  const full = html.length < SITE_MAX_BYTES;
  const found = (hit) => (hit ? true : full ? false : null);
  let onPage = null;
  if (hint) {
    const tokens = nameTokens(hint.name), p = hint.phone;
    const phoneForms = p.length === 10 ? [p, ...['-', '.', ' ', ''].map((x) => p.slice(3, 6) + x + p.slice(6))] : [];
    const want = [...tokens, ...hint.places, ...phoneForms];
    const seenText = want.length ? findAll(low, finder(want)) : new Set(); // one pass for all of them
    const any = (list) => list.some((x) => seenText.has(x));
    onPage = {
      name: tokens.length ? found(any(tokens)) : null,
      area: hint.places.length ? found(any(hint.places)) : null,
      phone: phoneForms.length ? found(any(phoneForms)) : null,
    };
  }
  // a real page that never names the business or its trade: the domain may belong to someone else now
  const notMine = !!onPage && onPage.name === false && html.length > 3000 && !tradeWords(hint.name).some((w) => low.includes(w)) &&
    visible(low.slice(0, 80000)).length > 400;

  return {
    bytes: html.length,
    title: titleText,
    mobile: viewport || /<meta[^>]+name=["']?viewport/.test(low.slice(head.length)),
    tel: /href=["']?tel:/.test(low),
    bookingWords: /book (?:now|online|an appointment|appointment|a service|your (?:service|appointment|visit))|schedule (?:now|online|an appointment|appointment|service|your)|make an appointment|request (?:an )?appointment|reserve (?:now|online)|online booking/.test(low),
    tools: TOOLS.filter(([, sigs]) => linked(sigs)).map(([name, , suite]) => ({ name, suite })),
    builder: (BUILDERS.find(([, sigs]) => linked(sigs)) || [''])[0],
    year: years.length ? Math.max(...years) : null,
    thin: html.length < 1500,
    emails: [...emails].slice(0, 3),
    seo: { desc, noindex, schema, og, h1: low.includes('<h1') },
    extras,
    phones,
    imgs,
    noAlt,
    ...(noZoom ? { noZoom } : {}),
    ...(filler ? { filler } : {}),
    ...(onPage ? { onPage } : {}),
    ...(notMine ? { notMine } : {}),
    full,
  };
}

// A for-sale, parked or placeholder page instead of a website: { kind, by } or { kind, reason }.
export function notASite(low, linked, title, host) {
  const top = low.slice(0, 40000), small = low.length < 60000;
  const sale = small && SALE_WORDS.test(top);
  const code = PARKED_CODE.find(([sigs]) => linked(sigs));
  if (code) return { kind: 'parked', by: code[1], sale };
  // Google's ads-for-domains script only runs on parked domains (the link list keeps just /adsense)
  if (low.includes('google.com/adsense/domains')) return { kind: 'parked', by: '', sale };
  // GoDaddy's parked domains answer with a one-line script that jumps to /lander
  if (low.length < 3000 && /location(?:\.href)?\s*=\s*["']\/lander|location\.replace\(\s*["']\/lander/.test(low)) return { kind: 'parked', by: 'GoDaddy', sale: false };
  if (small && PARKED_WORDS.test(top)) return { kind: 'parked', by: /godaddy/.test(top) ? 'GoDaddy' : '', sale };
  const strong = top.match(PLACEHOLDER_RE);
  if (strong) return { kind: 'placeholder', reason: PLACEHOLDERS[strong.slice(1).findIndex((g) => g !== undefined)][0] };
  // "coming soon" on a real site is news; on a page with almost nothing else, it's the whole site
  const t = title.toLowerCase(), text = low.length < 15000 ? visible(low) : null;
  const weak = SOON.find(([, re]) => re.test(t) || (text !== null && text.length < 400 && re.test(text)));
  if (weak) return { kind: 'placeholder', reason: weak[0] };
  // nothing on it, or nothing but its own address
  if (text !== null) {
    const bare = t && t.replace(/^www\./, '') === host.replace(/^www\./, '');
    if ((text.length < 40 && !low.includes('<script')) || (bare && text.length < 300)) return { kind: 'placeholder', reason: 'blank' };
  }
  return null;
}

// Roughly what a visitor reads: the page without its tags, scripts and styles.
function visible(s) {
  return s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8211;|&ndash;/g, '–').replace(/&#8217;/g, '’').replace(/\s+/g, ' ');
}
