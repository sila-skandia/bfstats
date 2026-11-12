// A driven hull meets a soldier on foot, under node, for
// tests/test_hull_runover.py. Prints one JSON object.
//
// The owner's report (2026-11-12): a vehicle rolling over a soldier left them
// stuck under its model with no way out. In retail the hull pushes them or
// runs them over. The soldier is the vertex side of the pair (17
// `SkeletonCollisionMesh` vertices, `0x083af375`-`0x083af62a`), probed from
// their origin one tick ago in the hull's moving frame against the hull's
// faces (`ResponsePhysics::checkObjectVsObject` 0x08259690), and takes the
// whole correction (COL-2's share snap); a contact at 8 m/s or more bills the
// soldier-victim branch of COL-3 (`handleCollisionObjectVsObject` 0x081551c0).
//
// The pieces are the page's own: `SoldierBody` (walking-body.js) on a flat
// heightfield, the hull a box in a `CollisionIndex` the `WorldCollider` is
// told has moved each tick (`setMovedOwner`, the way `hull-bodies.js`
// `publishMovedHull` tells it about a driven hull), a tank-sized box and a
// jeep-sized one, each driven at 5 m/s (under the 8 m/s floor) and 12 m/s
// over a standing and a prone soldier. Then the hull stops on them, and they
// try to walk out.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { SoldierBody } = await imp('walking-body.js');
const { buildHeightfield } = await imp('heightfield.js');
const { buildCollisionIndex } = await imp('static-index.js');
const { WorldCollider } = await imp('world-collider.js');
const { World } = await imp('world.js');
const { Armor } = await imp('armor.js');

const DT = 1 / 30;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const r3 = v => Math.round(v * 1000) / 1000;

function fakeMesh(positions, { material = 0, collision = true, kind = '' } = {}) {
  const node = {
    isMesh: true, name: kind || 'mesh', parent: null, children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: IDENTITY },
    geometry: {
      attributes: { position: { array: Float32Array.from(positions), count: positions.length / 3 } },
      index: null,
      userData: { defenseMaterial: material, collision },
    },
    traverse(fn) { fn(node); for (const c of node.children) c.traverse(fn); },
  };
  return node;
}

function group(children) {
  const node = { children, parent: null, userData: {},
                 traverse(fn) { fn(node); for (const c of children) c.traverse(fn); } };
  for (const c of children) c.parent = node;
  return node;
}

function flatTile(height = 0, worldSize = 128, spacing = 4) {
  const positions = [];
  for (let iz = 0; iz < worldSize / spacing; iz++) {
    for (let ix = 0; ix < worldSize / spacing; ix++) {
      const x0 = ix * spacing, x1 = x0 + spacing, z0 = -iz * spacing, z1 = z0 - spacing;
      positions.push(x0, height, z0, x1, height, z0, x1, height, z1);
      positions.push(x0, height, z0, x1, height, z1, x0, height, z1);
    }
  }
  return fakeMesh(positions, { collision: false, kind: 'terrain' });
}

/**
 * A closed box wound as the level bakes wind a hull: every triangle's
 * `(v1 - v0) x (v2 - v0)` points into the box (Wake's baked hulls, all 872
 * closed collision meshes of more than 0.2 m^3, measure a negative signed
 * volume by that rule; ledger COL-23's engine normal is its opposite).
 */
function box(x0, y0, z0, x1, y1, z1, material) {
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
             [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const positions = [];
  for (const q of quads) {
    for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      let [a, b, d] = tri.map(i => v[i]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] + (a[2] - c[2]) * n[2];
      if (out > 0) [b, d] = [d, b];     // make e1 x e2 point inward
      positions.push(...a, ...b, ...d);
    }
  }
  return fakeMesh(positions, { material });
}

// The hulls, measured in the hull's own frame with its origin on the ground
// under its middle: a Sherman-sized box (2.6 x 5.8 m, belly 0.45 m over the
// ground, deck 2.0 m) and a Willys-sized one (1.6 x 3.4 m, belly 0.35 m, top
// 1.3 m). Materials as Wake's baked hulls carry them: `ShermanComplex`'s
// col1 50 (armour, 50-52), `WillyCockpitExternal`'s col1 45.
const HULLS = {
  tank: { halfW: 1.3, halfL: 2.9, belly: 0.45, top: 2.0, material: 50 },
  jeep: { halfW: 0.8, halfL: 1.7, belly: 0.35, top: 1.3, material: 45 },
};

