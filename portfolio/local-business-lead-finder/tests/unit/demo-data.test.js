// The demo's data (scripts/build-demo-data.mjs) stays fictional and complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../public/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const meta = read('places/meta.json');
const checks = read('demo-checks.json');
const businesses = readdirSync(new URL('places/', dir))
  .filter((f) => f !== 'meta.json')
  .flatMap((f) => {
    const { fields, rows } = read(`places/${f}`);
    return rows.map((r) => Object.fromEntries(fields.map((k, i) => [k, r[i]])));
  });

test('the list says it is synthetic, and its counts add up', () => {
  assert.equal(meta.synthetic, true);
  assert.equal(Object.values(meta.counts).reduce((a, b) => a + b, 0), businesses.length);
});

test('phone numbers are all in the 555-01xx range reserved for fiction, and none repeats', () => {
  const phones = businesses.map((b) => b.phone).filter(Boolean);
  assert.ok(phones.every((p) => /^\((818|747)\) 555-01\d\d$/.test(p)), phones.find((p) => !/^\((818|747)\) 555-01\d\d$/.test(p)));
  assert.equal(new Set(phones).size, phones.length);
});

test('websites and emails are all on the reserved .test domain', () => {
  for (const b of businesses) {
    if (b.website) assert.match(new URL(b.website).hostname, /\.test$/, b.website);
    if (b.email) assert.match(b.email, /@[a-z0-9-]+\.test$/, b.email);
    assert.equal(b.social, '');
  }
});

test('every business is inside the box the list covers', () => {
  const [w, s, e, n] = meta.box;
  assert.ok(businesses.every((b) => b.lon >= w && b.lon <= e && b.lat >= s && b.lat <= n));
});

test('every website has a canned check, made for exactly that address', () => {
  const sites = businesses.map((b) => b.website).filter(Boolean);
  assert.deepEqual(Object.keys(checks).sort(), [...sites].sort());
  for (const [url, r] of Object.entries(checks)) assert.equal(r.url, url);
});

test('the canned checks only mention .test sites and the vendors the checker recognizes', () => {
  const hosts = JSON.stringify(checks).match(/https?:\/\/[^"/?\\]+/g).map((u) => new URL(u).hostname);
  const vendors = /(^|\.)(afternic\.com|squarespace\.com|wixsite\.com)$/;
  assert.deepEqual([...new Set(hosts.filter((h) => !h.endsWith('.test') && !vendors.test(h)))], []);
});
