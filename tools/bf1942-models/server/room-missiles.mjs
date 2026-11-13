// The round that is a vehicle, in a room (ledger FA-29, FA-30, CAM-4):
// Secret Weapons' Wasserfall, whose gunner rides the missile they fire, and
// the mods' guided missiles after it (EoD's Hawk, Desert Combat's SA-3).
//
// The engine's rule is `viewer/rocket-ride.js`'s header: `FireArms::
// fireBarrel` 0x0828aba0 has the game spawn the PlayerControlObject at the
// barrel, takes the firer out of the launcher and puts them in it, and writes
// the launcher's id on the player (`BFPlayer+0x6c`); `GameServer::exitVehicle`
// 0x0814e2c0 seats them back in that object however the ride ends. All of it
// is the server's, so here it is the room's:
//
//   - at the room's start every hull whose FireArms throws a vehicle
//     (`fireArms.projectile.vehicle`) gets one table entry of that template,
//     off the field (`live: false`), carrying `round: <the launcher's id>` so
//     a page can find its own pooled copy (`net-room.js` `pageHullOf`);
//   - `{type: 'launch', vehicle: <launcher id>}` from the player in that
//     launcher stands the entry at the barrel (the FireArms node's world
//     pose, `projectilePosition` on), fresh, tells everyone (`padSpawn`),
//     and moves the player into it with the round's `velocity` along the
//     barrel as the airframe's own;
//   - `{type: 'detonate', vehicle: <round id>}` from its rider is the
//     warhead's last round (`destroyVehicleWhenNoAmmo`, `FireArms::
//     fireFinished` 0x0828853d): `giveDamage(root, 1e10)`;
//   - a ridden round that dies, or that its rider leaves (`destroyOnExit`
//     kills it, SEAT-38), returns the rider to the launcher's seat, alive,
//     before the pads' death pass would kill them with the hull.
//
// The launch reaches here two ways: the room's own barrel, where the room
// flies its seat guns (`room-guns.mjs`; `room.mjs` hands `guns.
// onVehicleRound` to `launch`), and the firer's page's `launch` row, which is
// then a repeat and is taken as one. The warhead is the rider's `detonate`
// row. The room refuses a launch only while the last round still flies.

import * as THREE from 'three';

import { placeholderEntry } from './vehicle-table.mjs';
import { encodeJsonMsg, eventRow } from './room-wire.mjs';

/** `GameServer::giveDamage`'s kill (`0x501502f9`). */
const KILL_DAMAGE = 1e10;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _off = new THREE.Vector3();

/** The FireArms of `root` that throws a vehicle, or null. */
export function vehicleRoundGun(root) {
  let gun = null;
  root?.traverse?.(node => {
    const p = node.userData?.fireArms?.projectile;
    if (!gun && p && typeof p === 'object' && p.vehicle === true && p.template) gun = node;
  });
  return gun;
}

/** Whether a hull's own FireArms says `destroyVehicleWhenNoAmmo`. */
export function hasWarhead(root) {
  let found = false;
  root?.traverse?.(node => { if (node.userData?.fireArms?.destroyVehicleWhenNoAmmo === true) found = true; });
  return found;
}

/**
 * @param {object} options
 * @param {object} options.room     the Room (`instance`, `world`, `levelData`,
 *                                  `players`, `authority`, `tick`, `code`)
 * @param {(row: object) => void} options.onRow   a row to everyone
 * @param {(connection) => void} options.unmount  the room's exit
 */
