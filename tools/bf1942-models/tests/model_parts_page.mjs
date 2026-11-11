// The part inspector in a real page: drives index.html headless on a ship
// and a plane, desktop and phone, and writes a frame of each state
// (features/mesh-viewer-advanced-tab, "Part inspector").
//
//   python3 tools/bf1942-models/serve_viewer.py 5391 &
//   node tools/bf1942-models/tests/model_parts_page.mjs --url http://localhost:5391 --out /tmp/parts
//
// Not part of the unit suite (it needs the models; serve_viewer.py fetches
// them from mesh.bfstats.io). Exits non-zero when a check fails;
// `test_model_parts.py` holds the index, search and timing under node.
//
// The rule every exit is held to: the model afterwards is the model before
// the pick, mesh by mesh: shown or not, its layer, its materials (the same
// objects), their visibility, opacity, blending, depth write and side, and
// every node's position.

import { chromium } from '../../../ui/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5391');
const out = arg('out', 'parts-shots');
const ship = arg('ship', 'Fletcher');
const plane = arg('plane', 'Spitfire');
const big = arg('big', 'Yamato');
await mkdir(out, { recursive: true });

const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const browser = await chromium.launch();

async function open(viewport, model, { mobile = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  page.on('pageerror', e => failures.push(`page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) failures.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(`${url}/index.html#${model}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('main')?.dataset.loadState === 'ready'
    && window.__modelInspector?.getCurrent(), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  return { page, context };
}
const state = page => page.evaluate(() => window.__modelInspector.parts.getState());
const settle = page => page.waitForFunction(() => window.__modelInspector.parts.getState().moving === 0, null, { timeout: 15000 });
const shot = async (page, name, wait = 250) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const zoom = (page, k) => page.evaluate(f => {
  const c = window.__camera; const t = window.__controls.target;
  c.position.sub(t).multiplyScalar(f).add(t); window.__controls.update();
}, k);

/** The model, mesh by mesh and node by node, as the exit rule compares it. */
const snapshot = page => page.evaluate(() => {
  const root = window.__scene.children.find(o => o.userData?.templateKind) || window.__scene;
  const meshes = [];
  const nodes = [];
  window.__scene.traverse(o => {
    if (o.userData?.displayHelper) return;
    if (o.userData?.home) nodes.push(`${o.uuid}:${o.position.toArray().join(',')}`);
    if (!o.isMesh) return;
    let shown = true;
    for (let a = o; a; a = a.parent) if (!a.visible) shown = false;
    meshes.push(`${o.uuid}|${shown}|${o.layers.mask}|${[o.material].flat().map(m =>
      `${m.uuid}:${m.visible}:${m.opacity}:${m.transparent}:${m.depthWrite}:${m.side}:${m.map?.uuid ?? '-'}`).join(',')}`);
  });
  void root;
  return { meshes, nodes };
});
const diff = (a, b) => ({
  meshes: a.meshes.filter((row, i) => row !== b.meshes[i]).length + Math.abs(a.meshes.length - b.meshes.length),
  nodes: a.nodes.filter((row, i) => row !== b.nodes[i]).length,
});
/** Positions may differ only by float32 rounding where a baked clip writes them (a radar, a propeller). */
const nodesClose = (a, b) => a.nodes.every((row, i) => {
  const [, pa] = row.split(':'); const [, pb] = (b.nodes[i] || ':').split(':');
  const x = pa.split(',').map(Number); const y = (pb || '').split(',').map(Number);
  return x.every((v, j) => Math.abs(v - y[j]) < 1e-5);
});

/** A screen point that picks a part deep enough to be a piece (a turret, a gear leg). */
const pickPoint = (page, minDepth = 3, name = null) => page.evaluate(([d, n]) => {
  const r = document.querySelector('main canvas').getBoundingClientRect();
  for (let i = 0; i < 900; i += 1) {
    const x = r.left + r.width * (0.15 + 0.7 * ((i * 37) % 100) / 100);
    const y = r.top + r.height * (0.15 + 0.7 * ((i * 61) % 100) / 100);
    const p = window.__modelInspector.parts.pickAt(x, y);
    if (p && p.depth >= d && (!n || p.name === n)) return { x, y, name: p.name, label: p.label };
  }
  return null;
}, [minDepth, name]);
const emptyPoint = page => page.evaluate(() => {
  const r = document.querySelector('main canvas').getBoundingClientRect();
  for (let i = 0; i < 200; i += 1) {
    const x = r.left + r.width * (0.1 + 0.8 * ((i * 53) % 100) / 100);
    const y = r.top + r.height * (0.2 + 0.6 * ((i * 29) % 100) / 100);
    if (!window.__modelInspector.parts.pickAt(x, y)) return { x, y };
  }
  return null;
});

/** Every exit from a pick puts the model back exactly as it was. */
async function exitPaths(page, label, { phone = false } = {}) {
  const before = await snapshot(page);
  const exits = ['card close', 'Esc', 'empty click', 'Whole model', 'history back'];
  for (const exit of exits) {
    const at = await pickPoint(page);
    if (!at) { expect(false, `${label}: a part to pick for ${exit}`); return; }
    if (phone) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
    await settle(page);
    const picked = await state(page);
    expect(picked.selected.length === 1 && picked.ghosted, `${label}: picked ${picked.selected[0]?.label} for ${exit}`);
    if (exit === 'card close') await page.click('#part-card [data-close]');
    if (exit === 'Esc') await page.keyboard.press('Escape');
    if (exit === 'empty click') {
      const e = await emptyPoint(page);
      if (phone) await page.touchscreen.tap(e.x, e.y); else await page.mouse.click(e.x, e.y);
    }
    if (exit === 'Whole model') await page.click('#part-crumbs [data-crumb="whole"]');
    if (exit === 'history back') await page.click('#part-card [data-nav="back"]');
    await settle(page);
    await page.waitForTimeout(150);
    const after = await snapshot(page);
    const d = diff(before, after);
    const s = await state(page);
    const okHistory = exit === 'history back' ? s.selected.length === 0 || s.historyAt === 0 : true;
    expect(d.meshes === 0 && nodesClose(before, after) && !s.ghosted && !s.selected.length && okHistory,
      `${label}: ${exit} restores every mesh (${d.meshes} changed) and position, nothing ghosted or picked`);
  }
}

/** Pick, switch, back, close: the round trip, with a frame of each. */
async function roundTrip(page, label, { phone = false } = {}) {
  const tap = async p => { if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); };
  const before = await snapshot(page);
  const a = await pickPoint(page);
  await tap(a); await settle(page);
  await shot(page, `${label}-1-pick`);
  // Switch straight to another part on the ghosted model.
  let b = null;
  for (let tries = 0; tries < 5 && !b; tries += 1) {
    const cand = await page.evaluate(([skip]) => {
      const r = document.querySelector('main canvas').getBoundingClientRect();
      for (let i = 0; i < 900; i += 1) {
        const x = r.left + r.width * (0.1 + 0.8 * ((i * 41) % 100) / 100);
        const y = r.top + r.height * (0.1 + 0.8 * ((i * 67) % 100) / 100);
        const p = window.__modelInspector.parts.pickAt(x, y);
        if (p && p.depth >= 3 && p.name !== skip) return { x, y, name: p.name };
      }
      return null;
    }, [a.name]);
    b = cand;
  }
  if (b) {
    await tap(b); await settle(page);
    const s = await state(page);
    expect(s.selected[0]?.name === b.name, `${label}: clicking ${b.name} on the ghosted model switches to it`);
    await shot(page, `${label}-2-switch`);
    await page.locator('#part-card [data-nav="back"]').click();
    await settle(page);
    const s2 = await state(page);
    expect(s2.selected[0]?.name === a.name, `${label}: back returns to ${a.name}`);
    await page.evaluate(() => document.getElementById('inspector-aside').scrollTo(0, 0));
    await shot(page, `${label}-3-back`);
  }
  await page.click('#part-card [data-close]');
  await settle(page);
  await shot(page, `${label}-4-whole-model`);
  const after = await snapshot(page);
  expect(diff(before, after).meshes === 0 && nodesClose(before, after), `${label}: after the round trip the whole model is back exactly`);
}

/** Take apart: held, a part made the context, two levels down, a crumb up, Whole model. */
async function takeApart(page, label) {
  const before = await snapshot(page);
  await page.click('.stage-builder-btn');
  await page.waitForTimeout(2600);
  let s = await state(page);
  expect(s.apart && !s.context, `${label}: Take apart spreads the whole model and holds (apart after 2.6 s)`);
  await shot(page, `${label}-apart-1-whole`);
  // The two levels: a part that holds pieces, then a piece of it that holds pieces.
  const levels = await page.evaluate(() => {
    const parts = window.__modelInspector.parts.index.parts;
    const sub = p => { const o = []; (function w(q) { o.push(q); q.children.forEach(w); })(p); return o; };
    const takeable = p => p.shown && p.meshes.length && sub(p).some(q => q !== p && q.meshes.length && q.shown);
    // The root-most part that holds a piece which itself holds pieces: a
    // ship's hull and a turret, a plane's fuselage and a gear leg.
    const tops = parts.filter(takeable);
    for (const one of tops) {
      const two = sub(one).find(q => q !== one && takeable(q));
      if (two) return [one.name, two.name];
    }
    return [tops[0]?.name, null];
  });
  if (!levels[0]) { expect(false, `${label}: a part to take apart`); return; }
  await page.evaluate(n => window.__modelInspector.parts.selectNamed(n), levels[0]);
  await settle(page);
  await page.evaluate(() => window.__modelInspector.parts.takeApart());
  await page.waitForTimeout(1600);
  s = await state(page);
  expect(s.context?.name === levels[0] && s.hidden > 0, `${label}: ${levels[0]} taken apart alone (${s.hidden} meshes hidden)`);
  await shot(page, `${label}-apart-2-${levels[0].toLowerCase()}`);
  if (levels[1]) {
    await page.evaluate(n => window.__modelInspector.parts.selectNamed(n), levels[1]);
    await settle(page);
    await page.evaluate(() => window.__modelInspector.parts.takeApart());
    await page.waitForTimeout(1600);
    s = await state(page);
    expect(s.context?.name === levels[1], `${label}: two levels down in ${levels[1]}`);
    await shot(page, `${label}-apart-3-${levels[1].toLowerCase()}`);
    // The crumb back up a level, still apart.
    await page.click(`#part-crumbs .pcr-step`, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1600);
    s = await state(page);
    expect(s.apart && s.context?.name !== levels[1], `${label}: a crumb goes back up, still apart (${s.context?.name ?? 'whole'})`);
    await shot(page, `${label}-apart-4-crumb-up`);
  }
  await page.click('#part-crumbs [data-crumb="whole"]');
  await settle(page);
  await page.waitForTimeout(200);
  s = await state(page);
  const after = await snapshot(page);
  expect(!s.apart && !s.context && s.hidden === 0 && diff(before, after).meshes === 0 && nodesClose(before, after),
    `${label}: Whole model puts it all back exactly`);
  await shot(page, `${label}-apart-5-whole-model`);
}

// --- Desktop: the ship --------------------------------------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, ship);
  await zoom(page, 0.5);
  await page.waitForTimeout(200);
  let s = await state(page);
  expect(s.parts > 10 && s.meshes > 10, `${ship}: ${s.parts} parts indexed, ${s.meshes} meshes mapped`);

  const at = await pickPoint(page, 3, 'Fletcher_cannon_Front') || await pickPoint(page);
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(150);
  s = await state(page);
  expect(Boolean(s.hovered) && s.tagShown, `hover names ${s.hovered?.label}`);
  await shot(page, 'desktop-fletcher-hover');
  await page.mouse.move(5, 5);

  // Each kind of part is the brightest thing on screen once picked.
  const kinds = await page.evaluate(() => {
    const parts = window.__modelInspector.parts.index.parts;
    const collisionOnly = parts.find(p => p.shown && !p.meshes.length && p.collisionMeshes.length);
    return ['Fletcher_cannon_Front', 'Fletcher_Radar', 'FletcherComplex', collisionOnly?.name]
      .filter(Boolean).filter(n => parts.some(p => p.name === n));
  });
  for (const name of kinds) {
    await page.evaluate(n => window.__modelInspector.parts.selectNamed(n), name);
    await settle(page);
    const focus = await page.evaluate(() => {
      const sel = window.__modelInspector.parts.getState().selected[0];
      const part = window.__modelInspector.parts.index.parts[sel.id];
      let proxies = 0;
      part.node.traverse(o => { if (o.userData.displayHelper === 'proxy' && o.layers.mask === 4) proxies += 1; });
      return {
        onFocus: part.meshes.every(m => m.layers.mask === 4),
        lit: part.meshes.every(m => [m.material].flat().every(x => x.visible && x.opacity > 0.5)),
        rims: part.meshes.filter(m => m.userData.partRim?.visible).length,
        meshes: part.meshes.length, proxies, collisionOnly: !part.meshes.length,
      };
    });
    expect(focus.collisionOnly ? focus.proxies > 0 : (focus.onFocus && focus.lit && focus.rims > 0),
      `${name}: drawn last, solid, outlined (${JSON.stringify(focus)})`);
    await shot(page, `desktop-fletcher-selected-${name.toLowerCase()}`);
    await page.click('#part-card [data-frame]');
    await shot(page, `desktop-fletcher-framed-${name.toLowerCase()}`);
    await page.click('#part-card [data-close]');
    await settle(page);
    await page.evaluate(() => window.__modelInspector.setView(0));
    await zoom(page, 0.5);
  }

  await exitPaths(page, 'desktop fletcher');
  await roundTrip(page, 'desktop-fletcher');

  // The tree and search.
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
    expect(/continuous yaw 30 deg\/s/i.test(await page.textContent('#part-card')), 'the radar card says it spins');
    await page.click('#part-card [data-close]');
    await settle(page);
  }
  const groups = await page.evaluate(() => window.__modelInspector.parts.search('57').map(g => ({ kind: g.kind, n: g.parts.length })));
  expect(groups[0]?.kind === 'armour' && groups[0].n > 0, `search 57 finds armour material 57 first (${JSON.stringify(groups)})`);
  await page.click('#part-results .ps-group[data-kind="armour"] .ps-head');
  await settle(page);
  s = await state(page);
  expect(s.selected.length > 1, `the armour group pops ${s.selected.length} parts`);
  await shot(page, 'desktop-fletcher-search-armour-57');
  await page.click('#part-card [data-close]');
  await page.evaluate(() => window.__modelInspector.parts.search(''));
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
    expect(!(await state(page)).selected.length, 'the chip again puts them back');
  }
  await page.click('#regions-seg [data-mode="off"]');
  await page.evaluate(() => window.__modelInspector.setView(0));
  await zoom(page, 0.6);

  await takeApart(page, 'desktop-fletcher');
  await context.close();
}

