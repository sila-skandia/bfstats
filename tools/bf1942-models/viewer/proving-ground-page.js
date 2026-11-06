// The proving ground's instruments (features/proving-ground), over the level
// `proving-ground.js` builds: what a player practising with a weapon wants to
// see that a battle never shows.
//
// - Every round the player fires draws its path, and where it stops a tag
//   says how far it flew and for how long, how far it fell below its launch
//   line, and, on a vehicle or a soldier, what it cost: the hit points taken,
//   the material it met, the angle's share and what is left. A round whose
//   fuse ran out in the air says so, at the range it reached: the weapon's
//   reach, measured.
// - H colours every vehicle on the floor by its collision parts, priced for
//   the weapon in hand from the same MaterialManager tables the round is
//   priced with (`damage.json`): how many hits each part takes to destroy it.
//   The part under the crosshair is named in the panel.
// - U puts a marker where the round would land if fired now, worked from the
//   launch speed, fall and fuse of the last round this weapon fired. It needs
//   one shot to learn the weapon; a rocket's motor is not in it, and it says
//   so.
// - A rangefinder: the distance to whatever is under the crosshair.
//
// Nothing here prices or moves anything; it reads the page's guns and draws.

import * as THREE from 'three';
import { PG, PG_COLOURS } from './proving-ground.js';

/** Rounds whose paths are kept, newest first. */
const TRACE_MAX = 24;
/** Seconds a finished path and its tag stay up. */
const TRACE_HOLD = 14;
/** Points kept along one path (a sample every frame, thinned past this). */
const TRACE_POINTS = 240;
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

const fmtM = m => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtS = s => `${s.toFixed(s < 10 ? 2 : 1)} s`;
const fmtHp = hp => (hp >= 10 ? hp.toFixed(0) : hp.toFixed(1));

/**
 * Built once by the map page when the level is the proving ground. `page`
 * hands in getters: `scene`, `camera`, `guns`, `level` (its `extras`,
 * `spawnersRoot`, `vehicleDamage`, `groundHeight`), `damageVisuals`,
 * `isLocalGroup(group)`, `handGroup()` (the hand weapon's gun group, on foot),
 * `seatGroups()` (the guns of the seat he holds),
 * `keyboardTaken()`, `stage` (the element the panel goes in), `decode(name)`.
 */
