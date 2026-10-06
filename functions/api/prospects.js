// POST /api/prospects: the website checker behind the Lead Finder (public/dashboard/leads.html).
//
// Finding businesses happens in the browser (the business list built into the site, no key).
// This function only does what a browser can't: open another business's website, for the
// scores and again right before a downloadable audit. It needs no settings or secrets.
//
//   { action: 'sites', code, urls: [up to 3], hints: [{ name, places, phone }, ...] }
//       Opens each business website once and reports what a prospect call and an audit need.
//       First, whether it's a real website at all: a Facebook or booking page, a domain that's
//       for sale or parked (often an expired one a reseller bought), an expired or unregistered
//       domain, a placeholder ("coming soon", a host's default page, "account suspended"), or a
//       page that never names the business. Then, for a real site: phones, booking, https,
//       copyright year, search basics (title, description, hidden from Google, business details
//       for Google, the business's area and phone on the page), the tools they already use and
//       any email address on the page. hints are optional, one per url: the business's name,
//       area names and phone, only ever searched for on the page.
//
// Every call must carry the dashboard code. It is checked by Supabase, exactly like the
// dashboard does it, so nobody else can use this as a free web fetcher.

// Same public values as public/fc-config.js (safe to publish; access is enforced in the database).
const SUPABASE_URL = 'https://bzudkcybqhmqrybskwfn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_te0V9b4k8S0M1iBO0q89Rg_ziCLo9CQ';

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

// ---------------------------------------------------------------- website check

async function sites(body) {
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string').slice(0, SITES_PER_CALL) : [];
  if (!urls.length) return reply({ error: 'bad_request' }, 400);
  const hints = Array.isArray(body.hints) ? body.hints : [];
  const results = await Promise.all(urls.map((u, i) => checkSite(u, cleanHint(hints[i])).catch(() => ({ url: u, kind: 'error', error: 'check failed' }))));
  return reply({ results });
}

// The business's name, area names and phone, lowercased and cut short: they're only searched for.
function cleanHint(h) {
  if (!h || typeof h !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 120).toLowerCase().trim() : '');
  return {
    name: str(h.name),
    places: (Array.isArray(h.places) ? h.places : []).map(str).filter((p) => p.length >= 3).slice(0, 3),
    phone: str(h.phone).replace(/\D/g, '').slice(-10),
  };
}

// Signatures below are plain text, matched against host names and the page's link list.
// isHost('m.facebook.com', 'facebook.com') is true; isHost('notfacebook.com', 'facebook.com') isn't.
const isHost = (host, d) => host === d || host.endsWith('.' + d);
// Many strings found in one pass: a lookahead, so overlapping ones all count ("img1.wsimg.com" and
// "wsimg.com/parking-lander" in the same link), longest first where two start at the same place.
// One pattern instead of one per signature also keeps the first check in a fresh worker inside
// the CPU limit.
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n');
const finder = (list) => new RegExp(`(?=(${[...new Set(list)].sort((a, b) => b.length - a.length).map(escapeRe).join('|')}))`, 'g');
const findAll = (text, re) => { const out = new Set(); for (const m of text.matchAll(re)) out.add(m[1]); return out; };
let linkPattern = null;
const linkSignatures = () => linkPattern || (linkPattern = finder([...TOOLS.flatMap((t) => t[1]), ...EXTRAS.flatMap((e) => e[2]),
  ...BUILDERS.flatMap((b) => b[1]), ...PARKED_CODE.flatMap((c) => c[0])]));

