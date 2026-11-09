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
import { GLTFLoader } from './glb-loader.js';
import { modelUrls } from './pose-bases.js';
import { modelFileStem } from './model-file.js';
import { VIEWER_ROOT } from './viewer-root.js';
import { loadMods, stored as storedMod, remember, trees, treeOf, VANILLA } from './mods.js';
import { arenasFrom, tankIn, enemyOf, prettyTank, mainGunName, pickMainGun } from './tank-arena.js';
import { gunOf, reach, degreesPer100, dropAt, timeTo, elevationFor } from './tank-ballistics.js';
import { BANDS, IMMUNE, CATCHER, bandOf, faceName, pricer, collisionFaces, bearingShots, faceTable, angleModOf } from './tank-armour.js';
import { matchupWords, missAt, steadyWords, NO_ANSWER, hurtsAtAll, answers, sayShots } from './tank-words.js';
import { snapshots } from './tank-snapshots.js';
import { decodePlayerName } from './vehicle-players.js';
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

/** The tree's AI data (`vehicles`), which says what a tank is; null where
 *  the tree has none. Read once per tree. */
const aiOf = new Map();
function vehicleAi(m) {
  if (!aiOf.has(m.id)) aiOf.set(m.id, json(`${m.paths.maps}/_shared/vehicle-ai.json`).then(d => d?.vehicles ?? null).catch(() => null));
  return aiOf.get(m.id);
}
async function arenasOf(m) {
  const [rows, levels, ai] = await Promise.all([json(`${m.paths.models}/models.json`), json(`${m.paths.maps}/maps.json`).catch(() => null), vehicleAi(m)]);
  return arenasFrom(rows, levels ? levels.map(l => l.name) : null, ai);
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

// --- a tank's model, with its download's progress ----------------------------------

/** A tank's own model, by template, from the arena's tree then vanilla's (a
 *  mod's tree holds only what it adds), as `plane-models.js` looks it up,
 *  but loaded here so the page can show its bytes arriving. Drawn as the
 *  level would draw it: effects, tracer and round bodies hidden. Loaded once. */
let gltfLoader = null;
const modelCache = new Map();
function loadTankModel(template, onProgress) {
  const key = `${arenaMod.id}/${template}`.toLowerCase();
  if (modelCache.has(key)) { onProgress?.(1, 1, true); return modelCache.get(key); }
  const promise = (async () => {
    gltfLoader ??= new GLTFLoader();
    for (const url of modelUrls(arenaMod.paths.models, `${modelFileStem(template)}.glb`)) {
      try {
        const gltf = await new Promise((resolve, reject) => gltfLoader.load(url, resolve,
          e => onProgress?.(e.loaded, e.lengthComputable ? e.total : 0, false), reject));
        gltf.scene.traverse(o => {
          const d = o.userData ?? {};
          if (d.effect || d.tracerMesh || d.projectileMesh || d.projectileTrail || d.isCollision) o.visible = false;
        });
        onProgress?.(1, 1, true);
        return gltf.scene;
      } catch { /* the next tree */ }
    }
    return null;
  })();
  modelCache.set(key, promise);
  promise.then(scene => { if (!scene) modelCache.delete(key); });
  return promise;
}

// --- a tank, read off its model -------------------------------------------------

/** A tank's numbers from its glb: hit points, the main gun, the turret. */
function readTank(template, scene, row, ai = null) {
  let critical = null, hp = Number(row?.hitpoints) || null;
  const wanted = mainGunName(row, ai);
  const fireArms = [];
  scene.traverse(o => {
    const d = o.userData ?? {};
    if (d.armor && typeof d.armor === 'object' && !(hp && critical)) {
      hp = Number(d.armor.hitpoints) || hp;
      critical = Number(d.armor.criticalDamage) || critical;
    }
    if (d.templateKind === 'FireArms') fireArms.push(o);
  });
  const gun = pickMainGun(fireArms, wanted);
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
    gunNode: gun?.name ?? null,
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
  fights: svgIcon('<path d="M2.5 16h7l1.5-2.5h3v2.5"/><path d="M14.5 16h7" class="is-thin"/><path d="M11 13.5V11h5" class="is-thin"/><path d="M5 9l3-3M19 9l-3-3" class="is-alt"/>'),
};

const root = document.createElement('div');
root.className = 'dfs tks';
root.innerHTML = `
  <aside class="dfs-side">
    <nav class="dfs-rail" aria-label="School">
      <a class="dfs-brand-sigil" href="${RANGE_HOME}" title="The Range"><img src="${LOGO}" alt="The Range" width="32" height="32"></a>
      <div class="dfs-sections" role="group" aria-label="School sections">
        <button type="button" class="dfs-rail-btn" data-view="matchup" aria-pressed="true" title="Matchup: any two tanks">${ICON.matchup}<span>Matchup</span></button>
        <button type="button" class="dfs-rail-btn" data-view="fights" aria-pressed="false" title="Fights: real tank battles from the recordings">${ICON.fights}<span>Fights</span></button>
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
  <main class="tks-main tks-fights" hidden>
    <header class="tks-head">
      <small class="mm-eyebrow">From the recordings</small>
      <h1>Real tank fights</h1>
      <p class="tks-headline tks-fights-lead">Tank against tank, found in the rounds players uploaded: the longest kill shots first, lifted when a lighter tank beat a heavier one and when both started at full health.</p>
    </header>
    <div class="tks-fight-bar">
      <span class="tks-seg" role="radiogroup" aria-label="Which fights">
        <button type="button" data-filter="all">All</button><button type="button" data-filter="kills">Kills</button><button type="button" data-filter="upsets">Light beats heavy</button><button type="button" data-filter="full">Both at full health</button>
      </span>
      <span class="tks-seg" role="radiogroup" aria-label="Order">
        <button type="button" data-sort="score">Best</button><button type="button" data-sort="range">Longest shot</button><button type="button" data-sort="date">Newest</button>
      </span>
      <button type="button" class="tks-toggle" data-allmods aria-pressed="false" title="Fights from every game and mod, not only this one">Every mod</button>
      <span class="tks-fight-count"></span>
    </div>
    <ol class="tks-fight-list" role="list"></ol>
    <button type="button" class="tks-toggle tks-fight-more" hidden>Show more</button>
    <footer class="tks-foot">Found by <code>extract_tank_fights.mjs</code> (<code>viewer/tank-fights-detect.js</code>) in every public recording. A client recording sees only what was near its player, so a fight far from them is missing, and a hit is known by the hull's hit points falling. Notes: <code>features/battle-schools</code>.</footer>
  </main>
  <main class="tks-main tks-board">
    <header class="tks-head">
      <small class="mm-eyebrow">Matchup</small>
      <h1><span class="tks-you-name"></span> <i>against</i> <span class="tks-them-name"></span></h1>
      <p class="tks-headline"></p>
    </header>
    <section class="tks-card tks-armour" aria-labelledby="tks-h-armour">
      <header class="tks-card-head"><small>01</small><h2 id="tks-h-armour">Where to aim, where you are exposed</h2></header>
      <div class="tks-stage">
        <canvas class="tks-canvas"></canvas>
        <div class="tks-stage-tags"><span class="is-them">THEIRS<small>shots of your gun</small><em class="tks-warn" hidden></em></span><span class="is-you">YOURS<small>shots of their gun</small><em class="tks-warn" hidden></em></span></div>
        <div class="tks-tip" hidden></div>
        <div class="tks-load" role="status" aria-live="polite" hidden><small>Loading</small><div class="tks-load-rows"></div></div>
        <div class="tks-view" role="group" aria-label="Seen from">
          <span class="tks-seg" role="radiogroup" aria-label="Bearing">
            <button type="button" data-bearing="0">Front</button><button type="button" data-bearing="45">45</button><button type="button" data-bearing="90">Side</button><button type="button" data-bearing="135">135</button><button type="button" data-bearing="180">Rear</button>
          </span>
          <button type="button" class="tks-toggle" data-toggle="above" aria-pressed="false" title="Look from 20 degrees above: the roofs show">From above</button>
          <span class="tks-seg" role="radiogroup" aria-label="Show">
            <button type="button" data-show="overlay" title="The hit faces painted over the tanks' own models">Overlay</button><button type="button" data-show="faces" title="The hit faces alone">Faces</button><button type="button" data-show="model" title="The tanks' own models">Model</button>
          </span>
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
    <section class="tks-card tks-guns" aria-labelledby="tks-h-guns">
      <header class="tks-card-head"><small>02</small><h2 id="tks-h-guns">The guns: how far up to aim</h2></header>
      <p class="tks-intro">A tank shell drops, so to hit a tank further away the gun points higher. Each tank below is drawn to scale with its gun at the angle each distance needs; the line for the target is lit. Under them, what each gunner sees: the cross is where the gun points, and it has to sit that far above the target.</p>
      <label class="tks-range"><span>Target at</span><input type="range" min="50" max="400" step="10" value="200"><b></b></label>
      <div class="tks-lanes"></div>
      <div class="tks-sights"></div>
      <ul class="tks-words tks-gun-words"></ul>
      <details class="tks-more"><summary>All the gun numbers</summary><table class="tks-table tks-gun-table"></table></details>
    </section>
    <section class="tks-card tks-steady" aria-labelledby="tks-h-steady">
      <header class="tks-card-head"><small>03</small><h2 id="tks-h-steady">How steady the hull is</h2></header>
      <p class="tks-intro">A tank sits on springs, and the gun is bolted to the hull: when the hull rocks, the gun rocks with it. Both tanks below are their own models, rocking exactly as the game's tank law rocks them. The dashed line is where the gun was aimed; the solid line is where it points now.</p>
      <div class="tks-steady-bar">
        <span class="tks-seg" role="radiogroup" aria-label="What the hull does">
          <button type="button" data-scenario="hardStop">Hard stop</button><button type="button" data-scenario="coast">Let go at speed</button><button type="button" data-scenario="fireAhead">Fire ahead</button><button type="button" data-scenario="fireAcross">Fire across</button>
        </span>
        <button type="button" class="tks-play" title="Play it">${ICON.play}<span>Play</span></button>
        <input class="tks-scrub" type="range" min="0" max="10" step="0.0667" value="0" aria-label="Time">
        <b class="tks-clock-now">0.0 s</b>
      </div>
      <div class="tks-rockers"><figure class="is-you"><svg></svg><figcaption></figcaption></figure><figure class="is-them"><svg></svg><figcaption></figcaption></figure></div>
      <ul class="tks-words tks-steady-words"></ul>
      <svg class="tks-trace" viewBox="0 0 560 150" role="img" aria-label="The hull's swing over time"></svg>
      <p class="tks-steady-note"></p>
    </section>
    <section class="tks-card tks-drive" aria-labelledby="tks-h-drive">
      <header class="tks-card-head"><small>04</small><h2 id="tks-h-drive">The drive</h2></header>
      <table class="tks-table tks-drive-table"></table>
      <ul class="tks-words tks-hull-words"></ul>
    </section>
    <footer class="tks-foot">Every number is the game's own: the damage tables from <code>Game.rfa</code>, each gun's <code>Weapons.con</code>, the tanks' collision faces, and the server's per-tick tank law driven in node (<code>surveys/tank_school_sheet.mjs</code>). Notes: <code>features/battle-schools</code>.</footer>
  </main>`;
document.body.appendChild(root);
const q = sel => root.querySelector(sel);
const ui = {
  modNow: q('.dfs-mod-now'), modList: q('.dfs-mod-list'), modNote: q('.dfs-mod-note'),
  arenaNow: q('.dfs-arena-now'), arenaList: q('.dfs-arena-list'),
  yoursList: q('.tks-pick[data-pick="yours"] .dfs-plane-list'), theirsList: q('.tks-pick[data-pick="theirs"] .dfs-plane-list'),
  youName: q('.tks-you-name'), themName: q('.tks-them-name'), headline: q('.tks-board .tks-headline'),
  canvas: q('.tks-canvas'), stage: q('.tks-stage'), load: q('.tks-load'), loadRows: q('.tks-load-rows'), tip: q('.tks-tip'), view: q('.tks-view'), legend: q('.tks-legend'),
  clockThem: q('.tks-clock.is-them > div'), clockYou: q('.tks-clock.is-you > div'),
  aim: q('.tks-aim'), exposed: q('.tks-exposed'),
  lanes: q('.tks-lanes'), sights: q('.tks-sights'), range: q('.tks-range input'), rangeOut: q('.tks-range b'), gunTable: q('.tks-gun-table'), gunWords: q('.tks-gun-words'),
  scrub: q('.tks-scrub'), clockNow: q('.tks-clock-now'), steadyWords: q('.tks-steady-words'),
  driveTable: q('.tks-drive-table'), hullWords: q('.tks-hull-words'),
  scenarios: q('.tks-steady .tks-seg'), play: q('.tks-play'), rockers: [...root.querySelectorAll('.tks-rockers figure')],
  trace: q('.tks-trace'), steadyNote: q('.tks-steady-note'), listToggle: q('.dfs-list-toggle'),
  board: q('.tks-board'), fights: q('.tks-fights'), fightList: q('.tks-fight-list'), fightCount: q('.tks-fight-count'), fightMore: q('.tks-fight-more'),
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
  ui.arenaNow.querySelector('small').textContent = arena.every ? `any two of ${arena.tanks.length} tanks`
    : `${arena.allied.map(t => prettyTank(t.template)).join(', ')} v ${arena.axis.map(t => prettyTank(t.template)).join(', ')}`;
  ui.arenaList.innerHTML = arenas.map(a => `<button type="button" role="radio" data-arena="${esc(a.map)}" aria-checked="${a === arena}">`
    + `<b>${esc(a.name)}</b><small>${a.every ? `${a.tanks.length} tanks` : `${esc(a.allied.map(t => prettyTank(t.template)).join(', '))} v ${esc(a.axis.map(t => prettyTank(t.template)).join(', '))}`}</small>`
    + `<small class="tks-battles">${a.every ? 'any two of them, wherever they fight' : `${esc(a.battles.slice(0, 4).join(', '))}${a.battles.length > 4 ? ` and ${a.battles.length - 4} more` : ''}`}</small></button>`).join('');
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
  bearing: 0, shown: 0, above: false, show: 'overlay',
  pair: [], // [{ group, painted: [mesh], visual: [mesh], tank, price }] theirs first, then yours
};
/** The hit faces draw on a layer of their own, over the models: the model
 *  first, then the depth cleared, then the faces (`draw`). */
const FACES = 1;
const hemi = new THREE.HemisphereLight(0xf2f0e6, 0x3a3a32, 2.4);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 8);
for (const light of [hemi, sun]) { light.layers.enableAll(); stage.scene.add(light); }
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
const caughtBy = o => { for (let a = o; a; a = a.parent) if (CATCHER.test(a.name ?? '')) return true; return false; };
function stageTank(scene, price, hp) {
  const group = new THREE.Group();
  const model = scene.clone(true);
  const painted = [], visual = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry?.userData?.collision && caughtBy(o)) { o.visible = false; return; }
    if (o.geometry?.userData?.collision) {
      const material = Number(o.geometry.userData.defenseMaterial);
      const damage = price(material);
      const band = bandOf(shotsFor(hp, damage));
      // Flat-shaded so each plate reads as a plate, with a share of its own
      // colour as glow so a band stays its colour in the shade.
      o.material = new THREE.MeshLambertMaterial({ color: band.color, emissive: band.color, emissiveIntensity: 0.32, flatShading: true, side: THREE.DoubleSide });
      o.userData.face = { material, damage, shots: shotsFor(hp, damage), band };
      o.visible = true;
      o.layers.set(FACES);
      painted.push(o);
      // Edges on a coarse hull (vanilla's, a hundred-odd triangles) mark its
      // plates; on a detailed one (a mod's, thousands) they are only noise.
      const tris = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      if (tris <= 300) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), new THREE.LineBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.6 }));
        edges.userData.edge = true;
        edges.layers.set(FACES);
        o.add(edges);
      }
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
  // The drawn model's box, and only the faces in or next to it: a face far
  // outside is a part the tank carries for something else.
  const seen = new THREE.Box3();
  for (const m of visual) if (shown(m)) seen.expandByObject(m);
  const near = seen.isEmpty() ? null : seen.clone().expandByScalar(1.5);
  const box = new THREE.Box3();
  for (const m of painted) {
    if (!shown(m)) continue;
    const mb = new THREE.Box3().setFromObject(m);
    if (near && !near.intersectsBox(mb)) { m.visible = false; m.userData.far = true; continue; }
    box.expandByObject(m);
  }
  if (box.isEmpty()) box.copy(seen.isEmpty() ? new THREE.Box3().setFromObject(model) : seen);
  model.position.y -= box.min.y + 1.2;
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  group.add(model);
  return { group, painted, visual, size: box.getSize(new THREE.Vector3()) };
}

