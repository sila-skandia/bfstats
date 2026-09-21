// Is this a place a soldier can actually stand up in and walk away from?
//
// WHY THIS EXISTS. A level's spawn points are authored coordinates and the
// engine uses them as they are — it does no validation, and it does not have
// to, because the level shipped with a game that was played. A viewer that
// rebuilds the level from its archives is in a different position: it
// reconstructs some of those points rather than reading them (a vehicle's own
// deck spawns are rebuilt from the hull template's `addTemplate` offsets), it
// resolves LOD alternatives and collision hulls by rules of its own, and any
// of that can put a player inside a model. The report that started this was
// Battle of Britain: spawn inside the factory, and no way out.
//
// Two separate things fix that, and this module is only the second:
//
//   1. Do not hand a player a spawn the engine would never have given him.
//      `spawnPointManager.OnlyForAI` is the engine's own audience filter, and
//      Battle of Britain's four radar towers each declare a human group of
//      five points spread around the building and an AI group of ONE at the
//      building's own origin — inside it, under a 2.25 m ceiling.
//      `soldier.js`'s `pickSpawn` reads that now.
//
//   2. Check the point before standing on it, for everything rule 1 cannot
//      know about. That is here.
//
// WHAT IS AND IS NOT TESTED. This deliberately does not try to answer "is
// this room sealed" — that is a flood fill over the collision world, it costs
// far more than a spawn is worth, and it would reject legitimate indoor
// spawns (Stalingrad, Berlin and Market Garden all put people inside
// buildings on purpose). What it answers is the question a bad spawn actually
// fails: **is the body jammed inside solid geometry, or in a pocket too
// small to walk out of**. A soldier who can reach open ground in any one of
// eight directions is fine, whatever is over his head.
//
// Free of `three` and of the DOM like `collision.js` and `physics.js`, so
// `tests/spawn_safety_harness.mjs` runs the real thing under node.

/** The eight compass directions, unit length. Diagonals included because a
 *  body wedged in a corner clears on one and nothing else. */
const DIRECTIONS = (() => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    out.push([Math.sin(a), 0, Math.cos(a)]);
  }
  return out;
})();

/** How far out a walk-out probe looks. Far enough that a doorway at the far
 *  side of an ordinary room counts as a way out, short enough that eight
 *  capsule sweeps stay cheap — this runs once per spawn, not per frame. */
export const REACH = 8;

/** The clearance one direction has to give for the point to count as open.
 *  Two body widths: enough to turn round in and start walking. */
export const MIN_CLEARANCE = 1.5;

/** Inside this, the body is not merely against a wall but in it. */
export const EMBEDDED = 0.05;

/**
 * Why `(x, y, z)` is a bad place to put a soldier, or null if it is a good one.
 *
 * `world` is anything with `collision.js`'s `sweepSphere(ox, oy, oz, dx, dy,
 * dz, maxDist, radius, skipOwner)`. `y` is the FEET; the probes are taken at
 * the capsule's own sphere heights so a spawn standing in a doorway is not
 * failed by the lintel or by the step under it.
 *
 * Returns `'embedded'` when the body is inside something on every side, and
 * `'boxed'` when it is in a pocket with no way out. Both are reported rather
 * than collapsed into a boolean so a sweep over the published levels can say
 * which kind of bad a point is.
 */
export function spawnBlocked(world, x, y, z, {
  radius = 0.3, heights = [0.5, 1.2], reach = REACH,
  clearance = MIN_CLEARANCE, embedded = EMBEDDED,
} = {}) {
  if (!world?.sweepSphere) return null;
  let best = 0;
  let touching = 0;
  for (const [dx, dy, dz] of DIRECTIONS) {
    // The worst of the capsule's own heights: a leg that clears under a
    // parked lorry is not a way out for the chest above it.
    let open = reach;
    for (const height of heights) {
      const hit = world.sweepSphere(x, y + height, z, dx, dy, dz,
                                    reach, radius, -1);
      if (hit) open = Math.min(open, hit.t);
      if (open <= embedded) break;
    }
    if (open <= embedded) touching++;
    if (open > best) best = open;
  }
  if (touching === DIRECTIONS.length) return 'embedded';
  if (best < clearance) return 'boxed';
  return null;
}

/**
 * The first spawn in `pool` a soldier can be put on, starting at `index` and
 * wrapping — or `pool[index]` when every one of them is bad.
 *
 * Never returns null for a non-empty pool, and that is deliberate: a player
 * who asked to deploy has to end up somewhere, and a bad spawn he can shoot
 * his way out of beats a deploy button that does nothing. The caller gets
 * `blockedReason` on the result so the page can say which it gave him.
 *
 * `groundAt(x, z)` lifts an authored point onto the terrain under it before
 * the probe, the same lift the spawn itself gets — a point authored a few
 * centimetres under the heightfield would otherwise probe from inside it.
 */
export function resolveSpawn(pool, index, {
  world = null, groundAt = null, options = undefined,
} = {}) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const start = ((index % pool.length) + pool.length) % pool.length;
  let first = null;
  for (let i = 0; i < pool.length; i++) {
    const spawn = pool[(start + i) % pool.length];
    const at = spawn?.position;
    if (!at) return spawn;
    let y = at[1];
    if (groundAt) {
      const ground = groundAt(at[0], at[2]);
      if (Number.isFinite(ground) && ground > y) y = ground;
    }
    const reason = world ? spawnBlocked(world, at[0], y, at[2], options) : null;
    if (!reason) return spawn;
    if (!first) first = { spawn, reason };
  }
  // Everything is bad. Hand back the one that was asked for, saying so.
  first.spawn.blockedReason = first.reason;
  return first.spawn;
}
