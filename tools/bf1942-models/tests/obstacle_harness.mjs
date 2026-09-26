// Drives barbed wire (`viewer/obstacle.js` and every module that acts on it)
// outside a browser and prints one JSON blob; `tests/test_obstacle.py`
// asserts on it. The modules are imported from the viewer tree in place
// through `sim/env.mjs`'s hooks, so the files under test are the files the
// page loads.
//
// What is pinned (ledger OBS-1..OBS-7, features/barbed-wire-parity/README.md):
//   - `Armor`'s collision list: an entry leaves exactly 1.0 s after it went in;
//   - a soldier held against wire loses 5 HP on the touch and 5 more each
//     second, dead from 30 HP on the sixth bill;
//   - a real walking body crosses a wire fence at `slowDownMod` (0.4) of its
//     speed, is billed through the world's soldier tick, and is stopped by the
//     same fence when it is not an `Obstacle`;
//   - the collision index knows wire per triangle (XPack2's fences carry the
//     wire as an `Obstacle` child of a `Bundle` beside a solid fence);
//   - a driven hull's static pass vetoes the wire's response and reports the
//     touch; anything else still stops it;
//   - the scrape: one voice per wire, restarted only once the last has ended.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [
  obstacle, { buildHeightfield }, { buildCollisionIndex }, { WorldCollider },
  { Soldier }, { Armor }, { soldierTick }, { collideWithStatics },
] = await Promise.all([
  imp('obstacle.js'), imp('heightfield.js'), imp('static-index.js'), imp('world-collider.js'),
  imp('soldier.js'), imp('armor.js'), imp('world-soldier-tick.js'), imp('body-statics.js'),
]);
const {
  ColObjectList, obstacleDamage, ScrapeVoices, OBSTACLE_DAMAGE, SLOW_DOWN_MOD,
  OBSTACLE_HANDLER_SPEED_SQ, COL_LIST_LIFETIME,
} = obstacle;

const TICK = 1 / 30;
const round = (v, k = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** k) / 10 ** k : v);
const results = {};

results.constants = {
  damage: OBSTACLE_DAMAGE, slowDownMod: SLOW_DOWN_MOD,
  gate: OBSTACLE_HANDLER_SPEED_SQ, lifetime: COL_LIST_LIFETIME,
};

// --- the collision list ------------------------------------------------------
{
  const list = new ColObjectList();
  const leaves = {};
  let t = 0;
  list.add('a');
  for (let i = 0; i < 90; i++) {
    t += TICK;
    if (i === 14) list.add('b');          // 0.5 s in
    list.update(TICK);
    for (const k of ['a', 'b']) {
      if (!(k in leaves) && !list.has(k) && (k === 'a' || i >= 14)) leaves[k] = round(t);
    }
  }
  results.colList = { leaves };
}

// --- held against the wire: the bill over time --------------------------------
{
  const armor = new Armor(30);
  const bills = [];
  let deadAt = null;
  for (let i = 0; i < 300 && deadAt === null; i++) {
    armor.colList?.update(TICK);
    const dmg = obstacleDamage(armor, 7);
    if (dmg > 0) {
      armor.damage(dmg);
      bills.push({ t: round(i * TICK), hp: round(armor.hitPoints) });
    }
    if (armor.destroyed) deadAt = round(i * TICK);
  }
  results.held = { bills, deadAt };
}

// --- a fence, walked through ---------------------------------------------------
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function fakeMesh(positions, { index = null, collision = true, kind = '' } = {}) {
  const node = {
    isMesh: true, name: kind || 'mesh', parent: null, children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: IDENTITY },
    geometry: {
      attributes: { position: { array: Float32Array.from(positions), count: positions.length / 3 } },
      index: index ? { array: Uint32Array.from(index), count: index.length } : null,
      userData: { defenseMaterial: 0, collision },
    },
    traverse(fn) { fn(node); for (const c of node.children) c.traverse(fn); },
  };
  return node;
}

function placed(templateKind, children, at = [0, 0, 0]) {
  const node = {
    name: templateKind, children, parent: null, userData: { templateKind },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1] },
    traverse(fn) { fn(node); for (const c of children) c.traverse(fn); },
  };
  for (const c of children) c.parent = node;
  return node;
}

function group(children) {
  const node = {
    children, parent: null, userData: {},
    traverse(fn) { fn(node); for (const c of children) c.traverse(fn); },
  };
  for (const c of children) c.parent = node;
  return node;
}

