#!/usr/bin/env node
// Builds the demo's data. Every business in it is fictional.
//
//   public/data/places/*.json      a small business list, in the format scripts/build-places.py writes
//   public/data/demo-checks.json   a website check for every website in that list
//
// The website checks aren't written by hand. Each business's website gets a scenario (a parked
// domain, a placeholder page, a dated site, an expired registration...); the scenario becomes
// synthetic pages, redirects and registry (RDAP) records; and the real checker,
// functions/lib/site-check.js, runs against them with fetch mocked. The demo shows exactly what
// the checker reports for sites like these, and this script fails if a scenario stops producing
// the result it's meant to.
//
// Phone numbers are 555-01xx (reserved for fiction), websites and emails use the reserved .test
// domain, and the coordinates are spread around real Los Angeles neighborhood centers.
// The output is deterministic (a seeded random generator and a fake clock), so CI can check that
// the committed files are current:  npm run build:demo && git diff --exit-code public/data
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from '../functions/lib/site-check.js';
import { cleanHint } from '../functions/api/prospects.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const NOW = Date.UTC(2026, 9, 1, 17, 0, 0); // the fake clock starts here: Oct 1, 2026
const YEAR = 2026;

// ---------------------------------------------------------------- a seeded random generator

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261001);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + rand() * (b - a);
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

// ---------------------------------------------------------------- where

// Neighborhoods of the City of Los Angeles, with their centers (the same as REGION.areas in
// public/js/config.js) and ZIP codes.
const HOODS = {
  VN: ['Van Nuys', 34.1899, -118.4514, ['91401', '91405', '91411']],
  LB: ['Lake Balboa', 34.1965, -118.4945, ['91406']],
  SO: ['Sherman Oaks', 34.1508, -118.449, ['91403', '91423']],
  PC: ['Panorama City', 34.2247, -118.449, ['91402']],
  NH: ['North Hollywood', 34.1722, -118.3789, ['91601', '91605', '91606']],
  VV: ['Valley Village', 34.1647, -118.3965, ['91607']],
  SC: ['Studio City', 34.1486, -118.3965, ['91604']],
  EN: ['Encino', 34.1592, -118.5012, ['91316', '91436']],
};
const BOX = [-118.56, 34.11, -118.33, 34.26]; // west, south, east, north
const STREETS = ['Alder St', 'Aspen Ave', 'Birch St', 'Cedar Ave', 'Elm St', 'Hazel Ave', 'Juniper St', 'Larch Ave', 'Linden St', 'Maple Ave', 'Oak St', 'Poplar Ave', 'Rowan St', 'Spruce Ave', 'Sycamore St', 'Walnut Ave', 'Willow St', 'Yew Ave'];

// ---------------------------------------------------------------- who: [name, Overture category, website scenario, neighborhood]
// A null scenario means no website on the listing.

