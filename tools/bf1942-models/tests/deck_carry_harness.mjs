// A soldier on foot on a moving deck, under node, for tests/test_deck_carry.py.
// Prints one JSON object.
//
// Retail carries what stands on a moving hull by the friction alone, on the
// contact's RELATIVE speed: `checkObjectVsObject` 0x08259690 takes
// `getTangentSpeed` (0x08254b90) of both roots at the hit, `impulseOn`
// 0x08258900 means it into `+0x74`, and `addFriction` 0x0825b6e0 works on
// `+0x74 - surfaceSpeed` (0x0825b887..0x0825b8ae). The page's soldier stood on
// a hull through a height and met the friction against the fixed world: a deck
// at 8 m/s left them behind at the deck's whole speed (the 2026-11-12 audit,
// seams-world). `deck-carry.js` hands the friction the deck's point speed.
//
// The pieces are the page's own: `SoldierBody` (walking-body.js) on a flat
// heightfield, the hull a box (or an open-topped tub, a landing craft's well)
// in a `CollisionIndex` the `WorldCollider` is told has moved each tick
// (`setMovedOwner`, as `hull-bodies.js` `publishMovedHull` does).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { SoldierBody } = await imp('walking-body.js');
const { buildHeightfield } = await imp('heightfield.js');
const { buildCollisionIndex } = await imp('static-index.js');
const { WorldCollider } = await imp('world-collider.js');

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

function flatTile(height, worldSize, spacing = 8) {
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

/** Closed boxes wound as the bakes wind a hull: `(v1 - v0) x (v2 - v0)` in. */
function boxes(list, material) {
  const positions = [];
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
               [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const q of quads) {
      for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        let [a, b, d] = tri.map(i => v[i]);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const out = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] + (a[2] - c[2]) * n[2];
        if (out > 0) [b, d] = [d, b];
        positions.push(...a, ...b, ...d);
      }
    }
  }
  return fakeMesh(positions, { material });
}

const WORLD = 1024;
const field = buildHeightfield([flatTile(0, WORLD)], { worldSize: WORLD, dim: WORLD / 8 });
// The hull's baked middle, its deck 2 m over the ground.
const C = { x: 300, z: -500 };
const TOP = 2.0;

/** A rigid move about the baked middle: yaw `a` (radians, about +y), then
 *  the middle carried to (C.x + dx, C.z + dz). Column-major, and its inverse. */
function pose(dx, dz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  // world = R (p - C) + C + d, R = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
  const tx = C.x + dx - (c * C.x + s * C.z), tz = C.z + dz - (-s * C.x + c * C.z);
  const fwd = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, 0, tz, 1];
  // inverse: R^T (w - t)
  const ix = -(c * tx - s * tz), iz = -(s * tx + c * tz);
  const inv = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, ix, 0, iz, 1];
  return { fwd, inv };
}

/** `kind`: 'deck' a 40 x 10 m flat deck; 'well' a 10 x 4 m tub, 1.2 m sides. */
function stage(kind) {
  const list = kind === 'well'
    ? [[C.x - 5, 0.5, C.z - 2, C.x + 5, TOP, C.z + 2],                 // the floor
       [C.x - 5, TOP, C.z - 2, C.x - 4.8, TOP + 1.2, C.z + 2],         // stern
       [C.x + 4.8, TOP, C.z - 2, C.x + 5, TOP + 1.2, C.z + 2],         // the ramp
       [C.x - 5, TOP, C.z - 2, C.x + 5, TOP + 1.2, C.z - 1.8],         // the sides
       [C.x - 5, TOP, C.z + 1.8, C.x + 5, TOP + 1.2, C.z + 2]]
    : [[C.x - 20, 0.5, C.z - 5, C.x + 20, TOP, C.z + 5]];
  const hull = boxes(list, 59);
  const statics = buildCollisionIndex(group([hull]), { ownerRoots: [hull] });
  const world = new WorldCollider({ heightfield: field, statics });
  const owner = statics.ownerOf(hull);
  const radius = kind === 'well' ? 6 : 21;
  const at = { dx: 0, dz: 0, a: 0 };
  at.publish = () => {
    const { fwd, inv } = pose(at.dx, at.dz, at.a);
    world.setMovedOwner(owner, fwd, inv, fwd[12] + C.x * fwd[0] + C.z * fwd[8], TOP / 2,
      fwd[14] + C.x * fwd[2] + C.z * fwd[10], radius);
  };
  at.publish();
  return { world, at };
}

