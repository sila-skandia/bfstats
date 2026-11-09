// The tank school's own page (`tanks.html`, features/battle-schools, "The
// tank school's own page"), built the way the dogfight school's is
// (`dogfight-school-page.js`): no level loaded, the arenas from the mod's
// model catalogue, and the tanks' own models.
//
// Its first screen is MATCHUP (tank-matchup.md section 1). Pick YOUR TANK and
// THEIR TANK, and four panels say what to do in that pairing:
//
//   01 where to aim and where you are exposed: each hull's collision faces
//      painted by the shots the other's gun needs there (`tank-armour.js`),
//      side by side at one bearing, and a clock of shots to kill all round;
//   02 the guns: both shells' arcs to one target (`tank-ballistics.js`), and
//      reload, traverse, hold-over and reach;
//   03 the drive, and 04 how steady each hull is, from the tank sheet the
//      `surveys/tank_school_sheet.mjs` survey writes (`tank-school/<mod>.json`).
//
// Each panel opens with plain words for the pairing (`tank-words.js`), never
// a verdict on who wins.
//
// `?arena=<battle>`, `?yours=<template>`, `?theirs=<template>`, `?mod=<id>`;
// otherwise this browser's last. Esc goes back to the front end's Range tab.

import * as THREE from 'three';
import { loadPlaneModel as loadVehicleModel } from './plane-models.js';
import { VIEWER_ROOT } from './viewer-root.js';
import { loadMods, stored as storedMod, remember, trees, treeOf, VANILLA } from './mods.js';
import { arenasFrom, tankIn, enemyOf, prettyTank, mainGunName } from './tank-arena.js';
import { gunOf, reach, degreesPer100, dropAt, timeTo, elevationFor, arc } from './tank-ballistics.js';
import { BANDS, IMMUNE, bandOf, faceName, pricer, collisionFaces, bearingShots, faceTable, angleModOf } from './tank-armour.js';
import { matchupWords } from './tank-words.js';
import { angleFactor } from './crash-damage.js';
import { shotsFor } from './armour-damage.js';

