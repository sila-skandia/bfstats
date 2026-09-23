// The two pieces of scene glue the body modules (`body-world.js`,
// `vehicle-bodies.js`) are handed by whoever owns a scene: a node's world
// pose in their `position` + row `axes` shape, and the heightfield as the
// three functions they ask of the ground. The page's hull bodies
// (`hull-bodies.js`) and the room server's level (`server/level-bodies.mjs`)
// both build bodies over a scene, and both used these same two functions.

/** A node's world pose as the body modules' `position` + row `axes`. */
export function bodyPoseOf(node) {
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  return {
    position: [e[12], e[13], e[14]],
    axes: [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]],
  };
}

/**
 * The heightfield as the three functions the body modules ask of the ground.
 *
 * With a `collider` (a `WorldCollider`) the ground also includes a drivable
 * deck -- a bridge span, a repair bay's apron, a tank pad -- whenever the
 * caller passes the height it is asking from (`y`, a vertex's own height) and
 * the deck lies at most `deckStep` above it: the same gate a driven wheel's
 * probe passes (`surfaceHeight(x, z, axle + DECK_STEP_UP)`). A parked hull
 * then stands where a driven one would, and boarding does not lift it onto
 * the deck it was sunk in (El Alamein's Sherman_1: 0.64 m). Called without
 * `y` (the driven hull's terrain damage) it is the heightfield alone, as
 * before.
 */
export function bodyTerrain(heightfield, waterLevel, collider = null, deckStep = 0.5) {
  const normal = [0, 1, 0];
  // The last deck lookup, so the height, normal and material of one vertex
  // agree and cost one ray between them.
  const last = { x: NaN, z: NaN, y: NaN, found: false, h: 0, nx: 0, ny: 1, nz: 0, material: 0 };
  const deckAt = (x, z, y) => {
    if (!collider?.deckSurface || !Number.isFinite(y)) return null;
    if (x !== last.x || z !== last.z || y !== last.y) {
      last.x = x; last.z = z; last.y = y;
      const d = collider.deckSurface(x, z, y + deckStep);
      last.found = !!d;
      if (d) { last.h = d.y; last.nx = d.nx; last.ny = d.ny; last.nz = d.nz; last.material = d.material; }
    }
    return last.found ? last : null;
  };
  return {
    height: (x, z, y) => {
      const d = deckAt(x, z, y);
      if (d) return d.h;
      const h = heightfield.height(x, z);
      return Number.isFinite(h) ? h : -Infinity;
    },
    normal: (x, z, out, y) => {
      const d = deckAt(x, z, y);
      if (d) { out[0] = d.nx; out[1] = d.ny; out[2] = d.nz; return out; }
      heightfield.normal(x, z, normal);
      out[0] = normal[0]; out[1] = normal[1]; out[2] = normal[2];
      return out;
    },
    material: (x, z, y) => {
      const d = deckAt(x, z, y);
      return d ? d.material : heightfield.material(x, z);
    },
    waterLevel: Number.isFinite(waterLevel) ? waterLevel : null,
  };
}
