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
//      `surveys/tank_school_sheet.mjs` survey writes into each tree
//      (`<maps>/_shared/tank-school.json`, the pipeline's `tank_school` step);
//   05 on foot: the anti-tank weapons one side's kits carry on the arena's
//      battles (`tank-launchers.js`), each round's lob to the other's tank
//      drawn to scale, its sight with the spread, the lead, and its hits;
//   06 on a BF1918 arena, the rules of 1917-18 read on the pairing
//      (`tank-doctrine-1918.js`, features/tank-doctrine-1918), and the
//      Villers-Bretonneux duel.
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
import { arenasFrom, tankIn, enemyOf, prettyTank, mainGunName, pickMainGun, gunArcs, armourWeapon, sidesOn, isTank } from './tank-arena.js';
import { gunOf, reach, degreesPer100, dropAt, timeTo, elevationFor, positionAt } from './tank-ballistics.js';
import { sideWeapons, launcherOf, armsOf, glbJson, reachOf, aimFor, strayAt } from './tank-launchers.js';
import { resolveGlb } from './glb-store.js';
import { BANDS, IMMUNE, CATCHER, bandOf, faceName, pricer, collisionFaces, bearingShots, faceTable, angleModOf, blastOf } from './tank-armour.js';
import { splashSpec, damageFactor } from './projectile-damage.js';
import { matchupWords, missAt, steadyWords, launcherWords, NO_ANSWER, hurtsAtAll, answers, sayShots } from './tank-words.js';
import { snapshots } from './tank-snapshots.js';
import { createSightView, rigStemFor } from './tank-sight-view.js';
import * as doctrine1918 from './tank-doctrine-1918.js';
import * as doctrine1991 from './tank-doctrine-1991.js';
import { weaponWords, vehicleWords } from './tank-doctrine-1991.js';
import { STUDY_HTML, mountStudy } from './tank-study-page.js';
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
/** The tree's model catalogue, read once (the arenas, and ON FOOT's weapons). */
const catalogues = new Map();
function catalogueOf(m) {
  if (!catalogues.has(m.id)) catalogues.set(m.id, json(`${m.paths.models}/models.json`));
  return catalogues.get(m.id);
}
async function arenasOf(m) {
  const [rows, levels, ai] = await Promise.all([catalogueOf(m), json(`${m.paths.maps}/maps.json`).catch(() => null), vehicleAi(m)]);
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
// An arena by its key, or by any battle it holds (`?arena=arnhem-1944`).
const wantArena = String(params.get('arena') ?? stored(ARENA_KEY) ?? '').toLowerCase();
let arena = arenas.find(a => a.map.toLowerCase() === wantArena) ?? arenas.find(a => (a.levels ?? []).some(l => String(l).toLowerCase() === wantArena)) ?? arenas[0];
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
  json(`${arenaMod.paths.maps}/_shared/tank-school.json`).catch(() => null),
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
  // A machine gun of the hull's, the round its gunners fire at everything.
  const mg = fireArms.find(o => o.userData.fireArms?.projectile?.kind === 'bullet' && o.userData.fireArms.projectile.material != null);
  return {
    template,
    gunNode: gun?.name ?? null,
    name: prettyTank(template),
    hp: hp ?? 100,
    critical,
    angleMod: angleModOf(scene),
    shellMaterial: fa.projectile?.material ?? null,
    // The round's blast, which a mod's shell can add to its hit (HP-9).
    shellDamage: fa.projectile?.damage ?? null,
    gun: {
      ...ballistic,
      // What it fires and how far it flies: the round's template, its life
      // and its magazine (a Bradley's "main gun" against a tank is its TOW:
      // two in the launcher, then `magReload` seconds).
      round: fa.projectile?.template ?? null,
      ttl: Number(fa.projectile?.timeToLive) || null,
      mag: Number(fa.magSize) || null,
      magReload: Number(fa.reloadTime) || null,
      // Whole ticks between shots (GUN-13).
      reload: Math.ceil(30 / rof - 1e-9) / 30,
      traverse,
      up: Number.isFinite(up) ? up : 20,
      down: Number.isFinite(down) ? down : -5,
      per100: degreesPer100(ballistic),
      reach: reach(ballistic, Number.isFinite(up) ? up : 20),
      // Where it can point: one arc per gun of that name (`gunArcs`).
      arcs: gun ? gunArcs(fireArms, gun.name) : [],
    },
    mg: mg ? { name: mg.name, material: mg.userData.fireArms.projectile.material, damage: mg.userData.fireArms.projectile.damage ?? null } : null,
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
      <a class="tks-rules-jump" href="#tks-h-rules" hidden></a>
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
        <figure class="tks-clock is-them"><div></div><figcaption><b>Theirs</b> your hits to kill, from each side</figcaption></figure>
        <figure class="tks-clock is-you"><div></div><figcaption><b>Yours</b> their hits to kill, from each side</figcaption></figure>
        <p class="tks-clock-key">The number: hits on a plate the gun gets through. The fill: how much of that side those plates cover; a thin sliver means a small target, grey means nothing gets through.</p>
      </div>
      <div class="tks-words-pair"><ul class="tks-words tks-aim"></ul><ul class="tks-words tks-exposed"></ul></div>
    </section>
    <section class="tks-card tks-guns" aria-labelledby="tks-h-guns">
      <header class="tks-card-head"><small>02</small><h2 id="tks-h-guns">The guns: how far up to aim</h2></header>
      <p class="tks-intro">A shell drops, so the further the target, the higher the gun must point. The chart is how high each gun must point for each distance: a slow shell climbs steeply, a fast one stays nearly flat. Under it, what each gunner sees at the distance you pick: the cross is where the gun points, and it has to sit that far above the target.</p>
      <label class="tks-range"><span>Target at</span><input type="range" min="50" max="400" step="10" value="200"><b></b></label>
      <figure class="tks-elev"><div class="tks-elev-key"></div><svg class="tks-elev-chart" viewBox="0 0 760 270" role="img" aria-label="How high each gun must point for each distance"></svg></figure>
      <label class="tks-range is-sights"><span>Target at</span><input type="range" min="50" max="400" step="10" value="200" aria-label="Target distance for the sights"><b></b></label>
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
      <p class="tks-steady-empty">Not measured for this game or mod yet: its tanks have not been driven through the tank law. Vanilla's are.</p>
      <p class="tks-steady-note"></p>
    </section>
    <section class="tks-card tks-drive" aria-labelledby="tks-h-drive">
      <header class="tks-card-head"><small>04</small><h2 id="tks-h-drive">The drive</h2></header>
      <table class="tks-table tks-drive-table"></table>
      <ul class="tks-words tks-hull-words"></ul>
    </section>
    <section class="tks-card tks-foot-at" aria-labelledby="tks-h-foot">
      <header class="tks-card-head"><small>05</small><h2 id="tks-h-foot">On foot: the anti-tank weapons</h2></header>
      <p class="tks-intro">What a soldier of each side carries against tanks on this arena's battles, fired at the other side's tank. A hand-held round leaves slowly, so it falls fast: the chart draws its path to the tank at true scale, and the sight shows how far above the tank to point and how far the round can stray.</p>
      <div class="tks-foot-bar">
        <span class="tks-seg" role="radiogroup" aria-label="Whose soldiers">
          <button type="button" data-whose="yours">Your side's</button><button type="button" data-whose="theirs">Their side's</button>
        </span>
        <span class="tks-foot-target"></span>
      </div>
      <div class="tks-foot-picks" role="radiogroup" aria-label="Weapon"></div>
      <label class="tks-range is-foot"><span>Tank at</span><input type="range" min="5" max="150" step="5" value="50" aria-label="Tank distance"><b></b></label>
      <figure class="tks-lob"><svg class="tks-lob-chart" viewBox="0 0 760 250" role="img" aria-label="The round's path to the tank, to scale"></svg><figcaption class="tks-lob-key"></figcaption></figure>
      <div class="tks-foot-pair">
        <figure class="tks-sight is-foot"><figcaption></figcaption>
          <div class="tks-foot-sight"><canvas width="640" height="480"></canvas><img class="tks-foot-scope" alt="" hidden><svg class="tks-foot-hud" viewBox="0 0 640 480" aria-hidden="true"></svg><span class="tks-foot-sight-wait" hidden>Loading the weapon in hand</span></div>
          <p class="tks-sight-words"></p></figure>
        <figure class="tks-clock is-foot"><div></div><figcaption><b>Hits to kill</b> on a plate it gets through, from each side</figcaption></figure>
      </div>
      <ul class="tks-words tks-foot-words"></ul>
      <details class="tks-more tks-foot-more"><summary>Every weapon side by side</summary><table class="tks-table tks-foot-table"></table></details>
      <p class="tks-foot-empty" hidden></p>
    </section>
    <section class="tks-card tks-rules" aria-labelledby="tks-h-rules" hidden>
      <header class="tks-card-head"><small>06</small><h2 id="tks-h-rules"></h2></header>
      <p class="tks-intro tks-rules-intro"></p>
      <div class="tks-duel"><div class="tks-duel-text"><small class="mm-eyebrow tks-duel-eyebrow"></small><h3></h3><div class="tks-duel-story"></div><ul class="tks-words tks-duel-words"></ul><p class="tks-duel-src"></p></div>
        <a class="tks-toggle tks-duel-go" hidden></a></div>
      <ol class="tks-rule-list" role="list"></ol>
      <p class="tks-rules-wait" hidden></p>
    </section>
    <footer class="tks-foot tks-board-foot">Every number is the game's own: the damage tables from <code>Game.rfa</code>, each gun's <code>Weapons.con</code>, the tanks' collision faces, and the server's per-tick tank law driven in node (<code>surveys/tank_school_sheet.mjs</code>). Notes: <code>features/battle-schools</code>.</footer>
  </main>
  ${STUDY_HTML}`;
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
  elevKey: q('.tks-elev-key'), elevChart: q('.tks-elev-chart'), sights: q('.tks-sights'), range: q('.tks-range input'), rangeOut: q('.tks-range b'),
  rangeSight: q('.tks-range.is-sights input'), rangeSightOut: q('.tks-range.is-sights b'), gunTable: q('.tks-gun-table'), gunWords: q('.tks-gun-words'),
  scrub: q('.tks-scrub'), clockNow: q('.tks-clock-now'), steadyWords: q('.tks-steady-words'),
  driveTable: q('.tks-drive-table'), hullWords: q('.tks-hull-words'),
  scenarios: q('.tks-steady .tks-seg'), play: q('.tks-play'), rockers: [...root.querySelectorAll('.tks-rockers figure')],
  trace: q('.tks-trace'), steadyNote: q('.tks-steady-note'), listToggle: q('.dfs-list-toggle'),
  foot: q('.tks-foot-at'), footWhose: q('.tks-foot-bar .tks-seg'), footTarget: q('.tks-foot-target'), footPicks: q('.tks-foot-picks'),
  footRange: q('.tks-range.is-foot input'), footRangeOut: q('.tks-range.is-foot b'), lob: q('.tks-lob-chart'), lobKey: q('.tks-lob-key'),
  footSight: q('.tks-sight.is-foot'), footClock: q('.tks-clock.is-foot > div'), footWords: q('.tks-foot-words'),
  footMore: q('.tks-foot-more'), footTable: q('.tks-foot-table'), footEmpty: q('.tks-foot-empty'),
  rules: q('.tks-rules'), ruleList: q('.tks-rule-list'), rulesJump: q('.tks-rules-jump'), rulesWait: q('.tks-rules-wait'),
  rulesHead: q('#tks-h-rules'), rulesIntro: q('.tks-rules-intro'),
  duel: q('.tks-duel'), duelGo: q('.tks-duel-go'),
  board: q('.tks-board'), fights: q('.tks-fights'), study: q('.tks-study'), fightList: q('.tks-fight-list'), fightCount: q('.tks-fight-count'), fightMore: q('.tks-fight-more'),
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
  // Each sector: the shots a hit on a plate the gun gets through needs (the
  // number, and its band's colour), filled out from the hull by how much of
  // that side those plates cover (`tank-armour.js` `bearingShots`).
  const sector = (deg, v) => {
    const shots = v?.share > 0 ? v.hurtShots : null;
    const a0 = (deg - 15 - 90) * Math.PI / 180, a1 = (deg + 15 - 90) * Math.PI / 180;
    const p = (r, a) => `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
    const ring = (r0, r1, fill, cls = '') => `<path${cls} d="M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z" fill="${fill}"/>`;
    const mid = (deg - 90) * Math.PI / 180, rm = (R0 + R1) / 2;
    const reach = R0 + (R1 - R0) * Math.min(1, Math.max(shots == null ? 0 : 0.14, v?.share ?? 0));
    return ring(R0, R1, IMMUNE.color) + (shots == null ? '' : ring(R0, reach, bandOf(shots).color, ' class="is-fill"'))
      + `<text x="${(C + rm * Math.cos(mid)).toFixed(1)}" y="${(C + rm * Math.sin(mid) + 4).toFixed(1)}">${shots == null ? '-' : shots > NO_ANSWER ? `${NO_ANSWER}+` : shots}</text>`;
  };
  let body = '';
  for (let deg = 0; deg < 360; deg += 30) {
    const b = deg <= 180 ? deg : 360 - deg;
    body += sector(deg, byBearing[b] ?? null);
  }
  const hull = `<rect x="${C - 11}" y="${C - 22}" width="22" height="44" rx="3" class="tks-clock-hull"/><circle cx="${C}" cy="${C - 2}" r="8" class="tks-clock-hull"/><path d="M${C} ${C - 10}V${C - 34}" class="tks-clock-gun"/>`;
  return `<svg viewBox="0 0 172 172" role="img" aria-label="${esc(label)}">${body}${hull}`
    + `<text x="${C}" y="9" class="tks-clock-dir">FRONT</text><text x="${C}" y="170" class="tks-clock-dir">REAR</text></svg>`;
}

