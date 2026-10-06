// POST /api/prospects: the website checker behind the Lead Finder (public/app/).
//
// Finding businesses happens in the browser, from the business list served with the site. This
// function only does what a browser can't: open another business's website, for the lead score and
// again right before a downloadable audit (functions/lib/site-check.js does the checking).
//
//   { action: 'sites', code, urls: [up to 3], hints: [{ name, places, phone }, ...] }
//       → { results: [{ url, kind, ... }, ...] }, one per url.
//       hints are optional, one per url: the business's name, area names and phone, only ever
//       searched for on the page.
//
// Every call must carry the team's dashboard code. It is checked by Supabase (dashboard_check in
// supabase/dashboard_code.sql), exactly like the page does it, so nobody else can use this as a
// free web fetcher. Settings, from the Pages project's environment variables:
//   SUPABASE_URL, SUPABASE_KEY   the project and its publishable key (the same two the page uses)
//   CHECK_USER_AGENT             optional: the User-Agent websites see (say who you are and how to reach you)
import { checkSite } from '../lib/site-check.js';

export const SITES_PER_CALL = 3; // keeps each call inside the free plan's subrequest and CPU limits

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return reply({ error: 'not_configured' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  if (!body || typeof body !== 'object') return reply({ error: 'bad_request' }, 400);

  const ok = await codeOk(env, body.code);
  if (ok === null) return reply({ error: 'auth_unavailable' }, 502);
  if (!ok) return reply({ error: 'wrong_code' }, 401);

  if (body.action === 'sites') return sites(body, env);
  return reply({ error: 'bad_request' }, 400);
}

// ---------------------------------------------------------------- dashboard code

// A code that passed is remembered for 10 minutes by this worker instance, so a search followed
// by several website checks costs one database round trip, not five. Only a hash of it is kept.
const passed = new Map();
const PASS_MS = 10 * 60 * 1000;

async function codeOk(env, code) {
  if (typeof code !== 'string' || code.length < 1 || code.length > 200) return false;
  const key = await sha256(code.toLowerCase().replace(/\s/g, ''));
  const until = passed.get(key);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/dashboard_check`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const yes = (await res.json()) === true;
    if (yes) {
      if (passed.size > 50) passed.clear();
      passed.set(key, Date.now() + PASS_MS);
    }
    return yes;
  } catch {
    return null;
  }
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- website check

async function sites(body, env) {
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string').slice(0, SITES_PER_CALL) : [];
  if (!urls.length) return reply({ error: 'bad_request' }, 400);
  const hints = Array.isArray(body.hints) ? body.hints : [];
  const opts = { userAgent: env.CHECK_USER_AGENT || undefined };
  const results = await Promise.all(
    urls.map((u, i) => checkSite(u, cleanHint(hints[i]), opts).catch(() => ({ url: u, kind: 'error', error: 'check failed' }))),
  );
  return reply({ results });
}

// The business's name, area names and phone, lowercased and cut short: they're only searched for.
export function cleanHint(h) {
  if (!h || typeof h !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 120).toLowerCase().trim() : '');
  return {
    name: str(h.name),
    places: (Array.isArray(h.places) ? h.places : []).map(str).filter((p) => p.length >= 3).slice(0, 3),
    phone: str(h.phone).replace(/\D/g, '').slice(-10),
  };
}
