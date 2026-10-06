// supabase/*.sql against a real Postgres (PGlite: Postgres compiled to WebAssembly, in-process).
// The database starts the way a Supabase project does: API roles that get every privilege on new
// tables and functions by default. The SQL files have to take those privileges away.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const file = (name) => readFileSync(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const FILES = ['schema.sql', 'dashboard_code.sql', 'prospects.sql'];
const CODE = 'Open Sesame';
let db;

// Run a query as one of the API roles (anon is what the publishable key gets).
async function as(role, query, params) {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const asAnon = (query, params) => as('anon', query, params);
const json = (v) => JSON.stringify(v);

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create schema extensions; grant usage on schema extensions to anon, authenticated;`);
  for (const f of [...FILES, ...FILES]) await db.exec(file(f)); // in order, then again: safe to re-run
  // set the code with the command documented at the top of dashboard_code.sql
  const documented = file('dashboard_code.sql').split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n');
  assert.match(documented, /^insert into public\.dashboard_settings/);
  await db.exec(documented.replace('YOUR CODE', CODE));
});

describe('the publishable key (anon)', () => {
  test('can add a request from the website form, and only the customer columns', async () => {
    await asAnon("insert into public.requests (name, business, contact, website, needs) values ('Sam', 'Copperline Auto Care', '(818) 555-0100', '', 'A new site')");
    await assert.rejects(asAnon("insert into public.requests (name, business, contact, status) values ('Sam', 'Copperline', 'x', 'Won')"), /permission denied/);
    await assert.rejects(asAnon("insert into public.requests (name, business, contact, notes) values ('Sam', 'Copperline', 'x', 'vip')"), /permission denied/);
  });

  test('cannot add an empty request', async () => {
    await assert.rejects(asAnon("insert into public.requests (name, business, contact) values (' ', 'Copperline', 'x')"), /row-level security/);
  });

  test('can never read a request back, not even its own, or change one', async () => {
    await assert.rejects(asAnon('select * from public.requests'), /permission denied/);
    await assert.rejects(asAnon("update public.requests set status = 'Won'"), /permission denied/);
    await assert.rejects(asAnon('delete from public.requests'), /permission denied/);
  });

  test('cannot touch the call list or the code hash at all', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(as(role, 'select * from public.prospects'), /permission denied/);
      await assert.rejects(as(role, "insert into public.prospects (place_id) values ('x')"), /permission denied/);
      await assert.rejects(as(role, 'select * from public.dashboard_settings'), /permission denied/);
    }
  });

  test('cannot call the code check directly', async () => {
    await assert.rejects(asAnon("select public._dashboard_ok('x')"), /permission denied for function/);
  });
});

describe('the dashboard code', () => {
  test('is stored as a bcrypt hash, never the code', async () => {
    const [{ code_hash }] = (await db.query('select code_hash from public.dashboard_settings')).rows;
    assert.match(code_hash, /^\$2a\$/);
    assert.ok(!code_hash.toLowerCase().includes('sesame'));
  });

  test('ignores capitals and spaces', async () => {
    for (const c of ['open sesame', 'OPENSESAME', '  Open  Sesame ']) {
      assert.deepEqual(await asAnon('select public.dashboard_check($1) as ok', [c]), [{ ok: true }], c);
    }
  });

  test('a wrong code waits a second before saying no, to slow guessing', async () => {
    const t = Date.now();
    assert.deepEqual(await asAnon('select public.dashboard_check($1) as ok', ['open sesam']), [{ ok: false }]);
    assert.ok(Date.now() - t >= 900);
  });

  test('every function refuses a wrong code', async () => {
    await assert.rejects(asAnon('select * from public.prospects_rows($1)', ['nope']), (e) => e.code === '28000');
    await assert.rejects(asAnon('select * from public.dashboard_add($1, $2::jsonb)', ['nope', json({ business: 'x' })]), (e) => e.code === '28000');
  });

  test('every function that can see past the API runs with an empty search_path', async () => {
    const rows = (await db.query("select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).rows;
    assert.ok(rows.length >= 8);
    for (const r of rows) assert.deepEqual(r.proconfig, ['search_path=""'], r.proname);
  });
});

describe('the call list, through the functions', () => {
  const save = (rows) => asAnon('select * from public.prospects_save($1, $2::jsonb)', [CODE, json(rows)]);
  const update = (id, patch) => asAnon('select public.prospects_update($1, $2, $3::jsonb)', [CODE, id, json(patch)]);
  const rows = () => asAnon('select * from public.prospects_rows($1)', [CODE]);

  test("saving a business again refreshes its facts but never the team's work", async () => {
    const [first] = await save([{ place_id: 'ovr:1', name: 'Copperline Auto Care', vertical: 'auto', area: 'Van Nuys', phone: '(818) 555-0100', score: 70, site: { kind: 'site' } }]);
    assert.equal(first.status, 'To contact');
    await update(first.id, { status: 'Interested', notes: 'Owner is Sam; call after 3', follow_up: '2026-10-08', touches: 2, email: 'sam@copperlineautocare.test' });

    const [again] = await save([{ place_id: 'ovr:1', name: 'Copperline Auto Care & Smog', vertical: 'body', area: 'Encino', phone: '(818) 555-0101', score: 82, status: 'To contact', notes: '', email: 'info@copperlineautocare.test' }]);
    assert.equal(again.id, first.id);
    assert.equal(again.name, 'Copperline Auto Care & Smog');
    assert.equal(again.phone, '(818) 555-0101');
    assert.equal(again.score, 82);
    assert.equal(again.status, 'Interested');
    assert.equal(again.notes, 'Owner is Sam; call after 3');
    assert.equal(again.touches, 2);
    assert.equal(again.email, 'sam@copperlineautocare.test');
    assert.equal(again.vertical, 'auto');
    assert.equal(again.area, 'Van Nuys');
    assert.equal(new Date(again.follow_up).toISOString().slice(0, 10), '2026-10-08');
    assert.ok(again.updated_at > first.updated_at);
  });

  test('a patch changes only the keys it has, and null clears a date', async () => {
    const [p] = await rows();
    await update(p.id, { follow_up: null });
    const [after] = await rows();
    assert.equal(after.follow_up, null);
    assert.equal(after.notes, 'Owner is Sam; call after 3');
  });

  test('the table checks what goes in', async () => {
    const [p] = await rows();
    await assert.rejects(update(p.id, { status: 'Maybe' }), /check constraint/);
    await assert.rejects(update(p.id, { score: 101 }), /check constraint/);
    await assert.rejects(save(Array.from({ length: 101 }, (_, i) => ({ place_id: `ovr:${i}` }))), (e) => e.code === '22023');
  });

  test('remove', async () => {
    const [p] = await rows();
    await asAnon('select public.prospects_delete($1, $2)', [CODE, p.id]);
    assert.deepEqual(await rows(), []);
  });
});

describe('the pipeline hand-off', () => {
  test('dashboard_add takes the known columns and ignores the rest', async () => {
    const [r] = await asAnon('select * from public.dashboard_add($1, $2::jsonb)', [CODE, json({ business: 'Bluebird Garage', contact: '(818) 555-0102', source: 'Lead Finder', status: 'Audit booked', audit_date: '2026-10-09', findings: 'Domain expired', id: '00000000-0000-0000-0000-000000000000', surprise: true })]);
    assert.equal(r.source, 'Lead Finder');
    assert.equal(r.status, 'Audit booked');
    assert.notEqual(r.id, '00000000-0000-0000-0000-000000000000');
    const all = await asAnon('select business from public.dashboard_rows($1)', [CODE]);
    assert.deepEqual(all.map((x) => x.business).sort(), ['Bluebird Garage', 'Copperline Auto Care']);
  });
});