const params = new URLSearchParams(location.search);
const KEY = 'tank-school';
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n1 = v => (v == null || !Number.isFinite(v) ? '-' : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const RANGE_HOME = new URL('play/index.html?tab=proving', VIEWER_ROOT).href;
const LOGO = new URL('bfstats-logo.webp', VIEWER_ROOT).href;

const wait = document.querySelector('.dsp-wait');
const say = text => { wait.querySelector('span').textContent = text; };

async function json(rel) {
  const res = await fetch(new URL(rel, VIEWER_ROOT));
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}

// --- the mod and its arenas ---------------------------------------------------

const allMods = await loadMods();
const offered = trees(allMods).filter(m => m.id === VANILLA.id || (Number(m.counts?.models) > 0 && Number(m.counts?.maps) > 0));
const wantMod = String(params.get('mod') || storedMod() || VANILLA.id).toLowerCase();
const mod = offered.find(m => m.id === wantMod) ?? offered.find(m => m.id === VANILLA.id) ?? VANILLA;
const vanillaMod = offered.find(m => m.id === VANILLA.id) ?? VANILLA;

async function arenasOf(m) {
  const [rows, levels] = await Promise.all([json(`${m.paths.models}/models.json`), json(`${m.paths.maps}/maps.json`).catch(() => null)]);
  return arenasFrom(rows, levels ? levels.map(l => l.name) : null);
}
say(`Reading ${mod.short || mod.name}'s battles`);
let arenaMod = mod;
let arenas = await arenasOf(mod).catch(e => { console.warn(`tank school: ${mod.id} arenas`, e); return []; });
if (!arenas.length && mod.id !== VANILLA.id) {
  arenas = await arenasOf(vanillaMod).catch(() => []);
  arenaMod = vanillaMod;
}
if (!arenas.length) {
  say('No arena: no battle here has tanks on both sides');
  throw new Error('tank school: no arenas');
}
const modId = m => (m.id === VANILLA.id ? null : m.id);
const ARENA_KEY = arenaMod.id === VANILLA.id ? `${KEY}:arena` : `${KEY}:arena:${arenaMod.id}`;
let arena = arenas.find(a => a.map.toLowerCase() === String(params.get('arena') ?? stored(ARENA_KEY) ?? '').toLowerCase()) ?? arenas[0];
let yoursChoice = params.get('yours') ?? stored(`${KEY}:yours`);
let theirsChoice = params.get('theirs') ?? stored(`${KEY}:theirs`);
/** Any tank of the arena may be yours or theirs; the defaults are its first
 *  Allied tank, and the other side's heaviest. */
const yours = () => tankIn(arena, yoursChoice);
const theirs = () => {
  const mine = yours();
  const pick = arena.tanks.find(t => t.template === theirsChoice);
  return pick ?? enemyOf(arena, mine);
};

const [tables, sheet] = await Promise.all([
  json(`${arenaMod.paths.maps}/_shared/damage.json`).catch(() => json(`${arenaMod.paths.models}/damage.json`)).catch(() => null),
  json(`tank-school/${treeOf(arenaMod)}.json`).catch(() => null),
]);

// --- a tank, read off its model -------------------------------------------------

/** A tank's numbers from its glb: hit points, the main gun, the turret. */
function readTank(template, scene, row) {
  let gun = null, critical = null, hp = Number(row?.hitpoints) || null;
  const wanted = mainGunName(row);
  scene.traverse(o => {
    const d = o.userData ?? {};
    if (d.armor && typeof d.armor === 'object') {
      hp = Number(d.armor.hitpoints) || hp;
      critical = Number(d.armor.criticalDamage) || critical;
    }
    if (d.templateKind !== 'FireArms' || d.fireArms?.projectile?.kind !== 'shell') return;
    if (!gun || o.name === wanted) gun = o;
  });
  const fa = gun?.userData?.fireArms ?? {};
  let traverse = null, up = null, down = null;
  for (let a = gun?.parent; a; a = a.parent) {
    const axes = a.userData?.rig?.axes;
    if (axes?.pitch && up == null) { up = -Number(axes.pitch.min); down = -Number(axes.pitch.max); }
    if (axes?.yaw && axes.yaw.free && traverse == null) traverse = Number(axes.yaw.maxSpeed);
  }
  const ballistic = gunOf(fa);
  const rof = Number(fa.roundOfFire) || 0.35;
  return {
    template,
    name: prettyTank(template),
    hp: hp ?? 100,
    critical,
    angleMod: angleModOf(scene),
    shellMaterial: fa.projectile?.material ?? null,
    gun: {
      ...ballistic,
      // Whole ticks between shots (GUN-13).
      reload: Math.ceil(30 / rof - 1e-9) / 30,
      traverse,
      up: Number.isFinite(up) ? up : 20,
      down: Number.isFinite(down) ? down : -5,
      per100: degreesPer100(ballistic),
      reach: reach(ballistic, Number.isFinite(up) ? up : 20),
    },
    sheet: sheet?.tanks?.[template] ?? null,
  };
}

// --- the page -------------------------------------------------------------------

const svgIcon = (d, extra = '') => `<svg class="dfs-ico" viewBox="0 0 24 24" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  matchup: svgIcon('<path d="M3 15h9l2-3h5v3h2"/><path d="M5 15v2.5h14V15" class="is-thin"/><path d="M14 12V9.5h6" class="is-thin"/>'),
  fold: svgIcon('<path d="M14.5 6l-6 6 6 6"/><path d="M19.5 4v16" class="is-thin"/>'),
  caret: svgIcon('<path d="M7 10l5 5 5-5"/>', ' data-caret'),
  play: svgIcon('<path d="M8 5.5v13l10-6.5z"/>'),
};

const root = document.createElement('div');
root.className = 'dfs tks';
root.innerHTML = `
  <aside class="dfs-side">
    <nav class="dfs-rail" aria-label="School">
      <a class="dfs-brand-sigil" href="${RANGE_HOME}" title="The Range"><img src="${LOGO}" alt="The Range" width="32" height="32"></a>
      <div class="dfs-sections" role="group" aria-label="School sections">
        <button type="button" class="dfs-rail-btn" aria-pressed="true" title="Matchup">${ICON.matchup}<span>Matchup</span></button>
      </div>
      <button type="button" class="dfs-rail-btn dfs-list-toggle" aria-expanded="true" title="Hide the list (L)">${ICON.fold}<span>Hide</span></button>
    </nav>
    <div class="dfs-panel">
      <header class="dfs-brand">
        <div class="dfs-brand-row"><a class="dfs-brand-site" href="${RANGE_HOME}">The Range</a>
          <button type="button" class="dfs-mod-now" hidden aria-haspopup="true" aria-expanded="false" title="Choose the game or mod"><img alt="" width="18" height="18"><span></span>${ICON.caret}</button></div>
        <b>Tank school</b>
        <small>Matchups, on BF1942's own damage tables and tank law</small>
        <p class="dfs-mod-note" hidden></p>
        <div class="dfs-mod-list" role="radiogroup" aria-label="Game or mod" hidden></div>
      </header>
      <div class="dfs-arena"><button type="button" class="dfs-arena-now" aria-expanded="false" title="Choose the arena"><span>ARENA</span><b></b><small></small>${ICON.caret}</button>
        <div class="dfs-arena-list" role="radiogroup" aria-label="Arena" hidden></div></div>
      <div class="dfs-plane tks-pick" data-pick="yours"><span>YOUR TANK</span><div class="dfs-plane-list" role="radiogroup" aria-label="Your tank"></div></div>
      <div class="dfs-plane tks-pick" data-pick="theirs"><span>THEIR TANK</span><div class="dfs-plane-list" role="radiogroup" aria-label="Their tank"></div></div>
      <p class="tks-side-note">Any two tanks of the arena can meet: your own side's too.</p>
      <footer class="dfs-foot"><kbd>Esc</kbd> the Range · <kbd>L</kbd> list</footer>
    </div>
  </aside>
  <main class="tks-main">
    <header class="tks-head">
      <small class="mm-eyebrow">Matchup</small>
      <h1><span class="tks-you-name"></span> <i>against</i> <span class="tks-them-name"></span></h1>
      <p class="tks-headline"></p>
    </header>
    <section class="tks-card tks-armour" aria-labelledby="tks-h-armour">
      <header class="tks-card-head"><small>01</small><h2 id="tks-h-armour">Where to aim, where you are exposed</h2></header>
      <div class="tks-stage">
        <canvas class="tks-canvas"></canvas>
        <div class="tks-stage-tags"><span class="is-them">THEIRS<small>shots of your gun</small></span><span class="is-you">YOURS<small>shots of their gun</small></span></div>
        <div class="tks-tip" hidden></div>
        <div class="tks-view" role="group" aria-label="Seen from">
          <span class="tks-seg" role="radiogroup" aria-label="Bearing">
            <button type="button" data-bearing="0">Front</button><button type="button" data-bearing="45">45</button><button type="button" data-bearing="90">Side</button><button type="button" data-bearing="135">135</button><button type="button" data-bearing="180">Rear</button>
          </span>
          <button type="button" class="tks-toggle" data-toggle="above" aria-pressed="false" title="Look from 20 degrees above: the roofs show">From above</button>
          <button type="button" class="tks-toggle" data-toggle="model" aria-pressed="false" title="The tanks' own models instead of their painted hit faces">Models</button>
        </div>
        <p class="tks-stage-hint">Drag to turn both tanks. Point at a face to read it.</p>
      </div>
      <div class="tks-legend" aria-label="Shots to kill"></div>
      <div class="tks-clocks">
        <figure class="tks-clock is-them"><div></div><figcaption><b>Theirs</b> your shots to kill, from each side</figcaption></figure>
        <figure class="tks-clock is-you"><div></div><figcaption><b>Yours</b> their shots to kill, from each side</figcaption></figure>
      </div>
      <div class="tks-words-pair"><ul class="tks-words tks-aim"></ul><ul class="tks-words tks-exposed"></ul></div>
    </section>
    <div class="tks-grid">
      <section class="tks-card tks-guns" aria-labelledby="tks-h-guns">
        <header class="tks-card-head"><small>02</small><h2 id="tks-h-guns">The guns</h2></header>
        <div class="tks-arc-wrap"><svg class="tks-arcs" viewBox="0 0 560 220" role="img" aria-label="Both shells' arcs to the target"></svg></div>
        <label class="tks-range"><span>Target at</span><input type="range" min="50" max="400" step="10" value="200"><b></b></label>
        <table class="tks-table tks-gun-table"></table>
        <ul class="tks-words tks-gun-words"></ul>
      </section>
      <div class="tks-stack">
      <section class="tks-card tks-drive" aria-labelledby="tks-h-drive">
        <header class="tks-card-head"><small>03</small><h2 id="tks-h-drive">The drive</h2></header>
        <table class="tks-table tks-drive-table"></table>
        <ul class="tks-words tks-hull-words"></ul>
      </section>
      <section class="tks-card tks-steady" aria-labelledby="tks-h-steady">
        <header class="tks-card-head"><small>04</small><h2 id="tks-h-steady">How steady the hull is</h2></header>
        <div class="tks-steady-bar">
          <span class="tks-seg" role="radiogroup" aria-label="What the hull does">
            <button type="button" data-scenario="hardStop">Hard stop</button><button type="button" data-scenario="coast">Let go at speed</button><button type="button" data-scenario="fireAhead">Fire ahead</button><button type="button" data-scenario="fireAcross">Fire across</button>
          </span>
          <button type="button" class="tks-play" title="Play it">${ICON.play}<span>Play</span></button>
        </div>
        <div class="tks-rockers"><figure class="is-you"><svg viewBox="-60 -40 120 70"></svg><figcaption></figcaption></figure><figure class="is-them"><svg viewBox="-60 -40 120 70"></svg><figcaption></figcaption></figure></div>
        <svg class="tks-trace" viewBox="0 0 560 170" role="img" aria-label="The hull's swing over time"></svg>
        <p class="tks-steady-note"></p>
      </section>
      </div>
    </div>
    <footer class="tks-foot">Every number is the game's own: the damage tables from <code>Game.rfa</code>, each gun's <code>Weapons.con</code>, the tanks' collision faces, and the server's per-tick tank law driven in node (<code>surveys/tank_school_sheet.mjs</code>). Notes: <code>features/battle-schools</code>.</footer>
  </main>`;
document.body.appendChild(root);
const q = sel => root.querySelector(sel);
const ui = {
  modNow: q('.dfs-mod-now'), modList: q('.dfs-mod-list'), modNote: q('.dfs-mod-note'),
  arenaNow: q('.dfs-arena-now'), arenaList: q('.dfs-arena-list'),
  yoursList: q('.tks-pick[data-pick="yours"] .dfs-plane-list'), theirsList: q('.tks-pick[data-pick="theirs"] .dfs-plane-list'),
  youName: q('.tks-you-name'), themName: q('.tks-them-name'), headline: q('.tks-headline'),
  canvas: q('.tks-canvas'), stage: q('.tks-stage'), tip: q('.tks-tip'), view: q('.tks-view'), legend: q('.tks-legend'),
  clockThem: q('.tks-clock.is-them > div'), clockYou: q('.tks-clock.is-you > div'),
  aim: q('.tks-aim'), exposed: q('.tks-exposed'),
  arcs: q('.tks-arcs'), range: q('.tks-range input'), rangeOut: q('.tks-range b'), gunTable: q('.tks-gun-table'), gunWords: q('.tks-gun-words'),
  driveTable: q('.tks-drive-table'), hullWords: q('.tks-hull-words'),
  scenarios: q('.tks-steady .tks-seg'), play: q('.tks-play'), rockers: [...root.querySelectorAll('.tks-rockers figure')],
  trace: q('.tks-trace'), steadyNote: q('.tks-steady-note'), listToggle: q('.dfs-list-toggle'),
};

// --- the sidebar ------------------------------------------------------------------

function drawMods() {
  const list = offered.map(m => ({ id: m.id, name: m.name || m.short || m.id, short: m.short || m.name || m.id,
    icon: new URL(m.icon || `icons/mods/${m.id}.png`, VIEWER_ROOT).href }));
  const now = list.find(m => m.id === mod.id);
  ui.modNow.hidden = !now || list.length < 2;
  ui.modNote.hidden = arenaMod === mod;
  ui.modNote.textContent = arenaMod === mod ? '' : `${mod.short || mod.name} has no battle with tanks on both sides yet: these are ${arenaMod.short}'s.`;
  if (!now) return;
  ui.modNow.querySelector('img').src = now.icon;
  ui.modNow.querySelector('span').textContent = now.short;
  ui.modList.innerHTML = list.map(m => `<button type="button" role="radio" data-mod="${esc(m.id)}" aria-checked="${m === now}">`
    + `<img src="${esc(m.icon)}" alt="" width="22" height="22" loading="lazy"><b>${esc(m.name)}</b><small>${m.short.toLowerCase() === m.name.toLowerCase() ? '' : esc(m.short)}</small></button>`).join('');
}
ui.modNow.addEventListener('click', () => {
  ui.modList.hidden = !ui.modList.hidden;
  ui.modNow.setAttribute('aria-expanded', String(!ui.modList.hidden));
});
ui.modList.addEventListener('click', e => {
  const b = e.target.closest('button[data-mod]');
  if (!b || b.dataset.mod === mod.id) return;
  remember(b.dataset.mod);
  const next = new URL(location.href);
  for (const k of ['mod', 'arena', 'yours', 'theirs']) next.searchParams.delete(k);
  if (b.dataset.mod !== VANILLA.id) next.searchParams.set('mod', b.dataset.mod);
  location.href = next.href;
});

