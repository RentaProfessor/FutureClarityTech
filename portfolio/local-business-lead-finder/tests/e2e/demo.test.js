// The demo, end to end, in Chromium: public/ served with the same headers Cloudflare sends
// (including the Content-Security-Policy), clicked through the way a person would.
//   npm run test:e2e        (needs a Playwright Chromium: npx playwright install chromium)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { startServer } from '../../scripts/dev-server.mjs';

let server, browser, page;
const problems = []; // console errors, failed requests, CSP violations

before(async () => {
  server = await startServer({ port: 0 });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('requestfailed', (r) => !/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && problems.push(`${r.url()} ${r.failure()?.errorText}`));
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const settled = () => page.waitForFunction(() => {
  const sub = document.querySelector('#rSub')?.textContent || '';
  return document.querySelectorAll('#results .res').length > 0 && !/checking/.test(sub);
}, null, { timeout: 20000 });
const card = (name) => page.locator('#results .res', { has: page.locator('.nm', { hasText: name }) });
const pdfOf = async (download) => getDocument({ data: new Uint8Array(await readFile(await download.path())), verbosity: 0 }).promise;

test('the landing page links to the app', async () => {
  await page.goto(server.url + '/');
  await page.getByRole('link', { name: 'Open the demo' }).click();
  await page.waitForURL(/\/app\/$/);
});

test('the demo opens on a search: scored, best first, websites checked', async () => {
  await settled();
  assert.match(await page.textContent('#rTitle'), /^\d+ auto repair businesses$/);
  const scores = await page.$$eval('#results .score b', (els) => els.map((e) => +e.textContent));
  assert.ok(scores.length >= 15);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  // what the checker found, on the cards
  await card('Ridgeway Motor Works').getByText('Website domain is for sale (Afternic)').waitFor();
  await card('Bluebird Garage').getByText('Domain registration expired').waitFor();
  await card('Firefly Muffler & Exhaust').getByText("Website is a host's default page").waitFor();
  // the chain is hidden until the filter is off
  assert.equal(await card('Lube Depot Express #14').count(), 0);
  await page.uncheck('#hideSkip');
  await card('Lube Depot Express #14').waitFor();
  await page.check('#hideSkip');
});

test('a smaller radius finds fewer businesses, all within it', async () => {
  const before = await page.locator('#results .res').count();
  await page.click('#radius [data-radius="1"]');
  await settled();
  const metas = await page.$$eval('#results .res .meta:first-of-type', (els) => els.map((e) => parseFloat(e.textContent.match(/([\d.]+) mi/)[1])));
  assert.ok(metas.length < before);
  assert.ok(metas.every((d) => d <= 1));
  await page.click('#radius [data-radius="3"]');
  await settled();
});

test('a business: why it is a lead, and the score moves with what you type in from Google', async () => {
  await card('Copperline Auto Care').locator('.nm').click();
  await page.locator('#pLayer .why').getByText("Site isn't built for phones").waitFor();
  const score = async () => +(await page.textContent('#pBody .bigscore .score b'));
  const start = await score();
  await page.fill('[data-g="reviews"]', '12');
  await page.press('[data-g="reviews"]', 'Tab');
  await page.fill('[data-g="rating"]', '3.9');
  await page.press('[data-g="rating"]', 'Tab');
  await page.locator('#pLayer .why').getByText('Rated 3.9').waitFor();
  assert.equal(await score(), Math.min(100, start + 14 + 10));
});

test('save it, log a call, and download its audit: a two-page PDF', async () => {
  await page.click('[data-psave]');
  await page.locator('#pNav').getByRole('button', { name: 'Add to pipeline' }).waitFor();
  await page.click('[data-touch="Left message"]');
  assert.equal(await page.inputValue('select[data-k="status"]'), 'Left message');
  await page.fill('textarea[data-k="notes"]', 'Owner is Sam; call after 3');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-audit]')]);
  assert.equal(download.suggestedFilename(), 'Copperline Auto Care - online audit.pdf');
  const doc = await pdfOf(download);
  assert.equal(doc.numPages, 2);
  assert.equal((await doc.getMetadata()).info.Title, 'Copperline Auto Care · Online presence audit');
  await page.locator('#pBody .loglist').getByText('Audit downloaded').waitFor();
});

test('the call list: the saved business, its notes, a CSV and the pipeline hand-off', async () => {
  await page.click('[data-close="p"].btn');
  await page.click('[data-view="list"]');
  const row = page.locator('#plist .res', { hasText: 'Copperline Auto Care' });
  await row.getByText('Owner is Sam; call after 3').waitFor();
  assert.equal(await page.textContent('#listCount'), '1');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const text = await readFile(await csv.path(), 'utf8');
  assert.match(text, /^\ufeffBusiness,Type,Fit score,Status/);
  assert.match(text, /Copperline Auto Care,Auto repair,\d+,Left message/);

  await row.locator('.nm').click();
  await page.click('[data-book]');
  await page.click('[data-bookgo]');
  await page.locator('#pNav').getByText('In the pipeline').waitFor();
  await page.click('[data-close="p"].btn');
  assert.equal(await page.textContent('#listCount'), '0'); // in the pipeline: closed on the call list
});

test('the call list is still there after a reload, and "Reset demo" clears it', async () => {
  await page.reload();
  await settled();
  await page.click('[data-view="list"]');
  await page.click('[data-w="done"]'); // handed to the pipeline: in the Closed box
  await page.locator('#plist .res', { hasText: 'Copperline Auto Care' }).getByText('In pipeline').waitFor();
  await page.click('#signOut');
  await page.waitForLoadState('load');
  await settled();
  assert.equal(await page.textContent('#listCount'), '0');
});

test('no errors, failed requests or CSP violations along the way', () => {
  assert.deepEqual(problems, []);
});

test('fits a phone screen without sideways scrolling', async () => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(server.url + '/app/');
  await phone.waitForSelector('#results .res');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await phone.close();
});
