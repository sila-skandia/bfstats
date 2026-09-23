import * as THREE from 'three';
import { findAllVehicleRoots, listEntryPoints, readWorldPose, pickNearest } from './seats.js';

/**
 * Walking up to a seat, getting in and getting out: the door list and the
 * scan, `enterVehicle`, and the exit poses. Split out of `local-player.js`.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `car`, `collider`, `currentRoot`, `drawWeapon`, `driveFwd`,
 * `getTouchHudText`, `holster`, `hud`, `HUD_FOOT`, `isTouchDevice`,
 * `leaveSeat`, `mannedActive`, `netSeatRow`, `netSendAction`, `occupancy`,
 * `optOnFoot`, `optPilot`, `placeCamera`, `releaseButtons`,
 * `resetMobileControls`, `seatHolder`, `setPilot`, `soldier`, `updateHud`,
 * `updateMobileControls`, `useLens`, `vehicleSpawnActive`, `world`.
 */
export function createVehicleEntry(page) {
  const vehicleEntry = {};

  // --- walking up to a seat ----------------------------------------------------
  //
  // Every assembled vehicle carries its `EntryPoint` nodes — meshless, placed
  // where a soldier walks in from, with `setEntryRadius` as their reach
  // (`extras.seat.entryRadius`, 2.3 m on a Willys) — and the PCO root carries
  // `setSoldierExitLocation` for the walk back out. Both are the game's own
  // data; the only invention here is the 4 m fallback radius for a mod entry
  // point that declares none.
  const ENTRY_RADIUS_FALLBACK = 4;
  const ENTRY_SCAN_PERIOD = 0.25;   // seconds between proximity sweeps on foot
  vehicleEntry.entryPoints = null;           // [{node, vehicle, control, radius}]
  vehicleEntry.nearEntry = null;             // the seat the HUD is currently offering
  vehicleEntry.entryScan = 0;
  /** The level went, and every door in it with it: the next scan re-indexes
   *  the new level's (`show()`, after the bots are spawned). */
  /** The door list is stale (a hull's spawn went live or dark); rebuilt on
   *  the next scan. */
  vehicleEntry.dropEntryPoints = () => { vehicleEntry.entryPoints = null; };
  vehicleEntry.forgetEntryPoints = () => {
    vehicleEntry.entryPoints = null;
    vehicleEntry.nearEntry = null;
  };

  /**
   * Index every walkable seat once per level — every `EntryPoint` of every
   * `PlayerControlObject` root in the scene, spawner-placed or not
   * (`findAllVehicleRoots`, `seats.js`), tagged with which of that vehicle's
   * seats it opens into (`listEntryPoints`). This is the whole of "make every
   * PlayerControlObject with an EntryPoint enterable": the Defgun, the AA guns
   * and the Brownings were level furniture `findVehicles` (spawner-scoped,
   * flight.js) never saw, and a passenger/gunner seat's own door was dropped by
   * the old control-tag filter this replaces.
   */
  function collectEntryPoints() {
    vehicleEntry.entryPoints = [];
    for (const vehicle of findAllVehicleRoots(page.currentRoot)) {
      if (!page.vehicleSpawnActive(vehicle)) continue;
      const control = vehicle.userData?.control || vehicle.name || 'vehicle';
      for (const entry of listEntryPoints(vehicle, ENTRY_RADIUS_FALLBACK)) {
        vehicleEntry.entryPoints.push({
          node: entry.node, vehicle, control,
          seatId: entry.seatId, radius: entry.radius,
        });
      }
    }
  }

  const entryWorld = new THREE.Vector3();

  /**
   * The closest entry point whose declared radius reaches the soldier.
   *
   * Not reproduced: SEAT-13/13b's team/hostility gates (`BFfindEntryPoint`'s
   * own team check, and `validateBFEntryPoint`'s separate component check) —
   * this page has exactly one soldier and no second team's vehicles ever
   * appear as hostile, so there is nothing here for either gate to reject.
   *
   * Round 3's second disclosed gap: `pickNearest` (`seats.js`), not a bare
   * `distance < best` compare, because more than one `EntryPoint` can sit at
   * the exact same world position — the Sherman's driver and hull-gunner
   * doors, M3A1's four passenger seats sharing one side door (confirmed
   * against the live Wake scene: the Sherman's pair differs by ~1.1e-13 m,
   * M3A1's four-way tie by exactly 0) — where a plain compare would let
   * accumulated floating-point noise in each seat's own transform chain decide
   * the winner instead of the level's own data. `entryPoints` is built by
   * `collectEntryPoints()` in `surveyVehicle`'s own declaration order (root
   * seat first, SEAT-22), so `pickNearest`'s "first within `TIE_EPSILON` wins"
   * rule seats the driver ahead of the gunner at a shared Sherman door, and the
   * lowest-numbered passenger PCO at M3A1's — the same seat order the number
   * keys already use, not an arbitrary pick.
   */
  function nearestEntry() {
    if (!vehicleEntry.entryPoints) collectEntryPoints();
    return pickNearest(vehicleEntry.entryPoints, entry => {
      if (page.seatHolder(entry.vehicle, entry.seatId)) return Infinity;
      // A wreck has no doors. The bots' candidate list skips a destroyed hull
      // (bot-units.js); the human's did not, and E seated him in a burning one.
      const owner = page.collider?.statics?.ownerOf(entry.vehicle) ?? -1;
      if (page.world?.vehicleDamage?.get(owner)?.destroyed) return Infinity;
      entry.node.getWorldPosition(entryWorld);
      const distance = Math.hypot(entryWorld.x - page.soldier.x,
        entryWorld.y - (page.soldier.y + 1), entryWorld.z - page.soldier.z);
      return distance <= entry.radius ? distance : Infinity;
    });
  }

  /**
   * Watch for a door within reach, a few times a second rather than every
   * frame, and offer it on the HUD. Runs from `onFoot`.
   */
  function scanForEntry(dt) {
    vehicleEntry.entryScan -= dt;
    if (vehicleEntry.entryScan > 0) return;
    vehicleEntry.entryScan = ENTRY_SCAN_PERIOD;
    const near = nearestEntry();
    if (near?.vehicle !== vehicleEntry.nearEntry?.vehicle) {
      page.hud.textContent = near
        ? page.isTouchDevice ? `ENTER ${near.control}` : `E — enter the ${near.control}`
        : page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    }
    vehicleEntry.nearEntry = near;
    page.updateMobileControls();
  }

  /**
   * From on foot into a seat. The soldier is suspended rather than torn down —
   * his weapon, magazines and flag selection all wait for the walk back out —
   * so only the presentation is packed away: the viewmodel, the crosshair, the
   * on-foot FOV.
   */
  function enterVehicle(entry) {
    page.holster();
    // A button held through the climb in must not arrive already pulling the
    // vehicle's trigger — nor, on the way back out, the soldier's.
    page.releaseButtons();
    // Not hidden here any more: `updateCrosshair` runs every frame and reads
    // the seat's own `setCrossHairType`, so a tank keeps its cross.
    page.useLens('seat');
    vehicleEntry.nearEntry = null;
    // Checked without an event on purpose: the change handler would tear the
    // waiting soldier down, and the checkbox is only being told the truth —
    // someone is in a vehicle.
    page.optPilot.checked = true;
    page.setPilot(true, entry.vehicle, entry.seatId);
    if (!page.occupancy) {
      // The seat refused (a null root; `pickVehicle`-less path). Back on foot
      // as if nothing happened. Every real `PlayerControlObject` root now
      // classifies to something (`seats.js`'s `classifyRoot` never returns
      // null for one), so this is defensive rather than a real refusal path
      // any of the vehicles this round targets can hit.
      page.useLens('foot');
      page.drawWeapon();
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    }
    page.resetMobileControls();
  }

  /**
   * Where the occupant steps out, in world space: the vehicle's own
   * `setSoldierExitLocation` when it declares one (the Willys puts its driver
   * 1.5 m off the left running board), else two metres to the vehicle's left.
   * The declared vector is in Refractor's frame — z forward — so its Z is
   * negated at this boundary, the same fix `rig` angles get.
   */
  function exitPose(vehicle) {
    const declared = vehicle.node.userData?.physics?.soldierExitLocation;
    const local = declared
      ? new THREE.Vector3(declared.position[0], declared.position[1],
        -declared.position[2])
      : new THREE.Vector3(-2, 0.5, 0);
    const position = local.applyQuaternion(vehicle.state.orientation)
      .add(vehicle.state.position);
    const fwd = page.driveFwd.set(0, 0, -1).applyQuaternion(vehicle.state.orientation);
    return {
      x: position.x, y: position.y, z: position.z,
      // The soldier's convention: forward is (sin yaw, 0, cos yaw). Stepping
      // out facing the way the vehicle faces reads right for both doors.
      yaw: Math.atan2(fwd.x, fwd.z),
    };
  }

  /**
   * E from a seat: back onto the ground beside it.
   *
   * No speed/altitude gate on purpose: SEAT-5/SEAT-8 (verify-r5.md, confirmed
   * in both the original and verifier passes) read `isAllowedToExit()` in full
   * and found a pure geometry/collision check with no call to anything speed-
   * or altitude-related — bailing out of a moving plane is genuine vanilla
   * behaviour, not a bug to guard against. A prior pass here gated on
   * `grounded || airspeed<3`, which the report contradicts directly; removed.
   * The real gate (SEAT-6/SEAT-9: a room check at `soldierExitLocation`, run
   * only when the template's `hasRestrictedExit` is set) is not implemented —
   * `exitPose`'s placement is trusted as-is, same as it already was on the
   * ground.
   *
   * What was missing was everything *after* stepping out of something flying.
   * `soldier.spawn()` ends in `settle()`, a 600 m probe to the floor, so a
   * bail-out at 300 m put the pilot on the sand under the plane. Above the
   * bail-out height below, the exit goes through `Soldier.bailOut` instead,
   * which places the body where the aircraft was, hands it the aircraft's own
   * velocity, and leaves `parachute.js` to run the fall (`viewer/parachute.js`
   * for the engine side; key 9 opens the canopy).
   */
  /** Metres above the ground past which stepping out is a bail-out, not a
   *  step down. The engine has no such number — it simply never teleports —
   *  and this exists only because `spawn()`'s floor probe is the viewer's
   *  normal exit. Half a metre under the free-fall state's own 10 m gate, so a
   *  door on a hangar roof is still a step and not a drop. */
  const BAIL_OUT_HEIGHT = 9.5;

  function exitVehicle() {
    const vehicle = page.aircraft || page.car;
    if (!vehicle) return;
    const exit = exitPose(vehicle);
    // Height above whatever the collider says is under the exit point, and the
    // hull's own velocity — both read before `leaveSeat` lets go of it.
    const groundAt = page.collider?.surfaceHeight ? page.collider.surfaceHeight(exit.x, exit.z) : NaN;
    const bailing = Number.isFinite(groundAt) && exit.y - groundAt > BAIL_OUT_HEIGHT;
    const hullVelocity = vehicle.state?.velocity;
    // The room's control channel: capture the seat row before the seat is
    // given back.
    const netSeat = page.occupancy ? page.netSeatRow('exit') : null;
    page.leaveSeat();
    if (netSeat) page.netSendAction(netSeat);
    page.optPilot.checked = false;
    if (page.optOnFoot.checked && page.soldier) {
      page.soldier.collider = page.collider;
      if (bailing) {
        page.soldier.bailOut(exit.x, exit.y, exit.z, exit.yaw,
          hullVelocity?.x ?? 0, hullVelocity?.y ?? 0, hullVelocity?.z ?? 0);
      } else {
        page.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
      }
      page.useLens('foot');
      page.drawWeapon();
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    } else {
      // Nobody was waiting in the seat — the pilot box was ticked from free
      // fly — so E hands back the free camera where the vehicle stopped.
      page.placeCamera();
      page.updateHud();
    }
    page.resetMobileControls();
  }

  const exitWorldPos = new THREE.Vector3();
  const exitWorldQuat = new THREE.Quaternion();
  const exitFwd = new THREE.Vector3();

  /**
   * `exitPose`'s twin for a seat with no `Vehicle` instance behind it: a bare
   * gun/seat root has no simulated `.state` to read at all, so this reads the
   * ROOT's own live world transform instead — `Object3D.matrixWorld`, not
   * `Vehicle.state`, which is the only thing a bare seat has. For a nested seat
   * of a vehicle that *does* have a drivetrain (the Sherman's hull gunner) that
   * transform is not a stale snapshot either: `drive()`/`pilot()` keep
   * integrating it every frame regardless of which seat is active (round 3's
   * first disclosed gap), so stepping out while the hull is still coasting
   * places the soldier at the tank's real current position, not wherever it
   * was the moment the turret seat was taken. The root's transform when the
   * exit node IS the root (a hull door), but the exit node's own transform
   * when it is a nested seat — a carrier AA gun's `soldierExitLocation` is in
   * the gun PCO's frame, not the hull's, and the hull origin sits at the
   * waterline.
   */
  function exitPoseManned(occ) {
    const exitNode = occ.exitLocationNode();
    const declared = exitNode?.userData?.physics?.soldierExitLocation;
    const local = declared
      ? new THREE.Vector3(declared.position[0], declared.position[1],
        -declared.position[2])
      : new THREE.Vector3(-2, 0.5, 0);
    // Use the exit node's own pose when it is a nested seat (e.g. a carrier
    // AA gun m metres above the hull), not the hull root's pose at the
    // waterline.  The root case stays as-is — a hull door offset is in the
    // root's frame by definition.
    const refNode = exitNode !== occ.root ? exitNode : occ.root;
    readWorldPose(refNode, exitWorldPos, exitWorldQuat);
    const position = local.applyQuaternion(exitWorldQuat).add(exitWorldPos);
    const fwd = exitFwd.set(0, 0, -1).applyQuaternion(exitWorldQuat);
    return {
      x: position.x, y: position.y, z: position.z,
      yaw: Math.atan2(fwd.x, fwd.z),
    };
  }

  /** E from a manned-only seat: a bare furniture gun, or a nested seat of a
   *  vehicle whose root seat you never drove this time. */
  function exitManned() {
    if (!page.occupancy) return;
    const exit = exitPoseManned(page.occupancy);
    const netSeat = page.netSeatRow('exit');
    page.leaveSeat();
    if (netSeat) page.netSendAction(netSeat);
    page.optPilot.checked = false;
    if (page.optOnFoot.checked && page.soldier) {
      page.soldier.collider = page.collider;
      page.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
      page.useLens('foot');
      page.drawWeapon();
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    } else {
      page.placeCamera();
      page.updateHud();
    }
    page.resetMobileControls();
  }

  function exitSeat() {
    if (!page.occupancy) return;
    if (!page.mannedActive() && (page.aircraft || page.car)) exitVehicle();
    else exitManned();
  }

  Object.assign(vehicleEntry, {
    collectEntryPoints,
    enterVehicle,
    exitManned,
    exitPose,
    exitPoseManned,
    exitSeat,
    exitVehicle,
    nearestEntry,
    scanForEntry,
  });
  return vehicleEntry;
}