/** World (x, z) into the deck's baked frame, relative to its middle. */
function deckLocal(at, x, z) {
  const { inv } = pose(at.dx, at.dz, at.a);
  return { x: inv[0] * x + inv[8] * z + inv[12] - C.x, z: inv[2] * x + inv[10] * z + inv[14] - C.z };
}

/**
 * The soldier stands at (lx, lz) off the deck's middle; the deck moves by
 * `motion(t, at)` each tick for `seconds`, the soldier given `input` all the
 * while. Returns where they are in the deck's frame, their height and speed.
 */
function ride(kind, { lx = 0, lz = 0, seconds = 3, input = {}, yaw = 0, motion }) {
  const { world, at } = stage(kind);
  const s = new SoldierBody({ world, yaw });
  s.place(C.x + lx, TOP, C.z + lz, yaw);
  for (let i = 0; i < 15; i++) { at.publish(); s.step(DT, {}); }
  const start = deckLocal(at, s.position.x, s.position.z);
  let lowest = Infinity, offAt = null;
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) {
    motion((i + 1) * DT, at);
    at.publish();
    s.step(DT, input);
    lowest = Math.min(lowest, s.position.y);
    if (offAt === null && s.position.y < TOP - 0.5) offAt = r3((i + 1) * DT);
  }
  const end = deckLocal(at, s.position.x, s.position.z);
  return {
    kind, seconds,
    drift: { x: r3(end.x - start.x), z: r3(end.z - start.z) },
    y: r3(s.position.y), lowest: r3(lowest), offAt,
    v: { x: r3(s.velocity.x), z: r3(s.velocity.z) },
    deck: { dx: r3(at.dx), dz: r3(at.dz), a: r3(at.a) },
  };
}

const out = { straight: [], turning: null, accelerating: null, walking: null, well: null, still: null };
// The audit's runs: 1, 3 and 8 m/s along +x, standing still, 3 s.
for (const speed of [1, 3, 8]) {
  out.straight.push({ speed, ...ride('deck', { motion: (t, at) => { at.dx = speed * t; } }) });
}
// Turning 0.2 rad/s about the middle, standing 15 m from it.
out.turning = ride('deck', { lx: 15, motion: (t, at) => { at.a = 0.2 * t; } });
// Under way and gathering speed: 0 to 8 m/s in 4 s (2 m/s^2), then on at 8.
out.accelerating = ride('deck', { seconds: 6, motion: (t, at) => {
  const tt = Math.min(t, 4);
  at.dx = t < 4 ? tt * tt : 16 + 8 * (t - 4);
} });
// Walking to the bow (+x: yaw pi/2 faces it) on a deck at 8 m/s:
// their speed over the deck is the run's, not the run's less the deck's.
const still = ride('deck', { lx: -15, yaw: Math.PI / 2, seconds: 2, input: { forward: 1 }, motion: () => {} });
const walking = ride('deck', { lx: -15, yaw: Math.PI / 2, seconds: 2, input: { forward: 1 },
  motion: (t, at) => { at.dx = 8 * t; } });
out.still = still;
out.walking = walking;
// A landing craft's well (the LCVP, the Daihatsu) at 8 m/s: neither left
// behind nor bulldozed by the stern.
out.well = ride('well', { motion: (t, at) => { at.dx = 8 * t; } });
process.stdout.write(JSON.stringify(out));