const field = buildHeightfield([flatTile(0)], { worldSize: 128, dim: 32 });
const SOLDIER = { x: 64, z: -64 };

function translation(dx, dy, dz) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
}

/** Inside the hull's box, the soldier's origin (a metre over their feet). */
function insideHull(spec, hx, s) {
  const ox = s.position.x - hx, oy = s.position.y + 1.0, oz = s.position.z - SOLDIER.z;
  return Math.abs(oz) < spec.halfW && Math.abs(ox) < spec.halfL && oy > spec.belly && oy < spec.top;
}

const VERTS = [[0, -1, 0], [-0.2, -0.6, -0.2], [-0.2, -0.6, 0.2], [0.2, -0.6, 0.2], [0.2, -0.6, -0.2],
  [-0.2, 0, -0.4], [-0.4, 0, -0.2], [-0.4, 0, 0.2], [-0.2, 0, 0.4], [0.2, 0, 0.4], [0.4, 0, 0.2],
  [0.4, 0, -0.2], [0.2, 0, -0.4], [0, 0.8, -0.4], [0, 0.8, 0.4], [0.4, 0.8, 0], [-0.4, 0.8, 0]];

/** How deep the soldier's deepest vertex is inside the box, 0 when none is. */
function overlapDepth(spec, hx, s) {
  let deepest = 0;
  for (const [vx, vy, vz] of VERTS) {
    const x = s.position.x + vx - hx, y = s.position.y + 1 + vy, z = s.position.z + vz - SOLDIER.z;
    const d = Math.min(spec.halfW - Math.abs(z), spec.halfL - Math.abs(x), y - spec.belly, spec.top - y);
    if (d > deepest) deepest = d;
  }
  return deepest;
}

/** A hull box baked with its middle at the soldier's spot, in a collider. */
function stage(kind) {
  const spec = HULLS[kind];
  const hull = box(SOLDIER.x - spec.halfL, spec.belly, SOLDIER.z - spec.halfW,
                   SOLDIER.x + spec.halfL, spec.top, SOLDIER.z + spec.halfW, spec.material);
  const statics = buildCollisionIndex(group([hull]), { ownerRoots: [hull] });
  const world = new WorldCollider({ heightfield: field, statics });
  const owner = statics.ownerOf(hull);
  const radius = Math.hypot(spec.halfW, spec.halfL, spec.top);
  const at = { hx: SOLDIER.x - 8 };
  // `hull-bodies.js` `publishMovedHull`'s call: baked frame to world and back.
  at.publish = () => {
    const dx = at.hx - SOLDIER.x;
    world.setMovedOwner(owner, translation(dx, 0, 0), translation(-dx, 0, 0), at.hx, spec.top / 2, SOLDIER.z, radius);
  };
  at.publish();
  return { spec, world, owner, at, hull };
}

/**
 * Drive `kind` along +x through the soldier at `speed` until the hull's middle
 * is over where they stood, then let them try to walk out sideways (+z).
 */
