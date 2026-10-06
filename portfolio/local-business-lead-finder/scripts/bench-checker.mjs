#!/usr/bin/env node
// How much CPU the website check spends reading a page: the part the free plan's 10 ms per call
// counts (time spent waiting on the network doesn't). Times inspect() on two synthetic pages: a
// typical small-business home page, and one at the 120 KB read cap with 1,000 links.
//   node scripts/bench-checker.mjs
// Node and Workers both run V8, but on different machines: treat the numbers as a guide.
import { performance } from 'node:perf_hooks';
import { LINK_SIGNATURES, SITE_MAX_BYTES, inspect } from '../functions/lib/site-check.js';

const hint = { name: 'copperline auto care', places: ['van nuys'], phone: '8185550100' };
const typical = `<!doctype html><html><head><title>Copperline Auto Care | Auto Repair in Van Nuys</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Auto repair in Van Nuys.">
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><link rel="stylesheet" href="/wp-content/themes/x/style.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"Copperline Auto Care"}</script></head><body>
<h1>Copperline Auto Care</h1><a href="tel:+18185550100">Call (818) 555-0100</a> <a href="https://booksy.com/x">Book now</a>
${'<p>Brakes, tune-ups and check engine lights in Van Nuys. <a href="/services">Services</a> <img src="/a.jpg" alt="Shop"></p>\n'.repeat(250)}
<footer>&copy; 2026 Copperline Auto Care</footer></body></html>`;
const links = Array.from({ length: 1000 }, (_, i) => `<a href="https://cdn${i % 40}.example-cdn.test/assets/${i}.js">x</a> `).join('');
const heavy = (typical.replace('</body>', links + '</body>') + '<p>filler text</p>'.repeat(20000)).slice(0, SITE_MAX_BYTES);

function time(label, html, fn = (h) => inspect(h, hint, 'www.copperlineautocare.test', '')) {
  for (let i = 0; i < 20; i++) fn(html); // warm up
  const runs = [];
  for (let i = 0; i < 300; i++) {
    const t = performance.now();
    fn(html);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(36)} ${(html.length / 1024).toFixed(0).padStart(4)} KB   median ${runs[150].toFixed(2)} ms   p95 ${runs[285].toFixed(2)} ms`);
}

// the first call in a fresh worker also compiles the one big signature pattern
const t0 = performance.now();
inspect(typical, hint, 'www.copperlineautocare.test', '');
console.log(`${'first call (compiles the pattern)'.padEnd(36)} ${(typical.length / 1024).toFixed(0).padStart(4)} KB   ${(performance.now() - t0).toFixed(2)} ms`);
time('typical home page', typical);
time('at the read cap, 1,000 links', heavy);

// For comparison, the obvious way: every signature as its own pattern, tested against the whole page.
const patterns = LINK_SIGNATURES.map((x) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\n')));
time('(each signature over the whole page)', heavy.toLowerCase(), (h) => patterns.filter((re) => re.test(h)).length);
