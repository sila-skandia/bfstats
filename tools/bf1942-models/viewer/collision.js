// What a round runs into: the heightfield, the sea, and the collision hulls.
//
// Refractor gives a projectile three kinds of thing to hit and collides against
// each differently. The shapes of the shipped data are what decide the three
// tests below, and each one is measured rather than guessed:
//
//   - **Terrain.** `Heightmap.raw` is a `dim x dim` grid of 16-bit samples at
//     `worldSize / dim` metres — 513 x 513 vertices on a 4 m lattice for every
//     vanilla 2048 m level. There is no terrain collision mesh anywhere in the
//     archives: the heightmap *is* the collider. So the honest test is an
//     analytic march over the lattice, not a raycast against the 524,288 drawn
//     triangles. `map.html` already had the raycast version, wired only to the
//     aircraft; this replaces it for everyone (gap C-5).
//   - **Water.** One horizontal plane at `waterLevel` over the whole world
//     (`extract_map.py` builds the quad world-wide, not just under the textured
//     patches). A plane test is exact and costs a divide (gap C-6).
//   - **Statics.** Real collision hulls, carried inside each `.sm` ahead of the
//     LOD chain and split into one glTF primitive per `defenseMaterial`. Bocage
//     exports 21,661 such triangles across 427 placements, 51 distinct
//     materials. That is small enough that a uniform XZ grid beats a BVH: the
//     build is a counting sort and the query is a DDA walk (gap C-1).
//
// Two query shapes come out of it. `cast` is the ray a round flies along.
// `sweepSphere` is the fat version a *body* needs — a soldier, and later a
// vehicle — and it shares the same grid rather than building a second one; see
// the method for why it queries that grid as a rectangle instead of walking it.
//
// The module is deliberately free of any `three` import. It reads three.js
// objects through the three fields it needs (`geometry.attributes.position`,
// `geometry.index`, `matrixWorld.elements`) and hands back plain numbers, which
// is what lets `tests/test_collision.py` run the whole thing under node with no
// renderer and no GL.
//
// Coordinate note, because it bites every reader once: the exporter negates Z
// (`bf42/gltf.py`), so a level occupies x in [0, worldSize] and z in
// [-worldSize, 0], and a heightmap sample index is `(x / spacing, -z / spacing)`.
//
// The pieces live in their own modules and this one re-exports them, so every
// importer keeps reading `./collision.js`:
//
//   `collision-materials.js`  material ids, impact effect / family / footstep
//   `heightfield.js`          the terrain lattice
//   `static-index.js`         the collision hulls' grid and its queries
//   `drivable-mask.js`        the drivable-deck broadphase
//   `world-collider.js`       terrain + sea + hulls behind one `cast`

export {
  DEFAULT_TERRAIN_MATERIAL, WATER_MATERIAL,
  impactEffect, materialFamily, footstepMaterial,
} from './collision-materials.js';
export { Heightfield, buildHeightfield } from './heightfield.js';
export {
  CollisionIndex, buildCollisionIndex, isCollisionMesh, isDrivableCollisionMesh,
} from './static-index.js';
export { buildDrivableMask } from './drivable-mask.js';
export { WorldCollider } from './world-collider.js';