// A "website" that is really a profile or listing somewhere else.
const PROFILE_HOSTS = [
  [['facebook.com', 'fb.com'], 'Facebook page'], [['instagram.com'], 'Instagram profile'],
  [['linktr.ee', 'linkin.bio', 'beacons.ai'], 'link-in-bio page'], [['yelp.com'], 'Yelp page'],
  [['business.site', 'negocio.site'], 'Google business.site page (Google shut these down in 2024)'],
  [['sites.google.com'], 'Google Sites page'], [['g.page', 'maps.app.goo.gl', 'maps.google.com'], 'Google Maps listing'],
  [['tiktok.com'], 'TikTok profile'], [['booksy.com'], 'Booksy profile'], [['vagaro.com'], 'Vagaro profile'],
  [['styleseat.com'], 'StyleSeat profile'], [['fresha.com'], 'Fresha profile'], [['squareup.com'], 'Square booking page'],
  [['glossgenius.com', 'gloss.genius'], 'GlossGenius page'], [['getsquire.com'], 'Squire page'], [['thecut.co'], 'theCut profile'],
  [['nextdoor.com'], 'Nextdoor page'], [['hub.biz'], 'Hub.biz listing'], [['localgads.com'], 'LocalGads listing'],
  [['yellowpages.com'], 'Yellow Pages listing'], [['manta.com'], 'Manta listing'], [['mapquest.com'], 'MapQuest listing'],
  [['bbb.org'], 'BBB listing'], [['chamberofcommerce.com'], 'Chamber of Commerce listing'], [['carfax.com'], 'Carfax listing'],
  [['mechanicadvisor.com'], 'MechanicAdvisor listing'], [['repairpal.com'], 'RepairPal listing'], [['openbay.com'], 'Openbay listing'],
  [['angi.com', 'homeadvisor.com'], 'Angi listing'], [['thumbtack.com'], 'Thumbtack listing'], [['groupon.com'], 'Groupon page'],
];

// Domain marketplaces, registrars and parking services. An address that redirects to one is for sale
// or parked, not a website. sale: a marketplace (or a registrar's for-sale page), not just parking.
const MARKETS = [
  [['godaddy.com'], 'GoDaddy'], [['afternic.com'], 'Afternic'], [['dan.com'], 'Dan.com'], [['sedo.com', 'sedoparking.com'], 'Sedo'],
  [['hugedomains.com'], 'HugeDomains'], [['buydomains.com'], 'BuyDomains'], [['undeveloped.com'], 'Undeveloped'],
  [['domainmarket.com'], 'DomainMarket'], [['atom.com', 'squadhelp.com'], 'Atom'], [['brandbucket.com'], 'BrandBucket'],
  [['efty.com'], 'Efty'], [['sav.com'], 'Sav'], [['bodis.com'], 'Bodis'], [['parkingcrew.net'], 'ParkingCrew'], [['above.com'], 'Above.com'],
  [['dynadot.com'], 'Dynadot'], [['namecheap.com'], 'Namecheap'], [['domainnamesales.com'], 'DomainNameSales'], [['epik.com'], 'Epik'],
  [['spaceship.com'], 'Spaceship'], [['porkbun.com'], 'Porkbun'], [['perfectdomain.com'], 'PerfectDomain'], [['uniregistry.com'], 'Uniregistry'],
  [['domainagents.com'], 'DomainAgents'], [['name.com'], 'Name.com'],
];
const SALE_HOSTS = new Set(['Afternic', 'Dan.com', 'Sedo', 'HugeDomains', 'BuyDomains', 'Undeveloped', 'DomainMarket', 'Atom', 'BrandBucket', 'Efty',
  'DomainNameSales', 'PerfectDomain', 'DomainAgents']);
