// Domain and text helpers: registrable() and withDomain() on the server, hostOf() and friends in the page.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registrable, withDomain } from '../../functions/lib/domain.js';
import { digits, esc, hostOf, longDate, placesOf, safeUrl, usPhone } from '../../public/js/shared.js';
import { fakeWeb, rdap } from './helpers.js';

let web;
afterEach(() => web?.restore());

describe('registrable(): the part of a host name someone registers', () => {
  const cases = [
    ['www.example.com', 'example.com'],
    ['shop.example.co.uk', 'example.co.uk'],
    ['example.com.au', 'example.com.au'],
    ['ww12.example.net', 'example.net'],
    ['WWW.Example.COM.', 'example.com'], // case and a trailing dot don't matter
    ['copperlineautocare.test', 'copperlineautocare.test'],
    ['localhost', ''],
    ['192.0.2.10', ''], // IP addresses have none
    ['', ''],
  ];
  for (const [host, want] of cases) test(`${host || '(empty)'} → ${want || '(none)'}`, () => assert.equal(registrable(host), want));
});

describe('withDomain(): letting the registry explain a site that did not come through', () => {
  const LOOKUP = 'https://rdap.org/domain/example.org';
  const down = { url: 'example.org', kind: 'down', error: 'it could not be reached' };

  test('not registered outranks whatever the page showed', async () => {
    web = fakeWeb({ [LOOKUP]: { status: 404 } });
    const r = await withDomain({ url: 'example.org', kind: 'placeholder', reason: 'blank' }, 'www.example.org');
    assert.equal(r.kind, 'unregistered');
    assert.equal(r.reason, 'blank'); // what the page showed is kept
  });

  test('a lapsed registration makes it expired', async () => {
    web = fakeWeb({ [LOOKUP]: rdap({ status: ['client hold'] }) });
    assert.equal((await withDomain(down, 'example.org')).kind, 'expired');
  });

  test('parking nameservers explain a site that is down, but never relabel a placeholder', async () => {
    web = fakeWeb({ [LOOKUP]: rdap({ ns: ['ns1.bodis.com'] }) });
    assert.equal((await withDomain(down, 'example.org')).by, 'Bodis');
    const kept = await withDomain({ url: 'example.org', kind: 'placeholder', reason: 'suspended' }, 'example.org');
    assert.equal(kept.kind, 'placeholder');
    assert.equal(kept.domain.parkedBy, 'Bodis');
  });

  test('when the registry is unreachable the result is unchanged', async () => {
    web = fakeWeb();
    assert.deepEqual(await withDomain(down, 'example.org'), down);
  });
});

describe('page helpers', () => {
  test('hostOf: with or without a scheme, minus www', () => {
    assert.equal(hostOf('https://www.copperlineautocare.test/home?x=1'), 'copperlineautocare.test');
    assert.equal(hostOf('copperlineautocare.test/services'), 'copperlineautocare.test');
    assert.equal(hostOf('HTTP://WWW.CopperlineAutoCare.Test'), 'copperlineautocare.test');
    assert.equal(hostOf(''), '');
    assert.equal(hostOf('not a web address'), 'not a web address');
  });

  test('esc and safeUrl keep scraped text from becoming markup or script', () => {
    assert.equal(esc(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
    assert.equal(esc(null), '');
    assert.equal(safeUrl('javascript:alert(1)'), '');
    assert.equal(safeUrl('data:text/html,hi'), '');
    assert.equal(safeUrl('https://copperlineautocare.test/'), 'https://copperlineautocare.test/');
  });

  test('phone numbers', () => {
    assert.equal(usPhone('+1 818-555-0123; 818-555-0124'), '(818) 555-0123');
    assert.equal(usPhone('555-0123'), '555-0123'); // not a full number: left as typed
    assert.equal(digits('+1 (818) 555-0123'), '8185550123');
  });

  test('placesOf: the city in the address and the area it was found in', () => {
    assert.deepEqual(placesOf({ address: '14530 Oak St, Van Nuys, CA 91411', area: 'North Hollywood' }), ['Van Nuys', 'North Hollywood']);
    assert.deepEqual(placesOf({ address: '14530 Oak St, Van Nuys, CA 91411', area: 'Van Nuys' }), ['Van Nuys']);
    assert.deepEqual(placesOf({ address: '', area: '' }), []);
  });

  test('longDate', () => {
    assert.equal(longDate('2026-07-14'), 'July 14, 2026');
    assert.equal(longDate('2026-07-14T10:00:00Z'), 'July 14, 2026');
    assert.equal(longDate('soon'), '');
  });
});