export function createProvingGroundPage(page) {
  const root = new THREE.Group();
  root.name = 'provingGroundInstruments';
  page.scene.add(root);

  // --- the panel -------------------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'pg-panel';
  panel.innerHTML = `
    <div class="pg-head"><span class="pg-title">PROVING GROUND</span><span class="pg-battle"></span></div>
    <div class="pg-row"><span>WEAPON</span><b class="pg-weapon">-</b></div>
    <div class="pg-row"><span>RANGE</span><b class="pg-range">-</b></div>
    <div class="pg-row pg-predict-row" hidden><span>LANDS</span><b class="pg-predict">-</b></div>
    <div class="pg-last" hidden>
      <div class="pg-sub">LAST ROUND</div>
      <div class="pg-row"><span>FLEW</span><b class="pg-flew">-</b></div>
      <div class="pg-row"><span>TIME</span><b class="pg-time">-</b></div>
      <div class="pg-row"><span>DROP</span><b class="pg-drop">-</b></div>
      <div class="pg-row pg-hit-row" hidden><span>HIT</span><b class="pg-hit">-</b></div>
    </div>
    <div class="pg-zones" hidden>
      <div class="pg-sub">HITS TO DESTROY</div>
      <div class="pg-legend">${BANDS.map(b => `<i style="--c:#${b.color.toString(16).padStart(6, '0')}">${b.label}</i>`).join('')}<i style="--c:#${IMMUNE.toString(16)}">none</i></div>
      <div class="pg-row"><span>AIMED AT</span><b class="pg-aimed">-</b></div>
    </div>
    <div class="pg-keys"><kbd>H</kbd> hit zones <kbd>U</kbd> landing point <kbd>J</kbd> clear paths</div>`;
  page.stage.appendChild(panel);
  const $ = sel => panel.querySelector(sel);
  const ui = {
    battle: $('.pg-battle'), weapon: $('.pg-weapon'), range: $('.pg-range'),
    predictRow: $('.pg-predict-row'), predict: $('.pg-predict'),
    last: $('.pg-last'), flew: $('.pg-flew'), time: $('.pg-time'), drop: $('.pg-drop'),
    hitRow: $('.pg-hit-row'), hit: $('.pg-hit'),
    zones: $('.pg-zones'), aimed: $('.pg-aimed'),
  };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

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
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1f8a5c, transparent: true, opacity: 0.9, fog: true });
  const lineHot = new THREE.LineBasicMaterial({ color: 0xd64545, transparent: true, opacity: 0.95, fog: true });
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
    root.add(line);
    const trace = {
      shot, group: shot.group, origin, v0, line, positions, count: 0,
      age: 0, done: false, doneAge: 0, tag: null, result: null,
      lowest: 0,
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
    if (trace.tag) { trace.tag.removeFromParent(); trace.tag.material.map?.dispose(); trace.tag.material.dispose(); }
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

  function tagSprite(lines, hot) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 64 * lines.length + 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(8, 18, 14, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = hot ? '#ff7a6a' : '#5dffa8';
    ctx.fillRect(0, 0, 6, canvas.height);
    ctx.font = '600 40px "Courier New", monospace';
    ctx.textBaseline = 'top';
    lines.forEach((text, i) => {
      ctx.fillStyle = i === 0 ? (hot ? '#ffb0a6' : '#c9ffe2') : '#9fd8bb';
      ctx.fillText(text, 22, 12 + i * 64);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sprite.renderOrder = 40;
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
  }

  function finishTrace(trace, point, info = null) {
    if (trace.done) return;
    trace.done = true;
    trace.doneAge = 0;
    addPoint(trace, point);
    const flew = Math.hypot(point.x - trace.origin.x, point.z - trace.origin.z);
    const slant = point.distanceTo(trace.origin);
    const drop = dropAt(trace, point);
    const result = { flew, slant, time: trace.age, drop, expired: !!info?.expired, hit: info?.hit ?? null };
    trace.result = result;
    const lines = [`${fmtM(flew)}  ${fmtS(trace.age)}`];
    if (result.expired) lines.push('fuse ran out');
    if (result.hit) lines.push(result.hit.short);
    if (drop >= 0.05) lines.push(`fell ${drop < 10 ? drop.toFixed(1) : Math.round(drop)} m`);
    const hot = !!result.hit?.damage;
    trace.line.material = hot ? lineHot : lineMat;
    trace.tag = tagSprite(lines, hot);
    trace.tag.position.copy(point).add(_v.set(0, 2.2, 0));
    root.add(trace.tag);
    showLast(result);
  }

  function showLast(result) {
    ui.last.hidden = false;
    setText(ui.flew, `${fmtM(result.flew)}${result.expired ? ' (fuse)' : ''}`);
    setText(ui.time, fmtS(result.time));
    setText(ui.drop, `${result.drop.toFixed(result.drop < 10 ? 1 : 0)} m`);
    ui.hitRow.hidden = !result.hit;
    if (result.hit) setText(ui.hit, result.hit.long);
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

  /** What a landed round did, in the panel's words. */
  function describeHit(record) {
    if (record.kind === 'endOfLife') return null;
    const damage = record.damage ?? 0;
    const tables = page.guns.materials;
    const material = materialName(record.material, tables);
    if (record.target != null) {
      const where = record.bone ? ` ${record.bone}` : '';
      return {
        damage,
        short: damage > 0 ? `-${fmtHp(damage)} hp soldier${where}` : 'soldier, no damage',
        long: `soldier${where}: ${damage > 0 ? `-${fmtHp(damage)} hp` : 'no damage'}`,
      };
    }
    const vehicle = record.owner >= 0 ? page.level.vehicleDamage?.get(record.owner) : null;
    if (!vehicle) return null;
    const node = page.damageVisuals?.get(record.owner)?.node;
    const label = node?.name?.replace(/_\d+$/, '') ?? vehicle.name ?? 'vehicle';
    const hp = vehicle.armor?.hitPoints ?? 0;
    const max = vehicle.armor?.maxHitPoints ?? 0;
    const angle = record.incidence != null && record.incidence < 0.995 ? `, angle x${record.incidence.toFixed(2)}` : '';
    if (!(damage > 0)) {
      return { damage: 0, short: `${label}: no damage`, long: `${label} ${material}: no damage${angle}` };
    }
    return {
      damage,
      short: `-${fmtHp(damage)} hp ${label} ${material}`,
      long: `${label} ${material}: -${fmtHp(damage)} hp${angle}, ${fmtHp(Math.max(0, hp))}/${fmtHp(max)} left`,
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
    finishTrace(trace, point, { expired: record.kind === 'endOfLife', hit: describeHit(record) });
  };

  /** New rounds of the player's, sampled along their paths; one gone from
   *  the guns with no impact ran out its fuse where it was last seen. */
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
        addPoint(trace, roundAt(trace.shot, _at));
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
    ui.last.hidden = true;
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

  // --- hit zones ----------------------------------------------------------------
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

  // --- keys -------------------------------------------------------------------
  window.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (page.keyboardTaken?.()) return;
    if (e.code === 'KeyH') showZones(!zonesOn);
    else if (e.code === 'KeyU') predictOn = !predictOn;
    else if (e.code === 'KeyJ') clearTraces();
  });

  // --- frame ------------------------------------------------------------------
  let built = false;
  function frame(dt) {
    if (!page.level.extras?.provingGround) { panel.hidden = true; return; }
    panel.hidden = !!page.covered?.();
    if (!built) {
      built = true;
      layBoards();
      const source = page.level.extras.provingGround.source;
      ui.battle.textContent = source ? `  ${String(source).replace(/_/g, ' ')}` : '';
    }
    sampleRounds();
    for (let i = traces.length - 1; i >= 0; i--) {
      const trace = traces[i];
      if (!trace.done) continue;
      trace.doneAge += dt;
      if (trace.tag) {
        // A constant size on screen: about a tenth of the view's height.
        const d = page.camera.position.distanceTo(trace.tag.position);
        const h = Math.max(0.6, d * 0.06);
        trace.tag.scale.set(h * trace.tag.userData.aspect, h, 1);
      }
      if (trace.doneAge > TRACE_HOLD) {
        dropTrace(trace);
        traces.splice(i, 1);
      }
    }
    const group = currentGroup();
    setText(ui.weapon, weaponName(group) ?? '-');
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
        const name = z.vehicle?.name?.replace(/_\d+$/, '') ?? 'vehicle';
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
    clearTraces,
    showZones,
    get state() {
      return {
        traces: traces.map(t => ({ done: t.done, points: t.count, result: t.result })),
        zones: zonesOn ? zoneMeshes.length : 0,
        zonesFor,
        predictOn,
        weapon: weaponName(currentGroup()),
        attacker: attackerOf(currentGroup()),
      };
    },
    /** For the tests: the landing point's answer now. */
    predictNow: () => ({ visible: marker.visible, position: marker.position.toArray() }),
  };
}
