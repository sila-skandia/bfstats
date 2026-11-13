// A ship's baked landing craft and deck aircraft, and what a static's or a
// land or air hull's spawner holds, split off as vehicles of their own before
// the level's scene is indexed. Split out of `seats.js`,
// which re-exports it.

/** Detached deck aircraft -> the hold `ObjectSpawner` keeps on them. */
const spawnHolds = new WeakMap();
/** The craft a static's spawner holds (never a ship's). */
const staticHeld = new WeakSet();
/** The craft a land or air hull's spawner holds (`hullHeldCraftUnder`). */
const hullHeld = new WeakSet();
/** A static's held craft -> every craft its spawner can have alive at once,
 *  the baked one first (`heldSlotsOf`). A ship's craft too. */
const heldSlots = new WeakMap();
/** A ship's craft -> where its spawner stands on her (`craftSpawnerOf`). */
const craftSpawners = new WeakMap();

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
 * What a land or air hull's own spawner holds (`hullHeldCraftUnder`) is split
 * off the same way, its hull the hold's host (`onHull`), in the room's world
 * too (`shipCraft: false` still leaves a ship's alone).
 *
 * A static's spawner with `MaxNrOfObjectSpawned` above 1 has that many
 * objects alive at once (the `+0x110` slot vector `ObjectSpawner::
 * ObjectSpawner` 0x08312910 sizes from template +0x168, SPAWN-9), and the
 * bake holds one: the others are copies of it made here, before the scene is
 * indexed, so each is a vehicle of its own with its own owner. `clone` copies
 * a craft (the page passes a skeleton-aware one). Which of them stands in the
 * world, and when, is the spawner's law (`level-statics.js` `buildHeldPads`,
 * SPAWN-24).
 *
 * `shipCraft: false` leaves the ships' craft baked and splits off only what
 * a static's spawner holds. The room server passed it while it floated no
 * ship; it splits them off as the page does now (`server/room-ships.mjs`).
 * `extraSlots: false` makes no copies; `'ship'` copies a ship's craft only,
 * which is what the room server runs a spawner law for
 * (`server/room-pads.mjs`); a static's held craft has the baked one alone
 * there.
 */
