// Who holds a business's domain, from its registry: is it registered at all, has it expired, and
// is it pointed at a parking service? Used when a site is down, parked or a placeholder.
import { PARKING_NS } from './signatures.js';
import { discard } from './http.js';

export const RDAP_TIMEOUT_MS = 4000;

// "www.example.co.uk" → "example.co.uk": the part someone registers. IP addresses have none.
// (A two-letter country code after co/com/net/org/gov/edu/ac is treated as one suffix; that covers
// the domains a local business list turns up without shipping the whole public suffix list.)
export function registrable(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length < 2 || !/^[a-z]{2,}$/.test(parts[parts.length - 1])) return '';
  const n = parts.length > 2 && parts[parts.length - 1].length === 2 && /^(?:co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

// The domain's registry record, through RDAP: the registries' public lookup, which needs no key.
// .com and .net go straight to Verisign; anything else goes through rdap.org, which redirects to the
// right registry (two subrequests). null when the registry can't say.
export async function domainInfo(hostname) {
  const name = registrable(hostname);
  if (!name) return null;
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const url = tld === 'com' || tld === 'net' ? `https://rdap.verisign.com/${tld}/v1/domain/${name}` : `https://rdap.org/domain/${name}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(RDAP_TIMEOUT_MS) });
    if (res.status === 404) {
      discard(res);
      return { name, registered: false };
    }
    if (!res.ok) {
      discard(res);
      return null;
    }
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
      // on hold, in its redemption period or about to be deleted, or simply past its expiry date
      lapsed: status.some((s) => /hold|redemption|pending delete/.test(s)) || (/^\d{4}-\d\d-\d\d$/.test(expires) && Date.parse(expires) < Date.now()),
      // about to be released for anyone to register
      ending: status.some((s) => /redemption|pending delete/.test(s)),
      registrar: registrarOf(j),
      parkedBy: parking ? parking[1] : '',
    };
  } catch {
    return null;
  }
}

// The registrar's name, from its vCard in the record ("GoDaddy.com, LLC").
function registrarOf(j) {
  const e = (Array.isArray(j.entities) ? j.entities : []).find((x) => x && Array.isArray(x.roles) && x.roles.includes('registrar'));
  const card = e && Array.isArray(e.vcardArray) && Array.isArray(e.vcardArray[1]) ? e.vcardArray[1].find((v) => Array.isArray(v) && v[0] === 'fn') : null;
  return card ? String(card[3] || '').slice(0, 80) : '';
}

// A site that didn't come through cleanly (down, parked, a placeholder): let the registry explain
// it, when it can. Not registered and lapsed outrank whatever the page showed.
export async function withDomain(r, hostname) {
  const d = await domainInfo(hostname);
  if (!d) return r;
  if (!d.registered) return { ...r, kind: 'unregistered', domain: d };
  if (d.lapsed) return { ...r, kind: 'expired', domain: d };
  if (d.parkedBy && r.kind !== 'parked' && r.kind !== 'placeholder') return { ...r, kind: 'parked', by: d.parkedBy, sale: false, domain: d };
  return { ...r, domain: d };
}