// --- Desktop: the plane ---------------------------------------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, plane);
  await exitPaths(page, `desktop ${plane.toLowerCase()}`);
  await roundTrip(page, `desktop-${plane.toLowerCase()}`);
  await takeApart(page, `desktop-${plane.toLowerCase()}`);
  await context.close();
}

// --- Hover picking on a big ship stays inside a frame ---------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, big);
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

// --- No shot-placement regression ------------------------------------------------
{
  const { page, context } = await open({ width: 1280, height: 820 }, 'Sherman');
  await page.click('#regions-seg [data-mode="overlay"]');
  expect(Boolean(await page.evaluate(() => window.__modelInspector.pickCenterHit())), 'the shot hook still places a shot');
  const click = () => page.evaluate(() => {
    const canvas = document.querySelector('main canvas');
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
    }
    return { shot: window.__modelInspector.getCollision().hit !== null, parts: window.__modelInspector.parts.getState().selected.length };
  });
  const placed = await click();
  expect(placed.shot && placed.parts === 0, 'a click in Places a shot places a shot, and picks no part');
  await page.click('#pick-seg [data-pick="parts"]');
  expect((await click()).parts === 1, 'with Picks a part, the same click selects a part');
  await shot(page, 'desktop-sherman-pick-part');
  await context.close();
}

