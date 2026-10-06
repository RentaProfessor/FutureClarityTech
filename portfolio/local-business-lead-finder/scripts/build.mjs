#!/usr/bin/env node
// Builds dist/ for Cloudflare Pages: a copy of public/, pointed at your Supabase project when
// SUPABASE_URL and SUPABASE_KEY are set. They're the same two variables the website checker in
// functions/ reads at runtime, so set them once in the Pages project for both. Without them,
// dist/ is the demo.
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_KEY=<publishable key> npm run build
//   node scripts/build.mjs --out <dir>      (somewhere other than dist/)
//
// The key must be the publishable one: it goes to every browser, and what it can do is decided
// in Postgres (supabase/*.sql). The build refuses a secret or service_role key.
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : join(ROOT, 'dist'));
const fail = (msg) => {
  console.error(`build: ${msg}`);
  process.exit(1);
};

// A secret key: Supabase's new format, or a legacy JWT whose role is service_role.
function isSecretKey(key) {
  if (/^sb_secret_/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_KEY || '').trim();
if (!!url !== !!key) fail('set both SUPABASE_URL and SUPABASE_KEY, or neither (for the demo).');
let origin = '';
if (url) {
  try {
    origin = new URL(url).origin;
  } catch {
    fail(`SUPABASE_URL isn't a URL: ${url}`);
  }
  if (!origin.startsWith('https://')) fail('SUPABASE_URL must be https.');
  if (isSecretKey(key)) fail("SUPABASE_KEY is a secret (service_role) key. Use the project's publishable key: this one is sent to every browser.");
}

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, 'public'), OUT, { recursive: true });

if (!origin) {
  console.log(`build: ${OUT} is the demo (no SUPABASE_URL / SUPABASE_KEY).`);
} else {
  await writeFile(join(OUT, 'js', 'env.js'), `// Written by scripts/build.mjs.\nexport default ${JSON.stringify({ supabaseUrl: origin, supabaseKey: key })};\n`);
  const headers = await readFile(join(OUT, '_headers'), 'utf8');
  const patched = headers.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
  if (patched === headers) fail("public/_headers has no \"connect-src 'self'\" to add the project to.");
  await writeFile(join(OUT, '_headers'), patched);
  await rm(join(OUT, 'data', 'demo-checks.json'), { force: true }); // live checks come from functions/
  const meta = join(OUT, 'data', 'places', 'meta.json');
  if (existsSync(meta) && JSON.parse(await readFile(meta, 'utf8')).synthetic) {
    console.warn('build: warning: the business list is still the demo\'s synthetic one. Run scripts/build-places.py to build the real one.');
  }
  console.log(`build: ${OUT} talks to ${origin}.`);
}