const roseCache = new Map();
function roseFor(entry, elevation) {
  const key = `${entry.key}|${elevation}`;
  if (!roseCache.has(key)) roseCache.set(key, bearingShots(entry.scene, entry.price, entry.tank.hp, { bearings: BEARINGS, elevation, blast: entry.blast }));
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

const deg = r => r * 180 / Math.PI;

/** How high each gun must point for each distance, both on one chart, the
 *  chosen distance marked. True degrees on the y axis, from 0 to the larger
 *  gun's need at 400 m (at least 1 degree, so a fast gun's flat line reads
 *  as flat rather than filling the chart). */
function elevationSvg(pair, R) {
  const W = 760, H = 270, L = 54, Rt = 104, T = 16, B = 34;
  const ranges = []; for (let r = 25; r <= 400; r += 5) ranges.push(r);
  const curves = pair.map(p => ({ ...p, pts: ranges.map(r => ({ r, e: elevationFor(p.e.tank.gun, r, { maxElevation: p.e.tank.gun.up }) })).filter(x => x.e != null) }));
  const top = Math.max(1, ...curves.flatMap(c => c.pts.map(x => x.e))) * 1.12;
  const sx = r => L + (r / 400) * (W - L - Rt), sy = e => T + (1 - e / top) * (H - T - B);
  let svg = '';
  // Grid: every 100 m, and a few round degrees.
  const step = top > 12 ? 5 : top > 6 ? 2 : top > 3 ? 1 : top > 1.5 ? 0.5 : 0.25;
  for (let e = 0; e <= top + 1e-9; e += step) {
    svg += `<line class="tks-grid" x1="${L}" y1="${sy(e).toFixed(1)}" x2="${W - Rt}" y2="${sy(e).toFixed(1)}"/>`
      + `<text class="tks-tick is-y" x="${L - 8}" y="${(sy(e) + 4).toFixed(1)}">${e === 0 ? 'level' : `${+e.toFixed(2)}&#176;`}</text>`;
  }
  for (let r = 0; r <= 400; r += 100) svg += `<text class="tks-tick" x="${sx(r)}" y="${H - 12}">${r} m</text>`;
  svg += `<line class="tks-target-line" x1="${sx(R)}" y1="${T}" x2="${sx(R)}" y2="${H - B}"/>`;
  const labels = [], names = [];
  for (const c of curves) {
    if (c.pts.length > 1) svg += `<path class="tks-curve ${c.who}" d="${c.pts.map((x, i) => `${i ? 'L' : 'M'}${sx(x.r).toFixed(1)} ${sy(x.e).toFixed(1)}`).join('')}"/>`;
    const eR = elevationFor(c.e.tank.gun, R, { maxElevation: c.e.tank.gun.up });
    if (eR != null) {
      svg += `<circle class="tks-dot ${c.who}" cx="${sx(R)}" cy="${sy(eR).toFixed(1)}" r="5"/>`;
      labels.push({ who: c.who, y: sy(eR), text: `${eR < 1 ? eR.toFixed(2) : eR.toFixed(1)}&#176;` });
    }
    const end = c.pts[c.pts.length - 1];
    if (end) names.push({ who: c.who, x: sx(end.r) + 8, y: sy(end.e) + 4, text: c.e.tank.name });
  }
  // The names at the curves' ends, kept 15 px apart and inside the chart.
  names.sort((a, b) => a.y - b.y);
  for (let i = 1; i < names.length; i++) names[i].y = Math.max(names[i].y, names[i - 1].y + 15);
  for (const n of names) svg += `<text class="tks-curve-name ${n.who}" x="${n.x.toFixed(1)}" y="${Math.min(n.y, H - B).toFixed(1)}">${esc(n.text.length > 14 ? `${n.text.slice(0, 13)}.` : n.text)}</text>`;
  // The two readings at the target, kept 16 px apart.
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 16);
  for (const l of labels) svg += `<text class="tks-dot-label ${l.who}" x="${sx(R) - 10}" y="${(l.y + 4).toFixed(1)}">${l.text}</text>`;
  return svg;
}

