// One seated player's world tick: the HP-15 gate, the drivetrain's inputs
// and its one integration a tick, the seat's aim rig, and both fire loops.
// Plain functions of the `World` (world.js), called from its tick with the
// world's own drive -> integrating-player map.

import { inputGate } from './vehicle-damage.js';
import { consume } from './world-input.js';
import { airborneDrive } from './airborne.js';

/**
 * One hull nobody is in any more, one integration a tick: the wreck of an
 * aircraft that was destroyed in the air.
 *
 * Retail runs the same physics on a wreck as on the live hull. The Armor's
 * destruction is TemplateMessage 0x15 on the object's own bus (HP-13), and
 * what each node does with it is all there is:
 *
 *   - `PlayerControlObject::handlePlayerInput` (lnxded `0x08318920`) returns
 *     before it forwards anything once `+0xed` is set (HP-15). No input
 *     reaches a child again, a zero included, so every control surface keeps
 *     the input its register held at the kill and its servo runs on from
 *     there (`RotationalBundle` `+0x11c`; `Wing::handleMessage` does not even
 *     pass on message 3, the seat emptying, which zeroes that register on a
 *     plain RotationalBundle, `0x081d85c4`).
 *   - `Engine::handleMessage` (`0x0823e730`) stops the engine and latches it
 *     (PHY-14): its revs are forced to 0.
 *   - `Wing::handleMessage` (`0x08250bf0`) writes the destroyed byte
 *     (`0x08250d5a`) and nothing else. The lift pair (`+0x148`/`+0x14c`) is
 *     untouched, and neither `Wing::handleUpdate` (`0x08250950`) nor
 *     `PhysicsWing::updatePhysics` (`0x0824ed10`) reads `+0xed`.
 *   - `ResponsePhysicsManager::update` and `PhysicsNode::
 *     updatePositionalPhysics` ask no destroyed flag either (HP-24).
 *
 * So a plane shot down is a glider with a dead engine and a frozen stick:
 * it carries on along the path it was flying and comes down on its own lift
 * and drag, for as long as its time to live lasts (HP-19, 10 s on every
 * vanilla aircraft, `vehicle-wrecks.js`). A hull that was critically damaged
 * first keeps the lift scale that gave it (`Aircraft.criticalLift`), which
 * is what rolls a burning plane over on the way down.
 *
 * An earlier version of this pass held a wreck to a 30 m/s sink with its lift
 * zeroed and its speed bled off, to answer a report of a downed BF109 gliding
 * 45 s. That glide was the missing time to live, not the lift: a retail wreck
 * glides too, and is removed at 10 s wherever it has got to.
 *
 * The wreck list (`world.falling`, filled by `vehicle-wrecks.js`) is the
 * driver because a plane whose crew is dead has no occupant left to step it.
 */

/** Put a hull's Wings back on their template's lift (`Aircraft.fullLift`):
 *  a wreck's pad standing a fresh hull up, or its crash. */
export function restoreLift(vehicle) {
  vehicle?.fullLift?.();
}

/**
 * The Wings' answer to the Armor's critical byte, for whoever steps the
 * drive: message 0x14 on the crossing into critical scales every Wing's lift
 * (`Aircraft.criticalLift`), 0x13 on the recovery puts it back. Destruction
 * sends neither (`vehicle-damage.js` `criticalFlagged`), so a wreck keeps
 * what it had. Two compares a tick for a hull whose byte has not moved.
 */
export function syncCriticalLift(vehicle, hull) {
  if (!hull || typeof vehicle?.criticalLift !== 'function') return;
  const flagged = !!hull.criticalFlagged;
  if (flagged === !!vehicle.liftIsCritical) return;
  if (flagged) vehicle.criticalLift(hull.criticalHitX ?? 0);
  else if (!hull.destroyed) vehicle.fullLift();
}

/**
 * The hulls nobody is in any more and nothing has destroyed: a plane whose
 * pilot bailed out, a helicopter whose crew jumped. The engine keeps
 * integrating an empty `PlayerControlObject` exactly as a crewed one -- its
 * Wings go on making lift from the flow over them and its Engines' revs run
 * down from a throttle axis `automaticReset` has let go of -- so an empty
 * Corsair cruises on and settles into whatever its trim gives it, and an
 * empty Harrier whose lift engines are spooling down sinks. Only two things
 * stepped a drive before this: its occupant's tick (`vehicleTick`) and the
 * wreck list above, so a hull vacated in flight hung in the sky at the point
 * of exit, for every airframe (`features/flyable-vehicles/README.md`,
 * "A vacated aircraft hangs in the air").
 *
 * The control word is the engine's zero, forced every tick: the surfaces
 * are servos with rates of their own, and a stick left where the pilot let
 * go of it would hold its deflection to the ground. (Not read on the binary
 * for a Wing: `Wing::handleMessage` `0x08250bf0` passes message 3 to nobody,
 * so retail may leave an empty plane's stick where it was as it does a
 * wreck's. Kept as built until that is measured.) One `integrate` a tick,
 * the same one the occupant's tick gave it.
 *
 * A coasting drive the wreck pass takes over (`fallingWreck`) leaves this
 * list the tick it does, so nothing is stepped twice. One that is down and
 * at rest hands itself back through `onDown`, which parks it the way the
 * last man out of a hull on the ground would have (`vehicle-instance.js`
 * `leave`): pose written, body released, node frozen.
 */