function run(kind, speed, prone) {
  const { spec, world, at } = stage(kind);
  const s = new SoldierBody({ world, yaw: 0 });
  s.place(SOLDIER.x, 0, SOLDIER.z, 0);
  if (prone) s.setProne(true);
  for (let i = 0; i < 30; i++) s.step(DT, {});
  const start = { x: s.position.x, z: s.position.z };
  let insideTicks = 0, deepest = 0;
  const contacts = [];
  while (at.hx < SOLDIER.x) {
    at.hx = Math.min(SOLDIER.x, at.hx + speed * DT);
    at.publish();
    s.step(DT, {});
    if (insideHull(spec, at.hx, s)) insideTicks++;
    deepest = Math.max(deepest, overlapDepth(spec, at.hx, s));
    for (const c of s.hullContacts) contacts.push(c);
  }
  const afterDrive = { ahead: r3(s.position.x - at.hx), y: r3(s.position.y), z: r3(s.position.z - SOLDIER.z),
                       inside: insideHull(spec, at.hx, s), depth: r3(overlapDepth(spec, at.hx, s)) };
  for (let i = 0; i < 90; i++) { at.publish(); s.step(DT, { forward: 1 }); }
  return {
    kind, speed, prone, insideTicks, deepest: r3(deepest), contacts: contacts.length,
    afterDrive,
    afterWalk: { z: r3(s.position.z - SOLDIER.z), inside: insideHull(spec, at.hx, s),
                 depth: r3(overlapDepth(spec, at.hx, s)) },
    walked: r3(Math.hypot(s.position.x - start.x, s.position.z - start.z)),
    walkedOut: overlapDepth(spec, at.hx, s) === 0
      && (Math.abs(s.position.z - SOLDIER.z) >= spec.halfW || Math.abs(s.position.x - at.hx) >= spec.halfL),
    maxContactSpeed: r3(Math.max(0, ...contacts.map(c => c.speed))),
    // The face that pushed them first, and which way it pushed.
    firstNormal: contacts[0] ? contacts[0].normal.map(r3) : null,
    firstMaterial: contacts[0]?.material ?? null,
  };
}

/** The bug's own end state: a hull parked over the soldier (their origin
 *  inside it), and they walk out. The engine finds no face from inside. */
function parkedOver(kind) {
  const { spec, world, at } = stage(kind);
  at.hx = SOLDIER.x;
  at.publish();
  const s = new SoldierBody({ world, yaw: 0 });
  // Feet 0.5 m over the ground for the tank (origin 1.5 m, inside its box
  // from 0.45 to 2.0); for the jeep, feet on its belly face (where the old
  // resolve stood them, y 0.35).
  s.place(SOLDIER.x, kind === 'tank' ? 0 : spec.belly, SOLDIER.z, 0);
  s.step(DT, {});
  for (let i = 0; i < 90; i++) { at.publish(); s.step(DT, { forward: 1 }); }
  return { kind, z: r3(s.position.z - SOLDIER.z), y: r3(s.position.y),
           depth: r3(overlapDepth(spec, at.hx, s)), inside: insideHull(spec, at.hx, s) };
}

/** A hull that keeps driving: the soldier rides in front of its nose. */
function shoved(kind, speed, seconds) {
  const { spec, world, at } = stage(kind);
  const s = new SoldierBody({ world, yaw: 0 });
  s.place(SOLDIER.x, 0, SOLDIER.z, 0);
  for (let i = 0; i < 30; i++) s.step(DT, {});
  let deepest = 0;
  const gaps = [];
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    at.hx += speed * DT;
    at.publish();
    s.step(DT, {});
    deepest = Math.max(deepest, overlapDepth(spec, at.hx, s));
    if (at.hx > SOLDIER.x - 4) gaps.push(s.position.x - (at.hx + spec.halfL));
  }
  return { kind, speed, deepest: r3(deepest), gapMin: r3(Math.min(...gaps)), gapMax: r3(Math.max(...gaps)),
           carried: r3(s.position.x - SOLDIER.x), vx: r3(s.velocity.x), y: r3(s.position.y) };
}

/** Through the World's soldier tick (`world-soldier-tick.js`): the run-over
 *  billed to their Armor, 30 HP, against the shipped damage tables. */
function worldRunOver(kind, speed, every = 1) {
  const { spec, world: collider, at } = stage(kind);
  const extras = {
    worldSize: 128,
    controlPoints: [{ name: 'A', spawnGroupId: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z] }],
    soldierSpawns: [{ name: 'A1', group: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z], rotation: [180, 0, 0] }],
    tickets: { 1: 100, 2: 100 },
  };
  const damageTables = JSON.parse(readFileSync(path.join(viewer, 'maps', '_shared', 'damage.json'), 'utf8'));
  const w = new World({ collider, extras, damageTables, groundHeight: () => 0 });
  const p = w.addPlayer('P', { team: 1 });
  w.setPlayerArmor('P', new Armor(30));
  for (let i = 0; i < 30; i++) w.step(DT);
  const hp0 = p.armor.hitPoints;
  let ticks = 0;
  while (at.hx < SOLDIER.x + 4 && ticks < 300) {
    at.hx += speed * DT;
    // `every` > 1: the pose published once a frame of that many ticks, as
    // the page's `stepVehicleBodies` did (El Alamein's taxiing Bf109).
    if (ticks % every === 0) at.publish();
    w.step(DT);
    ticks++;
  }
  return { kind, speed, every, hp0, hp: r3(p.armor.hitPoints), dead: !!p.armor.destroyed,
           lost: r3(hp0 - p.armor.hitPoints) };
}

