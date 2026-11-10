// The proving ground's instruments (features/proving-ground), over the level
// `proving-ground.js` builds: what a player practising with a weapon wants to
// see that a battle never shows.
//
// - Every round the player fires draws its path. Where it stops, a row goes
//   into the hit log on the right: what it met and where (the vehicle and
//   the face, or the soldier and the bone), the hit points taken and what is
//   left, how far it flew and for how long, how far it fell below its launch
//   line. A round whose fuse ran out in the air says so, at the range it
//   reached: the weapon's reach, measured.
// - A hit on a vehicle draws the vehicle's collision model on the hit
//   card at the top of the log, seen from where the round came, every part
//   coloured by what this weapon does to it, the struck part lit, the point
//   marked and the round's line drawn in; the card names the part, the cost
//   and the weakest part for this weapon.
// - The arsenal (B): a faction, then a kit, and the kit is in hand at once,
//   no spawn; or a vehicle, and the player is in its seat; or a station on
//   the range to stand at. The Matrix's racks, over the battle's own kits
//   (`_shared/loadouts.json`) and the vehicles parked on the floor.
// - X stands the player where the crosshair points: the floor there, or
//   beside the hull there.
// - The collision mesh (H) colours every vehicle on the floor by its
//   collision parts, priced for the weapon in hand from the same
//   MaterialManager tables the round is priced with (`damage.json`): how
//   many hits each part takes to destroy it. The part under the crosshair is
//   named in the readout.
// - U puts a marker where the round would land if fired now, worked from the
//   launch speed, fall and fuse of the last round this weapon fired. It needs
//   one shot to learn the weapon; a rocket's motor is not in it, and it says
//   so.
// - A rangefinder: the distance to whatever is under the crosshair.
//
// Nothing here prices or moves anything but the player himself (a teleport
// into a vehicle's seat); it reads the page's guns and draws.

import * as THREE from 'three';
import { PG, PG_COLOURS } from './proving-ground.js';
import { createSilhouetteRange, SILHOUETTE, SILHOUETTE_LANE_X } from './proving-targets.js';
import { fighterRank, lessonById, jetName } from './dogfight-lessons.js';

/** Where the kit bench stands: at the firing range's point, a step behind the line. */
export const BENCH = Object.freeze({ x: SILHOUETTE_LANE_X, z: PG.LINE_Z + 7, height: 0.86, spacing: 1.6, depth: 1.2 });

/**
 * The bench's slots for `kits` (names), centred on the bench: `{ kit, x, y,
 * z }` each, `floorY` the floor. Pure, for the tests.
 */
export function benchSlots(kits, floorY = PG.FLOOR, bench = BENCH) {
  const n = kits.length;
  const x0 = bench.x - ((n - 1) * bench.spacing) / 2;
  return kits.map((kit, i) => ({ kit, x: x0 + i * bench.spacing, y: floorY + bench.height + 0.02, z: bench.z }));
}

const fmtOff = m => (m < 0.995 ? `${(m * 100).toFixed(0)} cm` : `${m.toFixed(1)} m`);

/**
 * How far a hit at `point` sits from the mark at `centre`, in the words a
 * spotter uses to a shooter facing down the range (-z, so his right is
 * +x): "12 cm left · 5 cm high", or "dead centre" inside `close` metres.
 */
export function spotWords(point, centre, close = 0.04) {
  const dx = point[0] - centre[0];
  const dy = point[1] - centre[1];
  const parts = [];
  if (Math.abs(dx) >= close) parts.push(`${fmtOff(Math.abs(dx))} ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dy) >= close) parts.push(`${fmtOff(Math.abs(dy))} ${dy > 0 ? 'high' : 'low'}`);
  return parts.length ? parts.join(' · ') : 'dead centre';
}

/**
 * A miss on the floor near a mark at `base` (its foot), in the same words
 * along the range: "1.3 m right · 60 cm short" (short is nearer the
 * shooter, +z; over is past it).
 */
export function missWords(point, base) {
  const dx = point[0] - base[0];
  const dz = point[2] - base[2];
  const parts = [];
  if (Math.abs(dx) >= 0.05) parts.push(`${fmtOff(Math.abs(dx))} ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dz) >= 0.05) parts.push(`${fmtOff(Math.abs(dz))} ${dz > 0 ? 'short' : 'over'}`);
  return parts.length ? `missed by ${parts.join(' · ')}` : 'at its foot';
}

/** Rounds whose paths are kept, newest first. */
const TRACE_MAX = 24;
/** Seconds a finished path stays up. */
const TRACE_HOLD = 14;
/** Points kept along one path (a sample every frame, thinned past this). */
const TRACE_POINTS = 240;
/** Rows the hit log keeps, newest first. */
export const LOG_MAX = 40;
const GRAVITY = -9.81;

/**
 * A collision material in a player's words. The table's own label where it
 * has one; else the armour range it sits in. Vanilla's tank faces are 50
 * rear, 51 side and 52 front (features/bf1942-3d-models, "The face material"),
 * and 53 and 54 sit above them in protection; a mod's own numbers keep the
 * range's name.
 */
export function materialName(id, tables = null) {
  const label = tables?.[id]?.label;
  if (label) return label;
  const named = { 50: 'rear armour', 51: 'side armour', 52: 'front armour', 53: 'heavy armour',
                  54: 'heaviest armour', 46: 'wheels', 66: 'wooden deck' };
  if (named[id]) return named[id];
  if (id >= 40 && id <= 42) return 'soldier';
  if (id >= 43 && id <= 47) return 'light armour';
  if (id >= 55 && id <= 59) return 'naval armour';
  if (id >= 60 && id <= 62) return 'aircraft';
  return `material ${id}`;
}

/** Hits-to-destroy bands, most vulnerable first, and their colours. */
const BANDS = [
  { max: 1, label: '1', color: 0xd64545 },
  { max: 2, label: '2', color: 0xe07a2e },
  { max: 4, label: '3-4', color: 0xd9b43a },
  { max: 9, label: '5-9', color: 0x8fa64a },
  { max: Infinity, label: '10+', color: 0x5f7f86 },
];
const IMMUNE = 0x3a3d42;

/** The band a hits-to-destroy count falls in, or null for no damage. */
export function hitBand(hits) {
  if (!(hits > 0) || !Number.isFinite(hits)) return null;
  return BANDS.find(b => hits <= b.max) ?? BANDS[BANDS.length - 1];
}

/** Hits of `damage` a part takes to destroy `hp`, or Infinity for none. */
export function hitsToDestroy(hp, damage) {
  if (!(damage > 0) || !(hp > 0)) return Infinity;
  return Math.ceil(hp / damage - 1e-9);
}

/**
 * Where a round fired now lands: `origin` and unit `dir` (world, glb frame),
 * `speed` m/s, `g` the round's fall (m/s^2, negative), `ttl` its fuse in
 * seconds, `floor(x, z)` the ground's height. Point physics, no drag, no
 * motor. Returns `{ point, time, range, expired }`, or null for a round that
 * never comes down within its fuse and goes nowhere (zero speed).
 */
export function predictImpact(origin, dir, speed, g, ttl, floor, step = 1 / 120) {
  if (!(speed > 0) || !(ttl > 0)) return null;
  let x = origin[0], y = origin[1], z = origin[2];
  let vx = dir[0] * speed, vy = dir[1] * speed, vz = dir[2] * speed;
  let t = 0;
  while (t < ttl) {
    const dt = Math.min(step, ttl - t);
    const nx = x + vx * dt, ny = y + vy * dt + 0.5 * g * dt * dt, nz = z + vz * dt;
    vy += g * dt;
    const ground = floor(nx, nz);
    if (ny <= ground) {
      // Back along the step to the ground, linearly: one step is under 4 m.
      const a = (y - floor(x, z)) / Math.max(1e-6, (y - floor(x, z)) - (ny - ground));
      const px = x + (nx - x) * a, pz = z + (nz - z) * a;
      const point = [px, floor(px, pz), pz];
      return { point, time: t + dt * a, range: Math.hypot(px - origin[0], pz - origin[2]), expired: false };
    }
    x = nx; y = ny; z = nz; t += dt;
  }
  return { point: [x, y, z], time: ttl, range: Math.hypot(x - origin[0], z - origin[2]), expired: true };
}

const fmtM = m => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtS = s => `${s.toFixed(s < 10 ? 2 : 1)} s`;
const fmtHp = hp => (hp >= 10 ? hp.toFixed(0) : hp.toFixed(1));
const fmtDrop = d => `${d < 10 ? d.toFixed(1) : Math.round(d)} m`;

/** A template's name for a player: `WalterP38` is "Walter P38", `KnifeAxis`
 *  "Knife Axis", `3German_ATPanzerfaust100` "3German AT Panzerfaust 100". */
