// A placed hull and the static it stands on, at load: one rule for the page's
// settle (`hull-bodies.js` `settleSome`) and the room server's
// (`server/level-bodies.mjs` `settle`), which used to differ (the server had no
// static rule at all and dropped XPack2's Natter off its ramp, SWB-7).
//
// The settle drops each placed hull onto the terrain. A hull the level stood on
// a static the heightfield does not know (a ramp, a pier, a hangar floor) is
// not dropped (`vehicle-bodies.js` `standsOnAStatic`). If the level sank it
// into that static it is lifted out as the engine's first contact would push it
// (`sunkIntoAStatic`, COL-6), and one whose wheels were in a level floor is let
// down onto it (Operation Da's P-40 on its hangar floor). Whatever it stands on
// is then a ride surface from the height it stands at
// (`collision-meshes.js` `rideSurfaceTopOf`), so the wheels of the woken hull
// keep standing on it.
//
// Framework-free apart from the body modules, so node runs it.

import { BodyWorld, settleBodies } from './body-world.js';
import {
  buildParkedVehicle, restingPoints, staticFloorTerrain, standsOnAStatic, sunkIntoAStatic,
  STATIC_OVER_GROUND, SUNK_IN_A_STATIC,
} from './vehicle-bodies.js';

/**
 * The three questions the static rule asks of a level's statics, answered
 * from a collision index of every placed root that is not a hull, built on
 * first use. `buildIndex` is `static-index.js` `buildCollisionIndex`.
 *
 * - `staticTop(x, y, z)`: the highest static top at or under `y` (an 8 m ray
 *   down), or null.
 * - `staticUnder(x, y, z)`: the same as `{ y, node }`, `node` the placement
 *   root it belongs to.
 * - `staticCross(ox, oy, oz, x, y, z)`: the first static face the segment from
 *   a hull's origin to one of its vertices crosses, `{ x, y, z, nx, ny, nz }`
 *   with the normal facing the origin (COL-6's probe), or null.
 */
export function staticProbes(root, ownerRoots, buildIndex) {
  const hullRoots = ownerRoots.filter(node => node?.userData?.armor);
  let owners = null;
  let index;
  const probe = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: -1, dz: 0,
    material: 0, kind: '', owner: -1, triangle: -1 };
  const statics = () => {
    if (index === undefined) {
      owners = ownerRoots.filter(node => !node?.userData?.armor);
      index = buildIndex(root, { ownerRoots: owners, skipRoots: hullRoots }) ?? null;
    }
    return index;
  };
  const staticUnder = (x, y, z) => {
    const hit = statics()?.cast(x, y, z, 0, -1, 0, 8, -1, probe);
    return hit ? { y: hit.y, node: owners[hit.owner] ?? null } : null;
  };
  return {
    staticUnder,
    staticTop: (x, y, z) => staticUnder(x, y, z)?.y ?? null,
    staticCross: (ox, oy, oz, x, y, z) => {
      const dx = x - ox, dy = y - oy, dz = z - oz;
      const length = Math.hypot(dx, dy, dz);
      if (!(length > 1e-6)) return null;
      const hit = statics()?.cast(ox, oy, oz, dx / length, dy / length, dz / length, length, -1, probe);
      return hit ? { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz } : null;
    },
  };
}

/**
 * The static rule for one placed hull. Returns false when the hull does not
 * stand on a static, and the caller settles it on the terrain as before;
 * otherwise it has been placed (left, lifted, or let down on its floor) and
 * what it stands on marked, and the caller leaves it alone.
 *
 * `env`: `{ heightfield, probes (staticProbes), tables, waterLevel, write }`,
 * `write(node, { pos, axes })` the caller's own pose writer.
 */
export function holdOnAStatic(node, spec, pose, env) {
  const { heightfield, probes } = env;
  if (!probes) return false;
  const height = (x, z) => heightfield.height(x, z);
  if (!standsOnAStatic(spec, pose, height, probes.staticTop)) return false;
  const { depth, level } = sunkIntoAStatic(spec, pose, height, probes.staticCross);
  if (depth > SUNK_IN_A_STATIC) {
    const lifted = { pos: [pose.position[0], pose.position[1] + depth, pose.position[2]], axes: pose.axes };
    env.write(node, level ? letDown(spec, lifted, env) : lifted);
    node.updateWorldMatrix?.(true, false);
  }
  markRideSurface(spec, node, height, probes.staticUnder);
  return true;
}

/**
 * A hull lifted out of a level floor its wheels were in, let down onto it:
 * it settles alone, on a ground whose static tops are read from its own
 * lifted origin down (`staticFloorTerrain`). Operation Da's P-40, a
 * tail-dragger, comes to rest nose up on its tail wheel. One that never comes
 * to rest stays lifted, level as the level put it.
 *
 * Only wheels in a LEVEL floor: XPack2's Natter has its sled 0.11 to 0.17 m
 * into a launch ramp tilted 9 degrees, and let down it rolled 7.5 m down and
 * off the ramp (SWB-7). It is lifted out and left, as the level tilted it.
 */
function letDown(spec, lifted, { heightfield, probes, tables, waterLevel }) {
  const world = new BodyWorld({
    tables, terrain: staticFloorTerrain(heightfield, probes.staticTop, lifted.pos[1], waterLevel),
  });
  const parked = buildParkedVehicle(spec, { position: lifted.pos, axes: lifted.axes, asleep: false });
  world.addParked(0, parked, spec);
  return settleBodies(world, [{ body: parked.body }]).length ? parked.body : lifted;
}

/**
 * Mark the statics a hull stands on as ride surfaces at the height it stands
 * (`collision-meshes.js` `rideSurfaceTopOf`): the static under each of the
 * twelve lowest col0 vertices `standsOnAStatic` counts. Read when the
 * collision index and the drivable mask are built, which is after the settle.
 */
function markRideSurface(spec, node, height, staticUnder) {
  node.updateWorldMatrix?.(true, false);
  const e = node.matrixWorld.elements;
  const pose = {
    position: [e[12], e[13], e[14]],
    axes: [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]],
  };
  for (const { ground, top } of restingPoints(spec, pose, height, staticUnder)) {
    if (!top.node || top.y <= ground + STATIC_OVER_GROUND) continue;
    const was = top.node.userData.rideSurfaceTop;
    if (!(was >= top.y)) top.node.userData.rideSurfaceTop = top.y;
  }
}
