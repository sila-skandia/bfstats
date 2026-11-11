// The armoury browser in a real page with a synthetic 4,000-model catalogue:
// index.html's own markup and inline shim, index.css, and model-browser.js,
// served from viewer/ under a fixture origin. Prints one JSON object for
// test_armoury_browser.py (features/mesh-viewer-performance, "Armoury
// browser open"); prints {"skip": why} when Chromium will not start.

import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWER = resolve(HERE, '..', 'viewer');
const { chromium } = await import(resolve(HERE, '../../../ui/node_modules/playwright/index.mjs'));
const ORIGIN = 'http://armoury.test';
const MODELS = 4000;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.log(JSON.stringify({ skip: `chromium did not start: ${error.message.split('\n')[0]}` }));
  process.exit(0);
}

// index.html up to its module scripts: the markup, the stylesheets and the
// inline shim, as the page has them before anything else has loaded.
const index = await readFile(join(VIEWER, 'index.html'), 'utf8');
const cut = index.indexOf('<script type="importmap">');
const fixture = `${index.slice(0, cut)}</body></html>`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(`${ORIGIN}/**`, async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/index.html') return route.fulfill({ body: fixture, contentType: 'text/html' });
  if (path.startsWith('/models/')) return route.fulfill({ body: PNG, contentType: 'image/png' });
  try {
    const body = await readFile(join(VIEWER, path));
    return route.fulfill({ body, contentType: TYPES[extname(path)] || 'application/octet-stream' });
  } catch {
    return route.fulfill({ status: 404, body: '' });
  }
});

await page.goto(`${ORIGIN}/index.html`);
const result = { models: MODELS, errors };

// 1. Before the module: the shim opens the shell in the click's own task.
result.early = await page.evaluate(() => {
  document.getElementById('browse-open').click();
  return {
    shown: !document.getElementById('browser').hidden,
    skeleton: document.querySelectorAll('#browser-body .card-skeleton').length,
    focused: document.activeElement?.id,
  };
});
await page.fill('#browser-search', 'tank');

// 2. The module arrives with the catalogue and takes over.
await page.addScriptTag({ type: 'module', content: `
  import { createArmouryBrowser } from './model-browser.js';
  import { normalizeVariants } from './model-variants.js';
  const categories = ['land', 'air', 'sea', 'handweapon'];
  const manifest = Array.from({ length: ${MODELS} }, (_, i) => ({
    name: (i % 3 ? 'Tank' : 'Plane') + String(i).padStart(4, '0'),
    mod: 'synthetic', category: categories[i % 4],
    sides: [i % 2 ? 'Allied' : 'Axis'], factions: ['F' + (i % 5)], theatres: ['T' + (i % 3)],
    kitClasses: ['kit' + (i % 200)], levels: ['Level_' + (i % 40)], weapons: [],
    texturesMissing: [], triangles: 100 + i, parts: 1 + (i % 9), hitpoints: i,
    dimensions: { length: 1 + i % 20, width: 1, height: 1, maxExtent: 1 + i % 20 },
    thumb: 'thumbs/' + i + '.png', glb: i + '.glb',
  })).map((entry, index) => ({ ...entry, index, variants: normalizeVariants(entry) }));
  window.__picked = [];
  window.__armoury = createArmouryBrowser({
    attr: value => String(value).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';'),
    camera: { fov: 40 }, currentEntry: null, damageTables: null, manifest,
    MODELS_BASE: 'models', PORTRAIT_EXTENTS: 2,
    showVariant: index => { window.__picked.push(index); },
  });
  window.__ready = true;
` });
await page.waitForFunction(() => window.__ready);
await page.waitForFunction(() => document.querySelector('#browser-body .card'));
const cards = () => page.evaluate(() => document.querySelectorAll('#browser-body .card').length);
result.takeover = await page.evaluate(() => ({
  shimGone: window.__armouryEarly === undefined,
  query: document.getElementById('browser-search').value,
  count: document.getElementById('browser-count').textContent,
  cards: document.querySelectorAll('#browser-body .card').length,
  names: [...document.querySelectorAll('#browser-body .card-name')].slice(0, 3).map(n => n.textContent),
}));

// 3. Every model, closed, then opened by the module's own button: the shell
// shows in the click's task, which builds no more than the first chunk.
await page.fill('#browser-search', '');
await page.keyboard.press('Escape');
result.closed = await page.evaluate(() => document.getElementById('browser').hidden);
result.open = await page.evaluate(() => {
  const before = performance.now();
  document.getElementById('browse-open').click();
  return {
    shown: !document.getElementById('browser').hidden,
    cardsInTask: document.querySelectorAll('#browser-body .card').length,
    ms: performance.now() - before,
  };
});
result.facets = await page.evaluate(() => {
  const kit = [...document.querySelectorAll('#facets .facet')]
    .find(section => section.querySelector('h3')?.textContent === 'Kit');
  return {
    kitBoxes: kit ? kit.querySelectorAll('input').length : null,
    kitMore: kit?.querySelector('.facet-more')?.textContent || null,
  };
});

// 4. Scrolling builds the rest, a chunk at a time, until all are there.
result.firstScreen = await cards();
const grown = [];
for (let i = 0; i < 200 && (await cards()) < MODELS; i++) {
  await page.evaluate(() => {
    const body = document.getElementById('browser-body');
    body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(30);
  if (i < 3) grown.push(await cards());
}
result.scrolled = { grown, final: await cards() };

// 5. Search filters, and Enter picks the first match by the sort.
await page.fill('#browser-search', 'plane0003');
result.search = await page.evaluate(() => ({
  count: document.getElementById('browser-count').textContent,
  names: [...document.querySelectorAll('#browser-body .card-name')].map(n => n.textContent),
}));
await page.press('#browser-search', 'Enter');
result.pick = await page.evaluate(() => ({
  picked: window.__picked, hidden: document.getElementById('browser').hidden,
}));

// 6. `/` opens again; the lineup and the plot draw.
await page.keyboard.press('/');
await page.fill('#browser-search', '');
await page.click('#layout-switch [data-layout="scale"]');
result.scale = await page.evaluate(() => ({
  rows: document.querySelectorAll('#browser-body .scale-row').length,
  note: document.querySelector('#browser-body .scale-note')?.textContent,
}));
await page.click('#layout-switch [data-layout="plot"]');
result.plot = await page.evaluate(() => document.querySelectorAll('#browser-body .plot-dot').length);
await page.click('#layout-switch [data-layout="grid"]');
await page.click('#browser-body .card >> nth=2');
result.cardPick = await page.evaluate(() => window.__picked.at(-1));

// 7. Phone width: the body is still the scroller, so the feed stops after
// what is within reach instead of running on to the end by itself.
await page.setViewportSize({ width: 390, height: 844 });
await page.keyboard.press('/');
await page.fill('#browser-search', 'a');
await page.fill('#browser-search', '');
await page.waitForTimeout(600);
result.phone = await cards();

console.log(JSON.stringify(result));
await browser.close();
