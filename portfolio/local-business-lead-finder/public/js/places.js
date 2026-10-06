// The business list: compact JSON files served with the site, one per kind of business, built by
// scripts/build-places.py from Overture Maps data (the demo's are synthetic, from
// scripts/build-demo-data.mjs). A search needs no outside server, key or account.
//
// Each file is { fields, types, rows }: one array per business, in the order of fields, with its
// category stored as an index into types. meta.json has the list's box, release and the centers
// of its neighborhoods, cities and ZIP codes.
import { DATA_URL, REGION } from './config.js';
import { norm } from './shared.js';
import { milesBetween } from './geo.js';

const files = new Map();
export const loadJSON = (name) => {
  if (!files.has(name)) {
    files.set(name, fetch(DATA_URL + name + '.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('list missing'), { status: r.status }))))
      .catch((e) => {
        files.delete(name); // let the next search try again
        throw e;
      }));
  }
  return files.get(name);
};

// Overture's category names, as people say them.
const TYPE_LABELS = { automotive_repair: 'Auto repair shop', automotive_service: 'Auto service', tire_dealer_and_repair: 'Tire shop', tire_shop: 'Tire shop', emissions_inspection: 'Smog check', car_inspection: 'Smog check', oil_change_station: 'Oil change', transmission_repair: 'Transmission shop', brake_service_and_repair: 'Brake shop', engine_repair_service: 'Engine repair', auto_electrical_repair: 'Auto electrical', exhaust_and_muffler_repair: 'Muffler shop', auto_body_shop: 'Body shop', auto_restoration_service: 'Auto restoration', car_wash: 'Car wash', auto_detailing: 'Auto detailing', car_window_tinting: 'Window tint', auto_customization: 'Auto customization', vehicle_wrap: 'Vehicle wraps', pet_groomer: 'Pet groomer', tattoo_and_piercing: 'Tattoo & piercing', barber: 'Barbershop', hair_salon: 'Hair salon', beauty_salon: 'Beauty salon', martial_arts_club: 'Martial arts', chinese_martial_arts_club: 'Martial arts', boxing_gym: 'Boxing gym', gym: 'Gym', hvac_service: 'HVAC', key_and_locksmith: 'Locksmith', pest_control_service: 'Pest control' };
export const typeLabel = (t) => TYPE_LABELS[t] || String(t || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
// A Google Maps search for the business: an ordinary link, no key.
export const mapsSearch = (name, where) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, where].filter(Boolean).join(', '))}`;

// Where to search from: a quick-pick area (config.js), or any neighborhood, city or ZIP code in the
// list's meta.json. Throws { error: 'notfound' } for anything else.
export function locate(text, meta) {
  const key = norm(String(text).replace(new RegExp(`,?\\s*(${REGION.state}|${REGION.stateName})$`, 'i'), ''));
  const hit = REGION.areas.find(([n]) => norm(n) === key);
  if (hit) return { lat: hit[1], lon: hit[2], label: hit[0] };
  const a = meta.areas.find(([n]) => norm(n) === key) || meta.zips.find(([z]) => z === key);
  if (a) return { lat: a[1], lon: a[2], label: a[0] };
  throw Object.assign(new Error('place not found'), { error: 'notfound' });
}

// "Something else": the typed words, matched against business names and types ("upholstery" also
// finds "reupholstery"; long words lose their last two letters so "groomers" finds "grooming").
export function customMatcher(text) {
  const STOP = new Set(['shop', 'shops', 'store', 'stores', 'service', 'services', 'company', 'business', 'center', 'centre', 'the', 'and', 'inc', 'llc', 'near', 'local']);
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 5 ? w.slice(0, -2) : w)).slice(0, 4);
  return words.length ? new RegExp(words.join('|'), 'i') : null;
}

// One row of a list file as the page uses it. loc: where the search is from.
export function fromRow(r, types, loc) {
  const [id, name, lat, lon, ti, phone, website, email, social, street, city, zip, conf, chain] = r;
  const t = types[ti] || '';
  return {
    placeId: 'ovr:' + id, name, types: [t], btype: typeLabel(t), chain: !!chain, conf,
    address: [street, city, [street || city ? REGION.state : '', zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    short: [street, city].filter(Boolean).join(', '),
    phone, website: website || social || '', email,
    mapsUrl: mapsSearch(name, [street, city].filter(Boolean).join(', ') || loc.label),
    rating: null, reviews: null,
    dist: milesBetween(loc.lat, loc.lon, lat, lon),
  };
}

// Every business in a list file within `miles` of loc whose name or category matches (if given).
export function nearby(data, loc, miles, match) {
  return data.rows
    .filter((r) => milesBetween(loc.lat, loc.lon, r[2], r[3]) <= miles && (!match || match.test(r[1]) || match.test(String(data.types[r[4]]).replace(/_/g, ' '))))
    .map((r) => fromRow(r, data.types, loc));
}
