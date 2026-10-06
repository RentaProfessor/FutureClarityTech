// Test helpers: a fake web for the website checker.

// fetch answers from a table: url → { status, headers, body } | { throws } | a Response | a function
// returning one. Anything else fails like a host that doesn't exist. Every call is recorded.
export function fakeWeb(routes = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, opts = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, opts });
    let r = routes[url];
    if (typeof r === 'function') r = await r(url, opts);
    if (r === undefined) throw new TypeError('fetch failed');
    if (r instanceof Response) return r;
    if (r.throws) throw r.throws;
    return new Response(r.body ?? null, { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = real;
    },
  };
}

export const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
export const redirect = (location, status = 301) => ({ status, headers: { location } });

// A registry (RDAP) record.
export const rdap = ({ status = ['client transfer prohibited'], expires = '2030-01-01', registrar = 'Example Registrar, Inc.', ns = ['ns1.example-dns.test'] } = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/rdap+json' },
  body: JSON.stringify({
    objectClassName: 'domain',
    status,
    events: [{ eventAction: 'registration', eventDate: '2015-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: `${expires}T00:00:00Z` }],
    nameservers: ns.map((ldhName) => ({ objectClassName: 'nameserver', ldhName })),
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', registrar]]] }],
  }),
});

// A long, ordinary page that names nobody in particular (for tests that need a "real" site).
export const filler = (n = 40) => '<p>' + 'We are open six days a week and answer every question in plain language. '.repeat(n) + '</p>';
