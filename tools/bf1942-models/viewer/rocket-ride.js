// The round that is a vehicle: Secret Weapons' Wasserfall, whose gunner
// rides the missile they fire (ledger FA-29, FA-30, CS-16, CAM-4), on the
// map page in single player.
//
// What the engine does, each step read on lnxded:
//
//   - The launch. `FireArms::fireBarrel` 0x0828aba0 asks its projectile
//     template for its class. For a PlayerControlObject template, and only
//     when the firing player's vehicle root is the weapon's own root, it has
//     the game spawn the object at the barrel (`Game` vt+0x50), sets its
//     matrix to the barrel's, takes the player out of the launcher (`Game`
//     vt+0x70, `exitVehicle(player, true)`) and puts them in the new object
//     (vt+0x6c), and writes the launcher's object id on the player
//     (`BFPlayer+0x6c`). No projectile is thrown. The launcher's FireArms
//     keeps its own magazine and reload (`WasserfallFireArmsBundle`:
//     `magSize 1`, `reloadtime 20`).
//   - The ride. The rocket is an aircraft like any other (`VCAir`, a
//     `c_ETPlane` Engine that binds no input and so runs flat out, PHY-30,
//     until its heat stops it, PHY-45; `rocket-burn.js`). Its
//     PlayerControlObject says `vehicleCameraShake CstMachinegun`: every frame
//     its occupant looks through its Camera, `Camera::getTransformation`
//     (0x081ac344..0x081ac389) enters that trigger's state on the soldier's
//     trigger machine, runs `updateCameraShake(dt)` and resets the machine
//     (`triggerCameraShake(-1)` -> `reset(0)` 0x0832b210, which zeroes the
//     seconds clock). So the shake never runs on: each frame it is the
//     state's first `dt`, `amplitude * sin(rate * dt)` a channel with the
//     factor snapped to 1 (`FireMachineGunShake` has no fade-in): 0.5 degrees
//     of roll at 800 rad/s, 0.25 of pitch at 900 and of yaw at 700. It
//     trembles with the frame time and stands still on a frame time that
//     does not move (CS-16).
//   - The warhead. The rocket's own FireArms (`WasserFallGuns`, alt fire, 25
//     barrels, one round) says `destroyVehicleWhenNoAmmo 1`: `FireArms::
//     fireFinished` 0x08288470, once the weapon's rounds (`+0x298`) are
//     spent, gives the weapon's root PlayerControlObject 1e10 damage
//     (0x0828853d..0x0828870d), which is how the gunner sets it off (FA-30).
//   - The end. However the rocket dies with its rider aboard, `GameServer::
//     _giveDamage` puts them out through `exitAndPlaceCameraIfApplicable`
//     0x081595b0, and `GameServer::exitVehicle` 0x0814e2c0, finding
//     `BFPlayer+0x6c` set, seats them back in the launcher and clears it. The
//     rocket's `cameraDelayTime 5` / `cameraDelayDistance 15` then hold the
//     launcher's Camera 15 m behind where the rocket ended, looking along
//     its heading, for 5 s or until the fire or alt-fire button (CAM-4).
//     Getting out with the use key is the same exit without the camera: the
//     rocket's `destroyOnExit` kills it after the rider has left (SEAT-38).
//     A launcher that is gone, or taken, leaves the rider where the rocket
//     put them out.
//
// The page: `guns.onVehicleRound` (`round-launch.js` `fireRound`) hands the
// round here. The rocket is a pooled vehicle of the models tree
// (`level-statics.js` `roundSpawnEntries`, `round-spawners.js`
// `standVehicle`), stood at the barrel and entered on the same frame, after
// the tick that fired it, with the round's velocity as its own. A bot's
// launch is the same (`botLaunch`, below). In a room the round is the room's
// (`server/room-missiles.mjs`) and this is the firer's prediction of it. A
// tree with no model for the round, or a room without one, keeps the old
// behaviour: the round flies as the body it is drawn as.

import * as THREE from 'three';
import { CameraShake, applyViewShake } from './fire-shake.js';
import { chainOnShot } from './fire-state.js';
import { KILL_DAMAGE } from './crash-damage.js';

