// Settings for one deployment: who the audits come from, the area the business list covers, and
// the Supabase project. The brand, phone and region live here and nowhere else.
import ENV from './env.js';

export const BRAND = {
  name: 'FutureClarity Technologies', // the audit's sign-off, and the PDF's author
  wordmark: ['FUTURE', 'CLARITY'], // the audit's letterhead, in two tones
  site: 'futureclaritytechnologies.com', // the audit's letterhead and sign-off (a link in the PDF)
  phone: '', // e.g. '(818) 555-0100'. Left out of the audit while empty.
};

export const REGION = {
  // Quick picks under the place box, with their map centers. Any neighborhood, city or ZIP code
  // in the business list's meta.json works too.
  areas: [
    ['Van Nuys', 34.1899, -118.4514], ['North Hollywood', 34.1722, -118.3789], ['Sherman Oaks', 34.1508, -118.449],
    ['Studio City', 34.1486, -118.3965], ['Valley Village', 34.1647, -118.3965], ['Encino', 34.1592, -118.5012],
    ['Panorama City', 34.2247, -118.449], ['Lake Balboa', 34.1965, -118.4945],
  ],
  defaultArea: 'Van Nuys',
  state: 'CA', // addresses end "..., City, CA 91401"
  stateName: 'California',
};

export const RADII = [1, 3, 5, 10]; // miles
export const DEFAULT_RADIUS = 3;
export const DATA_URL = '/data/places/'; // the business list (scripts/build-places.py)

export const SUPABASE = { url: (ENV.supabaseUrl || '').replace(/\/$/, ''), key: ENV.supabaseKey || '' };
export const LIVE = !!(SUPABASE.url && SUPABASE.key);