/** What one gunner sees at R m: a window `span` degrees tall (the same for
 *  both gunners, so the two compare), the target at its true size, and the
 *  cross where the gun must point. Words go under it, not on it. */
function sightSvg(entry, R, span) {
  const gun = entry.tank.gun;
  const e = elevationFor(gun, R, { maxElevation: gun.up });
  const tgt = entry.target.snaps.front;
  const W = 360, H = 240;
  const k = H / span;                                         // px a degree
  const tH = deg(Math.atan(tgt.heightM / R));
  const s = (deg(Math.atan(1 / R)) * k) / tgt.pxPerM;         // image px -> window px
  const cx = W / 2, groundY = H - 18, cy = groundY - (tH / 2) * k;
  const iw = tgt.width * s, ih = tgt.height * s;
  let svg = `<rect class="tks-sight-sky" x="0" y="0" width="${W}" height="${H}"/>`
    + `<line class="tks-sight-horizon" x1="0" y1="${groundY}" x2="${W}" y2="${groundY}"/>`
    + `<image href="${tgt.url}" x="${(cx - tgt.middle.x * s).toFixed(1)}" y="${(cy - tgt.middle.y * s).toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}"/>`;
  // Brackets at least 14 px tall, so a far tank is still found.
  const bh = Math.max(ih, 14) / 2 + 3, bw = Math.max(iw, 14) / 2 + 5;
  svg += `<path class="tks-sight-bracket" d="M${cx - bw + 4} ${cy - bh}h-4v${bh * 2}h4M${cx + bw - 4} ${cy - bh}h4v${bh * 2}h-4"/>`;
  if (e != null) {
    const ay = cy - e * k;
    if (cy - ay > bh + 10) {
      svg += `<line class="tks-sight-gap" x1="${cx}" y1="${(cy - bh - 2).toFixed(1)}" x2="${cx}" y2="${(ay + 12).toFixed(1)}"/>`
        + `<text class="tks-sight-label" x="${cx + 10}" y="${((ay + cy - bh) / 2 + 4).toFixed(1)}">${e.toFixed(e < 1 ? 2 : 1)}&#176;</text>`;
    }
    svg += `<path class="tks-sight-cross" d="M${cx - 16} ${ay}h11M${cx + 5} ${ay}h11M${cx} ${ay - 16}v11M${cx} ${ay + 5}v11"/>`;
  }
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(entry.tank.name)}'s sight on the ${esc(entry.target.tank.name)}">${svg}</svg>`, e };
}

function drawGuns() {
  const [them, you] = current.entries;
  const R = Number(ui.range.value);
  ui.rangeOut.textContent = ui.rangeSightOut.textContent = `${R} m`;
  ui.rangeSight.value = String(R);
  const pair = [{ who: 'is-you', e: { ...you, target: them } }, { who: 'is-them', e: { ...them, target: you } }];
  ui.elevKey.innerHTML = pair.map(p => `<span class="${p.who}"><img src="${p.e.snaps.side.url}" alt="" height="34"><b>${esc(p.e.tank.name)}</b>`
    + `<small>${n1(p.e.tank.gun.speed)} m/s, ${p.e.tank.gun.gravity === 1 ? 'full gravity' : `${n1(p.e.tank.gun.gravity * 100)}% gravity`}</small></span>`).join('')
    + (you.tank.gun.speed === them.tank.gun.speed && you.tank.gun.gravity === them.tank.gun.gravity
      ? '<em class="tks-elev-same">The same shell: one line over the other.</em>' : '');
  ui.elevChart.innerHTML = elevationSvg(pair, R);
  // One angular window for both sights: the larger aim, the target, and room.
  const need = pair.map(p => elevationFor(p.e.tank.gun, R, { maxElevation: p.e.tank.gun.up }) ?? p.e.tank.gun.up);
  const tallest = Math.max(...pair.map(p => deg(Math.atan(p.e.target.snaps.front.heightM / R))));
  const span = Math.max(Math.max(...need) * 1.25 + tallest * 2 + 0.6, 1.5);
  ui.sights.innerHTML = pair.map(p => {
    const sv = sightSvg(p.e, R, span);
    const tH = p.e.target.snaps.front.heightM, drop = dropAt(p.e.tank.gun, R);
    const words = sv.e == null ? `Out of reach: the gun lifts only ${n1(p.e.tank.gun.up)} deg.`
      : !(p.e.tank.gun.gravity > 0) ? 'Its round flies straight: put the cross on them.'
      : drop < tH * 0.5 ? `Aim straight at them: by ${R} m the shell drops ${n1(drop)} m, less than half their height.`
      : `Put the cross ${sv.e.toFixed(sv.e < 1 ? 2 : 1)} deg above them: the shell drops ${n1(drop)} m by ${R} m, ${n1(drop / tH)} times their height.`;
    return `<figure class="tks-sight ${p.who}"><figcaption><b>${p.who === 'is-you' ? 'Your sight' : 'Their sight'}</b><span>${esc(p.e.tank.name)} at the ${esc(p.e.target.tank.name)}, ${R} m</span></figcaption>`
      + sv.svg + `<p class="tks-sight-words">${esc(words)}</p></figure>`;
  }).join('') + `<p class="tks-sight-note">Both windows are ${n1(span)} deg tall, the target at its true size.</p>`;
  const guns = [{ who: 'is-you', t: you.tank }, { who: 'is-them', t: them.tank }];
  const row = (label, f, hint = '') => `<tr><th scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${guns.map(g => `<td class="${g.who}">${f(g.t)}</td>`).join('')}</tr>`;
  ui.gunTable.innerHTML = `<thead><tr><th></th><th class="is-you">${esc(you.tank.name)}<small>yours</small></th><th class="is-them">${esc(them.tank.name)}<small>theirs</small></th></tr></thead><tbody>`
    + row('Muzzle speed', t => `${n1(t.gun.speed)} m/s`)
    + row('Gravity on the shell', t => (t.gun.gravity === 1 ? 'full' : `${n1(t.gun.gravity * 100)}%`))
    + row(`Gun up to hit at ${R} m`, t => { const e = elevationFor(t.gun, R, { maxElevation: t.gun.up }); return e == null ? 'out of reach' : `${n1(e)} deg`; })
    + row(`Drop by ${R} m, aimed level`, t => `${n1(dropAt(t.gun, R))} m`)
    + row('Rule of thumb', t => (t.gun.per100 ? `about ${t.gun.per100} deg up per 100 m` : '-'))
    + row(`Flight to ${R} m`, t => `${n1(timeTo(t.gun, R))} s`)
    + row('Furthest it reaches', t => (Number.isFinite(t.gun.reach.range) ? `${Math.round(t.gun.reach.range)} m, gun at +${n1(t.gun.up)} deg` : 'it flies straight'), 'on flat ground')
    + row('Reload', t => `${t.gun.reload.toFixed(2)} s`)
    + row('Turret', t => (t.gun.traverse ? `${n1(t.gun.traverse)} deg/s, 90 deg in ${n1(90 / t.gun.traverse)} s` : '-'))
    + row('Gun up / down', t => `+${n1(t.gun.up)} / ${n1(t.gun.down)} deg`)
    + '</tbody>';
}
// Two sliders for one distance: one over the chart, one over the sights, so
// neither needs a scroll back up.
ui.range.addEventListener('input', () => drawGuns());
ui.rangeSight.addEventListener('input', () => { ui.range.value = ui.rangeSight.value; drawGuns(); });

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
  // Nothing measured for either tank: one line instead of empty frames.
  q('.tks-steady').classList.toggle('is-empty', !traces[0] && !traces[1]);
  if (!traces[0] && !traces[1]) return;
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
    + pair.map((p, k) => {
      // A gun the game gives no recoil (`fireingForce` 0) shoves nothing:
      // say that, rather than only a swing of nothing.
      const still = scenario.startsWith('fire') && p.e.tank.sheet?.fireingForce === 0;
      const words = still ? [`${p.e.tank.name}: its gun has no recoil in the game, so firing does not move the hull. It stays on target.`]
        : steadyWords(p.e.tank.name, traces[k], sums[k], { reload: p.e.tank.gun.reload });
      return words.map(w => `<li class="${p.who}">${esc(w)}</li>`).join('');
    }).join('');
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

