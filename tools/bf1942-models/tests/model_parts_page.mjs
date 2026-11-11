// The part inspector in a real page: drives index.html headless on the
// Fletcher (and a tank for shot placement) and writes a frame of each state,
// desktop and phone (features/mesh-viewer-advanced-tab, "Part inspector").
//
//   python3 tools/bf1942-models/serve_viewer.py 5391 &
//   node tools/bf1942-models/tests/model_parts_page.mjs --url http://localhost:5391 --out /tmp/parts
//
// Not part of the unit suite (it needs the models; serve_viewer.py fetches
// them from mesh.bfstats.io). Exits non-zero when a check fails;
// `test_model_parts.py` holds the index, search and timing under node.

import { chromium } from '../../../ui/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5391');
const out = arg('out', 'parts-shots');
const ship = arg('ship', 'Fletcher');
await mkdir(out, { recursive: true });

const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const browser = await chromium.launch();

async function open(viewport, model, { mobile = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  page.on('pageerror', e => failures.push(`page error: ${e.message}`));
  await page.goto(`${url}/index.html#${model}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('main')?.dataset.loadState === 'ready'
    && window.__modelInspector?.getCurrent(), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  return { page, context };
}
/** Bring the camera in: the page frames a 115 m ship whole. */
const zoom = (page, k) => page.evaluate(f => {
  const c = window.__camera; const t = window.__controls.target;
  c.position.sub(t).multiplyScalar(f).add(t); window.__controls.update();
}, k);
const state = page => page.evaluate(() => window.__modelInspector.parts.getState());
const shot = async (page, name, wait = 250) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const settle = page => page.waitForFunction(() => window.__modelInspector.parts.getState().moving === 0, null, { timeout: 10000 });

/** Every template node's position, to the last bit. */
const positions = page => page.evaluate(() => {
  const out = {};
  window.__modelInspector.parts.index.parts.forEach(p => { out[p.id] = p.node.position.toArray(); });
  return out;
});

/** Screen point of a part's centre (its own meshes). */
const screenOf = (page, name) => page.evaluate(n => {
  const THREE_ = window.__scene.constructor;   // not used; keep the page's THREE out of the harness
  const part = window.__modelInspector.parts.index.parts.find(p => p.name === n && p.meshes.length);
  if (!part) return null;
  const boxes = part.meshes.map(m => { m.geometry.computeBoundingBox(); return m; });
  let best = null;
  // Try points across the part's box and keep one the picker says is this part.
  const rect = document.querySelector('main canvas').getBoundingClientRect();
  const cam = window.__camera;
  for (const mesh of boxes) {
    const b = mesh.geometry.boundingBox;
    for (let i = 0; i < 27 && !best; i += 1) {
      const f = [(i % 3) / 2, (Math.floor(i / 3) % 3) / 2, Math.floor(i / 9) / 2];
      const v = b.min.clone().lerp(b.max, 0.5);
      v.set(b.min.x + (b.max.x - b.min.x) * (0.25 + f[0] * 0.5), b.min.y + (b.max.y - b.min.y) * (0.25 + f[1] * 0.5),
        b.min.z + (b.max.z - b.min.z) * (0.25 + f[2] * 0.5));
      v.applyMatrix4(mesh.matrixWorld).project(cam);
      const x = rect.left + (v.x + 1) / 2 * rect.width;
      const y = rect.top + (1 - v.y) / 2 * rect.height;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const hit = window.__modelInspector.parts.pickAt(x, y);
      if (hit && hit.name === n) best = { x, y };
    }
  }
  void THREE_;
  return best;
}, name);

// --- Desktop: the ship -------------------------------------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, ship);
  await zoom(page, 0.5);
  await page.waitForTimeout(200);
  let s = await state(page);
  expect(s.parts > 10 && s.meshes > 10, `${ship}: ${s.parts} parts indexed, ${s.meshes} meshes mapped`);

  // Hover: the tag names the template.
  const at = await screenOf(page, 'Fletcher_cannon_Front') || await screenOf(page, 'Fletcher_Radar');
  expect(Boolean(at), 'found a turret on screen');
  if (at) {
    await page.mouse.move(at.x - 3, at.y - 3);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(150);
    s = await state(page);
    expect(Boolean(s.hovered) && s.tagShown, `hover names ${s.hovered?.name}`);
    await shot(page, 'desktop-fletcher-hover');

    // Select by click: popped out, the rest ghosted, the card open.
    const before = await positions(page);
    await page.mouse.click(at.x, at.y);
    await settle(page);
    s = await state(page);
    expect(s.selected.length === 1 && s.ghosted && s.cardShown, `click selects ${s.selected[0]?.name}, ghosts the rest, opens the card`);
    expect(await page.evaluate(() => window.__modelInspector.getTab()) === 'model', 'the Model tab opens on a pick');
    await shot(page, 'desktop-fletcher-selected');
    await page.click('#part-card [data-frame]');
    await shot(page, 'desktop-fletcher-selected-framed');
    await page.evaluate(() => window.__modelInspector.setView(0));
    await zoom(page, 0.5);
    const moved = await page.evaluate(() => {
      const p = window.__modelInspector.parts.getState().selected[0];
      const part = window.__modelInspector.parts.index.parts[p.id];
      return part.node.userData.popT;
    });
    expect(moved === 1, `the part is fully out (popT ${moved})`);

    // Esc puts it back, exactly.
    await page.keyboard.press('Escape');
    await settle(page);
    await page.waitForTimeout(100);
    s = await state(page);
    const after = await positions(page);
    const drift = Object.keys(before).filter(id => before[id].some((v, i) => Math.abs(v - after[id][i]) > 1e-6));
    expect(!s.selected.length && !s.ghosted, 'Esc deselects and lifts the ghost');
    // The popped part is back on its authored position to the last bit.
    const exact = await page.evaluate(() => window.__modelInspector.parts.index.parts
      .filter(p => p.node.userData.home && p.name.startsWith('Fletcher_cannon'))
      .every(p => p.node.position.equals(p.node.userData.home) && p.node.userData.popOffset === undefined));
    expect(exact, 'the turrets sit exactly on their authored positions, no pop left');
    expect(drift.length === 0, `every part back exactly (${drift.length} moved${drift.length ? `: ${drift.map(id => `${id} ${before[id]} -> ${after[id]}`).join('; ')}` : ''})`);
  }

  // The tree: a row selects; selecting on the model highlights the row.
  await page.evaluate(() => window.__modelInspector.selectTab('model'));
  const row = page.locator('#tree .pt-name', { hasText: /^Fletcher_Radar$/ }).first();
  if (await row.count()) {
    await row.hover();
    s = await state(page);
    expect(s.hovered?.name === 'Fletcher_Radar', 'hovering a tree row highlights the part');
    await row.click();
    await settle(page);
    s = await state(page);
    expect(s.selected[0]?.name === 'Fletcher_Radar', 'clicking a tree row selects the part');
    expect(await page.locator('#tree .pt-row.is-selected').count() === 1, 'the row is marked');
    const card = await page.textContent('#part-card');
    expect(/continuous yaw 30 deg\/s/i.test(card), 'the radar card says it spins');
    await shot(page, 'desktop-fletcher-tree-radar');
    await page.keyboard.press('Escape');
    await settle(page);
  }

  // Search an armour material ID.
  const groups = await page.evaluate(() => window.__modelInspector.parts.search('57').map(g => ({ kind: g.kind, title: g.title, n: g.parts.length })));
  expect(groups.some(g => g.kind === 'armour' && g.n > 0), `search 57 finds armour material 57 (${JSON.stringify(groups.slice(0, 3))})`);
  expect(groups.every((g, i, all) => i === 0 || ['armour', 'render', 'template', 'mesh', 'texture'].indexOf(all[i - 1].kind) <= ['armour', 'render', 'template', 'mesh', 'texture'].indexOf(g.kind)), 'groups come armour first');
  await page.click('#part-results .ps-group[data-kind="armour"] .ps-head');
  await settle(page);
  s = await state(page);
  expect(s.selected.length > 1, `the armour group pops ${s.selected.length} parts`);
  await shot(page, 'desktop-fletcher-search-armour-57');
  for (const q of ['Fletch_canon_m1', 'Fle_base', 'Radar', '7']) {
    const kinds = await page.evaluate(x => window.__modelInspector.parts.search(x).map(g => g.kind), q);
    expect(kinds.length > 0, `search "${q}" finds ${[...new Set(kinds)].join(', ')}`);
  }
  await page.evaluate(() => window.__modelInspector.parts.search(''));
  await page.keyboard.press('Escape');
  await settle(page);

  // A material chip lists its parts and pops them out.
  await page.evaluate(() => window.__modelInspector.selectTab('regions'));
  await page.click('#regions-seg [data-mode="overlay"]');
  const chip = page.locator('#legend-materials .material-chip[data-material="57"]');
  if (await chip.count()) {
    await chip.click();
    await settle(page);
    s = await state(page);
    expect(s.selected.length > 0 && await page.isVisible('#legend-parts'), `chip 57 lists and pops ${s.selected.length} parts`);
    await page.locator('#legend-parts').scrollIntoViewIfNeeded();
    await shot(page, 'desktop-fletcher-chip-57');
    await chip.click();
    await settle(page);
    s = await state(page);
    expect(!s.selected.length, 'the chip again puts them back');
  }
  await page.click('#regions-seg [data-mode="off"]');

  // The builder view mid-flight.
  const before = await positions(page);
  await page.click('.stage-builder-btn');
  await page.waitForTimeout(900);
  s = await state(page);
  expect(s.builder, 'builder view runs');
  await shot(page, 'desktop-fletcher-builder', 0);
  await page.waitForFunction(() => !window.__modelInspector.parts.getState().builder, null, { timeout: 20000 });
  const after = await positions(page);
  const drift = Object.keys(before).filter(id => before[id].some((v, i) => Math.abs(v - after[id][i]) > 1e-6));
  expect(drift.length === 0, `the builder view reassembles exactly (${drift.length} moved)`);
  await context.close();
}

// --- Hover picking on a big ship stays inside a frame -----------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, arg('big', 'Yamato'));
  const timing = await page.evaluate(() => {
    const rect = document.querySelector('main canvas').getBoundingClientRect();
    const t0 = performance.now(); let hits = 0; const n = 200;
    for (let i = 0; i < n; i += 1) {
      const x = rect.left + rect.width * (0.3 + 0.4 * ((i * 37) % 100) / 100);
      const y = rect.top + rect.height * (0.35 + 0.3 * ((i * 61) % 100) / 100);
      if (window.__modelInspector.parts.pickAt(x, y)) hits += 1;
    }
    return { ms: (performance.now() - t0) / n, hits, meshes: window.__modelInspector.parts.getState().meshes };
  });
  expect(timing.ms < 4, `big ship: ${timing.ms.toFixed(2)} ms a pick over ${timing.meshes} meshes (${timing.hits}/200 hit)`);
  await context.close();
}

// --- No shot-placement regression: a tank in Places a shot mode -------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, 'Sherman');
  await page.click('#regions-seg [data-mode="overlay"]');
  const hit = await page.evaluate(() => window.__modelInspector.pickCenterHit());
  expect(Boolean(hit), 'the shot hook still places a shot');
  // A real click on a region, as a user does.
  const clicked = await page.evaluate(async () => {
    const rect = document.querySelector('main canvas').getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const fire = (type) => document.querySelector('main canvas').dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
    fire('pointerdown'); fire('pointerup');
    return { collision: window.__modelInspector.getCollision().hit !== null, parts: window.__modelInspector.parts.getState().selected.length };
  });
  expect(clicked.collision && clicked.parts === 0, 'a click in Places a shot places a shot, and picks no part');
  await page.click('#pick-seg [data-pick="parts"]');
  const picked = await page.evaluate(async () => {
    const rect = document.querySelector('main canvas').getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const fire = (type) => document.querySelector('main canvas').dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
    fire('pointerdown'); fire('pointerup');
    return window.__modelInspector.parts.getState().selected.length;
  });
  expect(picked === 1, 'with Picks a part, the same click selects a part');
  await shot(page, 'desktop-sherman-pick-part');
  await context.close();
}

// --- Phone -----------------------------------------------------------------
{
  const { page, context } = await open({ width: 390, height: 844 }, ship, { mobile: true });
  const at = await screenOf(page, 'Fletcher_cannon_Front') || await screenOf(page, 'FletcherComplex');
  if (at) {
    await page.touchscreen.tap(at.x, at.y);
    await settle(page);
    const s = await state(page);
    expect(s.selected.length === 1 && s.tagShown, `tap selects ${s.selected[0]?.name} and shows the tag`);
    await shot(page, 'phone-fletcher-tap');
    await page.locator('#part-card').scrollIntoViewIfNeeded();
    await shot(page, 'phone-fletcher-card');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(!overflow, 'no sideways scroll at 390 px');
    await page.keyboard.press('Escape');
    await settle(page);
  }
  await page.locator('#tree').scrollIntoViewIfNeeded();
  await shot(page, 'phone-fletcher-tree');
  await page.click('.stage-builder-btn');
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'phone-fletcher-builder', 0);
  expect((await state(page)).builder, 'builder view runs on a phone');
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(failures.map(f => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log(`ok, frames in ${out}`);
