// One seated player's world tick: the HP-15 gate, the drivetrain's inputs
// and its one integration a tick, the seat's aim rig, and both fire loops.
// Plain functions of the `World` (world.js), called from its tick with the
// world's own drive -> integrating-player map.

import { inputGate } from './vehicle-damage.js';
import { axisToward, consume } from './world-input.js';

/**
 * One drivetrain, one integration a tick. Every occupant of a hull holds the
 * hull's single drive (`vehicle-instance.js`), so the drive is stepped in
 * the tick of whoever holds its root seat (their input reaches it first), or
 * of its first occupant when nobody drives and the hull coasts.
 */
export function assignIntegrators(world, owners) {
  owners.clear();
  for (const player of world.players.values()) {
    const vehicle = player.occupancy ? player.vehicle : null;
    if (!vehicle) continue;
    if (!owners.has(vehicle) || player.occupancy.isActiveRoot()) owners.set(vehicle, player);
  }
}

/**
 * The occupied-vehicle path: the HP-15 gate, the drivetrain's inputs and
 * integration, the turret rig's aim and step, and both fire loops -- the
 * seat's own `mannedGuns` and the drivetrain's `vehicleGuns`. What the
 * page's pilot()/drive()/manned() used to do between the look pump and the
 * camera; the camera, the FOV and the HUD wiring stay in the page.
 */
export function vehicleTick(world, player, dt, integrators) {
  const occ = player.occupancy;
  const vehicle = player.vehicle;
  // HP-15: a destroyed PCO receives no input at all
  // (`PlayerControlObject::handlePlayerInput`, lnxded 0x08318920); the gate
  // is forced false rather than returning, so the hull still integrates and
  // coasts, exactly as the page's comment on its own copy of this line says.
  inputGate(world.occupiedDamageable(player.id), player.gate);
  if (occ.turret) occ.turret.inputScale = player.gate.rotationalScale;
  const activeRoot = occ.isActiveRoot();
  const inControl = activeRoot && !player.gate.blocked;
  // Exactly one entry for this tick: the buffer's oldest, else the page's
  // pending freshest, else the engine's zeroed idle word.
  const entry = consume(player);
  const input = entry.input;

  if (vehicle) {
    if (player.kind === 'air') {
      if (inControl) {
        // W/S throttle latches rather than springs — you set a power
        // setting and it stays there, which is what a throttle quadrant
        // does. `forwardKeys` is the page's raw pair: the pad's Y is the
        // stick's pitch, never the throttle.
        const power = input.forwardKeys;
        if (power !== 0) {
          vehicle.setInput('c_PIThrottle', Math.max(0, Math.min(1,
            vehicle.input('c_PIThrottle') + power * dt)));
        }
        // A/D rudder, pad X for roll, pad Y for pitch -- the same stick
        // spring the page applied at its own frame rate; the pad bypasses
        // it, which is the page's mobile arrangement.
        vehicle.setInput('c_PIYaw', axisToward(
          vehicle.input('c_PIYaw'), input.rudder, dt));
        player.stick.roll = input.pad
          ? input.roll : axisToward(player.stick.roll, input.roll, dt);
        player.stick.pitch = input.pad
          ? input.pitch : axisToward(player.stick.pitch, input.pitch, dt);
        vehicle.setInput('c_PIRoll', player.stick.roll);
        vehicle.setInput('c_PIPitch', player.stick.pitch);
        vehicle.setInput('c_PIFire', input.fire ? 1 : 0);
        vehicle.setInput('c_PIAltFire', input.altFire ? 1 : 0);
      }
    } else {
      // Ground vehicles take keyboard input directly -- the vehicle's own
      // RotationalBundle servo is the only governor (the page's comment on
      // why the aircraft-style spring made every land vehicle feel wrong).
      if (inControl) {
        vehicle.setInput('c_PIThrottle', input.forward);
        vehicle.setInput('c_PIYaw', input.strafe);
        // Ships ride this branch on player.kind (a Ship IS an Aircraft in
        // ship.js, but world.js branches on the seat kind, and c_ETShip
        // classifies to 'ship'). Their ramps (LCVP/Daihatsu) and dive
        // planes + float trim (Gato/Sub7C) all bind c_PIPitch, which no
        // ground/tank hull does -- so only ships read the pitch axis here.
        // The same stick spring the aircraft path uses (arrows on desktop,
        // the mobile pad's Y when held, bypassing the spring as the page
        // always did for it); W/S stays c_PIThrottle (ahead/astern) and
        // never drives the pitch.
        if (player.kind === 'ship') {
          player.stick.pitch = input.pad
            ? input.pitch : axisToward(player.stick.pitch, input.pitch, dt);
          vehicle.setInput('c_PIPitch', player.stick.pitch);
        }
        vehicle.setInput('c_PIFire', input.fire ? 1 : 0);
        vehicle.setInput('c_PIAltFire', input.altFire ? 1 : 0);
      }
    }
    // Once a tick, by the root seat's holder (or the first occupant of a
    // hull nobody drives): the drive is the hull's, not the seat's.
    if (integrators.get(vehicle) === player) {
      vehicle.integrate(dt);
      // After `integrate`, never before: it ends in `applyRig`, which puts
      // every declared RotationalBundle back at hull-forward. Stepping the
      // aim rig afterwards is what leaves the traverse where the player
      // pointed it.
      occ.applyTurrets();
    }
  }

  // The turret is stepped when the seat that owns it is the one active:
  // the drivetrain's root seat (`isActiveRoot`) or any manned seat -- a
  // bare gun/seat root has no drivetrain, and a passenger seat never has a
  // rig. The look stage was pumped once per frame by the page; per world
  // tick the latest axis pair aims the rig and the servo runs once, which
  // is exactly the page's `stepTurret` inner loop.
  if (occ.turret) {
    occ.turret.aim(entry.lookX, entry.lookY);
    occ.turret.step(dt);
  }

  // Kept unconditional for the same reason the page's copies are: a
  // vehicle's own weapon must stop the instant nobody is in the seat that
  // fires it, and gating the *value* passed to setFiring (not skipping the
  // call) is what turns it off the same tick the seat stops being active.
  for (const group of player.groups) {
    const state = world.fireStateFor(group.node);
    if (inControl) state.step(dt);
    world.guns?.setFiring(group, inControl
      && vehicle && vehicle.input(group.stats.input || 'c_PIFire') > 0
      && state.canFire);
  }
  // The active seat's own FireArms: per weapon, one trigger per declared
  // input (c_PIFire / c_PIAltFire), gated on the same HP-15 byte.
  // A drivetrain's root seat is its driver's, and its FireArms are the
  // `groups` the loop above has just stepped and triggered. Taking them
  // again here fired a second group on the same node: one pull of a
  // Sherman's trigger was two shells and two rounds off the HUD, and the
  // reload ran at twice its rate.
  const driven = new Set(player.groups.map(g => g.node));
  const fire = input.fire && !player.gate.blocked;
  for (const node of occ.activeFireArmsNodes()) {
    if (driven.has(node)) continue;
    const state = world.fireStateFor(node);
    state.step(dt);
    const group = player.manned.find(g => g.node === node);
    if (!group) continue;
    const trigger = node.userData?.fireArms?.input === 'c_PIAltFire'
      ? (input.altFire && !player.gate.blocked) : fire;
    world.guns?.setFiring(group, trigger && state.canFire);
  }
}
