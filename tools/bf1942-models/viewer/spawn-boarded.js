// A carried spawn point shut by someone boarding its carrier (ledger
// SPAWN-39): `ObjectTemplate.disableSpawnPointsOnEnter 1`.
//
// The word is a byte on the PlayerControlObject's template (lnxded
// `PlayerControlObjectTemplate+0x240`, ConsoleClass510 0x082f4920, ctor 0).
// `PlayerControlObject::init` 0x08316790 collects every SpawnPoint under the
// object (`findSpawnPoints` 0x0831c0b0, the vector at `+0x160`).
// `PlayerControlObject::enter` 0x08316f00 reads the byte at 0x08317159 and,
// when it is set, clears `BFSpawnPoint+0x13c` on each of them; `exit(bool)`
// 0x08317d00 (0x08317edc) and `exitPlayer()` 0x083183d0 (0x08318482) set it
// again. `BFSpawnPoint::getActive` 0x08163dd0 opens on that byte
// (0x08163de2): clear, the point is not active, whoever asks. So the points
// are off for exactly as long as someone, human or bot, holds that object's
// own seat, and nobody deploys onto a submarine that is under way.
//
// Writers: vanilla's `Gato` and `Sub7C` (their `GatoDriverSoldierSpawn` /
// `Sub7CDriverSoldierSpawn`, groups 79 and 78); the mods' submarines after
// them (BF1918's `M1uboot`, FH's and EoD's boats).
//
// Where the word reaches the page: the carrier's own node
// (`extras.physics.disableSpawnPointsOnEnter`, `bf42/con.py`) in a tree
// baked since 2026-11-13, and the carried point's row in `scene.json`
// (`vehicleSoldierSpawns[].disableOnEnter`, the `spawns` layer), which a
// tree baked before gets from `patch_scene.py --layer spawns`.
//
// No imports: the page (`hull-bodies.js` `bindCarriers`), the room server
// (`server/level-instance.mjs`) and the headless runner all read it.

/** Whether `spawn`'s carrier shuts its points while it is boarded. */
export function shutsSpawnsOnEnter(spawn, carrierNode = null) {
  return spawn?.disableOnEnter === true
    || carrierNode?.userData?.physics?.disableSpawnPointsOnEnter === true;
}

/**
 * Whether a carried point is off because its carrier is boarded.
 * `holderOf(carrierNode)` answers who holds the carrier's own seat (the
 * root PlayerControlObject's, the one that carries the word): a player id,
 * or null when it is empty.
 */
export function spawnShutByBoarding(spawn, carrierNode, holderOf) {
  if (!carrierNode || !shutsSpawnsOnEnter(spawn, carrierNode)) return false;
  return holderOf?.(carrierNode) != null;
}