// Words that say the domain itself is for sale (a parking page alone may just be an unused domain).
const SALE_WORDS = /for sale|buy this domain|get this domain|make an offer|inquire about this domain|interested in this domain|may still be available/;
// Hosting companies' and site builders' own homepages: sending visitors there means the site isn't
// set up or the plan ended. Exact names only: joesauto.weebly.com is a real (free) site.
const HOST_HOMES = {
  'wix.com': 'Wix', 'squarespace.com': 'Squarespace', 'shopify.com': 'Shopify', 'weebly.com': 'Weebly', 'web.com': 'Web.com',
  'networksolutions.com': 'Network Solutions', 'register.com': 'Register.com', 'ionos.com': 'IONOS', '1and1.com': 'IONOS',
  'hostinger.com': 'Hostinger', 'bluehost.com': 'Bluehost', 'hostgator.com': 'HostGator', 'dreamhost.com': 'DreamHost',
  'siteground.com': 'SiteGround', 'wordpress.com': 'WordPress.com', 'godaddysites.com': 'GoDaddy',
};
// A real site, but on a free address from its builder instead of the business's own domain.
const FREE_HOSTS = [
  [['wixsite.com', 'editorx.io'], 'Wix'], [['godaddysites.com'], 'GoDaddy'], [['weebly.com', 'weeblysite.com'], 'Weebly'], [['square.site'], 'Square'],
  [['squarespace.com'], 'Squarespace'], [['wordpress.com'], 'WordPress.com'], [['myshopify.com'], 'Shopify'], [['carrd.co'], 'Carrd'],
  [['webflow.io'], 'Webflow'], [['jimdosite.com'], 'Jimdo'], [['mystrikingly.com'], 'Strikingly'], [['site123.me'], 'SITE123'],
];

// Booking / shop-management tools, found by their script, iframe or link on the page.
// suite: true = an all-in-one that already sends reminders and review requests (a harder sale).
const TOOLS = [
  ['Booksy', ['booksy.com'], true], ['Vagaro', ['vagaro.com'], true], ['Fresha', ['fresha.com', 'shedul.com'], true],
  ['GlossGenius', ['glossgenius.com'], true], ['Squire', ['getsquire.com'], true], ['theCut', ['thecut.co/', 'thecut.co\n'], true],
  ['StyleSeat', ['styleseat.com'], true], ['Boulevard', ['joinblvd.com', 'blvd.co/', 'blvd.co\n'], true], ['Zenoti', ['zenoti.com'], true],
  ['Mangomint', ['mangomint.com'], true], ['Phorest', ['phorest.com'], true], ['Mindbody', ['mindbodyonline.com', 'healcode.com', 'mindbody.io'], true],
  ['Schedulicity', ['schedulicity.com'], false], ['Square Appointments', ['squareup.com/appointments', 'book.squareup.com'], false],
  ['Acuity', ['acuityscheduling.com', 'squarespacescheduling.com'], false], ['Calendly', ['calendly.com'], false], ['Setmore', ['setmore.com'], false],
  ['SimplyBook', ['simplybook.me', 'simplybook.it'], false], ['Timely', ['gettimely.com'], true],
  ['Tekmetric', ['tekmetric.com'], true], ['Shopmonkey', ['shopmonkey.io', 'shopmonkey.com'], true], ['Mitchell 1', ['mitchell1.com', 'mitchellsocial', 'shopkeypro'], true],
  ['AutoVitals', ['autovitals.com'], true], ['Kukui', ['kukui.com'], true], ['Steer', ['steercrm.com'], true], ['RepairPal', ['repairpal.com'], false],
  ['Autoshop Solutions', ['autoshopsolutions.com'], true], ['Shopgenie', ['shopgenie.io'], true], ['Demandforce', ['demandforce.com'], true],
  ['Broadly', ['broadly.com'], true], ['Openbay', ['openbay.com'], false], ['Urable', ['urable.com'], true], ['Mobile Tech RX', ['mobiletechrx.com'], true],
  ['MoeGo', ['moego.pet'], true], ['Gingr', ['gingrapp.com'], true], ['PetExec', ['petexec.net'], true], ['DaySmart Pet', ['123pet.com', 'daysmartpet'], true],
  ['ServiceTitan', ['servicetitan.com'], true], ['Housecall Pro', ['housecallpro.com'], true], ['Jobber', ['getjobber.com'], true], ['Workiz', ['workiz.com'], true],
  ['Glofox', ['glofox.com'], true], ['Wodify', ['wodify.com'], true], ['Zen Planner', ['zenplanner.com'], true], ['PushPress', ['pushpress.com'], true],
  ['Kicksite', ['kicksite.net'], true], ['Spark Membership', ['sparkmembership'], true], ['Gymdesk', ['gymdesk.com'], true], ['Pike13', ['pike13.com'], true],
  ['Podium', ['podium.com'], true], ['Birdeye', ['birdeye.com'], true], ['NiceJob', ['nicejob.co'], true], ['Weave', ['getweave.com'], true],
  ['NexHealth', ['nexhealth.com'], true], ['Zocdoc', ['zocdoc.com'], false],
];