// --- 05: on foot ------------------------------------------------------------------------

/** A standing soldier's tube, above the ground, where the lob chart starts
 *  him. The aim is at the tube's own height on the tank, as the guns panel
 *  aims (a model's picture box is no measure of its hull's middle: a mod
 *  hangs parts off some). */
const MUZZLE_H = 1.5;
const foot = { whose: stored(`${KEY}:foot-whose`) === 'theirs' ? 'theirs' : 'yours', pick: stored(`${KEY}:foot-pick`), weapons: [], ticket: 0 };
let loadoutsP = null;
const loadoutsOf = () => (loadoutsP ??= json(`${arenaMod.paths.maps}/_shared/loadouts.json`).catch(() => null));

/** A weapon's round and spread off its own glb's JSON (no textures), read once. */
const weaponCache = new Map();
function weaponOf(name) {
  const key = String(name).toLowerCase();
  if (!weaponCache.has(key)) {
    weaponCache.set(key, (async () => {
      const rows = await catalogueOf(arenaMod).catch(() => []);
      const row = rows.find(r => r.name.toLowerCase() === key && r.category === 'handweapon') ?? rows.find(r => r.name.toLowerCase() === key);
      if (!row?.glb) return null;
      for (const url of modelUrls(arenaMod.paths.models, row.glb)) {
        try {
          const real = (await resolveGlb(url)).url;
          const res = await fetch(real);
          if (!res.ok) continue;
          const l = launcherOf(row.name, glbJson(await res.arrayBuffer()));
          return l ? { ...l, label: prettyTank(row.name), reach: reachOf(l) } : null;
        } catch { /* the next tree */ }
      }
      return null;
    })());
  }
  return weaponCache.get(key);
}

/** A side's crewed guns on the arena's battles, as each round leaves the
 *  muzzle (`launcherOf`): `field`, what the AI files as `Artillery` and
 *  rates against armour (BF1918's 77 mm, 75 mm, 18-pounder and gun
 *  carrier); `mg`, its emplaced machine guns (`Gunner`, firing bullets). */
const fieldGunCache = new Map();
function fieldGunsOf(side, kind = 'field') {
  const key = `${arenaMod.id}|${arena.map}|${side}|${kind}`;
  if (!fieldGunCache.has(key)) {
    fieldGunCache.set(key, (async () => {
      const [rows, ai] = await Promise.all([catalogueOf(arenaMod), vehicleAi(arenaMod)]);
      const want = arena.every ? null : (arena.levels ?? []).map(l => String(l).toLowerCase());
      const names = rows.filter(row => {
        const e = ai?.[row.name];
        if (!e) return false;
        if (kind === 'field' ? !/^artillery$/i.test(String(e.equipment ?? '')) || !armourWeapon(e) : !/^gunner$/i.test(String(e.equipment ?? ''))) return false;
        // The level's own sides where the catalogue has them (roster.py), else the tree's.
        const on = row.levelSides ? Object.entries(row.levelSides).filter(([l]) => !want || want.includes(l.toLowerCase())).flatMap(([, s]) => s) : row.sides ?? [];
        return on.includes(side);
      }).map(r => r.name);
      const guns = await Promise.all(names.map(n => weaponOf(n)));
      return guns.filter(w => w && !w.placed && w.gun.speed > 0 && (kind === 'field' || w.kind === 'bullet'));
    })());
  }
  return fieldGunCache.get(key);
}

/** A catalogue row's glb JSON (no textures), from whichever tree holds it. */
async function rowJson(row) {
  if (!row?.glb) return null;
  for (const url of modelUrls(arenaMod.paths.models, row.glb)) {
    try {
      const res = await fetch((await resolveGlb(url)).url);
      if (res.ok) return glbJson(await res.arrayBuffer());
    } catch { /* the next tree */ }
  }
  return null;
}
/** A side's vehicles of a kind on the arena's battles, and what each fires
 *  that carries an armour material (`armsOf`), for the 1991 card: `air`, its
 *  aircraft, every weapon of each (the rule prices them and keeps the ones
 *  that hurt); or `carrier`, its land vehicles that are no tank and mount a
 *  missile
 *  (a BRDM-2 with Spandrels, a Humvee with a TOW). Each `{ vehicle, label,
 *  weapon, kind, gun, material, damage, ttl, reload, rof, mag }`. */
const armsCache = new Map();
function armsOfSide(side, kind) {
  const key = `${arenaMod.id}|${arena.map}|${side}|${kind}`;
  if (!armsCache.has(key)) {
    armsCache.set(key, (async () => {
      const [rows, ai] = await Promise.all([catalogueOf(arenaMod), vehicleAi(arenaMod)]);
      const want = arena.every ? null : arena.levels ?? [];
      const on = row => (want ? want.some(l => (row.levels ?? []).includes(l) && sidesOn(row, l).includes(side)) : (row.sides ?? []).includes(side));
      // An anti-tank missile by its launcher's name (a SCUD's is no such thing).
      const launcher = w => /tow|span|sagger|at-?\d|atgm/i.test(String(w)) && !/scud/i.test(String(w));
      const picked = rows.filter(row => on(row) && (kind === 'air' ? row.category === 'air'
        : row.category === 'land' && !isTank(row, ai) && (row.weapons ?? []).some(launcher)));
      const out = [];
      for (const row of picked) {
        for (const a of armsOf(await rowJson(row))) {
          if (kind === 'carrier' && !launcher(a.node)) continue;
          out.push({ ...a, vehicle: row.name, label: vehicleWords(row.name), weapon: weaponWords(a.node, a.template) });
        }
      }
      return out;
    })());
  }
  return armsCache.get(key);
}

const footRoses = new Map();
/** A weapon's blast on the target: an impact round's where it strikes; a
 *  thrown charge's (no impact burst, a fuse) where it comes to rest against
 *  the hull. Null for a round with no blast that reaches it. */
const footBlast = (target, w) => blastOf(tables, w.damage, target.scene, { atContact: !splashSpec(w.damage)?.impact });
/** The target's clock for one warhead at `R` m, its blast included: a
 *  bullet's hit falls off with the distance it has flown (`damageFactor`:
 *  the Tankgewehr's is whole to 100 m and 30% from 150 m), a blast does not. */
function footRose(target, w, R = 0) {
  const f = Math.round(damageFactor(w.damage, R) * 100) / 100;
  const key = `${target.template}|${w.name}|${f}`;
  if (!footRoses.has(key)) {
    const price = pricer(tables, w.material);
    footRoses.set(key, bearingShots(target.scene, m => price(m) * f, target.tank.hp, { bearings: BEARINGS, blast: footBlast(target, w) }));
  }
  return footRoses.get(key);
}
const footShots = rose => Object.fromEntries(Object.entries(rose ?? {}).map(([b, v]) => [b, { shots: v.share > 0 ? v.hurtShots : null, share: v.share }]));

/** Who shoots at whom: your side's soldiers at their tank, or theirs at yours. */
function footPair() {
  const [them, you] = current.entries;
  return foot.whose === 'yours' ? { side: yours().side, target: them } : { side: theirs().side, target: you };
}