/**
 * Who the run-over is credited to, and SEAT-33's grace, through the World:
 * a victim 'V' (team 1) on foot, a driver 'D' sat in the hull's root seat
 * (`setPlayerVehicle` with an occupancy whose root is the hull), the hull
 * driven into V at `speed`. `driverTeam` the driver's side; `driverLeftAgo`
 * seconds before the hit the driver got out (null: still in); `victimLeftAgo`
 * the same for the victim, who rode in it (null: never).
 */
function credit({ speed = 12, driverTeam = 2, driverLeftAgo = null, victimLeftAgo = null } = {}) {
  const { world: collider, at, hull } = stage('tank');
  const extras = {
    worldSize: 128,
    controlPoints: [{ name: 'A', spawnGroupId: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z] },
                    { name: 'B', spawnGroupId: 2, team: 2, position: [SOLDIER.x, 0, SOLDIER.z - 30] }],
    soldierSpawns: [{ name: 'A1', group: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z], rotation: [180, 0, 0] },
                    { name: 'B1', group: 2, team: 2, position: [SOLDIER.x, 0, SOLDIER.z - 30], rotation: [180, 0, 0] }],
    tickets: { 1: 100, 2: 100 },
  };
  const damageTables = JSON.parse(readFileSync(path.join(viewer, 'maps', '_shared', 'damage.json'), 'utf8'));
  const w = new World({ collider, extras, damageTables, groundHeight: () => 0 });
  const v = w.addPlayer('V', { team: 1 });
  w.setPlayerArmor('V', new Armor(30));
  const d = w.addPlayer('D', { team: driverTeam });
  w.setPlayerArmor('D', new Armor(30));
  const occupancy = { root: hull, isActiveRoot: () => true, activeFireArmsNodes: () => [], activeSeatId: 0, rootId: 0 };
  const seat = id => w.setPlayerVehicle(id, { occupancy, vehicle: null, kind: 'seat' });
  seat('D');
  w.setPlayerPosition('D', [at.hx, 1, SOLDIER.z]);
  for (let i = 0; i < 10; i++) w.step(DT);
  // Ticks from the hull's start to its nose reaching V (8 m less its half
  // length and V's reach), so the exits land the given seconds before it.
  // The hull waits `WAIT` ticks before it moves, so an exit can come up to
  // 4 s before the hit.
  const WAIT = 120;
  const hitTick = WAIT + Math.floor((8 - 2.9 - 0.4) / (speed * DT));
  const leaveAt = s => (s == null ? -1 : hitTick - Math.round(s * 30));
  if (victimLeftAgo != null) seat('V');
  const runs = [];
  for (let tick = 0; tick < WAIT + 200 && at.hx < SOLDIER.x + 4; tick++) {
    if (tick === leaveAt(driverLeftAgo)) w.clearPlayerVehicle('D');
    if (victimLeftAgo != null && tick === leaveAt(victimLeftAgo)) {
      w.clearPlayerVehicle('V');
      v.soldier.spawn(SOLDIER.x, 0, SOLDIER.z, 0);
    }
    if (tick >= WAIT) at.hx += speed * DT;
    at.publish();
    const step = w.step(DT);
    for (const r of step.runOvers ?? []) runs.push(r);
  }
  return { speed, driverTeam, driverLeftAgo, victimLeftAgo, runs,
           hp: r3(v.armor.hitPoints), dead: !!v.armor.destroyed,
           // Wherever the shove left them (off the nose's corner, at 12 m/s,
           // and the hull past them), never inside it.
           depth: r3(overlapDepth(HULLS.tank, at.hx, v.soldier.body)) };
}

