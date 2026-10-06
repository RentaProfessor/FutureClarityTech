// The website checker (functions/lib/site-check.js), against a fake web: no network.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_SIGNATURES, MAX_HOPS, SITE_MAX_BYTES, checkSite, inspect, notASiteAt } from '../../functions/lib/site-check.js';
import { SITES_PER_CALL } from '../../functions/api/prospects.js';
import { fakeWeb, filler, page, rdap, redirect } from './helpers.js';

let web;
afterEach(() => web?.restore());
const urls = () => web.calls.map((c) => c.url);
const RDAP_ORG = 'https://rdap.org/domain/example.org';

describe('a website that is really a profile, a marketplace or a parking page', () => {
  test('a Facebook page is reported without fetching anything', async () => {
    web = fakeWeb();
    const r = await checkSite('https://m.facebook.com/somebody', null);
    assert.deepEqual(r, { url: 'https://m.facebook.com/somebody', kind: 'profile', profile: 'Facebook page' });
    assert.equal(web.calls.length, 0);
  });

  test('a redirect to a profile ends the check there', async () => {
    web = fakeWeb({ 'http://example.org/': redirect('https://booksy.com/en-us/12345_example') });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'profile');
    assert.equal(r.profile, 'Booksy profile');
    assert.deepEqual(urls(), ['http://example.org/']);
  });

  test('a redirect to a domain marketplace means the domain is for sale; the marketplace page is never loaded', async () => {
    web = fakeWeb({
      'http://example.com/': redirect('https://www.afternic.com/forsale/example.com?traffic_type=TDFS', 302),
      'https://rdap.verisign.com/com/v1/domain/example.com': rdap({ registrar: 'GoDaddy.com, LLC' }),
    });
    const r = await checkSite('example.com', null);
    assert.equal(r.kind, 'parked');
    assert.equal(r.by, 'Afternic');
    assert.equal(r.sale, true);
    assert.equal(r.domain.registrar, 'GoDaddy.com, LLC');
    // .com goes straight to Verisign's registry
    assert.deepEqual(urls(), ['http://example.com/', 'https://rdap.verisign.com/com/v1/domain/example.com']);
    assert.equal(web.calls[0].opts.redirect, 'manual');
  });

  test('a parking service is parked, not for sale, unless the address says so', () => {
    assert.deepEqual(notASiteAt('www.bodis.com', 'example.org', '/'), { kind: 'parked', by: 'Bodis', sale: false });
    assert.deepEqual(notASiteAt('www.godaddy.com', 'example.org', '/forsale/example.org'), { kind: 'parked', by: 'GoDaddy', sale: true });
    assert.deepEqual(notASiteAt('www.godaddy.com', 'example.org', '/domainsearch/find'), { kind: 'parked', by: 'GoDaddy', sale: false });
  });

  test('ww12.<the same domain> is how ad-parking services serve a parked domain', () => {
    assert.deepEqual(notASiteAt('ww12.example.org', 'www.example.org'), { kind: 'parked', by: '', sale: false });
    assert.equal(notASiteAt('ww12.other.org', 'www.example.org'), null);
  });

  test("a host's own homepage means the site isn't set up", () => {
    assert.deepEqual(notASiteAt('www.wix.com', 'example.org'), { kind: 'placeholder', reason: 'host home', by: 'Wix' });
    assert.equal(notASiteAt('copperline-demo.wixsite.com', 'example.org'), null); // a real (free) site
  });

  test("GoDaddy's one-line jump to /lander is a parked domain", async () => {
    web = fakeWeb({ 'http://example.org/': { body: '<html><head><script>window.location.href="/lander"</script></head></html>' }, [RDAP_ORG]: rdap() });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'parked');
    assert.equal(r.by, 'GoDaddy');
    assert.equal(r.sale, false);
  });

  test("a parking page's own code and words: parked, and for sale when it says so", async () => {
    const lander = '<script src="https://img1.wsimg.com/parking-lander/static/js/main.js"></script>';
    web = fakeWeb({ 'http://example.org/': { body: page('<h1>Get this domain</h1>', lander) }, [RDAP_ORG]: rdap() });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'parked');
    assert.equal(r.by, 'GoDaddy');
    assert.equal(r.sale, true);
  });
});

