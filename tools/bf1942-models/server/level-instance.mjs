// One room's mutable half of a level: its World, its vehicle table and the
// mount glue that mirrors `map.html`'s `setPilot`/`switchSeat`/`leaveVehicle`/
// `exitVehicle`/`exitPoseManned`. Split out of `level.mjs`, which re-exports
// `LevelInstance`.
//
// The one deliberate divergence is single-drive-per-hull: a vehicle
// simulates through at most one drive model at a time (the current root-
// seat occupant's), because the World's `#vehicleTick` integrates
// `player.vehicle` for every seated player, and two drivers of one hull
// would advance it twice a tick. Passengers ride in the same cloned node
// tree without a drive; the room poses them each tick from the root's live
// world matrix (`player.position` feed), which the driver's `applyTransform`
// keeps fresh even while the hull coasts. When the driver leaves, the hull
// parks where it stood (`releaseDriven`, the render's E-key law), and no
// client ever sees the vehicle die on the spot.

import * as THREE from 'three';

import { VehicleOccupancy, readWorldPose } from '../viewer/seats.js';
import { Aircraft } from '../viewer/aircraft.js';
import { GroundVehicle } from '../viewer/wheeled-vehicle.js';
import { TrackedVehicle } from '../viewer/tracked-vehicle.js';
import { bodySpecFor, quaternionToAxes } from './level-bodies.mjs';
import { buildVehicleTable } from './vehicle-table.mjs';

/** The occupancy classes the page hands `VehicleOccupancy` (map.html's own
 *  pick: `TrackedVehicle` straight out of tracked-vehicle.js). */
const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle };

// --- one room's mutable half -------------------------------------------------

/**
 * A room's own World and its mounted vehicle table.
 *
 * `table` is one entry per seatable spawn (objectSpawns ∪
 * vehicleSoldierSpawns, or a fake descriptor's rows), `id` = 1-based index:
 * `{id, template, owner, root, kind, window, team, seated, driver}`. `root`
 * is the mount node: the cloned scene instance when the level has one, else
 * a clone of the template tree at the authored pose (an extract that
 * predates the pad).
 */
export class LevelInstance {
  constructor(data, { root, spawnersRoot, ownerRoots, collider, world, statics, groundHeightAt }) {
    this.data = data;
    this.root = root;
    this.spawnersRoot = spawnersRoot;
    this.ownerRoots = ownerRoots;
    this.collider = collider;
    this.world = world;
    this.statics = statics;
    this.groundHeightAt = groundHeightAt;
    this.surfaceFrictionAt = surfaceFrictionAt(data, collider, groundHeightAt);
    this.table = buildVehicleTable(this, data);
    this.ownerToEntry = new Map();
    for (const entry of this.table) this.ownerToEntry.set(entry.owner, entry);
  }

  /** The flags the room's HELLO carries (the world owns a copy as well). */
  get flags() { return this.world.flags; }

  /** The world owner id of the room vehicle whose seat-root is `root` — the
   *  authority's crash/water attribution lookup (one map hop over the
   *  table). */
  ownerOf(root) {
    for (const [owner, entry] of this.ownerToEntry) {
      if (entry.root === root) return owner;
    }
    return null;
  }