function drawArenas() {
  ui.arenaNow.querySelector('b').textContent = arena.name;
  ui.arenaNow.querySelector('small').textContent = `${arena.allied.map(t => prettyTank(t.template)).join(', ')} v ${arena.axis.map(t => prettyTank(t.template)).join(', ')}`;
  ui.arenaList.innerHTML = arenas.map(a => `<button type="button" role="radio" data-arena="${esc(a.map)}" aria-checked="${a === arena}">`
    + `<b>${esc(a.name)}</b><small>${esc(a.allied.map(t => prettyTank(t.template)).join(', '))} v ${esc(a.axis.map(t => prettyTank(t.template)).join(', '))}</small>`
    + `<small class="tks-battles">${esc(a.battles.slice(0, 4).join(', '))}${a.battles.length > 4 ? ` and ${a.battles.length - 4} more` : ''}</small></button>`).join('');
}
ui.arenaNow.addEventListener('click', () => {
  ui.arenaList.hidden = !ui.arenaList.hidden;
  ui.arenaNow.setAttribute('aria-expanded', String(!ui.arenaList.hidden));
});
ui.arenaList.addEventListener('click', e => {
  const b = e.target.closest('button[data-arena]');
  const next = b && arenas.find(a => a.map === b.dataset.arena);
  ui.arenaList.hidden = true;
  ui.arenaNow.setAttribute('aria-expanded', 'false');
  if (!next || next === arena) return;
  arena = next;
  store(ARENA_KEY, arena.map);
  if (!arena.tanks.some(t => t.template === yoursChoice)) yoursChoice = null;
  if (!arena.tanks.some(t => t.template === theirsChoice)) theirsChoice = null;
  refresh();
});