const BUSINESSES = {
  auto: [
    ['Copperline Auto Care', 'automotive_repair', 'dated', 'VN'],
    ['Ridgeway Motor Works', 'automotive_repair', 'for-sale-afternic', 'VN'],
    ['Bluebird Garage', 'automotive_repair', 'expired', 'VN'],
    ['Ironleaf Automotive', 'automotive_repair', 'solid-suite', 'VN'],
    ['Northgate Brake & Tire', 'brake_service_and_repair', 'wix-noindex', 'VN'],
    ['Sorrelwood Auto Repair', 'automotive_repair', null, 'VN'],
    ['Larkspur Transmission', 'transmission_repair', 'parked-godaddy', 'LB'],
    ['Juniper Smog & Repair', 'emissions_inspection', 'wp-basic', 'VN'],
    ['Red Canyon Auto Service', 'automotive_service', 'coming-soon', 'VN'],
    ['Silver Fern Auto Electric', 'auto_electrical_repair', 'phone-mismatch', 'SO'],
    ['Granite Peak Auto', 'automotive_repair', 'profile', 'VN'],
    ['Oakhollow Garage', 'automotive_repair', 'not-mine', 'PC'],
    ['Westbrook Car Clinic', 'automotive_repair', 'slow', 'VN'],
    ['Harbor Light Auto Repair', 'automotive_repair', 'unregistered', 'VN'],
    ['Cobalt Engine Repair', 'engine_repair_service', 'solid', 'SO'],
    ['Firefly Muffler & Exhaust', 'exhaust_and_muffler_repair', 'default-page', 'VN'],
    ['Lantern Street Garage', 'automotive_repair', 'free-host', 'LB'],
    ['Bellwether Auto Care', 'automotive_repair', 'down-500', 'VN'],
    ['Kestrel Tire & Wheel', 'tire_dealer_and_repair', 'blocked', 'PC'],
    ['Tamarack Auto Service', 'automotive_service', 'filler', 'VN'],
    ['Driftwood Auto Repair', 'automotive_repair', null, 'SO'],
    ['Sagebrush Smog Check', 'emissions_inspection', 'thin', 'VN'],
    ['Amberline Automotive', 'automotive_repair', 'suspended', 'NH'],
    ['Foxglove Brake Center', 'brake_service_and_repair', 'host-home', 'VN'],
    ['Quarry Road Garage', 'automotive_repair', 'redirect-loop', 'LB'],
    ['Saltgrass Auto Repair', 'automotive_repair', 'parked-ns', 'SO'],
    ['Riverbend Transmission', 'transmission_repair', 'timeout', 'NH'],
    ['Thistle Auto Works', 'automotive_repair', 'expired-hold', 'PC'],
    ['Wildrose Motor Repair', 'automotive_repair', 'for-sale-words', 'VN'],
    ['Marigold Oil & Lube', 'oil_change_station', 'solid', 'NH'],
    ['Lube Depot Express #14', 'oil_change_station', 'solid', 'VN', { chain: 1 }],
    ['Hollowell Auto Repair', 'automotive_repair', 'moved', 'EN'],
    ['Summitview Garage', 'automotive_repair', null, 'SC'],
    ['Brightwater Auto Clinic', 'automotive_repair', 'solid', 'VV'],
    ['Corvid Motorworks', 'automotive_repair', 'dated', 'EN'],
    ['Halberd Truck & Auto', 'truck_repair', 'wp-basic', 'NH'],
  ],
  groom: [
    ['Wagtail Grooming Co.', 'pet_groomer', 'solid-suite', 'VN'],
    ['Blue Heron Pet Spa', 'pet_groomer', 'coming-soon', 'SO'],
    ['Tidepool Grooming', 'pet_groomer', null, 'VN'],
    ['Saffron Paw Grooming', 'pet_groomer', 'wix-noindex', 'NH'],
    ['Muddy Mutt Wash', 'pet_groomer', 'profile', 'LB'],
    ['Corgi Corner Grooming', 'pet_groomer', 'dated', 'VN'],
    ['Whisker Lane Pet Salon', 'pet_groomer', 'for-sale-afternic', 'SC'],
    ['Pine Cone Pet Grooming', 'pet_groomer', 'wp-basic', 'EN'],
    ['Snout & About Grooming', 'pet_groomer', null, 'PC'],
    ['Velvet Ear Grooming', 'pet_groomer', 'solid', 'VV'],
  ],
  detail: [
    ['Mirrorline Detailing', 'auto_detailing', 'dated', 'VN'],
    ['Glassbeam Window Tint', 'car_window_tinting', 'solid-suite', 'VN'],
    ['Obsidian Auto Spa', 'auto_detailing', 'expired', 'LB'],
    ['Clearcoat Collective', 'auto_detailing', 'free-host', 'SO'],
    ['Shadeworks Tint Studio', 'car_window_tinting', null, 'VN'],
    ['Polished Pine Detailing', 'auto_detailing', 'phone-mismatch', 'NH'],
    ['Sunstop Window Tinting', 'car_window_tinting', 'parked-godaddy', 'PC'],
    ['Luster Lab Detailing', 'auto_detailing', 'wix-noindex', 'VN'],
    ['Gleamhaus Car Care', 'car_wash', 'solid', 'EN'],
    ['Ceramic Coast Detail', 'auto_detailing', 'slow', 'SC'],
    ['Halo Hand Wash', 'car_wash', 'down-500', 'VV'],
    ['Graphite Wraps', 'vehicle_wrap', 'wp-basic', 'NH'],
  ],
  body: [
    ['Straightline Collision', 'auto_body_shop', 'dated', 'VN'],
    ['Panelcraft Collision', 'auto_body_shop', 'solid-suite', 'LB'],
    ['Bayleaf Auto Body', 'auto_body_shop', 'unregistered', 'VN'],
    ['Truefit Body Shop', 'auto_body_shop', null, 'PC'],
    ['Sable Paint & Body', 'auto_body_shop', 'wp-basic', 'SO'],
    ['Corbel Collision Center', 'auto_body_shop', 'host-home', 'VN'],
    ['Arrowwood Auto Body', 'auto_body_shop', 'solid', 'NH'],
    ['Northlight Body & Frame', 'auto_body_shop', 'blocked', 'VN'],
    ['Hollowbrook Collision', 'auto_restoration_service', 'filler', 'EN'],
    ['Steady Hand Body Works', 'auto_body_shop', 'for-sale-words', 'SC'],
  ],
  dojo: [
    ['Iron Crane Martial Arts', 'martial_arts_club', 'solid-suite', 'VN'],
    ['Willow Dragon Kung Fu', 'chinese_martial_arts_club', 'dated', 'SO'],
    ['Summit Ridge Jiu-Jitsu', 'martial_arts_club', 'wix-noindex', 'VN'],
    ['Red Lantern Karate', 'martial_arts_club', null, 'LB'],
    ['Tidewater Boxing Club', 'boxing_gym', 'solid', 'NH'],
    ['Black Pine Taekwondo', 'martial_arts_club', 'coming-soon', 'PC'],
    ['Kestrel Muay Thai', 'martial_arts_club', 'wp-basic', 'VN'],
    ['Granite Fist Boxing', 'boxing_gym', 'expired-hold', 'VV'],
    ['Blue Orchid Aikido', 'martial_arts_club', 'profile', 'SC'],
    ['Northwind MMA', 'gym', 'slow', 'EN'],
    ['Cypress Kickboxing', 'gym', 'phone-mismatch', 'VN'],
    ['Stonewall Judo Club', 'martial_arts_club', 'parked-ns', 'SO'],
  ],
  tattoo: [
    ['Nightjar Tattoo', 'tattoo_and_piercing', 'profile', 'NH'],
    ['Copper Needle Tattoo', 'tattoo_and_piercing', 'solid', 'VN'],
    ['Saint Sparrow Tattoo', 'tattoo_and_piercing', 'dated', 'NH'],
    ['Gilded Moth Tattoo', 'tattoo_and_piercing', null, 'SC'],
    ['Thornfield Tattoo Studio', 'tattoo_and_piercing', 'wix-noindex', 'VN'],
    ['Wolf & Willow Tattoo', 'tattoo_and_piercing', 'for-sale-afternic', 'SO'],
    ['Paper Crane Tattoo', 'tattoo_and_piercing', 'wp-basic', 'VV'],
    ['Ember & Ash Tattoo', 'tattoo_and_piercing', 'default-page', 'LB'],
  ],
  barber: [
    ['Sharp Line Barber Co.', 'barber', 'booking-profile', 'VN'],
    ['Bluejay Barbershop', 'barber', 'solid-suite', 'VN'],
    ['The Gentry Chair', 'barber', 'dated', 'SO'],
    ['Copper Comb Barbers', 'barber', null, 'VN'],
    ['Hazelwood Hair Studio', 'hair_salon', 'wix-noindex', 'NH'],
    ['Velvet Rose Salon', 'beauty_salon', 'solid-suite', 'SO'],
    ['Salt & Sage Hair', 'hair_salon', 'wp-basic', 'SC'],
    ['Lumen Hair Studio', 'hair_salon', 'coming-soon', 'VN'],
    ['Juniper Hair Bar', 'hair_salon', 'solid', 'VV'],
    ['Marlowe Cuts', 'barber', 'profile', 'LB'],
    ['Fable Hair Co.', 'hair_salon', 'expired', 'EN'],
    ['Petal & Pine Salon', 'beauty_salon', 'phone-mismatch', 'NH'],
    ['Ember Hair Lounge', 'hair_salon', null, 'PC'],
    ['Northside Fades', 'barber', 'booking-profile', 'PC'],
    ['Kindred Barber Co.', 'barber', 'slow', 'VN'],
    ['Silver Shears Salon', 'hair_salon', 'dated', 'SC'],
    ['Golden Hour Hair', 'hair_salon', 'free-host', 'VV'],
    ['Crown & Comb', 'barber', 'solid-suite', 'NH'],
    ["Tidy Tom's Barbers", 'barber', null, 'VN'],
    ['Willowbrook Salon', 'beauty_salon', 'parked-godaddy', 'SO'],
    ['Modern Mane', 'hair_salon', 'thin', 'EN'],
    ['Sable & Steel Barbers', 'barber', 'down-500', 'LB'],
    ['Bramble Hair Studio', 'hair_salon', 'wp-basic', 'VN'],
    ['Cedar Chair Barbershop', 'barber', 'unregistered', 'NH'],
  ],
  other: [
    ['Lotus Pond Nails', 'nail_salon', 'solid-suite', 'VN'],
    ['Quiet Harbor Massage', 'massage_therapy', 'wix-noindex', 'SO'],
    ['Fernwood Day Spa', 'day_spa', 'solid', 'EN'],
    ['Coolbreeze HVAC', 'hvac_service', 'dated', 'VN'],
    ['Steady Flow Plumbing', 'plumbing', 'solid-suite', 'NH'],
    ['Brightwire Electric', 'electrician', 'wp-basic', 'VN'],
    ['Sparrow Home Cleaning', 'home_cleaning', null, 'LB'],
    ['Turnkey Locksmiths', 'key_and_locksmith', 'for-sale-afternic', 'PC'],
    ['Petal Press Florist', 'florist', 'solid', 'SC'],
    ['Needle & Thread Alterations', 'tailor', null, 'VV'],
    ['Good Boy Dog Training', 'dog_trainer', 'profile', 'VN'],
    ['Treble Clef Music School', 'music_school', 'slow', 'SO'],
    ['Spin Step Dance Studio', 'dance_studio', 'coming-soon', 'NH'],
    ['Stillwater Yoga', 'yoga_studio', 'solid-suite', 'SC'],
    ['Core Lantern Pilates', 'pilates_studio', 'expired', 'EN'],
    ['Silverframe Photography', 'photography_service', 'wp-basic', 'VN'],
    ['ByteFix Computer Repair', 'computer_repair_service', 'dated', 'PC'],
    ['Cracked Screen Phone Repair', 'mobile_phone_repair', 'phone-mismatch', 'VN'],
    ["Cobbler's Bench Shoe Repair", 'shoe_repair', null, 'NH'],
    ['Rise & Crumb Bakery', 'bakery', 'solid', 'VV'],
    ['Inkline Print Shop', 'printing_service', 'down-500', 'VN'],
    ['Spoke & Chain Bike Repair', 'bike_repair_maintenance', 'wix-noindex', 'SC'],
    ['Steady Lane Driving School', 'driving_school', 'parked-godaddy', 'LB'],
    ['Bug Off Pest Control', 'pest_control_service', 'filler', 'VN'],
    ['Evergreen Yardworks', 'landscaping', null, 'EN'],
    ["Handy Hal's Repairs", 'handyman', 'thin', 'SO'],
    ['Coldspot Appliance Repair', 'appliance_repair_service', 'unregistered', 'NH'],
    ['Blue Lagoon Pool Service', 'pool_cleaning', 'solid', 'EN'],
    ['Fresh Pile Carpet Cleaning', 'carpet_cleaning', 'blocked', 'VN'],
    ['Tufted Upholstery', 'furniture_reupholstery', 'host-home', 'SO'],
  ],
};