const out = { runs: [], parked: [], shoved: [], world: [], credit: [] };
out.credit.push(credit({}));
out.credit.push(credit({ driverTeam: 1 }));
out.credit.push(credit({ driverLeftAgo: 1 }));
out.credit.push(credit({ driverLeftAgo: 3 }));
out.credit.push(credit({ victimLeftAgo: 1 }));
out.credit.push(credit({ victimLeftAgo: 3 }));
for (const kind of ['tank', 'jeep']) {
  for (const speed of [5, 12]) {
    for (const prone of [false, true]) out.runs.push(run(kind, speed, prone));
  }
  out.parked.push(parkedOver(kind));
  out.shoved.push(shoved(kind, 5, 4));
  for (const speed of [5, 9, 12]) out.world.push(worldRunOver(kind, speed));
}
// --- the hull's turning and its mass (COL-2; `pushOutOfHulls`) -------------
//
// `relV` and `S` take the roots' linear speeds; a hit's speed is the hull's
// tangent speed there, spin included (`getTangentSpeed` 0x08254b90). A tank
// box pivoting on the spot about its middle sweeps a soldier standing off
// its stern corner: the root does not move, the corner does, at omega x r.
const { hullShares } = await imp('soldier-resolve.js');
function rotationAbout(cx, cz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  // x' = c (x - cx) + s (z - cz) + cx ; z' = -s (x - cx) + c (z - cz) + cz  (a turn about +y)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0,
          cx - c * cx - s * cz, 0, cz + s * cx - c * cz, 1];
}
function spin(omega) {
  const { spec, world, owner } = stage('tank');
  const radius = Math.hypot(spec.halfW, spec.halfL, spec.top);
  let angle = 0;
  const publish = () => world.setMovedOwner(owner, rotationAbout(SOLDIER.x, SOLDIER.z, angle),
    rotationAbout(SOLDIER.x, SOLDIER.z, -angle), SOLDIER.x, spec.top / 2, SOLDIER.z, radius);
  publish();
  const s = new SoldierBody({ world, yaw: 0 });
  // Off the stern, beside its corner: the turn brings the side into them.
  const sx = SOLDIER.x + spec.halfL - 0.3, sz = SOLDIER.z + spec.halfW + 0.45;
  s.place(sx, 0, sz, 0);
  for (let i = 0; i < 10; i++) { publish(); s.step(DT, {}); }
  const contacts = [];
  for (let i = 0; i < 40 && !contacts.length; i++) {
    angle += omega * DT;
    publish();
    s.step(DT, {});
    for (const c of s.hullContacts) contacts.push(c);
  }
  const first = contacts[0] ?? null;
  const at = first ? Math.hypot(first.x - SOLDIER.x, first.z - SOLDIER.z) : null;
  return {
    omega, contacts: contacts.length,
    firstHullSpeed: first ? r3(Math.hypot(...first.hullVelocity)) : null,
    firstArm: at === null ? null : r3(at),
    moved: r3(Math.hypot(s.position.x - sx, s.position.z - sz)),
  };
}
out.spin = [spin(Math.PI / 2), spin(Math.PI)];

// A light hull, 1000 kg against the soldier's 100: s = 1000 / 1100, so they
// take 0.909 of the push and the hull -0.091 of it through its own response.
function light(mass) {
  const { spec, world, owner, at } = stage('jeep');
  const radius = Math.hypot(spec.halfW, spec.halfL, spec.top);
  at.publish = () => {
    const dx = at.hx - SOLDIER.x;
    world.setMovedOwner(owner, translation(dx, 0, 0), translation(-dx, 0, 0), at.hx, spec.top / 2,
                        SOLDIER.z, radius, mass);
  };
  at.publish();
  const s = new SoldierBody({ world, yaw: 0 });
  s.place(SOLDIER.x, 0, SOLDIER.z, 0);
  for (let i = 0; i < 30; i++) s.step(DT, {});
  const reactions = [];
  let firstPush = null;
  for (let i = 0; i < 200 && at.hx < SOLDIER.x; i++) {
    at.hx = Math.min(SOLDIER.x, at.hx + 5 * DT);
    at.publish();
    const x0 = s.position.x;
    s.step(DT, {});
    for (const r of s.hullReactions ?? []) reactions.push(r);
    if (firstPush === null && s.hullPushed) firstPush = r3(s.position.x - x0);
    s.hullPushed = false;
  }
  const r0 = reactions[0] ?? null;
  return { mass, reactions: reactions.length, firstPush,
           firstReaction: r0 && { push: r0.push.map(v => r3(v)), accel: r0.accel.map(v => r3(v)) } };
}
out.light = [light(1000), light(2500), light(null)];
out.shares = [2500, 1900, 1000, 100, 3, null].map(m => {
  const { a, b } = hullShares(m);
  return [m, Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6];
});

