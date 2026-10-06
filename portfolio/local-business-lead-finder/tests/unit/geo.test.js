// The radius search: distances (public/js/geo.js) and the business list (public/js/places.js),
// against the demo's list files.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inBox, milesBetween, reachesPast } from '../../public/js/geo.js';
import { customMatcher, fromRow, locate, nearby } from '../../public/js/places.js';

const list = (name) => JSON.parse(readFileSync(new URL(`../../public/data/places/${name}.json`, import.meta.url), 'utf8'));
const meta = list('meta');

describe('milesBetween (haversine)', () => {
  test('zero for the same point, and the same both ways', () => {
    assert.equal(milesBetween(34.19, -118.45, 34.19, -118.45), 0);
    assert.equal(milesBetween(34.19, -118.45, 34.17, -118.38), milesBetween(34.17, -118.38, 34.19, -118.45));
  });
  test('a degree of latitude is about 69 miles anywhere', () => {
    assert.ok(Math.abs(milesBetween(0, 0, 1, 0) - 69.09) < 0.05);
    assert.ok(Math.abs(milesBetween(60, 20, 61, 20) - 69.09) < 0.05);
  });
  test('a degree of longitude shrinks with latitude', () => {
    assert.ok(Math.abs(milesBetween(34.2, -118.5, 34.2, -117.5) - 57.1) < 0.2);
    assert.ok(Math.abs(milesBetween(0, 0, 0, 1) - 69.09) < 0.05);
  });
  test('Los Angeles to New York (LAX to JFK) is about 2,470 miles', () => {
    assert.ok(Math.abs(milesBetween(33.9416, -118.4085, 40.6413, -73.7781) - 2470) < 10);
  });
});

describe('the business list', () => {
  test('box checks', () => {
    assert.equal(inBox(34.19, -118.45, meta.box), true);
    assert.equal(inBox(40.71, -74.0, meta.box), false);
    assert.equal(reachesPast(34.19, -118.45, 1, meta.box), false);
    assert.equal(reachesPast(34.19, -118.45, 10, meta.box), true);
  });

  test('locate: a quick pick, any area or ZIP in the list, with or without the state', () => {
    assert.deepEqual(locate('Van Nuys, CA', meta), { lat: 34.1899, lon: -118.4514, label: 'Van Nuys' });
    assert.equal(locate('north hollywood, california', meta).label, 'North Hollywood');
    assert.equal(locate('91604', meta).label, '91604');
    assert.throws(() => locate('Atlantis', meta), (e) => e.error === 'notfound');
  });

  test('nearby: everything within the radius, and nothing outside it', () => {
    const data = list('auto'), loc = locate('Van Nuys', meta);
    for (const miles of [1, 3, 5]) {
      const got = nearby(data, loc, miles);
      const want = data.rows.filter((r) => milesBetween(loc.lat, loc.lon, r[2], r[3]) <= miles);
      assert.equal(got.length, want.length);
      assert.ok(got.every((p) => p.dist <= miles));
    }
    assert.ok(nearby(data, loc, 1).length < nearby(data, loc, 3).length);
  });

  test('fromRow: a list row as the page uses it', () => {
    const data = list('auto'), loc = locate('Van Nuys', meta);
    const r = data.rows.find((x) => x[1] === 'Copperline Auto Care');
    const p = fromRow(r, data.types, loc);
    assert.equal(p.placeId, 'ovr:' + r[0]);
    assert.equal(p.btype, 'Auto repair shop');
    assert.match(p.address, /^\d+ [A-Z]\w+ (St|Ave), Van Nuys, CA 914\d\d$/);
    assert.match(p.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Copperline%20Auto%20Care%2C%20/);
    assert.ok(p.dist < 3);
  });

  test('"Something else": typed words match names and categories', () => {
    const m = customMatcher('nail salons near me');
    assert.ok(m.test('Lotus Pond Nails'));
    assert.ok(m.test('nail salon'));
    assert.equal(customMatcher('the shop'), null); // only filler words
    const other = list('other'), loc = locate('Van Nuys', meta);
    assert.deepEqual(nearby(other, loc, 10, customMatcher('plumbing')).map((p) => p.name), ['Steady Flow Plumbing']);
  });
});
