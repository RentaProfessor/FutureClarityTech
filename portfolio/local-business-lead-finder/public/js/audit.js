// The downloadable audit: a two-page PDF for one business, written for its owner. What we checked,
// what we found and how to fix it, then what we'd set up. Made in the browser with pdf-writer.js:
// pdf(audits) returns the file's bytes. Each audit starts on a new page, so one file can hold a
// whole call list for printing, with a bookmark per business.
import { BRAND } from './config.js';
import { GENERIC_TITLE, hostOf, known, longDate, placeholderOf, placeholderWho, placesOf, usPhone } from './shared.js';
import { vOf } from './verticals.js';
import { Doc, PAGE_H, PAGE_W, clean, cleanName, num, rgb, width, wrap } from './pdf-writer.js';

// ================================================================ look
const INK = '#14213d', MUTED = '#5b6275', LINE = '#d9dce5', SOFT = '#f4f5fa', ACCENT = '#3a3fc4';
const OK = '#1d6b3a', WARN = '#b77900', BAD = '#b3261e', GRAY = '#8b91a3';
const STATUS = { pass: OK, fail: BAD, warn: WARN, unknown: GRAY, info: ACCENT };
// How serious a problem is, from its weight, in the words the team's full audits use, and how we know.
const SEVERITY = [[14, 'HIGH', BAD, '#fbe9e7'], [6, 'MEDIUM', WARN, '#fdf2dc'], [0, 'LOW', '#5f6678', '#eceef3']];
const severity = (c) => SEVERITY.find(([min]) => (c.w || 0) >= min);
const SOURCE = { live: 'Checked live', domain: 'Domain records', maps: 'Google Maps', listing: 'Map listing' };
const M = 50, CW = PAGE_W - 2 * M, BOTTOM = PAGE_H - 58;

// The brand mark's two gradients, in its own units. On the website the beam fades to transparent;
// on white paper that's a fade to white.
const stops = (a, mid, b, at) => `/Function << /FunctionType 3 /Domain [0 1] /Bounds [${at}] /Encode [0 1 0 1] /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(a)}] /C1 [${rgb(mid)}] /N 1 >> << /FunctionType 2 /Domain [0 1] /C0 [${rgb(mid)}] /C1 [${rgb(b)}] /N 1 >>] >>`;
const SHADES = [
  `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [274 0 326 0] /Extend [true true] ${stops('#07082a', '#3a3fc4', '#d8d3fb', 0.6)} >>`,
  `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [200 175 400 105] /Extend [true true] ${stops('#ffffff', '#7c83f0', '#ffffff', 0.5)} >>`,
];
// The mark (a lens and a beam of light, clipped and filled with the gradients). w = its width; it's
// 180/220 as tall.
function logo(doc, x, top, w) {
  const s = w / 220;
  doc.raw(`q ${num(s)} 0 0 ${num(-s)} ${num(x - 190 * s)} ${num(PAGE_H - top + 50 * s)} cm`);
  doc.raw('q 300 58 m 334.67 112.67 334.67 167.33 300 222 c 265.33 167.33 265.33 112.67 300 58 c h W n /S1 sh Q');
  doc.raw('q 195 175 m 405 99 l 405 105 l 195 181 l h W n /S2 sh Q');
  doc.raw('Q');
}
function wordmark(doc, x, base, size) {
  const tc = size * 0.28, [first, second = ''] = BRAND.wordmark;
  doc.text(x, base, first, { size, color: INK, tc });
  doc.text(x + width(first + ' ', 'R', size) + tc * (first.length + 1), base, second, { size, color: ACCENT, tc });
}
// A status mark: a colored disc with a white check, cross, "!" or "?".
function mark(doc, cx, cy, status, r = 7) {
  const k = r / 7;
  doc.circle(cx, cy, r, STATUS[status]);
  const P = (dx, dy) => `${num(cx + dx * k)} ${num(PAGE_H - cy - dy * k)}`;
  const stroke = (path) => doc.raw(`1 1 1 RG ${num(1.6 * k)} w 1 J 1 j ${path} S`);
  if (status === 'pass') stroke(`${P(-3.2, 0.2)} m ${P(-0.9, 2.6)} l ${P(3.4, -2.6)} l`);
  else if (status === 'fail') stroke(`${P(-2.6, -2.6)} m ${P(2.6, 2.6)} l ${P(-2.6, 2.6)} m ${P(2.6, -2.6)} l`);
  else {
    const t = status === 'warn' ? '!' : status === 'info' ? 'i' : '?';
    doc.text(cx - width(t, 'B', 10 * k) / 2, cy + 3.6 * k, t, { font: 'B', size: 10 * k, color: '#ffffff' });
  }
}
// A problem's severity chip, and how we know it, under its label. Unchecked rows get a gray chip.
function tag(doc, x, top, c) {
  const [, word, color, fill] = c.short ? severity(c) : [0, 'NOT CHECKED', '#5f6678', '#eceef3'];
  const w = width(word, 'B', 6.5) + 0.6 * (word.length - 1) + 8;
  doc.rect(x, top, w, 10.5, { fill, r: 2 });
  doc.text(x + 4, top + 7.6, word, { font: 'B', size: 6.5, color, tc: 0.6 });
  if (c.short && SOURCE[c.src]) doc.text(x + w + 5, top + 7.8, SOURCE[c.src], { size: 7.5, color: MUTED });
}
// Wrapped text from a top edge. Returns the height used.
function para(doc, x, top, text, { font = 'R', size = 10, color = INK, lead = size * 1.38, max = CW } = {}) {
  const lines = wrap(text, font, size, max);
  lines.forEach((l, i) => doc.text(x, top + size * 0.8 + i * lead, l, { font, size, color }));
  return lines.length * lead;
}
const paraH = (text, font, size, max, lead = size * 1.38) => wrap(text, font, size, max).length * lead;
// A paragraph that opens with a bold lead-in: the first line is shorter by the lead-in's width.
function leadLines(lead, text, size, max) {
  const words = clean(text).split(' '), room = max - width(lead + ' ', 'B', size);
  let firstLine = '';
  while (words.length && width(firstLine ? firstLine + ' ' + words[0] : words[0], 'R', size) <= room) firstLine = firstLine ? firstLine + ' ' + words.shift() : words.shift();
  return [firstLine, ...(words.length ? wrap(words.join(' '), 'R', size, max) : [])];
}
function heading(doc, top, text) {
  doc.text(M, top + 8, text.toUpperCase(), { font: 'B', size: 8.5, color: ACCENT, tc: 1.4 });
  return 18;
}
// Web addresses, emails and phone numbers in a line of text become tappable.
function linkify(doc, x, base, line, size, font) {
  const re = /[\w.+-]+@[\w-]+(\.[\w-]+)+|(https?:\/\/)?([\w-]+\.)+(com|net|org|co|io|us|biz)\b(\/\S*)?|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/gi;
  for (const m of line.matchAll(re)) {
    const t = m[0], at = x + width(line.slice(0, m.index), font, size);
    const uri = t.includes('@') ? 'mailto:' + t : /^[\d(]/.test(t) ? 'tel:+1' + t.replace(/\D/g, '').slice(-10) : /^https?:/i.test(t) ? t : 'https://' + t;
    doc.link(at, base - size * 0.85, width(t, font, size), size * 1.15, uri);
  }
}

// ================================================================ what goes in it
const either = (list) => (list.length > 1 ? list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] : list[0] || '');
const both = (list) => (list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '');
// A registrar as people know it: "GoDaddy.com, LLC" is GoDaddy.
const company = (s) => clean(s).replace(/,?\s+(?:LLC|L\.L\.C\.|Inc|Ltd|Limited|Corp|Corporation|GmbH|SE|AG|B\.V|Pty)\b.*$/i, '').replace(/\s+I{1,3}$/, '').replace(/^(GoDaddy|Wix)\.com$/i, '$1');
const BOOKING_PROFILE = /booksy|vagaro|styleseat|fresha|square|glossgenius|squire|thecut/i;
// The website checker's tools that are booking calendars (functions/lib/signatures.js, TOOLS).
const BOOKING_TOOLS = ['Booksy', 'Vagaro', 'Fresha', 'GlossGenius', 'Squire', 'theCut', 'StyleSeat', 'Boulevard', 'Zenoti', 'Mangomint', 'Phorest', 'Mindbody', 'Schedulicity',
  'Square Appointments', 'Acuity', 'Calendly', 'Setmore', 'SimplyBook', 'Timely', 'MoeGo', 'Gingr', 'PetExec', 'DaySmart Pet', 'Glofox', 'Wodify', 'Zen Planner', 'PushPress',
  'Kicksite', 'Spark Membership', 'Gymdesk', 'Pike13', 'NexHealth', 'Zocdoc'];
