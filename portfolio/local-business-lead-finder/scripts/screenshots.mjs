#!/usr/bin/env node
// The README's screenshots, from the demo: docs/screenshots/*.png.
//   npm run screenshots        (needs a Playwright Chromium: npx playwright install chromium)
//
// The audit pages are the PDF the app downloads, drawn by pdf.js inside the same browser.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './dev-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist');
await mkdir(OUT, { recursive: true });

const server = await startServer({ port: 0 });
const browser = await chromium.launch();
const shot = (page, name, opts = {}) => page.screenshot({ path: join(OUT, name), ...opts }).then(() => console.log('wrote docs/screenshots/' + name));

try {
  // 1. the search: scored, best first, with what each website check found
  const page = await browser.newPage({ viewport: { width: 1280, height: 1240 }, acceptDownloads: true, colorScheme: 'light' });
  await page.goto(server.url + '/app/');
  await page.waitForFunction(() => document.querySelectorAll('#results .res').length > 10 && !/checking/.test(document.querySelector('#rSub').textContent));
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'find.png');

  // 2. one business, saved to the call list: why it's a lead (after typing in its Google rating
  // and reviews), how to reach it, and the call log
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#results .res', { hasText: 'Copperline Auto Care' }).locator('.nm').click();
  await page.fill('[data-g="rating"]', '4.1');
  await page.press('[data-g="rating"]', 'Tab');
  await page.fill('[data-g="reviews"]', '23');
  await page.press('[data-g="reviews"]', 'Tab');
  await page.locator('#pLayer .why').getByText('Only 23 reviews').waitFor();
  await page.click('[data-psave]');
  await page.click('[data-touch="Left message"]');
  await page.fill('textarea[data-k="notes"]', 'Spoke to the front desk. Owner is in after 3.');
  await page.evaluate(() => {
    document.activeElement.blur();
    document.getElementById('pBody').scrollTop = 0;
  });
  await page.locator('#save').getByText('All changes saved').waitFor();
  await page.mouse.move(640, 990);
  await shot(page, 'business.png');

  // 3. its audit, as the app downloads it
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-audit]')]);
  const bytes = await readFile(await download.path());
  await writeFile(join(OUT, 'sample-audit.pdf'), bytes);
  console.log('wrote docs/screenshots/sample-audit.pdf');

  const viewer = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
  await viewer.route('http://viewer.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="c"></canvas><script type="module">import * as pdfjs from "/legacy/build/pdf.mjs"; pdfjs.GlobalWorkerOptions.workerSrc = "/legacy/build/pdf.worker.mjs"; window.pdfjs = pdfjs;</script></body>' });
    return route.fulfill({ path: join(PDFJS, path), contentType: path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
  });
  await viewer.goto('http://viewer.test/');
  await viewer.waitForFunction(() => window.pdfjs);
  for (const n of [1, 2]) {
    const size = await viewer.evaluate(async ([b64, n]) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await window.pdfjs.getDocument({ data, standardFontDataUrl: '/standard_fonts/' }).promise;
      const page = await doc.getPage(n), viewport = page.getViewport({ scale: 1.6 }), canvas = document.getElementById('c');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      return [viewport.width, viewport.height];
    }, [bytes.toString('base64'), n]);
    await shot(viewer, `audit-page-${n}.png`, { clip: { x: 0, y: 0, width: size[0], height: size[1] } });
  }
} finally {
  await browser.close();
  await server.close();
}
