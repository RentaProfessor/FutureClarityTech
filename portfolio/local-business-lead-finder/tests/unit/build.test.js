// scripts/build.mjs: dist/ for Cloudflare Pages, demo or live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT = new URL('../../scripts/build.mjs', import.meta.url).pathname;
const build = async (env) => {
  const out = await mkdtemp(join(tmpdir(), 'lead-finder-build-'));
  const r = await run(process.execPath, [SCRIPT, '--out', out], { env: { PATH: process.env.PATH, ...env } }).catch((e) => e);
  return { out, code: r.code || 0, stderr: r.stderr };
};
// a legacy-style key whose payload says which role it is (the signature doesn't matter here)
const jwt = (role) => ['e30', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'sig'].join('.');

test('without settings, dist is the demo', async () => {
  const { out, code } = await build({});
  assert.equal(code, 0);
  assert.match(await readFile(join(out, 'js', 'env.js'), 'utf8'), /supabaseUrl: ''/);
  assert.ok(existsSync(join(out, 'data', 'demo-checks.json')));
});

test('with settings, the page talks to that project and the CSP allows it', async () => {
  const { out, code } = await build({ SUPABASE_URL: 'https://abcdefghij.supabase.co/', SUPABASE_KEY: 'sb_publishable_example' });
  assert.equal(code, 0);
  assert.match(await readFile(join(out, 'js', 'env.js'), 'utf8'), /"supabaseUrl":"https:\/\/abcdefghij\.supabase\.co","supabaseKey":"sb_publishable_example"/);
  assert.match(await readFile(join(out, '_headers'), 'utf8'), /connect-src 'self' https:\/\/abcdefghij\.supabase\.co;/);
  assert.ok(!existsSync(join(out, 'data', 'demo-checks.json')));
});

test('a secret key is refused, in either format', async () => {
  for (const key of ['sb_secret_example', jwt('service_role')]) {
    const { code, stderr } = await build({ SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_KEY: key });
    assert.equal(code, 1);
    assert.match(stderr, /secret \(service_role\) key/);
  }
  assert.equal((await build({ SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_KEY: jwt('anon') })).code, 0);
});

test('half the settings, or plain http, is a mistake', async () => {
  assert.equal((await build({ SUPABASE_URL: 'https://abcdefghij.supabase.co' })).code, 1);
  assert.equal((await build({ SUPABASE_URL: 'http://abcdefghij.supabase.co', SUPABASE_KEY: 'sb_publishable_example' })).code, 1);
});