describe('placeholder pages', () => {
  const cases = [
    ['default page', page('<h1>Welcome to nginx!</h1><p>If you see this page, the web server is installed and working.</p>', '<title>Welcome to nginx!</title>')],
    ['suspended', page('<h1>Account Suspended</h1><p>This account has been suspended. Contact your hosting provider.</p>')],
    ['expired', page('<h1>This website has expired</h1><p>The owner can renew it from their dashboard.</p>')],
    ['not connected', page("<h1>404</h1><p>There isn't a GitHub Pages site here.</p>")],
    ['coming soon', page('<h1>Hello</h1><p>Our new site is on its way.</p>', '<title>Coming Soon</title>')],
    ['unavailable', page('<p>This page is temporarily unavailable. Please check back later.</p>')],
    ['blank', page('')],
    ['blank', page('<p>Welcome to example.org</p>', '<title>example.org</title>')],
  ];
  for (const [reason, html] of cases) {
    test(`${reason}: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || '(empty)'}`, async () => {
      web = fakeWeb({ 'http://example.org/': { body: html }, [RDAP_ORG]: rdap() });
      const r = await checkSite('example.org', null);
      assert.equal(r.kind, 'placeholder');
      assert.equal(r.reason, reason);
      assert.equal(r.domain.registered, true); // a placeholder also gets the registry lookup
    });
  }

  test('"coming soon" on a real site is news, not a placeholder', async () => {
    web = fakeWeb({ 'http://example.org/': { body: page(`<h1>Example Garage</h1><p>A second location is coming soon!</p>${filler()}`, '<title>Example Garage</title>') } });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'site');
  });
});

describe('what the registry says (RDAP)', () => {
  test('not registered to anyone', async () => {
    web = fakeWeb({ [RDAP_ORG]: { status: 404 } }); // and the site itself doesn't resolve
    const r = await checkSite('http://www.example.org/', null);
    assert.equal(r.kind, 'unregistered');
    assert.deepEqual(r.domain, { name: 'example.org', registered: false });
    assert.match(r.error, /could not be reached/);
  });

  test('in its redemption period: expired, and about to be released', async () => {
    web = fakeWeb({ [RDAP_ORG]: rdap({ status: ['client hold', 'redemption period'], expires: '2026-07-14', registrar: 'Namecheap, Inc.' }) });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'expired');
    assert.equal(r.domain.lapsed, true);
    assert.equal(r.domain.ending, true);
    assert.equal(r.domain.expires, '2026-07-14');
    assert.equal(r.domain.registrar, 'Namecheap, Inc.');
  });

  test('past its expiry date with no status yet: expired, not yet ending', async () => {
    web = fakeWeb({ [RDAP_ORG]: rdap({ status: ['active'], expires: '2020-05-01' }) });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'expired');
    assert.equal(r.domain.ending, false);
  });

  test("pointed at a parking service's nameservers: parked", async () => {
    web = fakeWeb({ [RDAP_ORG]: rdap({ ns: ['ns1.sedoparking.com', 'ns2.sedoparking.com'] }) });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'parked');
    assert.equal(r.by, 'Sedo');
    assert.equal(r.sale, false);
  });

  test('registered and current: the site is just down, and the record says who holds it', async () => {
    web = fakeWeb({ 'http://example.org/': { status: 500, body: 'oops' }, [RDAP_ORG]: rdap({ registrar: 'Example Registrar, Inc.' }) });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'down');
    assert.equal(r.status, 500);
    assert.equal(r.error, 'the page answers with error 500');
    assert.equal(r.domain.registered, true);
    assert.equal(r.domain.lapsed, false);
  });

  test("when the registry can't answer, the result stands on its own", async () => {
    web = fakeWeb({ 'http://example.org/': { status: 502 }, [RDAP_ORG]: { status: 503 } });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'down');
    assert.equal(r.domain, undefined);
  });

  test('.net goes to Verisign, other endings to rdap.org, and an IP address has no registry', async () => {
    web = fakeWeb();
    await checkSite('http://shop.example.net/', null);
    await checkSite('http://shop.example.co.uk/', null);
    await checkSite('http://192.0.2.10/', null);
    assert.deepEqual(urls().filter((u) => u.includes('rdap')), ['https://rdap.verisign.com/net/v1/domain/example.net', 'https://rdap.org/domain/example.co.uk']);
  });
});