  /**
   * Mount `playerId` into `entry`'s seat at `seatIndex` (0 = root, then the
   * occupancy survey's declaration order — the same index the snapshot's
   * seatIndex carries).
   *
   * Mirrors map.html's `setPilot` enter flow: one VehicleOccupancy per
   * mounted player (its own active seat and aim rig), a single drive model
   * per hull (the root seat's occupant — `#vehicleTick` integrates
   * `player.vehicle` once per seated player, so a second driver would
   * advance one hull twice a tick), the drivetrain's own FireArms as
   * `groups` and the active seat's as `manned`, then `world.setPlayerVehicle`
   * with exactly the shape `#vehicleTick` consumes.
   *
   * Returns `{occupancy, vehicle, kind, seatId, entry}`, or null for a bad
   * id/seat. `world.setPlayerVehicle` has already been called on success.
   */
  mountIntoSeat(world, playerId, entry, seatIndex) {
    if (!entry) return null;
    if (!world.player(playerId)) return null;   // joined players only
    const occ = new VehicleOccupancy(entry.root, DRIVE_CLASSES);
    const order = occ.order;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= order.length) {
      seatIndex = 0;
    }
    const seatId = order[seatIndex];
    occ.setActiveSeat(seatId);
    const kind = occ.rootKind;
    let vehicle = null;
    const driveGranted = seatId === occ.rootId
      && ['air', 'ground', 'tank'].includes(kind)
      && !this.#driveHeldByOther(playerId, entry);
    if (driveGranted) {
      vehicle = occ.ensureDrive(this.root, {
        cockpit: false,                        // no fetch of a cockpit glb
        groundHeight: (x, z) => this.groundHeightAt(x, z),
        surfaceFriction: this.surfaceFrictionAt,
      });
      if (vehicle) {
        if (kind === 'air') vehicle.state.position.y += 0.2;  // map.html's lift
        vehicle.autoFirstPerson = false;
        const spec = entry.owner >= 0 ? bodySpecFor(entry.root, this.data) : null;
        if (spec) world.adoptDriven(entry.owner, vehicle, spec);
        entry.driver = playerId;
      }
    }
    const gunGroup = node => ({ node, stats: node.userData?.fireArms || {} });
    const groups = (occ.seatInfo(occ.rootId)?.fireArms ?? []).map(gunGroup);
    const manned = occ.activeFireArmsNodes().map(gunGroup);
    world.setPlayerVehicle(playerId, { occupancy: occ, vehicle, kind, groups, manned });
    world.setPlayerPosition(playerId, this.positionOf(occ));
    entry.seated++;
    return { occupancy: occ, vehicle, kind, seatId, entry };
  }

  /** Not another mounted player holding this hull's drive. */
  #driveHeldByOther(playerId, entry) {
    return entry.driver !== null && entry.driver !== playerId;
  }

  /** The seat survey a mount would get: for the failure log — the order's
   *  size and the root kind decide why `mountIntoSeat` refused. */
  seatSurveyOf(entry) {
    if (!entry?.root) return null;
    const occ = new VehicleOccupancy(entry.root, DRIVE_CLASSES);
    return { order: occ.order.length, kind: occ.rootKind,
             rootId: occ.rootId, extras: !!(entry.root.userData?.vehicleSoldierSpawns) };
  }

  /** A seated player's current world position: the root's live world matrix,
   *  kept fresh by the driver's `applyTransform` (the page's per-frame
   *  `setPlayerPosition` feed, for the bare-seat combat-area and snapshot). */
  positionOf(occ) {
    occ.root.updateMatrixWorld(true);
    const e = occ.root.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }

  /**
   * Unmount: the engine's leave law, mirrored from map.html's leaveVehicle +
   * exitVehicle + exitPoseManned — the drive's velocities zero, the state is
   * applied back onto the node (`applyTransform`/`applyRig`), the hull parks
   * on its springs where it stood (`releaseDriven`, carry velocity), the
   * soldier is re-placed at the seat's exit point, and the world's mount is
   * cleared. Returns the exit pose, or null if nothing was mounted.
   */
  unmountFromSeat(world, playerId, entry) {
    const player = world.player(playerId);
    if (!player?.occupancy) return null;
    const occ = player.occupancy;
    const exit = this.exitPoseOf(occ);
    const vehicle = player.vehicle;
    if (vehicle) {
      vehicle.state.velocity.set(0, 0, 0);
      vehicle.state.angularVelocity.set(0, 0, 0);
      vehicle.state.throttle = 0;
      vehicle.setInput('c_PIThrottle', 0);
      vehicle.setInput('c_PIYaw', 0);
      vehicle.setInput('c_PIFire', 0);
      vehicle.applyTransform();
      vehicle.applyRig();
      const spec = bodySpecFor(occ.root, this.data);
      if (spec) {
        const s = vehicle.state;
        world.releaseDriven(entry.owner, vehicle, spec, {
          position: [s.position.x, s.position.y, s.position.z],
          axes: quaternionToAxes(s.orientation),
        });
      }
      entry.driver = null;
    }
    if (entry.seated > 0) entry.seated--;
    world.clearPlayerVehicle(playerId);
    world.resetStick(playerId);
    if (player.soldier) {
      player.soldier.collider = world.collider;
      player.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
    }
    return exit;
  }

  /** The seat's exit point in world space (map.html exitPoseManned — the
   *  ROOT's transform, not the seat's: a hull door is a hull door, and the
   *  root is the one the drive keeps fresh). */
  exitPoseOf(occ) {
    const declared = occ.exitLocationNode()?.userData?.physics?.soldierExitLocation;
    const local = (declared && Array.isArray(declared.position))
      ? new THREE.Vector3(declared.position[0], declared.position[1],
        -declared.position[2])
      : new THREE.Vector3(-2, 0.5, 0);
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    readWorldPose(occ.root, position, quat);
    local.applyQuaternion(quat).add(position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    return { x: position.x, y: position.y, z: position.z,
             yaw: Math.atan2(fwd.x, fwd.z) };
  }

  /** Seat switch within the same hull: the active seat changes, the manned
   *  guns and the aim rig rebuild, the bare-seat position feed refreshes.
   *  The drive model stays with the mounting player and coasts — round 3's
   *  first disclosed gap is the law here, not a bug to fix. */
  switchSeat(world, playerId, entry, seatIndex) {
    const player = world.player(playerId);
    if (!player?.occupancy?.root || player.occupancy.root !== entry.root) return null;
    const occ = player.occupancy;
    const order = occ.order;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= order.length) {
      return null;
    }
    const seatId = order[seatIndex];
    if (seatId === occ.activeSeatId) return { occ, seatId, changed: false };
    occ.setActiveSeat(seatId);
    const gunGroup = node => ({ node, stats: node.userData?.fireArms || {} });
    const manned = occ.activeFireArmsNodes().map(gunGroup);
    world.refreshMount(playerId, { manned });
    world.setPlayerPosition(playerId, this.positionOf(occ));
    return { occ, seatId, changed: true };
  }
}

