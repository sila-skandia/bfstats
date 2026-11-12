// A level's `SupplyDepot` instances out of its scene graph: one walk for the
// page (`level-load.js`) and for the room server (`server/level-data.mjs`), so
// a room's depots heal, rearm and repair on the server's own world by the same
// law (`supply.js`, `world-fields.js` `supplyFieldTick`) and their hit points
// reach every client as the server's (`net-room.js`). Lifted out of
// `level-load.js`.

import * as THREE from 'three';
import { SupplyDepot, depotPhase, heldObjectLife } from './supply.js';

/** A depot's start phase (ledger SUP-4): the `SupplyDepot` ctor stamps its
 *  last cycle at `(rand() % 30) / 30.0` s of world time, so depots placed
 *  together do not fire on one frame (`supply.js` `depotPhase`). `random` is
 *  a [0, 1) source: the page's `random` when it has one, else `Math.random`,
 *  which the headless runner seeds (`sim/env.mjs` `seedMathRandom`), so a
 *  run with a seed is reproducible. Drawn once per depot per level load. */
export function depotStartPhase(random = Math.random) {
  return depotPhase(() => Math.floor(random() * 0x8000));
}

/**
 * Every `SupplyDepot` node under `root`, world position resolved through the
 * scene graph: a depot is usually parented under a `Bundle` (`extract_map.py`'s
 * own placement) and does not carry its own world translation, only the chain
 * above it does. Run once per level load, never per frame.
 *
 * `spawnersRoot`: the group the level's pad hulls hang under, whose children
 * are owners as the level's own children are. `random`: the start phase's
 * source (`depotStartPhase`).
 */
export function collectSupplyDepots(root, { spawnersRoot = null, random = Math.random } = {}) {
  const depots = [];
  if (!root) return depots;
  const pos = new THREE.Vector3();
  root.traverse(obj => {
    const data = obj.userData?.supply;
    if (!data || obj.userData.templateKind !== 'SupplyDepot') return;
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(pos);
    // The placed root the depot rides: the same owner the collider and
    // the world key a hull by (a child of the level, or of its spawners).
    // A depot inside an object a spawner on the root makes
    // (`heldSpawner`) waits that spawner's delay out when the spawner
    // says so (`SupplyField.update`).
    // A held object that burns itself down (`heldObjectLife`) is made
    // again after its spawner's delay, so its depot works in pulses:
    // FHSW's bombers carry a reloader that lives 2 s in every 47.
    let owner = obj, heldDelay = 0, heldLife = Infinity, heldGap = 0;
    while (owner.parent && owner.parent !== root && owner.parent !== spawnersRoot) {
      const held = owner.userData?.heldSpawner;
      if (held?.spawnDelayAtStart) heldDelay = Math.max(heldDelay, Number(held.minSpawnDelay) || 0);
      const life = held ? heldObjectLife(owner.userData.armor) : Infinity;
      if (Number.isFinite(life) && !Number.isFinite(heldLife)) {
        heldLife = life;
        const lo = Number(held.minSpawnDelay) || 0;
        const hi = Number(held.maxSpawnDelay) || lo;
        // `calcSpawnDelay` draws in [min, max]; the mean stands in for it.
        heldGap = (lo + Math.max(lo, hi)) / 2;
      }
      owner = owner.parent;
    }
    // A depot on a hull (a half-track's locker, a Humvee's, a carrier's
    // pads) goes where the hull goes: the engine measures from the depot's
    // own absolute position every cycle (`workOnSoldiers` 0x08323dc0,
    // `workOnVehicles` 0x08323f10), so its node is read again each cycle.
    const rides = owner !== obj && owner.userData?.templateKind === 'PlayerControlObject';
    const at = new THREE.Vector3();
    const locate = rides ? () => {
      obj.updateWorldMatrix(true, false);
      return obj.getWorldPosition(at);
    } : null;
    depots.push(new SupplyDepot({ x: pos.x, y: pos.y, z: pos.z }, data, obj.name,
      { root: owner, locate, heldDelay, heldLife, heldGap,
        phase: depotStartPhase(random) }));
  });
  return depots;
}