/** Below this ground speed a hull down on its wheels is at rest, m/s. */
const COAST_REST_SPEED = 0.5;

export function stepCoastingHulls(world, dt) {
  for (const [vehicle, onDown] of world.coasting) {
    if (!vehicle?.state || vehicle.fallingWreck || world.falling.has(vehicle)) {
      world.coasting.delete(vehicle);
      continue;
    }
    vehicle.setInput?.('c_PIThrottle', 0);
    vehicle.setInput?.('c_PIRoll', 0);
    vehicle.setInput?.('c_PIPitch', 0);
    vehicle.setInput?.('c_PIYaw', 0);
    vehicle.setInput?.('c_PIFire', 0);
    vehicle.setInput?.('c_PIAltFire', 0);
    vehicle.integrate(dt);
    const v = vehicle.state.velocity;
    const down = vehicle.state.grounded === true || !airborneDrive(vehicle);
    if (down && v && v.length() < COAST_REST_SPEED) {
      world.coasting.delete(vehicle);
      onDown?.(vehicle);
    }
  }
}

export function stepFallingWrecks(world, dt) {
  for (const vehicle of world.falling) {
    if (!vehicle?.state) continue;
    // 0x15 takes the weapon component off the object (`setComponent(
    // IID_IWeapon, NULL)`, `0x081db8f9`): a trigger held at the kill is let go.
    vehicle.setInput?.('c_PIFire', 0);
    vehicle.setInput?.('c_PIAltFire', 0);
    // The stick is left where the kill found it: no input is forwarded to a
    // destroyed hull's children, so nothing writes their registers again.
    // The throttle is the Engine's own and the Engine is stopped: 0x15 clears
    // its running byte and latches it (PHY-14), an idle floor included
    // (`setMinRotation`, the observation balloon's hover engines at 40%).
    // A stopped Engine takes no input (`Engine::handlePlayerInput`
    // `0x0823e5ef` writes zeros), which is the throttle channel's 0 here.
    vehicle.setInput?.('c_PIThrottle', 0);
    vehicle.state.throttle = 0;
    if ('engineRunning' in vehicle) vehicle.engineRunning = false;
    vehicle.integrate(dt);
  }
}

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
  const hull = world.occupiedDamageable(player.id);
  inputGate(hull, player.gate);
  // A dead crew member has no hands: a soldier whose Armor is gone takes no
  // part in the seat's input, whichever camera is drawn and whether or not
  // the page has yet seen to emptying the seat (`killOccupantInSeat`). The
  // hull may be whole -- a Nebelwerfer's own splash kills the man at it and
  // leaves the launcher -- and its trigger is his, not the gun's.
  const crewDead = !!player.armor?.destroyed;
  if (crewDead) {
    player.gate.blocked = true;
    player.gate.rotationalScale = 0;
  }
  if (occ.turret) occ.turret.inputScale = player.gate.rotationalScale;
  const activeRoot = occ.isActiveRoot();
  // `Engine+0x142` past the seat (`vehicle-instance.js` `#syncEngine` has
  // the seat half): `Armor::status` sends 0x14 on the crossing into critical
  // and 0x15 on destruction, with no player, so `PlayerControlObject::
  // handleMessage` hands them to every child, and `Engine::handleMessage`
  // (lnxded 0x0823e730) stops the engine and latches it against a restart
  // (`+0x143`); 0x13, the recovery, clears the latch and restarts it while
  // the PCO is occupied (ledger PHY-14, HP-13). The drives that read the
  // byte: every aircraft on the engine law (`Aircraft.engineLaw`: helicopters,
  // vectored airframes and fixed wings alike, so a critically damaged fighter
  // loses its engine), and both land drivetrains
  // (`GroundVehicle`/`TrackedVehicle` `landDrive`), whose revs the byte holds
  // at 0 (`Engine::handleUpdate` `0x0823e2e6`, TANK-12), so every EngineGrip
  // wheel asks for its contact speed back and a critical tank or jeep stops
  // where it is; and a ship's (`Ship.shipDrive`), whose screws then make no
  // thrust.
  if ((vehicle?.engineLaw || vehicle?.landDrive || vehicle?.shipDrive) && activeRoot) {
    vehicle.engineRunning = !(hull?.critical || hull?.destroyed);
  }
  if (activeRoot) syncCriticalLift(vehicle, hull);
  const inControl = activeRoot && !player.gate.blocked;
  // Exactly one entry for this tick: the buffer's oldest, else the page's
  // pending freshest, else the engine's zeroed idle word.
  const entry = consume(player);
  const input = entry.input;

  if (vehicle) {
    // His last word on each channel dies with him: a held key's value would
    // otherwise stand on the hull for as long as nobody else writes it.
    if (crewDead && activeRoot) {
      for (const channel of DEAD_HAND_CHANNELS) vehicle.setInput?.(channel, 0);
    }
    if (player.kind === 'air') {
      if (inControl) {
        // W/S is a held axis, for every aircraft: `addKeysToAxisMapping
        // c_PIThrottle IDKey_W IDKey_S` resolves through
        // `ControlMap::buttonsToAxis` (lnxded `0x083f2080`), which ramps to
        // +1 or -1 while a key is down and back to 0 when it is let go, at a
        // rise and fall time the `ControlMap` ctor seeds to 0.001 s
        // (`0x083f05e3`/`0x083f05ea`) and no shipped `.con` sets. The Engine's
        // own roll axis does the rest (`Aircraft.lawEngines`): under
        // `setAutomaticReset 1` it ramps to `input * maxRotation` and back
        // (GUN-2), and its clip holds a hover engine's released collective on
        // the idle floor (PHY-13) and takes a plane's S to its negative
        // minimum, reverse thrust (a Corsair's `-3000/5000`, an F-16's
        // `-500/3000`). Let go of W and the throttle springs back: there is no
        // latch in the game. `forwardKeys` is the page's raw pair: the pad's
        // Y is the stick's pitch, never the throttle. A key let go is written
        // back to 0 once, so the touch slider, which sets the channel itself,
        // is not zeroed under the player's thumb.
        const power = input.forwardKeys;
        if (vehicle.engineLaw) {
          if (power !== 0 || vehicle.keyedCollective) {
            vehicle.setInput('c_PIThrottle', Math.max(-1, Math.min(1, power)));
            vehicle.keyedCollective = power !== 0;
          }
        } else if (power !== 0) {
          vehicle.setInput('c_PIThrottle', Math.max(0, Math.min(1,
            vehicle.input('c_PIThrottle') + power * dt)));
        }
        // The rudder and the stick are the control map's own channels, this
        // tick's value straight onto the hull: a key is a step
        // (`ControlMap::buttonsToAxis`, 0.001 s rise and fall; world-input.js
        // has the read), the mouse a rate (mouse-input.js), the touch pad a
        // deflection. The part's own servo shapes the motion -- a rack's
        // `setAcceleration` ramp, a surface's `maxSpeed` -- and no spring of
        // the viewer's sits in front of it any more (it took a key 0.4 s to
        // reach full deflection, on top of the servo).
        //
        // The engine laws clip at the part: an `automaticReset` bundle ramps
        // to `input * maxRotation` and stops at its bounds (GUN-2), so every
        // airframe takes the value as it is, up to the wire's +-16: a
        // vectored one's racks clip themselves (`clipAngleStep`), and every
        // Wing and flap is servoed on a -1..1 deflection that `vehicle-base.js`
        // `advanceSurfaces` clips, after spending a `rememberExcessInput`
        // part's backlog: a mouse flick past full deflection on vanilla's
        // elevators carries over the ticks after it (MLK-16).
        player.stick.roll = input.roll;
        player.stick.pitch = input.pitch;
        vehicle.setInput('c_PIYaw', input.rudder);
        vehicle.setInput('c_PIRoll', input.roll);
        vehicle.setInput('c_PIPitch', input.pitch);
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
        // planes + float trim (Gato/Sub7C) all bind c_PIPitch, and so do two
        // Desert Combat land hulls: the Forklift's lift and forks and the
        // Ural5323's ramp. No vanilla land hull does. A land drive reads the
        // axis when its own rig takes it (`bindsPitch`).
        // The tick's value straight onto the hull, as the air branch takes
        // it: the arrows are a key pair, a step (`ControlMap::buttonsToAxis`,
        // MLK-10), the mobile pad a deflection, and the parts' own servos
        // move and stop at their bounds (`vehicle-base.js`
        // `advanceSurfaces`). W/S stays c_PIThrottle (ahead/astern) and never
        // drives the pitch.
        if (player.kind === 'ship' || bindsPitch(vehicle)) {
          player.stick.pitch = input.pitch;
          vehicle.setInput('c_PIPitch', input.pitch);
        }
        vehicle.setInput('c_PIFire', input.fire ? 1 : 0);
        vehicle.setInput('c_PIAltFire', input.altFire ? 1 : 0);
      }
    }
    // Once a tick, by the root seat's holder (or the first occupant of a
    // hull nobody drives): the drive is the hull's, not the seat's.
    //
    // A hull on the wreck list is stepped by `stepFallingWrecks` instead. The
    // list is the driver for a hull nobody flies, and a dead pilot whose
    // occupant entry is still standing (the player killed in his own plane)
    // would otherwise integrate it a second time in the same tick, at twice
    // the engine's rate.
    if (integrators.get(vehicle) === player && !world.falling?.has(vehicle)) {
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
    occ.turret.aim(entry.lookX, entry.lookY, inControl ? input.strafe : 0);
    // The seat's own levers (a stationary gun's round selector on W/S): his
    // keys, whichever seat he holds. A drivetrain's root seat has none here,
    // its drive steps them (`vehicle-occupancy.js` `rigFor`).
    const keyed = !player.gate.blocked;
    occ.turret.keys?.({
      c_PIThrottle: keyed ? input.forward : 0,
      c_PIYaw: keyed ? input.strafe : 0,
      c_PIPitch: keyed ? input.pitch : 0,
      c_PIRoll: keyed ? input.roll : 0,
    });
    const before = rigAngles(occ.turret);
    occ.turret.step(dt);
    // A part the rig swung takes its triangles with it (`WorldCollider.
    // syncRigParts`): a door's leaf, a barrier's pole, a gun's traverse on a
    // hull that never moves. A driven hull's are re-asked with its body too.
    if (rigAngles(occ.turret) !== before) syncRigCollision(world, occ);
  }

  // Kept unconditional for the same reason the page's copies are: a
  // vehicle's own weapon must stop the instant nobody is in the seat that
  // fires it, and gating the *value* passed to setFiring (not skipping the
  // call) is what turns it off the same tick the seat stops being active.
  for (const group of player.groups) {
    const state = world.fireStateFor(group.node);
    const pulled = !!(inControl && vehicle && vehicle.input(group.stats.input || 'c_PIFire') > 0);
    // The trigger before the step: a held pull the heat refuses restarts the
    // lockout (fire-state.js `trigger`, GUN-18).
    state.trigger(pulled);
    if (inControl) state.step(dt);
    world.guns?.setFiring(group, pulled && state.canFire);
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
    const group = player.manned.find(g => g.node === node);
    const trigger = node.userData?.fireArms?.input === 'c_PIAltFire'
      ? (input.altFire && !player.gate.blocked) : fire;
    state.trigger(!!group && trigger);
    state.step(dt);
    if (!group) continue;
    world.guns?.setFiring(group, trigger && state.canFire);
  }
}

