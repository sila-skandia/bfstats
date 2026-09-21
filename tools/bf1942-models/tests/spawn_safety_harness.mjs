// Where a soldier is allowed to be put down, in the shapes that went wrong.
//
// The world here is not `collision.js` — it is the one method `spawn-safety.js`
// asks for, `sweepSphere`, over a handful of axis-aligned boxes. That keeps
// the fixtures readable (a room is four walls, a pillar is one box) and it is
// the whole contract: if the real collider ever answers differently this
// module cannot tell, and neither can the engine's own spawn code.
//
// The three shapes:
//
//   OPEN      flat ground, nothing near. Must pass.
//   INSIDE    the spawn point at the centre of a solid block, which is what
//             "you spawn inside the model" looks like to a sweep. Must fail
//             `embedded`.
//   POCKET    a 2 m cupboard. No direction gives a body room to turn round
//             in. Must fail `boxed`.
//   ROOM      a 9 x 9 m sealed box — Battle of Britain's radar bunker with
//             its doorway bricked up. This **passes**, and the test says so
//             on purpose: telling a sealed room from one with a door needs a
//             flood fill over the collision world, and every cheap
//             approximation of it throws away the legitimate indoor spawns
//             in Stalingrad, Berlin and Market Garden. The bunker point is
//             kept away from players by `OnlyForAI`, which is the engine's
//             own answer and does not need geometry at all.
//   DOORWAY   the same room with a gap in one wall. Passes.

import { spawnBlocked, resolveSpawn, REACH } from './spawn-safety.js';

/** An axis-aligned box, and a sphere sweep against a list of them. */
function boxWorld(boxes) {
  return {
    sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius) {
      let best = null;
      for (const b of boxes) {
        // Slab test against the box grown by the sphere radius.
        const lo = [b[0] - radius, b[1] - radius, b[2] - radius];
        const hi = [b[3] + radius, b[4] + radius, b[5] + radius];
        const o = [ox, oy, oz], d = [dx, dy, dz];
        let t0 = 0, t1 = maxDist;
        let hitAxis = -1, ok = true;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-9) {
            if (o[i] < lo[i] || o[i] > hi[i]) { ok = false; break; }
            continue;
          }
          let a = (lo[i] - o[i]) / d[i];
          let c = (hi[i] - o[i]) / d[i];
          if (a > c) { const s = a; a = c; c = s; }
          if (a > t0) { t0 = a; hitAxis = i; }
          if (c < t1) t1 = c;
          if (t0 > t1) { ok = false; break; }
        }
        if (!ok) continue;
        const t = Math.max(t0, 0);
        if (t > maxDist) continue;
        if (best === null || t < best.t) {
          const n = [0, 0, 0];
          if (hitAxis >= 0) n[hitAxis] = d[hitAxis] > 0 ? -1 : 1;
          else n[1] = 1;
          best = { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t,
                   nx: n[0], ny: n[1], nz: n[2], material: 0 };
        }
      }
      return best;
    },
  };
}

const WALL = 0.5;
/** Four walls around the origin, 9 x 9 m inside, 3 m tall. */
function room({ gap = 0, inner = 4.5 } = {}) {
  const h = inner;
  const walls = [
    [-h - WALL, 0, -h - WALL, h + WALL, 3, -h],            // north
    [-h - WALL, 0, h, h + WALL, 3, h + WALL],              // south
    [-h - WALL, 0, -h, -h, 3, h],                          // west
    [h, 0, -h, h + WALL, 3, h],                            // east
  ];
  if (gap > 0) {
    // Cut the east wall into two, leaving a doorway `gap` metres wide.
    walls.pop();
    walls.push([h, 0, -h, h + WALL, 3, -gap / 2]);
    walls.push([h, 0, gap / 2, h + WALL, 3, h]);
  }
  return walls;
}

const out = {};
out.reach = REACH;
out.open = spawnBlocked(boxWorld([]), 0, 0, 0);
out.pocket = spawnBlocked(boxWorld(room({ inner: 1.0 })), 0, 0, 0);
out.sealedRoom = spawnBlocked(boxWorld(room()), 0, 0, 0);
out.insideABlock = spawnBlocked(
  boxWorld([[-4, -1, -4, 4, 6, 4]]), 0, 0, 0);
out.roomWithADoor = spawnBlocked(boxWorld(room({ gap: 2 })), 0, 0, 0);
// Against a wall but out in the open: fine, and the common case for a spawn
// authored beside a building.
out.againstAWall = spawnBlocked(
  boxWorld([[-20, 0, 1, 20, 4, 2]]), 0, 0, 0);
// A low kerb the chest clears: not an obstacle at all.
out.lowKerb = spawnBlocked(
  boxWorld([[-20, 0, 0.6, 20, 0.35, 1.2]]), 0, 0, 0);

// resolveSpawn: the flag's first point is inside a block, the second is open.
const flagWorld = boxWorld([[-4, -1, -4, 4, 6, 4]]);
const pool = [
  { name: 'inside', position: [0, 0, 0] },
  { name: 'outside', position: [40, 0, 40] },
];
out.walkedPast = resolveSpawn(pool, 0, { world: flagWorld })?.name;
out.keepsTheAskedForOneWhenItIsFine =
  resolveSpawn(pool, 1, { world: flagWorld })?.name;
// Everything bad: hand back the asked-for point, flagged rather than null.
const allBad = [{ name: 'a', position: [0, 0, 0] }, { name: 'b', position: [1, 0, 1] }];
const fallback = resolveSpawn(allBad, 0, { world: flagWorld });
out.fallbackName = fallback?.name ?? null;
out.fallbackReason = fallback?.blockedReason ?? null;
// No collider at all (a page with no world geometry): the authored point,
// untouched and unflagged.
const bare = resolveSpawn(pool, 0, {});
out.noWorldName = bare?.name ?? null;
out.noWorldReason = bare?.blockedReason ?? null;
out.emptyPool = resolveSpawn([], 0, { world: flagWorld });

console.log(JSON.stringify(out));