// --- a soldier who gets out beside a hull that moved while they sat ---------
//
// Their hull tracks (`walker._hullSeen`) were not stepped in a seat. A hull
// that crept 1.1 m in that time read, on the first look out, as one tick's
// 33 m/s and billed 177 HP from a hull doing 0.01 m/s (the driver-avoid
// builder's rennpiste_gebirge seed 6). Seated, the world now keeps the tracks
// up (`seatedHullWatch`). `bypass` takes the player out of the world for the
// creep and puts the same record back, so nothing steps or watches their body
// and only the world-tick re-seed in `trackHulls` stands between them and the
// bill.
function staleExit({ driveAfter = 0, bypass = false } = {}) {
  const { world: collider, at } = stage('tank');
  const extras = {
    worldSize: 128,
    controlPoints: [{ name: 'A', spawnGroupId: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z] }],
    soldierSpawns: [{ name: 'A1', group: 1, team: 1, position: [SOLDIER.x, 0, SOLDIER.z], rotation: [180, 0, 0] }],
    tickets: { 1: 100, 2: 100 },
  };
  const damageTables = JSON.parse(readFileSync(path.join(viewer, 'maps', '_shared', 'damage.json'), 'utf8'));
  const w = new World({ collider, extras, damageTables, groundHeight: () => 0 });
  const v = w.addPlayer('V', { team: 1 });
  w.setPlayerArmor('V', new Armor(1000));
  // The nose 1.1 m short of their reach, less a centimetre: it creeps the
  // 1.1 m while they sit, and they get out touching it.
  at.hx = SOLDIER.x - 2.9 - 0.4 - 1.1 + 0.01;
  at.publish();
  for (let i = 0; i < 30; i++) w.step(DT);
  const other = { name: 'another hull' };
  const occupancy = { root: other, isActiveRoot: () => true, activeFireArmsNodes: () => [], activeSeatId: 0, rootId: 0 };
  if (bypass) w.players.delete('V');
  else w.setPlayerVehicle('V', { occupancy, vehicle: null, kind: 'seat' });
  for (let i = 0; i < 60; i++) { at.hx += 1.1 / 60; at.publish(); w.step(DT); }
  if (bypass) w.players.set('V', v);
  else w.clearPlayerVehicle('V');
  const x0 = v.soldier.x;
  const hp0 = v.armor.hitPoints;
  const runs = [];
  for (let i = 0; i < 60; i++) {
    at.hx += (driveAfter || 0.01) * DT;
    at.publish();
    const step = w.step(DT);
    for (const r of step.runOvers ?? []) runs.push(r);
  }
  return { driveAfter, bypass, runs: runs.length, lost: r3(hp0 - v.armor.hitPoints),
           pushed: r3(Math.abs(v.soldier.x - x0)) };
}
// A pose published once every two or three ticks: a 6.1 m/s hull is still a
// 6.1 m/s hull (no run-over, retail's floor is 8.0, 0x086c08c0 at
// 0x08155a10), a 12 m/s one still kills.
out.cadence = [2, 3].flatMap(every => [6.1, 12].map(speed => worldRunOver('jeep', speed, every)));
out.staleExit = [staleExit(), staleExit({ bypass: true }), staleExit({ driveAfter: 9 })];

process.stdout.write(JSON.stringify(out));
