#!/usr/bin/env node
// Pull a contact address off a prospect's own website.
//
//   node tools/audit/find-emails.mjs <url>...
//
// Homepage first, then the obvious contact pages. Only addresses the business
// published on its own site are returned -- nothing is guessed, pattern-built
// from a person's name, or bought. If a business did not publish an address,
// this returns none and that prospect goes to the phone list instead.

const TIMEOUT = 12000;
const UA = 'FutureClarityAudit/1.0 (+https://futureclaritytechnologies.com)';
const CONTACT_PATHS = ['', '/contact', '/contact-us', '/contactus', '/about', '/about-us'];

// Addresses that are never a decision-maker: image filenames caught by the
// pattern, and the platform boilerplate that ships with site builders.
// Platform telemetry addresses (Sentry on Wix, etc.) appear as SUBDOMAINS --
// "@sentry-next.wixpress.com" -- so these have to match anywhere in the host,
// not just immediately after the @.
const JUNK = /(\.(png|jpe?g|gif|svg|webp|css|js|ico)$|^(example|test|your|email|name|user|someone|sentry)@|@[^@]*\b(example|sentry|wixpress|squarespace|godaddy|shopify|weebly|wordpress|automattic|cloudflare|jsdelivr)\b)/i;
const ROLE_RANK = ['owner', 'info', 'hello', 'contact', 'office', 'admin', 'sales', 'manager', 'catering', 'orders'];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

async function grab(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': UA, accept: 'text/html' },
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return '';
    return await res.text();
  } catch {
    return '';
  }
}

function harvest(html, siteHost) {
  const found = new Map();
  // mailto: links are the strongest signal -- deliberately published.
  for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    let e;
    try {
      e = decodeURIComponent(m[1]).trim().toLowerCase();
    } catch {
      continue; // malformed percent-encoding in the href
    }
    // A mailto: does not have to contain an address -- "mailto:" alone, or a
    // templating placeholder, both appear in the wild and leave no domain to
    // score against.
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) continue;
    if (!JUNK.test(e)) found.set(e, 'mailto');
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const e = m[0].trim().toLowerCase();
    if (!JUNK.test(e) && !found.has(e)) found.set(e, 'text');
  }
  const bare = siteHost.replace(/^www\./, '');
  return [...found.entries()]
    .map(([email, how]) => {
      const [local, domain] = email.split('@');
      if (!local || !domain) return null;
      let score = how === 'mailto' ? 10 : 0;
      if (domain === bare || domain.endsWith('.' + bare)) score += 20; // same-domain = theirs
      const r = ROLE_RANK.indexOf(local);
      if (r !== -1) score += 12 - r;
      return { email, how, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

async function forSite(raw) {
  let base;
  try {
    base = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return { site: raw, emails: [] };
  }
  const all = new Map();
  for (const path of CONTACT_PATHS) {
    const html = await grab(new URL(path || '/', base).toString());
    if (!html) continue;
    for (const hit of harvest(html, base.hostname)) {
      if (!all.has(hit.email) || all.get(hit.email).score < hit.score) all.set(hit.email, hit);
    }
    // Stop as soon as we have something clearly theirs; no need to walk further.
    if ([...all.values()].some((h) => h.score >= 30)) break;
  }
  return { site: base.hostname, emails: [...all.values()].sort((a, b) => b.score - a.score).slice(0, 4) };
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('usage: node tools/audit/find-emails.mjs <url>...');
  process.exit(1);
}
const out = [];
for (let i = 0; i < targets.length; i += 6) {
  out.push(...(await Promise.all(targets.slice(i, i + 6).map(forSite))));
}
console.log(JSON.stringify(out, null, 2));