/** What the stage shows: `overlay`, the hit faces laid over the models (the
 *  first view: the regions read on the tank a player knows); `faces`, the
 *  faces alone, opaque; `model`, the models alone. */
function setShow(show) {
  stage.show = show;
  const overlay = show === 'overlay';
  for (const t of stage.pair) {
    for (const m of t.painted) {
      m.visible = show !== 'model' && !m.userData.far;
      m.material.transparent = overlay;
      m.material.opacity = overlay ? 0.62 : 1;
      m.material.needsUpdate = true;
    }
    for (const m of t.visual) for (const mat of [m.material].flat()) mat.visible = show !== 'faces';
  }
  root.querySelectorAll('[data-show]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.show === show)));
  ui.legend.classList.toggle('is-off', show === 'model');
  ui.tip.hidden = true;
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
  const r = stage.renderer;
  r.autoClear = false;
  r.clear();
  stage.camera.layers.set(0);
  r.render(stage.scene, stage.camera);
  if (stage.show !== 'model') {
    // Laid over: the faces are drawn whatever the model's depth, testing
    // only against each other, so a plate shows on the tank it belongs to
    // even where the model's own skin stands a few centimetres proud of it.
    if (stage.show === 'overlay') r.clearDepth();
    stage.camera.layers.set(FACES);
    r.render(stage.scene, stage.camera);
  }
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
  if (b.dataset.show) setShow(b.dataset.show);
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
picker.layers.set(FACES);
function readFace(e) {
  if (stage.show === 'model' || !stage.pair.length) { ui.tip.hidden = true; return; }
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
    ? `<small>${whose} · ${esc(faceName(f.material, tables))}</small><b>${n1(f.damage)} a square hit from ${gunOwner} gun · ${f.shots} shot${f.shots === 1 ? '' : 's'}</b>`
      + `<span>From here, ${Math.round(Math.acos(Math.min(1, Math.abs(normal.dot(dir)))) * 180 / Math.PI)} deg off square: ${n1(damage)}, ${shotsFor(owner.tank.hp, damage)} shots</span>`
    : `<small>${whose} · ${esc(faceName(f.material, tables))}</small><b>${gunOwner === 'your' ? 'Your' : 'Their'} gun does nothing here</b>`;
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
      + `<text x="${(C + rm * Math.cos(mid)).toFixed(1)}" y="${(C + rm * Math.sin(mid) + 4).toFixed(1)}">${shots == null ? '-' : shots > NO_ANSWER ? `${NO_ANSWER}+` : shots}</text>`;
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

const FAN = [100, 200, 300, 400];
const deg = r => r * 180 / Math.PI;

/** One tank side-on, to scale, with its gun drawn at the elevation each
 *  distance needs (true angles), the target's lit. */
function laneSvg(entry, R, who) {
  const snap = entry.snaps.side;
  const gun = entry.tank.gun;
  const L = 330;
  const lines = [...new Set([...FAN, R])].sort((a, b) => a - b).map(d => ({ d, e: elevationFor(gun, d, { maxElevation: gun.up }), lit: d === R }));
  const reachable = lines.filter(l => l.e != null);
  const top = Math.min(0, ...reachable.map(l => snap.pivot.y - L * Math.sin(l.e * Math.PI / 180) - 22 - 18 * reachable.length));
  const W = snap.width + L + 130, H = Math.max(snap.height, snap.pivot.y + 20) - top;
  let svg = `<line class="tks-ground" x1="0" y1="${snap.groundY}" x2="${W}" y2="${snap.groundY}"/>`
    + `<image href="${snap.url}" x="0" y="0" width="${snap.width}" height="${snap.height}"/>`
    + `<line class="tks-bore" x1="${snap.pivot.x}" y1="${snap.pivot.y}" x2="${snap.pivot.x + L}" y2="${snap.pivot.y}"/>`
    + `<text class="tks-fan-label is-level" x="${snap.pivot.x + L + 6}" y="${snap.pivot.y + 4}">level</text>`;
  // Labels kept at least 13 px apart, pushed up from the flattest.
  let lastY = Infinity;
  for (const l of reachable) {
    const a = l.e * Math.PI / 180;
    const x = snap.pivot.x + L * Math.cos(a), y = snap.pivot.y - L * Math.sin(a);
    const ly = Math.min(y + 5, lastY - 18);
    lastY = ly;
    if (!FAN.includes(l.d) && !l.lit) continue;
    svg += `<line class="tks-fan${l.lit ? ' is-lit' : ''}" x1="${snap.pivot.x}" y1="${snap.pivot.y}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`
      + `<text class="tks-fan-label${l.lit ? ' is-lit' : ''}" x="${(x + 6).toFixed(1)}" y="${ly.toFixed(1)}">${l.d} m  ${l.e.toFixed(1)}&#176;</text>`;
  }
  const lit = lines.find(l => l.lit);
  const drop = dropAt(gun, R);
  const targetH = entry.target.snaps.side.heightM;
  const caption = lit?.e == null
    ? `<b>${esc(entry.tank.name)}</b> cannot reach ${R} m: the gun lifts only ${n1(gun.up)} deg.`
    : `<b>${esc(entry.tank.name)}</b> to hit at ${R} m: gun <em>${lit.e.toFixed(1)} deg</em> up. `
      + `Aimed straight at the target, the shell drops ${n1(drop)} m on the way, ${n1(drop / targetH)} times the ${esc(entry.target.tank.name)}'s height.`;
  return `<figure class="tks-lane ${who}"><svg viewBox="0 ${top.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" role="img" aria-label="${esc(entry.tank.name)}: gun angle for each distance">${svg}</svg><figcaption>${caption}</figcaption></figure>`;
}

/** What the gunner sees at R m: the target at its true size against a window
 *  of a few degrees, and the cross where the gun must point. */
function sightSvg(entry, R, who) {
  const gun = entry.tank.gun;
  const e = elevationFor(gun, R, { maxElevation: gun.up });
  const tgt = entry.target.snaps.front;
  const W = 320, H = 230;
  const tH = deg(Math.atan(tgt.heightM / R));
  const span = Math.max((e ?? gun.up) + tH * 2 + 2.5, 5);   // degrees, top to bottom
  const k = H / span;                                         // px a degree
  const s = (deg(Math.atan(1 / R)) * k) / tgt.pxPerM;         // image px -> window px
  const cx = W / 2, cy = H - 22 - (tH / 2) * k;               // the target's middle
  const iw = tgt.width * s, ih = tgt.height * s;
  const ix = cx - tgt.middle.x * s, iy = cy - tgt.middle.y * s;
  let svg = `<rect class="tks-sight-sky" x="0" y="0" width="${W}" height="${H}"/>`
    + `<line class="tks-sight-horizon" x1="0" y1="${(cy + (tH / 2) * k).toFixed(1)}" x2="${W}" y2="${(cy + (tH / 2) * k).toFixed(1)}"/>`
    + `<image href="${tgt.url}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}"/>`
    + `<path class="tks-sight-bracket" d="M${cx - iw / 2 - 5} ${cy - ih / 2 - 3}h-4v${ih + 6}h4M${cx + iw / 2 + 5} ${cy - ih / 2 - 3}h4v${ih + 6}h-4"/>`;
  if (e != null) {
    const ay = cy - e * k;
    svg += `<line class="tks-sight-gap" x1="${cx}" y1="${(cy - 4).toFixed(1)}" x2="${cx}" y2="${(ay + 9).toFixed(1)}"/>`
      + `<path class="tks-sight-cross" d="M${cx - 14} ${ay}h10M${cx + 4} ${ay}h10M${cx} ${ay - 14}v10M${cx} ${ay + 4}v10"/>`
      + `<text class="tks-sight-label" x="${cx + 20}" y="${(ay + 4).toFixed(1)}">aim here: ${e.toFixed(1)}&#176; above</text>`
      + `<text class="tks-sight-label is-dim" x="${cx + 20}" y="${(cy + 4).toFixed(1)}">the ${esc(entry.target.tank.name)}, ${R} m</text>`;
  } else {
    svg += `<text class="tks-sight-label" x="${cx}" y="30" text-anchor="middle">out of reach</text>`;
  }
  const head = who === 'is-you' ? 'Through your sight' : 'Through their sight';
  return `<figure class="tks-sight ${who}"><figcaption><b>${head}</b><span>${esc(entry.tank.name)} at the ${esc(entry.target.tank.name)}, ${R} m. The window is ${n1(span)} deg tall.</span></figcaption>`
    + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(head)}">${svg}</svg></figure>`;
}

function drawGuns() {
  const [them, you] = current.entries;
  const R = Number(ui.range.value);
  ui.rangeOut.textContent = `${R} m`;
  const pair = [{ who: 'is-you', e: { ...you, target: them } }, { who: 'is-them', e: { ...them, target: you } }];
  ui.lanes.innerHTML = pair.map(p => laneSvg(p.e, R, p.who)).join('');
  ui.sights.innerHTML = pair.map(p => sightSvg(p.e, R, p.who)).join('');
  const guns = [{ who: 'is-you', t: you.tank }, { who: 'is-them', t: them.tank }];
  const row = (label, f, hint = '') => `<tr><th scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${guns.map(g => `<td class="${g.who}">${f(g.t)}</td>`).join('')}</tr>`;
  ui.gunTable.innerHTML = `<thead><tr><th></th><th class="is-you">${esc(you.tank.name)}<small>yours</small></th><th class="is-them">${esc(them.tank.name)}<small>theirs</small></th></tr></thead><tbody>`
    + row('Muzzle speed', t => `${n1(t.gun.speed)} m/s`)
    + row('Gravity on the shell', t => (t.gun.gravity === 1 ? 'full' : `${n1(t.gun.gravity * 100)}%`))
    + row(`Gun up to hit at ${R} m`, t => { const e = elevationFor(t.gun, R, { maxElevation: t.gun.up }); return e == null ? 'out of reach' : `${n1(e)} deg`; })
    + row(`Drop by ${R} m, aimed level`, t => `${n1(dropAt(t.gun, R))} m`)
    + row('Rule of thumb', t => (t.gun.per100 ? `about ${t.gun.per100} deg up per 100 m` : '-'))
    + row(`Flight to ${R} m`, t => `${n1(timeTo(t.gun, R))} s`)
    + row('Furthest it reaches', t => `${Math.round(t.gun.reach.range)} m, gun at +${n1(t.gun.up)} deg`, 'on flat ground')
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
  hardStop: 'Full throttle, then full reverse until the tank stops, then hands off: the nose dips and the hull rocks on its springs.',
  coast: 'Full throttle, then the throttle let go: a gentler stop, a smaller rock.',
  fireAhead: 'The main gun fired straight ahead at rest: the shove of the shot rocks the hull back.',
  fireAcross: 'The main gun turned across the hull and fired, at rest: the shot rolls the hull away from it (seen from behind, the gun pointing right).',
};
let scenario = 'hardStop';
let playing = null;
let steadyT = 0;

/** One hull rocking at time t: its own picture turned by the trace about its
 *  middle, the gun's line turning with it against the dashed line it was
 *  laid on. */
function rockerSvg(entry, tr, t) {
  const roll = tr.axis === 'roll';
  const snap = roll ? entry.snaps.rear : entry.snaps.side;
  const v = tr.values[Math.min(tr.values.length - 1, Math.round(t * tr.hz))] ?? 0;
  const L = 300;
  const pv = roll ? { x: snap.middle.x, y: snap.pivot.y } : snap.pivot;
  const W = snap.width + L + 20, top = -34, H = snap.height + 64;
  const g = `<g transform="rotate(${(-v).toFixed(2)} ${snap.middle.x.toFixed(1)} ${snap.middle.y.toFixed(1)})">`
    + `<image href="${snap.url}" x="0" y="0" width="${snap.width}" height="${snap.height}"/>`
    + `<line class="tks-aimline" x1="${pv.x}" y1="${pv.y}" x2="${pv.x + L}" y2="${pv.y}"/></g>`;
  return { v, svg: `<svg viewBox="0 ${top} ${W} ${H}" role="img" aria-label="${esc(entry.tank.name)} rocking">`
    + `<line class="tks-ground" x1="0" y1="${snap.groundY}" x2="${W}" y2="${snap.groundY}"/>`
    + `<line class="tks-laid" x1="${pv.x}" y1="${pv.y}" x2="${pv.x + L}" y2="${pv.y}"/>${g}</svg>` };
}

function drawSteady(t = steadyT) {
  steadyT = t;
  const [them, you] = current.entries;
  ui.scenarios.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.scenario === scenario)));
  const pair = [{ who: 'is-you', e: you }, { who: 'is-them', e: them }];
  const traces = pair.map(p => p.e.tank.sheet?.traces?.[scenario] ?? null);
  const sums = pair.map(p => p.e.tank.sheet?.steady?.[scenario] ?? null);
  ui.steadyNote.textContent = SCENARIO_WORDS[scenario];
  if (!traces[0] && !traces[1]) {
    ui.trace.innerHTML = `<text class="tks-tick" x="280" y="80">Not measured for this mod yet</text>`;
    ui.steadyWords.innerHTML = '';
    for (const f of ui.rockers) { f.querySelector('svg').outerHTML = '<svg></svg>'; f.querySelector('figcaption').textContent = ''; }
    return;
  }
  const any = traces.find(Boolean);
  const dur = Math.max(...traces.map(x => (x ? (x.values.length - 1) / x.hz : 0)));
  ui.scrub.max = String(dur);
  ui.scrub.value = String(t);
  ui.clockNow.textContent = `${t.toFixed(1)} s`;
  pair.forEach((p, k) => {
    const f = ui.rockers[k];
    const tr = traces[k];
    if (!tr) { f.querySelector('svg').outerHTML = '<svg></svg>'; f.querySelector('figcaption').innerHTML = `<b>${esc(p.e.tank.name)}</b><span>not measured</span>`; return; }
    const r = rockerSvg(p.e, tr, t);
    f.querySelector('svg').outerHTML = r.svg;
    const what = tr.axis === 'roll' ? `rolled ${n1(Math.abs(r.v))} deg` : Math.abs(r.v) < 0.05 ? 'level' : `nose ${n1(Math.abs(r.v))} deg ${r.v < 0 ? 'down' : 'up'}`;
    const miss = Math.round(missAt(r.v, 200));
    f.querySelector('figcaption').innerHTML = `<b>${esc(p.e.tank.name)}</b><span class="tks-now-v">${what}</span>`
      + `<span class="tks-now-miss${miss >= 3 ? ' is-off' : ''}">a shot now lands ${miss} m off at 200 m</span>`;
  });
  ui.steadyWords.innerHTML = (current.hullAdvice ?? []).map(w => `<li>${esc(w)}</li>`).join('')
    + pair.map((p, k) => steadyWords(p.e.tank.name, traces[k], sums[k], { reload: p.e.tank.gun.reload })
      .map(w => `<li class="${p.who}">${esc(w)}</li>`).join('')).join('');
  // The trace, small, under the picture.
  const hz = any.hz;
  const len = Math.max(...traces.map(x => x?.values.length ?? 0));
  const peak = Math.max(2, ...traces.flatMap(x => (x ? x.values.map(Math.abs) : [])));
  const W = 560, H = 150, L = 40, Rt = 10, T = 10, B = 22;
  const sx = i => L + (i / Math.max(1, len - 1)) * (W - L - Rt), sy = v => T + (peak - v) / (2 * peak) * (H - T - B);
  let svg = `<rect class="tks-band" x="${L}" y="${sy(1)}" width="${W - L - Rt}" height="${sy(-1) - sy(1)}"/>`
    + `<line class="tks-axis" x1="${L}" y1="${sy(0)}" x2="${W - Rt}" y2="${sy(0)}"/>`
    + `<text class="tks-tick is-y" x="${L - 6}" y="${sy(peak) + 4}">+${Math.round(peak)}&#176;</text><text class="tks-tick is-y" x="${L - 6}" y="${sy(-peak) + 4}">-${Math.round(peak)}&#176;</text>`
    + `<text class="tks-tick is-band" x="${W - Rt - 4}" y="${sy(1) - 4}">within 1&#176;: 3.5 m off at 200 m</text>`;
  for (let s2 = 0; s2 <= (len - 1) / hz; s2 += 2) svg += `<text class="tks-tick" x="${sx(s2 * hz)}" y="${H - 5}">${s2} s</text>`;
  pair.forEach((p, k) => {
    const tr = traces[k];
    if (tr) svg += `<path class="tks-line ${p.who}" d="${tr.values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join('')}"/>`;
  });
  svg += `<line class="tks-now" x1="${sx(t * hz)}" y1="${T}" x2="${sx(t * hz)}" y2="${H - B}"/>`;
  ui.trace.innerHTML = svg;
}
ui.scenarios.addEventListener('click', e => {
  const b = e.target.closest('button[data-scenario]');
  if (!b) return;
  scenario = b.dataset.scenario;
  stopPlay();
  drawSteady(0);
  play();
});
ui.scrub.addEventListener('input', () => { stopPlay(); drawSteady(Number(ui.scrub.value)); });
function stopPlay() {
  if (playing) cancelAnimationFrame(playing.raf);
  playing = null;
  ui.play.classList.remove('is-playing');
}
function play() {
  stopPlay();
  const dur = Number(ui.scrub.max) || 0;
  if (!dur) return;
  const from = steadyT >= dur - 0.05 ? 0 : steadyT;
  const t0 = performance.now() - from * 1000;
  ui.play.classList.add('is-playing');
  // One run at a time: a run started over another (the panel scrolled into
  // view while playing) leaves the old loop's frames to end on their own.
  const run = { raf: 0 };
  playing = run;
  const tick = now => {
    if (playing !== run) return;
    const t = (now - t0) / 1000;
    if (t > dur) { stopPlay(); drawSteady(dur); return; }
    drawSteady(t);
    run.raf = requestAnimationFrame(tick);
  };
  run.raf = requestAnimationFrame(tick);
}
ui.play.addEventListener('click', () => { if (playing) stopPlay(); else play(); });
// The first time the panel comes into view after a pairing loads, it plays.
let playOnSight = false;
new IntersectionObserver(seen => {
  if (seen.some(x => x.isIntersecting) && playOnSight && current.entries.length) { playOnSight = false; drawSteady(0); play(); }
}, { threshold: 0.35 }).observe(q('.tks-steady'));