/** `Camera::getTransformation`'s mode 17 look point: 20 m along the held
 *  matrix's forward (0x081ab9d8, CAM-4). */
export const TEMP_CAMERA_LOOK_AHEAD = 20;

/**
 * One frame of a seat's `vehicleCameraShake` (CS-16): the trigger's state
 * entered on a machine that was reset the frame before, and stepped once.
 * `blocks` are the state's shake blocks (`gaits.json` `triggerShakes[name].
 * cameraShake`), `shake` a `CameraShake` this owns, `out` the six channels
 * (`fire-shake.js`). Answers whether there is a shake to draw.
 */
export function vehicleShakeFrame(shake, blocks, dt, out = {}) {
  // `reset(0)`: state 0, the clock at 0, slot 0, the factor 0 and fading in.
  shake.key = null;
  shake.slots = null;
  shake.t = 0;
  shake.factor = 0;
  shake.fadingIn = true;
  shake.slot = 0;
  shake.enter('vehicle', blocks);
  return shake.update(Math.max(0, dt), out);
}

/**
 * The temporary camera's pose (CAM-4): `matrix` (the dead hull's, as a
 * `THREE.Matrix4` in the page's frame, forward -Z) moved `distance` back
 * along its forward, looking 20 m along that forward with the matrix's up.
 */
export function tempCameraPose(matrix, distance, outPosition, outQuaternion) {
  const e = matrix.elements;
  _fwd.set(-e[8], -e[9], -e[10]).normalize();
  _up.set(e[4], e[5], e[6]).normalize();
  outPosition.set(e[12], e[13], e[14]).addScaledVector(_fwd, -distance);
  _look.copy(outPosition).addScaledVector(_fwd, TEMP_CAMERA_LOOK_AHEAD);
  _m.lookAt(outPosition, _look, _up);
  outQuaternion.setFromRotationMatrix(_m);
  return outPosition;
}