function drawPicks() {
  const chip = (t, chosen) => `<button type="button" class="dfs-chip${t.side === 'Axis' ? ' is-axis' : ''}" role="radio" data-tank="${esc(t.template)}" aria-checked="${t.template === chosen}" title="${esc(t.side)}">${esc(prettyTank(t.template))}</button>`;
  ui.yoursList.innerHTML = arena.tanks.map(t => chip(t, yours()?.template)).join('');
  ui.theirsList.innerHTML = arena.tanks.map(t => chip(t, theirs()?.template)).join('');
}
ui.yoursList.addEventListener('click', e => {
  const b = e.target.closest('button[data-tank]');
  if (!b) return;
  yoursChoice = b.dataset.tank;
  store(`${KEY}:yours`, yoursChoice);
  refresh();
});
ui.theirsList.addEventListener('click', e => {
  const b = e.target.closest('button[data-tank]');
  if (!b) return;
  theirsChoice = b.dataset.tank;
  store(`${KEY}:theirs`, theirsChoice);
  refresh();
});
ui.listToggle.addEventListener('click', () => {
  const closed = root.classList.toggle('is-list-closed');
  ui.listToggle.setAttribute('aria-expanded', String(!closed));
  requestAnimationFrame(resizeStage);
});
addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape') location.href = RANGE_HOME;
  else if (e.key === 'l' || e.key === 'L') ui.listToggle.click();
});

// --- 01: the painted hulls ------------------------------------------------------------

const stage = {
  renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.5, 400),
  bearing: 0, shown: 0, above: false, model: false,
  pair: [], // [{ group, painted: [mesh], visual: [mesh], tank, price }] theirs first, then yours
};
stage.scene.add(new THREE.HemisphereLight(0xf2f0e6, 0x3a3a32, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 8);
stage.scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshBasicMaterial({ color: 0x151515 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.2;
stage.scene.add(ground);
const grid = new THREE.GridHelper(60, 30, 0x262626, 0x1d1d1d);
grid.position.y = -1.19;
stage.scene.add(grid);

function renderer() {
  if (stage.renderer) return stage.renderer;
  stage.renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
  stage.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  stage.renderer.setClearColor(0x0c0c0c);
  return stage.renderer;
}
function resizeStage() {
  const r = renderer();
  const w = ui.canvas.clientWidth, h = ui.canvas.clientHeight;
  if (!w || !h) return;
  r.setSize(w, h, false);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
  draw();
}
new ResizeObserver(resizeStage).observe(ui.canvas);

/** One tank on the stage: its model (hidden while the faces are shown) and
 *  its collision faces, each painted by the band of shots the other gun
 *  needs there for a square hit. */
function stageTank(scene, price, hp) {
  const group = new THREE.Group();
  const model = scene.clone(true);
  const painted = [], visual = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry?.userData?.collision) {
      const material = Number(o.geometry.userData.defenseMaterial);
      const damage = price(material);
      const band = bandOf(shotsFor(hp, damage));
      // Flat-shaded so each plate reads as a plate, with a share of its own
      // colour as glow so a band stays its colour in the shade.
      o.material = new THREE.MeshLambertMaterial({ color: band.color, emissive: band.color, emissiveIntensity: 0.32, flatShading: true, side: THREE.DoubleSide });
      o.userData.face = { material, damage, shots: shotsFor(hp, damage), band };
      o.visible = true;
      painted.push(o);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), new THREE.LineBasicMaterial({ color: 0x0c0c0c }));
      edges.userData.edge = true;
      o.add(edges);
    } else if (o.visible !== false) {
      // Hidden by its material, not by `visible`: a part's own mesh is often
      // the parent of its collision faces, and hiding it would hide them.
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      visual.push(o);
    }
  });
  // Stand it on the floor, by the faces that are drawn: `setFromObject`
  // counts hidden parts too (a round's mesh, an effect, a lod alternative),
  // which can sit metres away.
  const shown = o => { for (let a = o; a && a !== model.parent; a = a.parent) if (!a.visible) return false; return true; };
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of painted) if (shown(m)) box.expandByObject(m);
  if (box.isEmpty()) box.setFromObject(model);
  model.position.y -= box.min.y + 1.2;
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  group.add(model);
  return { group, painted, visual, size: box.getSize(new THREE.Vector3()) };
}

function setModelView(on) {
  stage.model = on;
  for (const t of stage.pair) {
    for (const m of t.painted) m.visible = !on;
    for (const m of t.visual) for (const mat of [m.material].flat()) mat.visible = on;
  }
  q('[data-toggle="model"]').setAttribute('aria-pressed', String(on));
  ui.legend.classList.toggle('is-off', on);
  draw();
}