async function drawFoot() {
  const ticket = ++foot.ticket;
  const { side, target } = footPair();
  if (!target) return;
  for (const b of ui.footWhose.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.whose === foot.whose));
  ui.footTarget.innerHTML = `${esc(side === 'Axis' ? 'Axis' : 'Allied')} soldiers against the <b class="${foot.whose === 'yours' ? 'is-them' : 'is-you'}">${esc(target.tank.name)}</b>`;
  ui.footPicks.innerHTML = '<span class="tks-foot-wait">Reading the kits</span>';
  const loadouts = await loadoutsOf();
  const names = sideWeapons(loadouts, arena.every ? [] : arena.levels, side);
  const read = (await Promise.all(names.map(n => weaponOf(n.name).then(w => (w ? { ...w, kits: n.kits, rated: n.rated, pickup: n.pickup } : null))))).filter(w => w && !w.placed);
  if (ticket !== foot.ticket) return;
  // Only what can hurt this tank somewhere: a weapon the AI rates against
  // armour that no plate of this hull answers is said under the list.
  const plates = [...new Set(collisionFaces(target.scene).map(f => f.material).filter(m => m != null))];
  const hurts = w => { const price = pricer(tables, w.material); return plates.some(m => price(m) > 0) || Boolean(footBlast(target, w)); };
  // One chip per weapon as a soldier knows it: a kit's own copy of the same
  // grenade (BF1918's `GrenadeGerGunner`) flies and bursts alike.
  const same = w => `${w.label}|${w.gun.speed}|${w.gun.gravity}|${w.material}|${w.damage?.material2 ?? ''}|${w.damage?.radius ?? ''}`;
  const seen = new Set();
  const ws = read.filter(hurts).filter(w => !seen.has(same(w)) && seen.add(same(w))), useless = read.filter(w => !hurts(w) && w.rated);
  ws.sort((a, b) => a.gun.speed - b.gun.speed || a.label.localeCompare(b.label));
  foot.weapons = ws;
  const none = !ws.length;
  ui.foot.classList.toggle('is-empty', none);
  ui.footEmpty.hidden = !none;
  if (none) {
    ui.footPicks.innerHTML = '';
    ui.footEmpty.textContent = !loadouts ? 'This game or mod publishes no kit loadouts, so its soldiers\' weapons are not known here.'
      : read.length ? `Nothing ${side === 'Axis' ? 'Axis' : 'Allied'} soldiers carry here can hurt the ${target.tank.name}: no plate of it takes damage from ${read.map(w => w.label).join(', ')}.`
      : `No ${side === 'Axis' ? 'Axis' : 'Allied'} kit on ${arena.every ? 'any battle' : 'these battles'} carries a weapon that fires at tanks.`;
    window.__tankSchool.foot = { side, target: target.template, weapons: [] };
    return;
  }
  const pick = ws.find(w => w.name === foot.pick) ?? ws.find(w => /faust|bazooka|schreck|piat|rpg|law|rocket|smaw|at-?4|javelin|dragon/i.test(w.name)) ?? ws[0];
  foot.pick = pick.name;
  ui.footPicks.innerHTML = ws.map(w => `<button type="button" class="dfs-chip" role="radio" aria-checked="${w === pick}" data-weapon="${esc(w.name)}">`
    + `<b>${esc(w.label)}</b><small>${n1(w.gun.speed)} m/s${w.pickup ? ' · pickup' : ''}</small></button>`).join('')
    + (useless.length ? `<span class="tks-foot-useless">Carried too, but no plate of the ${esc(target.tank.name)} takes damage from: ${useless.map(w => esc(w.label)).join(', ')}.</span>` : '');
  // The distance slider runs to the furthest any of them reaches.
  const far = Math.max(...ws.map(w => w.reach.range));
  ui.footRange.max = String(Math.min(400, Math.max(50, Math.ceil(far / 10) * 10)));
  drawFootPick();
  ui.footTable.innerHTML = '';
  if (ui.footMore.open) drawFootTable();
}

function drawFootPick() {
  const { side, target } = footPair();
  const w = foot.weapons.find(x => x.name === foot.pick);
  if (!w || !target) return;
  const R = Math.min(Number(ui.footRange.value), Number(ui.footRange.max));
  ui.footRangeOut.textContent = `${R} m`;
  const snap = target.snaps.front;
  const aim = aimFor(w, R);
  const drop = dropAt(w.gun, R);
  const stillM = strayAt(w.spread.still, R), movingM = strayAt(w.spread.moving, R);
  ui.lob.innerHTML = lobSvg(w, R, aim, target);
  ui.lobKey.innerHTML = `<span><i class="is-aim"></i>aimed to hit, the tube ${aim.elevation == null ? 'cannot reach' : `${n1(aim.elevation)} deg up`}</span>`
    + `<span><i class="is-level"></i>aimed straight at them</span><span>${n1(w.gun.speed)} m/s, ${w.gun.gravity === 1 ? 'full gravity' : `${n1(w.gun.gravity * 100)}% gravity`}, fuse ${n1(w.ttl)} s</span>`;
  ui.footSight.querySelector('figcaption').innerHTML = `<b>Through the sight</b><span>${esc(w.label)} zoomed, at the ${esc(target.tank.name)} ${R} m off</span>`;
  drawThroughSight(w, R, aim, target, side);
  const rose = footRose(target, w, R);
  ui.footClock.innerHTML = clockSvg(rose, `${target.tank.name}: hits to kill from each side with the ${w.label}`);
  const top = target.tank.sheet?.drive?.top ?? null;
  const blast = splashSpec(w.damage);
  const charge = blast && !blast.impact ? { fuse: w.ttl, radius: blast.radius } : null;
  const fall = damageFactor(w.damage, R);
  const words = launcherWords({ name: w.label, reach: w.reach, aim, drop, spread: w.spread, stillM, movingM, charge,
    falloff: fall < 1 ? { factor: fall, full: w.damage.distToStartLoseDamage, min: w.damage.distToMinDamage, floor: w.damage.minDamage } : null },
    { name: target.tank.name, heightM: snap.heightM, lengthM: target.snaps.side.widthM, top, shots: footShots(rose) }, R);
  ui.footWords.innerHTML = words.map(x => `<li>${esc(x)}</li>`).join('');
  window.__tankSchool.foot = {
    side, target: target.template, weapons: foot.weapons.map(x => x.name), pick: w.name, range: R,
    speed: w.gun.speed, elevation: aim.elevation, t: aim.t, reach: w.reach.range, spread: w.spread, words,
  };
}

/** The round's path to the tank, both axes in metres at one scale: aimed to
 *  hit (solid) and aimed straight at them (dashed), from a standing soldier's
 *  tube, the tank broadside at the distance, its nose towards him. */
