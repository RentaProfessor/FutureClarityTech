// POST /api/prospects: the server side of the Lead Finder (public/dashboard/leads.html).
//
// Every call must carry the dashboard code. It is checked by Supabase, exactly like the
// dashboard does it, so nobody else can spend the Google quota through this endpoint.
//
//   { action: 'search', code, query, type?, pageToken? }
//       Google Places Text Search (New). Returns up to 20 businesses and a nextPageToken
//       (Google stops after 60 per search).
//   { action: 'sites', code, urls: [up to 3] }
//       Opens each business website once and reports what a prospect call needs: no online
//       booking, no mobile layout, a stale copyright, a broken page, which booking tool
//       they already use, and any email address on the page.
//
// The Google key lives in Cloudflare: Pages project > Settings > Variables and Secrets,
// a secret named GOOGLE_PLACES_API_KEY. It is never sent to the browser and is not in
// this repo. Setup steps are in README.md.

// Same public values as public/fc-config.js (safe to publish; access is enforced in the database).
const SUPABASE_URL = 'https://bzudkcybqhmqrybskwfn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_te0V9b4k8S0M1iBO0q89Rg_ziCLo9CQ';

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
// Everything a lead needs in one call. rating, userRatingCount, websiteUri, the phone and
// the opening hours bill this as a Text Search Enterprise request (see README for the cost).
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
  'places.types', 'places.primaryType', 'places.primaryTypeDisplayName', 'places.businessStatus',
  'places.googleMapsUri', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.rating',
  'places.userRatingCount', 'places.regularOpeningHours.weekdayDescriptions', 'nextPageToken',
].join(',');

const SITES_PER_CALL = 3; // keeps each call inside the free plan's subrequest and CPU limits
const SITE_TIMEOUT_MS = 7000;
const SITE_MAX_BYTES = 120000;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  if (!body || typeof body !== 'object') return reply({ error: 'bad_request' }, 400);

  const ok = await codeOk(env, body.code);
  if (ok === null) return reply({ error: 'auth_unavailable' }, 502);
  if (!ok) return reply({ error: 'wrong_code' }, 401);

  if (body.action === 'search') return search(env, body);
  if (body.action === 'sites') return sites(body);
  return reply({ error: 'bad_request' }, 400);
}

// ---------------------------------------------------------------- dashboard code

// A code that passed is remembered for 10 minutes by this worker instance, so a search
// followed by several website checks costs one database round trip, not five.
const passed = new Map();

