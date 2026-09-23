// A ship's baked landing craft and deck aircraft, split off as vehicles of
// their own before the level's scene is indexed. Split out of `seats.js`,
// which re-exports it.

/** Detached deck aircraft -> the hold `ObjectSpawner` keeps on them. */
const spawnHolds = new WeakMap();

/**
 * The objects an ObjectSpawner launches from a ship, split off as vehicles
 * of their own. A ship template carries its landing craft and its deck
 * aircraft as child `ObjectSpawner`s (`HatsuzukiDaihatsuSpawner`,
 * `Enterprise_corsairSpawner`, `ShokakuZeroSpawner`, ... in `Objects.rfa`),
 * and the engine spawns each as an object of its own:
 * `ObjectSpawner::spawnObject` 0x083140a0 calls `Game::spawnObject`
 * 0x0805e000 (Game vt+0x50) with the spawner's `getAbsolutePosition`
 * (vt+0x38) plus its `spawnOffset` and the rotation of its
 * `getAbsoluteTransformation` (vt+0x40), and that creates the object from
 * its template at that world pose, parented to nothing. The exporter bakes
 * the spawned `Lcvp` / `Daihatsu` / `Corsair` / `Zero` under its carrier's
 * node instead, where every walk of the carrier (its seats, its `shipSpec`
 * engines and rudders, its collision owner) took the object for part of the
 * ship: taking the Corsair entered the Enterprise, and the drive built for
 * it moved the whole carrier (Brief Q).
 *
 * A nested PlayerControlObject with a body of its own (`physics.mass`) in
 * the sea or the air category is such an object; a seat PCO carries no
 * mass. Each is moved under the level's `spawners` group, world pose kept,
 * before the scene is indexed. A deck aircraft also keeps the spawner's
 * hold (`spawnHoldOf`): its ship and its pose on her. Returns the objects
 * moved.
 */
export function detachSpawnedCraft(root) {
  let spawners = null;
  root.traverse(o => {
    if (!spawners && (o.userData?.kind === 'spawners' || o.name === 'spawners')) spawners = o;
  });
  if (!spawners) return [];
  const craft = [];
  const hosts = new Map();
  for (const top of spawners.children) {
    top.traverse(o => {
      if (o === top || o.userData?.templateKind !== 'PlayerControlObject') return;
      const physics = o.userData.physics;
      if (!(physics?.mass > 0)) return;
      if (physics.vehicleCategory !== 'VCSea' && physics.vehicleCategory !== 'VCAir') return;
      craft.push(o);
      hosts.set(o, top);
    });
  }
  if (!craft.length) return craft;
  root.updateMatrixWorld(true);
  for (const o of craft) {
    const host = hosts.get(o);
    if (o.userData.physics.vehicleCategory === 'VCAir') {
      // The spawner's pose on its ship, which is the pose the exporter baked:
      // `spawnOffset` is 0/0/0 on every vanilla ship spawner.
      spawnHolds.set(o, { host, local: host.matrixWorld.clone().invert().multiply(o.matrixWorld) });
    }
    spawners.attach(o);
  }
  return craft;
}

/**
 * The hold a ship's spawner keeps on a detached deck aircraft, or null:
 * `{ host, local }`, the ship's node and the aircraft's matrix in the ship's
 * frame. Every ship spawner in vanilla sets `ObjectTemplate.holdObject 1`
 * (`Enterprise_corsairSpawner`, `ShokakuZeroSpawner`, the landing craft's
 * too); `ObjectSpawnerTemplate::makeScript` 0x08314f70 writes that line from
 * template +0x184, and `spawnObject` copies it into the spawner's +0x164.
 * What the hold does each frame is `hull-bodies.js holdSpawnedCraft`.
 */
export function spawnHoldOf(node) {
  return spawnHolds.get(node) ?? null;
}
