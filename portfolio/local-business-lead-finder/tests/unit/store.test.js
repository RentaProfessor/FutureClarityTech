// The data layer in demo mode (public/js/store.js): the same rules the database enforces live.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fromDb, store, toDb } from '../../public/js/store.js';

before(() => {
  globalThis.window ??= { addEventListener() {} }; // the demo store listens for other tabs
  store.reset();
});

test('the demo store is the one in use without Supabase settings', () => {
  assert.equal(store.live, false);
});

test('saving a business again refreshes its facts but never what the team entered', async () => {
  const [first] = await store.prospects.save([{ placeId: 'ovr:1', name: 'Copperline Auto Care', phone: '(818) 555-0100', website: 'http://copperlineautocare.test/', vertical: 'auto', area: 'Van Nuys', score: 70 }]);
  assert.equal(first.status, 'To contact');
  assert.deepEqual(first.log, []);
  await store.prospects.update(first.id, { status: 'Interested', notes: 'Owner is Sam; call after 3', followUp: '2026-10-08', email: 'sam@copperlineautocare.test' });

  // the same business turns up in a later search, with new facts and the defaults a search sends
  const [again] = await store.prospects.save([{ placeId: 'ovr:1', name: 'Copperline Auto Care & Smog', phone: '(818) 555-0101', score: 82, status: 'To contact', notes: '', vertical: 'body', area: 'Encino', email: 'info@copperlineautocare.test' }]);
  assert.equal(again.id, first.id);
  assert.equal(again.name, 'Copperline Auto Care & Smog'); // facts refresh
  assert.equal(again.phone, '(818) 555-0101');
  assert.equal(again.score, 82);
  assert.equal(again.status, 'Interested'); // the team's work stays
  assert.equal(again.notes, 'Owner is Sam; call after 3');
  assert.equal(again.followUp, '2026-10-08');
  assert.equal(again.email, 'sam@copperlineautocare.test'); // set once, then the team's
  assert.equal(again.vertical, 'auto');
  assert.equal(again.area, 'Van Nuys');
  assert.equal((await store.prospects.list()).length, 1);
});

test('remove, and rows without a place id are ignored', async () => {
  const saved = await store.prospects.save([{ name: 'No id' }, { placeId: 'ovr:2', name: 'Bluebird Garage' }]);
  assert.deepEqual(saved.map((p) => p.name), ['Bluebird Garage']);
  await store.prospects.remove(saved[0].id);
  assert.ok(!(await store.prospects.list()).some((p) => p.placeId === 'ovr:2'));
  await assert.rejects(store.prospects.update('nope', { notes: 'x' }));
});

test('the hand-off to the pipeline is seen by whoever watches it', async () => {
  const seen = [];
  store.watch((rows) => seen.push(rows.length));
  const row = await store.add({ business: 'Copperline Auto Care', contact: '(818) 555-0100', source: 'Lead Finder', status: 'Contacted' });
  assert.ok(row.id && row.createdAt);
  assert.deepEqual(seen, [0, 1]);
});

test('rows go to the database in snake_case, with empty dates and numbers as null', () => {
  assert.deepEqual(toDb({ id: 'x', createdAt: 'x', placeId: 'ovr:1', followUp: '', lastTouch: '2026-10-01', rating: '', reviews: 12, mapsUrl: 'https://maps.test' }), {
    place_id: 'ovr:1', follow_up: null, last_touch: '2026-10-01', rating: null, reviews: 12, maps_url: 'https://maps.test',
  });
  assert.deepEqual(fromDb({ place_id: 'ovr:1', follow_up: null, rating: '4.5', reviews: null }), { placeId: 'ovr:1', followUp: '', rating: 4.5, reviews: null });
});