function placeStage() {
  const [a, b] = stage.pair;
  if (!a || !b) return;
  // Each tank turns about its own middle, so it needs the circle its hull
  // sweeps: half its horizontal diagonal.
  const radius = t => Math.hypot(t.size.x, t.size.z) / 2;
  const r = Math.max(radius(a), radius(b));
  const gap = r + 0.9;
  a.group.position.x = -gap;
  b.group.position.x = gap;
  const halfW = gap + r;
  const halfH = Math.max(a.size.y, b.size.y) / 2 + 1.2;
  const tanV = Math.tan(stage.camera.fov * Math.PI / 360);
  const d = Math.max(halfW / (tanV * stage.camera.aspect), halfH / tanV) * 1.18 + r;
  const el = stage.above ? 20 * Math.PI / 180 : 6 * Math.PI / 180;
  stage.camera.position.set(0, Math.sin(el) * d, Math.cos(el) * d);
  stage.camera.lookAt(0, -0.2, 0);
}

let animating = 0;
function setBearing(b, { animate = true } = {}) {
  stage.bearing = ((b % 360) + 360) % 360;
  root.querySelectorAll('[data-bearing]').forEach(x => x.setAttribute('aria-checked', String(Number(x.dataset.bearing) === Math.round(stage.bearing))));
  if (!animate) { stage.shown = stage.bearing; draw(); return; }
  const id = ++animating;
  const step = () => {
    if (id !== animating) return;
    let d = stage.bearing - stage.shown;
    d = ((d + 540) % 360) - 180;
    stage.shown += Math.abs(d) < 0.5 ? d : d * 0.18;
    draw();
    if (Math.abs(d) >= 0.5) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function draw() {
  if (!stage.renderer) return;
  // Seen from `shown` degrees off the nose, for both: the camera looks down
  // -z, so the tank turns by the bearing plus half a turn.
  for (const t of stage.pair) t.group.rotation.y = (stage.shown + 180) * Math.PI / 180;
  placeStage();
  stage.renderer.render(stage.scene, stage.camera);
}

ui.view.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.bearing != null) setBearing(Number(b.dataset.bearing));
  if (b.dataset.toggle === 'above') {
    stage.above = !stage.above;
    b.setAttribute('aria-pressed', String(stage.above));
    drawClocks();
    draw();
  }
  if (b.dataset.toggle === 'model') setModelView(!stage.model);
});

// Drag to turn; point to read a face.
let drag = null;
ui.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, b: stage.bearing }; ui.canvas.setPointerCapture(e.pointerId); });
ui.canvas.addEventListener('pointerup', () => { drag = null; });
ui.canvas.addEventListener('pointermove', e => {
  if (drag) {
    animating++;
    stage.bearing = stage.shown = ((drag.b - (e.clientX - drag.x) * 0.5) % 360 + 360) % 360;
    root.querySelectorAll('[data-bearing]').forEach(x => x.setAttribute('aria-checked', 'false'));
    ui.tip.hidden = true;
    draw();
    return;
  }
  readFace(e);
});
ui.canvas.addEventListener('pointerleave', () => { ui.tip.hidden = true; });
const picker = new THREE.Raycaster();
function readFace(e) {
  if (stage.model || !stage.pair.length) { ui.tip.hidden = true; return; }
  const r = ui.canvas.getBoundingClientRect();
  picker.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
  const hit = picker.intersectObjects(stage.pair.flatMap(t => t.painted), false)[0];
  if (!hit) { ui.tip.hidden = true; return; }
  const f = hit.object.userData.face;
  const owner = stage.pair.find(t => t.painted.includes(hit.object));
  const whose = owner === stage.pair[0] ? 'Theirs' : 'Yours';
  const gunOwner = owner === stage.pair[0] ? 'your' : 'their';
  // The angle this face is met at from where the camera stands.
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const dir = picker.ray.direction;
  const at = angleFactor(Math.abs(normal.dot(dir)), owner.tank.angleMod);
  const damage = f.damage * at;
  ui.tip.innerHTML = f.damage > 0
    ? `<small>${whose} · ${esc(faceName(f.material))}</small><b>${n1(f.damage)} a square hit from ${gunOwner} gun · ${f.shots} shot${f.shots === 1 ? '' : 's'}</b>`
      + `<span>From here, ${Math.round(Math.acos(Math.min(1, Math.abs(normal.dot(dir)))) * 180 / Math.PI)} deg off square: ${n1(damage)}, ${shotsFor(owner.tank.hp, damage)} shots</span>`
    : `<small>${whose} · ${esc(faceName(f.material))}</small><b>${gunOwner === 'your' ? 'Your' : 'Their'} gun does nothing here</b>`;
  ui.tip.hidden = false;
  const sr = ui.stage.getBoundingClientRect();
  ui.tip.style.left = `${Math.min(sr.width - 250, e.clientX - sr.left + 14)}px`;
  ui.tip.style.top = `${e.clientY - sr.top + 14}px`;
}

function drawLegend() {
  ui.legend.innerHTML = `<small>Shots to kill, a square hit</small>`
    + [...BANDS, IMMUNE].map(b => `<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join('');
}

// --- the clocks: shots to kill from every side ------------------------------------

const BEARINGS = [0, 30, 60, 90, 120, 150, 180];
/** A clock of shots to kill round a hull: twelve sectors, the front up. */
function clockSvg(byBearing, label) {
  if (!byBearing) return '<p class="tks-empty">No collision faces in this model.</p>';
  const R0 = 46, R1 = 76, C = 86;
  const sector = (deg, shots) => {
    const a0 = (deg - 15 - 90) * Math.PI / 180, a1 = (deg + 15 - 90) * Math.PI / 180;
    const p = (r, a) => `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
    const mid = (deg - 90) * Math.PI / 180, rm = (R0 + R1) / 2;
    return `<path d="M${p(R0, a0)} L${p(R1, a0)} A${R1} ${R1} 0 0 1 ${p(R1, a1)} L${p(R0, a1)} A${R0} ${R0} 0 0 0 ${p(R0, a0)}Z" fill="${bandOf(shots).color}"/>`
      + `<text x="${(C + rm * Math.cos(mid)).toFixed(1)}" y="${(C + rm * Math.sin(mid) + 4).toFixed(1)}">${shots ?? '-'}</text>`;
  };
  let body = '';
  for (let deg = 0; deg < 360; deg += 30) {
    const b = deg <= 180 ? deg : 360 - deg;
    body += sector(deg, byBearing[b]?.shots ?? null);
  }
  const hull = `<rect x="${C - 11}" y="${C - 22}" width="22" height="44" rx="3" class="tks-clock-hull"/><circle cx="${C}" cy="${C - 2}" r="8" class="tks-clock-hull"/><path d="M${C} ${C - 10}V${C - 34}" class="tks-clock-gun"/>`;
  return `<svg viewBox="0 0 172 172" role="img" aria-label="${esc(label)}">${body}${hull}`
    + `<text x="${C}" y="9" class="tks-clock-dir">FRONT</text><text x="${C}" y="170" class="tks-clock-dir">REAR</text></svg>`;
}