/** A rig's angles summed, enough to tell whether a tick moved any of them. */
function rigAngles(rig) {
  let sum = 0;
  for (const axis of rig.axes ?? []) sum += axis.angle;
  for (const axis of rig.keyAxes ?? []) sum += axis.angle;
  if (rig.carriage) sum += rig.carriage.angle;
  return sum;
}

const rigOwners = new WeakMap();

/** Re-ask the swung parts of the hull `occ` sits in, where they stand now. */
function syncRigCollision(world, occ) {
  const collider = world.collider;
  const root = occ.root;
  if (!collider?.syncRigParts || !root) return;
  const statics = collider.statics;
  // The owner id is a walk of the index's owner list: once per hull and index.
  let cached = rigOwners.get(root);
  if (!cached || cached.statics !== statics) {
    cached = { statics, owner: statics?.ownerOf?.(root) ?? -1 };
    rigOwners.set(root, cached);
  }
  const owner = cached.owner;
  if (owner < 0) return;
  root.updateMatrixWorld(true);
  collider.syncRigParts(owner, root.userData?.cullRadius ?? 5);
}

/** The channels a dead crew member's hands leave at zero. */
const DEAD_HAND_CHANNELS = ['c_PIThrottle', 'c_PIYaw', 'c_PIRoll', 'c_PIPitch',
  'c_PIFire', 'c_PIAltFire'];

/** A land drive whose own rig takes `c_PIPitch` (DC's Forklift and Ural5323),
 *  read once off its servo table. */
function bindsPitch(vehicle) {
  if (vehicle._bindsPitch === undefined) {
    vehicle._bindsPitch = typeof vehicle.servoAxes === 'function'
      && [...vehicle.servoAxes().values()].some(spec => spec.input === 'c_PIPitch');
  }
  return vehicle._bindsPitch;
}