// Everything else worth knowing for "what else we could build": [group, name, signatures].
const EXTRAS = [
  ['analytics', 'Google Analytics', ['google-analytics.com', 'googletagmanager.com']], ['analytics', 'Meta Pixel', ['connect.facebook.net']],
  ['chat', 'Tawk.to', ['tawk.to']], ['chat', 'Tidio', ['tidio.co']], ['chat', 'Intercom', ['intercom.io', 'intercom.com', 'intercomcdn.com']],
  ['chat', 'Drift', ['drift.com', 'driftt.com']], ['chat', 'LiveChat', ['livechatinc.com']], ['chat', 'Zendesk', ['zdassets.com', 'zopim.com']],
  ['chat', 'HubSpot', ['usemessages.com', 'hs-scripts.com']], ['chat', 'Crisp', ['crisp.chat']], ['chat', 'Olark', ['olark.com']],
  ['chat', 'Freshchat', ['freshchat.com']], ['chat', 'JivoChat', ['jivosite.com']], ['chat', 'Smartsupp', ['smartsupp']],
  ['pay', 'Stripe', ['stripe.com']], ['pay', 'Square', ['squarecdn.com', 'square.link', 'checkout.square.site']], ['pay', 'PayPal', ['paypal.com', 'paypalobjects.com']],
  ['pay', 'Clover', ['clover.com']], ['pay', 'Affirm', ['affirm.com']], ['pay', 'Synchrony financing', ['synchrony']], ['pay', 'Snap Finance', ['snapfinance.com']],
  ['pay', 'Sunbit', ['sunbit.com']], ['pay', 'Acima', ['acima.com']], ['pay', 'Koalafi', ['koalafi.com']],
  ['mail', 'Mailchimp', ['list-manage.com', 'chimpstatic.com', 'mailchimp.com']], ['mail', 'Klaviyo', ['klaviyo.com']],
  ['mail', 'Constant Contact', ['ctctcdn.com', 'constantcontact.com']], ['mail', 'MailerLite', ['mailerlite.com']],
  ['reviews', 'Elfsight', ['elfsight.com']], ['reviews', 'Trustindex', ['trustindex.io']], ['reviews', 'Trustpilot', ['trustpilot.com']], ['reviews', 'EmbedSocial', ['embedsocial.com']],
  ['app', 'App Store', ['apps.apple.com', 'itunes.apple.com']], ['app', 'Google Play', ['play.google.com']],
  ['form', 'form', ['jotform.com', 'typeform.com', 'wufoo.com', 'formstack.com', 'cognitoforms.com', '123formbuilder', 'hsforms.com', 'hsforms.net', 'forms.gle',
    'docs.google.com/forms', 'paperform.co', 'tally.so', 'formsite.com', 'formspree.io', 'getform.io', 'web3forms']],
];

const BUILDERS = [
  ['Wix', ['wixstatic.com', 'wix.com', 'wixsite.com']], ['Squarespace', ['squarespace']], ['GoDaddy', ['img1.wsimg.com', 'godaddysites.com']],
  ['WordPress', ['wp-content', 'wp-includes']], ['Weebly', ['weebly']], ['Square Online', ['editmysite.com', 'square.site']], ['Shopify', ['cdn.shopify.com']],
  ['Duda', ['multiscreensite', 'dudaone', 'irp.cdn-website.com']], ['Webflow', ['webflow', 'website-files.com']],
];

