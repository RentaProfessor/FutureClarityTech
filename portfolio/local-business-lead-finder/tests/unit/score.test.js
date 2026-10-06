// The fit score (public/js/score.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, findings, slim } from '../../public/js/score.js';

const YEAR = new Date().getFullYear();
const shop = (extra) => ({
  name: 'Copperline Auto Care', vertical: 'auto', phone: '(818) 555-0100', address: '14098 Walnut Ave, Van Nuys, CA 91401', area: 'Van Nuys',
  website: 'https://copperlineautocare.test/', rating: null, reviews: null, ...extra,
});
// a site with nothing wrong with it
const good = (extra) => ({
  kind: 'site', https: true, mobile: true, tel: true, bookingWords: true, tools: [], year: YEAR, title: 'Copperline Auto Care | Auto Repair in Van Nuys',
  seo: { desc: 140, noindex: false, schema: true }, phones: ['8185550100'], onPage: { name: true, area: true, phone: true }, ms: 420, ...extra,
});
const keys = (a) => a.sig.map((x) => x.k).sort();

describe('the fit score', () => {
  test('starts at 35: a business with nothing notable is Cold', () => {
    const a = assess(shop({ site: good() }));
    assert.equal(a.score, 35);
    assert.equal(a.level, 'Cold');
    assert.deepEqual(keys(a), ['reviewsunknown']);
  });

  test('no website at all: +25, Hot', () => {
    const a = assess(shop({ website: '' }));
    assert.equal(a.score, 60);
    assert.equal(a.level, 'Hot');
    assert.match(findings(a)[0].find, /couldn't find a website for Copperline Auto Care/);
  });

  test('a check still running is pending and changes nothing yet', () => {
    const a = assess(shop());
    assert.equal(a.pending, true);
    assert.equal(a.score, 35);
    assert.deepEqual(slim(a), [{ k: 'reviewsunknown', pts: 0, t: 'Google rating: not added yet' }]);
  });

  test("a result's check can come from the page's cache rather than the business", () => {
    const cache = new Map([['https://copperlineautocare.test/', { kind: 'down', error: 'it could not be reached' }]]);
    assert.equal(assess(shop(), cache).score, 60);
  });

  test('each way a website can be gone', () => {
    const cases = [
      [{ kind: 'profile', profile: 'Facebook page' }, 22, 'Website is a Facebook page'],
      [{ kind: 'unregistered' }, 25, "Web address isn't registered"],
      [{ kind: 'expired' }, 25, 'Domain registration expired'],
      [{ kind: 'parked', by: 'Afternic', sale: true }, 25, 'Website domain is for sale (Afternic)'],
      [{ kind: 'parked', by: '', sale: false }, 25, 'Website domain shows a parking page'],
      [{ kind: 'placeholder', reason: 'suspended' }, 25, 'Website account is suspended'],
      [{ kind: 'placeholder', reason: 'something new' }, 25, 'Website is a blank page'],
      [{ kind: 'down', error: 'it redirects in a loop' }, 25, 'Website is broken'],
      [{ kind: 'blocked', status: 403 }, 0, "Couldn't check the website"],
      [{ kind: 'site', ...good(), notMine: true }, 20, "Website doesn't mention them"],
    ];
    for (const [site, pts, t] of cases) {
      const a = assess(shop({ site }));
      assert.equal(a.score, 35 + pts, t);
      assert.ok(a.sig.some((x) => x.t === t), t);
    }
  });

  test('a placeholder finding names the host behind it', () => {
    const a = assess(shop({ site: { kind: 'placeholder', reason: 'host home', by: 'Wix' } }));
    assert.equal(findings(a)[0].find, "Your web address, copperlineautocare.test, sends visitors to Wix's homepage instead of your website.");
  });

  test('a dated site adds up: no booking, not built for phones, not secure, an old footer, weak on Google', () => {
    const a = assess(shop({ site: good({ https: false, mobile: false, bookingWords: false, year: YEAR - 10, title: 'Home', seo: { desc: 0, noindex: false, schema: false } }) }));
    assert.deepEqual(keys(a), ['nobook', 'nohttps', 'nomobile', 'reviewsunknown', 'seo', 'stale']);
    assert.equal(a.score, 35 + 10 + 12 + 5 + 8 + 6);
  });

  test('no online booking counts for more where customers expect to book online', () => {
    const site = good({ bookingWords: false });
    assert.equal(assess(shop({ site })).sig.find((x) => x.k === 'nobook').pts, 10); // auto repair: phone people
    assert.equal(assess(shop({ vertical: 'groom', site })).sig.find((x) => x.k === 'nobook').pts, 18);
  });

  test('a business already running an all-in-one tool is a harder sell', () => {
    assert.equal(assess(shop({ site: good({ tools: [{ name: 'Tekmetric', suite: true }] }) })).score, 35 - 18);
    const plain = assess(shop({ site: good({ bookingWords: false, tools: [{ name: 'Calendly', suite: false }] }) }));
    assert.equal(plain.score, 35);
    assert.ok(plain.sig.some((x) => x.t === 'Books online with Calendly'));
  });

  test('hidden from Google outranks the smaller Google gaps', () => {
    const a = assess(shop({ site: good({ title: 'Home', seo: { desc: 0, noindex: true, schema: false } }) }));
    assert.deepEqual(keys(a), ['noindex', 'reviewsunknown']);
  });

  test("the site's call button dials another number", () => {
    const a = assess(shop({ site: good({ phones: ['8185550199'], onPage: { name: true, area: true, phone: false } }) }));
    assert.ok(a.sig.some((x) => x.k === 'phonediff' && x.pts === 8));
    assert.match(findings(a)[0].find, /dials \(818\) 555-0199, but your Google listing says \(818\) 555-0100/);
    const missing = assess(shop({ site: good({ phones: [], onPage: { name: true, area: true, phone: false } }) }));
    assert.ok(missing.sig.some((x) => x.k === 'napphone' && x.pts === 3));
  });

  test('chains are pushed down, and the score stays within 0 to 100', () => {
    assert.equal(assess(shop({ name: 'Midas', site: good() })).score, 0);
    assert.equal(assess(shop({ chain: true, site: good() })).level, 'Cold');
    const worst = shop({
      reviews: 0,
      site: good({ thin: true, https: false, mobile: false, bookingWords: false, year: 2001, ms: 9000, freeHost: 'Wix', title: '', seo: { desc: 0, noindex: false, schema: false }, phones: ['8185550199'], onPage: { name: true, area: false, phone: false } }),
    });
    assert.equal(assess(worst).score, 100);
  });

  test('Google reviews typed in from Maps', () => {
    const at = (reviews, rating) => assess(shop({ site: good(), reviews, rating })).score - 35;
    assert.equal(at(0, null), 15);
    assert.equal(at(12, 4.9), 14);
    assert.equal(at(40, 4.9), 7);
    assert.equal(at(40, 3.8), 7 + 10);
    assert.equal(at(40, 4.2), 7 + 5);
    assert.equal(at(120, 4.8), 0);
  });

  test('findings are the positive signals, biggest first, each with a sentence for the owner', () => {
    const a = assess(shop({ reviews: 3, site: good({ mobile: false, https: false }) }));
    assert.deepEqual(findings(a).map((x) => x.k), ['fewreviews', 'nomobile', 'nohttps']);
    assert.ok(findings(a).every((x) => x.find.length > 20));
  });
});