export function detachSpawnedCraft(root, { clone = o => o.clone(true), shipCraft = true, extraSlots = true } = {}) {
  let spawners = null;
  root.traverse(o => {
    if (!spawners && (o.userData?.kind === 'spawners' || o.name === 'spawners')) spawners = o;
  });
  if (!spawners) return [];
  const craft = [];
  const hosts = new Map();
  for (const top of shipCraft ? spawners.children : []) {
    for (const o of spawnedCraftUnder(top)) {
      craft.push(o);
      hosts.set(o, top);
    }
  }
  // What a land or air hull's own spawner holds (`hullHeldCraftUnder`):
  // BF1918's Kolossal carries its MG platform and commander that way, the
  // Zeppelin its two extra gondola gunners, EoD's CH-47 a Land Rover. The
  // hull is the hold's host, as a ship is her deck aircraft's.
  for (const top of spawners.children) {
    for (const o of hullHeldCraftUnder(top)) {
      if (hosts.has(o)) continue;
      craft.push(o);
      hosts.set(o, top);
      hullHeld.add(o);
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
      const local = heldLocal(host, o);
      spawnHolds.set(o, { host, local, released: false });
      spawners.attach(o);
      const slots = [o];
      const max = o.userData.heldSpawner.maxNrOfObjectSpawned;
      for (let i = 1; extraSlots === true && i < (Number.isInteger(max) ? max : 1); i++) {
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
    if (hullHeld.has(o)) {
      // `onHull`: the hold lasts as long as the hull stands it, and a craft
      // still on the hold of a hull its pad has not stood is not in the
      // world either (`level-statics.js` `vehicleSpawnActive`). `stood`: a
      // spawner that does not hold (`hullHeldCraftUnder`), kept where it was
      // stood until the page can let it go.
      const stood = o.userData.heldSpawner.holdObject !== true;
      spawnHolds.set(o, { host, local: heldLocal(host, o), released: false, onHull: true, stood });
      spawners.attach(o);
      continue;
    }
    // `ObjectTemplate.holdObject 0` on the spawner (the exporter's
    // `heldSpawner.holdObject`): no hold at all. Desert Combat writes it on
    // the Nimitz's MH-53 and UH-60 pads and the Enterprise's F-14 and
    // Harrier pads, so those lift straight off the deck; a node without the
    // word (an older export) keeps the hold every vanilla ship spawner sets.
    const local = heldLocal(host, o);
    const air = o.userData.physics.vehicleCategory === 'VCAir' && o.userData.heldSpawner?.holdObject !== false;
    if (air) {
      // The spawner's pose on its ship, which is the pose the exporter baked,
      // plus its `spawnOffset` (`heldLocal`).
      spawnHolds.set(o, { host, local });
    }
    spawners.attach(o);
    // A ship's spawner is an ObjectSpawner like any pad's (SPAWN-9, SPAWN-24):
    // `maxNrOfObjectSpawned` objects alive at once (three Daihatsus from each
    // of a Hatsuzuki's davits), the next one stood on the spawner when the
    // last has left its `radius`, each a vehicle of its own. The bake holds
    // one; the others are copies, parked until the spawner's law stands them
    // (`level-statics.js` `buildHeldPads`, `server/room-pads.mjs`). Only a
    // craft the exporter stamped with its spawner has one to run.
    if (!o.userData.heldSpawner) continue;
    craftSpawners.set(o, { host, local });
    const slots = [o];
    const max = o.userData.heldSpawner.maxNrOfObjectSpawned;
    for (let i = 1; extraSlots && i < (Number.isInteger(max) ? max : 1); i++) {
      const twin = clone(o);
      twin.userData.padVariant = true;
      twin.userData.heldSlot = i;
      spawners.add(twin);
      twin.updateMatrixWorld(true);
      if (air) spawnHolds.set(twin, { host, local });
      craftSpawners.set(twin, { host, local });
      slots.push(twin);
      twins.push(twin);
    }
    for (const slot of slots) heldSlots.set(slot, slots);
  }
  return craft.concat(twins);
}

/**
 * `root.traverse(fn)`, but never into an object a spawner of `root` stood: a
 * nested PlayerControlObject the exporter baked under its spawner
 * (`extras.heldSpawner`). The engine makes each an object of its own
 * (`spawnObject` 0x083140a0), so nothing in it is the hull's: FH's towing
 * tractors carry their towed gun that way (`c7p-wz1917`'s
 * `towed_*_DummySpawner1/2` and `*_towed_dummySpawner`, each with its own
 * Engine and wheel Springs), and a drive that walked into it took the towed
 * gun's Engine, the last one found, for the tractor's (FHX-30).
 */
export function traverseOwn(root, fn) {
  const walk = o => {
    if (o !== root && o.userData?.templateKind === 'PlayerControlObject' && o.userData.heldSpawner) return;
    fn(o);
    for (const child of o.children) walk(child);
  };
  if (root) walk(root);
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
 * The objects a land or air hull's own spawners hold, baked under `top` (a
 * hull under the level's `spawners` group, or a `models/<Hull>.glb`'s root):
 * every nested PlayerControlObject the exporter stamped with its spawner
 * (`heldSpawner`), with a body of its own (`physics.mass`) and a door of its
 * own (an `EntryPoint` in its own tree). `top` itself and anything under a
 * craft already taken are excepted; a ship yields none.
 *
 * The engine makes each an object of its own, held at its spawner (AI-121,
 * SPAWN-30): `spawnObject` 0x083140a0 stands it parented to nothing and the
 * hold puts it back every frame while its engine's revs are under 0.1. A
 * seat PCO carries no mass and no stamp, so the hull's own seats are never
 * here. BF1918 leans on it to pass the six-PCO limit its Zeppelin's file
 * names: the Kolossal's MG platform (`KolossalMgGunnerExtra`, four MGs and
 * the commander) and the Zeppelin's two gondola gunners
 * (`ZeppelinL30GunnerZusatz`) each carry a dummy Engine nothing turns, so
 * they ride their hull for its life. Before this rule nothing took them: the
 * hull's seat row leaves a held object out (`seat-survey.js`) and the ship
 * and static rules above never look under a land or air hull, so five of the
 * Kolossal's twelve crew positions could not be manned.
 *
 * A spawner that does not hold (no `holdObject 1`, the engine's default 0)
 * stands its object once, free (SPAWN-30). BF1918's armoured train stands
 * its three cars so, each with four or five crew seats, and the engine's
 * couplers (`TrainPuller`, held by the locomotive and the front infantry car,
 * no door) push them along the rails by contact (COL-25). The page has no
 * parked body that meets the rails and their guide walls yet
 * (`body-world.js`, "Driven only, for now") and no puller body, so a car is
 * kept where it was stood on its hull (`stood` on its hold, never let go by
 * the throttle rule): the rigid ride the bake drew before, now with its own
 * seats, guns and armour (features/bf1918-armoured-train).
 *
 * Not taken: a held object with no door, which no soldier can enter and the
 * hold pins for ever (FHSW's bombers' attitude indicator, mass 1, drawn as a
 * map mark of its hull's, `map-friendlies.js`); and what a ship holds that is
 * not her deck craft (EoD's LCT's tanks and jeep), since a land drive has no
 * moving deck to stand on once the hold lets it go (`hull-bodies.js`
 * `shipDeckAt` serves aircraft and parked bodies only).
 */
export function hullHeldCraftUnder(top) {
  const craft = [];
  if (!top || top.userData?.physics?.vehicleCategory === 'VCSea') return craft;
  const walk = o => {
    if (o !== top && isHullHeld(o)) {
      craft.push(o);
      return;
    }
    for (const child of o.children) walk(child);
  };
  walk(top);
  return craft;
}

function isHullHeld(o) {
  const data = o.userData;
  if (data?.templateKind !== 'PlayerControlObject' || !data.heldSpawner) return false;
  if (!(data.physics?.mass > 0)) return false;
  let door = false;
  o.traverse(child => { if (!door && child.userData?.templateKind === 'EntryPoint') door = true; });
  return door;
}

/**
 * A template's model as a server draws it: every object its spawners field
 * taken out of it, in place. Returns how many went.
 *
 * The exporter bakes what a template's child ObjectSpawners hold under the
 * template's own node (`extras.heldSpawner`, `bf42/assemble.py`), but the
 * engine makes each of those an object of its own (`spawnObject`
 * 0x083140a0), and a server names it in its object table like any other
 * hull. A hull stood from the template (`server-entities.js`, a replay's
 * `buildHull`) drew the baked copy as well: the Shokaku's Zero, AichiVal and
 * two Daihatsus stood on her deck for ever, so a plane taken off the deck
 * seemed to respawn the moment it was entered, and there was nothing there to
 * enter (Wake, 2026-10-24). Its meshes also went into the carrier's collider
 * and its propellers onto her engine. What is fixed to the template (the
 * Shokaku's four AA batteries) is no spawner's and stays. A node without the
 * stamp (an older export) is taken by the rule the level splits craft off by
 * (`spawnedCraftUnder`).
 */
export function stripSpawnedCraft(top) {
  // Only an object nested in another: a glb's scene is a Group over the
  // template's own root, which is no one's craft.
  const nested = o => {
    for (let p = o.parent; p && p !== top?.parent; p = p.parent) {
      if (p.userData?.templateKind === 'PlayerControlObject') return true;
    }
    return false;
  };
  const gone = new Set(spawnedCraftUnder(top).filter(nested));
  top?.traverse(o => { if (o !== top && o.userData?.heldSpawner && nested(o)) gone.add(o); });
  for (const o of gone) o.parent?.remove(o);
  return gone.size;
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
 * Whether a craft a hull's own spawner holds (`hullHeldCraftUnder`) is in the
 * world, or null for any other node. On the hold it stands exactly while its
 * hull does (`active(host)`, the page's `vehicleSpawnActive`): a pad's
 * other-side Kolossal, not yet stood, has its platform on it, and the
 * platform goes when the hull's wreck clears and comes back with the next
 * one. Let go, it is an object of its own (true).
 */
export function hullHeldActive(node, active) {
  const hold = spawnHolds.get(node);
  if (!hold?.onHull) return null;
  return hold.released !== false || !!active(hold.host);
}

/**
 * Where the ship's spawner that launched `node` stands: `{ host, local }`,
 * her node and the spawner's pose on her (the baked pose plus its
 * `spawnOffset`), or null for a craft no ship's spawner launched. The
 * spawner's world pose now is `host.matrixWorld * local`.
 */
export function craftSpawnerOf(node) {
  return craftSpawners.get(node) ?? null;
}

/**
 * Every craft the static's spawner that holds `node` can have alive at once,
 * the baked one first, or null for any other node. One entry unless the
 * spawner writes `MaxNrOfObjectSpawned`.
 */
export function heldSlotsOf(node) {
  return heldSlots.get(node) ?? null;
}

/**
 * A held object's pose on its host: the spawner's absolute transformation,
 * which is the pose the exporter baked, plus the spawner's `spawnOffset`
 * (AI-121: `spawnObject` 0x083140a0 creates the object at the spawner's
 * position plus `+0x150..0x158`, and the hold puts it back there every tick).
 * Vanilla's ship spawners all say 0/0/0; FHSW's carriers say 1.94 to 1.98 m
 * up, and held at the spawner itself Midway's Wildcats, Devastators and
 * Dauntlesses sat in the flight deck to their wings. The offset is in
 * Refractor's axes, its z negated here as every `.con` vector's is.
 */
function heldLocal(host, o) {
  const offset = o.userData?.heldSpawner?.spawnOffset;
  const world = o.matrixWorld.clone();
  if (Array.isArray(offset) && offset.length === 3 && offset.every(Number.isFinite)) {
    world.elements[12] += offset[0];
    world.elements[13] += offset[1];
    world.elements[14] -= offset[2];
  }
  return host.matrixWorld.clone().invert().multiply(world);
}