const roseCache = new Map();
function roseFor(entry, elevation) {
  const key = `${entry.key}|${elevation}`;
  if (!roseCache.has(key)) roseCache.set(key, bearingShots(entry.scene, entry.price, entry.tank.hp, { bearings: BEARINGS, elevation }));
  return roseCache.get(key);
}
function drawClocks() {
  const [them, you] = current.entries;
  if (!them || !you) return;
  const el = stage.above ? 20 : 0;
  ui.clockThem.innerHTML = clockSvg(roseFor(them, el), `${them.tank.name}: your shots to kill from each side`);
  ui.clockYou.innerHTML = clockSvg(roseFor(you, el), `${you.tank.name}: their shots to kill from each side`);
}

// --- 02: the guns ---------------------------------------------------------------------

function drawGuns() {
  const [them, you] = current.entries;
  const R = Number(ui.range.value);
  ui.rangeOut.textContent = `${R} m`;
  const guns = [{ who: 'is-you', t: you.tank }, { who: 'is-them', t: them.tank }];
  const W = 560, H = 220, L = 46, B = 30, T = 14, Rt = 14;
  const lines = guns.map(g => {
    const e = elevationFor(g.t.gun, R, { maxElevation: g.t.gun.up });
    const aimed = e == null ? null : arc(g.t.gun, { range: R, elevation: e, step: 0.05 });
    const level = arc(g.t.gun, { range: R, elevation: 0, step: 0.05 });
    return { ...g, e, aimed, level, drop: dropAt(g.t.gun, R), tof: timeTo(g.t.gun, R, e ?? 0) };
  });
  const ys = lines.flatMap(l => [...(l.aimed ?? []), ...l.level].map(p => p.y));
  const yMax = Math.max(5, ...ys), yMin = Math.min(-5, ...ys);
  const sx = x => L + (x / R) * (W - L - Rt), sy = y => T + (yMax - y) / (yMax - yMin) * (H - T - B);
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join('');
  const ticks = pts => pts.filter(p => Math.abs(p.t / 0.5 - Math.round(p.t / 0.5)) < 0.026 && p.t > 0.01)
    .map(p => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.4"/>`).join('');
  let svg = `<line class="tks-axis" x1="${L}" y1="${sy(0)}" x2="${W - Rt}" y2="${sy(0)}"/>`;
  for (let m = 0; m <= R; m += R > 200 ? 100 : 50) svg += `<text class="tks-tick" x="${sx(m)}" y="${H - 10}">${m} m</text>`;
  svg += `<text class="tks-tick is-y" x="${L - 6}" y="${sy(yMax) + 4}">+${Math.round(yMax)} m</text><text class="tks-tick is-y" x="${L - 6}" y="${sy(yMin) + 4}">${Math.round(yMin)} m</text>`;
  svg += `<path class="tks-target" d="M${sx(R)} ${sy(0) - 9}V${sy(0) + 9}M${sx(R) - 6} ${sy(0)}H${sx(R) + 6}"/>`;
  for (const l of lines) {
    svg += `<g class="tks-arc ${l.who}"><path class="is-level" d="${path(l.level)}"/>`
      + (l.aimed ? `<path d="${path(l.aimed)}"/><g class="tks-dots">${ticks(l.aimed)}</g>` : '')
      + `</g>`;
  }
  // The key, and a word when the two shells are the same and their arcs lie
  // on each other.
  const same = you.tank.gun.speed === them.tank.gun.speed && you.tank.gun.gravity === them.tank.gun.gravity;
  svg += `<g class="tks-key" transform="translate(${L + 8} ${H - B - (same ? 34 : 20)})">`
    + `<text class="is-you" x="0" y="0">${esc(you.tank.name)}</text><text class="is-them" x="0" y="14">${esc(them.tank.name)}</text>`
    + (same ? `<text class="is-same" x="0" y="28">same shell: one arc</text>` : '') + '</g>';
  ui.arcs.innerHTML = svg;
  const row = (label, f, hint = '') => `<tr><th scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${guns.map(g => `<td class="${g.who}">${f(g.t, lines.find(l => l.t === g.t))}</td>`).join('')}</tr>`;
  ui.gunTable.innerHTML = `<thead><tr><th></th><th class="is-you">${esc(you.tank.name)}<small>yours</small></th><th class="is-them">${esc(them.tank.name)}<small>theirs</small></th></tr></thead><tbody>`
    + row('Muzzle speed', t => `${n1(t.gun.speed)} m/s`)
    + row('Gravity on the shell', t => (t.gun.gravity === 1 ? 'full' : `${n1(t.gun.gravity * 100)}%`))
    + row(`To hit at ${R} m`, (t, l) => (l.e == null ? 'out of reach' : `aim ${n1(l.e)} deg up`), 'solid arcs')
    + row(`Fired level, at ${R} m`, (t, l) => `falls ${n1(l.drop)} m`, 'dashed arcs')
    + row('Hold-over rule', t => (t.gun.per100 ? `about ${t.gun.per100} deg per 100 m` : '-'))
    + row(`Flight to ${R} m`, (t, l) => `${n1(l.tof)} s`, 'a dot every half second')
    + row('Reach, flat ground', t => `${Math.round(t.gun.reach.range)} m at +${n1(t.gun.up)} deg`)
    + row('Reload', t => `${t.gun.reload.toFixed(2)} s`)
    + row('Turret', t => (t.gun.traverse ? `${n1(t.gun.traverse)} deg/s, 90 deg in ${n1(90 / t.gun.traverse)} s` : '-'))
    + row('Gun up / down', t => `+${n1(t.gun.up)} / ${n1(t.gun.down)} deg`)
    + '</tbody>';
}
ui.range.addEventListener('input', () => drawGuns());

// --- 03: the drive ----------------------------------------------------------------------

function drawDrive() {
  const [them, you] = current.entries;
  const tanks = [{ who: 'is-you', t: you.tank }, { who: 'is-them', t: them.tank }];
  const val = (t, f) => (t.sheet ? f(t.sheet) : '-');
  const row = (label, f, hint = '') => `<tr><th scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${tanks.map(x => `<td class="${x.who}">${f(x.t)}</td>`).join('')}</tr>`;
  ui.driveTable.innerHTML = `<thead><tr><th></th><th class="is-you">${esc(you.tank.name)}<small>yours</small></th><th class="is-them">${esc(them.tank.name)}<small>theirs</small></th></tr></thead><tbody>`
    + row('Hit points', t => `${n1(t.hp)}${t.critical ? `<small>burning under ${n1(t.critical)}</small>` : ''}`)
    + row('Top speed', t => val(t, s => `${n1(s.drive.top)} m/s`))
    + row('Reverse', t => val(t, s => `${n1(s.drive.reverse)} m/s`))
    + row('5 m forward', t => val(t, s => `${n1(s.drive.forward5)} s`), 'from rest')
    + row('5 m back', t => val(t, s => `${n1(s.drive.back5)} s`), 'from rest')
    + row('Turn 90 deg', t => val(t, s => `${n1(s.drive.turnFromRest)} s`), 'from rest, throttle and full lock')
    + row('Turn 90 deg', t => val(t, s => `${n1(s.drive.turnOnTheMove)} s`), 'at top speed')
    + '</tbody>';
  if (!sheet) ui.driveTable.insertAdjacentHTML('afterend', '');
}

// --- 04: steadiness -----------------------------------------------------------------------

const SCENARIO_WORDS = {
  hardStop: ['Hard stop', 'Full throttle, then full reverse until the hull stops, then hands off.'],
  coast: ['Let go at speed', 'Full throttle, then the throttle let go.'],
  fireAhead: ['Fire ahead', 'The main gun fired straight ahead, at rest.'],
  fireAcross: ['Fire across', 'The main gun fired across the hull, at rest: the hull rolls away from it.'],
};
let scenario = 'hardStop';
let playing = null;
/** A hull from the side (or from behind, for a roll), drawn as a glyph. */
const HULL = '<path class="tks-glyph" d="M-46 6 L-40 -6 L38 -6 L46 6 L40 14 L-40 14 Z"/><path class="tks-glyph" d="M-20 -6 L-16 -18 L14 -18 L18 -6 Z"/><path class="tks-glyph-gun" d="M10 -13 H52"/><path class="tks-glyph-track" d="M-42 14 H42"/>';
const HULL_REAR = '<path class="tks-glyph" d="M-28 6 L-28 -6 L28 -6 L28 6 L24 14 L-24 14 Z"/><path class="tks-glyph" d="M-14 -6 L-12 -18 L12 -18 L14 -6 Z"/><path class="tks-glyph-track" d="M-28 14 H28"/>';

function drawSteady(t = null) {
  const [them, you] = current.entries;
  ui.scenarios.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.scenario === scenario)));
  const pair = [{ who: 'is-you', t: you.tank }, { who: 'is-them', t: them.tank }];
  const traces = pair.map(p => p.t.sheet?.traces?.[scenario] ?? null);
  const sums = pair.map(p => p.t.sheet?.steady?.[scenario] ?? null);
  if (!traces[0] && !traces[1]) {
    ui.trace.innerHTML = `<text class="tks-tick" x="280" y="90">Not measured for this mod yet</text>`;
    ui.steadyNote.textContent = '';
    for (const f of ui.rockers) { f.querySelector('svg').innerHTML = ''; f.querySelector('figcaption').textContent = ''; }
    return;
  }
  const hz = traces.find(Boolean).hz;
  const len = Math.max(...traces.map(x => x?.values.length ?? 0));
  const peak = Math.max(2, ...traces.flatMap(x => (x ? x.values.map(Math.abs) : [])));
  const W = 560, H = 170, L = 40, Rt = 10, T = 12, B = 24;
  const sx = i => L + (i / Math.max(1, len - 1)) * (W - L - Rt), sy = v => T + (peak - v) / (2 * peak) * (H - T - B);
  let svg = `<rect class="tks-band" x="${L}" y="${sy(1)}" width="${W - L - Rt}" height="${sy(-1) - sy(1)}"/>`
    + `<line class="tks-axis" x1="${L}" y1="${sy(0)}" x2="${W - Rt}" y2="${sy(0)}"/>`
    + `<text class="tks-tick is-y" x="${L - 6}" y="${sy(peak) + 4}">+${Math.round(peak)}&#176;</text><text class="tks-tick is-y" x="${L - 6}" y="${sy(-peak) + 4}">-${Math.round(peak)}&#176;</text>`
    + `<text class="tks-tick is-band" x="${W - Rt - 4}" y="${sy(1) - 4}">within 1&#176;: 3.5 m at 200 m</text>`;
  for (let s = 0; s <= (len - 1) / hz; s += 2) svg += `<text class="tks-tick" x="${sx(s * hz)}" y="${H - 6}">${s} s</text>`;
  pair.forEach((p, k) => {
    const tr = traces[k];
    if (!tr) return;
    svg += `<path class="tks-line ${p.who}" d="${tr.values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join('')}"/>`;
  });
  if (t != null) svg += `<line class="tks-now" x1="${sx(t * hz)}" y1="${T}" x2="${sx(t * hz)}" y2="${H - B}"/>`;
  ui.trace.innerHTML = svg;
  const axis = traces.find(Boolean).axis;
  pair.forEach((p, k) => {
    const f = ui.rockers[k];
    const tr = traces[k];
    const v = tr ? tr.values[Math.min(tr.values.length - 1, Math.round((t ?? 0) * hz))] ?? 0 : 0;
    // Pitch: nose down is negative, the glyph faces right, so it turns
    // clockwise for a negative pitch. Roll turns the rear view.
    f.querySelector('svg').innerHTML = `<g transform="rotate(${(-v).toFixed(2)})">${axis === 'roll' ? HULL_REAR : HULL}</g>`;
    const sm = sums[k];
    f.querySelector('figcaption').innerHTML = `<b>${esc(p.t.name)}</b>`
      + (sm ? `<span>swings ${n1(sm.peak)}&#176;, still after ${n1(sm.still)} s${Math.abs(sm.left) >= 0.5 ? `, ends ${n1(Math.abs(sm.left))}&#176; off` : ''}</span>` : '<span>not measured</span>');
  });
  ui.steadyNote.textContent = SCENARIO_WORDS[scenario][1];
}
ui.scenarios.addEventListener('click', e => {
  const b = e.target.closest('button[data-scenario]');
  if (!b) return;
  scenario = b.dataset.scenario;
  stopPlay();
  drawSteady();
});
function stopPlay() {
  if (playing) cancelAnimationFrame(playing.raf);
  playing = null;
  ui.play.classList.remove('is-playing');
}
ui.play.addEventListener('click', () => {
  if (playing) { stopPlay(); drawSteady(); return; }
  const [them, you] = current.entries;
  const tr = [you.tank, them.tank].map(t => t.sheet?.traces?.[scenario]).filter(Boolean);
  if (!tr.length) return;
  const dur = Math.max(...tr.map(x => x.values.length / x.hz));
  const t0 = performance.now();
  ui.play.classList.add('is-playing');
  const tick = now => {
    const t = (now - t0) / 1000;
    if (t > dur) { stopPlay(); drawSteady(); return; }
    drawSteady(t);
    playing.raf = requestAnimationFrame(tick);
  };
  playing = { raf: requestAnimationFrame(tick) };
});