function lobSvg(w, R, aim, target) {
  const W = 760, H = 250, L = 34, Rp = 16, T = 14, B = 30;
  const snap = target.snaps.side;
  const lenM = snap.widthM, tH = snap.heightM;
  const el = aim.elevation ?? w.reach.elevation;
  const tEnd = aim.elevation != null ? aim.t : w.reach.t;
  const at = (t, e) => { const p = positionAt(w.gun, t, e); return { x: p.x, y: MUZZLE_H + p.y }; };
  const hit = []; for (let i = 0; i <= 80; i++) hit.push(at(tEnd * i / 80, el));
  // Out of reach: the best lob, until it lands or its fuse runs out.
  const level = [];
  for (let t = 0; t <= w.ttl; t += 0.01) { const p = at(t, 0); level.push(p); if (p.y <= 0 || p.x >= R) break; }
  const apex = hit.reduce((m, p) => (p.y > m.y ? p : m), hit[0]);
  const xMax = Math.max(R + lenM + 2, ...hit.map(p => p.x)), yMax = Math.max(apex.y, tH, MUZZLE_H) + 1;
  const k = Math.min((W - L - Rp) / (xMax + 3), (H - T - B) / yMax);
  // As tall as the lob needs: a flat shot leaves no empty sky above it.
  const Hu = Math.max(130, Math.round(T + B + yMax * k));
  ui.lob.setAttribute('viewBox', `0 0 ${W} ${Hu}`);
  const sx = x => L + (x + 3) * k, sy = y => Hu - B - y * k;
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(Math.max(p.y, 0)).toFixed(1)}`).join('');
  let svg = `<line class="tks-lob-ground" x1="${L}" y1="${sy(0)}" x2="${W - Rp}" y2="${sy(0)}"/>`;
  const step = xMax > 300 ? 100 : xMax > 120 ? 50 : xMax > 50 ? 20 : 10;
  for (let x = 0; x <= xMax; x += step) svg += `<line class="tks-grid" x1="${sx(x)}" y1="${sy(0)}" x2="${sx(x)}" y2="${sy(0) + 5}"/><text class="tks-tick" x="${sx(x)}" y="${Hu - 10}">${x} m</text>`;
  // The tank, broadside, its nose towards the shooter: the side picture's nose points right, so it is mirrored.
  const s = k / snap.pxPerM, cx = sx(R + lenM / 2);
  svg += `<g transform="translate(${cx.toFixed(1)} 0) scale(-1 1) translate(${(-cx).toFixed(1)} 0)"><image href="${snap.url}" x="${(cx - snap.middle.x * s).toFixed(1)}" y="${(sy(0) - snap.groundY * s).toFixed(1)}" width="${(snap.width * s).toFixed(1)}" height="${(snap.height * s).toFixed(1)}"/></g>`;
  // The soldier: 1.8 m, the tube at his shoulder.
  const m = v => (v * k).toFixed(1);
  svg += `<g class="tks-soldier" transform="translate(${sx(0).toFixed(1)} ${sy(0).toFixed(1)})"><circle cx="0" cy="-${m(1.68)}" r="${m(0.12)}"/>`
    + `<path d="M0 -${m(1.55)}V-${m(0.9)}M0 -${m(0.9)}L-${m(0.22)} 0M0 -${m(0.9)}L${m(0.22)} 0M-${m(0.4)} -${m(MUZZLE_H)}h${m(0.9)}"/></g>`;
  svg += `<path class="tks-lob-path is-level" d="${path(level)}"/><path class="tks-lob-path is-aim" d="${path(hit)}"/>`;
  if (aim.elevation != null && apex.y > MUZZLE_H + 0.5) {
    svg += `<line class="tks-sight-gap" x1="${sx(apex.x)}" y1="${sy(apex.y)}" x2="${sx(apex.x)}" y2="${sy(0)}"/>`
      + `<text class="tks-lob-label" x="${(sx(apex.x) + 6).toFixed(1)}" y="${(sy(apex.y) - 6).toFixed(1)}">${n1(apex.y)} m up</text>`;
  }
  const lv = level[level.length - 1];
  if (lv && lv.y <= 0 && lv.x < R - 0.5) svg += `<text class="tks-lob-label is-level" x="${(sx(lv.x) + 6).toFixed(1)}" y="${(sy(0) - 6).toFixed(1)}">lands ${n1(lv.x)} m out</text>`;
  if (aim.elevation == null) svg += `<text class="tks-lob-label" x="${Math.min(sx(hit[hit.length - 1].x), W - 140).toFixed(1)}" y="${(sy(0) - 8).toFixed(1)}">${w.reach.fuse ? 'fuse out' : 'its furthest'}: ${Math.round(w.reach.range)} m</text>`;
  return svg;
}

// The view down the tube: the weapon's own first-person rig and HUD scope,
// the tank at its distance (`tank-sight-view.js`).
let sightView = null;
const rigIndexes = new Map(), rigScenes = new Map(), scopeTables = new Map();
/** The rig indexes to ask, the tree's own then vanilla's: a mod inherits
 *  vanilla's rigs as it inherits its models (Desert Combat's Bazooka). */
const rigIndexesOf = () => {
  if (!rigIndexes.has(arenaMod.id)) {
    const own = json(`${arenaMod.paths.models}/viewmodels/index.json`).catch(() => null);
    rigIndexes.set(arenaMod.id, Promise.all([own, arenaMod.id === VANILLA.id ? null : json('models/viewmodels/index.json').catch(() => null)]));
  }
  return rigIndexes.get(arenaMod.id);
};
const scopesOf = () => {
  if (!scopeTables.has(arenaMod.id)) {
    scopeTables.set(arenaMod.id, json(`${arenaMod.paths.maps}/_shared/hud/scopes.json`).catch(() => null)
      .then(t => t ?? (arenaMod.id === VANILLA.id ? null : json('maps/_shared/hud/scopes.json').catch(() => null))));
  }
  return scopeTables.get(arenaMod.id);
};
/** The scope picture a weapon draws zoomed, or null: the pack's `scopes.json`
 *  (SCOPE-2), else the weapon's own zoom block; `sniper.tga` for one that
 *  names none (SCOPE-6). */
async function scopeOf(w) {
  const optic = (await scopesOf())?.[w.name.toLowerCase()] ?? null;
  if (!(optic?.useScope ?? w.zoom?.scope)) return null;
  const icon = optic?.scopeIcon || w.zoom?.icon || 'sniper.tga';
  const stem = String(icon).replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  return [`${arenaMod.paths.maps}/_shared/hud/${stem}.png`, `maps/_shared/hud/${stem}.png`];
}
/** The side's soldier on the arena's first battle (`loadouts.json`). */
function soldierOf(loadouts, side) {
  const team = side === 'Axis' ? '1' : '2';
  const want = (arena.levels ?? []).map(l => String(l).toLowerCase());
  for (const [level, teams] of Object.entries(loadouts?.levels ?? {})) {
    if (want.length && !want.includes(level.toLowerCase())) continue;
    if (teams?.[team]?.soldier) return teams[team].soldier;
  }
  return null;
}
async function rigOf(w, side) {
  const soldier = soldierOf(await loadoutsOf(), side);
  const stem = (await rigIndexesOf()).map(index => rigStemFor(index, soldier, w.name)).find(Boolean) ?? null;
  if (!stem) return null;
  if (!rigScenes.has(stem)) {
    rigScenes.set(stem, (async () => {
      gltfLoader ??= new GLTFLoader();
      for (const url of modelUrls(arenaMod.paths.models, `viewmodels/${stem}.fp.glb`)) {
        try { return { stem, gltf: await gltfLoader.loadAsync(url) }; } catch { /* the next tree */ }
      }
      return null;
    })());
  }
  return rigScenes.get(stem);
}

let sightRun = 0;
const rigKeyGuess = w => [...rigScenes.keys()].find(k => k.toLowerCase().endsWith(`__${w.name.toLowerCase()}`)) ?? null;
async function drawThroughSight(w, R, aim, target, side) {
  const run = ++sightRun;
  const box = ui.footSight.querySelector('.tks-foot-sight');
  const canvas = box.querySelector('canvas'), hud = box.querySelector('.tks-foot-hud'), scope = box.querySelector('.tks-foot-scope');
  const waitTag = box.querySelector('.tks-foot-sight-wait');
  const words = ui.footSight.querySelector('.tks-sight-words');
  try { sightView ??= createSightView(canvas); } catch { sightView = null; }
  if (!sightView) { words.textContent = 'This browser could not draw the view down the tube.'; return; }
  sightView.setTank(`${target.template}`, target.scene, target.snaps.side.widthM);
  // Nothing of the last weapon's view stays up while this one's rig loads.
  if (!rigScenes.has(rigKeyGuess(w))) { scope.hidden = true; hud.innerHTML = ''; words.textContent = ''; }
  waitTag.hidden = false;
  const [held, scopeUrls] = await Promise.all([rigOf(w, side), scopeOf(w)]);
  if (run !== sightRun) return;
  waitTag.hidden = true;
  const doc = held?.gltf?.parser?.json?.extras ?? held?.gltf?.userData ?? null;
  const view = doc?.view ?? null;
  sightView.setRig(held?.stem ?? null, held?.gltf ?? null, view);
  // The world through the weapon's zoomed field of view (radians), the arms
  // through `set1pFov x soldierZoomFov`.
  const worldFov = (Number(view?.zoomFov ?? w.zoom?.fov) || 1) * 180 / Math.PI;
  const armsFov = (Number(view?.fov1p) || 0.47) * (Number(view?.soldierZoomFov ?? w.zoom?.soldierFov) || 1) * 180 / Math.PI;
  const W = 640, H = 480;
  const { toScreen, pxPerRad } = sightView.draw({ R, elevation: aim.elevation ?? 0, worldFov, armsFov, width: W, height: H });
  // The scope picture over the whole frame (SCOPE-4), the mod's own or vanilla's.
  scope.hidden = !scopeUrls;
  if (scopeUrls) {
    scope.onerror = () => { if (scope.src.endsWith(scopeUrls[0].split('/').pop()) && !scope.dataset.tried) { scope.dataset.tried = '1'; scope.src = scopeUrls[1]; } else scope.hidden = true; };
    delete scope.dataset.tried;
    scope.src = scopeUrls[0];
  }
  // The HUD: the crosshair at the centre, where the tube points, and where the
  // round comes down: the tank's middle at the tube's height, with its spread.
  let svg = '';
  if (w.crossHair !== 'CHTNone') svg += `<path class="tks-foot-cross" d="M${W / 2 - 14} ${H / 2}h9M${W / 2 + 5} ${H / 2}h9M${W / 2} ${H / 2 - 14}v9M${W / 2} ${H / 2 + 5}v9"/>`;
  if (aim.elevation != null) {
    const p = toScreen(new THREE.Vector3(0, 0, -R));
    const box2 = (h, cls) => { const r = Math.tan(h / 100) * pxPerRad; return `<rect class="tks-foot-spread ${cls}" x="${(p.x - r).toFixed(1)}" y="${(p.y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}"/>`; };
    if (w.spread.declared && w.spread.still > 0) svg += box2(w.spread.moving, 'is-moving') + box2(w.spread.still, 'is-still');
    svg += `<circle class="tks-foot-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`;
    const gap = p.y - H / 2;
    if (gap > 18) svg += `<line class="tks-foot-gap" x1="${W / 2}" y1="${H / 2 + 16}" x2="${W / 2}" y2="${(p.y - 8).toFixed(1)}"/>`
      + `<text class="tks-foot-label" x="${W / 2 + 10}" y="${((H / 2 + p.y) / 2 + 4).toFixed(1)}">${n1(aim.elevation)}&#176;</text>`;
    svg += `<text class="tks-foot-label" x="${(p.x + 12).toFixed(1)}" y="${(p.y + 4).toFixed(1)}">lands here</text>`;
  }
  hud.innerHTML = svg;
  const where = !held ? ' No first-person rig of it is published, so the arms are not drawn.' : '';
  words.textContent = aim.elevation == null
    ? `Out of reach: it goes ${Math.round(w.reach.range)} m at most.${where}`
    : `The crosshair is where the tube points; the dot is where the round comes down on the ${target.tank.name}${w.spread.declared && w.spread.still > 0 ? ', inside the box standing still, the dashed box walking' : ''}. ${Math.abs(aim.elevation) < 0.25 ? 'Put the crosshair on the tank' : `Put the crosshair ${n1(Math.abs(aim.elevation))} deg ${aim.elevation > 0 ? 'above' : 'below'} the tank`}: the dot then sits on it.${scopeUrls ? ' The scope picture is the weapon\'s own HUD.' : ''}${where}`;
}

