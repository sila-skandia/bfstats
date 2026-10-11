// A room's half of the spawners' hold: the craft a static's ObjectSpawner
// holds (`holdObject 1`: FH's flying spawn, a Hellcat 300 m up on a turning
// arm, ledger FHR-10), kept on its spawner in the room's own world until its
// pilot opens the throttle.
//
// The page's is `hull-bodies.js` `holdSpawnedCraft`, and this is the same law
// (`ObjectSpawner::handleFrameUpdate` 0x083138c0: the object put at the
// spawner's absolute transform every frame while its engine's revs are under
// 0.1, with the spawner's speed there) over the room's bodies: once a tick,
// at the end of the world's tick, the arm first (`held-arm.js`, turned by the
// world's own tick time, which is what puts the server's arm and every
// page's at one angle), then each held craft onto it. Not here: the craft
// coming back on its arm after it is lost, which the page does and a room's
// pads do not know (`room-pads.mjs` runs `objectSpawns` rows only).

import * as THREE from 'three';

import { spawnHoldOf } from '../viewer/spawned-craft.js';
import { poseHeldArms } from '../viewer/held-arm.js';
import { WORLD_TICK_RATE } from '../viewer/world.js';

/** `|revs|` at which the spawner lets its object go (`hull-bodies.js`). */
const HOLD_RELEASE_THROTTLE = 0.1;

const _hold = new THREE.Matrix4();
const _parentInv = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * @param {object} instance  the room's LevelInstance (`world`, `ownerRoots`,
 *                           `ownerToEntry`)
 * @param {object[]} craft   the nodes `detachSpawnedCraft` split off
 * @returns {{ records: object[], step: () => void }}  `records` are
 *   `{ node, host, local, owner, released }`
 */
export function createHeldCraft(instance, craft) {
  const world = instance.world;
  const records = [];
  for (const node of craft ?? []) {
    const hold = spawnHoldOf(node);
    if (!hold) continue;
    records.push({ node, host: hold.host, local: hold.local, owner: instance.ownerRoots.indexOf(node),
                   released: false, at: null, velocity: [0, 0, 0] });
  }

  function step() {
    poseHeldArms(records, world.tickTime);
    for (const rec of records) {
      if (rec.released) continue;
      if (world.vehicleDamage?.get(rec.owner)?.destroyed) { rec.released = true; continue; }
      rec.host.updateWorldMatrix(true, false);
      _hold.multiplyMatrices(rec.host.matrixWorld, rec.local);
      _hold.decompose(_pos, _quat, _scale);
      // The spawner's speed where the craft is held: the hold point's own
      // travel over the tick.
      const v = rec.velocity;
      if (rec.at) {
        v[0] = (_pos.x - rec.at[0]) * WORLD_TICK_RATE;
        v[1] = (_pos.y - rec.at[1]) * WORLD_TICK_RATE;
        v[2] = (_pos.z - rec.at[2]) * WORLD_TICK_RATE;
      }
      rec.at = [_pos.x, _pos.y, _pos.z];
      const driver = instance.ownerToEntry?.get(rec.owner)?.driver ?? null;
      const state = driver != null ? world.player(driver)?.vehicle?.state : null;
      if (state) {
        if (Math.abs(state.throttle ?? 0) >= HOLD_RELEASE_THROTTLE) {
          // Let go, with the speed it was carried at.
          rec.released = true;
          state.velocity.set(v[0], v[1], v[2]);
          continue;
        }
        state.position.copy(_pos);
        state.orientation.copy(_quat);
        state.velocity.set(v[0], v[1], v[2]);
        state.angularVelocity?.set(0, 0, 0);
        world.player(driver).vehicle.applyTransform?.();
        continue;
      }
      const body = world.bodyWorld?.get(rec.owner)?.parked?.body ?? null;
      if (body) {
        const e = _hold.elements;
        body.pos[0] = e[12]; body.pos[1] = e[13]; body.pos[2] = e[14];
        body.axes[0][0] = e[0]; body.axes[0][1] = e[1]; body.axes[0][2] = e[2];
        body.axes[1][0] = e[4]; body.axes[1][1] = e[5]; body.axes[1][2] = e[6];
        body.axes[2][0] = e[8]; body.axes[2][1] = e[9]; body.axes[2][2] = e[10];
        body.v[0] = v[0]; body.v[1] = v[1]; body.v[2] = v[2];
        body.w[0] = 0; body.w[1] = 0; body.w[2] = 0;
      }
      setNodeWorld(rec.node, _hold);
    }
  }

  if (records.length) {
    // Where the arm stands before the first tick, then at the end of every
    // tick, ahead of whatever else reads the tick's final state.
    step();
    const next = world.onTick;
    world.onTick = () => { step(); next?.(); };
  }
  return { records, step };
}

/** A world matrix onto a node. */
function setNodeWorld(node, m) {
  if (node.parent) {
    node.parent.updateWorldMatrix(true, false);
    _local.multiplyMatrices(_parentInv.copy(node.parent.matrixWorld).invert(), m);
  } else {
    _local.copy(m);
  }
  _local.decompose(node.position, node.quaternion, _scale);
  node.updateMatrix();
  node.updateMatrixWorld(true);
}