// --- loading a pairing ------------------------------------------------------------------

const MB = b => (b / 1048576).toFixed(b < 1048576 * 10 ? 1 : 0);
/** The loading card over the stage: a row per tank with its bytes and a bar
 *  (a sweep when the size is not known: a gzipped answer has none), then the
 *  measuring step. A later pairing's card replaces it. */
function showLoading(ticket, tanks) {
  ui.load.hidden = false;
  ui.load.classList.remove('is-failed');
  ui.load.querySelector('small').textContent = 'Loading';
  ui.loadRows.innerHTML = tanks.map((t, i) => `<div class="tks-load-row ${i ? 'is-you' : 'is-them'}" data-i="${i}"><b>${esc(prettyTank(t.template))}</b>`
    + `<span class="tks-load-bytes">waiting</span><i class="tks-load-bar is-sweep"><i></i></i></div>`).join('');
  const live = () => ticket === current.ticket;
  return {
    progress: i => (loaded, total, done) => {
      if (!live()) return;
      const row = ui.loadRows.querySelector(`[data-i="${i}"]`);
      if (!row) return;
      const bar = row.querySelector('.tks-load-bar');
      if (done) {
        row.classList.add('is-done');
        row.querySelector('.tks-load-bytes').textContent = 'loaded';
        bar.classList.remove('is-sweep');
        bar.firstElementChild.style.width = '100%';
        return;
      }
      // The glb's bytes, then its textures (fetched from the shared store
      // after it), which the loader does not count.
      row.querySelector('.tks-load-bytes').textContent = total
        ? (loaded >= total ? `${MB(total)} MB, then its textures` : `${MB(loaded)} of ${MB(total)} MB`)
        : `${MB(loaded)} MB`;
      bar.classList.toggle('is-sweep', !total);
      if (total) bar.firstElementChild.style.width = `${Math.round(loaded / total * 100)}%`;
    },
    step: text => { if (live()) ui.load.querySelector('small').textContent = text; },
    fail: e => { if (!live()) return; ui.load.classList.add('is-failed'); ui.load.querySelector('small').textContent = `Did not load: ${e?.message ?? e}`; },
    done: () => { if (live()) ui.load.hidden = true; },
  };
}

