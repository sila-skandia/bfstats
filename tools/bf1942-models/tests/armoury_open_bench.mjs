// How long "Browse armoury" takes to open, measured headless under a CPU
// throttle (features/mesh-viewer-performance, "Armoury browser open").
//
//   python3 tools/bf1942-models/serve_viewer.py 5393 &
//   node tools/bf1942-models/tests/armoury_open_bench.mjs \
//        --url http://localhost:5393 --mods models,fhsw --throttle 4
//
// For each mod it loads index.html, waits for the page to be ready, then
// clicks #browse-open with a real input event and reports:
//   handler  ms the click's own task ran (Event Timing processing time)
//   dialog   ms from the click to the frame that showed the dialog
//            (Event Timing duration: input to next paint)
//   thumbs   ms from the click until every thumbnail in the first screen
//            of cards has decoded
//   cards    cards in the DOM straight after the click task; total, a
//            moment later
// twice: "cold" is the first open after load, "warm" the second. Then
// "early": the click lands as soon as the button exists, while the page
// is still loading the catalogue.
// Not part of the unit suite (it needs the live catalogues).

import { chromium } from '../../../ui/node_modules/playwright/index.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5393');
const mods = arg('mods', 'models,fhsw').split(',');
const throttle = Number(arg('throttle', '4'));
const runs = Number(arg('runs', '1'));

const browser = await chromium.launch();

async function throttled(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

async function measureOpen(page) {
  await page.evaluate(() => {
    window.__benchEvents = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__benchEvents.push(e);
    }).observe({ type: 'event', durationThreshold: 16 });
    window.__benchClickAt = null;
    window.__benchCards = null;
    const button = document.getElementById('browse-open');
    button.addEventListener('click', event => {
      window.__benchClickAt = event.timeStamp;
    }, { capture: true, once: true });
    // Bubble phase, after the page's own listener.
    button.addEventListener('click', () => {
      window.__benchCards = document.querySelectorAll('#browser-body .card').length;
    }, { once: true });
  });
  await page.click('#browse-open');
  const thumbs = await page.evaluate(() => new Promise(resolve => {
    const start = window.__benchClickAt;
    const tick = () => {
      const view = innerHeight;
      const images = [...document.querySelectorAll('#browser-body .card img')].filter(image => {
        const box = image.getBoundingClientRect();
        return box.height > 0 && box.bottom > 0 && box.top < view;
      });
      if (images.length && images.every(image => image.complete && image.naturalWidth > 0)) {
        resolve({ ms: performance.now() - start, count: images.length });
      } else if (performance.now() - start > 60000) resolve({ ms: null, count: images.length });
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.waitForTimeout(500);
  const timing = await page.evaluate(() => {
    const at = window.__benchClickAt;
    const click = window.__benchEvents.find(e => e.name === 'click' && Math.abs(e.startTime - at) < 5);
    return {
      handler: click ? Math.round(click.processingEnd - click.processingStart) : '<16',
      dialog: click ? Math.round(click.duration) : '<16',
      cards: window.__benchCards,
      total: document.querySelectorAll('#browser-body .card').length,
    };
  });
  return { ...timing, thumbs: thumbs.ms === null ? null : Math.round(thumbs.ms), visible: thumbs.count };
}

for (const mod of mods) {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await throttled(context, page);
    page.on('pageerror', e => console.error(`page error: ${e.message}`));
    const query = mod === 'models' ? '' : `?mod=${mod}`;
    const loadStart = Date.now();
    await page.goto(`${url}/index.html${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('main')?.dataset.loadState === 'ready',
      null, { timeout: 180000 });
    const pageReadyMs = Date.now() - loadStart;
    await page.waitForTimeout(1500);
    const cold = await measureOpen(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const warm = await measureOpen(page);
    const models = await page.evaluate(() => window.__modelInspector?.manifest?.length);
    console.log(JSON.stringify({ mod, throttle, models, pageReadyMs, cold, warm }));
    await context.close();
  }
}

for (const mod of mods) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await throttled(context, page);
  const query = mod === 'models' ? '' : `?mod=${mod}`;
  await page.addInitScript(() => {
    window.__benchEvents = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__benchEvents.push(e);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  await page.goto(`${url}/index.html${query}`, { waitUntil: 'commit' });
  await page.waitForSelector('#browse-open', { state: 'attached' });
  await page.evaluate(() => {
    document.getElementById('browse-open').addEventListener('click', event => {
      window.__benchClickAt = event.timeStamp;
      window.__benchShownInTask = !document.getElementById('browser').hidden;
    }, { once: true });
  });
  await page.click('#browse-open', { force: true });
  const shownInTask = await page.evaluate(() => window.__benchShownInTask);
  const firstCard = await page.waitForFunction(() => document.querySelector('#browser-body .card')
    && performance.now() - window.__benchClickAt, null, { timeout: 180000, polling: 'raf' })
    .then(handle => handle.jsonValue());
  const timing = await page.evaluate(() => {
    const click = window.__benchEvents.find(e => e.name === 'click'
      && Math.abs(e.startTime - window.__benchClickAt) < 5);
    return click ? { inputDelay: Math.round(click.processingStart - click.startTime),
      dialog: Math.round(click.duration) } : { dialog: '<16' };
  });
  console.log(JSON.stringify({ mod, early: { shownInClickTask: shownInTask, ...timing,
    firstCardMs: Math.round(firstCard) } }));
  await context.close();
}
await browser.close();