export function prettyName(template) {
  return String(template ?? '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, (m, d, l, at) => (at === 0 ? m : `${d} ${l}`))
    .replace(/\s+/g, ' ')
    .trim();
}

/** A side's nation code, as its people call themselves. */
const NATION_NAMES = {
  ger: 'German', us: 'American', brit: 'British', rus: 'Soviet', jp: 'Japanese', can: 'Canadian',
  it: 'Italian', fr: 'French', pol: 'Polish', fin: 'Finnish', hun: 'Hungarian', rom: 'Romanian',
};

/**
 * The hit log's words for one finished round. `result` is the trace's
 * record: `flew`, `time`, `drop`, `expired`, and `hit` (null where it met the
 * floor or nothing), `hit` being `{ what, where, damage, left, max, angle,
 * soldier }`. Returns `{ kind, title, detail }`, `kind` one of `hit`
 * (something was hurt), `dud` (something was met and not hurt), `floor`,
 * `fuse`.
 */
export function logRow(result, weapon = null) {
  const range = `${fmtM(result.flew)} · ${fmtS(result.time)}`;
  const fell = result.drop >= 0.05 ? ` · fell ${fmtDrop(result.drop)}` : '';
  const by = weapon ? `${prettyName(weapon)} · ` : '';
  if (result.hit) {
    const h = result.hit;
    const title = h.where ? `${h.what} · ${h.where}` : h.what;
    if (h.silhouette) return { kind: 'hit', title, detail: `${by}down · ${range}` };
    if (h.damage > 0) {
      const left = h.soldier ? '' : ` · ${fmtHp(Math.max(0, h.left ?? 0))}/${fmtHp(h.max ?? 0)} left`;
      const angle = h.angle != null && h.angle < 0.995 ? ` · angle x${h.angle.toFixed(2)}` : '';
      return { kind: 'hit', title, detail: `${by}-${fmtHp(h.damage)} hp${left}${angle} · ${range}` };
    }
    return { kind: 'dud', title, detail: `${by}no damage · ${range}${fell}` };
  }
  if (result.expired) return { kind: 'fuse', title: 'fuse ran out', detail: `${by}${range}${fell}` };
  return { kind: 'floor', title: 'floor', detail: `${by}${range}${fell}` };
}

/**
 * The range's stations, where the arsenal can stand the player: so many
 * metres short of the first target row, down the lane's centre, and the far
 * end. `rows` are the target rows' ranges from the firing line; a station
 * is kept only where the floor is (`z` under -10).
 */
export function standStations(rows = PG.ROWS) {
  const first = PG.LINE_Z - (rows[0] ?? 100);
  const out = [];
  for (const d of [10, 25, 50, 100, 150, 200, 300, 400]) {
    const z = first + d;
    if (z > -10) continue;
    const note = d === (rows[0] ?? 100) ? ' (the firing line)' : '';
    out.push({ id: `short-${d}`, label: `${d} m short of the targets${note}`, x: PG.LINE_X, z, yaw: 0 });
  }
  out.push({ id: 'far-end', label: 'The far end, looking back', x: PG.LINE_X, z: PG.LINE_Z - PG.ENEMY_RANGE + 20, yaw: 180 });
  out.push({ id: 'silhouettes', label: 'The silhouette range', x: SILHOUETTE_LANE_X, z: PG.LINE_Z, yaw: 0 });
  return out;
}

/** The part a weapon destroys a vehicle through soonest: `parts` are
 *  `{ defense, hits }`; the fewest hits wins, the first of equals. Null when
 *  nothing is hurt. */
export function weakestPart(parts) {
  let best = null;
  for (const p of parts ?? []) {
    if (!(p.hits > 0) || !Number.isFinite(p.hits)) continue;
    if (!best || p.hits < best.hits) best = p;
  }
  return best;
}

/**
 * The arsenal's racks: each side of the battle, its nation and the kits the
 * level binds to its rows, in row order, each with the items it carries.
 * `loadouts` is `_shared/loadouts.json` as the level sees it, `dir` the
 * level's folder (`levels[dir]`), `nationOf(team)` the page's answer for a
 * side's nation code where the kits do not name it. A side the file does
 * not know has no kits and is left out.
 */
export function arsenalFactions(loadouts, dir, nationOf = () => null) {
  const level = loadouts?.levels?.[dir] ?? loadouts?.levels?.[String(dir ?? '').toLowerCase()];
  const out = [];
  for (const team of [1, 2]) {
    const side = level?.[team] ?? level?.[String(team)];
    if (!side) continue;
    const slots = side.slots ?? {};
    const names = Array.isArray(slots) ? slots.map((n, i) => [i, n]) : Object.entries(slots).map(([i, n]) => [Number(i), n]);
    names.sort((a, b) => a[0] - b[0]);
    const kits = [];
    for (const [slot, name] of names) {
      const row = loadouts?.kits?.[name];
      if (!name || !row) continue;
      const weapons = Array.isArray(row.weapons) ? row.weapons : [];
      const slotted = new Set(weapons.map(w => String(w?.weapon ?? '').toLowerCase()));
      const items = (Array.isArray(row.items) && row.items.length ? row.items : weapons.map(w => w.weapon))
        .filter(n => n && (slotted.has(String(n).toLowerCase()) || /^Random/i.test(n) || !weapons.length))
        .map(n => ({ template: n, name: prettyName(String(n).replace(/^Random/i, '')),
                     primary: n === row.primary, rolled: /^Random/i.test(n) }));
      kits.push({
        name, slot, cls: row.class ?? null,
        label: row.kitName?.text || row.class || prettyName(name),
        primary: row.primary ?? null,
        items,
        hp: row.maxHitpoints ?? row.hitpoints ?? null,
      });
    }
    if (!kits.length) continue;
    const code = nationOf(team);
    const nation = kits.find(k => loadouts.kits[k.name]?.nation)?.name;
    const nationName = (nation && loadouts.kits[nation].nation) || NATION_NAMES[code] || (code ? code.toUpperCase() : null)
      || (team === 1 ? 'Axis' : 'Allied');
    out.push({ team, nation: nationName, side: team === 1 ? 'Axis' : 'Allied', soldier: side.soldier ?? null, kits });
  }
  return out;
}

/** A round's fall in m/s^2 from its launch record, as the flight steps it. */
function fallOf(shot) {
  return shot.gravity ? GRAVITY * shot.gravity * (shot.gravityScale ?? 1) : 0;
}

/** The round's current position (a tracer's round is `lead` ahead of its mesh). */
function roundAt(shot, out) {
  out.copy(shot.mesh.position);
  if (shot.lead && shot.velocity?.lengthSq() > 0) {
    out.addScaledVector(_dir.copy(shot.velocity).normalize(), shot.lead);
  }
  return out;
}

const _dir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Built once by the map page when the level is the proving ground. `page`
 * hands in getters: `scene`, `camera`, `guns`, `level` (its `extras`,
 * `spawnersRoot`, `vehicleDamage`, `groundHeight`, `currentDir`),
 * `damageVisuals`, `isLocalGroup(group)`, `handGroup()` (the hand weapon's
 * gun group, on foot), `seatGroups()` (the guns of the seat he holds),
 * `keyboardTaken()`, `covered()`, `stage` (the element the panels go in),
 * and for the arsenal: `loadouts`, `teamNation(team)`, `deployTeamId`,
 * `currentKit()`, `equipKit(kit, ammo, flag)`, `soldier`, `soldierDead`,
 * `occupancy`, `hullOpenTo(root, team)`, `isWreck(root)`, `spawnSeat`,
 * `enterVehicle`, `exitSeat`, `snapPresentation`, `capture()`, `release()`.
 */
export function createProvingGroundPage(page) {
  const root = new THREE.Group();
  root.name = 'provingGroundInstruments';
  page.scene.add(root);

  // --- the readout (top left) ----------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.innerHTML = `
    <div class="pg-head"><span class="pg-title">THE RANGE</span><span class="pg-battle"></span></div>
    <div class="pg-row"><span>WEAPON</span><b class="pg-weapon">-</b></div>
    <div class="pg-row"><span>RANGE</span><b class="pg-range">-</b></div>
    <div class="pg-row pg-predict-row" hidden><span>LANDS</span><b class="pg-predict">-</b></div>
    <div class="pg-zones" hidden>
      <div class="pg-sub">HITS TO DESTROY</div>
      <div class="pg-legend">${BANDS.map(b => `<i style="--c:#${b.color.toString(16).padStart(6, '0')}">${b.label}</i>`).join('')}<i style="--c:#${IMMUNE.toString(16)}">none</i></div>
      <div class="pg-row"><span>AIMED AT</span><b class="pg-aimed">-</b></div>
    </div>
    <div class="pg-keys"><kbd>M</kbd> map: click to go there <kbd>X</kbd> stand where you aim <kbd>G</kbd> take the kit you look at <kbd>B</kbd> arsenal <kbd>T</kbd> paths <kbd>H</kbd> collision mesh <kbd>U</kbd> landing point <kbd>J</kbd> clear</div>
    <button type="button" class="pg-btn pg-school-btn" hidden>DOGFIGHT SCHOOL<kbd>V</kbd></button>`;
  page.stage.appendChild(panel);
  panel.querySelector('.pg-school-btn').addEventListener('click', () => openSchool());
  const $ = sel => panel.querySelector(sel);
  const ui = {
    battle: $('.pg-battle'), weapon: $('.pg-weapon'), range: $('.pg-range'),
    predictRow: $('.pg-predict-row'), predict: $('.pg-predict'),
    zones: $('.pg-zones'), aimed: $('.pg-aimed'),
  };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  // --- the dogfight arena (`?arena=dogfight`) ------------------------------------
  // The construct as the dogfight school's arena (dogfight-arena.js): no
  // readout, hit log, kit bench, targets or boards, only the planes, and a
  // bar along the top saying what you fly and how to go again.
  const ARENA = page.arena === 'dogfight';
  const arenaBar = document.createElement('div');
  arenaBar.className = 'pg-arena';
  // Shown by the frame once the level is up (not over the loading screen).
  arenaBar.hidden = true;
  arenaBar.innerHTML = `<span class="pg-arena-title">DOGFIGHT ARENA</span><span class="pg-arena-what"></span>
    <span class="pg-arena-keys"><kbd>Q</kbd> change plane</span>`;
  page.stage.appendChild(arenaBar);

  // --- the hit log (right) -------------------------------------------------------
  const log = document.createElement('div');
  log.className = 'pg-log';
  log.innerHTML = `
    <div class="pg-log-head">
      <span class="pg-title">HIT LOG</span>
      <span class="pg-log-btns">
        <button type="button" class="pg-btn pg-paths-btn" aria-pressed="true" title="Draw each round's path and where it stopped (T)">
          <i></i><span>PATHS</span><kbd>T</kbd></button>
        <button type="button" class="pg-btn pg-mesh-btn" aria-pressed="false" title="Colour every vehicle by what the weapon in hand does to each part (H)">
          <i></i><span>COLLISION MESH</span><kbd>H</kbd></button>
      </span>
    </div>
    <div class="pg-card" hidden>
      <canvas class="pg-card-canvas" width="296" height="176" aria-hidden="true"></canvas>
      <div class="pg-card-text"><b class="pg-card-title"></b><small class="pg-card-detail"></small><small class="pg-card-weak"></small></div>
    </div>
    <ol class="pg-log-rows" role="list"></ol>
    <div class="pg-log-empty">Fire at something. Every round you land is written here: what you hit, where, and what it cost.</div>`;
  page.stage.appendChild(log);
  const logRows = log.querySelector('.pg-log-rows');
  const logEmpty = log.querySelector('.pg-log-empty');
  const meshBtn = log.querySelector('.pg-mesh-btn');
  meshBtn.addEventListener('click', () => showZones(!zonesOn));
  const pathsBtn = log.querySelector('.pg-paths-btn');
  pathsBtn.addEventListener('click', () => showPaths(!pathsOn));
  const rows = [];   // { el, row, n }
  let shotCount = 0;

  function logShot(result, weaponTemplate) {
    const row = logRow(result, weaponTemplate);
    const n = ++shotCount;
    const li = document.createElement('li');
    li.className = `pg-log-row is-${row.kind}`;
    li.innerHTML = `<span class="pg-log-n">${n}</span><div><b>${esc(row.title)}</b><small>${esc(row.detail)}</small></div>`;
    logRows.prepend(li);
    rows.unshift({ el: li, row, n });
    while (rows.length > LOG_MAX) rows.pop().el.remove();
    logEmpty.hidden = true;
    return row;
  }

  function clearLog() {
    for (const r of rows) r.el.remove();
    rows.length = 0;
    logEmpty.hidden = false;
  }

  // --- the hit card ---------------------------------------------------------------
  // The struck vehicle's collision model, its own small scene: every part a
  // copy of a collision mesh in the hull's frame, coloured by the band this
  // weapon puts it in, the struck one lit, the hit a dot and the round's last
  // metres a line in. Seen from the round's side, a little above, and
  // swinging gently so the depth reads.
  const cardEl = log.querySelector('.pg-card');
  const cardCanvas = log.querySelector('.pg-card-canvas');
  const cardUi = { title: log.querySelector('.pg-card-title'), detail: log.querySelector('.pg-card-detail'), weak: log.querySelector('.pg-card-weak') };
  let cardGl = null;
  const cardModels = new WeakMap();
  let cardLive = null;      // { model, centre, radius, view, age }
  function cardRenderer() {
    if (cardGl) return cardGl;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cardCanvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(cardCanvas.width, cardCanvas.height, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeafff3, 0x33423a, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.name = 'key';
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(32, cardCanvas.width / cardCanvas.height, 0.05, 500);
    cardGl = { renderer, scene, camera, key, held: null };
    return cardGl;
  }
  /** The vehicle's collision parts in its own frame, built once per hull. */
  function cardModelFor(vehicle) {
    if (cardModels.has(vehicle)) return cardModels.get(vehicle);
    vehicle.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(vehicle.matrixWorld).invert();
    const group = new THREE.Group();
    const parts = [];
    const bounds = new THREE.Box3();
    vehicle.traverse(obj => {
      if (!obj.isMesh || !obj.geometry?.userData?.collision) return;
      // A collision mesh carries no normals (nothing in the world shades
      // it); the card's lit material needs them, on a copy.
      let geometry = obj.geometry;
      if (!geometry.attributes.normal) {
        geometry = geometry.clone();
        geometry.userData = {};
        geometry.computeVertexNormals();
      }
      const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
        color: IMMUNE, shininess: 18, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      }));
      _m.multiplyMatrices(inv, obj.matrixWorld);
      _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrix();
      // The part's edges, so each box reads as a box whatever its colour.
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20),
        new THREE.LineBasicMaterial({ color: 0xc9ffe2, transparent: true, opacity: 0.45 }));
      mesh.add(edges);
      group.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      bounds.union(box);
      parts.push({ mesh, defense: obj.geometry.userData.defenseMaterial, box });
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3b2a, depthTest: false }));
    marker.renderOrder = 5;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff6a5a, depthTest: false }));
    line.renderOrder = 5;
    group.add(marker, line);
    const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.isEmpty() ? 3 : Math.max(1, bounds.getBoundingSphere(new THREE.Sphere()).radius);
    const model = { group, parts, marker, line, centre, radius };
    cardModels.set(vehicle, model);
    return model;
  }
  /** Where the round stopped on `vehicle`, seen on the card. `record` is the
   *  impact, `incoming` the round's last direction in the world. */
  function showCard(vehicle, record, incoming, hit) {
    const gl = cardRenderer();
    if (!gl || !vehicle) { cardCanvas.hidden = true; return; }
    const model = cardModelFor(vehicle);
    if (!model.parts.length) { cardCanvas.hidden = true; return; }
    cardCanvas.hidden = false;
    vehicle.updateMatrixWorld(true);
    const inv = _m.copy(vehicle.matrixWorld).invert();
    const point = new THREE.Vector3(...record.point).applyMatrix4(inv);
    const dir = incoming ? incoming.clone().transformDirection(inv).normalize() : new THREE.Vector3(0, 0, 1);
    // The struck part: the nearest of the material's parts to the point.
    let struck = null;
    let nearest = Infinity;
    for (const part of model.parts) {
      const d = part.box.distanceToPoint(point) + (part.defense === record.material ? 0 : 100);
      if (d < nearest) { nearest = d; struck = part; }
    }
    // Every part priced for this round's attacker material.
    const att = record.attacker ?? null;
    const maxHp = vehicleMaxHp(vehicle);
    const priced = model.parts.map(part => {
      const damage = att == null ? null : headOn(att, part.defense);
      const hits = hitsToDestroy(maxHp, damage);
      const band = hitBand(hits);
      part.mesh.material.color.setHex(band?.color ?? IMMUNE);
      part.mesh.material.emissive.setHex(part === struck ? 0xb3281c : 0x000000);
      part.mesh.material.opacity = part === struck ? 1 : 0.8;
      return { defense: part.defense, hits, damage };
    });
    const r = model.radius;
    model.marker.position.copy(point);
    model.marker.scale.setScalar(r * 0.035);
    const from = point.clone().addScaledVector(dir, -r * 0.9);
    model.line.geometry.setFromPoints([from, point]);
    // From the round's side, a little above, looking at the hull's middle.
    const view = dir.clone().negate();
    view.y = Math.max(view.y, 0) + 0.45;
    view.normalize();
    if (gl.held !== model.group) {
      gl.scene.remove(...gl.scene.children.filter(c => c.isGroup));
      gl.scene.add(model.group);
      gl.held = model.group;
    }
    cardLive = { model, view, age: 0 };
    renderCard(0);
    const weakest = weakestPart(priced);
    const tables = page.guns.materials;
    cardUi.title.textContent = hit.where ? `${hit.what} · ${hit.where}` : hit.what;
    cardUi.detail.textContent = logRow({ flew: 0, time: 0, drop: 0, expired: false, hit }, null).detail.replace(/ · 0 m · 0\.00 s$/, '');
    if (weakest && weakest.defense !== record.material) {
      cardUi.weak.textContent = `Weakest for this weapon: ${materialName(weakest.defense, tables)}, ${weakest.hits} ${weakest.hits === 1 ? 'hit' : 'hits'}`;
    } else if (weakest) {
      const n = Number.isFinite(weakest.hits) ? weakest.hits : null;
      cardUi.weak.textContent = n ? `This is the weakest part for this weapon: ${n} head-on ${n === 1 ? 'hit' : 'hits'} to destroy` : '';
    } else {
      cardUi.weak.textContent = 'This weapon does nothing to any part of it';
    }
    cardEl.hidden = false;
  }
  function showSoldierCard(hit) {
    cardCanvas.hidden = true;
    cardLive = null;
    cardUi.title.textContent = hit.where ? `${hit.what} · ${hit.where}` : hit.what;
    cardUi.detail.textContent = hit.silhouette ? 'down' : hit.damage > 0 ? `-${fmtHp(hit.damage)} hp` : 'no damage';
    cardUi.weak.textContent = '';
    cardEl.hidden = false;
  }
  function renderCard(dt) {
    if (!cardLive || cardCanvas.hidden || log.hidden) return;
    const gl = cardGl;
    const { model, view } = cardLive;
    cardLive.age += dt;
    // A slow swing about the hull, so the model reads as a solid.
    const swing = Math.sin(cardLive.age * 0.7) * 0.35;
    _v.copy(view).applyAxisAngle(_up, swing);
    gl.camera.position.copy(model.centre).addScaledVector(_v, model.radius * 2.6);
    gl.camera.lookAt(model.centre);
    gl.key.position.copy(gl.camera.position).add(_up.clone().multiplyScalar(model.radius));
    gl.key.target = model.group;
    gl.renderer.render(gl.scene, gl.camera);
  }
  const _up = new THREE.Vector3(0, 1, 0);

  // --- the spotter --------------------------------------------------------------
  // After a round lands, a second look at what it landed on, from a few
  // metres in front of it: the page's own renderer draws the world again
  // into the frame's rectangle (`renderInset`, after the main render and
  // the arms), where the impact dot and the plywood or the hull show how
  // close the round was. Four seconds, then it fades.
  const spotterEl = document.createElement('div');
  spotterEl.className = 'pg-spotter';
  spotterEl.hidden = true;
  spotterEl.innerHTML = `<div class="pg-spotter-label"><b>SPOTTER</b><span></span></div><div class="pg-spotter-cross"></div>`;
  page.stage.appendChild(spotterEl);
  const spotterLabel = spotterEl.querySelector('.pg-spotter-label span');
  const spotCam = new THREE.PerspectiveCamera(24, 1.6, 0.1, 800);
  let spot = null;        // { until, centre: Vector3, look: Vector3, node?, camLocal?, lookLocal? }
  const SPOT_HOLD = 4.5;
  let spotClock = 0;
  function showSpot(centre, point, { radius = 1, label = '', node = null } = {}) {
    const c = centre.clone();
    const d = Math.max(3.2, radius * 2.6);
    const look = c.clone().lerp(point, 0.35);
    if (node && page.camera && isAirborne(node)) {
      // An aircraft does not wait to be looked at: the camera is fixed to
      // it, on the side the shot came from (where the player's camera is),
      // so the picture follows the plane that was hit.
      const from = page.camera.getWorldPosition(new THREE.Vector3()).sub(c).normalize();
      const at = c.clone().addScaledVector(from, d * 1.4).add(new THREE.Vector3(0, d * 0.25, 0));
      node.updateMatrixWorld(true);
      spot = { until: spotClock + SPOT_HOLD, centre: c, look, node,
               camLocal: node.worldToLocal(at.clone()), lookLocal: node.worldToLocal(look.clone()) };
    } else {
      // From the shooter's side of it (+z), a little above, framing the mark.
      spotCam.position.set(c.x + d * 0.12, c.y + d * 0.22, c.z + d);
      spotCam.lookAt(look);
      spot = { until: spotClock + SPOT_HOLD, centre: c, look };
    }
    spotterLabel.textContent = label;
    spotterEl.hidden = false;
    spotterEl.classList.remove('is-fading');
  }
  function renderInset(renderer) {
    // The dogfight school's view of the two of you (dogfight-live.js).
    dogfight?.renderInset(renderer);
    // Drawn whenever it shows: the range's hit log is hidden in the air
    // (a dogfight lesson, a ring course), the spotter is not.
    if (!spot || spotterEl.hidden || page.covered?.()) return;
    if (spot.node) {
      spot.node.updateMatrixWorld(true);
      spotCam.position.copy(spot.node.localToWorld(spot.camLocal.clone()));
      spotCam.lookAt(spot.node.localToWorld(spot.lookLocal.clone()));
    }
    const el = renderer.domElement;
    const cr = el.getBoundingClientRect();
    const fr = spotterEl.getBoundingClientRect();
    if (!cr.width || !fr.width) return;
    const sx = el.width / cr.width;
    const sy = el.height / cr.height;
    const x = (fr.left - cr.left) * sx;
    const y = (cr.bottom - fr.bottom) * sy;
    const w = fr.width * sx;
    const h = fr.height * sy;
    spotCam.aspect = fr.width / fr.height;
    spotCam.updateProjectionMatrix();
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    // The spotter's look keeps the last round's dot, paths or no paths.
    const lastDot = traces.find(t => t.done && t.dot)?.dot ?? null;
    const dotWas = lastDot?.visible ?? false;
    if (lastDot) lastDot.visible = true;
    renderer.render(page.scene, spotCam);
    if (lastDot) lastDot.visible = dotWas;
    renderer.autoClear = autoClear;
    renderer.setScissorTest(scissorTest);
    renderer.setScissor(scissor);
    renderer.setViewport(viewport);
  }
  /** Whether a hull is up in the air (well off the floor under it). */
  function isAirborne(node) {
    const p = node.getWorldPosition(new THREE.Vector3());
    return p.y - (page.level.groundHeight?.(p.x, p.z) ?? PG.FLOOR) > 15;
  }
  function spotTick(dt) {
    spotClock += dt;
    spotterEl.classList.toggle('is-air', !!dogfight?.active || !!course?.active);
    if (!spot) return;
    if (spotClock > spot.until) { spot = null; spotterEl.hidden = true; return; }
    spotterEl.classList.toggle('is-fading', spot.until - spotClock < 0.4);
  }
  /** The nearest mark to `point` within `reach` metres: a silhouette (its
   *  foot) or a target hull, for a miss on the floor. */
  function nearestMark(point, reach = 12) {
    let best = null;
    let bestD = reach;
    for (const t of silhouettes?.targets ?? []) {
      const d = Math.hypot(point.x - t.x, point.z - t.z);
      if (d < bestD) { bestD = d; best = { kind: 'silhouette', target: t, base: new THREE.Vector3(t.x, PG.FLOOR, t.z) }; }
    }
    for (const node of page.level.spawnersRoot?.children ?? []) {
      if (node.userData?.provingGround !== 'target') continue;
      const p = node.getWorldPosition(new THREE.Vector3());
      const d = Math.hypot(point.x - p.x, point.z - p.z);
      if (d < bestD) { bestD = d; best = { kind: 'vehicle', node, base: p }; }
    }
    return best;
  }

  // --- the kit bench -------------------------------------------------------------
  // A table at the firing range's point with every kit of both sides laid
  // on it, each the game's own kit pickup (`placeKit`): walk up, take one
  // (the pickup key), and the one you wore lies where you stood. A slot
  // taken is laid again a moment later, so the table is never bare.
  let bench = null;       // { slots: [{ kit, x, y, z, objectId, n }], clock }
  let benchRetry = 0;
  function buildBench() {
    const floorY = page.level.groundHeight?.(BENCH.x, BENCH.z) ?? PG.FLOOR;
    const kits = factions().flatMap(f => f.kits.map(k => k.name));
    if (!kits.length || !page.placeKit) return;
    const slots = benchSlots(kits, floorY);
    const span = Math.max(2.4, (kits.length - 1) * BENCH.spacing + 0.8);
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b5637 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(span, 0.07, BENCH.depth), wood);
    top.position.set(BENCH.x, floorY + BENCH.height - 0.035, BENCH.z);
    root.add(top);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, BENCH.height - 0.07, 0.08), wood);
      leg.position.set(BENCH.x + dx * (span / 2 - 0.12), floorY + (BENCH.height - 0.07) / 2, BENCH.z + dz * (BENCH.depth / 2 - 0.1));
      root.add(leg);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4),
      new THREE.MeshBasicMaterial({ map: boardTexture('KITS'), transparent: true, side: THREE.DoubleSide }));
    sign.position.set(BENCH.x, floorY + BENCH.height + 0.9, BENCH.z - BENCH.depth / 2);
    root.add(sign);
    bench = { slots: slots.map(sl => ({ ...sl, objectId: null, n: 0 })), clock: 2 };
  }
  function stockBench(dt) {
    if (!bench) { if (factions().length && (benchRetry += dt) > 1) { benchRetry = 0; buildBench(); } return; }
    bench.clock += dt;
    if (bench.clock < 1.5) return;
    bench.clock = 0;
    for (const slot of bench.slots) {
      if (slot.objectId && page.kitLies?.(slot.objectId)) continue;
      slot.n++;
      slot.objectId = `pg-bench-${slot.kit}-${slot.n}`;
      const laid = page.placeKit(slot.kit, { x: slot.x, y: slot.y, z: slot.z, yaw: 90, normal: [0, 1, 0] }, { objectId: slot.objectId });
      if (!laid) slot.objectId = null;
    }
  }

  // --- range boards on the floor -------------------------------------------
  function boardTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = '600 64px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [r, g, b] = PG_COLOURS.range.map(v => Math.round(v * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  const boards = new THREE.Group();
  boards.name = 'pgRangeBoards';
  root.add(boards);
  function layBoards() {
    boards.clear();
    for (let r = 50; r <= 1500; r += 50) {
      const tex = boardTexture(`${r}`);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
      const size = r % 100 === 0 ? 1 : 0.7;
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(16 * size, 6 * size), mat);
        board.rotation.x = -Math.PI / 2;
        board.position.set(PG.LINE_X + side * 150, PG.FLOOR + 0.05, PG.LINE_Z - r + 4);
        boards.add(board);
      }
    }
  }

  // --- paths ------------------------------------------------------------------
  const traces = [];
  const seen = new WeakSet();
  // The paths and their dots can be put away (T): on the firing line the
  // dots of the last rounds sit between the shooter and the plywood, and
  // the follow-up shots were hard to see past them. The log and the spotter
  // keep working off the same traces.
  let pathsOn = true;
  try { pathsOn = localStorage.getItem('bfstats.provingPaths') !== 'off'; } catch { /* storage off */ }
  function showPaths(on) {
    pathsOn = on;
    for (const trace of traces) { trace.line.visible = on; if (trace.dot) trace.dot.visible = on; }
    try { localStorage.setItem('bfstats.provingPaths', on ? 'on' : 'off'); } catch { /* storage off */ }
    for (const b of [pathsBtn, arsenal.querySelector('.pg-paths-toggle')]) b?.setAttribute('aria-pressed', String(on));
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1f8a5c, transparent: true, opacity: 0.9, fog: true });
  const lineHot = new THREE.LineBasicMaterial({ color: 0xd64545, transparent: true, opacity: 0.95, fog: true });
  // Where a round stopped: a small mark, the path's colour. No text in the
  // world; the words are the log's.
  const dotGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x1f8a5c, depthTest: false, transparent: true, opacity: 0.9 });
  const dotHot = new THREE.MeshBasicMaterial({ color: 0xd64545, depthTest: false, transparent: true, opacity: 0.95 });
  /** What the last round of each weapon taught: `{ speed, g, ttl, motor }`,
   *  by its name: a one-shot launcher's group is built again after it fires,
   *  and the lesson belongs to the weapon, not the object. */
  const learned = new Map();
  const lessonKey = group => weaponName(group) ?? group;
  let lastGroup = null;

  function startTrace(shot) {
    const origin = shot.origin ? new THREE.Vector3(...shot.origin) : roundAt(shot, new THREE.Vector3());
    const v0 = shot.velocity ? shot.velocity.clone() : new THREE.Vector3();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TRACE_POINTS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, lineMat);
    line.frustumCulled = false;
    line.renderOrder = 30;
    line.visible = pathsOn;
    root.add(line);
    const trace = {
      shot, group: shot.group, weapon: weaponName(shot.group), origin, v0, line, positions, count: 0,
      age: 0, done: false, doneAge: 0, dot: null, result: null,
    };
    addPoint(trace, origin);
    traces.unshift(trace);
    while (traces.length > TRACE_MAX) dropTrace(traces.pop());
    // The weapon's launch, for the landing point: the speed it left at,
    // relative to the platform it left (the round inherits its hull's
    // velocity), its fall and its fuse.
    learned.set(lessonKey(shot.group), {
      speed: v0.length(), g: fallOf(shot), ttl: shot.ttl ?? shot.group?.stats?.projectile?.timeToLive ?? 0,
      motor: !!(shot.motors || shot.dragBox),
    });
    lastGroup = shot.group;
    return trace;
  }

  function addPoint(trace, p) {
    if (trace.count >= TRACE_POINTS) {
      // Thin: keep every other sample and carry on.
      const a = trace.positions;
      let k = 0;
      for (let i = 0; i < trace.count; i += 2) {
        a[k * 3] = a[i * 3]; a[k * 3 + 1] = a[i * 3 + 1]; a[k * 3 + 2] = a[i * 3 + 2];
        k++;
      }
      trace.count = k;
    }
    const i = trace.count++;
    trace.positions[i * 3] = p.x; trace.positions[i * 3 + 1] = p.y; trace.positions[i * 3 + 2] = p.z;
    trace.line.geometry.attributes.position.needsUpdate = true;
    trace.line.geometry.setDrawRange(0, trace.count);
  }

  function dropTrace(trace) {
    trace.line.removeFromParent();
    trace.line.geometry.dispose();
    trace.dot?.removeFromParent();
  }

  /** The drop below the launch line at the point a round stopped. */
  function dropAt(trace, point) {
    const v = trace.v0;
    const len = v.length();
    if (!(len > 0)) return 0;
    // The launch line's height at the stopping point's distance along it.
    _v.set(point.x - trace.origin.x, 0, point.z - trace.origin.z);
    const flat = Math.hypot(v.x, v.z);
    const along = flat > 1e-6 ? (_v.x * v.x + _v.z * v.z) / flat : 0;
    const lineY = trace.origin.y + (flat > 1e-6 ? along * v.y / flat : 0);
    return Math.max(0, lineY - point.y);
  }

  function finishTrace(trace, point, info = null) {
    if (trace.done) return;
    trace.done = true;
    trace.doneAge = 0;
    // The round's last direction: from its last sample to where it stopped,
    // else its launch velocity.
    const n = trace.count - 1;
    const incoming = new THREE.Vector3(point.x - trace.positions[n * 3], point.y - trace.positions[n * 3 + 1], point.z - trace.positions[n * 3 + 2]);
    if (incoming.lengthSq() < 1e-6) incoming.copy(trace.v0);
    if (incoming.lengthSq() < 1e-6) incoming.set(0, 0, -1);
    incoming.normalize();
    addPoint(trace, point);
    const flew = Math.hypot(point.x - trace.origin.x, point.z - trace.origin.z);
    const slant = point.distanceTo(trace.origin);
    const drop = dropAt(trace, point);
    const result = { flew, slant, time: trace.age, drop, expired: !!info?.expired, hit: info?.hit ?? null };
    trace.result = result;
    const hot = !!(result.hit?.damage > 0);
    trace.line.material = hot ? lineHot : lineMat;
    trace.dot = new THREE.Mesh(dotGeometry, hot ? dotHot : dotMat);
    trace.dot.renderOrder = 31;
    trace.dot.position.copy(point);
    trace.dot.visible = pathsOn;
    root.add(trace.dot);
    logShot(result, trace.weapon);
    if (result.hit?.soldier || result.hit?.silhouette) showSoldierCard(result.hit);
    else if (result.hit && info?.record) showCard(result.hit.vehicle, info.record, incoming, result.hit);
    spotRound(result, point, info);
  }

  /** The spotter's look at what the round met: the plywood with the dot on
   *  it and the words from its rings, a hull and its part, or, for a round
   *  on the floor near a mark, that mark and how far the round missed it. */
  function spotRound(result, point, info) {
    const hit = result.hit;
    if (hit?.silhouette && info?.target) {
      const t = info.target;
      const rings = new THREE.Vector3(t.x, PG.FLOOR + SILHOUETTE.postHeight + SILHOUETTE.height * (1 - 185 / 330), t.z);
      const centre = new THREE.Vector3(t.x, PG.FLOOR + SILHOUETTE.postHeight + SILHOUETTE.height / 2, t.z);
      showSpot(centre, point, { radius: 1.1, label: `${t.name} ${t.range} m · ${spotWords(point.toArray(), rings.toArray())}` });
      return;
    }
    if (hit?.vehicle) {
      const node = hit.vehicle;
      const centre = node.getWorldPosition(new THREE.Vector3());
      const radius = cardModels.get(node)?.radius ?? 3;
      centre.y += radius * 0.3;
      showSpot(centre, point, { radius, node, label: `${hit.what} · ${hit.where}${hit.damage > 0 ? ` · -${fmtHp(hit.damage)} hp` : ''}` });
      return;
    }
    if (hit || result.expired) return;
    const mark = nearestMark(point);
    if (!mark) return;
    if (mark.kind === 'silhouette') {
      const t = mark.target;
      const centre = new THREE.Vector3(t.x, PG.FLOOR + SILHOUETTE.postHeight + SILHOUETTE.height / 2, t.z);
      showSpot(centre, point, { radius: 1.6, label: `${t.name} ${t.range} m · ${missWords(point.toArray(), mark.base.toArray())}` });
    } else {
      const radius = cardModels.get(mark.node)?.radius ?? 3;
      const centre = mark.base.clone();
      centre.y += radius * 0.3;
      showSpot(centre, point, { radius: radius * 1.3, label: `${prettyName(mark.node.name.replace(/_\d+$/, ''))} · ${missWords(point.toArray(), mark.base.toArray())}` });
    }
  }

  /** The round that ended at `point`, among the paths still flying for `group`. */
  function traceFor(group, point) {
    let best = null;
    let bestD = Infinity;
    for (const trace of traces) {
      if (trace.done || trace.group !== group) continue;
      const d = roundAt(trace.shot, _at).distanceTo(point);
      if (d < bestD) { best = trace; bestD = d; }
    }
    return bestD < 80 ? best : null;
  }

  /** What a landed round met: `{ what, where, damage, left, max, angle,
   *  soldier }`, or null for the floor and the air. */
  function describeHit(record) {
    if (record.kind === 'endOfLife') return null;
    const damage = record.damage ?? 0;
    const tables = page.guns.materials;
    const material = materialName(record.material, tables);
    if (record.target != null) {
      return { what: 'soldier', where: record.bone ?? null, damage, soldier: true };
    }
    const vehicle = record.owner >= 0 ? page.level.vehicleDamage?.get(record.owner) : null;
    if (!vehicle) return null;
    const node = page.damageVisuals?.get(record.owner)?.node;
    const label = prettyName(node?.name?.replace(/_\d+$/, '') ?? vehicle.name ?? 'vehicle');
    return {
      what: label, where: material, damage,
      left: vehicle.armor?.hitPoints ?? 0, max: vehicle.armor?.maxHitPoints ?? 0,
      angle: record.incidence ?? null, soldier: false, vehicle: node ?? null,
    };
  }

  // The page's own impact handler prices the round first; this reads after.
  const pageImpact = page.guns.onImpact;
  page.guns.onImpact = (record, hit) => {
    pageImpact?.(record, hit);
    if (!page.isLocalGroup(record.firerGroup)) return;
    const point = new THREE.Vector3(...record.point);
    const trace = traceFor(record.firerGroup, point);
    if (!trace) return;
    finishTrace(trace, point, { expired: record.kind === 'endOfLife', hit: describeHit(record), record });
  };

  // The silhouette range (`proving-targets.js`), built with the floor.
  let silhouettes = null;
  const _prev = new THREE.Vector3();

  /** New rounds of the player's, sampled along their paths; one gone from
   *  the guns with no impact ran out its fuse where it was last seen. A
   *  step that crosses a standing silhouette knocks it and ends the path
   *  there: the plywood is the page's, not the world's, so the round itself
   *  flies on. */
  function sampleRounds() {
    const live = new Set();
    for (const list of [page.guns.projectiles, page.guns.tracers]) {
      for (const shot of list ?? []) {
        if (!shot?.mesh || !page.isLocalGroup(shot.group)) continue;
        live.add(shot);
        if (!seen.has(shot)) {
          seen.add(shot);
          startTrace(shot);
        }
      }
    }
    for (const trace of traces) {
      if (trace.done) continue;
      if (live.has(trace.shot)) {
        trace.age = trace.shot.age ?? trace.age;
        roundAt(trace.shot, _at);
        if (silhouettes && trace.count > 0) {
          const n = trace.count - 1;
          _prev.set(trace.positions[n * 3], trace.positions[n * 3 + 1], trace.positions[n * 3 + 2]);
          const knocked = silhouettes.hits([_prev.x, _prev.y, _prev.z], [_at.x, _at.y, _at.z]);
          if (knocked) {
            const t = knocked.target;
            finishTrace(trace, new THREE.Vector3(...knocked.point),
                        { hit: { what: t.name, where: `${t.range} m`, damage: 1, silhouette: true, soldier: false }, target: t });
            continue;
          }
        }
        addPoint(trace, _at);
      } else {
        // Recycled without an impact: the fuse, mid-air.
        const n = trace.count - 1;
        const p = new THREE.Vector3(trace.positions[n * 3], trace.positions[n * 3 + 1], trace.positions[n * 3 + 2]);
        finishTrace(trace, p, { expired: true });
      }
    }
  }

  function clearTraces() {
    for (const trace of traces) dropTrace(trace);
    traces.length = 0;
    clearLog();
    cardEl.hidden = true;
    cardLive = null;
  }

  // --- the weapon in hand -------------------------------------------------------
  /** The gun group the player is firing with now: the hand weapon on foot,
   *  else the last of his own that fired. */
  function currentGroup() {
    const hand = page.handGroup();
    if (hand) return hand;
    const seat = page.seatGroups?.() ?? [];
    if (seat.length) return seat.includes(lastGroup) ? lastGroup : seat[0];
    return lastGroup;
  }

  /** The attacker material the weapon's round is priced by, or null. */
  function attackerOf(group) {
    const spec = group?.stats?.projectile;
    return spec ? (page.guns.attackerMaterial?.(spec) ?? null) : null;
  }

  function weaponName(group) {
    const fa = group?.stats;
    return group?.weapon ?? fa?.template ?? group?.node?.name?.replace(/_\d+$/, '') ?? null;
  }

  // --- the collision mesh, priced -------------------------------------------------
  let zonesOn = false;
  let zonesFor = null;        // the attacker material the colours are for
  const zoneMeshes = [];      // { mesh, owner, material }
  const zoneBuilt = new WeakSet();
  const zoneMats = new Map();
  const zoneMat = color => {
    if (!zoneMats.has(color)) {
      zoneMats.set(color, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true,
      }));
    }
    return zoneMats.get(color);
  };

  /** Coloured copies of each vehicle's collision parts, beside the parts. */
  function buildZones() {
    const spawners = page.level.spawnersRoot;
    if (!spawners) return;
    for (const vehicle of spawners.children) {
      if (zoneBuilt.has(vehicle)) continue;
      zoneBuilt.add(vehicle);
      const parts = [];
      vehicle.traverse(obj => {
        if (obj.isMesh && obj.geometry?.userData?.collision && obj.parent) parts.push(obj);
      });
      vehicle.updateMatrixWorld(true);
      for (const part of parts) {
        // The hull a collision mesh hangs under is hidden with it: the copy
        // goes on the nearest ancestor that is drawn, at the same pose, so it
        // turns with a turret and rides the hull.
        let host = part.parent;
        while (host && host !== vehicle && (!host.visible || /collision/i.test(host.name || ''))) host = host.parent;
        if (!host) continue;
        const geometry = part.geometry.clone();
        geometry.userData = {};
        const mesh = new THREE.Mesh(geometry, zoneMat(IMMUNE));
        mesh.name = 'pgZone';
        mesh.userData = { pgZone: true, defense: part.geometry.userData.defenseMaterial, vehicle };
        _m.copy(host.matrixWorld).invert().multiply(part.matrixWorld);
        _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.renderOrder = 25;
        mesh.visible = false;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        host.add(mesh);
        zoneMeshes.push({ mesh, vehicle });
      }
    }
  }

  /** Head-on damage of attacker material `att` against defence `def`. */
  function headOn(att, def) {
    const materials = page.guns.materials;
    const base = materials?.[att]?.damage;
    if (base == null || def == null) return null;
    const ag = materials?.[att]?.attGroup ?? att;
    const dg = materials?.[def]?.defGroup ?? def;
    const mod = page.guns.modifiers?.[ag]?.[dg];
    if (mod == null) return null;
    return base * mod;
  }

  function vehicleMaxHp(vehicle) {
    return vehicle.userData?.armor?.maxHitpoints ?? vehicle.userData?.armor?.hitpoints ?? 100;
  }

  function colourZones(att) {
    zonesFor = att;
    for (const { mesh, vehicle } of zoneMeshes) {
      const damage = att == null ? null : headOn(att, mesh.userData.defense);
      const hits = hitsToDestroy(vehicleMaxHp(vehicle), damage);
      mesh.userData.hits = hits;
      mesh.userData.damage = damage;
      mesh.material = zoneMat(hitBand(hits)?.color ?? IMMUNE);
    }
  }

  function showZones(on) {
    zonesOn = on;
    if (on) buildZones();
    for (const { mesh, vehicle } of zoneMeshes) mesh.visible = on && vehicle.visible;
    ui.zones.hidden = !on;
    zonesFor = undefined;
    for (const b of [meshBtn, arsenal.querySelector('.pg-mesh-toggle')]) {
      b?.setAttribute('aria-pressed', String(on));
    }
  }

  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  function aimedZone() {
    ray.setFromCamera(centre, page.camera);
    ray.far = 1500;
    const meshes = zoneMeshes.filter(z => z.mesh.visible).map(z => z.mesh);
    return ray.intersectObjects(meshes, false)[0] ?? null;
  }

  // --- rangefinder and landing point -------------------------------------------
  const marker = new THREE.Group();
  marker.name = 'pgLanding';
  {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.7, 40),
      new THREE.MeshBasicMaterial({ color: 0xd64545, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.35, 20),
      new THREE.MeshBasicMaterial({ color: 0xd64545, depthWrite: false, side: THREE.DoubleSide }));
    dot.rotation.x = -Math.PI / 2;
    marker.add(ring, dot);
    marker.renderOrder = 35;
    marker.visible = false;
    root.add(marker);
  }
  let predictOn = false;

  /** Drawn: it and every parent visible (a hidden muzzle flash or collision
   *  hull is in the tree, and a raycast does not ask). */
  function drawn(obj) {
    for (let o = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  function rangefinder() {
    ray.setFromCamera(centre, page.camera);
    ray.far = 2500;
    const spawners = page.level.spawnersRoot;
    let best = Infinity;
    if (spawners) {
      const hit = ray.intersectObject(spawners, true).find(h => h.object.name !== 'pgZone' && drawn(h.object));
      if (hit) best = hit.distance;
    }
    // The floor is a plane.
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y < -1e-4) {
      const t = (PG.FLOOR - o.y) / d.y;
      if (t > 0) best = Math.min(best, t);
    }
    return best;
  }

  function predict() {
    const group = currentGroup();
    const known = group ? learned.get(lessonKey(group)) : null;
    ui.predictRow.hidden = !predictOn;
    if (!predictOn || !known || !(known.g < 0)) {
      marker.visible = false;
      if (predictOn) setText(ui.predict, known ? 'flies straight' : 'fire once to learn');
      return;
    }
    const cam = page.camera;
    cam.getWorldPosition(_at);
    cam.getWorldDirection(_dir);
    const floor = (x, z) => page.level.groundHeight?.(x, z) ?? PG.FLOOR;
    const p = predictImpact([_at.x, _at.y, _at.z], [_dir.x, _dir.y, _dir.z], known.speed, known.g, known.ttl, floor);
    if (!p) { marker.visible = false; return; }
    marker.visible = true;
    marker.position.set(p.point[0], p.point[1] + 0.06, p.point[2]);
    const s = Math.max(1, p.range / 120);
    marker.scale.setScalar(s);
    setText(ui.predict, `${fmtM(p.range)} ${fmtS(p.time)}${p.expired ? ' fuse' : ''}${known.motor ? ' (motor not modelled)' : ''}`);
  }

  // --- the arsenal ----------------------------------------------------------------
  const arsenal = document.createElement('div');
  arsenal.className = 'pg-arsenal';
  arsenal.hidden = true;
  arsenal.setAttribute('role', 'dialog');
  arsenal.setAttribute('aria-label', 'Arsenal');
  arsenal.innerHTML = `
    <div class="pg-arsenal-backdrop"></div>
    <div class="pg-arsenal-panel">
      <div class="pg-arsenal-head">
        <span class="pg-title">ARSENAL</span>
        <span class="pg-arsenal-battle"></span>
        <input class="pg-arsenal-search" type="search" placeholder="Find a weapon or vehicle" aria-label="Find a weapon or vehicle" autocomplete="off">
        <button type="button" class="pg-btn pg-arsenal-close" aria-label="Close">ESC</button>
      </div>
      <div class="pg-arsenal-body">
        <section class="pg-rack pg-rack-factions">
          <h3>FACTION</h3>
          <div class="pg-factions"></div>
          <p class="pg-rack-note pg-side-note"></p>
          <h3 class="pg-rack-gap">STAND AT</h3>
          <div class="pg-stations"></div>
          <p class="pg-rack-note">Or <kbd>M</kbd> on the range and click the map to go there; <kbd>X</kbd> stands you where the crosshair points.</p>
        </section>
        <section class="pg-rack pg-rack-kits">
          <h3>KIT</h3>
          <div class="pg-kits"></div>
        </section>
        <section class="pg-rack pg-rack-vehicles">
          <h3>VEHICLE · STRAIGHT INTO THE SEAT</h3>
          <div class="pg-vehicles"></div>
          <p class="pg-rack-note pg-target-note"></p>
        </section>
      </div>
      <div class="pg-arsenal-foot">
        <span class="pg-log-btns">
          <button type="button" class="pg-btn pg-paths-toggle" aria-pressed="true"><i></i><span>PATHS</span><kbd>T</kbd></button>
          <button type="button" class="pg-btn pg-mesh-toggle" aria-pressed="false"><i></i><span>COLLISION MESH</span><kbd>H</kbd></button>
        </span>
        <span class="pg-foot-keys"><kbd>X</kbd> stand where you aim <kbd>U</kbd> landing point <kbd>J</kbd> clear <kbd>B</kbd> close</span>
      </div>
    </div>`;
  page.stage.appendChild(arsenal);
  const ars = {
    battle: arsenal.querySelector('.pg-arsenal-battle'),
    search: arsenal.querySelector('.pg-arsenal-search'),
    factions: arsenal.querySelector('.pg-factions'),
    kits: arsenal.querySelector('.pg-kits'),
    vehicles: arsenal.querySelector('.pg-vehicles'),
    sideNote: arsenal.querySelector('.pg-side-note'),
    stations: arsenal.querySelector('.pg-stations'),
    targetNote: arsenal.querySelector('.pg-target-note'),
  };
  let arsenalOpen = false;
  let pickedTeam = null;
  /** Actions that need the man on foot (a kit into his hands, a seat), run
   *  by `frame` once he is: a seat is left first, and the leaving takes a
   *  frame. `{ run, tries }`. */
  let queued = null;

  function factions() {
    return arsenalFactions(page.loadouts, page.level.currentDir, team => page.teamNation?.(team) ?? null);
  }

  /** The vehicles parked for the player: the garage and the airfield, by role. */
  function parkedVehicles() {
    const out = [];
    for (const node of page.level.spawnersRoot?.children ?? []) {
      const role = node.userData?.provingGround;
      if (role !== 'garage' && role !== 'airfield') continue;
      out.push({ node, role, name: prettyName(node.name.replace(/_\d+$/, '')), template: node.name.replace(/_\d+$/, '') });
    }
    out.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
    return out;
  }

  function targetNames() {
    const names = new Set();
    for (const node of page.level.spawnersRoot?.children ?? []) {
      if (node.userData?.provingGround === 'target') names.add(prettyName(node.name.replace(/_\d+$/, '')));
    }
    return [...names].sort();
  }

  function renderArsenal() {
    const all = factions();
    const own = page.deployTeamId;
    if (pickedTeam == null || !all.some(f => f.team === pickedTeam)) {
      pickedTeam = all.find(f => f.team === own)?.team ?? all[0]?.team ?? null;
    }
    const filter = ars.search.value.trim().toLowerCase();
    const matches = text => !filter || text.toLowerCase().includes(filter);
    ars.factions.innerHTML = all.map(f => `
      <button type="button" class="pg-faction" data-team="${f.team}" aria-pressed="${f.team === pickedTeam}">
        <b>${esc(f.nation.toUpperCase())}</b><small>${esc(f.side)}${f.team === own ? ' · your side' : ''}</small>
      </button>`).join('') || '<p class="pg-rack-note">This battle names no kits.</p>';
    const current = page.currentKit?.() ?? null;
    const faction = all.find(f => f.team === pickedTeam);
    const kits = (faction?.kits ?? []).filter(k => matches(`${k.label} ${k.name} ${k.items.map(i => i.name).join(' ')}`));
    ars.kits.innerHTML = kits.map(k => `
      <button type="button" class="pg-kit" data-kit="${esc(k.name)}" aria-pressed="${k.name === current}">
        <b>${esc(k.label.toUpperCase())}</b>
        <span class="pg-kit-items">${k.items.map(i => `<i class="${i.primary ? 'is-primary' : ''}${i.rolled ? ' is-rolled' : ''}">${esc(i.name)}</i>`).join('')}</span>
      </button>`).join('') || `<p class="pg-rack-note">${filter ? 'No kit matches.' : 'No kits for this side.'}</p>`;
    ars.sideNote.textContent = faction && faction.team !== own
      ? `You stay on your side: the other faction's kit is picked up the way a dropped one is.`
      : '';
    const parked = parkedVehicles().filter(v => matches(`${v.name} ${v.role}`));
    const held = page.occupancy?.root ?? null;
    ars.vehicles.innerHTML = parked.map(v => `
      <button type="button" class="pg-vehicle" data-vehicle="${esc(v.node.name)}" aria-pressed="${v.node === held}" ${page.isWreck?.(v.node) ? 'disabled' : ''}>
        <b>${esc(v.name.toUpperCase())}</b><small>${v.role === 'airfield' ? 'airfield' : 'garage'}${page.isWreck?.(v.node) ? ' · wrecked, stands again soon' : ''}</small>
      </button>`).join('') || `<p class="pg-rack-note">${filter ? 'No vehicle matches.' : 'Nothing parked.'}</p>`;
    ars.stations.innerHTML = standStations().map(st => `
      <button type="button" class="pg-station" data-station="${st.id}">${esc(st.label)}</button>`).join('');
    const targets = targetNames();
    ars.targetNote.textContent = targets.length
      ? `Down range at ${PG.ROWS.join(' and ')} m: ${targets.join(', ')}.`
      : '';
  }

  function openArsenal() {
    if (arsenalOpen || page.covered?.()) return;
    if (!page.soldier && !page.occupancy) return;
    arsenalOpen = true;
    arsenal.hidden = false;
    ars.battle.textContent = ui.battle.textContent;
    renderArsenal();
    page.release?.();
    ars.search.value = '';
    // After the key that opened it has been typed: focused now, the B's own
    // keypress would land in the box and filter the racks to "b".
    setTimeout(() => {
      if (!arsenalOpen) return;
      ars.search.value = '';
      ars.search.focus({ preventScroll: true });
      renderArsenal();
    }, 0);
  }

  function closeArsenal(recapture = true) {
    if (!arsenalOpen) return;
    arsenalOpen = false;
    arsenal.hidden = true;
    ars.search.blur();
    if (recapture) page.capture?.();
  }

  /** Run `fn` once the man is on foot and alive, leaving his seat first. */
  function onFoot(fn) {
    if (page.occupancy) page.exitSeat?.();
    queued = { run: fn, tries: 90 };
  }

  function pickKit(kitName, team) {
    onFoot(() => {
      page.equipKit?.(kitName, [], { team: page.deployTeamId ?? team });
    });
  }

  function pickVehicle(node) {
    onFoot(() => {
      const soldier = page.soldier;
      if (!soldier || page.isWreck?.(node)) return;
      if (page.hullOpenTo && !page.hullOpenTo(node, page.deployTeamId)) return;
      // Beside the hull, on the firing line's side of it, facing it.
      node.updateMatrixWorld(true);
      _box.setFromObject(node);
      const cx = (_box.min.x + _box.max.x) / 2;
      const z = _box.max.z + 1.4;
      const y = page.level.groundHeight?.(cx, z) ?? PG.FLOOR;
      soldier.spawn(cx, y, z, 180);
      page.snapPresentation?.();
      const at = { position: [cx, y + 1, z] };
      let entry = page.spawnSeat?.(at, { team: page.deployTeamId, taking: true });
      if (!entry || !isUnder(entry.vehicle, node)) entry = page.spawnSeat?.(at, { team: page.deployTeamId, ai: true });
      if (!entry || !isUnder(entry.vehicle, node)) return;
      page.enterVehicle?.(entry);
    });
  }

  /** Stand the man at `x, z` on the floor, his heading kept unless `yaw`
   *  (the engine's degrees) says otherwise; out of a seat first. */
  function teleportTo(x, z, yaw = null) {
    onFoot(() => {
      const soldier = page.soldier;
      if (!soldier) return;
      const y = page.level.groundHeight?.(x, z) ?? PG.FLOOR;
      soldier.spawn(x, y + 0.1, z, yaw == null ? soldier.yaw : THREE.MathUtils.degToRad(-yaw));
      page.snapPresentation?.();
    });
  }

  /** Where the crosshair points: the floor there, or two metres short of
   *  the hull there on the line from the camera. Null for the sky. */
  function aimPoint() {
    ray.setFromCamera(centre, page.camera);
    ray.far = 2500;
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = Infinity;
    const spawners = page.level.spawnersRoot;
    if (spawners) {
      const hit = ray.intersectObject(spawners, true).find(h => h.object.name !== 'pgZone' && drawn(h.object));
      if (hit) t = Math.max(0, hit.distance - 2.5);
    }
    if (d.y < -1e-4) {
      const floor = (PG.FLOOR - o.y) / d.y;
      if (floor > 0) t = Math.min(t, floor);
    }
    if (!Number.isFinite(t)) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  function isUnder(obj, root) {
    for (let o = obj; o; o = o.parent) if (o === root) return true;
    return false;
  }

  arsenal.addEventListener('click', e => {
    if (e.target.closest('.pg-arsenal-backdrop, .pg-arsenal-close')) { closeArsenal(); return; }
    const faction = e.target.closest('.pg-faction');
    if (faction) { pickedTeam = Number(faction.dataset.team); renderArsenal(); ars.search.focus({ preventScroll: true }); return; }
    const kit = e.target.closest('.pg-kit');
    if (kit) { pickKit(kit.dataset.kit, pickedTeam); closeArsenal(); return; }
    const vehicle = e.target.closest('.pg-vehicle');
    if (vehicle) {
      const node = page.level.spawnersRoot?.children.find(n => n.name === vehicle.dataset.vehicle);
      if (node) pickVehicle(node);
      closeArsenal();
      return;
    }
    const station = e.target.closest('.pg-station');
    if (station) {
      const st = standStations().find(x => x.id === station.dataset.station);
      if (st) teleportTo(st.x, st.z, st.yaw);
      closeArsenal();
      return;
    }
    if (e.target.closest('.pg-mesh-toggle')) { showZones(!zonesOn); return; }
    if (e.target.closest('.pg-paths-toggle')) { showPaths(!pathsOn); return; }
    // A click on the panel's plate: the keyboard stays the search box's, so
    // nothing behind the arsenal moves.
    ars.search.focus({ preventScroll: true });
  });
  ars.search.addEventListener('input', renderArsenal);
  arsenal.addEventListener('keydown', e => {
    // The keyboard is the arsenal's while it is up: nothing reaches the
    // page's own bindings (Enter is the game's spawn menu, and a pick closes
    // the box before the key has bubbled that far).
    e.stopPropagation();
    if (e.code === 'Escape') { e.preventDefault(); closeArsenal(); }
    else if (e.code === 'Enter') {
      e.preventDefault();
      // The first thing the search found.
      const first = arsenal.querySelector('.pg-kit, .pg-vehicle:not([disabled])');
      first?.click();
    }
  });
  arsenal.addEventListener('keyup', e => e.stopPropagation());

  // --- keys -------------------------------------------------------------------
  window.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (arsenalOpen || page.keyboardTaken?.()) return;
    if (school?.isOpen) return;
    if (e.code === 'KeyV') { openSchool(); return; }
    // In the arena, Q (Shift+Q back) changes plane, and the lesson starts
    // again in it.
    if (ARENA && e.code === 'KeyQ') { nextPlane(e.shiftKey ? -1 : 1); return; }
    if (dogfight?.key(e)) return;
    if (course?.key(e)) return;
    // The range's own keys are for the floor, which the arena has not got.
    if (ARENA) return;
    if (e.code === 'KeyH') showZones(!zonesOn);
    else if (e.code === 'KeyU') predictOn = !predictOn;
    else if (e.code === 'KeyJ') clearTraces();
    else if (e.code === 'KeyB') openArsenal();
    else if (e.code === 'KeyT') showPaths(!pathsOn);
    else if (e.code === 'KeyX') { const p = aimPoint(); if (p) teleportTo(p.x, p.z); }
  });

  // --- the dogfight school (features/dogfight-school) ---------------------------
  // The theatre (V) replays a lesson's fights, flown on the battle's own
  // fighter; FLY IT puts the player in the air against the lesson's ace, a
  // bot whose seat the school flies (`dogfight-live.js`). The ace needs a bot
  // to sit in: a range opened without one is reopened with one, and the
  // lesson picked up when the man first stands (`?dogfight=<lesson>`).
  let school = null;
  let dogfight = null;
  let wantLesson = page.wantLesson ?? null;
  let wantMove = page.wantMove ?? null;
  /** `?school=` (a lesson, or empty for the first): the theatre opens as the
   *  range does (the front end's DOGFIGHT SCHOOL). */
  let wantSchool = page.wantSchool ?? null;

  /** The battle's best fighter on a side's airfield (`airfield`, `enemyAir`). */
  function fighterOn(role) {
    const nodes = (page.level.spawnersRoot?.children ?? []).filter(n => n.userData?.provingGround === role && !page.isWreck?.(n));
    nodes.sort((a, b) => fighterRank(a.name) - fighterRank(b.name));
    return nodes[0] ?? null;
  }

  // --- your plane ----------------------------------------------------------------
  // Which of the battle's aircraft you fly in the school: every one parks on
  // your airfield (both sides' types, all open to you), fighters first. The
  // choice is this browser's, by template, and falls back to the best
  // fighter on a battle without it.
  const PLANE_KEY = 'dogfight-school:plane';
  let planeChoice = (() => { try { return localStorage.getItem(PLANE_KEY); } catch { return null; } })();
  const templateOf = node => String(node?.name ?? '').replace(/_\d+$/, '');
  /** Your airfield's planes, the one you sit in among them: a hull taken
   *  leaves the parked rows while it flies. */
  function airfieldNodes() {
    const nodes = [...(page.level.spawnersRoot?.children ?? [])];
    const seat = page.occupancy?.root;
    if (seat?.userData?.provingGround === 'airfield' && !nodes.includes(seat)) nodes.push(seat);
    return nodes;
  }
  /** What a school airframe is built with: the level's collision meshes,
   *  so its box is the header's, the one the plane you sit in flies on
   *  (COL-14), not the drawn mesh's. */
  const schoolFrame = () => ({ cockpit: false, collisionMeshes: page.hullBodies?.collisionMeshes ?? null });
  /** A plane's name: a jet by its designation (`Mig29` "MiG-29"). */
  const planeWords = template => jetName(template) ?? prettyName(template);
  /** The battle's aircraft you can fly, one row a type. */
  function planes() {
    const seen = new Map();
    for (const node of airfieldNodes()) {
      if (node.userData?.provingGround !== 'airfield') continue;
      const template = templateOf(node);
      if (!seen.has(template)) seen.set(template, { template, name: planeWords(template), fighter: fighterRank(template) < 100 });
    }
    return [...seen.values()].sort((a, b) => fighterRank(a.template) - fighterRank(b.template) || a.name.localeCompare(b.name));
  }
  /** The plane you fly: your choice when the airfield has one standing, else
   *  the best fighter. */
  function myPlane() {
    const nodes = airfieldNodes().filter(n => n.userData?.provingGround === 'airfield' && !page.isWreck?.(n));
    return nodes.find(n => templateOf(n) === planeChoice) ?? fighterOn('airfield') ?? fighterOn('enemyAir');
  }
  function setPlane(template) {
    planeChoice = template;
    try { localStorage.setItem(PLANE_KEY, template); } catch { /* private window */ }
  }
  const planeName = () => planeWords(templateOf(myPlane()));
  /** Straight into your plane: stood up on the line first if the spawn
   *  screen is up or he is dead (no flag to pick, no READY), then seated. */
  function seatInPlane() {
    if (!page.soldier || page.soldierDead) page.deployNow?.();
    const node = myPlane();
    if (node) pickVehicle(node);
  }
  /** Whether he sits in the plane he chose. */
  const inMyPlane = () => !!page.aircraft && templateOf(page.occupancy?.root) === templateOf(myPlane());

  /** The school's own modules, loaded the first time it opens: the range
   *  itself never needs the theatre or the live fight. */
  let schoolModules = null;
  const loadSchool = () => (schoolModules ??= Promise.all([
    import('./aircraft.js'), import('./dogfight-theatre.js'), import('./dogfight-live.js'), import('./dogfight-course.js'),
  ]).then(([aircraft, theatre, live, rings]) => ({ Aircraft: aircraft.Aircraft, createDogfightTheatre: theatre.createDogfightTheatre,
                                                   createDogfightLive: live.createDogfightLive, createRingCourse: rings.createRingCourse })));

  async function buildSchool() {
    if (school) return school;
    const { Aircraft, createDogfightTheatre } = await loadSchool();
    if (school) return school;
    const fighter = fighterOn('airfield') ?? fighterOn('enemyAir');
    const enemy = fighterOn('enemyAir') ?? fighter;
    const name = fighter ? planeWords(fighter.name.replace(/_\d+$/, '')) : 'Spitfire';
    const visual = node => {
      if (!node) return null;
      const copy = node.clone(true);
      copy.position.set(0, 0, 0);
      copy.quaternion.identity();
      copy.traverse(o => { o.matrixAutoUpdate = true; if (o.userData?.isCollision || /col\d|collision/i.test(o.name)) o.visible = false; });
      return copy;
    };
    school = createDogfightTheatre({
      host: page.stage,
      planeName: name,
      // The plane the lessons fly on: the moves' counts are flown on it.
      airframe: fighter ? { key: `range:${templateOf(fighter)}`, name } : null,
      // The theatre's fights are flown over a floor at 0, as the school's
      // tests fly them, so a reconstruction here is the one the tests hold.
      groundY: 0,
      makePlane: () => new Aircraft(fighter.clone(true), null, schoolFrame()),
      planeVisual: i => (fighter ? visual(i === 0 ? enemy : fighter) : null),
      // A recorded fight's own types (features/dogfight-recordings): the
      // battle's parked one when it has it, else the template's own model
      // from its mod's tree (a promise; the theatre draws the battle's
      // fighter until it lands).
      planeVisualFor: (template, mod) => {
        const want = String(template ?? '').toLowerCase();
        const node = (page.level.spawnersRoot?.children ?? [])
          .find(n => templateOf(n).toLowerCase() === want && !page.isWreck?.(n));
        if (node) return visual(node);
        return recordedPlane(template, mod).then(scene => (scene ? visual(scene) : null));
      },
      // A recorded type's own airframe for the WHAT IF flights: the battle's
      // parked one, else built from its loaded model; null when it will not
      // build (the theatre flies the battle's fighter then).
      makePlaneFor: async (template, mod) => {
        const want = String(template ?? '').toLowerCase();
        let root = (page.level.spawnersRoot?.children ?? [])
          .find(n => templateOf(n).toLowerCase() === want && !page.isWreck?.(n)) ?? null;
        if (!root) {
          const [scene, { airframeRoot }] = await Promise.all([recordedPlane(template, mod), import('./plane-models.js')]);
          root = airframeRoot(scene);
        }
        if (!root) return null;
        try {
          new Aircraft(root.clone(true), null, schoolFrame());
        } catch (e) {
          console.warn(`dogfight what-if: ${template} airframe`, e);
          return null;
        }
        return () => new Aircraft(root.clone(true), null, schoolFrame());
      },
      onFly: (id, move) => flyLesson(id, move),
      onFlyCourse: id => flyRings(id),
      onClose: () => page.capture?.(),
      planes, plane: () => templateOf(myPlane()), onPlane: setPlane,
    });
    return school;
  }

  // A plane's own model by template, for the recorded fights: loaded once,
  // lazily, as the school's own page loads its planes (`plane-models.js`).
  const recordedPlane = (template, mod) => import('./plane-models.js').then(m => m.loadPlaneModel(template, mod));

  async function openSchool(id = null) {
    if (!fighterOn('airfield') && !fighterOn('enemyAir')) return;
    page.release?.();
    (await buildSchool()).open(id ?? dogfight?.state.lesson ?? null);
  }

  async function buildDogfight() {
    if (dogfight) return dogfight;
    const { createDogfightLive, Aircraft } = await loadSchool();
    if (dogfight) return dogfight;
    // The lines' airframes: the ace's (0) and yours (1), flown off the page
    // four times a second. Fresh each flight: an airframe reused carries its
    // servos and engines over from the last one and flies differently
    // (`tests/test_dogfight_school.py`). The clone shares its geometry.
    const airframe = { 0: () => fighterOn('enemyAir') ?? fighterOn('airfield'), 1: () => myPlane() };
    dogfight = createDogfightLive({
      makePlane: i => new Aircraft(airframe[i]().clone(true), null, schoolFrame()),
      planeName,
      stage: page.stage,
      // Staged over the firing line heading down range. The range's combat
      // area is 10 km square round the floor's middle (`PG.ARENA`); the
      // school's pilots turn back past 2.6 km from it and the coach turns
      // you back past 3.5 km.
      centre: () => [PG.LINE_X, PG.LINE_Z + 200],
      rangeCentre: () => [PG.WORLD / 2, -PG.WORLD / 2],
      groundAt: (x, z) => page.level.groundHeight?.(x, z) ?? PG.FLOOR,
      playerDrive: () => page.aircraft ?? null,
      playerRoot: () => page.occupancy?.root ?? null,
      seatPlayer: seatInPlane,
      aceBot: () => page.aceBot?.() ?? null,
      aceRoot: bot => bot?.vehicle?.node ?? null,
      gunOf: bot => liveGun(bot),
      snapPresentation: () => page.snapPresentation?.(),
      isWreck: node => !!node && !!page.isWreck?.(node),
      covered: () => !!page.covered?.() || !!school?.isOpen,
      localId: page.localId,
      ownerNode: id => page.damageVisuals?.get(id)?.node ?? null,
      camera: () => page.camera,
      scene: () => page.scene,
      // The ways-out card takes the mouse while the fight is held.
      releaseMouse: () => page.release?.(),
      captureMouse: () => page.capture?.(),
      // O ends the lesson and goes back to the school, on that lesson.
      openSchool: id => openSchool(id),
    });
    return dogfight;
  }

  /**
   * A bot's seat guns in the school pilot's terms (`dogfight-pilot.js`
   * `gunOf`): the round's speed and reach from its FireArms, and the wing
   * guns' spread and convergence from the muzzles as the hull carries them
   * (a Spitfire's sit 2.5 m out and point 1.6 degrees in).
   */
  const _gp = new THREE.Vector3(), _gr = new THREE.Vector3(), _gq = new THREE.Quaternion(), _gm = new THREE.Vector3(), _go = new THREE.Vector3();
  function liveGun(bot) {
    const group = (bot?.vehicle?.groups ?? []).find(g => (g.stats?.input ?? g.input) === 'c_PIFire');
    const root = bot?.vehicle?.node;
    if (!group || !root) return {};
    const st = group.stats ?? {};
    const out = { speed: st.velocity, reach: st.velocity * (st.projectile?.timeToLive ?? 1.5),
                  gravity: (st.projectile?.gravity ?? 0) * 14.7295379 };
    root.updateMatrixWorld(true);
    root.getWorldPosition(_go);
    root.getWorldQuaternion(_gq);
    _gr.set(1, 0, 0).applyQuaternion(_gq);
    let span = 0, converge = 0, n = 0;
    for (const m of group.muzzles ?? []) {
      const side = m.getWorldPosition(_gp).sub(_go).dot(_gr);
      const dir = _gm.set(0, 0, -1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
      span += Math.abs(side);
      converge += Math.asin(Math.max(-1, Math.min(1, -Math.sign(side || 1) * dir.dot(_gr)))) * 180 / Math.PI;
      n++;
    }
    if (n) { out.span = span / n; out.converge = Math.max(0, converge / n); }
    return out;
  }

  // --- the ring courses (`dogfight-course.js`) ------------------------------
  let course = null;
  /** `?course=<id>`: a ring course started when the man first stands. */
  let wantCourse = page.wantCourse ?? null;
  async function buildCourse() {
    if (course) return course;
    const { createRingCourse, Aircraft } = await loadSchool();
    if (course) return course;
    course = createRingCourse({
      stage: page.stage,
      // Flown over the range beyond the firing line, inside its 10 km
      // combat area (`PG.ARENA`).
      centre: () => [PG.LINE_X, PG.LINE_Z + 200],
      groundAt: (x, z) => page.level.groundHeight?.(x, z) ?? PG.FLOOR,
      playerDrive: () => page.aircraft ?? null,
      seatPlayer: seatInPlane,
      makePlane: () => new Aircraft(myPlane().clone(true), null, schoolFrame()),
      planeName,
      camera: () => page.camera,
      scene: () => page.scene,
      snapPresentation: () => page.snapPresentation?.(),
      covered: () => !!page.covered?.() || !!school?.isOpen,
      aceBot: () => page.aceBot?.() ?? null,
    });
    return course;
  }
  /** FLY THE COURSE: the live fight stopped, the course started. */
  async function flyRings(id) {
    if (!fighterOn('airfield') && !fighterOn('enemyAir')) return;
    dogfight?.stop();
    if (!inMyPlane()) seatInPlane();
    (await buildCourse()).start(id);
    page.capture?.();
  }

  /** FLY IT: straight into the fight, or the range reopened with an enemy
   *  pilot to be the ace when it has none. */
  /** The arena's bar: the lesson and the plane, hidden under a screen. */
  let arenaSaid = '';
  function drawArenaBar(covered) {
    arenaBar.hidden = covered || !!school?.isOpen;
    const lesson = dogfight?.active ? lessonById(dogfight.state.lesson) : null;
    const source = page.level.extras?.provingGround?.source;
    const said = [source ? String(source).replace(/_/g, ' ') : null, planeName(), lesson?.title ?? (course?.active ? 'Ring course' : null)]
      .filter(Boolean).join(' · ');
    if (said !== arenaSaid) { arenaSaid = said; arenaBar.querySelector('.pg-arena-what').textContent = said; }
  }

  /** The arena's Q: the next of the battle's planes, and the lesson flown
   *  again in it (or just the seat, with none going). */
  function nextPlane(step) {
    const list = planes();
    if (list.length < 2) return;
    const at = Math.max(0, list.findIndex(p => p.template === templateOf(myPlane())));
    setPlane(list[(at + step + list.length) % list.length].template);
    school?.redrawChoices?.();
    const st = dogfight?.active ? dogfight.state : null;
    if (st?.lesson) flyLesson(st.lesson, st.move);
    else seatInPlane();
  }

  async function flyLesson(id, move = null) {
    if (!lessonById(id)) return;
    course?.stop();
    if (!page.aceBot?.()) {
      page.reopenWith?.({ dogfight: id, botCount: 1, ...(move ? { move } : {}) });
      return;
    }
    if (!inMyPlane()) seatInPlane();
    (await buildDogfight()).start(id, move);
    page.capture?.();
  }

  // --- frame ------------------------------------------------------------------
  let built = false;
  let logTop = -1;
  /** `?vehicle=<template>`: the machine the player is seated in the first
   *  time he stands (the CONTROLS preview's ON THE RANGE), once. */
  let wantVehicle = page.wantVehicle ?? null;
  /** The enemy's pilots, seated every couple of seconds (`page.pilotBots`). */
  let pilotClock = 0;
  let pilotsSeated = 0;
  function frame(dt) {
    if (!page.level.extras?.provingGround) { panel.hidden = true; log.hidden = true; return; }
    if (page.pilotBots && (pilotClock += dt) > 2) {
      pilotClock = 0;
      pilotsSeated += page.pilotBots() || 0;
    }
    // The school's briefing (dogfight-briefing.js) is still being read:
    // nobody is put in the air, and the school does not open, until it closes.
    const held = !!page.schoolHeld?.();
    if (wantLesson && page.soldier && !page.soldierDead && !queued && !held) {
      const id = wantLesson, move = wantMove;
      wantLesson = wantMove = null;
      if (lessonById(id)) buildDogfight().then(d => d.start(id, move));
    }
    if (wantCourse && page.soldier && !page.soldierDead && !queued && !held) {
      const id = wantCourse;
      wantCourse = null;
      flyRings(id);
    }
    dogfight?.frame(dt);
    course?.frame(dt);
    if (wantVehicle && page.soldier && !page.soldierDead && !page.occupancy && !queued) {
      const want = String(wantVehicle).toLowerCase();
      const node = parkedVehicles().find(v => v.template.toLowerCase() === want)?.node;
      wantVehicle = null;
      if (node) pickVehicle(node);
    }
    const covered = !!page.covered?.();
    // A dogfight lesson in the air has the screen to itself: the range's
    // readout and hit log are for the floor (which the arena has not got).
    const flying = !!dogfight?.active || !!course?.active;
    panel.hidden = ARENA || covered || flying;
    log.hidden = ARENA || covered || flying;
    if (ARENA) drawArenaBar(covered);
    if (covered && arsenalOpen) closeArsenal(false);
    if (!built) {
      built = true;
      showPaths(pathsOn && !ARENA);
      if (!ARENA) {
        layBoards();
        silhouettes = createSilhouetteRange(page.scene, { floorY: page.level.groundHeight?.(SILHOUETTE_LANE_X, PG.LINE_Z) ?? PG.FLOOR });
        buildBench();
      }
      panel.querySelector('.pg-school-btn').hidden = !(fighterOn('airfield') || fighterOn('enemyAir'));
      const source = page.level.extras.provingGround.source;
      ui.battle.textContent = source ? `  ${String(source).replace(/_/g, ' ')}` : '';
    }
    if (built && wantSchool != null && !held) { openSchool(wantSchool || null); wantSchool = null; }
    // Under the minimap, whose box the HUD sizes.
    const mm = document.getElementById('minimap');
    const top = mm && !mm.hidden && mm.offsetHeight ? mm.offsetTop + mm.offsetHeight + 10 : 44;
    if (top !== logTop) { logTop = top; log.style.top = `${top}px`; }
    if (queued) {
      const ready = page.soldier && !page.soldierDead && !page.occupancy;
      if (ready || --queued.tries <= 0) {
        const { run } = queued;
        queued = null;
        if (ready) run();
      }
    }
    sampleRounds();
    for (let i = traces.length - 1; i >= 0; i--) {
      const trace = traces[i];
      if (!trace.done) continue;
      trace.doneAge += dt;
      if (trace.dot) {
        const d = page.camera.position.distanceTo(trace.dot.position);
        trace.dot.scale.setScalar(Math.max(1, d / 40));
      }
      if (trace.doneAge > TRACE_HOLD) {
        dropTrace(trace);
        traces.splice(i, 1);
      }
    }
    silhouettes?.tick(dt);
    spotTick(dt);
    stockBench(dt);
    renderCard(dt);
    const group = currentGroup();
    setText(ui.weapon, prettyName(weaponName(group)) || '-');
    const r = rangefinder();
    setText(ui.range, Number.isFinite(r) ? fmtM(r) : '-');
    predict();
    if (zonesOn) {
      // A parked hull's parts are frozen (`level-statics.js` freezes what does
      // not move, and three then skips their subtree's world matrices), so a
      // zone hung on one would keep the identity it was born with and draw
      // at the world's origin. Composed here from its host's, every frame:
      // the host's is kept current by whatever moves it (a driven hull's
      // body, a turret's traverse).
      for (const { mesh, vehicle } of zoneMeshes) {
        mesh.visible = vehicle.visible;
        if (!mesh.visible) continue;
        mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
      }
      const att = attackerOf(group);
      if (att !== zonesFor) colourZones(att ?? null);
      const aimed = aimedZone();
      if (aimed) {
        const z = aimed.object.userData;
        const name = prettyName(z.vehicle?.name?.replace(/_\d+$/, '') ?? 'vehicle');
        const mat = materialName(z.defense, page.guns.materials);
        setText(ui.aimed, z.damage > 0
          ? `${name} ${mat}: ${fmtHp(z.damage)} hp head-on, ${Number.isFinite(z.hits) ? z.hits : '-'} to destroy`
          : `${name} ${mat}: no damage`);
      } else {
        setText(ui.aimed, att == null ? 'fire once to price' : '-');
      }
    }
  }

  return {
    frame,
    openSchool,
    flyLesson,
    get school() { return school; },
    get dogfight() { return dogfight; },
    flightOverride: input => { dogfight?.flightOverride(input); course?.flightOverride(input); },
    flyRings,
    get course() { return course; },
    planes, setPlane, get plane() { return templateOf(myPlane()); },
    get seatedIn() { return page.occupancy?.root ? templateOf(page.occupancy.root) : null; },
    noteImpact: (record, firerId) => dogfight?.noteImpact(record, firerId),
    clearTraces,
    showZones,
    openArsenal,
    closeArsenal,
    pickKit,
    pickVehicle,
    teleportTo,
    renderInset,
    get state() {
      return {
        traces: traces.map(t => ({ done: t.done, points: t.count, result: t.result })),
        log: rows.map(r => ({ n: r.n, ...r.row })),
        zones: zonesOn ? zoneMeshes.length : 0,
        zonesFor,
        predictOn,
        paths: pathsOn,
        arsenal: arsenalOpen,
        pilotsSeated,
        silhouettes: silhouettes?.state ?? null,
        bench: bench ? bench.slots.map(sl => ({ kit: sl.kit, laid: !!sl.objectId && !!page.kitLies?.(sl.objectId) })) : null,
        spotter: spot ? { label: spotterLabel.textContent, until: spot.until - spotClock } : null,
        card: cardEl.hidden ? null : { title: cardUi.title.textContent, detail: cardUi.detail.textContent, weak: cardUi.weak.textContent, model: !cardCanvas.hidden },
        factions: factions().map(f => ({ team: f.team, nation: f.nation, kits: f.kits.map(k => k.name) })),
        parked: parkedVehicles().map(v => v.template),
        weapon: weaponName(currentGroup()),
        attacker: attackerOf(currentGroup()),
      };
    },
    /** For the tests: the card drawn now, and how many of its pixels carry
     *  anything (a model that draws nothing reads 0). */
    cardSnapshot: () => {
      if (!cardGl || !cardLive) return null;
      renderCard(0);
      const gl = cardGl.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
      return { width: w, height: h, lit, parts: cardLive.model.parts.length, radius: cardLive.model.radius,
               centre: cardLive.model.centre.toArray(), camera: cardGl.camera.position.toArray() };
    },
    /** For the tests: the landing point's answer now. */
    predictNow: () => ({ visible: marker.visible, position: marker.position.toArray() }),
  };
}