const current = { entries: [], ticket: 0 };
const snapCache = new Map();

async function loadEntry(t, attacker, onProgress) {
  const scene = await loadTankModel(t.template, onProgress);
  if (!scene) throw new Error(`${t.template}: no model`);
  const ai = await vehicleAi(arenaMod);
  const tank = readTank(t.template, scene, t.row, ai);
  if (!snapCache.has(t.template)) snapCache.set(t.template, snapshots(scene, { gunName: tank.gunNode }));
  return { key: `${t.template}<-${attacker.template}`, scene, tank, template: t.template, snaps: snapCache.get(t.template) };
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
  const loading = showLoading(ticket, [other, mine]);
  try {
    [them, you] = await Promise.all([loadEntry(other, mine, loading.progress(0)), loadEntry(mine, other, loading.progress(1))]);
  } catch (e) {
    console.warn('tank school', e);
    loading.fail(e);
    ui.headline.textContent = 'This tank\'s model did not load.';
    root.classList.remove('is-loading');
    return;
  }
  if (ticket !== current.ticket) return;
  // The faces are measured and the pictures drawn in one go: say so, and let
  // the card paint before the work starts.
  loading.step('Measuring the hit faces and drawing the tanks');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  if (ticket !== current.ticket) return;
  // Each hull priced by the other's shell.
  them.price = pricer(tables, you.tank.shellMaterial);
  you.price = pricer(tables, them.tank.shellMaterial);
  current.entries = [them, you];
  for (const t of stage.pair) stage.scene.remove(t.group);
  stage.pair = [them, you].map(e => ({ ...stageTank(e.scene, e.price, e.tank.hp), tank: e.tank }));
  for (const t of stage.pair) stage.scene.add(t.group);
  setShow(stage.show);
  // The words read each hull's clock at eye level.
  const rose = e => roseFor(e, 0);
  const shotsOf = e => Object.fromEntries(Object.entries(rose(e) ?? {}).map(([b, v]) => [b, v]));
  const youW = { ...you.tank, shots: shotsOf(you) }, themW = { ...them.tank, shots: shotsOf(them) };
  const words = matchupWords(youW, themW);
  ui.headline.textContent = words.headline;
  // A gun that does nothing is said on the stage, with why when the cause is
  // the data rather than the game (no tank gun found, a round the damage
  // table does not list), so a hole in the extraction is not read as armour.
  const why = (gunner, hull) => {
    if (gunner.shellMaterial == null) return `No tank gun was found on the ${gunner.name}: nothing to price.`;
    if (!tables?.materials?.[gunner.shellMaterial]) return `The ${gunner.name}'s round (material ${gunner.shellMaterial}) is not in the damage tables.`;
    if (!collisionFaces(hull.scene).length) return `The ${hull.tank.name} has no hit faces in its model.`;
    return null;
  };
  const warn = (el, hull, gunner, entry, none, scratch) => {
    const hurts = hurtsAtAll(hull), answer = answers(hull);
    const cause = hurts ? null : why(gunner, entry);
    el.hidden = answer;
    el.textContent = answer ? '' : cause ?? (hurts ? scratch : none);
    el.classList.toggle('is-data', Boolean(cause));
  };
  const [warnThem, warnYou] = root.querySelectorAll('.tks-warn');
  warn(warnThem, themW, you.tank, them, 'Your gun cannot hurt this tank', `Your gun barely scratches it: more than ${NO_ANSWER} hits from every side`);
  warn(warnYou, youW, them.tank, you, 'Their gun cannot hurt yours', `Their gun barely scratches yours: more than ${NO_ANSWER} hits from every side`);
  for (const [list, w] of [[words.aim, why(you.tank, them)], [words.exposed, why(them.tank, you)]]) {
    if (w && !hurtsAtAll(list === words.aim ? themW : youW)) list.splice(0, list.length, `${w} This is a gap in what was extracted, not the tank's armour.`);
  }
  const li = list => list.map(w => `<li>${esc(w)}</li>`).join('');
  ui.aim.innerHTML = `<li class="is-head">Where to aim</li>${li(words.aim)}`;
  ui.exposed.innerHTML = `<li class="is-head">What to keep away from them</li>${li(words.exposed)}`
    + li(faceTable(you.scene, you.price, you.tank.hp, tables).slice(0, 1).map(f => `Your weakest face: ${f.name.toLowerCase()}, ${sayShots(f.shots)} shot${f.shots === 1 ? '' : 's'} for a square hit.`));
  ui.gunWords.innerHTML = li(words.guns);
  // The peek belongs to the drive; the rest of the hull's words to its steadiness.
  ui.hullWords.innerHTML = li(words.hulls.filter(w => w.startsWith('The peek'))) || (sheet ? '' : '<li>Driving numbers are not measured for this mod yet.</li>');
  current.hullAdvice = words.hulls.filter(w => !w.startsWith('The peek'));
  drawClocks();
  drawGuns();
  drawDrive();
  stopPlay();
  drawSteady(0);
  playOnSight = true;
  resizeStage();
  root.classList.remove('is-loading');
  loading.done();
  window.__tankSchool.ready = true;
}