// What each kind of business does, for the synthetic pages, and the tool its "suite" site uses
// (one the checker recognizes, functions/lib/signatures.js).
const TRADE = {
  auto: ['auto repair', ['Brakes and suspension', 'Check engine lights', 'Oil changes', 'Smog checks', 'Air conditioning'], 'https://shop.tekmetric.com/demo/'],
  groom: ['dog grooming', ['Full grooms', 'Bath and brush', 'Nail trims', 'Puppy first groom', 'De-shedding'], 'https://booking.moego.pet/ol/demo'],
  detail: ['auto detailing', ['Interior detail', 'Ceramic coating', 'Paint correction', 'Window tint', 'Headlight restoration'], 'https://app.urable.com/demo'],
  body: ['collision repair', ['Collision repair', 'Paintless dent repair', 'Frame straightening', 'Bumper repair', 'Insurance claims help'], 'https://app.shopmonkey.io/demo'],
  dojo: ['martial arts classes', ['Kids classes', 'Adult classes', 'Private lessons', 'Women\'s self-defense', 'Free trial class'], 'https://demo.zenplanner.com/zenplanner/'],
  tattoo: ['custom tattoos', ['Custom designs', 'Cover-ups', 'Fine line', 'Black and grey', 'Touch-ups'], 'https://book.squareup.com/appointments/demo'],
  barber: ['haircuts', ['Haircuts', 'Skin fades', 'Beard trims', 'Hot towel shaves', 'Kids cuts'], 'https://booksy.com/en-us/demo'],
  other: ['local service', ['Free estimates', 'Same-week appointments', 'Licensed and insured', 'Weekend hours', 'Satisfaction guaranteed'], 'https://www.vagaro.com/demo'],
};