// What a for-sale or parked page loads (matched against its links)...
const PARKED_CODE = [
  [['wsimg.com/parking-lander'], 'GoDaddy'], [['sedoparking.com', 'sedo.com/'], 'Sedo'], [['parkingcrew.net'], 'ParkingCrew'], [['bodis.com'], 'Bodis'],
  [['afternic.com'], 'Afternic'], [['\ndan.com/', '\nwww.dan.com/'], 'Dan.com'], [['hugedomains.com'], 'HugeDomains'], [['undeveloped.com'], 'Undeveloped'],
  [['parkingpage.namecheap.com'], 'Namecheap'], [['\nabove.com/', '\nwww.above.com/'], 'Above.com'], [['domainmarket.com'], 'DomainMarket'],
  [['buydomains.com'], 'BuyDomains'], [['parklogic.com'], 'ParkLogic'],
];
// ...and what it says. Only checked near the top of small pages, where a real site's text can't trip it.
const PARKED_WORDS = /domain(?: name)? (?:is|may be) for sale|this domain is for sale|buy this domain|get this domain|make an offer on this domain|inquire about this domain|interested in this domain|is registered, but may still be available|parked free|parked for free|this domain(?: name)? is parked|parked domain|domain parking|pending renewal or deletion|this domain(?: name)? has expired|domain(?: name)? (?:has )?expired on|related searches/;
// Pages that hold a domain's place: [reason, words]. These are distinctive enough to check on any page.
const PLACEHOLDERS = [
  ['coming soon', /future home of something|log in to launch this site/],
  ['default page', /welcome to nginx|apache2 (?:ubuntu|debian) default page|test page for the apache|<h1>\s*it works!|<title>\s*(?:index of \/|iis windows server|domain default page|default web ?site page)|there is no website configured at this address|if you are the owner of this website, please contact your hosting provider|this page is generated by plesk/],
  ['suspended', /account (?:has been )?suspended|this (?:website|site|account) (?:has been|is) suspended/],
  ['expired', /this website has expired|website expired|hosting (?:account )?(?:has )?expired|your site has expired/],
  ['not connected', /isn['’]?t connected to a website|is not connected to a website|domain is not connected|only one step left|store is currently unavailable|shop is currently unavailable|there isn['’]?t a github pages site here|no such app/],
];
const PLACEHOLDER_RE = new RegExp(PLACEHOLDERS.map(([, re]) => `(${re.source})`).join('|'));
// Weaker words: only in the page title or on a small page.
const SOON = [['coming soon', /coming soon|launching soon|under construction/], ['unavailable', /currently unavailable|temporarily unavailable|no longer available/]];