// --- loading a pairing ------------------------------------------------------------------

const current = { entries: [], ticket: 0 };

async function loadEntry(t, attacker) {
  const scene = await loadVehicleModel(t.template, modId(arenaMod));
  if (!scene) throw new Error(`${t.template}: no model`);
  const tank = readTank(t.template, scene, t.row);
  return { key: `${t.template}<-${attacker.template}`, scene, tank, template: t.template };
}

async function refresh() {
  const ticket = ++current.ticket;
  const mine = yours(), other = theirs();
  drawArenas();
  drawPicks();
  ui.youName.textContent = prettyTank(mine.template);
  ui.themName.textContent = prettyTank(other.template);
  root.classList.add('is-loading');
  const address = new URL(location.href);
  address.searchParams.set('arena', arena.map);
  address.searchParams.set('yours', mine.template);
  address.searchParams.set('theirs', other.template);
  // Always named, vanilla too: a link or a reload must not fall back to the
  // mod another page last remembered.
  address.searchParams.set('mod', mod.id);
  history.replaceState(null, '', address);
  let them, you;
  try {
    [them, you] = await Promise.all([loadEntry(other, mine), loadEntry(mine, other)]);
  } catch (e) {
    console.warn('tank school', e);
    ui.headline.textContent = 'This tank\'s model did not load.';
    root.classList.remove('is-loading');
    return;
  }
  if (ticket !== current.ticket) return;
  // Each hull priced by the other's shell.
  them.price = pricer(tables, you.tank.shellMaterial);
  you.price = pricer(tables, them.tank.shellMaterial);
  current.entries = [them, you];
  for (const t of stage.pair) stage.scene.remove(t.group);
  stage.pair = [them, you].map(e => ({ ...stageTank(e.scene, e.price, e.tank.hp), tank: e.tank }));
  for (const t of stage.pair) stage.scene.add(t.group);
  setModelView(stage.model);
  // The words read each hull's clock at eye level.
  const rose = e => roseFor(e, 0);
  const shotsOf = e => Object.fromEntries(Object.entries(rose(e) ?? {}).map(([b, v]) => [b, v]));
  const words = matchupWords({ ...you.tank, shots: shotsOf(you) }, { ...them.tank, shots: shotsOf(them) });
  ui.headline.textContent = words.headline;
  const li = list => list.map(w => `<li>${esc(w)}</li>`).join('');
  ui.aim.innerHTML = `<li class="is-head">Where to aim</li>${li(words.aim)}`;
  ui.exposed.innerHTML = `<li class="is-head">What to keep away from them</li>${li(words.exposed)}`
    + li(faceTable(you.scene, you.price, you.tank.hp).slice(0, 1).map(f => `Your weakest face: ${f.name.toLowerCase()}, ${f.shots} shot${f.shots === 1 ? '' : 's'} for a square hit.`));
  ui.gunWords.innerHTML = li(words.guns);
  ui.hullWords.innerHTML = li(words.hulls) || (sheet ? '' : '<li>Driving numbers are not measured for this mod yet.</li>');
  drawClocks();
  drawGuns();
  drawDrive();
  drawSteady();
  resizeStage();
  root.classList.remove('is-loading');
  window.__tankSchool.ready = true;
}

drawMods();
drawLegend();
setBearing(30, { animate: false });
window.__tankSchool = { arenas, get arena() { return arena.map; }, get yours() { return yours()?.template; }, get theirs() { return theirs()?.template; },
  get entries() { return current.entries.map(e => e.tank); }, roseFor: (i, el = 0) => roseFor(current.entries[i], el), stage, ready: false };
say(`Loading the ${prettyTank(yours()?.template)} and the ${prettyTank(theirs()?.template)}`);
await refresh();
wait.hidden = true;