/** Every weapon of the side against the target, one row each. */
function drawFootTable() {
  const { target } = footPair();
  if (!target || !foot.weapons.length) return;
  const cell = v => `<td>${v}</td>`;
  const at = (w, R) => { const a = aimFor(w, R); return a.elevation == null ? 'out of reach' : `${n1(a.elevation)} deg`; };
  const R = Math.min(Number(ui.footRange.value), Number(ui.footRange.max));
  ui.footTable.innerHTML = `<thead><tr><th>Weapon</th><th>Speed</th><th>Reaches</th><th>Up at 25 m</th><th>Up at 50 m</th><th>Up at 100 m</th><th>Spread at 50 m<small>still, per axis</small></th><th>Hits to kill at ${R} m<small>front / side / rear</small></th></tr></thead><tbody>`
    + foot.weapons.map(w => {
      const sh = footShots(footRose(target, w, R));
      const h = b => (sh[b]?.shots == null ? '-' : sh[b].shots > NO_ANSWER ? `${NO_ANSWER}+` : sh[b].shots);
      return `<tr${w.name === foot.pick ? ' class="is-picked"' : ''}><th scope="row">${esc(w.label)}</th>${cell(`${n1(w.gun.speed)} m/s`)}${cell(`${Math.round(w.reach.range)} m`)}`
        + `${cell(at(w, 25))}${cell(at(w, 50))}${cell(at(w, 100))}${cell(w.spread.declared ? `${n1(strayAt(w.spread.still, 50))} m` : 'none')}${cell(`${h(0)} / ${h(90)} / ${h(180)}`)}</tr>`;
    }).join('') + '</tbody>';
}