describe('bot filters, broken sites and timeouts', () => {
  for (const status of [401, 403, 429]) {
    test(`${status} is a bot filter, not a broken site`, async () => {
      web = fakeWeb({ 'http://example.org/': { status, body: 'Access denied' }, [RDAP_ORG]: rdap() });
      const r = await checkSite('example.org', null);
      assert.equal(r.kind, 'blocked');
      assert.equal(r.status, status);
    });
  }

  test('404 is a broken site', async () => {
    web = fakeWeb({ 'http://example.org/': { status: 404 }, [RDAP_ORG]: rdap() });
    assert.equal((await checkSite('example.org', null)).kind, 'down');
  });

  test('a site that takes too long', async () => {
    web = fakeWeb({ 'http://example.org/': { throws: new DOMException('aborted', 'AbortError') }, [RDAP_ORG]: rdap() });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'down');
    assert.equal(r.error, 'it did not load within 7 seconds');
  });

  test('not a web address at all', async () => {
    web = fakeWeb();
    assert.equal((await checkSite('http://exa mple.org', null)).kind, 'error');
    assert.equal(web.calls.length, 0);
  });
});

describe('inside the free plan: 50 subrequests and 10 ms of CPU per call', () => {
  test('redirects are followed by hand, and a chain longer than MAX_HOPS stops', async () => {
    const routes = { 'http://example.org/': redirect('/1', 302), [RDAP_ORG]: rdap() };
    for (let i = 1; i < 20; i++) routes[`http://example.org/${i}`] = redirect(`/${i + 1}`, 302);
    web = fakeWeb(routes);
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'down');
    assert.equal(r.error, 'it redirects in a loop');
    const site = web.calls.filter((c) => !c.url.includes('rdap'));
    assert.equal(site.length, 1 + MAX_HOPS);
    assert.ok(site.every((c) => c.opts.redirect === 'manual'));
  });

  test('a short chain is followed to the real site', async () => {
    web = fakeWeb({
      'http://example.org/': redirect('https://example.org/'),
      'https://example.org/': redirect('https://www.example.org/home'),
      'https://www.example.org/home': { body: page(`<h1>Example Garage</h1>${filler()}`, '<title>Example Garage</title>') },
    });
    const r = await checkSite('example.org', null);
    assert.equal(r.kind, 'site');
    assert.equal(r.finalUrl, 'https://www.example.org/home');
    assert.equal(r.https, true);
    assert.equal(r.movedTo, undefined); // same registrable domain
  });

  test('the worst case for one call fits in 50 subrequests', () => {
    // per site: the page, MAX_HOPS redirects, and the registry lookup (rdap.org redirects once: 2);
    // plus one dashboard-code check per call
    assert.ok(SITES_PER_CALL * (1 + MAX_HOPS + 2) + 1 <= 50);
  });

  test('a page is read up to SITE_MAX_BYTES, then the download is cancelled', async () => {
    const chunk = new TextEncoder().encode('<p>' + 'lorem-free filler text '.repeat(700) + '</p>\n'); // ~16 KB
    let pulled = 0, cancelled = false;
    const body = new ReadableStream({
      pull(ctrl) {
        if (pulled++ < 64) ctrl.enqueue(chunk); // 1 MB in all
        else ctrl.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    web = fakeWeb({ 'http://example.org/': () => new Response(body, { headers: { 'content-type': 'text/html' } }) });
    const r = await checkSite('example.org', { name: 'zebra crossing cafe', places: [], phone: '' });
    assert.equal(r.kind, 'site');
    assert.equal(r.bytes, SITE_MAX_BYTES);
    assert.equal(r.full, false);
    assert.ok(cancelled, 'the rest of the page is never downloaded');
    assert.ok(pulled < 16, `read ${pulled} chunks`);
    // not in what was read, but the rest wasn't read: unknown, not "missing"
    assert.equal(r.onPage.name, null);
  });

  test('every vendor signature goes into one pattern, once', () => {
    assert.equal(new Set(LINK_SIGNATURES).size, LINK_SIGNATURES.length);
    assert.equal(LINK_SIGNATURES.length, 164);
  });
});

describe('what a real page says', () => {
  // padded with ordinary text: a nearly empty page would (rightly) be called a blank placeholder
  const look = (body, head = '', hint = null, robots = '') => inspect(page(body + filler(), head), hint, 'www.example.org', robots);

  test('site builder, booking tools and other software, from the links alone', () => {
    const r = look(
      '<a href="https://booksy.com/en-us/1">Book</a><script>var cfg = {"url":"https:\\/\\/calendly.com\\/example"}</script>',
      '<script src="https://static.wixstatic.com/main.js"></script><script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><script src="https://js.stripe.com/v3/"></script>',
    );
    assert.equal(r.builder, 'Wix');
    assert.deepEqual(r.tools, [{ name: 'Booksy', suite: true }, { name: 'Calendly', suite: false }]); // the second from JSON-escaped links
    assert.deepEqual(r.extras, { analytics: ['Google Analytics'], pay: ['Stripe'] });
  });

  test('a signature anchored to the end of a link: thecut.co is not thecut.com', () => {
    assert.deepEqual(look('<a href="https://thecut.com/x">a</a>').tools, []);
    assert.deepEqual(look('<a href="https://thecut.co/b/x">a</a>').tools, [{ name: 'theCut', suite: true }]);
  });

  test('email addresses, minus placeholders, image names and no-reply', () => {
    const r = look('<a href="mailto:Info@CopperlineAutoCare.test">Email</a> <p>sales@copperlineautocare.test, noreply@copperlineautocare.test, user@domain.com, jane@example.com, logo@2x.png</p>');
    assert.deepEqual(r.emails, ['info@copperlineautocare.test', 'sales@copperlineautocare.test']);
  });

  test('the latest copyright year', () => {
    assert.equal(look('<footer>&copy; 2014 - 2019 Example</footer>').year, 2019);
    assert.equal(look('<footer>Copyright 2021 Example</footer>').year, 2021);
    assert.equal(look('<footer>Example</footer>').year, null);
  });

  test('hidden from Google, by a meta tag or by a header', () => {
    assert.equal(look('<h1>x</h1>', '<meta name="robots" content="noindex, nofollow">').seo.noindex, true);
    assert.equal(look('<h1>x</h1>', '', null, 'noindex').seo.noindex, true);
    assert.equal(look('<h1>x</h1>', '<meta name="robots" content="index, follow">').seo.noindex, false);
  });

  test('zooming blocked on phones', () => {
    assert.equal(look('', '<meta name="viewport" content="width=device-width, maximum-scale=1">').noZoom, true);
    assert.equal(look('', '<meta name="viewport" content="width=device-width, user-scalable=no">').noZoom, true);
    assert.equal(look('', '<meta name="viewport" content="width=device-width, maximum-scale=1.5">').noZoom, undefined);
    assert.equal(look('', '<meta name="viewport" content="width=device-width">').mobile, true);
  });

  test('images without a description; alt="" and tracking pixels are fine', () => {
    const r = look('<img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg" alt="Front of the shop"><img src="p.gif" width="1" height="1">');
    assert.equal(r.imgs, 3);
    assert.equal(r.noAlt, 1);
  });

  test('"lorem ipsum" counts only where visitors can read it', () => {
    assert.equal(look('<p>Lorem ipsum dolor sit amet</p>').filler, true);
    assert.equal(look('<script>var t = "lorem ipsum";</script><img alt="lorem ipsum" src="x.jpg">').filler, undefined);
  });

  test('the numbers the call buttons dial', () => {
    assert.deepEqual(look('<a href="tel:+1-818-555-0123">Call</a> <a href="tel:8185550199;ext=2">Office</a>').phones, ['8185550123', '8185550199']);
  });

  test('business details for Google (structured data)', () => {
    assert.equal(look('', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"x"}</script>').seo.schema, true);
    assert.equal(look('', '<script type="application/ld+json">{"@type":"Organization"}</script>').seo.schema, false);
  });

  test("the business's name, area and phone on its page", () => {
    const hint = { name: 'ironleaf transmission', places: ['van nuys'], phone: '8185550123' };
    const r = look('<h1>Ironleaf Transmission</h1><p>Serving Van Nuys since 1990. Call 555-0123.</p>', '', hint);
    assert.deepEqual(r.onPage, { name: true, area: true, phone: true });
    const none = look('<h1>Welcome</h1>', '', hint);
    assert.deepEqual(none.onPage, { name: false, area: false, phone: false });
  });

  test("a page that never names the business or its trade belongs to someone else; a rebrand that keeps the trade doesn't", () => {
    const hint = { name: 'tamarack transmission', places: [], phone: '' };
    assert.equal(look('<h1>Hartwell &amp; Pine, Attorneys</h1>', '', hint).notMine, true);
    assert.equal(look('<h1>Valley Transmission Experts</h1>', '', hint).notMine, undefined);
  });
});
