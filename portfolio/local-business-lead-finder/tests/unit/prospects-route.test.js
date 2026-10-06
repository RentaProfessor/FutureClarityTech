// POST /api/prospects (functions/api/prospects.js): the code check and the request handling.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHint, onRequest } from '../../functions/api/prospects.js';
import { fakeWeb, filler, page } from './helpers.js';

const ENV = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_KEY: 'sb_publishable_test' };
const CHECK = 'https://project.supabase.test/rest/v1/rpc/dashboard_check';
let web;
afterEach(() => web?.restore());

// Supabase says yes to one code, and every site is a plain page.
function fake(goodCode, extra = {}) {
  web = fakeWeb({
    [CHECK]: (url, opts) => ({ body: JSON.stringify(JSON.parse(opts.body).code.toLowerCase().replace(/\s/g, '') === goodCode) }),
    ...extra,
  });
}
const call = async (body, { method = 'POST', env = ENV } = {}) => {
  const res = await onRequest({ request: new Request('https://lead-finder.test/api/prospects', { method, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env });
  return [res.status, await res.json(), res];
};
const checks = () => web.calls.filter((c) => c.url === CHECK).length;

test('only POST', async () => {
  fake('any');
  assert.deepEqual((await call(null, { method: 'GET' })).slice(0, 2), [405, { error: 'method_not_allowed' }]);
});

test('without Supabase settings it says so instead of failing open', async () => {
  fake('any');
  const [status, body] = await call({ action: 'sites', code: 'x', urls: ['example.org'] }, { env: {} });
  assert.deepEqual([status, body], [503, { error: 'not_configured' }]);
  assert.equal(web.calls.length, 0);
});

test('a body that is not JSON', async () => {
  fake('any');
  assert.equal((await call('{nope'))[0], 400);
});

test('a wrong code is refused before any website is opened', async () => {
  fake('right', { 'http://example.org/': { body: page('x') } });
  const [status, body] = await call({ action: 'sites', code: 'wrong-1', urls: ['example.org'] });
  assert.deepEqual([status, body], [401, { error: 'wrong_code' }]);
  assert.deepEqual(web.calls.map((c) => c.url), [CHECK]);
});

test('no code, or a silly one, never reaches Supabase', async () => {
  fake('right');
  assert.equal((await call({ action: 'sites', urls: ['example.org'] }))[0], 401);
  assert.equal((await call({ action: 'sites', code: 'x'.repeat(201), urls: ['example.org'] }))[0], 401);
  assert.equal(checks(), 0);
});

test("when Supabase can't answer, the call fails as unavailable, not as a wrong code", async () => {
  web = fakeWeb({ [CHECK]: { status: 500 } });
  assert.deepEqual((await call({ action: 'sites', code: 'right-2', urls: ['example.org'] })).slice(0, 2), [502, { error: 'auth_unavailable' }]);
});

test('a code that passed is remembered: one database round trip for several calls', async () => {
  const site = { body: page(`<h1>Example Garage</h1>${filler()}`, '<title>Example Garage</title>') };
  fake('cachedcode', { 'http://example.org/': site, 'http://example.net/': site });
  assert.equal((await call({ action: 'sites', code: 'Cached Code', urls: ['example.org'] }))[0], 200);
  // capitals and spaces don't matter, as in the database
  assert.equal((await call({ action: 'sites', code: 'cachedcode', urls: ['example.net'] }))[0], 200);
  assert.equal(checks(), 1);
});

test('at most 3 sites per call, one result each, in order', async () => {
  const site = { body: page(`<h1>Example Garage</h1>${filler()}`, '<title>Example Garage</title>') };
  fake('threecode', { 'http://a.example.org/': site, 'http://b.example.org/': site, 'http://c.example.org/': site, 'http://d.example.org/': site });
  const [status, body] = await call({ action: 'sites', code: 'threecode', urls: ['a.example.org', 'b.example.org', 'c.example.org', 'd.example.org', 42] });
  assert.equal(status, 200);
  assert.deepEqual(body.results.map((r) => [r.url, r.kind]), [['a.example.org', 'site'], ['b.example.org', 'site'], ['c.example.org', 'site']]);
  assert.ok(!web.calls.some((c) => c.url.includes('d.example.org')));
});

test('an unknown action or no websites is a bad request', async () => {
  fake('actioncode');
  assert.equal((await call({ action: 'scrape', code: 'actioncode' }))[0], 400);
  assert.equal((await call({ action: 'sites', code: 'actioncode', urls: [] }))[0], 400);
});

test('hints are lowercased and cut short, since they are only searched for', () => {
  assert.deepEqual(cleanHint({ name: '  Ironleaf Transmission  ', places: ['Van Nuys', 'LA', 42, 'North Hollywood', 'Encino', 'Reseda'], phone: '+1 (818) 555-0123' }), {
    name: 'ironleaf transmission',
    places: ['van nuys', 'north hollywood', 'encino'],
    phone: '8185550123',
  });
  assert.equal(cleanHint('nope'), null);
  assert.equal(cleanHint({ name: 'x'.repeat(500) }).name.length, 120);
});

test('responses are never cached and never indexed', async () => {
  fake('headercode');
  const [, , res] = await call({ action: 'nothing', code: 'headercode' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});
