// The PDF writer (public/js/pdf-writer.js) and the audit (public/js/audit.js). Files are checked
// twice: byte by byte against the PDF structure, and by opening them with pdf.js, Mozilla's PDF
// engine (a dev dependency only).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Doc, clean, cleanName, width, wrap } from '../../public/js/pdf-writer.js';
import { KEEP, auditInput, fileName, pagesAt, pdf } from '../../public/js/audit.js';
import { fromRow } from '../../public/js/places.js';

const TODAY = '2026-10-06';

// The structure a strict reader relies on: a cross-reference table whose every entry is the exact
// byte offset of its object, a trailer that agrees with it, and stream lengths that are exact.
function assertStrictPdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'), 'header');
  const end = s.match(/startxref\n(\d+)\n%%EOF\n$/);
  assert.ok(end, 'startxref at the end');
  const at = Number(end[1]);
  assert.equal(s.slice(at, at + 5), 'xref\n', 'startxref points at the table');
  const [, first, count] = s.slice(at).match(/^xref\n(\d+) (\d+)\n/);
  assert.equal(first, '0');
  const table = s.slice(at).split('\n').slice(2, 2 + Number(count));
  assert.equal(table[0], '0000000000 65535 f ');
  table.slice(1).forEach((entry, i) => {
    assert.match(entry, /^\d{10} 00000 n $/, 'each entry is 20 bytes');
    const off = Number(entry.slice(0, 10)), head = `${i + 1} 0 obj\n`;
    assert.equal(s.slice(off, off + head.length), head, `object ${i + 1} is where the table says`);
  });
  assert.equal([...s.matchAll(/(?<=\n)\d+ 0 obj\n/g)].length, Number(count) - 1, 'every object is in the table');
  assert.equal(Number(s.match(/trailer\n<< \/Size (\d+)/)[1]), Number(count));
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream', 'stream length is exact');
  }
}
const open = (bytes) => getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
const pageText = async (doc, n) => (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');

// The demo's businesses, as the call list would hand them to the audit, with their canned website checks.
function demoAudits() {
  const checks = JSON.parse(readFileSync(new URL('../../public/data/demo-checks.json', import.meta.url), 'utf8'));
  const out = [];
  for (const k of ['auto', 'groom', 'detail', 'body', 'dojo', 'tattoo', 'barber', 'other']) {
    const data = JSON.parse(readFileSync(new URL(`../../public/data/places/${k}.json`, import.meta.url), 'utf8'));
    data.rows.forEach((r, i) => {
      const p = { ...fromRow(r, data.types, { lat: 34.19, lon: -118.45, label: 'Van Nuys' }), vertical: k === 'other' ? 'custom' : k, area: 'Van Nuys' };
      const reviews = [null, 0, 9, 37, 140][i % 5]; // some with Google reviews typed in, some without
      out.push(auditInput({ ...p, reviews, rating: reviews ? [4.8, 3.7, 4.2][i % 3] : null }, { site: checks[p.website] || null, today: TODAY }));
    });
  }
  return out;
}

describe('the PDF writer', () => {
  test('a one-page document is well-formed, and pdf.js reads its text and links', async () => {
    const doc = Doc();
    doc.addPage();
    doc.text(50, 100, 'Hello (world) \\ – “quoted” €5 · Café');
    doc.rect(50, 120, 200, 40, { fill: '#3a3fc4', r: 8 });
    doc.circle(300, 140, 10, '#1d6b3a');
    doc.line(50, 200, 300, 200);
    doc.link(50, 90, 100, 14, 'https://example.org/ünïcode path');
    const bytes = doc.bytes({ title: 'Test', author: 'Tests' });
    assertStrictPdf(bytes);
    const pdfDoc = await open(bytes);
    assert.equal(pdfDoc.numPages, 1);
    assert.equal(await pageText(pdfDoc, 1), 'Hello (world) \\ – “quoted” €5 · Café');
    const [link] = await (await pdfDoc.getPage(1)).getAnnotations();
    assert.equal(link.url, 'https://example.org/%C3%BCn%C3%AFcode%20path');
  });

  test('document info takes any language (UTF-16), even where the page text cannot', async () => {
    const bytes = Doc().bytes({ title: 'Ōkubo 大久保 Garage', author: 'Ünïcode Author' });
    const { info } = await (await open(bytes)).getMetadata();
    assert.equal(info.Title, 'Ōkubo 大久保 Garage');
    assert.equal(info.Author, 'Ünïcode Author');
  });

  test('clean(): text as the built-in fonts can show it', () => {
    assert.equal(clean('Ōkubo Café'), 'Okubo Café'); // é is in the font, Ō is simplified
    assert.equal(clean('𝙿𝚘𝚠𝚎𝚛 Lube 🚗'), 'Power Lube');
    assert.equal(clean('Łódź – “Auto”'), 'Lódz – “Auto”');
    assert.equal(cleanName('Example Beauty Salon سالن'), 'Example Beauty Salon');
    assert.equal(cleanName('سالن'), '');
  });

  test('wrap(): every line fits, measured with the real glyph widths', () => {
    const text = 'Your website took about 7 seconds to answer when we checked. Slow sites lose visitors, especially on phones.';
    for (const [font, size, max] of [['R', 9.5, 200], ['B', 10.5, 120], ['R', 22, 300]]) {
      const lines = wrap(text, font, size, max);
      assert.ok(lines.length > 1);
      assert.ok(lines.every((l) => width(l, font, size) <= max), `${font} ${size} ${max}`);
      assert.equal(lines.join(' '), text);
    }
    assert.ok(width('MMMM', 'B', 10) > width('iiii', 'B', 10)); // proportional, not monospace
  });

  test('wrap(): a web address longer than the line is split anywhere', () => {
    const url = 'https://www.a-very-long-domain-name-for-testing-line-breaks.example.com/path';
    const lines = wrap(url, 'R', 10, 120);
    assert.ok(lines.length >= 3);
    assert.equal(lines.join(''), url);
    assert.ok(lines.every((l) => width(l, 'R', 10) <= 120));
  });

  test('fileName(): safe on every operating system', () => {
    assert.equal(fileName('Ōkubo Café Garage: "Test" / A|B'), 'Okubo Café Garage Test A B - online audit.pdf');
    assert.equal(fileName('سالن'), 'Business - online audit.pdf');
  });
});

describe('the audit', () => {
  const audits = demoAudits();

  test('every audit in the demo is exactly two pages, with a bookmark at the start of each', async () => {
    const bytes = pdf(audits);
    assertStrictPdf(bytes);
    const doc = await open(bytes);
    assert.equal(doc.numPages, 2 * audits.length);
    const outline = await doc.getOutline();
    assert.equal(outline.length, audits.length);
    for (const [i, item] of outline.entries()) {
      assert.equal(item.title, audits[i].name);
      assert.equal(await doc.getPageIndex(item.dest[0]), 2 * i);
    }
  });

  test('a long audit drops detail, least useful first, until it fits on two pages', async () => {
    const levels = audits.map((a) => KEEP.findIndex((keep) => pagesAt(a, keep) <= 2));
    assert.ok(levels.every((l) => l >= 0), 'every audit fits at some level');
    assert.ok(levels.some((l) => l > 0), 'some need detail dropped');
    // the first thing to go is the Google listing checklist (its headings are letter-spaced, so
    // look for its first sentence)
    const long = audits[levels.findIndex((l) => l > 0)], short = audits[levels.indexOf(0)];
    const text = async (a) => {
      const doc = await open(pdf([a]));
      return (await pageText(doc, 1)) + (await pageText(doc, 2));
    };
    assert.doesNotMatch(await text(long), /We can't see these from outside/);
    assert.match(await text(short), /We can't see these from outside/);
  });

  test('a single audit: no bookmarks, and its title names the business', async () => {
    const a = audits.find((x) => x.name === 'Copperline Auto Care');
    const doc = await open(pdf([a]));
    assert.equal(doc.numPages, 2);
    assert.equal(await doc.getOutline(), null);
    assert.equal((await doc.getMetadata()).info.Title, 'Copperline Auto Care · Online presence audit');
  });

  test('what a dated site\'s audit says, and how to fix it', async () => {
    const a = audits.find((x) => x.name === 'Copperline Auto Care');
    const doc = await open(pdf([a]));
    const text = (await pageText(doc, 1)) + ' ' + (await pageText(doc, 2));
    for (const want of ['Copperline Auto Care · Online presence audit', "isn't set up for phones", '"Not secure"', '© 2016', 'Fix:']) {
      assert.ok(text.includes(want), want);
    }
    assert.match(text, /1 \/ 2/);
    assert.match(text, /2 \/ 2/);
  });

  test("an expired domain's audit gives the date and the registrar to call", async () => {
    const a = audits.find((x) => x.name === 'Bluebird Garage');
    const text = await pageText(await open(pdf([a])), 1);
    assert.match(text, /expired on July 14, 2026/);
    assert.match(text, /Namecheap/);
  });

  test('web addresses, emails and phone numbers in the sign-off are links', async () => {
    const a = { ...audits.find((x) => x.name === 'Bluebird Garage'), from: ['Sam Rivera', 'FutureClarity Technologies', '(818) 555-0100 · sam@example.com'] };
    const doc = await open(pdf([a]));
    const urls = [];
    for (let n = 1; n <= doc.numPages; n++) urls.push(...(await (await doc.getPage(n)).getAnnotations()).map((x) => x.unsafeUrl)); // as written in the file
    assert.ok(urls.includes('tel:+18185550100'));
    assert.ok(urls.includes('mailto:sam@example.com'));
    assert.ok(urls.includes('https://futureclaritytechnologies.com'));
  });

  test('names in other scripts: simplified on the page, kept in the document title', async () => {
    const a = { ...audits[0], name: 'Ōkubo Café Garage سالن' };
    const doc = await open(pdf([a]));
    assert.equal(doc.numPages, 2);
    assert.match(await pageText(doc, 1), /Okubo Café Garage/);
    assert.equal((await doc.getMetadata()).info.Title, 'Ōkubo Café Garage سالن · Online presence audit');
  });

  test('the sparsest audit (no website, no reviews) and a very long name are still two pages', async () => {
    const base = audits.find((x) => !x.website);
    for (const a of [{ ...base, reviews: null, phone: '' }, { ...base, name: 'The Original Family-Owned Valley Auto Repair, Smog Check & Transmission Center of Van Nuys' }]) {
      assert.equal((await open(pdf([a]))).numPages, 2);
    }
  });

  test('the audit date and the check date are what auditInput was given', () => {
    const a = auditInput({ name: 'X', vertical: 'auto' }, { site: { kind: 'site', at: '2026-09-30' }, today: TODAY });
    assert.equal(a.date, 'October 6, 2026');
    assert.equal(a.checkedOn, 'September 30, 2026');
    assert.equal(a.year, 2026);
  });
});