/**
 * The page's `surfaceFriction(x, z)`: the lazily built material-friction
 * table from `_shared/damage.json`, water forced to the water material
 * (damage.json's own WATER id — collision.js's WATER_MATERIAL — is what the
 * body modules key on), everything else the default 1.0. A level without
 * damage tables answers the default for every sample.
 */
function surfaceFrictionAt(data, collider, groundHeightAt) {
  let table = null;
  const materials = data.damageTables?.materials;
  if (materials) {
    table = new Float32Array(Math.max(1, ...Object.keys(materials).map(Number)) + 1)
      .fill(1);
    for (const [id, m] of Object.entries(materials)) {
      const n = Number(id);
      if (Number.isFinite(n) && n >= 0 && n < table.length) {
        table[n] = Number.isFinite(m?.friction) ? m.friction : 1;
      }
    }
  }
  const waterLevel = data.extras?.waterLevel;
  return (x, z) => {
    if (!table) return 1;
    let id = collider?.heightfield?.material(x, z) ?? 0;
    if (Number.isFinite(waterLevel) && groundHeightAt(x, z) <= waterLevel) {
      id = 1;   // collision.js WATER_MATERIAL — the body modules' key
    }
    if (!Number.isInteger(id) || id < 0 || id >= table.length) return 1;
    return table[id];
  };
}