export function createRoomMissiles({ room, onRow, unmount }) {
  const { instance, world } = room;
  const rounds = new Map();     // launcher entry -> round entry
  const launchers = new Map();  // round entry -> launcher entry
  const riders = new Map();     // slot -> { round, launcher, seat }

  function standDown(entry) {
    entry.live = false;
    entry.wreckAge = null;
    if (entry.root?.userData) entry.root.userData.padAbsent = true;
    world.removeBody?.(entry.owner);
  }

  for (const launcher of [...instance.table]) {
    const gun = vehicleRoundGun(launcher.root);
    if (!gun) continue;
    const template = String(gun.userData.fireArms.projectile.template);
    const tree = room.levelData?.templates?.get(template.toLowerCase());
    if (!tree) continue;                        // no published model: the page's shell
    const entry = placeholderEntry(instance, instance.table, { template, tree, at: launcher.home });
    if (!entry) continue;
    entry.round = launcher.id;
    entry.team = launcher.team ?? null;
    instance.table.push(entry);
    instance.ownerToEntry?.set(entry.owner, entry);
    standDown(entry);
    rounds.set(launcher, entry);
    launchers.set(entry, launcher);
  }

  /** The barrel's pose in the world: the FireArms node's, `projectilePosition`
   *  on (glTF axes, as the exporter writes it). */
  function barrelPose(launcher) {
    const gun = vehicleRoundGun(launcher.root);
    gun.updateWorldMatrix(true, false);
    gun.matrixWorld.decompose(_pos, _quat, _scale);
    const p = gun.userData.fireArms.projectilePosition;
    if (Array.isArray(p)) _pos.add(_off.set(p[0], p[1], p[2]).applyQuaternion(_quat));
    return { position: _pos.clone(), quaternion: _quat.clone().normalize(),
             speed: Number(gun.userData.fireArms.velocity) || 0 };
  }

  const seatOf = slot => {
    const occ = world.player(slot)?.occupancy;
    return occ ? occ.order.indexOf(occ.activeSeatId) : -1;
  };

  /** `slot` into `entry`'s seat, with the room's row. Null when refused. */
  function seat(connection, entry, seatIndex) {
    let mounted = null;
    try {
      mounted = instance.mountIntoSeat(world, connection.slot, entry, seatIndex);
    } catch (error) {
      console.error(`room ${room.code}: round seat on ${entry.template} THREW: ${error.message}`);
    }
    if (!mounted) return null;
    // To the rider as well: the server chose this seat.
    onRow({ type: 'seatEnter', slot: connection.slot, vehicle: entry.id,
            seat: mounted.occupancy.order.indexOf(mounted.seatId) });
    return mounted;
  }

  function refuse(connection, launcher, why) {
    connection?.peer?.send(encodeJsonMsg(eventRow('launchRefused', room.tick,
      { slot: connection.slot, vehicle: launcher?.id ?? null, why })));
    return false;
  }

  /** The player in `launcher`'s seat fires its round. */
  function launch(slot, launcher) {
    const connection = room.players.get(slot);
    const entry = launcher ? rounds.get(launcher) : null;
    const player = world.player(slot);
    if (!connection) return false;
    // Already in the round this launcher threw: the same launch heard twice
    // (the room's own barrel and the page's row), not a second one.
    if (entry && riders.get(slot)?.round === entry) return true;
    if (!entry || !player?.occupancy || player.occupancy.root !== launcher.root) return refuse(connection, launcher, 'seat');
    if (!room.authority.mayInput(slot)) return refuse(connection, launcher, 'dead');
    // One out at a time: its last round still flies.
    const damage = world.vehicleDamage?.get(entry.owner);
    if (entry.live && !damage?.destroyed) return refuse(connection, launcher, 'flying');
    const seatIndex = Math.max(0, seatOf(slot));
    const pose = barrelPose(launcher);

    // A fresh object at the barrel.
    damage?.reset?.();
    entry.live = true;
    entry.wreckAge = null;
    if (entry.root?.userData) entry.root.userData.padAbsent = false;
    entry.root.position.copy(pose.position);
    entry.root.quaternion.copy(pose.quaternion);
    entry.root.updateMatrixWorld(true);
    world.removeBody?.(entry.owner);
    onRow({ type: 'padSpawn', vehicle: entry.id, pad: null, template: entry.template,
            round: launcher.id, at: pose.position.toArray(), q: pose.quaternion.toArray() });

    // Out of the launcher (`exitVehicle(player, true)`) and into the round.
    unmount(connection);
    if (!seat(connection, entry, 0)) {
      standDown(entry);
      onRow({ type: 'vehicleGone', vehicle: entry.id });
      seat(connection, launcher, seatIndex);
      return refuse(connection, launcher, 'mount');
    }
    const state = world.player(slot)?.vehicle?.state;
    if (state?.velocity?.copy) {
      state.velocity.copy(_fwd.set(0, 0, -1).applyQuaternion(pose.quaternion).multiplyScalar(pose.speed));
      if ('airspeed' in state) state.airspeed = pose.speed;
    }
    riders.set(slot, { round: entry, launcher, seat: seatIndex });
    return true;
  }

  /** Back in the launcher (`BFPlayer+0x6c`), if it stands and the seat is
   *  free. The rider is out of the round already or is taken out here. */
  function giveBack(slot) {
    const ride = riders.get(slot);
    if (!ride) return false;
    riders.delete(slot);
    const connection = room.players.get(slot);
    const player = world.player(slot);
    if (!connection || !player) return false;
    if (player.occupancy?.root === ride.round.root) unmount(connection);
    if (player.armor?.destroyed || !room.authority.mayInput(slot)) return false;
    const { launcher } = ride;
    if (launcher.live === false || world.vehicleDamage?.get(launcher.owner)?.destroyed) return false;
    for (const [other, p] of world.players) {
      if (other === slot || p.occupancy?.root !== launcher.root) continue;
      if (p.occupancy.order.indexOf(p.occupancy.activeSeatId) === ride.seat) return false;
    }
    return !!seat(connection, launcher, ride.seat);
  }

  /** A round destroyed outside the world's own damage pass: the wreck's
   *  clock for the pads (`room-pads.mjs` retires it at its time to live),
   *  and its hit points to the pages. */
  function killed(entry, damage) {
    if (entry.wreckAge == null) entry.wreckAge = 0;
    onRow({ type: 'hull', vehicle: entry.id, hp: damage.hitPoints ?? 0, destroyed: true });
  }

  /** The warhead's last round (FA-30), fired by the round's rider. */
  function detonate(slot) {
    const ride = riders.get(slot);
    if (!ride || world.player(slot)?.occupancy?.root !== ride.round.root) return false;
    if (!hasWarhead(ride.round.root)) return false;
    const damage = world.vehicleDamage?.get(ride.round.owner);
    if (!damage || damage.destroyed) return false;
    damage.damage(KILL_DAMAGE);
    giveBack(slot);
    killed(ride.round, damage);
    return true;
  }

  return {
    launch, detonate,
    /** `{type: 'launch', vehicle: <launcher id>}`. */
    onLaunch: (connection, row) => launch(connection.slot, instance.table.find(v => v.id === row?.vehicle) ?? null),
    /** `{type: 'detonate', vehicle: <round id>}`. */
    onDetonate: (connection, row) => (riders.get(connection.slot)?.round.id === row?.vehicle
      ? detonate(connection.slot) : false),
    /** Before the pads' death pass: a ridden round that died this step gives
     *  its rider back instead of taking them with it. */
    hullDeaths(step) {
      for (const change of step?.damage ?? []) {
        if (!change.died) continue;
        const owner = change.vehicle?.owner ?? change.vehicle;
        for (const [slot, ride] of riders) if (ride.round.owner === owner) giveBack(slot);
      }
    },
    /** After the room's exit (`room-control.mjs` `onSeat`): a rider who got
     *  out of their round. `destroyOnExit` kills it once they are out
     *  (SEAT-38), and they go back to the launcher. */
    afterExit(connection, vehicle) {
      const ride = riders.get(connection.slot);
      if (!ride || ride.round !== vehicle) return;
      const damage = world.vehicleDamage?.get(vehicle.owner);
      if (vehicle.root?.userData?.physics?.destroyOnExit === true && damage && !damage.destroyed) {
        damage.damage(KILL_DAMAGE);
        killed(vehicle, damage);
      }
      giveBack(connection.slot);
    },
    roundOf: launcher => rounds.get(launcher) ?? null,
    launcherOf: entry => launchers.get(entry) ?? null,
    riding: slot => riders.get(slot) ?? null,
    get count() { return rounds.size; },
  };
}