async function codeOk(env, code) {
  if (typeof code !== 'string' || code.length < 1 || code.length > 200) return false;
  const key = await sha256(code.toLowerCase().replace(/\s/g, ''));
  const until = passed.get(key);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/rest/v1/rpc/dashboard_check`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY || SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY || SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const yes = (await res.json()) === true;
    if (yes) {
      if (passed.size > 50) passed.clear();
      passed.set(key, Date.now() + 10 * 60 * 1000);
    }
    return yes;
  } catch {
    return null;
  }
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- search

async function search(env, body) {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return reply({ error: 'not_configured' }, 503);

  const query = String(body.query || '').trim().slice(0, 200);
  if (!query) return reply({ error: 'bad_request' }, 400);

  // Google requires the exact same request body on every page of one search, plus the token.
  const req = { textQuery: query, pageSize: 20, regionCode: 'us', languageCode: 'en' };
  if (typeof body.type === 'string' && /^[a-z_]{2,60}$/.test(body.type)) req.includedType = body.type;
  if (typeof body.pageToken === 'string' && body.pageToken && body.pageToken.length < 2000) req.pageToken = body.pageToken;

  let { res, data } = await places(key, req);
  // A place type Google doesn't recognise fails the whole search. Retry once on the words alone
  // and tell the page, so it asks for the next pages the same way.
  let typeDropped = false;
  if (res && res.status === 400 && req.includedType && !req.pageToken) {
    delete req.includedType;
    typeDropped = true;
    ({ res, data } = await places(key, req));
  }
  if (!res) return reply({ error: 'google_unreachable' }, 502);
  if (!res.ok) {
    // Pass Google's reason through: it is what tells you the API isn't enabled, billing is
    // off, or the key is restricted to the wrong API. It never contains the key.
    const g = (data && data.error) || {};
    const detail = (Array.isArray(g.details) ? g.details : []).find((d) => d && d.reason);
    return reply({ error: 'google_error', status: res.status, reason: (detail && detail.reason) || g.status || '', message: String(g.message || '').slice(0, 400) }, 502);
  }

  const found = (data.places || [])
    .filter((p) => p && p.id && p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((p) => ({
      placeId: p.id,
      name: (p.displayName && p.displayName.text) || '',
      address: p.formattedAddress || '',
      short: p.shortFormattedAddress || '',
      btype: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
      types: p.types || [],
      businessStatus: p.businessStatus || '',
      mapsUrl: p.googleMapsUri || '',
      website: p.websiteUri || '',
      phone: p.nationalPhoneNumber || '',
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviews: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
      hours: ((p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions) || []).join('\n'),
    }));
  return reply({ places: found, nextPageToken: data.nextPageToken || '', typeDropped });
}

async function places(key, req) {
  try {
    const res = await fetch(PLACES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(req),
    });
    return { res, data: await res.json().catch(() => ({})) };
  } catch {
    return { res: null, data: null };
  }
}

// ---------------------------------------------------------------- website check

async function sites(body) {
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string').slice(0, SITES_PER_CALL) : [];
  if (!urls.length) return reply({ error: 'bad_request' }, 400);
  const results = await Promise.all(urls.map((u) => checkSite(u).catch(() => ({ url: u, kind: 'error', error: 'check failed' }))));
  return reply({ results });
}

// A "website" that is really a profile somewhere else.
const PROFILE_HOSTS = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'Facebook page'],
  [/(^|\.)instagram\.com$/, 'Instagram profile'],
  [/(^|\.)linktr\.ee$|(^|\.)linkin\.bio$|(^|\.)beacons\.ai$/, 'link-in-bio page'],
  [/(^|\.)yelp\.com$/, 'Yelp page'],
  [/(^|\.)business\.site$/, 'Google business.site page (Google shut these down in 2024)'],
  [/(^|\.)sites\.google\.com$/, 'Google Sites page'],
  [/(^|\.)tiktok\.com$/, 'TikTok profile'],
  [/(^|\.)booksy\.com$/, 'Booksy profile'],
  [/(^|\.)vagaro\.com$/, 'Vagaro profile'],
  [/(^|\.)styleseat\.com$/, 'StyleSeat profile'],
  [/(^|\.)fresha\.com$/, 'Fresha profile'],
  [/(^|\.)squareup\.com$/, 'Square booking page'],
  [/(^|\.)glossgenius\.com$|(^|\.)gloss\.genius$/, 'GlossGenius page'],
  [/(^|\.)getsquire\.com$/, 'Squire page'],
  [/(^|\.)thecut\.co$/, 'theCut profile'],
  [/(^|\.)nextdoor\.com$/, 'Nextdoor page'],
];

// Booking / shop-management tools, found by their script, iframe or link on the page.
// suite: true = an all-in-one that already sends reminders and review requests (a harder sale).
const TOOLS = [
  ['Booksy', /booksy\.com/, true], ['Vagaro', /vagaro\.com/, true], ['Fresha', /fresha\.com|shedul\.com/, true],
  ['GlossGenius', /glossgenius\.com/, true], ['Squire', /getsquire\.com/, true], ['theCut', /thecut\.co\b/, true],
  ['StyleSeat', /styleseat\.com/, true], ['Boulevard', /joinblvd\.com|blvd\.co\b/, true], ['Zenoti', /zenoti\.com/, true],
  ['Mangomint', /mangomint\.com/, true], ['Phorest', /phorest\.com/, true], ['Mindbody', /mindbodyonline\.com|healcode\.com|mindbody\.io/, true],
  ['Schedulicity', /schedulicity\.com/, false], ['Square Appointments', /squareup\.com\/appointments|app\.squareup\.com\/appointments|book\.squareup\.com/, false],
  ['Acuity', /acuityscheduling\.com|squarespacescheduling\.com/, false], ['Calendly', /calendly\.com/, false], ['Setmore', /setmore\.com/, false],
  ['SimplyBook', /simplybook\.(me|it)/, false], ['Timely', /gettimely\.com/, true],
  ['Tekmetric', /tekmetric\.com/, true], ['Shopmonkey', /shopmonkey\.(io|com)/, true], ['Mitchell 1', /mitchell1\.com|mitchellsocial|shopkeypro/, true],
  ['AutoVitals', /autovitals\.com/, true], ['Kukui', /kukui\.com/, true], ['Steer', /steercrm\.com/, true], ['RepairPal', /repairpal\.com/, false],
  ['Autoshop Solutions', /autoshopsolutions\.com/, true], ['Shopgenie', /shopgenie\.io/, true],
  ['Openbay', /openbay\.com/, false], ['Urable', /urable\.com/, true], ['Mobile Tech RX', /mobiletechrx\.com/, true],
  ['MoeGo', /moego\.pet/, true], ['Gingr', /gingrapp\.com/, true], ['PetExec', /petexec\.net/, true], ['DaySmart Pet', /123pet\.com|daysmartpet/, true],
  ['ServiceTitan', /servicetitan\.com/, true], ['Housecall Pro', /housecallpro\.com/, true], ['Jobber', /getjobber\.com/, true], ['Workiz', /workiz\.com/, true],
  ['Glofox', /glofox\.com/, true], ['Wodify', /wodify\.com/, true], ['Zen Planner', /zenplanner\.com/, true], ['PushPress', /pushpress\.com/, true],
  ['Kicksite', /kicksite\.net/, true], ['Spark Membership', /sparkmembership/, true], ['Gymdesk', /gymdesk\.com/, true], ['Pike13', /pike13\.com/, true],
  ['Podium', /podium\.com/, true], ['Birdeye', /birdeye\.com/, true], ['NiceJob', /nicejob\.co/, true], ['Weave', /getweave\.com/, true],
  ['NexHealth', /nexhealth\.com/, true], ['Zocdoc', /zocdoc\.com/, false],
];

const BUILDERS = [
  ['Wix', /wixstatic\.com|wix\.com|wixsite\.com/], ['Squarespace', /squarespace/], ['GoDaddy', /img1\.wsimg\.com|godaddysites\.com/],
  ['WordPress', /wp-content|wp-includes/], ['Weebly', /weebly/], ['Square Online', /editmysite\.com|square\.site/], ['Shopify', /cdn\.shopify\.com/],
  ['Duda', /multiscreensite|dudaone|irp\.cdn-website\.com/], ['Webflow', /webflow|website-files\.com/],
];

// Placeholder, tracking and image-name matches that look like addresses but aren't anyone's inbox.
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|[@.](example|domain|email|yourdomain|yoursite|mysite|company|sentry|wixpress|godaddy)\.[a-z.]+$|^(no-?reply|name|you|your|user|username|email|firstname|john\.?doe|jane\.?doe)@/i;

const UA = 'Mozilla/5.0 (compatible; FutureClarityLeadCheck/1.0; +https://futureclaritytechnologies.com)';
// Redirects are followed by hand: each one is a separate subrequest, and the free plan allows
// 50 per call. 3 sites x (1 + 4 redirects) + the code check stays well under that.
const MAX_HOPS = 4;

function profileOf(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const hit = PROFILE_HOSTS.find(([re]) => re.test(host));
  return hit ? hit[1] : '';
}

async function checkSite(raw) {
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
  try {
    let url = u.toString();
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : '';
      if (!loc) break;
      discard(res);
      if (hop >= MAX_HOPS) return { url: raw, kind: 'down', error: 'it redirects in a loop' };
      let next;
      try { next = new URL(loc, url); } catch { next = null; }
      if (!next || !/^https?:$/.test(next.protocol)) return { url: raw, kind: 'down', error: 'it redirects to a broken address' };
      const moved = profileOf(next.hostname);
      if (moved) return { url: raw, kind: 'profile', profile: moved };
      url = next.toString();
    }
    if (res.status >= 400) {
      discard(res);
      // 401/403/429 is usually a bot filter, not a broken site: don't call it broken.
      return [401, 403, 429].includes(res.status)
        ? { url: raw, kind: 'blocked', status: res.status }
        : { url: raw, kind: 'down', status: res.status, error: `the page answers with error ${res.status}` };
    }
    const html = await readCapped(res, SITE_MAX_BYTES);
    return { url: raw, kind: 'site', finalUrl: url, https: url.startsWith('https:'), ms: Date.now() - started, ...inspect(html) };
  } catch (e) {
    return { url: raw, kind: 'down', error: e && e.name === 'AbortError' ? 'it did not load within 7 seconds' : 'it could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

function inspect(html) {
  const low = html.toLowerCase();

  // Every linked host (plus the start of its path), pulled out in one pass. Matching tool and
  // builder signatures against this short list instead of the whole page keeps a check around
  // a millisecond of CPU; the free plan allows 10 per call. \/\/ catches links inside JSON.
  const seen = new Set();
  for (const m of low.matchAll(/(?:\/\/|\\\/\\\/)([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:(?:\/|\\\/)[\w.-]{1,30})?)/g)) {
    if (seen.size < 2000) seen.add(m[1].replace(/\\\//g, '/'));
  }
  if (low.includes('/wp-content/')) seen.add('wp-content');
  const links = [...seen].join('\n');

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
    .flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number);
  const title = html.match(/<title[^>]*>([^<]{0,200})/i);

  return {
    bytes: html.length,
    title: title ? decodeEntities(title[1]).trim() : '',
    mobile: /<meta[^>]+name=["']?viewport/.test(low),
    tel: /href=["']?tel:/.test(low),
    bookingWords: /book (now|online|an appointment|appointment)|schedule (now|online|an appointment|service)|request an appointment|reserve (now|online)/.test(low),
    tools: TOOLS.filter(([, re]) => re.test(links)).map(([name, , suite]) => ({ name, suite })),
    builder: (BUILDERS.find(([, re]) => re.test(links)) || [''])[0],
    year: years.length ? Math.max(...years) : null,
    // parked-domain pages are tiny; skip the check on real pages
    parked: low.length < 30000 && /domain (is|may be) for sale|buy this domain|parked free|this domain is parked|sedoparking|parkingcrew/.test(low),
    thin: html.length < 1500,
    emails: [...emails].slice(0, 3),
  };
}

function discard(res) {
  try { if (res.body) res.body.cancel().catch(() => {}); } catch {}
}

async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (out.length < max) {
    let chunk;
    try { chunk = await reader.read(); } catch { break; } // timed out mid-page: keep what arrived
    if (chunk.done) break;
    out += dec.decode(chunk.value, { stream: true });
  }
  try { await reader.cancel(); } catch {}
  return out.slice(0, max);
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&ndash;/g, '–').replace(/&#8217;/g, '’').replace(/\s+/g, ' ');
}
