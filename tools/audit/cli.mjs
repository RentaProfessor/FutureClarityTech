#!/usr/bin/env node
// Prospect research CLI.
//
//   node tools/audit/cli.mjs <url> [url...]           human-readable
//   node tools/audit/cli.mjs --json <url> [url...]    machine-readable
//   node tools/audit/cli.mjs --json --file list.txt   one url per line
//
// Prints, per site, a score and the single most concrete problem — phrased to
// drop straight into the `observation` field the outreach sequencer requires.
// Nothing here is estimated: every finding is read off the fetched HTML.

import { readFileSync } from 'node:fs';
import { buildChecks, pickHeadline, allObservations } from './core.js';
import { extractFromHtml } from './extract.js';

const FETCH_TIMEOUT_MS = 12000;
const UA = 'FutureClarityAudit/1.0 (+https://futureclaritytechnologies.com)';

function normalise(raw) {
  let input = String(raw || '').trim();
  if (!input) return null;
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}

export async function auditUrl(raw) {
  const url = normalise(raw);
  if (!url) return { input: raw, reachable: false, error: 'Not a valid web address.' };

  const started = Date.now();
  let res, html;
  try {
    res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    html = await res.text();
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      input: raw,
      url: url.toString(),
      reachable: false,
      error: timedOut ? `No response within ${FETCH_TIMEOUT_MS / 1000}s.` : `Could not connect (${e.message}).`,
      headline: timedOut
        ? `their website didn't respond within ${FETCH_TIMEOUT_MS / 1000} seconds`
        : "their website didn't load at all",
    };
  }
  const ttfbMs = Date.now() - started;
  const finalUrl = new URL(res.url || url.toString());

  if (!res.ok) {
    // 401/403/429 almost always mean a bot filter (Cloudflare, Wordfence,
    // rate limiting) rather than a site that is actually down. Reporting
    // "your site returns a 403" to an owner whose site works fine in a browser
    // destroys credibility on the first line, so these are explicitly marked
    // as needing a human to look.
    const botFiltered = res.status === 401 || res.status === 403 || res.status === 429;
    return {
      input: raw, url: url.toString(), finalUrl: finalUrl.toString(),
      reachable: true, status: res.status,
      needsManualCheck: botFiltered,
      headline: botFiltered ? null : `their website returns an HTTP ${res.status} error`,
      error: botFiltered
        ? `HTTP ${res.status} — looks like a bot filter, not an outage. Open it in a browser before claiming anything.`
        : `HTTP ${res.status}.`,
    };
  }

  const f = extractFromHtml(html);
  const checks = buildChecks({ f, finalUrl, ttfbMs, originalUrl: url });
  const failed = checks.filter((c) => !c.pass);
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);

  return {
    // Kept for the second pass, which needs batch context to choose a headline
    // that is distinctive rather than merely important. Stripped before output.
    _f: f,
    _failed: failed,
    _ttfbMs: ttfbMs,
    input: raw,
    url: url.toString(),
    finalUrl: finalUrl.toString(),
    reachable: true,
    status: res.status,
    score,
    serverResponseMs: ttfbMs,
    htmlBytes: f.bytes,
    generator: f.generator || null,
    socialLinks: f.socialLinks,
    failed: failed.map((c) => c.id),
    criticalFailures: failed.filter((c) => c.weight === 'critical').map((c) => c.label),
    checks,
    observations: allObservations(failed, ttfbMs, f),
  };
}

// Second pass: now that the batch is known, pick each site's opener. A failure
// that every site in the batch shares is a weak opener no matter how grave.
function assignHeadlines(results) {
  const scored = results.filter((r) => r._failed);
  const common = {};
  for (const r of scored) for (const c of r._failed) common[c.id] = (common[c.id] || 0) + 1;
  for (const r of scored) {
    r.headline = pickHeadline(r._failed, r._ttfbMs, r._f, common, scored.length);
    delete r._f;
    delete r._failed;
    delete r._ttfbMs;
  }
  return { common, batchSize: scored.length };
}

function render(r) {
  const line = '─'.repeat(64);
  if (!r.reachable || r.error) {
    console.log(`\n${line}\n${r.input}\n  UNREACHABLE — ${r.error}`);
    if (r.headline) console.log(`  observation: ${r.headline}`);
    return;
  }
  console.log(`\n${line}`);
  console.log(`${r.finalUrl}`);
  console.log(`  score ${r.score}/100   ${r.serverResponseMs}ms   ${(r.htmlBytes / 1024).toFixed(0)}KB${r.generator ? `   built with: ${r.generator}` : ''}`);
  if (r.criticalFailures.length) console.log(`  CRITICAL: ${r.criticalFailures.join(' · ')}`);
  for (const c of r.checks.filter((c) => !c.pass)) console.log(`    ✗ ${c.label} — ${c.detail}`);
  console.log(`  observation: ${r.headline}`);
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
let targets = argv.filter((a) => !a.startsWith('--'));
const fileIdx = argv.indexOf('--file');
if (fileIdx !== -1) {
  const path = argv[fileIdx + 1];
  targets = targets.filter((t) => t !== path);
  targets.push(
    ...readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
  );
}

if (!targets.length) {
  console.error('usage: node tools/audit/cli.mjs [--json] [--file list.txt] <url>...');
  process.exit(1);
}

// Small concurrency: these are other people's servers, not a load test.
const out = [];
const CONCURRENCY = 4;
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  out.push(...(await Promise.all(targets.slice(i, i + CONCURRENCY).map(auditUrl))));
}
const { common, batchSize } = assignHeadlines(out);

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  out.forEach(render);
  const ranked = out.filter((r) => r.reachable && typeof r.score === 'number').sort((a, b) => a.score - b.score);
  console.log(`\n${'═'.repeat(64)}\nWORST FIRST (best prospects)\n`);
  ranked.forEach((r, i) =>
    console.log(`${String(i + 1).padStart(2)}. ${String(r.score).padStart(3)}/100  ${r.finalUrl}\n      ${r.headline}`),
  );

  const manual = out.filter((r) => r.needsManualCheck || (!r.reachable && r.error));
  if (manual.length) {
    console.log(`\nNEEDS A HUMAN BEFORE ANY CLAIM IS MADE\n`);
    manual.forEach((r) => console.log(`  ${r.input} — ${r.error}`));
  }

  // Shared failures are not good openers, but they ARE the product insight:
  // something every restaurant on the strip gets wrong is a repeatable pitch.
  const shared = Object.entries(common)
    .filter(([, n]) => n / batchSize >= 0.5)
    .sort((a, b) => b[1] - a[1]);
  if (shared.length) {
    console.log(`\nSHARED ACROSS THE BATCH (weak opener, strong positioning)\n`);
    shared.forEach(([id, n]) => console.log(`  ${id}: ${n}/${batchSize} sites`));
  }
}
