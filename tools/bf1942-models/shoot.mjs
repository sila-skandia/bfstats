// Renders each extracted model to a PNG contact sheet without needing a visible browser.
//
//   node shoot.mjs [--url http://localhost:5273] [--out shots] [--views 3]
//
// Uses the Playwright chromium already installed for the E2E suite. WebGL needs a
// real GPU path in headless, so this runs the full (non-shell) chromium with SwiftShader.

import { chromium } from '../../ui/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const url = arg('url', 'http://localhost:5273');
const out = arg('out', 'shots');
const views = Number(arg('views', 3));
const only = arg('only', null);

await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', e => console.error('page error:', e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('button.model');

const names = await page.$$eval('button.model', els => els.map(e => e.firstChild.textContent.trim()));

for (const name of names) {
  if (only && name.toLowerCase() !== only.toLowerCase()) continue;

  await page.click(`button.model:has-text("${name}")`);
  await page.waitForFunction(
    n => document.querySelector('button.model[aria-pressed="true"]')?.textContent.includes(n),
    name,
  );
  await page.waitForTimeout(1200);

  // --rig shoots every declared input at full negative, rest, and full positive,
  // which is the clearest way to see what a RotationalBundle actually drives.
  if (process.argv.includes('--rig')) {
    const count = await page.$$eval('#rig input[type=range]', els => els.length);
    for (let i = 0; i < count; i++) {
      const label = await page.$$eval('#rig .rig-input label span:first-child',
        (els, n) => els[n].textContent.replace(/\W+/g, '_'), i);
      for (const value of [-1, 0, 1]) {
        await page.$$eval('#rig input[type=range]', (els, [n, v]) => {
          els[n].value = String(v);
          els[n].dispatchEvent(new Event('input', { bubbles: true }));
        }, [i, value]);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/${name}-rig-${label}-${value}.png` });
      }
    }
    continue;
  }

  // Orbit the camera by hand between shots so one model yields several angles.
  for (let v = 0; v < views; v++) {
    if (v > 0) {
      await page.mouse.move(800, 430);
      await page.mouse.down();
      await page.mouse.move(800 + 250, 430 - 40, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: `${out}/${name}-${v}.png` });
  }
}

await browser.close();
console.log(`wrote ${out}/`);