/** A FireArms' rounds left in all (`FireArms+0x298`), off its `FireState`. */
export function roundsLeft(state) {
  if (!state || state.unlimited) return Infinity;
  const mags = state.magsLeft === Infinity ? Infinity : Math.max(0, state.magsLeft || 0);
  return Math.max(0, state.ammo || 0) + mags * Math.max(0, state.stats?.magSize || 0);
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _stand = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * Built once by the page. `page` hands in, as getters: `camera`,
 * `botUnits()`, `enterVehicle`,
 * `fireStateFor`, `fireStates`, `footTriggerShakes`, `guns`, `LOCAL_PLAYER`,
 * `netSendAction`, `occupancy`, `roomJoined`, `roundVehicleFor`,
 * `referee()`, `withServerSeat`, `roundSpawners`
 * (`standVehicle`), `seatAltFire`, `seatFire`, `seatView`, `soldierDead`,
 * `vehicles`, `world`, and `wrecked(node)` (whether a hull is a wreck).
 */
export function createRocketRide(page) {
  const ride = {};
  // The launch waiting for the tick that fired it to end.
  let pending = null;
  // { node, launcher: { root, seatId }, physics } while the human rides.
  let active = null;
  // { position, quaternion, left } while the temporary camera holds.
  let linger = null;
  const shake = new CameraShake();
  const shakeOut = {};
  let shakeBlocks;   // undefined: not asked; null: none
  let frameDt = 0;

  function triggerBlocks(name) {
    if (shakeBlocks === undefined) {
      shakeBlocks = null;
      Promise.resolve(page.footTriggerShakes?.()).then(table => { shakeBlocks = table ?? null; }, () => {});
    }
    return shakeBlocks?.[name]?.cameraShake ?? null;
  }

  /** `guns.onVehicleRound`: true when the page stood the vehicle. */
  ride.onVehicleRound = (group, spec, launch) => {
    if (spec?.vehicle !== true || !spec.template) return false;
    if (group?.replay || pending || active) return false;
    const seat = page.vehicles?.seatOfGroup?.(group) ?? null;
    if (!seat) return false;
    // A bot's launcher (`bots`, below): the same round, flown by its AI.
    if (seat.playerId !== page.LOCAL_PLAYER) return botLaunch(seat, spec, launch);
    // `fireBarrel` spawns it only for the player whose vehicle is the
    // weapon's own; here, the human in the launcher's seat.
    if (page.soldierDead) return false;
    // In a room the round is the room's own (`server/room-missiles.mjs`):
    // the page stands its copy of that one as its prediction and tells the
    // room, which moves the player itself. A room with no round for this
    // launcher (an older server, no model) leaves the shell.
    let served = null;
    if (page.roomJoined) {
      served = page.roundVehicleFor?.(seat.root) ?? null;
      if (!served) return false;
    }
    _stand.compose(launch.position, launch.quaternion, _one);
    const node = page.roundSpawners?.standVehicle?.(spec.template, _stand,
      served ? { node: served.node } : {}) ?? null;
    if (!node) return false;
    if (served) page.netSendAction?.({ type: 'launch', vehicle: served.launcher });
    pending = {
      node, velocity: launch.velocity.clone(), served,
      launcher: { root: seat.root, seatId: seat.seatId },
    };
    return true;
  };

  // --- a bot's launcher ----------------------------------------------------
  //
  // `fireBarrel`'s branch asks only that the firing player's vehicle is the
  // weapon's root, so a bot's launch is the same launch, and `exitVehicle`
  // gives a bot back to the launcher the same way. What flies the missile is
  // the bot's own AI for the object it is now in. The rocket's
  // `aiTemplate WasserFallRocket` is `ITUnit ITMobile ITAir` with
  // `equipmentType 1`, the `Plane` row of the mod's `AIBehaviours.con`
  // (MoveTo, Idle, `Fire3d`, Change), a `ControlInfo3d` (stick and rudder,
  // `maxSpeed 160`, `turnRadius 55`) and one weapon, `WasserFallAttack`:
  // `weaponFire PIAltFire`, `maxRange 30`, strongest against Air. So a
  // bot flies it at its target as it flies a fighter and sets the warhead
  // off inside 30 m. None of that is new here: the tree's `vehicle-ai.json`
  // already carries the template, and `bot-units.js` hands a bot seated in
  // an `air` hull to the pilots' code. The launcher itself is
  // `equipmentType 17`, the `FixedGuidedMissileLauncher` row (`FireGuided`,
  // AI-175), which decides when to fire, not how the missile flies.
  const botPending = [];
  const botRides = new Map();   // playerId -> { node, launcher: { root, seatId } }

  function botLaunch(seat, spec, launch) {
    const referee = page.referee?.() ?? null;
    const bot = referee?.bots?.find(b => b.playerId === seat.playerId) ?? null;
    if (page.roomJoined || !bot || botRides.has(bot.playerId)
        || botPending.some(p => p.bot === bot)) return false;
    _stand.compose(launch.position, launch.quaternion, _one);
    const node = page.roundSpawners?.standVehicle?.(spec.template, _stand) ?? null;
    if (!node) return false;
    botPending.push({ bot, node, velocity: launch.velocity.clone(),
                      launcher: { root: seat.root, seatId: seat.seatId } });
    return true;
  }

  /** The bots' door list entry for `seatId` of the hull at `root` (its root
   *  seat when `seatId` is null), fresh. */
  function botDoor(root, seatId = null) {
    const units = page.botUnits?.() ?? null;
    if (!units || !root) return null;
    units.invalidate?.();
    const doors = units.candidates().filter(c => c.vehicleId === root.uuid);
    return (seatId != null ? doors.find(c => c.seatId === seatId) : null)
      ?? doors.find(c => c.isRoot) ?? doors[0] ?? null;
  }

  function botBoard({ bot, node, velocity, launcher }) {
    const referee = page.referee?.() ?? null;
    if (!referee || page.vehicles?.seatOf?.(bot.playerId)?.root !== launcher.root) return;
    // Out of the launcher without its `destroyOnExit` (`exitVehicle(player,
    // true)`), into the round.
    referee.leaveVehicle(bot, { silent: true });
    const door = botDoor(node);
    if (!door || !referee.enterVehicle(bot, door)) {
      const back = botDoor(launcher.root, launcher.seatId);
      if (back) referee.enterVehicle(bot, back);
      return;
    }
    const state = page.vehicles?.seatOf?.(bot.playerId)?.drive?.state;
    if (state?.velocity?.copy) {
      state.velocity.copy(velocity);
      if ('airspeed' in state) state.airspeed = velocity.length();
    }
    botRides.set(bot.playerId, { node, launcher });
  }

  /** A bot back in its launcher, if it stands and the seat is free. */
  function botReturn(bot, launcher) {
    const referee = page.referee?.() ?? null;
    if (!referee || !launcher?.root || page.wrecked?.(launcher.root)) return false;
    if (page.vehicles?.holder?.(launcher.root, launcher.seatId) != null) return false;
    const door = botDoor(launcher.root, launcher.seatId);
    return !!door && referee.enterVehicle(bot, door);
  }

  /**
   * The referee's question before it kills a bot with its destroyed hull
   * (`bot-referee.js` `vehicleTick`): was the hull a round the bot rode? Then
   * the bot goes back to the launcher instead. True when it has.
   */
  ride.botRideOut = bot => {
    const rode = botRides.get(bot?.playerId);
    if (!rode || page.vehicles?.seatOf?.(bot.playerId)?.root !== rode.node) return false;
    botRides.delete(bot.playerId);
    page.referee?.()?.leaveVehicle(bot, { silent: true });
    return botReturn(bot, rode.launcher);
  };

  function botFrame() {
    while (botPending.length) botBoard(botPending.shift());
    for (const [id, rode] of botRides) {
      const seat = page.vehicles?.seatOf?.(id) ?? null;
      if (seat?.root === rode.node) continue;
      // Out of the round by its own Use (which killed it, SEAT-38) or dead.
      botRides.delete(id);
      const bot = page.referee?.()?.bots?.find(b => b.playerId === id) ?? null;
      if (bot && !seat && !page.world?.armorOf?.(id)?.destroyed) botReturn(bot, rode.launcher);
    }
  }

  /** A seat the room gives by itself is followed without a seat row of the
   *  page's own (`net-room.js` `withServerSeat`). */
  function seatQuietly(entry) {
    const enter = () => page.enterVehicle(entry);
    if (page.roomJoined && page.withServerSeat) page.withServerSeat(enter);
    else enter();
  }

  /** The firer into the rocket, once the tick that fired it is over. */
  function board() {
    const { node, velocity, launcher, served } = pending;
    pending = null;
    if (page.soldierDead || page.occupancy?.root !== launcher.root) return;
    seatQuietly({ vehicle: node, seatId: null, granted: true });
    if (page.occupancy?.root !== node) {
      // The seat refused: back in the launcher, the rocket left where it
      // stands (its own Armor and the pool take it from there).
      if (!page.occupancy) seatQuietly({ vehicle: launcher.root, seatId: launcher.seatId, granted: true });
      return;
    }
    // The round's own velocity is the vehicle's (`velocity 45` up the rail).
    const state = page.occupancy.drive?.state;
    if (state?.velocity?.copy) {
      state.velocity.copy(velocity);
      if ('airspeed' in state) state.airspeed = velocity.length();
    }
    active = { node, launcher, physics: node.userData?.physics ?? {}, served: served ?? null };
  }

  /** Back in the launcher (`exitVehicle`'s `BFPlayer+0x6c`), if it stands
   *  and its seat is free. Answers whether the rider is seated there. */
  function returnToLauncher(launcher) {
    if (page.soldierDead || !launcher?.root || page.wrecked?.(launcher.root)) return false;
    if (page.vehicles?.holder?.(launcher.root, launcher.seatId) != null) return false;
    seatQuietly({ vehicle: launcher.root, seatId: launcher.seatId, granted: true });
    return page.occupancy?.root === launcher.root;
  }

  /** The room would not launch (`launchRefused`): the page's prediction is
   *  undone, the player back in the launcher the room still has them in. */
  ride.launchRefused = () => {
    pending = null;
    if (!active) return;
    const { launcher, node } = active;
    active = null;
    if (page.occupancy?.root === node) seatQuietly({ vehicle: launcher.root, seatId: launcher.seatId, granted: true });
  };

  /**
   * `vehicle-wrecks.js` `killOccupantInWreck`'s question: the hull the human
   * sits in has just been destroyed; is it a ridden round? Then the rider
   * goes back to the launcher instead of dying with it, and the temporary
   * camera is placed. True when the rider has been taken care of.
   */
  ride.rideOut = node => {
    if (!active || active.node !== node || page.occupancy?.root !== node) return false;
    const { launcher, physics } = active;
    active = null;
    node.updateWorldMatrix(true, false);
    const last = node.matrixWorld.clone();
    if (!returnToLauncher(launcher)) return false;
    const time = Number(physics.cameraDelayTime) || 0;
    if (time > 0) {
      linger = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), left: time, armed: false };
      tempCameraPose(last, Number(physics.cameraDelayDistance) || 0, linger.position, linger.quaternion);
    }
    return true;
  };

  /** Once a frame, after the seat has placed the camera and before anything
   *  reads it. */
  ride.frame = dt => {
    frameDt = dt;
    if (botPending.length || botRides.size) botFrame();
    if (pending) board();
    if (active && page.occupancy?.root !== active.node) {
      // Out by the use key (the rocket's `destroyOnExit` has killed it) or
      // dead in the seat: the exit's own return, with no camera.
      const { launcher } = active;
      active = null;
      if (!page.soldierDead && !page.occupancy) returnToLauncher(launcher);
    }
    if (!linger) return;
    // `Camera::handlePlayerInput` 0x081aa490: a press of the fire or the
    // alt-fire button ends it. The button that set the warhead off is still
    // down on the first frames, so a press means up, then down.
    const held = !!(page.seatFire || page.seatAltFire);
    if (!held) linger.armed = true;
    linger.left -= dt;
    if (linger.left <= 0 || (held && linger.armed) || page.soldierDead || !page.occupancy) {
      linger = null;
      return;
    }
    const camera = page.camera;
    camera.position.copy(linger.position);
    camera.quaternion.copy(linger.quaternion);
    camera.updateMatrixWorld();
  };

  /**
   * The ridden seat's `vehicleCameraShake` on the drawn view (CS-11: the
   * view rides it, the rounds do not), around the render. Returns the
   * function that puts the camera back, or null. First person only: the
   * engine shakes the seat's Camera in every view, but the chase views are
   * the page's own rigs and are left steady.
   */
  ride.shakeView = camera => {
    const name = active && !linger ? active.physics.vehicleCameraShake : null;
    if (!name || name === 'CstNoShake' || page.occupancy?.root !== active.node) return null;
    if (page.seatView?.()?.firstPerson === false) return null;
    const blocks = triggerBlocks(name);
    if (!blocks || !vehicleShakeFrame(shake, blocks, frameDt, shakeOut)) return null;
    return applyViewShake(camera, shakeOut);
  };

  // FA-30, for any seat gun: `destroyVehicleWhenNoAmmo`.
  if (page.guns) {
    chainOnShot(page.guns, (group, rounds) => {
      const node = group?.node;
      if (node?.userData?.fireArms?.destroyVehicleWhenNoAmmo !== true) return;
      if (page.roomJoined) {
        // The room's to decide: the rider's warhead row (`room-missiles.mjs`).
        const firer = page.vehicles?.seatOfGroup?.(group) ?? null;
        if (active?.served && firer?.playerId === page.LOCAL_PLAYER && firer.root === active.node) {
          page.netSendAction?.({ type: 'detonate', vehicle: active.served.id });
        }
        return;
      }
      let state = page.fireStates?.get?.(node) ?? null;
      if (!state) {
        // Nobody had counted this gun's rounds yet: this shot is its first.
        state = page.fireStateFor?.(node) ?? null;
        state?.registerShot(rounds);
      }
      if (roundsLeft(state) > 0) return;
      const root = page.vehicles?.seatOfGroup?.(group)?.root ?? null;
      const hull = root ? page.world?.damageableOf?.(root) ?? null : null;
      if (hull && !hull.destroyed) hull.damage(KILL_DAMAGE);
    });
  }

  ride.reset = () => {
    pending = null; active = null; linger = null;
    botPending.length = 0; botRides.clear();
  };
  /** Headless hooks. */
  ride.state = () => ({
    pending: !!pending,
    riding: active ? active.node.name : null,
    launcher: active?.launcher?.root?.name ?? null,
    linger: linger ? +linger.left.toFixed(3) : null,
    bots: [...botRides.keys()],
  });
  return ride;
}
