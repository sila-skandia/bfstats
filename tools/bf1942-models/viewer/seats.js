// Entering, switching and leaving any seat -- including manned guns.
//
// Round 1 (`features/bf1942-engine-reference/verify-r5.md`, `verify-r6.md`)
// re-derived how Refractor itself does this from the Linux dedicated server's
// intact symbol table. This module is the viewer half: it turns one vehicle's
// assembled node tree into a table of seats (root plus every nested
// `PlayerControlObject`), classifies each seat the way the engine's own data
// shape does (SEAT-*/GUN-10), and drives a manned gun's aim and fire state
// from that table. `map.html` owns the glue -- the keyboard, the camera, the
// HUD variables -- everything here is pure data/state and takes no DOM, no
// `THREE.Scene` and no renderer, so `tests/test_seats_harness.mjs` can drive
// it with a handful of plain objects standing in for glTF nodes.
//
// What is NOT reproduced, and why, is called out at each site below rather
// than asserted as engine behaviour -- see especially `TurretAxis.step`.

// The seat model lives in one module per subsystem; this file re-exports
// all of it, so every importer keeps importing from `./seats.js`:
//
//   seat-survey.js       the seat table, its classification, the aim axes
//   turret-rig.js        the manned gun's aim servo (GUN-2 / GUN-2b)
//   vehicle-occupancy.js one hull's seats, drivetrain and rigs
//   entry-points.js      vehicle roots, entry points, the nearest pick
//   spawned-craft.js     a ship's landing craft split off at load
//   fire-state.js        magazine, reload and heat (GUN-12)

export {
  DRIVE_KINDS, AIM_INPUTS, hasAimAxes, axisPeerNodes, turretPeerNodes,
  surveyVehicle, classifySeat, classifyRoot,
} from './seat-survey.js';
export { seatYawLimits, TURRET_ACCELERATION, TurretAxis, TurretRig } from './turret-rig.js';
export { VehicleOccupancy } from './vehicle-occupancy.js';
export { findAllVehicleRoots, listEntryPoints, TIE_EPSILON, pickNearest } from './entry-points.js';
export { detachSpawnedCraft } from './spawned-craft.js';
export { FireState, chainOnShot } from './fire-state.js';

// --- world-space camera read ---------------------------------------------

/** Copy `node`'s current world pose into pre-allocated outputs -- no per-frame
 *  allocation, matching every other per-frame path on this page. */
export function readWorldPose(node, outPosition, outQuaternion) {
  node.updateWorldMatrix(true, false);
  node.getWorldPosition(outPosition);
  node.getWorldQuaternion(outQuaternion);
}
