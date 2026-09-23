// The collider's modules as one namespace, kept only for `sim/env.mjs`, which
// imports the collider through it; every other importer names the owning
// module. The collider's header (what a round runs into and how each kind is
// tested) and the module map are in `world-collider.js`. Delete this file once
// the runner imports the owners too.

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
