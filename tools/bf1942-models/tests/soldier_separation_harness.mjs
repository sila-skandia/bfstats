// Soldier against soldier, under node, for tests/test_soldier_separation.py.
// Prints one JSON object.
//
// `ResponsePhysics::checkObjectVsObject` lnxded 0x08259690's branch for two
// soldiers (0x0825a4c7..0x0825a8f0): closer than 1.0 m (3-D), they are pushed
// apart horizontally by `n (1 - |d|)`, the push split by
// `max(|v . push|, 0.9 |push|)` a side; positions only. Built as
// `world-soldier-tick.js` `separateSoldiers`, run once a world tick after
// every soldier has stepped (world.js).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, loadViewerModules, viewerDir } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { separateSoldiers, SOLDIER_SEPARATION } = await imp('world-soldier-tick.js');
const { Soldier } = await imp('soldier.js');
const M = await loadViewerModules(viewer);

const r4 = v => Math.round(v * 1e4) / 1e4;
const out = { separation: SOLDIER_SEPARATION };

/** A wall at x = `wallX`, facing -x, as a `sweepSphere` the capsule meets. */
function wallCollider(wallX) {
  return {
    sweepSphere(x, y, z, dx, dy, dz, dist, radius) {
      if (dx <= 0) return null;
      const t = (wallX - radius - x) / dx;
      if (t < 0 || t > dist) return null;
      return { t, nx: -1, ny: 0, nz: 0, px: wallX, py: y, pz: z, material: 0, owner: -1, depth: 0 };
    },
  };
}

/** Soldiers stood at `spots` (`[x, y, z, vx, vz]`), one separation pass. */
function pass(spots, { collider = null, dead = [], seated = [], unspawned = [] } = {}) {
  const players = new Map();
  spots.forEach(([x, y, z, vx = 0, vz = 0], i) => {
    const soldier = new Soldier({ collider });
    soldier.spawn(x, y, z, 0);
    soldier.body.grounded = true;
    if (unspawned.includes(i)) soldier.spawned = false;
    soldier.body.velocity.x = vx;
    soldier.body.velocity.z = vz;
    players.set(`p${i}`, {
      id: `p${i}`, soldier,
      armor: dead.includes(i) ? { destroyed: true } : { destroyed: false },
      occupancy: seated.includes(i) ? { seat: 0 } : null,
    });
  });
  separateSoldiers({ players });
  return [...players.values()].map(p => {
    const q = p.soldier.body.position;
    return [r4(q.x), r4(q.y), r4(q.z)];
  });
}

// Two still soldiers 0.4 m apart: each takes half of the 0.6 m.
out.still = pass([[10, 0, 10], [10.4, 0, 10]]);
// One running into the other at 4 m/s along the push: |vA . push| = 2.4
// against B's floor 0.9 x 0.6 = 0.54, so A takes 2.4 / 2.94 of it.
out.running = pass([[10, 0, 10, 4, 0], [10.4, 0, 10]]);
// One on top of the other: along +z, half a metre each.
out.coincident = pass([[10, 0, 10], [10, 0, 10]]);
// 0.9 m above and 0.3 m across: |d| = 0.9487, inside; the push is the
// horizontal part of n, 0.3 / 0.9487 x 0.0513, and nothing moves in y.
out.stacked = pass([[10, 0, 10], [10.3, 0.9, 10]]);
// 1.05 m apart: nothing.
out.apart = pass([[10, 0, 10], [11.05, 0, 10]]);
// The dead, the seated and the never deployed meet nobody.
out.dead = pass([[10, 0, 10], [10.4, 0, 10]], { dead: [1] });
out.seated = pass([[10, 0, 10], [10.4, 0, 10]], { seated: [0] });
out.unspawned = pass([[10, 0, 10], [10.4, 0, 10]], { unspawned: [1] });
// B's back to a wall 0.5 m behind it: B's sweep stops at the wall, A's half
// is A's alone (the engine's write is not undone for the other side).
out.wall = pass([[10, 0, 10], [10.4, 0, 10]], { collider: wallCollider(10.4 + 0.39 + 0.1) });
// Three in a row 0.5 m apart: each pair once, in order.
out.row = pass([[10, 0, 10], [10.5, 0, 10], [11, 0, 10]]);

// --- through the World: two bots spawned on the same spot ---------------------
{
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  const flag = world.flags.find(f => f.team === 2);
  for (const id of ['a', 'b']) {
    world.addBotPlayer(id, { team: 2, flag });
    world.setPlayerArmor(id, new M.Armor(100));
  }
  const a = world.soldierOf('a'), b = world.soldierOf('b');
  const ax = a.x, az = a.z;
  b.body.place(ax + 0.2, a.y, az);
  const gaps = [];
  for (let i = 0; i < 20; i++) {
    world.step(M.WORLD_TICK_DT);
    gaps.push(r4(Math.hypot(b.x - a.x, b.z - a.z)));
  }
  out.world = { gaps, moved: r4(Math.hypot(a.x - ax, a.z - az)) };
}

console.log(JSON.stringify(out));