// Where the page title and description live, by site builder (said once, on the first of them that needs fixing).
const SEO_AT = {
  WordPress: 'In WordPress, an SEO plugin such as Yoast sets it.',
  Wix: "In Wix, it's in your home page's SEO settings.",
  Squarespace: "In Squarespace, it's in your home page's SEO settings.",
  Shopify: "In Shopify, it's under Online Store > Preferences.",
};
const NOINDEX_FIX = {
  WordPress: 'In WordPress, go to Settings > Reading, untick "Discourage search engines from indexing this site" and save.',
  Wix: 'In Wix, open your SEO settings and turn on "Let search engines index your site".',
};
const SECTIONS = [['site', 'Your website'], ['find', 'Getting found on Google'], ['win', 'Turning visitors into customers']];

// The Google listing basics nobody can check from outside, as a checklist for the owner, with the
// main category their kind of business usually picks.
const CATEGORY = { auto: 'Auto repair shop', groom: 'Pet groomer', detail: 'Car detailing service', body: 'Auto body shop', dojo: 'Martial arts school', tattoo: 'Tattoo shop', barber: 'Barber shop' };
const CATEGORY_TYPES = [[/smog/i, 'Smog inspection station'], [/transmission/i, 'Transmission shop'], [/brake/i, 'Brake shop'], [/tire/i, 'Tire shop'], [/muffler/i, 'Muffler shop'],
  [/oil change/i, 'Oil change service'], [/tint/i, 'Window tinting service'], [/car wash/i, 'Car wash'], [/hair salon|hair stylist|beauty salon/i, 'Hair salon'], [/boxing/i, 'Boxing gym'], [/^gym$/i, 'Gym']];
function listing(a) {
  const t = clean(a.btype), hit = t && t !== a.vertical.label && CATEGORY_TYPES.find(([re]) => re.test(t));
  const cat = hit ? hit[1] : CATEGORY[a.vertical.k];
  return ['Your hours are right, holidays included', cat ? `Your main category fits, like "${cat}"` : 'Your main category says what you do best',
    'New photos every month: your place, team and work', 'Your services are listed, with prices where you can',
    'Every review gets a reply, good or bad', 'Your website and booking links open the right pages'];
}

// What people type into Google to find this kind of business, for a suggested page title: the
// map listing's type when it says more than the kind of business we searched for.
const SEARCH = { auto: 'Auto Repair', groom: 'Dog Grooming', detail: 'Auto Detailing', body: 'Auto Body Repair', dojo: 'Martial Arts', tattoo: 'Tattoo Studio', barber: 'Barbershop' };
const SEARCH_TYPES = [[/smog/i, 'Smog Check'], [/transmission/i, 'Transmission Repair'], [/brake/i, 'Brake Repair'], [/tire/i, 'Tire Shop'], [/muffler/i, 'Muffler & Exhaust Repair'],
  [/oil change/i, 'Oil Change'], [/engine/i, 'Engine Repair'], [/electrical/i, 'Auto Electrical Repair'], [/motorcycle/i, 'Motorcycle Repair'], [/truck/i, 'Truck Repair'],
  [/wheel/i, 'Wheel & Rim Repair'], [/restoration/i, 'Auto Restoration'], [/tint/i, 'Window Tinting'], [/wrap/i, 'Vehicle Wraps'], [/car wash/i, 'Car Wash'],
  [/customiz/i, 'Auto Customization'], [/upholster/i, 'Upholstery'], [/piercing/i, 'Tattoo & Piercing'], [/hair salon|hair stylist|beauty salon/i, 'Hair Salon'],
  [/boxing/i, 'Boxing Gym'], [/^gym$/i, 'Gym']];
function searchTerm(a) {
  const V = a.vertical, t = clean(a.btype).replace(/_/g, ' ');
  if (!t || t === V.label) return SEARCH[V.k] || '';
  const hit = SEARCH_TYPES.find(([re]) => re.test(t));
  if (hit) return hit[1];
  if (V.k !== 'custom') return SEARCH[V.k] || '';
  return t.replace(/ services?$/i, '').replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(And|Of|The|For|Or)\b/g, (w) => w.toLowerCase());
}
// A page title and description to copy, made only from what we know for sure: the name, trade,
// area, rating and phone. online: they take bookings online.
function suggest(a, online) {
  // the area we searched, else the city in the address ("14530 Oak St, Van Nuys, CA 91411")
  const city = String(a.address || '').split(',').slice(1).map((p) => clean(p)).find((p) => p && !/\d/.test(p) && !/^(CA|California)$/i.test(p)) || '';
  const name = a.fullName || '', term = searchTerm(a), area = (a.areas || []).filter(Boolean)[0] || city;
  if (!name) return null;
  const flat = name.toLowerCase().replace(/\s+/g, ''), says = (w) => flat.includes(w.toLowerCase().replace(/\s+/g, ''));
  // the name may already say what they do ("...Auto Repair") or where ("Van Nuys ...")
  const needTerm = !!term && !says(term.split(' ').pop()), needArea = !!area && !says(area);
  const title = [needTerm && needArea && `${name} | ${term} in ${area}`, needTerm && `${name} | ${term}`, needArea && `${name} in ${area}`, name]
    .find((t) => t && t.length <= 60) || name.slice(0, 60).replace(/\s+\S*$/, '');
  const lead = term.replace(/(?!^)\b([A-Z])([a-z])/g, (m, x, y) => x.toLowerCase() + y); // "Auto repair"
  const r = known(a.rating) ? +a.rating : 0, n = +a.reviews || 0;
  const street = /^\d/.test(String(a.address || '')) ? clean(String(a.address).split(',')[0]) : '';
  const what = (lead || name) + (area ? ` in ${area}` : ''), proof = r >= 4.5 && n >= 10 ? `, rated ${r.toFixed(1)} from ${n} Google reviews` : '';
  const reach = online ? (a.phone ? `Book online or call ${a.phone}.` : 'Book online any time.') : a.phone ? `Call ${a.phone}${street ? ` or stop by ${street}` : ''}.` : street ? `Stop by ${street}.` : '';
  const desc = [`${what}${proof}. ${reach}`, `${what}${proof}.${a.phone ? ` Call ${a.phone}.` : ''}`, `${what}.${a.phone ? ` Call ${a.phone}.` : ''}`].map((d) => d.trim()).find((d) => d.length <= 155) || what;
  return { title, desc, lead };
}

