// The level load; the room server's mirror of `map.html`'s build sequence.
//
// One published maps tree entry (`viewer/maps/<level>/scene.json` + the level
// `scene.glb`) becomes a read-only LevelData (terrain lattice, materials,
// damage tables, collision sidecars, template trees, the vehicle table
// assembly), and each room calls `instantiate()` for its own mutable copy:
// a cloned scene tree, a freshly built collider, the World, the parked hulls
// and the per-instance vehicle table. The split is the resource law: the
// expensive half (decoding a ~40 MB BIN chunk's terrain tiles and collision
// meshes, inflating the material map) runs once per level, while a room only
// pays for clones and index rebuilds (~20 k triangles), and no two rooms
// share a mutable node.
//
// Where each piece lives (this module re-exports every one, so importers keep
// their `./level.mjs` path):
//   glb-scene.mjs        the BIN chunk's accessors, the material map, the
//                        level's node tree (decodeMaterialIds, buildSceneTree)
//   level-bodies.mjs     the body-world glue and the settle pass (SETTLE_TICKS)
//   level-data.mjs       the shared LevelData and its per-room instantiate()
//   level-instance.mjs   a room's LevelInstance and the mount glue
//   vehicle-table.mjs    the LevelInstance's seatable vehicle table
//   level-load.mjs       a maps tree entry, headless (loadRealLevel), and the
//                        heightfield decision
//   level-descriptor.mjs the descriptor levels (fakeLevelDescriptor,
//                        buildLevelFromDescriptor)
//
// What mirrors what (the page's function names in parentheses):
//   - `bodyPoseOf`/`writeBodyPose`/`settlePlacedVehicles`: placed hulls drop
//     onto their springs for SETTLE_TICKS before the index bakes them
//   - `buildCollider`: heightfield + statics index + WorldCollider + owners
//   - `registerDamageables`/`setupVehicleBodies`: armor owners, body world
//   - the mount glue mirrors `setPilot`/`switchSeat`/`leaveVehicle`/
//     `exitVehicle`/`exitPoseManned`
//
// P3 seams are flagged `// P3 seam:` through these files — projectile damage
// (`guns` is null for now, so `play.netcode.js`'s fire events cannot resolve
// into rounds), supply depots, kit hit points (loadouts.json), spawner
// respawn windows.

export { SETTLE_TICKS } from './level-bodies.mjs';
export { decodeMaterialIds, buildSceneTree } from './glb-scene.mjs';
export { LevelData } from './level-data.mjs';
export { LevelInstance } from './level-instance.mjs';
export { fakeLevelDescriptor, buildLevelFromDescriptor } from './level-descriptor.mjs';
export { loadRealLevel } from './level-load.mjs';
