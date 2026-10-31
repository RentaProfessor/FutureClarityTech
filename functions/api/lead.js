// POST /api/lead: the free-quote form on the homepage.
//
// Saves the request in Supabase with the same public, insert-only key the browser used
// before (supabase/schema.sql decides what a visitor may write), then emails the team.
// The email goes through a Google Apps Script web app in our Workspace
// (scripts/lead-alert.gs.js). Its URL is LEAD_ALERT_URL in Cloudflare Pages > Settings >
// Variables and secrets, not in this public repo. Without it, requests still save; they
// just don't send an email.
//
// The alert runs after the visitor gets their answer (waitUntil), so a slow or failed email
// never costs a lead. If this function can't be reached at all, public/fc-store.js saves
// straight to Supabase as before.

// Same public values as public/fc-config.js (safe to publish; access is enforced in the database).
const SUPABASE_URL = 'https://bzudkcybqhmqrybskwfn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_te0V9b4k8S0M1iBO0q89Rg_ziCLo9CQ';

const ALERT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 20000;

// What a visitor may send, with the same limits as the requests table.
const TEXT_LIMITS = { name: 200, business: 200, contact: 200, website: 500, app: 200, needs: 5000, est_shown: 200 };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  const row = clean(body);
  if (!row) return reply({ error: 'bad_request' }, 400);

  let saved;
  try {
    saved = await fetch(SUPABASE_URL + '/rest/v1/requests', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    return reply({ error: 'save_failed' }, 502);
  }
  if (!saved.ok) return reply({ error: 'save_failed', status: saved.status }, 502);

  if (env.LEAD_ALERT_URL) waitUntil(alert(env.LEAD_ALERT_URL, row));
  return reply({ ok: true });
}

// Only the customer columns, as trimmed strings within the table's limits; scope stays an
// object. Name, business and contact are required, like the database policy.
function clean(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const row = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const v = body[key];
    if (v !== undefined && typeof v !== 'string') return null;
    row[key] = (v || '').trim().slice(0, max);
  }
  if (!row.name || !row.business || !row.contact) return null;
  const scope = body.scope;
  row.scope = scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
  return row;
}

async function alert(url, row) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: row.name, business: row.business, contact: row.contact, needs: row.needs }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('lead alert failed', err);
  }
}