function flatGround() {
  const flat = [];
  for (let iz = 0; iz < 16; iz++) {
    for (let ix = 0; ix < 16; ix++) {
      const x0 = ix * 4, x1 = x0 + 4, z0 = -iz * 4, z1 = z0 - 4;
      flat.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
    }
  }
  return buildHeightfield([fakeMesh(flat, { collision: false, kind: 'terrain' })], { worldSize: 64 });
}

/** A coil: vertical sheets across x every 0.25 m from z0 down to z1, 1.1 m high. */
function coil(z0, z1) {
  const pos = [];
  const idx = [];
  for (let z = z0; z >= z1 - 1e-9; z -= 0.25) {
    const b = pos.length / 3;
    pos.push(0, 0, z, 64, 0, z, 64, 1.1, z, 0, 1.1, z);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return fakeMesh(pos, { index: idx });
}

function walkThrough(kind) {
  const ground = flatGround();
  const fence = placed(kind, [coil(-20, -24)], [32, 0, -22]);
  const root = group([fence]);
  const statics = buildCollisionIndex(root, { ownerRoots: [fence] });
  const collider = new WorldCollider({ heightfield: ground, statics });
  const soldier = new Soldier({ collider, worldSize: 64 });
  soldier.spawn(32, 0, -12, Math.PI);   // yaw pi faces -z
  const player = {
    id: 'p', soldier, armor: new Armor(30), occupancy: null,
    buffer: [], pending: null, held: null, last: null,
    lookApplied: { yaw: 0, pitch: 0 },
  };
  const world = { collider, damageTables: null, report: { obstacles: [] } };
  const trace = [];
  const events = [];
  for (let i = 0; i < 150; i++) {
    player.pending = { input: { forward: 1 }, lookX: 0, lookY: 0 };
    world.report.obstacles = [];
    const z0 = soldier.z;
    soldierTick(world, player, TICK);
    for (const e of world.report.obstacles) events.push({ tick: i, ...e });
    trace.push({
      tick: i, z: round(soldier.z), speed: round((z0 - soldier.z) / TICK),
      touched: world.report.obstacles.length > 0, hp: round(player.armor.hitPoints),
    });
  }
  return { trace, events, obstacleCount: statics.obstacleNodes.length };
}

{
  const wire = walkThrough('Obstacle');
  const wall = walkThrough('SimpleObject');
  const touchTicks = wire.trace.filter(r => r.touched).map(r => r.tick);
  const first = touchTicks[0] ?? null;
  const last = touchTicks[touchTicks.length - 1] ?? null;
  // Speed on a tick whose previous tick touched: the slow flag's tick.
  const slowed = wire.trace.filter((r, i) => i > 0 && wire.trace[i - 1].touched && r.tick <= last)
    .map(r => r.speed);
  const free = wire.trace.filter(r => r.tick > 20 && r.tick < (first ?? 0)).map(r => r.speed);
  const bills = wire.events.filter(e => e.lost > 0).map(e => ({ tick: e.tick, lost: e.lost }));
  results.walk = {
    obstacles: wire.obstacleCount,
    wireEndZ: wire.trace[wire.trace.length - 1].z,
    wallEndZ: wall.trace[wall.trace.length - 1].z,
    wallTouched: wall.events.length,
    firstTouch: first, lastTouch: last,
    freeSpeed: free.length ? round(free.reduce((a, b) => a + b, 0) / free.length) : null,
    slowedMin: slowed.length ? Math.min(...slowed) : null,
    slowedMax: slowed.length ? Math.max(...slowed) : null,
    bills,
    endHp: wire.trace[wire.trace.length - 1].hp,
    origin: wire.events[0]?.origin?.map(v => round(v)) ?? null,
    eventsPerTick: Math.max(0, ...Object.values(wire.events.reduce((m, e) => {
      m[e.tick] = (m[e.tick] ?? 0) + 1; return m;
    }, {}))),
  };
}

// --- per triangle: XPack2's fence, a Bundle with a wire child ---------------------
{
  const solid = fakeMesh([0, 0, -10, 10, 0, -10, 10, 2, -10, 0, 2, -10], { index: [0, 1, 2, 0, 2, 3] });
  const barbs = fakeMesh([0, 0, -12, 10, 0, -12, 10, 2, -12, 0, 2, -12], { index: [0, 1, 2, 0, 2, 3] });
  const fenceChild = placed('SimpleObject', [solid]);
  const wireChild = placed('Obstacle', [barbs]);
  const bundle = placed('Bundle', [fenceChild, wireChild]);
  const statics = buildCollisionIndex(group([bundle]), { ownerRoots: [bundle] });
  const collider = new WorldCollider({ statics });
  const fenceHit = collider.cast(5, 1, 0, 0, 0, -1, 30);
  const fenceObstacle = collider.obstacleAt(fenceHit);
  const wireHit = collider.cast(5, 1, -11, 0, 0, -1, 30);
  const wireObstacle = collider.obstacleAt(wireHit);
  const swept = collider.sweepSphere(5, 1, -11, 0, 0, -1, 5, 0.3);
  const sweptObstacle = collider.obstacleAt(swept);
  const past = collider.sweepSphere(5, 1, -11, 0, 0, -1, 5, 0.3, -1, false, -Infinity, 2, true);
  const intoFence = collider.sweepSphere(5, 1, -8, 0, 0, -1, 5, 0.3, -1, false, -Infinity, 2, true);
  results.perTriangle = {
    obstacles: statics.obstacleNodes.length,
    fenceObstacle, wireObstacle, sweptObstacle,
    wireNodeKind: collider.obstacleNode(wireObstacle)?.userData?.templateKind ?? null,
    passedWire: past === null,
    fenceStillStops: intoFence !== null && collider.obstacleAt(intoFence) === -1,
    passFlagCleared: statics.passObstacles === false,
  };
}

// --- a driven hull's static pass --------------------------------------------------
{
  class FakeStatics {
    constructor(obstacle) { this.obstacle = obstacle; this.obstacleCalls = 0; }
    near() { return true; }
    cast(ox, oy, oz, dx, dy, dz, maxDist) {
      // A plane at z = -2.1 facing +z.
      if (dz >= 0) return null;
      const t = (-2.1 - oz) / dz;
      if (!(t >= 0 && t <= maxDist)) return null;
      return { x: ox + dx * t, y: oy + dy * t, z: -2.1, nx: 0, ny: 0, nz: 1, material: 0,
               owner: 3, triangle: 11 };
    }
    obstacleAt(hit) { this.obstacleCalls++; return hit.triangle === 11 && this.obstacle ? 4 : -1; }
  }
  function run(obstacleOn, speed) {
    const applied = [];
    const body = {
      pos: [0, 0, -0.2], v: [0, 0, -speed], mass: 1000, boundingRadius: 3, sleeping: false,
      tangentSpeed(_p, out) { out[0] = this.v[0]; out[1] = this.v[1]; out[2] = this.v[2]; return out; },
    };
    const part = {
      body, owner: 1, kind: 'hull', isRoot: true,
      shape: { layers: [{ vertices: Float32Array.from([0, 0, -2, 0.5, 0, -2, 0, 0.5, -2]) }] },
      worldPos(out) { out[0] = body.pos[0]; out[1] = body.pos[1]; out[2] = body.pos[2]; return out; },
      worldVertex(_l, vi, out) {
        const v = this.shape.layers[0].vertices;
        out[0] = body.pos[0] + v[vi * 3]; out[1] = body.pos[1] + v[vi * 3 + 1];
        out[2] = body.pos[2] + v[vi * 3 + 2]; return out;
      },
      response: { impulseOn: () => applied.push(1) },
    };
    const touched = [];
    const statics = new FakeStatics(obstacleOn);
    const n = collideWithStatics([part], statics, TICK, {
      materialValues: () => ({ friction: 0.5, elasticity: 0, resistance: 0 }),
      onObstacle: (p, id, pos) => touched.push({ owner: p.owner, id, z: round(pos[2]) }),
    });
    return { applied: n, touched };
  }
  results.hull = {
    fastWire: run(true, 10),
    slowWire: run(true, 0.2),
    fastWall: run(false, 10),
  };
}

// --- the scrape ---------------------------------------------------------------------
{
  const voices = new ScrapeVoices();
  const LENGTH = 1.2;
  const starts = [];
  for (let i = 0; i < 90; i++) {
    const now = i * TICK;
    if (voices.touch(1, now, LENGTH)) starts.push({ id: 1, t: round(now) });
    if (i >= 15 && i < 30 && voices.touch(2, now, LENGTH)) starts.push({ id: 2, t: round(now) });
  }
  let overlap = false;
  for (const id of [1, 2]) {
    const ts = starts.filter(s => s.id === id).map(s => s.t);
    for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] < LENGTH - 1e-6) overlap = true;
  }
  results.scrape = { starts, overlap, touches: 90 + 15 };
}

console.log(JSON.stringify(results));