// --- Phone: the stage keeps its share of the screen -------------------------------
for (const [w, h] of [[390, 844], [375, 667]]) {
  for (const model of [ship, plane, big]) {
    if (model === big && w === 390) continue;
    const label = `phone-${model.toLowerCase()}-${w}x${h}`;
    const { page, context } = await open({ width: w, height: h }, model, { mobile: true });
    const share = () => page.evaluate(() => document.querySelector('main').getBoundingClientRect().height / innerHeight);
    const first = await share();
    expect(first >= 0.38, `${label}: the stage is ${(first * 100).toFixed(0)}% of the screen before a pick`);
    const at = await pickPoint(page) || await pickPoint(page, 1);
    expect(Boolean(at), `${label}: something to tap`);
    if (at) {
      await page.touchscreen.tap(at.x, at.y);
      await settle(page);
      const s = await state(page);
      const picked = await share();
      expect(s.selected.length === 1 && s.tagShown, `${label}: tap selects ${s.selected[0]?.label} and shows the tag`);
      expect(picked >= 0.4, `${label}: with a part picked the stage is ${(picked * 100).toFixed(0)}% of the screen`);
      expect(await page.evaluate(() => document.getElementById('crew').dataset.collapsed !== 'false'), `${label}: the crew stations are collapsed`);
      expect(await page.isVisible('#part-crumbs [data-crumb="whole"]'), `${label}: Whole model is on the stage`);
      await shot(page, `${label}-tap`);
      await page.locator('#part-card').scrollIntoViewIfNeeded();
      expect(await page.isVisible('#part-card [data-nav="back"]'), `${label}: the card and its arrows are reachable below`);
      await shot(page, `${label}-card`);
      expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${label}: no sideways scroll`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('#part-crumbs [data-crumb="whole"]');
      await settle(page);
    }
    if (w === 390 && model !== big) {
      await exitPaths(page, label, { phone: true });
      await roundTrip(page, label, { phone: true });
      await takeApart(page, label);
    }
    await context.close();
  }
}

await browser.close();
if (failures.length) {
  console.error(failures.map(f => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log(`ok, frames in ${out}`);