// Every check: { section, label, status: pass | fail | warn | unknown | info, text, fine (its label
// when it passes), src (how we know: live, domain, maps or listing), and for problems a short
// line for the summary, a weight to rank them (14+ is high, 6+ medium, the rest low) and a fix:
// what to do about it, naming their site builder or domain company when we know it }.
// Rows only state what we actually saw: a missing phone or rating is left out, not called missing.
function checks(a) {
  const V = a.vertical, biz = a.biz, s = a.site && a.site.kind ? a.site : null, out = [];
  const add = (section, label, status, text, extra) => out.push({ section, label, status, text, short: '', w: 0, fine: label, fix: '', src: 'live', ...extra });
  const year = a.year || new Date().getFullYear();
  const host = a.website ? hostOf(a.website) : '', finalHost = s && s.finalUrl ? hostOf(s.finalUrl) : host;
  const areas = (a.areas || []).filter(Boolean), area = areas[0] || '';
  const dom = (s && s.domain) || {}, registrar = company(dom.registrar);
  const simple = 'one simple page with your services, hours, phone and a book-or-call button';

  // ---- your website
  let checked = false, bookable = false;
  const profile = s && s.kind === 'profile' ? String(s.profile || 'profile page') : '';
  const profileName = profile.replace(/ \(.*/, ''), brand = profileName.replace(/ (?:booking page|profile|page)$/, '');
  const by = s && s.by ? ` from ${s.by}` : '';
  const site = (status, text, short, w, fix) => add('site', 'Website', status, text, { short, w, fix });
  if (!a.website) add('site', 'Website', 'fail', `We couldn't find a website for ${biz}. People who look you up only see your map listing, and if nobody picks up, they call the next ${V.noun}.`, { short: 'No website of your own', w: 25, src: 'listing',
    fix: `Start with ${simple}, and add its link to your Google listing.` });
  else if (!s) site('unknown', "We couldn't check your website automatically this time.");
  else if (s.kind === 'profile' && /business\.site/.test(profile)) site('fail', 'Your listing still links to a Google business.site page. Google shut those down in 2024, so people who tap it never reach you.', 'Your website link is dead', 25,
    'Sign in to your Google Business Profile and change the website link to a page that works, or remove it for now.');
  else if (s.kind === 'profile' && /Google Maps/.test(profile)) site('fail', "Your listing's website link just leads back to Google Maps, so people who tap it learn nothing new about you.", 'No website of your own', 22,
    `Link a site of your own instead, even ${simple}.`);
  else if (s.kind === 'profile' && / listing$/.test(profileName)) site('fail', `Your listing links to your ${profileName}, a directory page that shows other businesses too, not a website of your own.`, 'No website of your own', 22,
    'Link a site of your own instead. Until you have one, your Facebook or booking page is a better link than a directory.');
  else if (s.kind === 'profile') {
    bookable = BOOKING_PROFILE.test(profile);
    if (bookable) site('warn', `Your listing links to your ${profileName}, not a website of your own. It takes bookings, but it's their page making your first impression, next to other businesses.`, 'No website of your own', 12,
      `Keep ${brand} for bookings, and add a simple site of your own with your work, prices and reviews, and a "Book now" button that opens ${brand}.`);
    else site('fail', `Your listing links to your ${profileName}, not a website of your own. That's a good extra, but it can't show your services, prices and booking the way a site of your own can.`, 'No website of your own', 22,
      `Keep your ${profileName}, and put a simple site of your own on your listing, with your services, prices and a way to book.`);
  } else if (s.kind === 'unregistered') add('site', 'Website', 'fail', `Your web address, ${host}, isn't registered to anyone right now. It doesn't load, and anyone could buy it and put up their own site.`, { short: 'Your web address is up for grabs', w: 30, src: 'domain',
    fix: 'Register it today at any domain company (usually $10 to $25 a year) and turn on auto-renew. Until a site is back on it, take it off your listings.' });
  else if (s.kind === 'expired') {
    const when = dom.expires && Date.parse(dom.expires) < Date.now() ? longDate(dom.expires) : '';
    add('site', 'Website', 'fail', `Your web address, ${host}, ${when ? `expired on ${when}` : 'has expired'}${dom.ending ? ' and will soon be released for anyone to buy' : ''}, so visitors don't reach your site.`, { short: 'Your web address has expired', w: 30, src: 'domain',
      fix: dom.ending ? `Call ${registrar || 'the company you bought it from'} today. It may still be recoverable for a late fee, but once it's released, anyone can buy it.`
        : `Renew it today${registrar ? ` with ${registrar}` : ' where you bought it'} and turn on auto-renew. Expired addresses can usually be renewed for a few weeks, before anyone else can buy them.` });
  } else if (s.kind === 'parked' && s.sale) site('fail', `Your web address, ${host}, shows a "for sale" page${by} instead of your business, so the domain may not be yours anymore.`, 'Your web address is for sale', 30,
    "Sign in where you bought it to see if it's still yours. If it is, connect it to your website; if not, put a new web address on your listings.");
  else if (s.kind === 'parked' || (s.kind === 'site' && s.parked)) site('fail', `Your web address, ${host}, shows a parking page${by} instead of your business. Either it was never connected to a website, or it lapsed and someone else holds it now.`, 'Your web address shows a parking page', 28,
    `If it's yours, sign in to ${registrar || (/GoDaddy|Namecheap/.test(s.by || '') ? s.by : 'the company you bought it from')} and connect it to your website, or forward it to your Facebook or booking page for now. If it isn't, take it off your listings.`);
  else if (s.kind === 'placeholder') {
    const { shows, title, fix } = placeholderOf(s), who = placeholderWho(s);
    site('fail', `Your web address, ${host}, ${shows.replace('{by}', who)}.`, title.replace('{by}', who), 25, fix.replace(/\{by\}/g, who));
  } else if (s.kind === 'down') site('fail', `When we checked, your website didn't work: ${s.error || 'it returned an error'}. Customers who try it may think you've closed.`, "Your website doesn't load", 25,
    'Try it on your phone. If it still fails, call whoever hosts it, and check that your hosting and your web address are both paid up.');
  else if (s.kind !== 'site') site('unknown', s.kind === 'blocked' ? "Your website blocked our automated check, so we couldn't review it. Visitors usually aren't affected." : "We couldn't check your website automatically this time.");
  else if (s.notMine) site('fail', `The website on your listing, ${finalHost}, doesn't mention ${a.fullName || biz} anywhere. If it isn't yours anymore, your listing is sending customers to someone else.`, "Your listing's website doesn't mention you", 25,
    'Check the website link on your Google listing, Yelp and other directories, and change it to your current site, or remove it.');
  else {
    checked = true;
    if (s.thin) site('warn', "Your website loads, but there's very little on it, so visitors can't see your services, hours or prices.", 'Your website is nearly empty', 10,
      'Add your services with prices (or "starting at" prices), your hours and area, a few photos of your work, and a book-or-call button.');
    else add('site', 'Website', 'pass', `${s.movedTo && !s.freeHost ? `${host} forwards to ${s.movedTo}, which is` : `${finalHost} is`} up and running${s.builder ? ` (built with ${s.builder})` : ''}.`, { fine: 'Website works' });
    // a free address (name.wixsite.com), maybe behind a web address of their own that only forwards to it
    if (s.freeHost && host !== finalHost) add('site', 'Web address', 'warn', `${host} forwards visitors to a free ${s.freeHost} address (${finalHost}), which looks less established and is harder to find on Google.`, { short: `Your site shows a free ${s.freeHost} address`, w: 6,
      fix: `Connect ${host} to your ${s.freeHost} site instead of forwarding it, so your own address is the one people see. Most builders need a paid plan for that.` });
    else if (s.freeHost) add('site', 'Web address', 'warn', `Your site is on a free ${s.freeHost} address (${finalHost}) instead of a web address of your own, which looks less established and is harder to find on Google.`, { short: `Your site is on a free ${s.freeHost} address`, w: 6,
      fix: `Get a web address that matches your name (usually $10 to $25 a year) and connect it to your ${s.freeHost} site. Most builders need a paid plan for that; the site itself stays the same.` });
    if (s.filler) add('site', 'Placeholder text', 'warn', 'Your home page still shows placeholder text ("lorem ipsum") from a website template, which looks unfinished to customers and to Google.', { short: 'Your website shows placeholder text', w: 9,
      fix: 'Replace it with a few real lines about your services, or remove that section.' });
  }
  if (checked) {
    if (s.mobile) add('site', 'Works on phones', 'pass', 'Your site is set up for phone screens.');
    else add('site', 'Works on phones', 'fail', `Your site isn't set up for phones, so it shows up tiny and hard to use on a small screen, where most people look up local ${V.plural}.`, { short: "Your website isn't built for phones", w: 14,
      fix: 'Switch to a mobile-friendly theme or template. Your text and photos can usually move over as they are.' });
    if (s.https) add('site', 'Secure (https)', 'pass', 'Browsers show your site as secure.');
    else add('site', 'Secure (https)', 'fail', 'Browsers mark your site "Not secure" because it doesn\'t use https, which makes some visitors leave.', { short: 'Browsers say your site is "Not secure"', w: 6,
      fix: 'Ask your web host to turn on the free security certificate (SSL) most hosts include, and send every visitor to the https version of your site.' });
    if (s.ms > 5000) add('site', 'Speed', 'warn', `Your site took about ${Math.round(s.ms / 1000)} seconds to answer when we checked. Slow sites lose visitors, especially on phones.`, { short: 'Your website is slow', w: 8,
      fix: "Shrink big photos before uploading them, and remove add-ons you don't use. If it's still slow, a better hosting plan usually fixes it." });
    else if (s.ms) add('site', 'Speed', 'pass', 'Your site answered quickly when we checked.', { fine: 'Loads quickly' });
    if (s.year && s.year <= year - 3) add('site', 'Up to date', 'warn', `Your site's footer says © ${s.year}, so it can look out of date to new customers.`, { short: `Your website's footer says © ${s.year}`, w: 8,
      fix: `Change it to © ${year}, or set it to update itself, and check that your hours, prices and photos are current.` });
    else if (s.year) add('site', 'Up to date', 'pass', `Your site's footer shows a recent year (${s.year}).`);
    // zooming blocked, or many images with no description (alt text): what accessibility checks flag first
    const blind = s.noAlt >= 3 && s.noAlt / s.imgs >= 0.25;
    if (s.noZoom || blind) {
      const zoom = 'Your site blocks zooming on many phones', alt = `${s.noAlt} of the ${s.imgs} images on your home page have no description (alt text)`;
      add('site', 'Accessibility', 'warn', s.noZoom && blind ? `${zoom}, and ${alt}. Both fail accessibility checks.` : s.noZoom ? `${zoom}, so people who need bigger text can't get it. That fails accessibility checks.` : `${alt}, so screen readers and Google Images skip them.`,
        { short: s.noZoom ? 'Your website fails accessibility checks' : "Your website's images have no descriptions", w: 3,
          brief: [s.noZoom && 'Zooming is blocked on many phones', blind && `${s.noAlt} of ${s.imgs} images have no description (alt text)`].filter(Boolean).join(', and '),
          fix: [s.noZoom && 'Remove "user-scalable=no" and "maximum-scale=1" from the page\'s viewport tag', blind && 'add a short description to each image in your site builder\'s image settings']
            .filter(Boolean).join(', and ').replace(/^./, (c) => c.toUpperCase()) + '.' });
    } else if (s.imgs) add('site', 'Accessibility', 'pass', 'Your images have descriptions and people can zoom.', { fine: 'Images described, zoom works' });
  }

  // ---- getting found on Google
  if (a.phone) add('find', 'Map listing', 'pass', `You're listed on online maps with your phone number, ${a.phone}.`, { fine: 'On maps with your phone', src: 'maps' });
  const g = checked && s.seo;
  if (g) {
    const t = String(s.title || '').trim(), idea = suggest(a, (s.tools || []).length > 0 || !!s.bookingWords);
    let at = s.builder ? SEO_AT[s.builder] || `In ${s.builder}, it's in the page's SEO settings.` : 'Whoever built your site can change it in minutes.';
    const where = () => {
      const w = at;
      at = '';
      return w ? ' ' + w : '';
    };
    if (g.noindex) add('find', 'Visible to Google', 'fail', 'Your website tells Google not to list it (a "noindex" setting, often left on by mistake), so it won\'t show up in search at all.', { short: 'Your website is hidden from Google', w: 22,
      fix: `${NOINDEX_FIX[s.builder] || 'Find the setting that hides your site from search engines (or ask whoever built it) and turn it off.'} Google usually lists it again within a few weeks.` });
    else add('find', 'Visible to Google', 'pass', 'Google is allowed to list your site.');
    const titleFix = () => (idea ? `Use something like "${idea.title}".${where()}` : `Use your name, what you do and your area, in under 60 characters.${where()}`);
    if (!t) add('find', 'Page title', 'fail', 'Your home page has no title, the headline Google shows for you in search results.', { short: 'No page title for Google', w: 8, fix: titleFix() });
    else if (GENERIC_TITLE.test(t) || t.toLowerCase() === host) add('find', 'Page title', 'warn', `Your page title is just "${t}", so Google has little to show when people search for a ${V.noun}${area ? ` in ${area}` : ' nearby'}.`, { short: 'Your page title is too generic', w: 7, fix: titleFix() });
    else if (t.length > 70) add('find', 'Page title', 'warn', `Your page title is ${t.length} characters long, so Google cuts it off in search results.`, { short: 'Your page title gets cut off', brief: `Your page title is ${t.length} characters, so Google cuts it off`, w: 3,
      fix: idea ? `Keep it under 60 characters, with your name and trade first, like "${idea.title}".${where()}` : `Keep it under 60 characters, with your name and trade first.${where()}` });
    else add('find', 'Page title', 'pass', `Your page title: "${t}".`, { fine: 'Clear page title' });
    const descFix = (start) => (idea ? `${start} like "${idea.desc}"${where()}` : `${start} that says what you do, where, and how to reach you.${where()}`);
    if (!g.desc) add('find', 'Description', 'warn', "There's no description for Google to show under your name, so it picks random text from the page.", { short: 'No description for Google', w: 6, fix: descFix('Add one of about 150 characters,') });
    else if (g.desc < 50) add('find', 'Description', 'warn', `Your description for Google is only ${g.desc} characters. Around 150 tells searchers why to pick you.`, { short: 'Your Google description is too short', brief: `Your description for Google is only ${g.desc} characters`, w: 3, fix: descFix('Try something') });
    else add('find', 'Description', 'pass', 'Google has a description to show under your name.', { fine: 'Description for Google' });
    if (s.onPage && s.onPage.area === false && area) add('find', 'Your area', 'warn', `Your site never mentions ${either(areas)}. Naming your area helps Google show you to people searching nearby.`, { short: `Your site doesn't mention ${area}`, w: 6,
      fix: `Add ${area} to your page title, main heading and footer, like "${idea && idea.lead ? idea.lead : 'Proudly serving'} in ${area}".` });
    else if (s.onPage && s.onPage.area && area) add('find', 'Your area', 'pass', `Your site mentions ${area}.`, { fine: `Mentions ${area}` });
    const listed = String(a.phone || '').replace(/\D/g, '').slice(-10), dials = (s.phones || []).filter((d) => d !== listed);
    if (listed.length === 10 && dials.length && !(s.phones || []).includes(listed)) add('find', 'Phone number', 'fail', `Your website's call button dials ${usPhone(dials[0])}, but your Google listing says ${a.phone}. Customers can't tell which is right, and Google trusts a business less when its details don't match.`, { short: 'Your website and listing give different numbers', w: 14,
      fix: 'Pick one number and use it everywhere: on your website, your Google listing, Yelp and the other directories.' });
    else if (s.onPage && s.onPage.phone === false && a.phone) add('find', 'Phone number', 'warn', `The phone number on your listing, ${a.phone}, isn't on your website. Google trusts a business more when its name, address and phone match everywhere.`, { short: "Your listing's phone isn't on your site", brief: `Your listing's number, ${a.phone}, isn't on your website`, w: 5,
      fix: `Show ${a.phone} at the top of every page and in the footer.` });
    else if (s.onPage && s.onPage.phone && a.phone) add('find', 'Phone number', 'pass', 'Your website shows the same phone number as your listing.', { fine: 'Same phone as listing' });
    if (!g.schema) add('find', 'Business details', 'warn', "Your site doesn't spell out your business details in the code Google reads (structured data), which Google uses to show your hours, location and reviews.", { short: 'No business details for Google', brief: 'Your site gives Google no business details (structured data)', w: 3,
      fix: 'Add "LocalBusiness" structured data with your name, address, phone and hours. A web designer can add it in under an hour.' });
    else add('find', 'Business details', 'pass', 'Your site gives Google your business details in its own format.', { fine: 'Business details for Google' });
  }
  if (known(a.reviews)) {
    const n = +a.reviews, r = known(a.rating) && n ? +a.rating : null;
    const rated = r !== null ? `, rated ${r.toFixed(1)}` : '';
    const rev = (status, text, short, w, fix) => add('find', 'Google reviews', status, text, { short, w, fix, fine: 'Strong Google reviews', src: 'maps' });
    // Ask everyone, not just the customers who seem happy: Google's rules ban picking who gets asked.
    if (!n) rev('fail', `We couldn't find any Google reviews for ${biz}. Reviews are one of the first things people check before they call.`, 'No Google reviews yet', 15,
      'Start asking every customer in person, then text them your review link (from "Ask for reviews" in your Google Business Profile) the same day.');
    else if (n < 25) rev('fail', `${n} Google review${n > 1 ? 's' : ''}${rated}. The ${V.plural} that show up first nearby usually have far more.`, `Only ${n} Google review${n > 1 ? 's' : ''}`, 14,
      'Ask every customer before they leave, then text your review link the same day while the visit is fresh. A few a week adds up fast.');
    else if (r !== null && r < 4.0) rev('warn', `${n} Google reviews${rated}. Asking every customer for a review is the fastest way to lift it.`, `Your Google rating is ${r.toFixed(1)}`, 10,
      'Reply politely to every review, fix what the bad ones point to, and keep asking every customer. New reviews lift your average fastest.');
    else if (n < 80) rev('warn', `${n} Google reviews${rated}. A steady stream of new ones helps you show up higher in nearby searches.`, 'Room for more Google reviews', 7,
      'Make asking routine: a QR code at the counter and a text with your review link after every visit.');
    else rev('pass', `${n} Google reviews${rated}. Keep them coming: recent reviews count the most.`);
  }

  // ---- turning visitors into customers
  const tools = (s && s.tools) || [], nobook = V.booking === false ? 10 : 18;
  const broken = !a.website || (s && (['profile', 'down', 'parked', 'placeholder', 'expired', 'unregistered'].includes(s.kind) || s.notMine || (s.kind === 'site' && s.parked)));
  const book = (status, text, extra) => add('win', 'Online booking', status, text, extra);
  const request = V.booking === false ? 'an appointment request link (a simple form is enough)' : 'a booking link';
  const button = V.booking === false ? '"Request an appointment" button (a simple form is enough)' : '"Book now" button linked to an online booking page';
  const bookers = tools.map((t) => t.name).filter((n) => BOOKING_TOOLS.includes(n));
  if (checked && bookers.length > 1) book('warn', `Customers can book online, but through ${bookers.length === 2 ? 'two' : bookers.length} systems, ${both(bookers)}, so they can see different openings and you have more than one calendar to keep right.`, { short: 'Online booking runs on more than one system', w: 8, books: true,
    fix: 'If that isn\'t on purpose, keep one and point every "Book" button at it.' });
  else if (checked && tools.length) book('pass', `Customers can book online through ${tools[0].name}.`, { books: true });
  else if (checked && s.bookingWords) book('pass', 'Your site asks visitors to book or request an appointment.', { books: true });
  else if (bookable) book('pass', `Customers can book online through your ${profileName}.`, { books: true });
  else if (checked) book('fail', "We couldn't find a way to book or request an appointment on your site, so people who find you after hours can only call back later, and many won't.", { short: 'No way to book online', w: nobook,
    fix: `Add a ${button}, and put the same link on your Google listing.` });
  else if (broken) book('fail', "We couldn't find a way for customers to book with you online, so after hours the only option is to call back later.", { short: 'No way to book online', w: nobook, src: a.website ? 'live' : 'listing',
    fix: `Add ${request} to your Google listing, so people can reach you after hours even before your website works.` });
  if (checked) {
    const digits = String(a.phone || '').replace(/\D/g, '').slice(-10);
    if (s.tel) add('win', 'Tap to call', 'pass', 'Your phone number is a tap-to-call button.');
    else add('win', 'Tap to call', 'warn', "Your phone number isn't a tap-to-call button, the quickest way for someone on a phone to reach you.", { short: 'No tap-to-call button', brief: "Your phone number isn't a tap-to-call button", w: 4,
      fix: `Turn the number into a phone link${digits.length === 10 ? ` (tel:+1${digits})` : ''}: in most site builders, select it, add a link and choose "Phone".` });
    const x = s.extras || {};
    const spotted = [...tools.map((t) => t.name), ...(x.analytics || []), ...(x.pay || []), ...(x.chat || []), ...(x.mail || [])].filter((v, i, l) => l.indexOf(v) === i).slice(0, 4);
    if (spotted.length) add('win', 'Software', 'info', `We spotted ${both(spotted)} on your site. Anything we set up works alongside ${spotted.length > 1 ? 'them' : 'it'}.`);
  }
  return out;
}

// What we'd set up: the three that matter most for this business, then more we could build.
// A website comes first when the site is the problem; then getting found on Google, this kind
// of business's main automation, the ones that fix what we found, and the rest, from what the
// site is missing (payments, a quote form, a text button, visitor tracking, an app tune-up).
// Nothing a tool they already use does on its own.
const NUDGE = {
  auto: 'Customers get a friendly text when their next service or smog check is due, so they come back to you.',
  groom: 'Regulars get a "time for Bella\'s next groom" text when they\'re due, so the book stays full.',
  detail: 'Past customers get a reminder when their next detail or coating maintenance is due.',
  dojo: 'Students who stop showing up get a friendly nudge to come back, before they cancel.',
  barber: 'Clients get a "time for your next cut?" text a few weeks after each visit.',
};
const SHOP_SOFTWARE = ['Tekmetric', 'Shopmonkey', 'Mitchell 1', 'Urable', 'Mobile Tech RX', 'ServiceTitan', 'Housecall Pro', 'Jobber', 'Workiz'];
const COVERED = {
  'Estimates & quotes': SHOP_SOFTWARE,
  'Invoices & payment reminders': SHOP_SOFTWARE,
  'Review requests': ['Podium', 'Birdeye', 'NiceJob', 'Broadly', 'Demandforce', 'Weave', 'Steer'],
  'Text-us button on your site': ['Podium', 'Birdeye', 'Broadly', 'Weave'],
  'Rebooking nudges': ['Demandforce', 'Steer', 'AutoVitals'],
};
function plan(a, found) {
  const V = a.vertical, s = a.site && a.site.kind ? a.site : {}, x = s.extras || {};
  const area = (a.areas || [])[0] || '';
  const issue = (label) => found.find((c) => c.short && c.label === label);
  const seo = found.filter((c) => c.short && c.section === 'find' && c.label !== 'Google reviews');
  const TEXT = {
    'Get found on Google': [`${seo.length > 1 ? `The ${seo.length} Google fixes above, done for you,` : 'Your page title, description and business details set up'} so you show up when people search for a ${V.noun}${area ? ` in ${area}` : ' nearby'}.`, `Show up when people nearby search for a ${V.noun}.`],
    'Missed-call text-back': [`When you can't pick up, the caller gets a text within seconds with a way to book, so they don't try the next ${V.noun}.`, 'Every missed caller gets a text back in seconds.'],
    'Online booking + reminders': ['Customers book any time, even after hours, and get a reminder the day before, which cuts no-shows.', 'Booking any time, with reminders that cut no-shows.'],
    'Review requests': ['After each visit, every customer gets a thank-you text with your Google review link. More reviews help you show up first nearby.', 'Every customer gets your Google review link.'],
    'Rebooking nudges': [NUDGE[V.k] || 'Customers get a friendly "time to come back?" text a few weeks after each visit.', 'A text when a customer is due to come back.'],
    'Estimates & quotes': ['Quote requests come in with the details you need, and every estimate gets a friendly follow-up, so fewer jobs walk.', 'Quote requests with automatic follow-ups.'],
    'App cleanup': ['You have an app: we can speed it up and fix the rough spots.', 'Speed up your app and fix the rough spots.'],
    'Website visitor tracking': ['See how many people visit your site, where they come from and what they tap. Nothing on your site tracks that today.', 'See who visits your site and what they tap.'],
    'Invoices & payment reminders': ["Send invoices by text, take payment online, and send polite reminders until they're paid.", 'Invoices by text, paid online, with reminders.'],
    'Text-us button on your site': ["Visitors can text you right from your website and you reply from your phone, so questions don't turn into lost jobs.", 'Visitors text you from your site; you reply from your phone.'],
    'Data entry / records': ['Customer and job details land in one place on their own instead of being typed in twice.', 'Customer and job details in one place, never typed twice.'],
  };
  const has = new Set((s.tools || []).map((t) => t.name));
  const booked = found.some((c) => c.books);
  const covered = (name) => (name === 'Online booking + reminders' && booked) || (COVERED[name] || []).some((t) => has.has(t));
  const offers = new Map();
  const offer = (name, score, text = TEXT[name]) => {
    if (text && !covered(name) && !(offers.has(name) && offers.get(name).score >= score)) offers.set(name, { name, score, long: text[0], short: text[1] });
  };

  const bad = issue('Website') || issue('Works on phones'), address = issue('Web address');
  if (bad) {
    const k = s.kind;
    const long = ['expired', 'unregistered'].includes(k) || (k === 'parked' && s.sale) ? 'A fast site on a web address you own, with your services, hours, reviews and a book-or-call button. We\'ll check whether your old address can be recovered.'
      : k === 'parked' || s.parked ? 'A fast site with your services, hours, reviews and a book-or-call button, connected to your web address so it stops showing a parking page.'
        : s.notMine ? 'A site of your own, with your services, hours, reviews and a book-or-call button, and your listing pointed at it.'
          : `One fast page with your services, hours, reviews and a book-or-call button, matched to your Google listing.${bad.label === 'Works on phones' ? ' We can rebuild it from the site you have now.' : ''}`;
    offer('A phone-first website', 100, [long, 'A fast site on your own web address, with booking and reviews.']);
  } else if (address) {
    // a working site on a free address: a quick job, not the headline
    const own = /^\S+ forwards/.test(address.text) ? hostOf(a.website) : '';
    offer('Your own web address', 50, [`${own ? `${own} connected to your site, so it's the address people see,` : 'Your site moved to a web address of your own,'} which looks more established and helps you show up on Google.`,
      own ? `${own} as the address people see.` : 'Your site on a web address of your own.']);
  }
  if (issue('Visible to Google') || seo.length >= 2) offer('Get found on Google', bad ? 90 : 95);
  else if (seo.length) offer('Get found on Google', 45);
  const main = V.workflows.find((w) => !covered(w));
  if (main) offer(main, 85);
  if (issue('Google reviews') && V.workflows.includes('Review requests')) offer('Review requests', 78);
  if (issue('Online booking') && V.workflows.includes('Online booking + reminders')) offer('Online booking + reminders', 76);
  V.workflows.forEach((w, i) => offer(w, 62 - i * 3));
  offer('Missed-call text-back', 58);
  const realSite = s.kind === 'site' && !s.notMine && !s.parked;
  const statsBuiltIn = /Wix|Squarespace|GoDaddy|Weebly|Square|Shopify|Duda|Webflow/.test(s.builder || '') || !!s.freeHost;
  if (realSite && x.app) offer('App cleanup', 55);
  if (realSite && !x.analytics && !statsBuiltIn) offer('Website visitor tracking', 46);
  const jobs = ['auto', 'body', 'detail', 'custom'].includes(V.k);
  if (jobs && !x.pay) offer('Invoices & payment reminders', 44);
  if (jobs && !x.form) offer('Estimates & quotes', 40);
  if (realSite && !x.chat) offer('Text-us button on your site', 36);
  offer('Review requests', 32);
  offer('Rebooking nudges', 30);
  offer('Data entry / records', 20);
  const ranked = [...offers.values()].sort((p, q) => q.score - p.score);
  return { top: ranked.slice(0, 3), more: ranked.slice(3, 7) };
}

// ================================================================ layout
// Text cut to a width with an ellipsis.
const fit = (s, font, size, max) => {
  if (width(s, font, size) <= max) return s;
  while (s && width(s + '…', font, size) > max) s = s.slice(0, -1);
  return s.trimEnd() + '…';
};

// An audit fits on two pages, one sheet printed double-sided. When everything won't fit, the Google
// listing checklist goes first, then "More we could build" shrinks to one line and goes, then the
// fixes for the smallest problems.
export const KEEP = [{ listing: true, more: 4, fixes: 99 }, { more: 4, fixes: 99 }, { more: 4, brief: true, fixes: 99 }, { more: 0, fixes: 99 }, { more: 0, fixes: 6 }, { more: 0, fixes: 3 }, { more: 0, fixes: 0 }];
const GOOD = 'Your online basics look solid. The next step is making sure every call and every customer gets followed up.';
const SPARSE = "We couldn't check much automatically this time. A short visit fills in the rest.";

// input: an audit as auditInput() makes it. keep: one of KEEP.
function drawAudit(doc, input, keep = KEEP[0]) {
  const V = input.vertical, title = cleanName(input.name) || 'Your business';
  // A long name reads badly mid-sentence, so sentences say "your shop" instead.
  const biz = cleanName(input.name) && title.length <= 38 ? title.replace(/\.+$/, '') : /^(shop|studio|school)$/.test(V.noun) ? `your ${V.noun}` : 'your business';
  const a = { ...input, biz, fullName: cleanName(input.name).replace(/\.+$/, '') }, found = checks(a), { top: recs, more: extra } = plan(a, found);
  const more = extra.slice(0, keep.more);
  const counted = found.filter((c) => c.status !== 'info' && c.status !== 'unknown');
  const passed = counted.filter((c) => c.status === 'pass').length;
  const issues = found.filter((c) => c.short).sort((x, y) => y.w - x.w);
  const fixed = new Set(issues.filter((c) => c.fix).slice(0, keep.fixes));
  const body = '#2a3350';
  const first = doc.addPage();
  let y = 0;

  const newPage = () => {
    doc.addPage();
    doc.text(M, 45, fit(`${title} · Online presence audit`, 'R', 8.5, CW - 50), { size: 8.5, color: MUTED });
    logo(doc, PAGE_W - M - 26, 30, 26);
    doc.line(M, 60, PAGE_W - M, 60);
    y = 80;
  };
  const need = (h) => {
    if (y + h > BOTTOM) newPage();
  };

  // header: logo and wordmark, what this is and when
  logo(doc, M, 36, 32);
  wordmark(doc, M + 42, 51.5, 12);
  const contact = [BRAND.site, BRAND.phone].filter(Boolean).join(' · ');
  doc.text(M + 42, 65, contact, { size: 8, color: MUTED });
  linkify(doc, M + 42, 65, contact, 8, 'R');
  const kicker = 'ONLINE PRESENCE AUDIT';
  doc.text(PAGE_W - M - width(kicker, 'B', 8.5) - 1.4 * (kicker.length - 1), 48, kicker, { font: 'B', size: 8.5, color: ACCENT, tc: 1.4 });
  const when = `Prepared ${a.date}`;
  doc.text(PAGE_W - M - width(when, 'R', 9), 61, when, { size: 9, color: MUTED });
  doc.rect(M, 76, CW, 2, { fill: INK });
  y = 93;

  // who it's for
  y += para(doc, M, y, title, { font: 'B', size: 22, lead: 26 });
  const scope = `What Google${a.website ? ` and ${hostOf(a.website)} show` : ' shows'} customers, where it goes wrong, and how to fix it.`;
  y += para(doc, M, y + 3, scope, { size: 10.5, color: body, lead: 14 }) + 4;
  const where = [a.btype || V.label, a.address, a.phone].filter(Boolean).join(' · ');
  if (where) y += para(doc, M, y + 2, where, { size: 10, color: MUTED, lead: 14 });
  y += 14;

  // summary: how many checks passed, a bar with one block per check, the biggest openings
  // a score needs a few checks behind it; with almost nothing checkable, don't pretend
  const scored = counted.length >= 3, summary = scored ? GOOD : SPARSE;
  // several small Google gaps read better as one line here (each still gets its own row below)
  const gaps = issues.filter((c) => c.section === 'find' && c.label !== 'Google reviews' && c.label !== 'Visible to Google');
  const ranked = gaps.length < 2 ? issues : [...issues.filter((c) => !gaps.includes(c)),
    { short: `${gaps.length} things holding you back on Google`, w: 8 + gaps.length, status: gaps.some((c) => c.status === 'fail') ? 'fail' : 'warn' }].sort((x, y) => y.w - x.w);
  const top3 = ranked.slice(0, 3), rightX = M + 176, rightW = PAGE_W - M - 16 - rightX;
  const listH = top3.length ? top3.reduce((t, c) => t + paraH(c.short, 'R', 10, rightW - 16, 14), 0) : paraH(summary, 'R', 10, rightW, 14);
  const boxH = Math.max(76, listH + 46);
  doc.rect(M, y, CW, boxH, { fill: SOFT, r: 8 });
  const by = y + boxH / 2;
  const [bigText, small] = scored ? [`${passed} of ${counted.length}`, 'checks passed'] : issues.length ? [String(issues.length), issues.length === 1 ? 'thing to fix' : 'things to fix'] : ['First look', 'the rest in person'];
  doc.text(M + 18, by - 6, bigText, { font: 'B', size: scored || issues.length ? 28 : 20, color: INK });
  doc.text(M + 18, by + 10, small, { size: 9.5, color: MUTED });
  if (scored) {
    const segW = Math.min(14, (138 - 2.5 * (counted.length - 1)) / counted.length);
    counted.forEach((c, i) => doc.rect(M + 18 + i * (segW + 2.5), by + 19, segW, 6, { fill: c.status === 'pass' ? OK : severity(c)[2], r: 1.5 }));
  }
  doc.line(rightX - 16, y + 16, rightX - 16, y + boxH - 16, { color: LINE });
  doc.text(rightX, y + 25, top3.length ? (top3.length > 1 ? 'The biggest problems' : 'The biggest problem') : scored ? 'In good shape' : 'What we could check', { font: 'B', size: 10.5, color: INK });
  let ly = y + 33;
  if (top3.length) {
    top3.forEach((c, i) => {
      doc.text(rightX, ly + 10, `${i + 1}`, { font: 'B', size: 10, color: severity(c)[2] });
      ly += para(doc, rightX + 16, ly + 2, c.short, { size: 10, lead: 14, max: rightW - 16 });
    });
  } else para(doc, rightX, ly + 2, summary, { size: 10, lead: 14, max: rightW, color: body });
  y += boxH + 18;

  // the checks, section by section: problems in full, what's fine as a short list of ticks
  const TX = M + 136, TW = PAGE_W - M - TX, CHIP = CW / 3, FIX = 'Fix:';
  // a problem in full, then what to do about it
  const rowLines = (c) => (c.items ? [] : wrap(c.text, 'R', 9.5, TW));
  const fixLines = (c) => (fixed.has(c) ? leadLines(FIX, c.fix, 9.5, TW) : []);
  // a small problem as a bullet: what's wrong in bold, then the fix
  const bullet = (c) => {
    const lead = `${c.brief || c.short}.`;
    return fixed.has(c) ? leadLines(lead, c.fix, 9.5, TW - 10) : wrap(lead, 'B', 9.5, TW - 10);
  };
  const bulletsH = (c) => c.items.reduce((t, x) => t + bullet(x).length * 13 + 3, -3);
  const rowH = (c) => Math.max((c.items ? bulletsH(c) : (rowLines(c).length + fixLines(c).length) * 13 + (fixed.has(c) ? 4 : 0)) + 10, c.short || c.status === 'unknown' ? 36 : 0);
  const dated = `We checked on ${a.checkedOn || a.date}`;
  SECTIONS.forEach(([sec, name], si) => {
    const rows = found.filter((c) => c.section === sec);
    if (!rows.length) return;
    const fine = rows.filter((c) => c.status === 'pass'), small = rows.filter((c) => c.short && c.w < 6);
    const open = small.length < 2 ? rows.filter((c) => c.status !== 'pass')
      : [...rows.filter((c) => c.status !== 'pass' && c.status !== 'info' && !small.includes(c)), { label: 'Smaller problems', short: 'x', w: 0, src: small[0].src, items: small }, ...rows.filter((c) => c.status === 'info')];
    const chipRows = Math.ceil(fine.length / 3);
    need(22 + (open.length ? rowH(open[0]) : chipRows * 16));
    heading(doc, y, name);
    if (!si) doc.text(PAGE_W - M - width(dated, 'R', 8.5), y + 8, dated, { size: 8.5, color: MUTED });
    y += 18;
    // a section that carries on over a page break says so; rows never split
    const room = (h) => {
      const pg = doc.pages.length;
      need(h);
      if (doc.pages.length === pg) return true;
      y += heading(doc, y, `${name} (continued)`);
      return false;
    };
    open.forEach((c, i) => {
      const lines = rowLines(c), todo = fixLines(c), h = rowH(c);
      if (room(h) && i) doc.line(M, y, PAGE_W - M, y, { color: '#e6e8ef' });
      const base = y + 14.5, fixBase = base + lines.length * 13 + 4;
      doc.text(M, base, c.label, { font: 'B', size: 10, color: INK });
      if (c.short || c.status === 'unknown') tag(doc, M, base + 6, c);
      lines.forEach((l, j) => doc.text(TX, base + j * 13, l, { size: 9.5, color: body }));
      let bt = base;
      (c.items || []).forEach((x) => {
        const bl = bullet(x), lead = `${x.brief || x.short}.`, done = fixed.has(x);
        doc.circle(TX + 2.5, bt - 3.2, 1.6, INK);
        bl.forEach((l, j) => {
          if (!j && done) doc.text(TX + 10, bt, lead, { font: 'B', size: 9.5, color: INK });
          doc.text(TX + 10 + (j || !done ? 0 : width(lead + ' ', 'B', 9.5)), bt + j * 13, l, { font: done || j ? 'R' : 'B', size: 9.5, color: done ? body : INK });
        });
        bt += bl.length * 13 + 3;
      });
      todo.forEach((l, j) => {
        if (!j) doc.text(TX, fixBase, FIX, { font: 'B', size: 9.5, color: ACCENT });
        doc.text(TX + (j ? 0 : width(FIX + ' ', 'B', 9.5)), fixBase + j * 13, l, { size: 9.5, color: INK });
      });
      y += h;
    });
    if (fine.length) {
      if (room(chipRows * 16 + 6) && open.length) {
        doc.line(M, y, PAGE_W - M, y, { color: '#e6e8ef' });
        y += 4;
      }
      fine.forEach((c, i) => {
        const x = M + (i % 3) * CHIP, cy = y + Math.floor(i / 3) * 16 + 9;
        mark(doc, x + 6, cy, 'pass', 5.5);
        doc.text(x + 16, cy + 3.4, fit(c.fine, 'R', 9.5, CHIP - 20), { size: 9.5, color: body });
      });
      y += chipRows * 16 + 2;
    }
    y += 12;
  });

  // the owner's Google listing, which no automated check can see: boxes to tick
  if (keep.listing) {
    const ticks = listing(a), LW = (CW - 18) / 2, tickLines = (t) => wrap(t, 'R', 9.5, LW - 16);
    const tickRows = [];
    for (let i = 0; i < ticks.length; i += 2) tickRows.push(Math.max(tickLines(ticks[i]).length, ticks[i + 1] ? tickLines(ticks[i + 1]).length : 0) * 12.5 + 6);
    const listIntro = "We can't see these from outside, so check them in your Google Business Profile. Each takes a few minutes.";
    need(18 + paraH(listIntro, 'R', 9, CW, 12) + 8 + tickRows.reduce((t, h) => t + h, 0) + 12);
    y += heading(doc, y, 'Your Google listing');
    y += para(doc, M, y, listIntro, { size: 9, color: MUTED, lead: 12 }) + 8;
    ticks.forEach((t, i) => {
      const x = M + (i % 2) * (LW + 18), top = y + tickRows.slice(0, Math.floor(i / 2)).reduce((sum, h) => sum + h, 0);
      doc.rect(x + 0.5, top + 1, 9, 9, { stroke: ACCENT, lw: 1, r: 2 });
      tickLines(t).forEach((l, j) => doc.text(x + 16, top + 9 + j * 12.5, l, { size: 9.5, color: body }));
    });
    y += tickRows.reduce((sum, h) => sum + h, 0) + 12;
  }
  y += 4;

  // the plan, more we could build and the next step stay together: on this page if they fit,
  // else the next
  const GAP = 18, colW = (CW - 2 * GAP) / 3, MW = (CW - GAP) / 2;
  const recTitle = (r) => wrap(r.name, 'B', 10.5, colW - 26);
  const recH = Math.max(...recs.map((r) => Math.max(18, recTitle(r).length * 13) + 6 + paraH(r.long, 'R', 9.5, colW, 13)));
  const moreH = (o) => 12 + paraH(o.short, 'R', 9, MW - 10, 11.5) + 7;
  const moreRows = [];
  for (let i = 0; i < more.length; i += 2) moreRows.push(Math.max(moreH(more[i]), more[i + 1] ? moreH(more[i + 1]) : 0));
  const MORE = 'More we could build:', moreText = `${both(more.map((o) => o.name))}.`;
  const moreBlock = !more.length ? 0 : keep.brief ? leadLines(MORE, moreText, 9.5, CW).length * 13 + 12 : 20 + moreRows.reduce((t, h) => t + h, 0) + 6;
  const from = ((a.from || []).length ? a.from : [BRAND.name, BRAND.phone, BRAND.site].filter(Boolean))
    .flatMap((l) => String(l).split(/\s+·\s+|\s+\|\s+/)).map(clean).filter(Boolean);
  const fromW = 140, ctaW = CW - 28 - fromW - 24;
  const fromLines = from.flatMap((l, i) => wrap(l, i ? 'R' : 'B', i ? 9 : 10, fromW).map((t) => [t, i]));
  const ctaText = "Questions about anything here? We're happy to go through these findings with you and help with whichever fixes you choose, whether you do them yourself or want a hand.";
  const ctaH = Math.max(paraH(ctaText, 'R', 9.5, ctaW, 13) + 34, fromLines.length * 13 + 28);
  const note = `How we checked: on ${a.checkedOn || a.date} we ${a.website ? `opened ${hostOf(a.website)}${a.site && a.site.domain ? ', looked up who holds the domain,' : ''} and ` : ''}read your public map listing${known(a.reviews) ? ' and Google reviews' : ''}. This first look is automated, so tell us if anything here is off. It doesn't cover your hours and phone number on Apple Maps, Yelp and other directories, your photos, or where you show up on the map around you; a full audit does.`;
  const intro = 'Picked from what we found above, most useful first.';
  const planH = 18 + paraH(intro, 'R', 9, CW, 12) + 8 + recH + 14 + moreBlock + ctaH + 9 + paraH(note, 'R', 8, CW, 10.5);
  need(planH);

  const setUp = `What we'd set up for ${biz}`;
  y += heading(doc, y, width(setUp.toUpperCase(), 'B', 8.5) + 1.4 * setUp.length < CW ? setUp : "What we'd set up");
  y += para(doc, M, y, intro, { size: 9, color: MUTED, lead: 12 }) + 8;
  recs.forEach((r, i) => {
    const x = M + i * (colW + GAP), t = recTitle(r);
    doc.rect(x, y, 18, 18, { fill: ACCENT, r: 4 });
    const n = String(i + 1);
    doc.text(x + 9 - width(n, 'B', 10) / 2, y + 12.6, n, { font: 'B', size: 10, color: '#ffffff' });
    t.forEach((l, j) => doc.text(x + 26, y + 12.8 + j * 13, l, { font: 'B', size: 10.5, color: INK }));
    para(doc, x, y + Math.max(18, t.length * 13) + 6, r.long, { size: 9.5, lead: 13, max: colW, color: body });
  });
  y += recH + 14;

  // other things we could build, from what the site is missing (just their names when space is short)
  if (more.length && keep.brief) {
    leadLines(MORE, moreText, 9.5, CW).forEach((l, i) => {
      if (!i) doc.text(M, y + 8, MORE, { font: 'B', size: 9.5, color: INK });
      doc.text(M + (i ? 0 : width(MORE + ' ', 'B', 9.5)), y + 8 + i * 13, l, { size: 9.5, color: body });
    });
    y += moreBlock;
  } else if (more.length) {
    doc.text(M, y + 9, 'More we could build for you', { font: 'B', size: 10.5, color: INK });
    y += 20;
    more.forEach((o, i) => {
      const x = M + (i % 2) * (MW + GAP), top = y + moreRows.slice(0, Math.floor(i / 2)).reduce((t, h) => t + h, 0);
      doc.circle(x + 3, top + 5.5, 2.3, ACCENT);
      doc.text(x + 10, top + 9, fit(o.name, 'B', 10, MW - 10), { font: 'B', size: 10, color: INK });
      para(doc, x + 10, top + 12.5, o.short, { size: 9, lead: 11.5, max: MW - 10, color: MUTED });
    });
    y += moreRows.reduce((t, h) => t + h, 0) + 6;
  }

  // next step, and who to reach (the sign-off from "Your details", one item per line)
  doc.rect(M, y, CW, ctaH, { stroke: ACCENT, lw: 1.2, r: 8 });
  doc.text(M + 14, y + 21, 'Next step', { font: 'B', size: 12, color: INK });
  para(doc, M + 14, y + 27, ctaText, { size: 9.5, lead: 13, max: ctaW, color: body });
  const fx = PAGE_W - M - 14 - fromW;
  doc.line(fx - 12, y + 14, fx - 12, y + ctaH - 14, { color: LINE });
  fromLines.forEach(([l, i], j) => {
    const base = y + 22 + j * 13, font = i ? 'R' : 'B', size = i ? 9 : 10;
    doc.text(fx, base, l, { font, size, color: i ? MUTED : INK });
    linkify(doc, fx, base, l, size, font);
  });
  y += ctaH + 9;
  para(doc, M, y, note, { size: 8, color: MUTED, lead: 10.5 });

  // footers, now that we know how many pages this audit took
  const last = doc.pages.length - 1;
  for (let i = first; i <= last; i++) {
    doc.onPage(i);
    doc.line(M, PAGE_H - 40, PAGE_W - M, PAGE_H - 40);
    doc.text(M, PAGE_H - 26, fit(`${title} · Online presence audit · ${a.date}`, 'R', 8, CW - 50), { size: 8, color: MUTED });
    const pg = `${i - first + 1} / ${last - first + 1}`;
    doc.text(PAGE_W - M - width(pg, 'R', 8), PAGE_H - 26, pg, { size: 8, color: MUTED });
  }
  return { title: String(input.name || '').trim() || title, page: first };
}

// ================================================================ API

const newDoc = () => Doc({ shadings: SHADES, ink: INK, rule: LINE });
const named = (a) => ({ ...a, biz: cleanName(a.name).replace(/\.+$/, '') || 'your business', fullName: cleanName(a.name).replace(/\.+$/, '') });

// What an audit needs to know about a business on the call list. site: its latest website check
// (or null); from: the sign-off lines; today: "YYYY-MM-DD" (for tests; defaults to today).
export function auditInput(p, { site = null, from = [], today } = {}) {
  return {
    name: p.name, btype: p.btype, address: p.address, phone: p.phone, website: p.website, rating: p.rating, reviews: p.reviews,
    site, areas: placesOf(p), vertical: vOf(p.vertical),
    year: Number(String(today || new Date().getFullYear()).slice(0, 4)),
    date: longDate(today), checkedOn: longDate((site && site.at) || today), from,
  };
}

// audits: one or more businesses (auditInput). Returns the PDF file's bytes.
export function pdf(audits, { author = BRAND.name } = {}) {
  const doc = newDoc();
  const marks = audits.map((a) => {
    // each audit is laid out on its own, as fully as two pages allow, then added to the file
    let one, mark;
    for (const keep of KEEP) {
      one = newDoc();
      mark = drawAudit(one, a, keep);
      if (one.pages.length <= 2) break;
    }
    doc.pages.push(...one.pages);
    return { ...mark, page: doc.pages.length - one.pages.length };
  });
  return doc.bytes({
    title: audits.length === 1 ? `${marks[0].title} · Online presence audit` : `Online presence audits (${audits.length} businesses)`,
    author,
    bookmarks: marks,
  });
}

// How many pages an audit takes at one level of detail (one of KEEP), which is what pdf() tries,
// most detailed first.
export function pagesAt(input, keep) {
  const doc = newDoc();
  drawAudit(doc, input, keep);
  return doc.pages.length;
}

// A safe file name for one audit: "Copperline Auto Care - online audit.pdf".
export function fileName(name) {
  const n = cleanName(name).replace(/[\\/:*?"<>|#%{}~]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return (n || 'Business') + ' - online audit.pdf';
}

// The checks and the plan without the layout (for tests, and to see what an audit will say).
export const auditChecks = (a) => checks(named(a));
export const auditPlan = (a) => {
  const x = named(a);
  return plan(x, checks(x));
};