// --- the fights from the recordings -----------------------------------------------------

const fightState = { filter: 'all', sort: 'score', allMods: false, shown: 40, rows: null };
const levelName = l => String(l ?? '').replace(/_/g, ' ');
async function fightRows() {
  if (!fightState.rows) fightState.rows = await json('replays/tankfights/index.json').then(d => (Array.isArray(d) ? d : d?.fights ?? [])).catch(() => []);
  return fightState.rows;
}
/** The two tanks of a fight as a matchup: the winner's yours. */
function fightMatchupHref(f) {
  const next = new URL(location.href);
  next.searchParams.set('mod', f.mod || VANILLA.id);
  next.searchParams.set('arena', '*');
  const w = f.winner === 'b' ? [f.b, f.a] : [f.a, f.b];
  next.searchParams.set('yours', w[0].template);
  next.searchParams.set('theirs', w[1].template);
  next.searchParams.delete('view');
  return next.href;
}
const END_WORDS = { left: 'one of them got out', 'out of range': "out of the recorder's sight", apart: 'they drove apart',
  quiet: 'they stopped firing', 'downed by another': 'someone else finished it', died: 'one of them died' };
async function drawFights() {
  const all = await fightRows();
  let rows = all.filter(f => fightState.allMods || (f.mod || VANILLA.id) === treeOf(arenaMod));
  if (fightState.filter === 'kills') rows = rows.filter(f => f.killAt != null);
  if (fightState.filter === 'upsets') rows = rows.filter(f => f.upset);
  if (fightState.filter === 'full') rows = rows.filter(f => f.fullHpStart);
  const key = { score: f => -(f.score ?? 0), range: f => -(f.range ?? -1), date: f => -(Date.parse(f.date ?? 0) || 0) - (f.t0 ?? 0) / 1e6 }[fightState.sort];
  rows = [...rows].sort((a, b) => key(a) - key(b));
  root.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.filter === fightState.filter)));
  root.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sort === fightState.sort)));
  q('[data-allmods]').setAttribute('aria-pressed', String(fightState.allMods));
  ui.fightCount.textContent = all.length ? `${rows.length} fight${rows.length === 1 ? '' : 's'}${fightState.allMods ? '' : ` in ${arenaMod.short || arenaMod.name}`}` : '';
  if (!all.length) { ui.fightList.innerHTML = '<li class="tks-empty">No tank fights found yet.</li>'; ui.fightMore.hidden = true; return; }
  if (!rows.length) { ui.fightList.innerHTML = '<li class="tks-empty">None here: try every mod, or all fights.</li>'; ui.fightMore.hidden = true; return; }
  const side = (t, won) => `<span class="tks-f-side${won ? ' is-won' : ''}"><b>${esc(decodePlayerName(t.name ?? '') || 'someone')}</b>`
    + `<small>${esc(prettyTank(t.template))}${t.weight ? ` · ${esc(t.weight)}` : ''} · ${t.hpStart}/${t.hpMax} HP · ${t.hits ?? 0} hit${t.hits === 1 ? '' : 's'} of ${t.shots ?? 0}</small></span>`;
  ui.fightList.innerHTML = rows.slice(0, fightState.shown).map(f => {
    const [w, l] = f.winner === 'b' ? [f.b, f.a] : [f.a, f.b];
    const end = f.winner ? '' : END_WORDS[f.ending] ?? f.ending ?? '';
    return `<li class="tks-fight${f.upset ? ' is-upset' : ''}">`
      + `<div class="tks-f-range">${f.range != null ? `<b>${Math.round(f.range)} m</b><small>kill shot</small>` : '<b>-</b><small>no kill</small>'}</div>`
      + `<div class="tks-f-who">${side(w, f.winner != null)}<i>${f.winner ? 'beat' : 'against'}</i>${side(l, false)}`
      + `<small class="tks-f-meta">${esc(levelName(f.level))} · ${esc(f.date ?? '')} · ${n1(f.duration)} s${end ? ` · ${esc(end)}` : ''}${fightState.allMods ? ` · ${esc(f.mod)}` : ''}</small></div>`
      + `<div class="tks-f-tags">${f.upset ? '<span class="is-upset">Light beats heavy</span>' : ''}${f.fullHpStart ? '<span class="is-full">Both at full health</span>' : ''}</div>`
      + `<div class="tks-f-acts"><a class="tks-toggle" href="${esc(new URL(f.replay, VIEWER_ROOT).href)}" target="_blank" rel="noopener">Watch</a>`
      + `<a class="tks-toggle" href="${esc(fightMatchupHref(f))}">Matchup</a></div></li>`;
  }).join('');
  ui.fightMore.hidden = rows.length <= fightState.shown;
}
ui.fights.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.filter) fightState.filter = b.dataset.filter;
  else if (b.dataset.sort) fightState.sort = b.dataset.sort;
  else if (b.hasAttribute('data-allmods')) fightState.allMods = !fightState.allMods;
  else if (b === ui.fightMore) fightState.shown += 40;
  else return;
  if (b !== ui.fightMore) fightState.shown = 40;
  drawFights();
});
function setView(view) {
  const fights = view === 'fights';
  ui.fights.hidden = !fights;
  ui.board.hidden = fights;
  root.querySelectorAll('.dfs-rail [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  const address = new URL(location.href);
  if (fights) address.searchParams.set('view', 'fights'); else address.searchParams.delete('view');
  history.replaceState(null, '', address);
  if (fights) drawFights(); else requestAnimationFrame(resizeStage);
}
root.querySelector('.dfs-rail').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});

drawMods();
drawLegend();
setBearing(30, { animate: false });
window.__tankSchool = { arenas, get arena() { return arena.map; }, get yours() { return yours()?.template; }, get theirs() { return theirs()?.template; },
  get entries() { return current.entries.map(e => e.tank); }, roseFor: (i, el = 0) => roseFor(current.entries[i], el), stage, ready: false };
wait.hidden = true;
if (params.get('view') === 'fights') setView('fights');
await refresh();