// ---------------------------------------------------------------- pages

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const SCHEMA_TYPE = { auto: 'AutoRepair', groom: 'LocalBusiness', detail: 'AutoWash', body: 'AutoBodyShop', dojo: 'SportsActivityLocation', tattoo: 'TattooParlor', barber: 'HairSalon', other: 'LocalBusiness' };
const BUILDER_HEAD = {
  WordPress: '<link rel="stylesheet" href="/wp-content/themes/storefront/style.css">',
  Squarespace: '<link rel="stylesheet" href="https://static1.squarespace.com/static/versioned-site-css/demo/site.css">',
  Wix: '<script src="https://static.parastorage.com/services/wix-thunderbolt/dist/main.js"></script><link rel="preconnect" href="https://static.wixstatic.com">',
  '': '',
};

// A real website for business b. o: what's right and wrong with it.
function sitePage(b, o) {
  const [trade, services] = TRADE[b.k];
  const dial = o.dial || b.digits, shown = dial ? fmt(dial) : '';
  const title = o.title ?? `${b.name} | ${trade[0].toUpperCase() + trade.slice(1)} in ${b.city}`;
  const head = [
    o.mobile === false ? '' : `<meta name="viewport" content="width=device-width, initial-scale=1${o.noZoom ? ', maximum-scale=1' : ''}">`,
    o.desc === false ? '' : `<meta name="description" content="${esc(o.desc || `${b.name}: ${trade} in ${b.city}. ${services.slice(0, 3).join(', ')} and more. Call ${shown || 'us'} or book online.`)}">`,
    o.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    o.desc === false ? '' : `<meta property="og:title" content="${esc(b.name)}">`,
    BUILDER_HEAD[o.builder || ''],
    o.analytics === false ? '' : '<script async src="https://www.googletagmanager.com/gtag/js?id=G-DEMO000000"></script>',
    o.tool ? `<script async src="${o.tool}widget.js"></script>` : '',
    o.schema === false ? '' : `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': SCHEMA_TYPE[b.k], name: b.name, telephone: shown, address: { '@type': 'PostalAddress', streetAddress: b.street, addressLocality: b.city, addressRegion: 'CA', postalCode: b.zip } })}</script>`,
  ].filter(Boolean).join('\n');
  const phone = !dial ? '' : o.tel === false ? `<p>Call us: ${shown}</p>` : `<p><a class="call" href="tel:+1${dial}">Call ${shown}</a></p>`;
  const email = b.email ? `<p>Email: <a href="mailto:${b.email}">${b.email}</a></p>` : '';
  const book = o.booking === false ? '<p>Stop by or give us a call during business hours.</p>' : `<p><a class="book" href="${o.tool || '/book'}">Book an appointment</a></p>`;
  const where = o.mentionCity === false ? 'our neighborhood' : b.city;
  const imgs = Array.from({ length: o.imgs ?? 4 }, (_, i) => (i < (o.noAlt ?? 0) ? `<img src="/img/photo-${i + 1}.jpg">` : `<img src="/img/photo-${i + 1}.jpg" alt="${esc(services[i % services.length])} at ${esc(b.name)}">`)).join('\n');
  const body = [
    `<header><a href="/" class="logo">${esc(b.name)}</a><nav><a href="/services">Services</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav></header>`,
    `<h1>${esc(b.name)}</h1>`,
    `<p>Honest ${trade} for ${where} and the rest of the Valley since ${b.since}. We explain what we find, give you the price before we start, and keep you posted until the job is done.</p>`,
    phone,
    email,
    book,
    `<h2>What we do</h2><ul>${services.map((s) => `<li>${s}</li>`).join('')}</ul>`,
    o.filler ? '<h2>Our story</h2><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>' : '',
    `<h2>Visit us</h2><p>${esc(b.street)}, ${o.mentionCity === false ? '' : `${b.city}, `}CA ${b.zip}</p>`,
    '<h2>Hours</h2><table><tr><td>Monday to Friday</td><td>8:00 to 6:00</td></tr><tr><td>Saturday</td><td>9:00 to 3:00</td></tr><tr><td>Sunday</td><td>Closed</td></tr></table>',
    `<h2>Why customers come back</h2><p>We keep a record of every visit, so the next one starts where the last one ended. Estimates are written down before any work begins, and nothing is added to the bill without a call first. If something we did isn't right, we make it right.</p>`,
    imgs,
    `<p>Questions? Most answers are a short call away. We are a small team, and the person you talk to is the person who does the work. Parking is in front of the building, and we are easy to reach from the main boulevards nearby.</p>`,
    `<footer><p>&copy; ${o.year || YEAR} ${esc(b.name)}. All rights reserved.</p></footer>`,
  ].filter(Boolean).join('\n');
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// A page that belongs to someone else now: it never names the business or its trade.
const NOT_MINE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hartwell &amp; Pine | Estate Planning Attorneys</title>
<meta name="description" content="Estate planning, wills and trusts for families. Free consultations by phone or video.">
</head><body>
<header><a href="/">Hartwell &amp; Pine</a><nav><a href="/practice">Practice areas</a> <a href="/team">Our team</a> <a href="/contact">Contact</a></nav></header>
<h1>Plan ahead with confidence</h1>
<p>Hartwell &amp; Pine helps families put wills, living trusts and powers of attorney in place, so that the people they love are looked after and nothing is left to chance. We have been doing this work for more than twenty years.</p>
<h2>Practice areas</h2>
<ul><li>Wills and living trusts</li><li>Powers of attorney</li><li>Probate and trust administration</li><li>Special needs planning</li><li>Guardianship for minors</li></ul>
<p>Every new client starts with a free thirty-minute consultation. We listen first, explain the options in plain language, and give you a flat fee in writing before any work begins.</p>
<p>Our attorneys are members of the State Bar and speak English and Spanish. Evening appointments are available on request, and documents can be signed at our office or by video.</p>
<h2>What our clients say</h2>
<blockquote>They made a stressful process simple, and they answered every question we had.</blockquote>
<blockquote>Clear, kind and organized. We finally have a plan in place for our kids.</blockquote>
<p>Schedule your free consultation today. Hartwell &amp; Pine, Attorneys at Law.</p>
<footer><p>&copy; ${YEAR} Hartwell &amp; Pine LLP. Attorney advertising. Prior results do not guarantee a similar outcome.</p></footer>
${'<!-- layout spacer -->\n'.repeat(100)}</body></html>
`;

const small = (title, text, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${extraHead}</head><body>${text}</body></html>`;

// ---------------------------------------------------------------- registry records (RDAP)

const rdap = (b, { status = ['client transfer prohibited'], created = '2015-04-12', expires = '2027-04-12', registrar = 'GoDaddy.com, LLC', ns = ['ns51.domaincontrol.com', 'ns52.domaincontrol.com'] } = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/rdap+json' },
  body: JSON.stringify({
    objectClassName: 'domain', ldhName: b.domain, status,
    events: [{ eventAction: 'registration', eventDate: `${created}T18:04:11Z` }, { eventAction: 'expiration', eventDate: `${expires}T18:04:11Z` }],
    nameservers: ns.map((n) => ({ objectClassName: 'nameserver', ldhName: n })),
    entities: [{ objectClassName: 'entity', roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', registrar]]] }],
  }),
});

// ---------------------------------------------------------------- scenarios
// Each returns { pages: { url: response }, record: RDAP response or undefined, expect(result) }.

const ok = (body, extra) => ({ status: 200, body, ...extra });
const redirect = (to, status = 301) => ({ status, headers: { location: to } });
// A working site answers on https; its http address redirects there, as real ones do.
const secure = (b, res) => {
  const https = b.start.replace(/^http:/, 'https:');
  return b.start === https ? { [https]: res } : { [b.start]: redirect(https), [https]: res };
};
const fail = (msg) => (r) => {
  throw new Error(msg + ': ' + JSON.stringify(r).slice(0, 300));
};
const want = (test, msg) => (r) => test(r) || fail(msg)(r);
// a real site that isn't meant to look empty
const site = (test, msg) => want((r) => r.kind === 'site' && !r.thin && test(r), msg);

const SCENARIOS = {
  solid: (b) => ({ pages: secure(b, ok(sitePage(b, { builder: b.i % 2 ? 'Squarespace' : 'WordPress' }))), expect: site((r) => r.https && r.mobile && r.seo.schema && !r.movedTo, 'solid') }),
  'solid-suite': (b) => ({ pages: secure(b, ok(sitePage(b, { builder: 'WordPress', tool: TRADE[b.k][2] }))), expect: site((r) => r.tools.length > 0, 'suite') }),
  dated: (b) => ({
    pages: { [b.start]: ok(sitePage(b, { title: 'Home', mobile: false, desc: false, schema: false, tel: false, booking: false, analytics: false, year: 2016, imgs: 8, noAlt: 6 })) },
    expect: site((r) => !r.https && !r.mobile && r.year === 2016, 'dated'),
  }),
  'wix-noindex': (b) => ({
    pages: secure(b, ok(sitePage(b, { builder: 'Wix', title: 'Home', desc: `Welcome to ${b.name}.`, noindex: true, schema: false, booking: false, year: YEAR - 1 }))),
    expect: site((r) => r.builder === 'Wix' && r.seo.noindex, 'wix-noindex'),
  }),
  'wp-basic': (b) => ({
    pages: secure(b, ok(sitePage(b, { builder: 'WordPress', title: b.name, desc: false, schema: false, booking: false, mentionCity: false, year: YEAR - 4 }))),
    expect: site((r) => r.builder === 'WordPress' && r.onPage.area === false, 'wp-basic'),
  }),
  slow: (b) => ({ pages: secure(b, ok(sitePage(b, { builder: 'Squarespace', booking: false }), { latency: 6400 })), expect: site((r) => r.ms > 5000, 'slow') }),
  'phone-mismatch': (b) => ({
    pages: secure(b, ok(sitePage(b, { builder: 'WordPress', dial: b.otherDigits }))),
    expect: site((r) => r.phones[0] === b.otherDigits && r.onPage.phone === false, 'phone-mismatch'),
  }),
  'free-host': (b) => {
    const to = `https://${b.slug}-demo.wixsite.com/home`;
    return { pages: { [b.start]: redirect(to), [to]: ok(sitePage(b, { builder: 'Wix' })) }, expect: site((r) => r.freeHost === 'Wix' && r.movedTo, 'free-host') };
  },
  'not-mine': (b) => ({ pages: { [b.start]: ok(NOT_MINE) }, expect: site((r) => r.notMine, 'not-mine') }),
  filler: (b) => ({
    pages: secure(b, ok(sitePage(b, { builder: 'Squarespace', filler: true, noZoom: true, imgs: 10, noAlt: 7, schema: false }))),
    expect: site((r) => r.filler && r.noZoom, 'filler'),
  }),
  thin: (b) => ({
    pages: { [b.start]: ok(small(esc(b.name), `<h1>${esc(b.name)}</h1><p>Walk-ins welcome six days a week. ${b.phone ? `Call ${b.phone}.` : 'Ask about our hours.'}</p>`, '<meta name="viewport" content="width=device-width">')) },
    expect: want((r) => r.kind === 'site' && r.thin, 'thin'),
  }),
  moved: (b) => {
    // rebranded onto a new domain; the old one forwards to it
    const domain = b.slug.replace(/(auto)?repair$|garage$/, '') + 'auto.test', to = `https://www.${domain}/`;
    return { pages: { [b.start]: redirect(to), [to]: ok(sitePage(b, { builder: 'WordPress' })) }, expect: site((r) => r.movedTo === domain, 'moved') };
  },
  'parked-godaddy': (b) => ({
    pages: { [b.start]: ok(small(b.domain, '<div id="root"></div>', '<script src="https://img1.wsimg.com/parking-lander/static/js/main.d0a4ce3f.js"></script>')) },
    record: rdap(b, { expires: '2027-01-19' }),
    expect: want((r) => r.kind === 'parked' && r.by === 'GoDaddy' && !r.sale, 'parked-godaddy'),
  }),
  'for-sale-afternic': (b) => ({
    pages: { [b.start]: redirect(`https://www.afternic.com/forsale/${b.domain}?traffic_id=daslnc&traffic_type=TDFS`, 302) },
    record: rdap(b, { created: '2025-11-02', expires: '2026-11-02' }),
    expect: want((r) => r.kind === 'parked' && r.by === 'Afternic' && r.sale, 'for-sale-afternic'),
  }),
  'for-sale-words': (b) => ({
    pages: { [b.start]: ok(small(`${b.domain} is for sale`, `<h1>${b.domain}</h1><p>This domain is for sale! Make an offer today.</p>`, '<script src="https://sedoparking.com/frmpark/demo/park.js"></script>')) },
    record: rdap(b, { registrar: 'Sedo GmbH', ns: ['ns1.sedoparking.com', 'ns2.sedoparking.com'] }),
    expect: want((r) => r.kind === 'parked' && r.by === 'Sedo' && r.sale, 'for-sale-words'),
  }),
  'coming-soon': (b) => ({
    pages: { [b.start]: ok(small('Coming Soon', '<h1>Coming soon</h1><p>Our new website is on its way.</p>')) },
    record: rdap(b, { registrar: 'Squarespace Domains II LLC', ns: ['ns-cloud-a1.googledomains.com'] }),
    expect: want((r) => r.kind === 'placeholder' && r.reason === 'coming soon', 'coming-soon'),
  }),
  'default-page': (b) => ({
    pages: { [b.start]: ok(small('Welcome to nginx!', '<h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working.</p>')) },
    record: rdap(b, { registrar: 'Namecheap, Inc.', ns: ['dns1.registrar-servers.com'] }),
    expect: want((r) => r.kind === 'placeholder' && r.reason === 'default page', 'default-page'),
  }),
  suspended: (b) => ({
    pages: { [b.start]: ok(small('Account Suspended', '<h1>Account Suspended</h1><p>This account has been suspended. Contact your hosting provider for more information.</p>')) },
    record: rdap(b, { registrar: 'Tucows Domains Inc.', ns: ['ns1.demo-host.test'] }),
    expect: want((r) => r.kind === 'placeholder' && r.reason === 'suspended', 'suspended'),
  }),
  'host-home': (b) => ({
    pages: { [b.start]: redirect('https://www.squarespace.com/') },
    record: rdap(b, { registrar: 'Squarespace Domains II LLC', ns: ['ns-cloud-b1.googledomains.com'] }),
    expect: want((r) => r.kind === 'placeholder' && r.reason === 'host home' && r.by === 'Squarespace', 'host-home'),
  }),
  expired: (b) => ({
    pages: { [b.start]: { throws: 'dns' } },
    record: rdap(b, { status: ['client hold', 'redemption period'], created: '2012-07-14', expires: '2026-07-14', registrar: 'Namecheap, Inc.' }),
    expect: want((r) => r.kind === 'expired' && r.domain.ending, 'expired'),
  }),
  'expired-hold': (b) => ({
    pages: { [b.start]: { throws: 'dns' } },
    record: rdap(b, { status: ['client hold'], created: '2019-08-30', expires: '2026-08-30' }),
    expect: want((r) => r.kind === 'expired' && !r.domain.ending, 'expired-hold'),
  }),
  unregistered: (b) => ({ pages: { [b.start]: { throws: 'dns' } }, record: { status: 404 }, expect: want((r) => r.kind === 'unregistered', 'unregistered') }),
  'down-500': (b) => ({ pages: { [b.start]: { status: 500, body: 'Internal Server Error' } }, record: rdap(b), expect: want((r) => r.kind === 'down' && r.status === 500, 'down-500') }),
  timeout: (b) => ({ pages: { [b.start]: { throws: 'abort', latency: 7000 } }, record: rdap(b), expect: want((r) => r.kind === 'down' && /7 seconds/.test(r.error), 'timeout') }),
  blocked: (b) => ({ pages: { [b.start]: { status: 403, body: 'Forbidden' } }, record: rdap(b), expect: want((r) => r.kind === 'blocked' && r.status === 403, 'blocked') }),
  'redirect-loop': (b) => {
    const other = b.start + 'home';
    return { pages: { [b.start]: redirect(other, 302), [other]: redirect(b.start, 302) }, record: rdap(b), expect: want((r) => r.kind === 'down' && /loop/.test(r.error), 'redirect-loop') };
  },
  profile: (b) => {
    const to = b.k === 'tattoo' ? `https://www.instagram.com/${b.slug}.demo/` : `https://www.facebook.com/${b.slug}.demo`;
    return { pages: { [b.start]: redirect(to) }, expect: want((r) => r.kind === 'profile', 'profile') };
  },
  'booking-profile': (b) => ({ pages: { [b.start]: redirect(`https://booksy.com/en-us/${b.slug}-demo`) }, expect: want((r) => r.kind === 'profile' && r.profile === 'Booksy profile', 'booking-profile') }),
  'parked-ns': (b) => ({
    pages: { [b.start]: { throws: 'dns' } },
    record: rdap(b, { registrar: 'Dynadot Inc', ns: ['ns1.parkingcrew.net', 'ns2.parkingcrew.net'] }),
    expect: want((r) => r.kind === 'parked' && r.by === 'ParkingCrew', 'parked-ns'),
  }),
};

// ---------------------------------------------------------------- build

const slugOf = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const phones = [];
for (const area of ['818', '747']) for (let n = 100; n <= 199; n++) phones.push(`${area}555${String(n).padStart(4, '0')}`);
let nextPhone = 0;

const all = [];
let i = 0;
for (const [k, list] of Object.entries(BUSINESSES)) {
  for (const [name, type, scenario, hood, extra = {}] of list) {
    const [city, lat0, lon0, zips] = HOODS[hood];
    const r = Math.sqrt(rand()) * 0.9, th = rand() * 2 * Math.PI; // up to 0.9 miles from the center
    const lat = lat0 + (r * Math.cos(th)) / 69, lon = lon0 + (r * Math.sin(th)) / (69 * Math.cos((lat0 * Math.PI) / 180));
    const hasPhone = i % 11 !== 5;
    const digits = hasPhone ? phones[nextPhone++] : '';
    const slug = slugOf(name), domain = `${slug}.test`;
    // listings give websites in all of these forms; a dated site has no https at all
    const forms = [`http://www.${domain}/`, `https://${domain}/`, `http://${domain}`, `https://www.${domain}`];
    const website = scenario ? pick(scenario === 'dated' ? forms.filter((f) => f.startsWith('http:')) : forms) : '';
    all.push({
      i, k, name, type, scenario, chain: extra.chain || 0,
      id: hex(16), lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
      city, zip: pick(zips), street: `${Math.floor(between(4, 18)) * 1000 + Math.floor(between(1, 99)) * 2} ${pick(STREETS)}`,
      digits, phone: digits ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : '',
      slug, domain, website, start: website ? new URL(website).toString() : '',
      email: website && rand() < 0.35 ? `${pick(['info', 'hello', 'office', 'contact'])}@${domain}` : '',
      confidence: Math.round((i % 9 === 4 ? between(0.42, 0.58) : between(0.62, 0.98)) * 100) / 100,
      since: 1985 + Math.floor(rand() * 35),
    });
    i++;
  }
}
// a different 555-01xx number for the sites whose call button dials the wrong line
for (const b of all) b.otherDigits = phones[phones.length - 1 - b.i];

// Run the real checker against the synthetic web, one site at a time, on a fake clock.
const web = new Map(), records = new Map(), expectations = new Map();
for (const b of all.filter((x) => x.scenario)) {
  const s = SCENARIOS[b.scenario](b);
  for (const [url, res] of Object.entries(s.pages)) web.set(new URL(url).toString(), res);
  if (s.record) records.set(`https://rdap.org/domain/${b.domain}`, s.record);
  expectations.set(b.website, s.expect);
}
let clock = NOW;
Date.now = () => clock;
globalThis.fetch = async (input) => {
  const url = String(input);
  const res = web.get(url) || records.get(url);
  clock += res && res.latency ? res.latency : Math.round(between(180, 900));
  if (!res || res.throws === 'dns') throw new TypeError('fetch failed'); // no such host
  if (res.throws === 'abort') throw new DOMException('This operation was aborted', 'AbortError');
  return new Response(res.body ?? null, { status: res.status, headers: res.headers || { 'content-type': 'text/html; charset=utf-8' } });
};

const checks = {};
for (const b of all.filter((x) => x.website)) {
  const result = await checkSite(b.website, cleanHint({ name: b.name, places: [b.city], phone: b.phone }));
  expectations.get(b.website)(result);
  checks[b.website] = result;
}

// ---------------------------------------------------------------- write

const FIELDS = ['id', 'name', 'lat', 'lon', 'type', 'phone', 'website', 'email', 'social', 'street', 'city', 'zip', 'confidence', 'chain'];
await mkdir(join(OUT, 'places'), { recursive: true });
const counts = {};
for (const k of Object.keys(BUSINESSES)) {
  const items = all.filter((b) => b.k === k).sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  const types = [...new Set(items.map((b) => b.type))].sort();
  const rows = items.map((b) => [b.id, b.name, b.lat, b.lon, types.indexOf(b.type), b.phone, b.website, b.email, '', b.street, b.city, b.zip, b.confidence, b.chain]);
  await writeFile(join(OUT, 'places', `${k}.json`), JSON.stringify({ fields: FIELDS, types, rows }));
  counts[k] = rows.length;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const centers = (key) => {
  const groups = new Map();
  for (const b of all) groups.set(b[key], [...(groups.get(b[key]) || []), b]);
  return [...groups].map(([name, bs]) => [name, Math.round(median(bs.map((b) => b.lat)) * 1e4) / 1e4, Math.round(median(bs.map((b) => b.lon)) * 1e4) / 1e4, bs.length])
    .sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : 1));
};
const meta = {
  source: 'Synthetic sample data for the Lead Finder demo (scripts/build-demo-data.mjs). Every business is fictional.',
  synthetic: true,
  release: 'demo',
  coverage: "a few neighborhoods of Los Angeles' San Fernando Valley, around Van Nuys, Sherman Oaks and North Hollywood",
  box: BOX,
  counts,
  areas: centers('city'),
  zips: centers('zip'),
};
await writeFile(join(OUT, 'places', 'meta.json'), JSON.stringify(meta));
await writeFile(join(OUT, 'demo-checks.json'), JSON.stringify(checks, null, 1) + '\n');

const kinds = Object.values(checks).reduce((t, r) => ({ ...t, [r.kind]: (t[r.kind] || 0) + 1 }), {});
console.log(`${all.length} businesses, ${Object.keys(checks).length} website checks:`, kinds);
