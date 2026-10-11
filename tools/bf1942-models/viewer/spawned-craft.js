// A ship's baked landing craft and deck aircraft, split off as vehicles of
// their own before the level's scene is indexed. Split out of `seats.js`,
// which re-exports it.

/** Detached deck aircraft -> the hold `ObjectSpawner` keeps on them. */
const spawnHolds = new WeakMap();
/** The craft a static's spawner holds (never a ship's). */
const staticHeld = new WeakSet();
/** A static's held craft -> every craft its spawner can have alive at once,
 *  the baked one first (`heldSlotsOf`). */
const heldSlots = new WeakMap();

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
 *
 * A static's spawner with `MaxNrOfObjectSpawned` above 1 has that many
 * objects alive at once (the `+0x110` slot vector `ObjectSpawner::
 * ObjectSpawner` 0x08312910 sizes from template +0x168, SPAWN-9), and the
 * bake holds one: the others are copies of it made here, before the scene is
 * indexed, so each is a vehicle of its own with its own owner. `clone` copies
 * a craft (the page passes a skeleton-aware one). Which of them stands in the
 * world, and when, is the spawner's law (`level-statics.js` `buildHeldPads`,
 * SPAWN-24).
 */
export function detachSpawnedCraft(root, { clone = o => o.clone(true) } = {}) {
  let spawners = null;
  root.traverse(o => {
    if (!spawners && (o.userData?.kind === 'spawners' || o.name === 'spawners')) spawners = o;
  });
  if (!spawners) return [];
  const craft = [];
  const hosts = new Map();
  for (const top of spawners.children) {
    for (const o of spawnedCraftUnder(top)) {
      craft.push(o);
      hosts.set(o, top);
    }
  }
  // A static's spawner holds a craft too: FH's "flying spawn" is a static
  // whose turning part (`setContinousRotationSpeed`, the level's `ambient`
  // clip) carries an ObjectSpawner 300 m up on a 140 m arm, `holdObject 1`
  // (ledger FHR-10). The craft is baked under the arm, so the arm is the
  // hold's host: the craft rides it round until its engine is opened.
  const under = o => {
    for (let p = o.parent; p; p = p.parent) if (p === spawners) return true;
    return false;
  };
  root.traverse(o => {
    if (o.userData?.templateKind !== 'PlayerControlObject' || !o.userData.heldSpawner) return;
    if (!(o.userData.physics?.mass > 0) || !o.parent || hosts.has(o) || under(o)) return;
    // Only a craft the spawner holds: it is pinned to its host until flown.
    // One a static's spawner lets stand free (`holdObject 0`, DC's static
    // carriers) stays baked scenery, as it was before this.
    if (o.userData.heldSpawner.holdObject !== true) return;
    craft.push(o);
    hosts.set(o, o.parent);
    staticHeld.add(o);
  });
  if (!craft.length) return craft;
  const twins = [];
  root.updateMatrixWorld(true);
  for (const o of craft) {
    const host = hosts.get(o);
    if (staticHeld.has(o)) {
      const local = host.matrixWorld.clone().invert().multiply(o.matrixWorld);
      spawnHolds.set(o, { host, local, released: false });
      spawners.attach(o);
      const slots = [o];
      const max = o.userData.heldSpawner.maxNrOfObjectSpawned;
      for (let i = 1; i < (Number.isInteger(max) ? max : 1); i++) {
        const twin = clone(o);
        // It shares the baked craft's place, as a pad's other-side vehicle
        // does (`level-statics.js` `loadPadVariants`).
        twin.userData.padVariant = true;
        twin.userData.heldSlot = i;
        spawners.add(twin);
        twin.updateMatrixWorld(true);
        spawnHolds.set(twin, { host, local, released: false });
        staticHeld.add(twin);
        slots.push(twin);
        twins.push(twin);
      }
      for (const slot of slots) heldSlots.set(slot, slots);
      continue;
    }
    // `ObjectTemplate.holdObject 0` on the spawner (the exporter's
    // `heldSpawner.holdObject`): no hold at all. Desert Combat writes it on
    // the Nimitz's MH-53 and UH-60 pads and the Enterprise's F-14 and
    // Harrier pads, so those lift straight off the deck; a node without the
    // word (an older export) keeps the hold every vanilla ship spawner sets.
    if (o.userData.physics.vehicleCategory === 'VCAir' && o.userData.heldSpawner?.holdObject !== false) {
      // The spawner's pose on its ship, which is the pose the exporter baked:
      // `spawnOffset` is 0/0/0 on every vanilla ship spawner.
      spawnHolds.set(o, { host, local: host.matrixWorld.clone().invert().multiply(o.matrixWorld) });
    }
    spawners.attach(o);
  }
  return craft.concat(twins);
}

/**
 * The craft a ship's spawners launch, baked under `top` (a ship's node in a
 * level, or a `models/<Ship>.glb`'s root): every nested PlayerControlObject
 * with a body of its own (`physics.mass`) in the sea or the air category,
 * `top` itself excepted. A seat PCO carries no mass.
 */
export function spawnedCraftUnder(top) {
  const craft = [];
  top?.traverse(o => {
    if (o === top || o.userData?.templateKind !== 'PlayerControlObject') return;
    const physics = o.userData.physics;
    if (!(physics?.mass > 0)) return;
    if (physics.vehicleCategory !== 'VCSea' && physics.vehicleCategory !== 'VCAir') return;
    craft.push(o);
  });
  return craft;
}

/**
 * The hold a ship's spawner keeps on a detached deck aircraft, or null:
 * `{ host, local }`, the ship's node and the aircraft's matrix in the ship's
 * frame. Every ship spawner in vanilla sets `ObjectTemplate.holdObject 1`
 * (`Enterprise_corsairSpawner`, `ShokakuZeroSpawner`, the landing craft's
 * too); `ObjectSpawnerTemplate::makeScript` 0x08314f70 writes that line from
 * template +0x184, and `spawnObject` copies it into the spawner's +0x164.
 * What the hold does each frame is `hull-bodies.js holdSpawnedCraft`, which
 * also keeps `released` on a static's hold: whether the spawner has let the
 * craft go.
 */
export function spawnHoldOf(node) {
  return spawnHolds.get(node) ?? null;
}

/**
 * Every craft the static's spawner that holds `node` can have alive at once,
 * the baked one first, or null for any other node. One entry unless the
 * spawner writes `MaxNrOfObjectSpawned`.
 */
export function heldSlotsOf(node) {
  return heldSlots.get(node) ?? null;
}
