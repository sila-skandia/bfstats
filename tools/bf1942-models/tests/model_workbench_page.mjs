// The model inspector's tabs in a real page: drives index.html headless and
// writes screenshots of every Display and Hit regions state, desktop and
// phone width (features/mesh-viewer-advanced-tab, "Checked").
//
//   python3 tools/bf1942-models/serve_viewer.py 5391 &
//   node tools/bf1942-models/tests/model_workbench_page.mjs \
//        --url http://localhost:5391 --out /tmp/workbench
//
// Not part of the unit suite: it needs the models (serve_viewer.py fetches
// what the local tree lacks from mesh.bfstats.io). It exits non-zero when a
// control does not do what it says; `test_model_workbench.py` holds the
// numbers behind each control without a browser.

import { chromium } from '../../../ui/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5391');
const out = arg('out', 'workbench-shots');
await mkdir(out, { recursive: true });

const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); };

const browser = await chromium.launch();

async function open(viewport, model, { mobile = false } = {}) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', e => failures.push(`page error: ${e.message}`));
  await page.goto(`${url}/index.html#${model}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('main')?.dataset.loadState === 'ready'
    && window.__modelInspector?.getCurrent(), null, { timeout: 90000 });
  await page.waitForTimeout(400);
  return { page, context };
}

async function load(page, model) {
  await page.evaluate(name => {
    const entry = window.__modelInspector.manifest.find(e => e.name === name);
    return window.__modelInspector.showVariant(entry.index);
  }, model);
  await page.waitForTimeout(400);
}

// The page frames the whole model with room to orbit; the shots come in
// closer so the paint, the edges and the regions can be judged.
const zoom = (page, factor) => page.evaluate(k => {
  const camera = window.__camera; const target = window.__controls.target;
  camera.position.sub(target).multiplyScalar(k).add(target);
  window.__controls.update();
}, factor);

const shot = async (page, name) => {
  await zoom(page, 0.62);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  await zoom(page, 1 / 0.62);
};
const display = page => page.evaluate(() => window.__modelInspector.getDisplay());
const collision = page => page.evaluate(() => {
  const c = window.__modelInspector.getCollision();
  return { mode: c.mode, enabled: c.enabled, visibleTargets: c.visibleTargets, opacity: c.opacity, hit: Boolean(c.hit) };
});

// --- Desktop -----------------------------------------------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, 'Sherman');
  // Nothing behind ?dev=1 any more: the tabs are on screen for everyone.
  expect(await page.isVisible('#wb-tabs'), 'tab strip visible without ?dev=1');
  expect(await page.getAttribute('#wb-tab-regions', 'aria-selected') === 'true', 'Hit regions is the default tab');
  await shot(page, 'desktop-sherman-default');

  await page.click('#wb-tab-display');
  expect(await page.isVisible('#textures-seg'), 'Display tab shows the textures choice');
  await shot(page, 'desktop-sherman-display-tab');

  await page.click('#textures-seg [data-value="off"]');
  let d = await display(page);
  expect(!d.textures && d.untextured === d.meshes || d.untextured > 0, 'Textures off clears the maps');
  await shot(page, 'desktop-sherman-textures-off');
  await page.click('#textures-seg [data-value="on"]');

  await page.check('#wireframe');
  d = await display(page);
  expect(d.wireframe && d.wires > 0, 'wireframe draws an edges overlay');
  await shot(page, 'desktop-sherman-wireframe');

  // The texture opacity slider at 40%, the wireframe still on.
  await page.locator('#texture-opacity').fill('0.4');
  d = await display(page);
  expect(Math.abs(d.opacity - 0.4) < 1e-6, `opacity slider sets 0.4 (got ${d.opacity})`);
  expect(d.faded > 0, 'a faded surface is blended');
  expect(d.prepasses > 0, 'a faded surface keeps a depth copy for its nearest face');
  expect(await page.textContent('#texture-opacity-output') === '40%', 'slider readout says 40%');
  await shot(page, 'desktop-sherman-opacity40-wireframe');

  await page.check('#see-through');
  d = await display(page);
  expect(d.prepasses === 0, 'back faces drops the depth copy');
  await shot(page, 'desktop-sherman-opacity40-wireframe-backfaces');

  await page.click('#display-reset');
  d = await display(page);
  expect(d.opacity === 1 && !d.wireframe && !d.seeThrough && d.faded === 0 && d.wires === 0,
    'Reset puts the display back');

  // The hit regions over the textured model.
  await page.click('#wb-tab-regions');
  await page.click('#regions-seg [data-mode="overlay"]');
  let c = await collision(page);
  expect(c.mode === 'overlay' && c.enabled && c.visibleTargets > 0, 'Over model shows the hulls');
  d = await display(page);
  expect(d.hidden === 0, 'Over model keeps the model drawn');
  await page.evaluate(() => window.__modelInspector.pickCenterHit());
  c = await collision(page);
  expect(c.hit, 'a shot can be placed with the overlay on');
  await shot(page, 'desktop-sherman-regions-overlay');

  // A weapon's colouring with the overlay.
  const weapon = await page.evaluate(() => window.__modelInspector.getWeapons()
    .find(name => /bazooka|panzerschreck|shell/i.test(name)) || window.__modelInspector.getWeapons()[0]);
  if (weapon) {
    await page.evaluate(name => window.__modelInspector.setWeapon(name), weapon);
    await page.evaluate(() => window.__modelInspector.pickCenterHit());
    await shot(page, 'desktop-sherman-regions-overlay-weapon');
  }

  await page.click('#regions-seg [data-mode="only"]');
  d = await display(page);
  expect(d.hidden > 0, 'Regions only hides the model');
  await shot(page, 'desktop-sherman-regions-only');
  await page.click('#regions-seg [data-mode="off"]');
  d = await display(page);
  expect(d.hidden === 0, 'Off brings the model back');

  // Overlay with a faded hull: both controls at once.
  await page.click('#regions-seg [data-mode="overlay"]');
  await page.evaluate(() => window.__modelInspector.setDisplay({ opacity: 0.4, wireframe: true }));
  await shot(page, 'desktop-sherman-regions-overlay-opacity40');
  await page.evaluate(() => window.__modelInspector.setDisplay({ opacity: 1, wireframe: false }));

  for (const model of ['Tiger', 'Spitfire', 'BF109']) {
    await load(page, model);
    await page.click('#regions-seg [data-mode="overlay"]');
    c = await collision(page);
    expect(c.visibleTargets > 0, `${model}: overlay shows its hulls`);
    await shot(page, `desktop-${model.toLowerCase()}-regions-overlay`);
  }
  await page.evaluate(() => window.__modelInspector.setDisplay({ opacity: 0.4, wireframe: true }));
  await page.click('#regions-seg [data-mode="off"]');
  await shot(page, 'desktop-bf109-opacity40-wireframe');

  await page.click('#wb-tab-model');
  expect((await page.textContent('#stats')).includes('triangles'), 'Model tab lists the stats');
  expect((await page.textContent('#tree')).length > 0, 'Model tab has the part tree');
  await shot(page, 'desktop-bf109-model-tab');
  await context.close();
}

// --- Phone -------------------------------------------------------------------
{
  const { page, context } = await open({ width: 390, height: 844 }, 'Sherman', { mobile: true });
  await shot(page, 'phone-sherman-default');
  await page.click('#wb-tab-display');
  await page.locator('#texture-opacity').fill('0.4');
  await page.check('#wireframe');
  await shot(page, 'phone-sherman-opacity40-wireframe');
  await page.click('#wb-tab-regions');
  await page.click('#regions-seg [data-mode="overlay"]');
  await page.evaluate(() => window.__modelInspector.setDisplay({ opacity: 1, wireframe: false }));
  await shot(page, 'phone-sherman-regions-overlay');
  // The tabs stay reachable with the column scrolled.
  await page.evaluate(() => { document.getElementById('inspector-aside').scrollTop = 400; });
  const strip = await page.locator('#wb-tabs').boundingBox();
  const aside = await page.locator('#inspector-aside').boundingBox();
  expect(strip && aside && strip.y <= aside.y + 2 && strip.y >= aside.y - 2, 'tab strip sticks to the top of the column on a phone');
  await shot(page, 'phone-sherman-regions-scrolled');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(!overflow, 'no sideways page scroll at phone width');
  await page.click('#controls-collapse-btn');
  expect(await page.isVisible('#stage-controls-fab'), 'Hide shows the Controls button');
  await shot(page, 'phone-sherman-collapsed');
  await page.click('#stage-controls-fab');
  expect(await page.isVisible('#wb-tabs'), 'Controls brings the tabs back');
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(failures.map(f => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log(`ok, screenshots in ${out}`);