ui.footWhose.addEventListener('click', e => {
  const b = e.target.closest('button[data-whose]');
  if (!b || b.dataset.whose === foot.whose) return;
  foot.whose = b.dataset.whose;
  store(`${KEY}:foot-whose`, foot.whose);
  drawFoot();
});
ui.footPicks.addEventListener('click', e => {
  const b = e.target.closest('button[data-weapon]');
  if (!b) return;
  foot.pick = b.dataset.weapon;
  store(`${KEY}:foot-pick`, foot.pick);
  for (const x of ui.footPicks.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
  drawFootPick();
  if (ui.footMore.open) drawFootTable();
});
ui.footRange.addEventListener('input', () => { drawFootPick(); if (ui.footMore.open) drawFootTable(); });
ui.footMore.addEventListener('toggle', () => { if (ui.footMore.open) drawFootTable(); });

// --- 06: the rules of the mod's own war ---------------------------------------------------

/** The rules card, by tree: BF1918's are 1917-18's (features/tank-doctrine-
 *  1918), Desert Combat's 1991's (features/tank-doctrine-1991). Each module
 *  gives `CARD` (the card's words), `rulesOn(ctx)` and `FIGHT`, the fight of
 *  its war the card opens with. Any other tree shows no card. */
const DOCTRINES = [
  { tree: /^bf1918$/i, ...doctrine1918 },
  { tree: /^(desertcombat|dc_final)$/i, ...doctrine1991 },
];
const doctrineOf = m => DOCTRINES.find(d => d.tree.test(m?.id ?? '')) ?? null;
const CARD_ANCHOR = { '01': 'tks-h-armour', '02': 'tks-h-guns', '03': 'tks-h-steady', '04': 'tks-h-drive', '05': 'tks-h-foot' };
const STATUS_WORD = { holds: 'Holds', differs: 'The game differs', partly: 'In part', 'not here': 'Not in the school yet' };
let rulesTicket = 0;

/** A clock of `material`'s hits (its blast with it) on an entry's hull, at the three faces. */
function shotsOn(entry, material, damage = null, { atContact = false } = {}) {
  if (material == null) return null;
  const rose = bearingShots(entry.scene, pricer(tables, material), entry.tank.hp,
    { bearings: [0, 90, 180], blast: damage ? blastOf(tables, damage, entry.scene, { atContact }) : null });
  return footShots(rose);
}
/** Metres of hull above the gun's muzzle: what must show to fire over a crest. */
function exposedOf(entry) {
  const snap = entry.snaps?.side;
  if (!snap?.tip || !snap.pxPerM) return null;
  return Math.max(0, snap.heightM - (snap.groundY - snap.tip.y) / snap.pxPerM);
}

async function drawRules(youW, themW) {
  const ticket = ++rulesTicket;
  const pack = doctrineOf(arenaMod);
  ui.rules.hidden = !pack;
  ui.rulesJump.hidden = !pack;
  if (!pack) { window.__tankSchool.rules = null; return; }
  ui.rulesHead.textContent = pack.CARD.head;
  ui.rulesIntro.textContent = pack.CARD.intro;
  ui.rulesJump.textContent = pack.CARD.jump;
  ui.rulesWait.textContent = pack.CARD.wait;
  q('.tks-duel-eyebrow').textContent = pack.CARD.eyebrow;
  ui.duelGo.textContent = pack.CARD.go;
  const [them, you] = current.entries;
  const theirSide = theirs().side;
  const youT = { ...youW, lengthM: you.snaps.side.widthM, heightM: you.snaps.side.heightM, exposed: exposedOf(you) };
  const themT = { ...themW, lengthM: them.snaps.side.widthM, heightM: them.snaps.side.heightM, exposed: exposedOf(them) };
  // The first pass, with what is at hand; the field guns and the soldiers'
  // weapons are fetched and priced, then the card is drawn again.
  const mg = them.tank.mg ? { label: `${them.tank.name}'s machine gun`, shots: shotsOn(you, them.tank.mg.material, them.tank.mg.damage) } : null;
  // Your own hull's automatic gun on theirs (a Bradley's 25 mm beside its TOW).
  const ownMg = you.tank.mg ? { label: `${you.tank.name}'s automatic gun`, shots: shotsOn(them, you.tank.mg.material, you.tank.mg.damage) } : null;
  const ctx = { you: youT, them: themT, mg, ownMg, fieldGuns: null, foot: null, air: null, carriers: null };
  paintRules(ctx, pack);
  ui.rulesWait.hidden = false;
  const [guns, mgs, loadouts, air, carriers] = await Promise.all([fieldGunsOf(theirSide), ctx.mg ? [] : fieldGunsOf(theirSide, 'mg'), loadoutsOf(),
    pack.CARD.air ? armsOfSide(theirSide, 'air') : [], pack.CARD.carriers ? armsOfSide(theirSide, 'carrier') : []]);
  const names = sideWeapons(loadouts, arena.every ? [] : arena.levels, theirSide);
  const carried = (await Promise.all(names.map(n => weaponOf(n.name).then(w => (w ? { ...w, pickup: n.pickup } : null))))).filter(w => w && !w.placed);
  if (ticket !== rulesTicket) return;
  // No machine gun on their tank (a gun FT-17): their side's emplaced one.
  if (!ctx.mg && mgs[0]) ctx.mg = { label: mgs[0].label, shots: shotsOn(you, mgs[0].material, mgs[0].damage) };
  ctx.fieldGuns = guns.map(g => {
    const blast = splashSpec(g.damage);
    return { label: g.label, speed: g.gun.speed, gravity: g.gun.gravity, reload: g.rof ? Math.ceil(30 / g.rof - 1e-9) / 30 : null,
      radius: blast?.radius ?? 0, shots: shotsOn(you, g.material, g.damage) };
  });
  ctx.foot = carried.map(w => {
    const blast = splashSpec(w.damage);
    const charge = Boolean(blast && !blast.impact);
    const d = w.damage ?? {};
    const falls = Number(d.minDamage) < 1 && Number(d.distToStartLoseDamage) > 0;
    return { label: w.label, charge, pickup: Boolean(w.pickup), fuse: charge ? w.ttl : null, shots: footShots(footRose(you, w, 0)),
      speed: w.gun.speed, gravity: w.gun.gravity,
      full: falls ? Number(d.distToStartLoseDamage) : null, min: falls ? Number(d.distToMinDamage) : null, floor: falls ? Number(d.minDamage) : null };
  });
  // Their aircraft's weapons and their missile carriers, each priced on your hull.
  const priced = list => list.map(w => ({ ...w, shots: shotsOn(you, w.material, w.damage) }));
  ctx.air = priced(air);
  ctx.carriers = priced(carriers);
  ui.rulesWait.hidden = true;
  paintRules(ctx, pack);
}

function paintRules(ctx, pack) {
  const rules = pack.rulesOn(ctx);
  const head = side => `<li class="tks-rule-head">${side === 'crew' ? 'For the tank crew' : 'For fighting a tank'}</li>`;
  let html = '', last = null;
  for (const r of rules) {
    if (r.side !== last) { html += head(r.side); last = r.side; }
    const v = r.verdict;
    const see = CARD_ANCHOR[r.card] ? `<a class="tks-rule-see" href="#${CARD_ANCHOR[r.card]}" data-card="${r.card}">See ${r.card}</a>` : '';
    html += `<li class="tks-rule is-${v.status.replace(' ', '-')}" data-rule="${esc(r.id)}"><span class="tks-rule-n">${r.n}</span><div class="tks-rule-body">`
      + `<b>${esc(r.name)}</b><p class="tks-rule-plain">${esc(r.rule)}</p>`
      + (r.quote ? `<q>${esc(r.quote)}</q>` : '')
      + `<small class="tks-rule-src"><a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.doc)}</a>, ${esc(r.source.date)}${r.source.where ? `: ${esc(r.source.where)}` : ''}</small>`
      + `<p class="tks-rule-here"><em>${esc(STATUS_WORD[v.status] ?? v.status)}</em>${esc(v.words)}</p>${see}</div></li>`;
  }
  ui.ruleList.innerHTML = html;
  paintDuel(ctx, pack);
  window.__tankSchool.rules = rules.map(r => ({ id: r.id, status: r.verdict.status, words: r.verdict.words }));
}

/** The pack's fight (Villers-Bretonneux, 73 Easting): the story, and on its
 *  own pairing what the engine makes of it; elsewhere a way there. */
const fightArena = vb => arenas.find(a => a.map === vb.arena)
  ?? arenas.find(a => a.tanks.some(t => t.template === vb.yours) && a.tanks.some(t => t.template === vb.theirs));
function paintDuel(ctx, pack) {
  const vb = pack.FIGHT;
  const box = ui.duel;
  box.querySelector('h3').textContent = vb.title;
  box.querySelector('.tks-duel-story').innerHTML = vb.story.map(p => `<p>${esc(p)}</p>`).join('');
  box.querySelector('.tks-duel-src').innerHTML = vb.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.doc)}</a>`).join(' · ');
  const here = yours().template === vb.yours && theirs().template === vb.theirs;
  const there = fightArena(vb);
  const go = ui.duelGo;
  go.hidden = here || !there;
  if (there) {
    const next = new URL(location.href);
    next.searchParams.set('arena', there.map);
    next.searchParams.set('yours', vb.yours);
    next.searchParams.set('theirs', vb.theirs);
    go.href = next.href;
  }
  let words = [];
  if (here) {
    const [them, you] = current.entries;
    // Your own hull's machine gun on theirs (Villers-Bretonneux's females).
    const femaleMg = you.tank.mg ? { shots: shotsOn(them, you.tank.mg.material, you.tank.mg.damage) } : null;
    words = vb.duel({ ...ctx, femaleMg });
  }
  box.querySelector('.tks-duel-words').innerHTML = words.map(w => `<li>${esc(w)}</li>`).join('');
}
ui.duelGo.addEventListener('click', e => {
  e.preventDefault();
  const vb = doctrineOf(arenaMod)?.FIGHT;
  const there = vb && fightArena(vb);
  if (!there) return;
  arena = there;
  store(ARENA_KEY, arena.map);
  yoursChoice = vb.yours;
  theirsChoice = vb.theirs;
  refresh().then(() => q('.tks-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});
root.addEventListener('click', e => {
  const a = e.target.closest('a.tks-rule-see, a.tks-rules-jump');
  if (!a) return;
  const id = a.getAttribute('href').slice(1);
  const el = root.querySelector(`#${id}`)?.closest('section');
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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
  them.blast = blastOf(tables, you.tank.shellDamage, them.scene);
  you.blast = blastOf(tables, them.tank.shellDamage, you.scene);
  current.entries = [them, you];
  for (const t of stage.pair) stage.scene.remove(t.group);
  stage.pair = [them, you].map(e => ({ ...stageTank(e.scene, e.price, e.tank.hp), tank: e.tank }));
  for (const t of stage.pair) stage.scene.add(t.group);
  setShow(stage.show);
  // The words read each hull's clock at eye level.
  const rose = e => roseFor(e, 0);
  // The words read the clock as the gunner aims: hits on a plate the gun
  // gets through, with how much of the side those plates cover.
  const shotsOf = e => Object.fromEntries(Object.entries(rose(e) ?? {}).map(([b, v]) => [b,
    { shots: v.share > 0 ? v.hurtShots : null, bestShots: v.bestShots, share: v.share }]));
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
  drawFoot();
  drawRules(youW, themW);
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
/** The fight in the STUDY view, in its own mod's trees. */
function studyHref(f) {
  const next = new URL(fightMatchupHref(f));
  next.searchParams.set('view', 'study');
  next.searchParams.set('fight', f.id);
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
      + `<a class="tks-toggle tks-f-study" href="${esc(studyHref(f))}" data-fight="${esc(f.id)}" data-mod="${esc(f.mod || VANILLA.id)}" title="The fight recreated to learn from: from above, through each gunner's sight, and the hulls' speed and pitch">Study</a>`
      + `<a class="tks-toggle" href="${esc(fightMatchupHref(f))}">Matchup</a></div></li>`;
  }).join('');
  ui.fightMore.hidden = rows.length <= fightState.shown;
}
ui.fights.addEventListener('click', e => {
  // A fight of this page's mod opens here; another mod's reloads in its trees.
  const study = e.target.closest('a.tks-f-study');
  if (study && study.dataset.mod === treeOf(arenaMod) && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openStudy(study.dataset.fight);
    return;
  }
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
  const fights = view === 'fights', studying = view === 'study';
  ui.fights.hidden = !fights;
  ui.study.hidden = !studying;
  ui.board.hidden = fights || studying;
  if (!studying) study.close();
  // A study is one of the fights.
  root.querySelectorAll('.dfs-rail [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === (studying ? 'fights' : view))));
  const address = new URL(location.href);
  if (fights || studying) address.searchParams.set('view', view); else address.searchParams.delete('view');
  if (!studying) address.searchParams.delete('fight');
  history.replaceState(null, '', address);
  if (fights) drawFights(); else if (!studying) requestAnimationFrame(resizeStage);
  root.querySelector('.tks-main:not([hidden])')?.scrollTo?.(0, 0);
}
const study = mountStudy(root, {
  loadModel: template => loadTankModel(template),
  prettyTank, playerName: decodePlayerName,
  fightUrl: id => new URL(`replays/tankfights/${encodeURIComponent(id)}.json`, VIEWER_ROOT).href,
  watchUrl: row => (row.replay ? new URL(row.replay, VIEWER_ROOT).href : '#'),
  matchupUrl: row => (row.a ? fightMatchupHref(row) : '#'),
  back: () => setView('fights'),
});
function openStudy(id) {
  setView('study');
  const address = new URL(location.href);
  address.searchParams.set('fight', id);
  history.replaceState(null, '', address);
  study.open(id);
}
root.querySelector('.dfs-rail').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});

drawMods();
drawLegend();
setBearing(30, { animate: false });
window.__tankSchool = { arenas, get arena() { return arena.map; }, get yours() { return yours()?.template; }, get theirs() { return theirs()?.template; },
  get entries() { return current.entries.map(e => e.tank); }, roseFor: (i, el = 0) => roseFor(current.entries[i], el), stage, ready: false,
  get study() { return study.state; } };
wait.hidden = true;
if (params.get('view') === 'fights') setView('fights');
else if (params.get('view') === 'study' && params.get('fight')) openStudy(params.get('fight'));
await refresh();