// schema.org business details ("structured data") that tell Google the name, address, hours and kind.
const BIZ_TYPES = /"@type"\s*:\s*\[?\s*"(?:localbusiness|automotivebusiness|autorepair|autobodyshop|autowash|autopartsstore|autodealer|tireshop|motorcyclerepair|beautysalon|hairsalon|nailsalon|dayspa|healthandbeautybusiness|tattooparlor|exercisegym|healthclub|sportsactivitylocation|petstore|veterinarycare|homeandconstructionbusiness|hvacbusiness|plumber|electrician|locksmith|housepainter|roofingcontractor|generalcontractor|movingcompany|professionalservice|drycleaningorlaundry|store|medicalbusiness|childcare|foodestablishment|bakery|florist)"/;

// Words in a business name that any shop could share, so they can't tell its own site from another.
const COMMON_WORDS = new Set(('the and of in at by for to inc llc co corp company group auto autos automotive repair repairs service services center centre ' +
  'shop shops store smog check test station tire tires wheel wheels body collision paint car cars truck trucks mobile mechanic mechanics garage ' +
  'transmission transmissions brake brakes muffler exhaust oil lube change tune engine diesel electric electrical glass tint tinting detail ' +
  'detailing wash spa salon barber barbers barbershop beauty hair nails nail studio studios tattoo tattoos piercing grooming groomer groomers pet ' +
  'pets dog dogs cat martial arts academy fitness gym boxing karate kids club los angeles valley north south east west san fernando van nuys ' +
  'hollywood burbank glendale city express pro pros plus best quality professional premier elite expert experts family').split(' '));
const nameTokens = (name) => [...new Set(String(name || '').split(/[^a-z0-9'’]+/).map((w) => w.replace(/['’]s?$/, '')).filter((w) => w.length >= 3 && !COMMON_WORDS.has(w)))].slice(0, 6);
// The trade in a name ("auto", "repair", "grooming"), for telling a rebranded site from someone else's.
const FILLER = new Set('inc corp company group center centre service services store shop shops city express plus best quality professional premier elite expert experts family club kids north south east west valley angeles hollywood burbank glendale fernando nuys pros'.split(' '));
const tradeWords = (name) => String(name || '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && COMMON_WORDS.has(w) && !FILLER.has(w));

// Placeholder, tracking and image-name matches that look like addresses but aren't anyone's inbox.
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|[@.](example|domain|email|yourdomain|yoursite|mysite|company|sentry|wixpress|godaddy)\.[a-z.]+$|^(no-?reply|name|you|your|user|username|email|firstname|john\.?doe|jane\.?doe)@/i;

const UA = 'Mozilla/5.0 (compatible; FutureClarityLeadCheck/1.0; +https://futureclaritytechnologies.com)';
// Redirects are followed by hand: each one is a separate subrequest, and the free plan allows
// 50 per call. 3 sites x (1 + 4 redirects + 2 registry lookups) + the code check stays under that.
const MAX_HOPS = 4;
const RDAP_TIMEOUT_MS = 4000;

function profileOf(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const hit = PROFILE_HOSTS.find(([ds]) => ds.some((d) => isHost(host, d)));
  return hit ? hit[1] : '';
}

// A redirect to a marketplace, a parking service or a host's homepage: not a website.
function notASiteAt(hostname, from, path = '') {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  path = path.toLowerCase();
  const market = MARKETS.find(([ds]) => ds.some((d) => isHost(host, d)));
  if (market) return { kind: 'parked', by: market[1], sale: SALE_HOSTS.has(market[1]) || /for-?sale|buy/.test(path) };
  if (HOST_HOMES[host]) return { kind: 'placeholder', reason: 'host home', by: HOST_HOMES[host] };
  // ww12.joesauto.com is how ad-parking services serve a parked domain
  if (/^ww\d+\./.test(host) && registrable(host) === registrable(from)) return { kind: 'parked', by: '', sale: false };
  return null;
}

async function checkSite(raw, hint) {
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
      const elsewhere = notASiteAt(next.hostname, u.hostname, next.pathname + next.search);
      if (elsewhere) { result = { url: raw, ...elsewhere, finalUrl: next.toString() }; break; }
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
      result = { url: raw, kind: 'site', finalUrl: url, https: url.startsWith('https:'), ms: Date.now() - started, ...inspect(html, hint, host, res.headers.get('x-robots-tag') || '') };
      if (result.page) { Object.assign(result, result.page); delete result.page; } // a for-sale or placeholder page
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

function inspect(html, hint, host, robotsHeader) {
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
    .flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number);

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
    }
    else if (key === 'og:title' || key === 'og:image') og = true;
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
    const phones = p.length === 10 ? [p, ...['-', '.', ' ', ''].map((x) => p.slice(3, 6) + x + p.slice(6))] : [];
    const want = [...tokens, ...hint.places, ...phones];
    const seenText = want.length ? findAll(low, finder(want)) : new Set(); // one pass for all of them
    const any = (list) => list.some((x) => seenText.has(x));
    onPage = {
      name: tokens.length ? found(any(tokens)) : null,
      area: hint.places.length ? found(any(hint.places)) : null,
      phone: phones.length ? found(any(phones)) : null,
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
function notASite(low, linked, title, host) {
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

// ---------------------------------------------------------------- who holds the domain

// "www.joesauto.co.uk" → "joesauto.co.uk": the part someone registers. IP addresses have none.
function registrable(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length < 2 || !/^[a-z]{2,}$/.test(parts[parts.length - 1])) return '';
  const n = parts.length > 2 && parts[parts.length - 1].length === 2 && /^(?:co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

// Nameservers that only ever serve parked or for-sale domains.
const PARKING_NS = [
  [/sedoparking\.com$/, 'Sedo'], [/parkingcrew\.net$/, 'ParkingCrew'], [/bodis\.com$/, 'Bodis'], [/(^|\.)above\.com$/, 'Above.com'],
  [/(^|\.)dan\.com$/, 'Dan.com'], [/afternic\.com$/, 'Afternic'], [/undeveloped\.com$/, 'Undeveloped'], [/namebrightdns\.com$/, 'NameBright'],
  [/uniregistrymarket\.link$/, 'Uniregistry'], [/fabulous\.com$/, 'Fabulous'], [/dsredirection\.com$/, 'DomainSponsor'], [/parklogic\.com$/, 'ParkLogic'],
  [/hugedomains\.com$/, 'HugeDomains'], [/domainmarket\.com$/, 'DomainMarket'], [/buydomains\.com$/, 'BuyDomains'], [/brandbucket\.com$/, 'BrandBucket'],
];

// When a site is down, parked or a placeholder, the domain's registry can say why: not registered at
// all (anyone can buy it), expired or on hold, or pointed at a parking service. RDAP is the
// registries' public lookup and needs no key. .com and .net go straight to Verisign; anything else
// goes through rdap.org, which forwards to the right registry.
async function domainInfo(hostname) {
  const name = registrable(hostname);
  if (!name) return null;
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const url = tld === 'com' || tld === 'net' ? `https://rdap.verisign.com/${tld}/v1/domain/${name}` : `https://rdap.org/domain/${name}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(RDAP_TIMEOUT_MS) });
    if (res.status === 404) { discard(res); return { name, registered: false }; }
    if (!res.ok) { discard(res); return null; }
    const j = await res.json();
    const status = (Array.isArray(j.status) ? j.status : []).map((s) => String(s).toLowerCase());
    const date = (action) => String(((Array.isArray(j.events) ? j.events : []).find((e) => e && e.eventAction === action) || {}).eventDate || '').slice(0, 10);
    const ns = (Array.isArray(j.nameservers) ? j.nameservers : []).map((x) => String((x && x.ldhName) || '').toLowerCase());
    const parking = PARKING_NS.find(([re]) => ns.some((x) => re.test(x)));
    const expires = date('expiration');
    return {
      name,
      registered: true,
      created: date('registration'),
      expires,
      lapsed: status.some((s) => /hold|redemption|pending delete/.test(s)) || (/^\d{4}-\d\d-\d\d$/.test(expires) && Date.parse(expires) < Date.now()),
      ending: status.some((s) => /redemption|pending delete/.test(s)),
      registrar: registrarOf(j),
      parkedBy: parking ? parking[1] : '',
    };
  } catch {
    return null;
  }
}

function registrarOf(j) {
  const e = (Array.isArray(j.entities) ? j.entities : []).find((x) => x && Array.isArray(x.roles) && x.roles.includes('registrar'));
  const card = e && Array.isArray(e.vcardArray) && Array.isArray(e.vcardArray[1]) ? e.vcardArray[1].find((v) => Array.isArray(v) && v[0] === 'fn') : null;
  return card ? String(card[3] || '').slice(0, 80) : '';
}

// A site that didn't come through cleanly: let the registry explain it, when it can.
async function withDomain(r, hostname) {
  const d = await domainInfo(hostname);
  if (!d) return r;
  if (!d.registered) return { ...r, kind: 'unregistered', domain: d };
  if (d.lapsed) return { ...r, kind: 'expired', domain: d };
  if (d.parkedBy && r.kind !== 'parked' && r.kind !== 'placeholder') return { ...r, kind: 'parked', by: d.parkedBy, sale: false, domain: d };
  return { ...r, domain: d };
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
