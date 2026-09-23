// The human: his seat of a hull's instance (enter, exit, the seat switch,
// the doors he walks up to), his view of it (the seat's `VehicleCamera`, the
// chase law, the cockpit swap, the pilot, driver, gunner and passenger
// cameras), his soldier on foot (the mode switch, his Armor, his death),
// his look (the mouse pumped once a frame into the world's per-tick input)
// and the render interpolation between world ticks his camera is drawn at.
// `localPlayer.occupancy` / `aircraft` / `car` look his seat up in the
// vehicle registry on every read (features/vehicle-instance-refactor).
// Lifted out of map.html (Part 2).

import * as THREE from 'three';
import { VehicleCamera, FixedSubject } from './flight.js';
import { seatViewModes, noseCamOffset } from './seat-view.js';
import { ServerSettings, readServerSettings } from './server-settings.js';
import { readWorldPose, AIM_INPUTS } from './seats.js';
import { MouseInput, profileFor } from './mouse-input.js';
import { CHASE_BEHIND, CHASE_AHEAD, boundingRadius, chaseTarget, chaseStep, chaseEye, chaseLawFor } from './chase-camera.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { calculateHitOctant } from './hud.js';
import { Armor } from './armor.js';
import { effectNameFor } from './crash-damage.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `buildSpawnFlags`, `camera`, `captured`, `clampMobileInput`,
 * `clearVehicleHud`, `collider`, `damageTables`, `deployActive`,
 * `deployTeamId`, `disposeHandWeapon`, `disposeSeatPose`, `effects`,
 * `EMPTY_KEYS`, `feedMobileTurretAim`, `feedVehicleHud`, `footView3p`,
 * `getTouchHudText`, `groundHeight`, `guns`, `handleSoldierFootstep`, `hud`,
 * `HUD_FLY`, `HUD_FOOT`, `hudBridge`, `hullCollisionMaterial`,
 * `isCollision`, `isTouchDevice`, `kbLockLeave`, `keys`, `loadSeatPose`,
 * `LOCAL_PLAYER`, `mobileJumpHeld`, `mobilePadAxis`, `mobilePadHeld`,
 * `mobilePadVector`, `mouseInput`, `netSeatRow`, `netSendAction`,
 * `netVehicleIdFor`, `noteOccupiedVehicle`, `optOnFoot`, `optPilot`,
 * `params`, `pickVehicle`, `playSoldierHurtSound`, `rebuildVehicleInterp`,
 * `resetCaptureUi`, `roomJoined`, `seatAltFire`, `seatFire`,
 * `showFlagPicker`, `showView`, `spawnAtFlag`, `syncFootView`,
 * `toggleFullMap`, `touchFlying`, `triggerHitIndicator`,
 * `updateMobileControls`, `updateSeatPoseVisibility`, `vehicleInput`,
 * `vehicles`, `warmSubtree`, `world`.
 */
export function createLocalPlayer(page) {
  const localPlayer = {
    /** The seat's view rig and the (seat, drive) it was built for. */
    view: null,
    viewFor: null,
    /** The subject `VehicleCamera` frames when the hull has no drivetrain. */
    gunSubject: null,
    get occupancy() { return page.vehicles.seatOf(page.LOCAL_PLAYER); },
    get aircraft() {
      const seat = page.vehicles.seatOf(page.LOCAL_PLAYER);
      const drive = seat?.instance.drive;
      return drive && (seat.rootKind === 'air' || seat.rootKind === 'ship') ? drive : null;
    },
    get car() {
      const seat = page.vehicles.seatOf(page.LOCAL_PLAYER);
      const drive = seat?.instance.drive;
      return drive && seat.rootKind !== 'air' && seat.rootKind !== 'ship' ? drive : null;
    },
    get vehicleGuns() { return page.vehicles.seatOf(page.LOCAL_PLAYER)?.groups.driven ?? []; },
    get mannedGuns() { return page.vehicles.seatOf(page.LOCAL_PLAYER)?.groups.manned ?? []; },
  };

  // The views C cycles from the ACTIVE SEAT -- one `VehicleCamera` per seat
  // taken (`localPlayer.view`), rebuilt on every mount and seat switch
  // (`buildSeatView`), never one per vehicle. Cockpit and nose are read from data (the seat's own Camera node
  // and its `OutsideHudOffset`; the look clamps are `CorsairCamera`'s own
  // setMin/setMaxRotation). Chase, front and fly-by are ours; the engine
  // declares that they exist (`CVMChase`, `CVMFrontChase`, `CVMFlyBy`) and never
  // where they sit. Which of them a seat reaches is `seat-view.js`'s answer from
  // the seat's `CVM*` words and the server switches. See flight.js. The subject
  // it frames when the hull has no drivetrain -- a Defgun, an AA gun, a tripod
  // Browning, a jeep nobody drives -- is `localPlayer.gunSubject`, built once per mount.

  // --- the server's view switches --------------------------------------------
  //
  // `game.serverExternalViews` and `game.serverAllowNoseCam` as the shipped
  // `ServerSettings.con` writes them (both 1), plus the page's own soldier
  // switch; see server-settings.js for what was read. Query string over
  // localStorage over defaults, and the side panel writes them live.
  function pageStorage() {
    try { return window.localStorage; } catch { return null; }
  }
  const serverSettings = new ServerSettings(
    readServerSettings(page.params, pageStorage()), pageStorage());
  for (const [id, key] of [
    ['srv-external-views', 'externalViews'],
    ['srv-nose-cam', 'allowNoseCam'],
    ['srv-soldier-views', 'soldierExternalViews'],
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = serverSettings[key];
    el.addEventListener('change', () => serverSettings.set(key, el.checked));
  }
  serverSettings.onChange(() => {
    refreshSeatViewModes();
    page.syncFootView();
  });

  /**
   * The active seat's own view rig. Called on every mount and every seat switch:
   * the inside view is THIS seat's Camera node (a gunner's rides his turret, a
   * passenger's sits where he sits), the external views hang off the root the
   * same for every seat, and the cycle is what this seat's Camera declares
   * under the server's switches. A root with no drivetrain -- the AA gun, the
   * Defgun, a Browning -- gets a `FixedSubject` for the hull-frame reads.
   *
   * The mode carries across a seat switch when the new seat reaches it (a
   * gunner who was outside stays outside as he climbs to the next gun);
   * otherwise the seat opens inside, which is `setViewMode`'s own opening.
   */
  function buildSeatView() {
    const seat = localPlayer.occupancy;
    if (!seat) {
      localPlayer.view = null;
      localPlayer.viewFor = null;
      return null;
    }
    let subject = localPlayer.aircraft || localPlayer.car;
    if (!subject) {
      if (!localPlayer.gunSubject || localPlayer.gunSubject.node !== seat.root) {
        localPlayer.gunSubject = new FixedSubject(seat.root);
      }
      subject = localPlayer.gunSubject;
    }
    const info = seat.seatInfo(seat.activeSeatId);
    const eyeNode = seat.cameraNode();
    const nose = noseCamOffset(info?.camera?.name, info?.camera?.userData?.cameraView);
    const modes = seatViewModes({
      cvm: info?.cameraViewModes, nose: !!nose, settings: serverSettings,
    });
    localPlayer.view = new VehicleCamera(subject, {
      groundHeight: page.groundHeight, eyeNode, modes, nose, mode: localPlayer.view?.mode,
    });
    localPlayer.viewFor = { seat, seatId: seat.seatId, drive: seat.drive };
    // The constructor sets the mode without the swap; the interior follows the
    // view from here, exactly as it does on a C press.
    subject.setFirstPerson(localPlayer.view.firstPerson);
    mountChaseLaw();
    page.updateSeatPoseVisibility();
    return localPlayer.view;
  }

  /** A server switch changed under a seated player: re-gate the cycle. */
  function refreshSeatViewModes() {
    if (!localPlayer.view || !localPlayer.occupancy) return;
    const seat = localPlayer.occupancy.seatInfo(localPlayer.occupancy.activeSeatId);
    localPlayer.view.setModes(seatViewModes({
      cvm: seat?.cameraViewModes, nose: !!localPlayer.view.nose, settings: serverSettings,
    }));
    page.updateSeatPoseVisibility();
  }

  /** C: the next view of whatever the player is sitting in, or standing as. */
  function cycleView() {
    if (page.optPilot.checked && localPlayer.view) page.showView(localPlayer.view.cycle());
    else if (page.optOnFoot.checked && localPlayer.soldier && page.footView3p.modes.length > 1) {
      page.showView(page.footView3p.cycle());
    }
  }

  // --- the external view's law (chase-camera.js) -----------------------------
  //
  // `chase-camera.js` is the arithmetic of `Camera::getTransformation` for
  // CVMChase / CVMFrontChase; this is the three.js half: read the drawn poses,
  // write the camera. It reads NODES, never `state`: `applyVehicleInterp` has
  // already slerped the root and every aim axis to this frame's alpha and walked
  // the world matrices, so the tower it sees is the one being drawn. Reading the
  // raw tick pose here is what would make the view judder at 30 Hz.
  //
  // Which frame supplies forward/up is the contested part - the W4-C brief says
  // the turret, both binaries say the hull - and `chaseLawFor` owns that answer.
  // `?chase=engine` is the law as read; `?chase=legacy` is the old framing.
  const CHASE_OPTION = page.params.get('chase');
  const chaseRig = {
    law: null,            // chaseLawFor()'s answer for the mounted root seat
    camera: null,         // the root seat's Camera node: anchor and look-at point
    root: null,
    radius: 0,
    rel: [0, 0, 0],
    target: [0, 0, 0],
    eye: [0, 0, 0],
    anchor: new THREE.Vector3(),
    eyeV: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    fwd: new THREE.Vector3(),
    up: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
  };
  const CHASE_WORLD_UP = new THREE.Vector3(0, 1, 0);
  // `getBoundingRadius` is cached on the engine's object (+0xb4); cached here per
  // root for the same reason, and so a wreck's smoke never inflates it.
  const chaseRadiusCache = new WeakMap();

  /** The plain tree `boundingRadius` walks, from a vehicle's node tree. */
  function chaseRadiusTree(node) {
    let radius = 0;
    if (node.isMesh && !page.isCollision(node) && node.geometry) {
      if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
      const sphere = node.geometry.boundingSphere;
      if (sphere) radius = sphere.center.length() + sphere.radius;
    }
    return {
      radius,
      offset: node.position.toArray(),
      children: node.children.filter(c => !page.isCollision(c)).map(chaseRadiusTree),
    };
  }

  /** Does `cameraNode` hang under one of the seat's mouse-aimed axes (GUN-7's
   *  shape)? Asked of the seat survey, not of a `TurretRig`: a rig is only built
   *  the first time its seat is manned, and a player who climbs in at the hull
   *  gunner's door reaches the driving seat later, by a seat switch. Peers
   *  included: `surveyVehicle` keeps every same-axis bundle as `axis.peers`
   *  (a destroyer's two turret pairs under one PCO), and a Camera parented
   *  under any peer rides the turret just as much as one under `axis.node`. */
  function cameraRidesTurret(cameraNode, seat, root) {
    if (!cameraNode || !seat?.axes) return false;
    const aimed = Object.values(seat.axes)
      .filter(axis => AIM_INPUTS.includes(axis?.spec?.input))
      .flatMap(axis => axis.peers?.length ? axis.peers : [axis.node]);
    for (let p = cameraNode.parent; p && p !== root; p = p.parent) {
      if (aimed.includes(p)) return true;
    }
    return false;
  }

  /** Decide the law for the seat just taken. Called from `buildSeatView`, after
   *  the seat's rig exists: the anchor is THIS seat's Camera (the engine's
   *  `camM`, which for a gunner rides the gun), the frame the root's or the
   *  Camera's parent per `chaseLawFor`, and the radius the root's. */
  function mountChaseLaw() {
    chaseRig.law = null;
    chaseRig.camera = localPlayer.occupancy?.cameraNode() || null;
    chaseRig.root = localPlayer.occupancy?.root || null;
    chaseRig.rel.fill(0);
    if (!localPlayer.view || !chaseRig.camera || !chaseRig.root) {
      if (localPlayer.view) localPlayer.view.externalLaw = null;
      return;
    }
    const rides = cameraRidesTurret(
      chaseRig.camera, localPlayer.occupancy.seatInfo(localPlayer.occupancy.activeSeatId), chaseRig.root);
    chaseRig.law = chaseLawFor(CHASE_OPTION, rides);
    if (chaseRig.law.law !== 'engine') { localPlayer.view.externalLaw = null; return; }
    if (!chaseRadiusCache.has(chaseRig.root)) {
      chaseRadiusCache.set(chaseRig.root, boundingRadius(chaseRadiusTree(chaseRig.root)));
    }
    chaseRig.radius = chaseRadiusCache.get(chaseRig.root);
    localPlayer.view.externalLaw = chaseExternalLaw;
  }

  /** `VehicleCamera.externalLaw`: true when it wrote `pose`. Every seat: the
   *  engine runs one `Camera::getTransformation` per seat Camera, and a
   *  gunner's anchor is his own Camera the world's turret step just moved. */
  function chaseExternalLaw(mode, dt, pose) {
    const rig = chaseRig;
    rig.camera.updateWorldMatrix(true, false);
    rig.camera.getWorldPosition(rig.anchor);
    if (mode !== 'chase' && mode !== 'front') {
      // The engine carries `rel` as (last output - Camera position) in every
      // mode: zero in the cockpit, the tripod's offset in fly-by.
      if (mode === 'flyby' && localPlayer.view.anchored) {
        rig.rel[0] = localPlayer.view.anchor.x - rig.anchor.x;
        rig.rel[1] = localPlayer.view.anchor.y - rig.anchor.y;
        rig.rel[2] = localPlayer.view.anchor.z - rig.anchor.z;
      } else {
        rig.rel.fill(0);
      }
      return false;
    }
    // forward/up: the Camera's parent (the brief's turret frame, a viewer
    // choice) or the vehicle root (what both binaries read).
    const frame = rig.law.frameFromAim ? rig.camera.parent : rig.root;
    frame.getWorldQuaternion(rig.quat);
    rig.fwd.set(0, 0, -1).applyQuaternion(rig.quat);
    rig.up.set(0, 1, 0).applyQuaternion(rig.quat);
    const sign = mode === 'front' ? CHASE_AHEAD : CHASE_BEHIND;
    chaseTarget(rig.fwd.toArray(), rig.up.toArray(), rig.radius, sign, rig.target);
    const v = localPlayer.view.vehicle.state.velocity;
    chaseStep(rig.rel, rig.target, [v.x, v.y, v.z], sign, dt);
    const ax = rig.anchor.x + rig.rel[0];
    const az = rig.anchor.z + rig.rel[2];
    chaseEye(rig.anchor.toArray(), rig.rel, page.groundHeight(ax, az), rig.eye);
    rig.eyeV.fromArray(rig.eye);
    pose.position.copy(rig.eyeV);
    rig.basis.lookAt(rig.eyeV, rig.anchor, CHASE_WORLD_UP);
    pose.quaternion.setFromRotationMatrix(rig.basis);
    return true;
  }

  /**
   * Occupy `node` (any `PlayerControlObject` root — a flyable/drivable one,
   * a `c_ETTank`, a bare gun/seat furniture root) at `seatId`, or the root seat
   * when `seatId` is omitted. One `VehicleOccupancy` (`seats.js`) now backs
   * every kind: `air`/`ground`/`tank` additionally get a real drivetrain built
   * on it (unchanged interface, so `drive()`/`pilot()`/`view` need nothing new
   * to keep working when the *root* seat is the one active), and `gun`/`seat`
   * roots — and any nested seat of any of the above — run on `occupancy` alone,
   * stepped by `manned()` (`mannedActive()` decides which, in `frame()`'s
   * dispatch).
   */
  // The two mode boxes are the mode. This module runs the transitions
  // (`setPilot`, `setOnFoot`); others that need the flag alone mark it here.
  /** Out of the seat, if in it: the box and the transition together. */
  function leavePilot() {
    if (!page.optPilot.checked) return;
    page.optPilot.checked = false;
    setPilot(false);
  }
  /** The flags without their transitions: the deploy flow arms on-foot before
   *  the soldier exists, and a wreck has already emptied the seat. */
  localPlayer.markPilot = on => { page.optPilot.checked = !!on; };
  localPlayer.markOnFoot = on => { page.optOnFoot.checked = !!on; };

  function setPilot(on, node = null, seatId = null) {
    if (on) {
      const current = localPlayer.occupancy;
      const target = node || current?.root || page.pickVehicle();
      if (!target) {
        page.optPilot.checked = false;
        return;
      }
      let seat;
      if (current && current.root === target) {
        // Re-entering the same vehicle at a specific door (its own EntryPoint
        // was in reach again) rather than wherever you last sat.
        seat = seatId ? page.vehicles.switchSeat(page.LOCAL_PLAYER, seatId) : current;
        if (seat && seatId) page.disposeSeatPose();
      } else {
        // A different vehicle than the one already held. Every exit path has
        // already given the old seat back; this is the defensive case.
        if (current) leaveSeat();
        // Root seat unless a specific `EntryPoint` said otherwise — walking
        // straight up to a Sherman's hull-gunner door seats you there directly,
        // never through the driver's seat first. The hull's instance builds the
        // drivetrain when its root seat is taken, adopts it into the body world,
        // thaws the node, collects this seat's guns, mounts the world's record
        // and claims the audio (`vehicle-instance.js`).
        seat = page.vehicles.enter(target, seatId, page.LOCAL_PLAYER);
      }
      // The seat is held by someone else: nothing happens, as a full seat in
      // the engine refuses the toggle. The caller reads `localPlayer.occupancy`.
      if (seat) mountLocalSeat(seat);
    } else if (localPlayer.occupancy) {
      // The seat's gone; tell the server so the others' replicas release it.
      const netSeat = page.netSeatRow('exit');
      leaveSeat({ reset: true });
      if (netSeat) page.netSendAction(netSeat);
    } else {
      page.world?.clearPlayerVehicle(page.LOCAL_PLAYER);
    }
    page.world?.resetStick(page.LOCAL_PLAYER);
    // Climbing in or out moves the drawn set and the camera both; re-collect
    // the nodes a tick poses and start a fresh pair (the render-interpolation
    // block, beside `footLookPending`).
    page.rebuildVehicleInterp();
    page.hud.textContent = page.isTouchDevice ? page.getTouchHudText()
      : localPlayer.occupancy
        ? (mannedActive() ? HUD_MANNED : localPlayer.car ? HUD_DRIVE : HUD_PILOT)
        : (page.optOnFoot.checked && localPlayer.soldier ? page.HUD_FOOT : page.HUD_FLY);
    page.updateMobileControls();
  }

  function mountLocalSeat(seat) {
    // After the seats exist: this seat's own view rig, and its law -- which
    // asks whether the seat's Camera rides one of its own aim axes.
    buildSeatView();
    // The instance's `collect` has just cloned this seat's flash materials and
    // marked the additive ones fresh `Material` instances the renderer has
    // never linked a program for. The level's warm-up compiled the originals
    // they were cloned from, not these; skip this and the clone's first real
    // draw is the mid-burst link stall rule 6 exists to prevent.
    page.warmSubtree(seat.root);
    page.feedVehicleHud();
    // Render the seated soldier (passenger seats only — driver seats have no
    // poseAnimation and skip the load). Awaited here so the cockpit frame the
    // player sees is never the first external one with an empty seat.
    if (seat.instance.drivable || seat.rootKind === 'gun') page.loadSeatPose();
    // The room's control channel: the server mounts this player in its own
    // world the same way (netcode.js MSG_ACTION; the vehicle id is the room
    // table's, matched by template + pose like the renderer's). The seat-dot
    // feed keeps the same id for its every-frame occupant read.
    page.noteOccupiedVehicle(seat.root);
    const netSeat = page.netSeatRow('enter');
    if (netSeat) page.netSendAction(netSeat);
  }

  function syncLocalSeat() {
    const seat = localPlayer.occupancy;
    const was = localPlayer.viewFor;
    if (!seat) return;
    if (was && was.seat === seat && was.seatId === seat.seatId && was.drive === seat.drive) return;
    buildSeatView();
    page.rebuildVehicleInterp();
    page.feedVehicleHud();
    page.updateMobileControls();
  }

  function leaveSeat({ reset = false } = {}) {
    const seat = localPlayer.occupancy;
    if (!seat) return;
    const drive = seat.drive;
    // The seated occupant goes with the seat, or stepping out of a jeep leaves
    // a soldier sitting in mid-air where the driver's seat had been.
    page.disposeSeatPose();
    if (drive) {
      if (reset && seat.instance.seats.size === 1) drive.reset();
      // `reset()` only restores the exterior when it owns the swap, and it no
      // longer does. Vacating the seat has to put the fuselage back explicitly
      // or the parked plane sits on the strip as an open cockpit tub -- and a
      // hull someone else keeps driving is seen from outside.
      localPlayer.view?.setMode('cockpit');
      drive.setFirstPerson(false);
    }
    page.vehicles.leave(page.LOCAL_PLAYER);
    page.clearVehicleHud();
    // The seat's view rig goes with the seat: the next mount builds its own.
    localPlayer.view = null;
    localPlayer.viewFor = null;
    localPlayer.gunSubject = null;
    page.world?.resetStick(page.LOCAL_PLAYER);
    page.rebuildVehicleInterp();
  }

  function passenger(dt) {
    if (!localPlayer.view) return;
    const pose = localPlayer.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
    page.guns.firstPerson = localPlayer.view.inside;
  }

  // `?turret=<n>` multiplies `countsPerPixel` -- how many DirectInput counts one
  // browser `movementX` pixel is worth.
  //
  // It used to scale every axis's declared `setMaxSpeed`, standing in for the
  // unread magnitude of `PlayerInput[c_PIMouseLookX/Y]`. That is read now
  // (`mouse-input.js`), so `setMaxSpeed` is used as the engine uses it and this
  // knob has moved to the one quantity still unproven: whether a browser pixel
  // is a mouse count. It is the same knob to a player -- turn it up and
  // everything aims faster -- but it now moves the soldier's head as well as a
  // turret, which is correct, because a mouse count is a mouse count.
  // `window.__turretScale()` reads and writes it live.
  if (page.params.has('turret')) {
    const n = Number(page.params.get('turret'));
    if (Number.isFinite(n) && n > 0) page.mouseInput.countsPerPixel = n;
  }

  const HUD_PILOT = 'W/S throttle · A/D rudder · arrows pitch and roll · LMB guns · RMB bombs · '
    + 'C view · mouse look around · R reset · 1-9 seats · E out on the ground · Esc';
  const HUD_DRIVE = 'W/S drive and brake · A/D steer · mouse aims · LMB main gun · RMB coax · C view · '
    + 'R reset · 1-9 seats · E get out · Esc';
  const HUD_MANNED = 'Mouse aims · LMB fires · C view · 1-9 seats · E get out · Esc';

  /**
   * Read the keyboard into the car and step the drive model.
   *
   * Round 3's first disclosed gap: this now runs every frame the vehicle
   * exists, not only while its own root/driver seat is the one active. Before,
   * `frame()`'s dispatch called this exclusively (never alongside `manned()`),
   * so switching to a nested seat — the Sherman's own hull gunner — stopped
   * `car.integrate(dt)` from ever being called again, freezing the hull's
   * momentum, suspension and gravity dead rather than leaving it to coast on
   * whatever throttle and steering the driver last set, the way it would if
   * the driver had simply let go of the wheel instead of climbing to a
   * different seat. Reading fresh keyboard input, firing this seat's own
   * `vehicleGuns` and moving the camera all stay exclusive to the frames the
   * driver's own root seat is actually the one occupied (`driving` below) —
   * otherwise nobody is holding this wheel right now, and `manned()` (not this
   * function) owns the camera and the trigger for whichever seat really is.
   */
  function drive(dt) {
    if (!localPlayer.car) return;
    // The world has already run this function's old sim half (world.js
    // #vehicleTick): the HP-15 gate (`driving` below reads its answer), the
    // keyboard into c_PIThrottle/c_PIYaw/c_PIFire/c_PIAltFire, `car.integrate`,
    // the rigs (`applyTurrets` after, never before — the world keeps the page's
    // own ordering comment), the turret's aim and step, the FireStates and the
    // `vehicleGuns` loop with the unconditional-off `setFiring` semantics. The
    // shell left here is the presentation half: the muzzle flash's 1P choice
    // and the camera, including the passenger-seat pose.
    const driving = localPlayer.occupancy.isActiveRoot() && !page.vehicleInput.blocked;
    page.guns.firstPerson = localPlayer.car.firstPerson;
    // A non-driving seat (the Willy's passenger, a Sherman's hull gunner) still
    // needs the camera — the VehicleCamera owns the C-cycle for every seat of a
    // flyable vehicle, not only the root. The drivetrain step above is gated on
    // `driving` for the same reason the throttle is: the passenger can't steer.
    // But the camera pose is not steering, and letting it lapse here leaves the
    // view pinned to wherever the passenger's `setFirstPerson` swap left it —
    // exactly the "stuck in the passenger POV" bug SEAT-9 (camera-modes.md §3)
    // describes. Manned guns keep their own camera in `manned()` below, so this
    // only matters for the passenger seat of a drivable vehicle.
    if (!driving && !mannedActive() && localPlayer.view) {
      const pose = localPlayer.view.update(dt);
      page.camera.position.copy(pose.position);
      page.camera.quaternion.copy(pose.quaternion);
      return;
    }
    if (!driving) return;
    // Runs after the world integrated, so an external camera hangs off this
    // frame's attitude rather than last frame's.
    const pose = localPlayer.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
    // The dashboard readout this used to write into `#ammo` (road speed, gear)
    // is dropped rather than folded into `#hud`: that line is a timed
    // announcement (`showView`, the spawn/flag text) that overwrites itself on
    // a 2.2s timer, and a per-tick dashboard string competing with that timer
    // would either starve the announcements or itself flicker unreadably.
    // `car.control`/`.gear` stay live on `__car` for a headless check that
    // wants them; the vehicle HUD panel due from a future seats.js track is the
    // real replacement.
  }
  const driveFwd = new THREE.Vector3();

  // --- manned guns and bare seats: the camera and trigger `drive()`/`pilot()`
  // stop owning once you are not the one driving --------------------------
  //
  // Any seat whose root is not a drivable `air`/`ground`/`tank` (a Defgun, the
  // AA guns, the Brownings — GUN-10, verify-r6.md's "manned gun" definition —
  // or a bare passenger/observer seat), and *every* nested seat regardless of
  // what its root is (the Sherman's own hull gunner, riding a vehicle whose own
  // physics `drive()` still steps every frame, coasting, per round 3's first
  // disclosed gap). `frame()`'s dispatch calls this *alongside* `pilot`/`drive`
  // exactly when `mannedActive()` says so — never instead of them any more:
  // the drivetrain's own momentum has to keep integrating even while `manned()`
  // holds the camera and the trigger for the seat you are actually sitting in.
  function mannedActive() {
    if (!localPlayer.occupancy || !localPlayer.occupancy.activeSeatId) return false;
    if (localPlayer.occupancy.isActiveRoot() && (localPlayer.aircraft || localPlayer.car)) return false;
    // A passenger seat ('seat' kind: no guns, no aim axes) is NOT a manned gun —
    // its camera belongs to VehicleCamera, not `manned()`, and forcing first-
    // person here locks the view to the passenger's eye node. Let drive()'s
    // non-driving branch claim the C-cycle instead (GUN-12).
    if (localPlayer.occupancy.seatKind(localPlayer.occupancy.activeSeatId) === 'seat') return false;
    return true;
  }

  const mannedCamPos = new THREE.Vector3();
  const mannedCamQuat = new THREE.Quaternion();

  /**
   * Step the active seat's presentation half. The world has already aimed and
   * stepped this seat's `TurretRig` (once per 30 Hz tick, the page's own
   * `stepTurret` loop — the engine's `TurretAxis.step` law, GUN-3), fired this
   * seat's FireArms and stepped their FireStates (world.js #vehicleTick); what
   * remains is the eye and the trigger's muzzle choice.
   *
   * The camera node never aims itself — GUN-5/6 (verify-r6.md), a gunner
   * Camera only ever rides the turret it is parented under — so the inside eye
   * is just wherever that hierarchy, freshly stepped in the world's tick, puts
   * it. The seat's `VehicleCamera` reads that same node for its inside view and
   * hangs the chase, front and fly-by off the root, the way the driver's does:
   * a gunner cycles C exactly as retail lets him, and the ten `CVMExternTrace`
   * artillery seats are the only ones whose Camera says otherwise.
   */
  function manned(dt) {
    if (localPlayer.view) {
      const pose = localPlayer.view.update(dt);
      page.camera.position.copy(pose.position);
      page.camera.quaternion.copy(pose.quaternion);
      // Inside: the 1P muzzle emitter, not the mesh-mounted third-person flash
      // that sits metres ahead of the eye. Outside: the reverse. "Inside" is
      // view mode 3, which the nose cam is too -- see `pilot()`.
      page.guns.firstPerson = localPlayer.view.inside;
    } else {
      readWorldPose(localPlayer.occupancy.cameraNode(), mannedCamPos, mannedCamQuat);
      page.camera.position.copy(mannedCamPos);
      page.camera.quaternion.copy(mannedCamQuat);
      page.guns.firstPerson = true;
    }
    // The world's occupied-vehicle tick has already written this seat's trigger
    // (`guns.setFiring`, gated on the HP-15 byte exactly as this function's old
    // loop did); the HUD feed for it happens in frame() after guns.advance.
  }

  /**
   * The number row: `c_PIMenuSelect1..9` in the game's own control maps
   * (SEAT-23/24, verify-r5.md) — digit N to the vehicle's Nth seat by spawn-
   * declaration order (`VehicleOccupancy.seatIdAt`; its own doc names the one
   * case this was checked against, and the one still open). A miss — an empty
   * position, or the seat already active — does nothing, same as the real
   * `map<int,PCO*>::find()` miss.
   */
  function switchSeat(position) {
    const seat = localPlayer.occupancy;
    if (!seat) return;
    const seatId = seat.seatIdAt(position);
    if (seatId === undefined || seatId === seat.activeSeatId) return;
    // Somebody sits there: the engine's own miss, nothing happens.
    if (seat.instance.holder(seatId) != null) return;
    // Discard the previous seat's soldier pose (if any) before loading the new
    // one — a driver→passenger switch on a Willy, or vice-versa.
    page.disposeSeatPose();
    // The hull does not move: the instance keeps its drive and body, and re-
    // scopes the seat's guns and the world's mount.
    page.vehicles.switchSeat(page.LOCAL_PLAYER, seatId);
    // This seat's own view rig: its Camera for the inside view, its `CVM*`
    // words for the cycle, the mode carried over where the seat reaches it.
    buildSeatView();
    // A different seat is a different camera, often in a different rig; snap
    // rather than sweep the view across the hull for a frame.
    page.rebuildVehicleInterp();
    page.warmSubtree(seat.root);
    page.feedVehicleHud();
    page.hud.textContent = page.isTouchDevice ? page.getTouchHudText()
      : mannedActive() ? HUD_MANNED : localPlayer.car ? HUD_DRIVE : HUD_PILOT;
    page.loadSeatPose();
    page.updateMobileControls();
    // The room's control channel: seat switches are rows, not input words.
    const netId = page.netVehicleIdFor(seat.root);
    if (page.roomJoined && netId != null) {
      page.netSendAction({ type: 'seat', vehicle: netId, seat: position, action: 'switch' });
    }
  }


  /** The sound and animation triggers `parachute.js` produced, newest last.
   *  Drained by `window.__parachute()`; capped so a long session cannot grow
   *  it without bound. Presentation only — the state machine keeps its own. */
  const parachuteLog = [];
  /** `window.__setDeploy(true)`: the ripcord, for a headless check that cannot
   *  hold a key down through Chromium's own focus rules. */
  localPlayer.debugDeployHeld = false;
  localPlayer.holdDeploy = on => (localPlayer.debugDeployHeld = !!on);

  // --- on foot ----------------------------------------------------------------
  //
  // All the arithmetic is in `soldier.js`, which imports nothing and is driven by
  // `tests/test_soldier.py` under node. This page only feeds it the keyboard and
  // takes the eye pose back, the same seam `flight.js` keeps between VehicleState
  // and the presentation layer.

  localPlayer.soldier = null;
  // The input object frame() built for this frame — onFootCamera's footFire
  // hands the deviation model the same c_PIThrottle/c_PIYaw values the world
  // consumed this tick (the engine's speed gates read the *input*, not the
  // achieved velocity).
  localPlayer.frameInputLast = null;
  localPlayer.prone = false;           // `c_PILie` is a toggle, not a hold
  const FLY_FOV = page.camera.fov;
  const FLY_NEAR = page.camera.near;
  // The near plane of a seat's own view. `Renderer_drawView` (0x004662c0) gives
  // the engine's render view a near plane of 0.1 m and nothing moves it
  // (`handweapon-view-and-deviation.md` section 3, quoted again at the near pass
  // in `frame()`); the free-fly camera's 0.5 is this page's own, chosen for a
  // camera that never sits inside anything.
  //
  // A vehicle's first-person interior is what needs it. `1P_Sherman_Gunner_M1`
  // — the box a tank commander looks out of — spans 0.089 m to 0.40 m ahead of
  // `ShermanCamera`, so at 0.5 every one of its 633 triangles fell inside the
  // near plane and the driver saw straight through his own tank: no frame, and
  // the gun barrel (0.57 m out, and so NOT clipped) smeared across the right of
  // the screen as a shapeless wedge. At 0.1 the frame draws and occludes the
  // barrel, which is what the wedge always was.
  const SEAT_NEAR = 0.1;
  // The soldier's near plane. Every on-foot entry has always set it with the
  // soldier FOV; named so the three lenses below read as the set they are.
  const FOOT_NEAR = 0.2;
  const LENS = {
    foot: [FOOT_FOV, FOOT_NEAR],
    seat: [FLY_FOV, SEAT_NEAR],
    fly: [FLY_FOV, FLY_NEAR],
  };
  /** The camera's lens for `kind`: 'foot', 'seat' or 'fly'. The one place
   *  outside the frame's own FOV easing that sets the projection. */
  localPlayer.useLens = kind => {
    const [fov, near] = LENS[kind];
    page.camera.fov = fov;
    page.camera.near = near;
    page.camera.updateProjectionMatrix();
  };
  /** A field of view alone, near plane kept (the weapon's zoom). */
  localPlayer.setFov = fov => {
    page.camera.fov = fov;
    page.camera.updateProjectionMatrix();
  };
  // GUN-6 (verify-r6.md): a manned gun's own Camera never sets its own FOV in
  // vanilla (`setVehicleFov` — no vanilla vehicle calls it) and the render
  // view's own default is 57.30 degrees vertical. `enterVehicle` sets
  // `camera.fov = FLY_FOV` (60) on the way in for every kind alike — fine for
  // an aircraft/car, whose `VehicleCamera` owns the view already, but a manned
  // gun never gets that camera at all, so nothing else was ever correcting it.
  const MANNED_GUN_FOV = 57.3;

  // --- the soldier's hit points, and the supply depots that refill them ------
  //
  // `verify-r4.md` (hit points, damage, healing) and `verify-r3.md` (supply
  // depots), both `## Corrected report`. `armor.js` and `supply.js` are
  // framework-free — see their own headers — so all the state tying them to
  // *this* soldier lives here, in the on-foot/spawn code this track owns.

  /** The on-foot soldier's own hit points, or null while none exists. Reset to
   *  full on every spawn/redeploy (`spawnAtFlag`, below — the one reset point,
   *  since `setOnFoot(true)` calls it too). */
  localPlayer.soldierArmor = null;

  /** `_shared/loadouts.json` ships `maxHitpoints: 30` for every vanilla-family
   *  kit (`verify-r4.md` R4-25's own cross-mod survey). Only the fallback for
   *  a maps tree extracted before that field existed — the same role
   *  `FALLBACK_PRIMARIES` plays for weapons below. */
  const SOLDIER_MAX_HP_FALLBACK = 30;


  /** Reused rather than reallocated every frame, the way `soldier.js`'s own
   *  `_tickInput` is: `onFoot` updates these fields in place and hands the
   *  same object to `supplyField.tick`/`canHeal`/`canRearm` every call.
   *  `refillAmmo` is wired once, beside `handWeapon`'s own declaration below —
   *  a closure over it, so it always acts on whatever is currently in hand. */
  const supplyTarget = { x: 0, y: 0, z: 0, team: 2, armor: null, refillAmmo: null };

  // Fall damage — the engine's own formula, in `fall-damage.js`.
  //
  // Ledger **HP-14**, `GameServer::handleCollisionLandOrWater` lnxded
  // `0x08154960`, delivered through the object-level `*0x15c` dispatch:
  // `BFSoldier::handleDamage` (0x08270980) -> `SimpleObject::handleDamage` ->
  // `Armor::damage`. HP-6's "the engine does not damage falling soldiers" was
  // refuted in 2026-09-18 and the hand-tuned R4-18 ramp it justified is long
  // gone; what this replaces is the *second* approximation, a single fitted
  // `FALL_KINETIC_HP = 10` calibrated against one measured Wake ledge fall.
  //
  // Three things the fitted version could not do, and the module now does:
  //
  //   - **The 8.0 m/s subtraction and its early return.** Nothing under
  //     8 m/s of arrival costs anything at all, and every term downstream uses
  //     the reduced speed. The fitted ramp had a 1.0 m tolerance instead, which
  //     is why it had to be eight times too gentle per metre to compensate.
  //   - **The two per-surface scalars are read, not fitted.** They are ordinary
  //     MaterialManager numbers and `_shared/damage.json` has carried them all
  //     along: `materialDamage = 30` and `damageMod(ground, 40) = 0.001` for
  //     every terrain material, so their product is 0.030. The old constant
  //     implied about 0.026, which is why it was close.
  //   - **Water, and the impact angle.** A fall into the sea is about 67x
  //     gentler and squares the cosine instead of cubing it.
  //
  // The height tracked is no longer the airborne peak. The engine's `F` is
  // `getLastCollisionHeight() - pos.y` — the height of the last *contact* — so a
  // jump straight up is billed 0 and a jump off a ledge is billed the ledge
  // rather than the apex above it. `SoldierBody` keeps that, and captures the
  // impact speed before `#settle` zeroes `velocity.y` to plant the feet;
  // `Soldier.step` latches the landing for the frame. All this page does is read
  // it and hand it to the formula.
  //
  // Measured on flat ground at g = -14.73, 30 HP, no kit damping: nothing below
  // 3.97 m, 1.2 HP at 4 m, 10.9 at 6 m, 21.7 at 7 m, lethal at 7.55 m.

  // The death cam: on the on-foot soldier's death (HP ≤ 0) the game holds the
  // camera floating above/by the corpse for a short beat before the deploy
  // screen opens (see hitpoints-and-damage.md §7 'Client: local-player death' —
  // `FUN_004933d0` → `SpawnScreenStuff::setVisible(true)`; the float is a brief
  // beat, not a decoded client animation). `soldierDead` latches until respawn
  // so a follow-up `__damage` on an already-dead body does not re-fire the flow.
  localPlayer.soldierDead = false;
  localPlayer.deathCamTimer = 0;    // seconds left floating over the corpse before openDeploy
  const DEATH_CAM_BEAT = 1.2;  // s — short float over the corpse before deploy shows
  const deathCamPos = new THREE.Vector3();

  // How the death cam is framed, and for how long. Two settings, because the two
  // deaths are showing different things: on foot the subject is the body that
  // just fell over, and the camera floats right above it; killed inside a
  // vehicle the subject is the **burning hull**, and retail's shot of it (owner's
  // capture, 2026-09-23: a plane crash, a tank kill) is a plain overhead — the
  // camera snaps to a point straight above the wreck and looks straight down,
  // pulled up far enough that the wreck and its smoke column sit small in the
  // middle of the frame, roughly the centre fifth. No pull-back along the
  // hull's facing, no low three-quarter angle. At the on-foot FOV the ground
  // spans ~1.1x the height, so 30 m puts a 7 m tank at about a fifth of the
  // frame. The pitch stops 2 deg short of the pole so the hull's own yaw still
  // decides which way is up on screen (`applyLook` is a `lookAt` with a world
  // up vector, degenerate at exactly -pi/2). The beats are not engine numbers
  // (the client's own death cam was never decoded past `FUN_004933d0` opening
  // the spawn screen); they are framing.   [HOUSE RULES]
  const DEATH_CAM = {
    foot:    { lift: 3.5, back: 0, pitch: -0.9,  beat: DEATH_CAM_BEAT },
    vehicle: { lift: 30,  back: 0, pitch: -Math.PI / 2 + 0.035, beat: 3.0 },
  };
  localPlayer.deathCamShot = DEATH_CAM.foot;
  /** What the death cam is framed on: `null` for the corpse's own eye — the
   *  on-foot death — or `{ x, y, z, yaw }`, the burning hull the player was in. */
  localPlayer.deathCamTarget = null;
  /** Reused so the death cam costs no allocation per frame. */
  const deathCamAt = { x: 0, y: 0, z: 0, yaw: 0 };

  // The body's life and the death cam are written here and nowhere else;
  // the modules that see a death or a spawn say which one happened.

  /** The body on foot has died: latch it and float the camera over it. */
  localPlayer.dieOnFoot = () => {
    localPlayer.soldierDead = true;
    localPlayer.deathCamShot = DEATH_CAM.foot;
    localPlayer.deathCamTarget = null;
    localPlayer.deathCamTimer = localPlayer.deathCamShot.beat;
  };
  /** Killed inside a hull: all of the body's HP goes (a body that climbed in
   *  at full health still has it, and the `soldierArmor.destroyed` latch must
   *  not fire the flow a second time), and the shot is of `target`, the
   *  wreck's `{ x, y, z, yaw }`. */
  localPlayer.dieInWreck = target => {
    if (!localPlayer.soldierArmor) localPlayer.soldierArmor = new Armor(SOLDIER_MAX_HP_FALLBACK);
    localPlayer.soldierArmor.applyDamage(localPlayer.soldierArmor.maxHitPoints);
    localPlayer.soldierDead = true;
    localPlayer.deathCamShot = DEATH_CAM.vehicle;
    localPlayer.deathCamTimer = localPlayer.deathCamShot.beat;
    localPlayer.deathCamTarget = target;
  };
  /** A fresh body on its feet with `armor`; the death cam lets go of it. */
  localPlayer.revive = armor => {
    localPlayer.prone = false;
    localPlayer.soldierArmor = armor;
    localPlayer.soldierDead = false;
    localPlayer.deathCamTimer = 0;
    localPlayer.deathCamShot = DEATH_CAM.foot;
    localPlayer.deathCamTarget = null;
  };
  /** The soldier is gone without a death (a team switch on the deploy screen). */
  localPlayer.discardSoldier = () => {
    localPlayer.soldier = null;
    localPlayer.soldierArmor = null;
    localPlayer.soldierDead = false;
    localPlayer.deathCamTimer = 0;
  };
  /** The level went, and the scene graph the soldier stood in with it. */
  localPlayer.forgetSoldier = () => { localPlayer.soldier = null; };
  /** The level went, and every hull's seats with it: the seat's view rig holds
   *  nodes of the old scene (`show()`, as it clears the vehicle registry). */
  localPlayer.forgetSeatViews = () => {
    localPlayer.view = null;
    localPlayer.viewFor = null;
    localPlayer.gunSubject = null;
  };
  /** Run the death cam's beat down; returns what is left. */
  localPlayer.runDeathCam = dt => (localPlayer.deathCamTimer -= dt);
  /** `c_PILie` is a toggle. */
  localPlayer.toggleProne = () => { localPlayer.prone = !localPlayer.prone; };
  localPlayer.standUp = () => { localPlayer.prone = false; };

  function setOnFoot(on) {
    if (on && page.optPilot.checked) {      // the two modes are exclusive
      page.optPilot.checked = false;
      setPilot(false);
    }
    // Either edge tears the old weapon down: entering rebuilds it against the
    // current level's gun index (a map switch has just cleared `guns.groups`),
    // leaving must not park a rifle on the free-fly camera.
    page.disposeHandWeapon();
    if (!on) page.resetCaptureUi();
    if (on) {
      // The soldier is the world's: `addPlayer` builds it the engine's way (a
      // fresh Soldier on the collider, spawned at the team's first flag) and
      // the page borrows the instance for the camera, exactly as the world's
      // records are the only ones the HUD reads.
      let player = page.world?.addPlayer(page.LOCAL_PLAYER, { team: page.deployTeamId });
      localPlayer.soldier = player?.soldier ?? null;
      if (!page.buildSpawnFlags() || !page.spawnAtFlag()) {
        // A level with no control point that owns a spawn group has nowhere to
        // put a soldier; say so rather than dropping him at the origin.
        page.world.removePlayer(page.LOCAL_PLAYER);
        localPlayer.soldier = null;
        page.optOnFoot.checked = false;
        page.showFlagPicker(false);
        page.hud.textContent = 'this level declares no flag with soldier spawns';
        return;
      }
      // The world's own FOV (`renderer.fieldOfView 1`, not `set1pFov` — the
      // arms rig's near pass picks its own, see frame()), and a near plane
      // that clears the capsule so a wall you are pressed against is drawn
      // rather than clipped through.
      localPlayer.useLens('foot');
      page.showFlagPicker(true);
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    } else {
      // The deploy screen cannot outlive the mode it selects for: the pilot
      // checkbox's exclusivity and the on-foot box both land here with the
      // overlay possibly still up.
      if (page.deployActive()) page.toggleFullMap(false);
      // The soldier was the world's record; the world stops stepping it (a
      // ghost left in the players map would keep walking on its last input).
      page.world.removePlayer(page.LOCAL_PLAYER);
      localPlayer.soldier = null;
      // The soldier's own HP is meaningless off-foot; drop it and the icons
      // that read it rather than leave a stale number for the next spawn's
      // first frame to flash.
      localPlayer.soldierArmor = null;
      delete page.hudBridge.vars['Soldier/SoldierHitPoints'];
      delete page.hudBridge.vars['Soldier/SoldierMaxHitPoints'];
      delete page.hudBridge.vars['ShowHealIcon'];
      delete page.hudBridge.vars['ShowReloadIcon'];
      delete page.hudBridge.vars['ShowFlagIcon'];
      page.showFlagPicker(false);
      localPlayer.useLens('fly');
      // `getTouchHudText()`, not the `HUD_TOUCH` this file once believed in —
      // that name was never declared, and reading it would throw on a phone.
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FLY;
      // The fullscreen `?kblock` took for on-foot play goes with it.
      page.kbLockLeave();
    }
    page.updateMobileControls();
  }


  function applyDamageToPlayer(damage, attackerPos = null, attackerTeam = null) {
    if (!localPlayer.soldierArmor || localPlayer.soldierDead) return;
    localPlayer.soldierArmor.applyDamage(damage);

    // If in a vehicle or piloting, vehicle damage handles it -- no on-foot grunts or hit arcs
    if (page.optPilot.checked || localPlayer.occupancy) return;

    const isFriendlyFire = attackerTeam != null && attackerTeam === page.deployTeamId;
    page.playSoldierHurtSound(isFriendlyFire);

    let dir = 1;
    if (attackerPos && localPlayer.soldier) {
      const dx = attackerPos.x - localPlayer.soldier.x;
      const dz = attackerPos.z - localPlayer.soldier.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.01) {
        const fwdX = Math.sin(localPlayer.soldier.yaw);
        const fwdZ = Math.cos(localPlayer.soldier.yaw);
        const rightX = Math.cos(localPlayer.soldier.yaw);
        const rightZ = -Math.sin(localPlayer.soldier.yaw);
        const forwardDot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
        const rightDot = (dx / dist) * rightX + (dz / dist) * rightZ;
        dir = calculateHitOctant(forwardDot, rightDot);
      }
    }
    page.triggerHitIndicator(dir, damage / (localPlayer.soldierArmor.maxHitPoints || 100));
  }

  // The stick spring itself lives in world.js next to the aircraft path that
  // spends it (STICK_RATE / STICK_RETURN, moved verbatim); the page's resets
  // below delegate to `world.resetStick`.

  /**
   * Read the keyboard into the aircraft and step the flight model.
   *
   * Round 3's first disclosed gap, `drive()`'s own twin: the world's
   * occupied-vehicle step runs every tick the aircraft exists, not only while
   * its own root/pilot seat is the one active, so a nested seat of a flyable
   * root (a rear-gunner position, once one is enterable) cannot stop the
   * airframe's own momentum and aerodynamics from integrating. Reading fresh
   * stick/rudder/throttle input and moving the camera stay exclusive to the
   * ticks the pilot's own root seat is actually the one occupied (`flying`
   * below).
   */
  function pilot(dt) {
    if (!localPlayer.aircraft) return;
    // The world has already run this function's old sim half (world.js
    // #vehicleTick) with its own copy of every rule and comment above: the
    // HP-15 gate is read and `driving`/`flying` below reads its answer; the
    // throttle latch, the `axisToward` rudder and stick spring (STICK_RATE /
    // STICK_RETURN now live beside it in world.js, unchanged), the triggers,
    // `aircraft.integrate`, `occupancy.applyTurrets`, the wreck-safe pump/aim
    // of the turret (the look stage is pumped once a frame in frame(), the rig
    // is aimed and stepped once per world tick — the page's own per-tick
    // `stepTurret` loop), and the `vehicleGuns` loop with the unconditional-off
    // `setFiring` semantics. The shell here is the presentation half.
    const flying = localPlayer.occupancy.isActiveRoot() && !page.vehicleInput.blocked;
    // The flash's 1P/3P choice is the engine's view mode 3, not whether the
    // cockpit interior is drawn: the nose cam is mode 3 with the interior off,
    // and retail plays the small `em_1P_*` sprite there. Keyed off the interior,
    // the nose cam got the third-person `em_MuzzHeavy` mesh -- a 1.76 m cone
    // ramped toward 9.4x, parked on cowl guns 1.9 m behind the eye, so a held
    // burst (12 rps against a 0.07 s life) was one static shape across the view.
    page.guns.firstPerson = localPlayer.view ? localPlayer.view.inside : localPlayer.aircraft.firstPerson;
    // A non-flying seat with no gun of its own (a transport's passenger) still
    // needs its camera moved, exactly as `drive()`'s passenger branch does.
    if (!flying && !mannedActive() && localPlayer.view) {
      const pose = localPlayer.view.update(dt);
      page.camera.position.copy(pose.position);
      page.camera.quaternion.copy(pose.quaternion);
      return;
    }
    if (!flying) return;
    // The view rig owns all four modes and their smoothing; this just takes the
    // pose. It runs after the world integrated, so an external camera hangs off
    // this frame's attitude rather than last frame's — at 55 m/s that is a metre
    // of lag, and on a chase camera it reads as the aircraft sliding around
    // inside the frame.
    const pose = localPlayer.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
  }


  /** This frame's input word and look pair for the local player: seated,
   *  on foot, or nothing (the free camera). The keyboard and the mouse never
   *  leave the page; this folds them into the engine's PlayerInput, named by
   *  action. */
  localPlayer.sampleInput = (seated, onFoot, lookTicks, dt) => {
    let input = null;
    let look = null;
    if (seated) {
      // The pad's deflection must land in the device stage BEFORE the pump
      // turns the counts into an axis, or this frame's pad aim arrives a
      // frame late (the page's original feed-then-pump order).
      page.feedMobileTurretAim(dt);
      localPlayer.pumpLook(lookTicks);
      const held = page.captured ? page.keys : page.EMPTY_KEYS;
      // The engine's PlayerInput, named by action: the same keys, mouse
      // latches and mobile pad this page has always folded. `forwardKeys` and
      // `rudder` are the raw W/S and A/D pairs the aircraft's stick wants —
      // ground vehicles steer and throttle with the pad folded in
      // (`forward`/`strafe`), while the plane's roll and pitch arrive from the
      // pad separately.
      input = {
        forward: page.clampMobileInput(
          ((held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0))
          + page.mobilePadAxis('y')),
        forwardKeys: (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0),
        strafe: page.clampMobileInput(
          ((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0))
          + page.mobilePadAxis('x')),
        rudder: (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0),
        fire: held.has('Space') || page.seatFire,
        altFire: page.seatAltFire,
        roll: page.mobilePadHeld ? page.mobilePadVector.x
          : (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0),
        pitch: page.mobilePadHeld ? page.mobilePadVector.y
          : (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0),
        pad: page.mobilePadHeld,
      };
      look = { x: localPlayer.mouseInput.x, y: localPlayer.mouseInput.y };
    } else if (onFoot) {
      localPlayer.pumpLook(lookTicks);
      const held = page.captured ? page.keys : page.EMPTY_KEYS;
      // Hoisted so footFire can hand the deviation model the same
      // c_PIThrottle / c_PIYaw values the body integrates — the engine's speed
      // gates read the *input*, not the achieved velocity.
      input = {
        forward: page.clampMobileInput(
          ((held.has('KeyW') || page.touchFlying ? 1 : 0) - (held.has('KeyS') ? 1 : 0))
          + page.mobilePadAxis('y')),
        strafe: page.clampMobileInput(
          ((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0))
          + page.mobilePadAxis('x')),
        walk: held.has('ShiftLeft') || held.has('ShiftRight'),
        crouch: held.has('ControlLeft') || held.has('ControlRight'),
        prone: localPlayer.prone,
        jump: held.has('Space') || page.mobileJumpHeld,
        // `c_PIMenuSelect9`, input bit 22 -> TemplateMessage 18 ->
        // `BFSoldier::setIsParachuting(true)`. It is the kit's ninth item slot
        // and the engine gives it a second job on a falling soldier; see
        // `parachute.js`. Both the digit row and the numpad, because a bail-out
        // is a two-second window. On a touch device the JUMP button doubles as
        // the ripcord while the state machine says you are falling — a jump is
        // worth nothing in mid-air, and a bail-out is no time to hunt for a
        // control that would otherwise have to be added to the pad.
        deploy: held.has('Digit9') || held.has('Numpad9') || localPlayer.debugDeployHeld
          || (page.mobileJumpHeld && localPlayer.soldier?.parachuteState === 'falling'),
        dead: localPlayer.soldierDead,
      };
      // A dead body holds still: when `soldierDead` latches (death cam active)
      // zero the steering/jump input so the corpse does not keep walking.
      if (localPlayer.soldierDead) {
        input.forward = input.strafe = 0;
        input.jump = false;
        input.crouch = input.prone = false;
      }
      look = localPlayer.footLookPair();
    }
    return { input, look };
  };

  /** The soldier's own event queues, drained once a frame. */
  localPlayer.drainSoldierEvents = () => {
    // Bail-out triggers for the frame. `parachute.js` names each one by the
    // engine's own sound trigger (`c_SstFallingHigh`, `c_SstOpenParachute`,
    // `c_SstParachuteLand`) and animation state; nothing plays them yet — the
    // samples are not in the published `_shared/sounds` tree — so this keeps
    // them where a check and a future audio stage can both read them.
    if (localPlayer.soldier?.parachuteEvents.length) {
      for (const event of localPlayer.soldier.drainParachuteEvents()) localPlayer.parachuteLog.push(event);
      if (localPlayer.parachuteLog.length > 64) localPlayer.parachuteLog.splice(0, localPlayer.parachuteLog.length - 64);
    }
    if (localPlayer.soldier?.footstepEvents.length) {
      for (const step of localPlayer.soldier.drainFootstepEvents()) page.handleSoldierFootstep(step);
    }
  };

  /** The seated player's cameras and the rest of the seat's presentation. */
  localPlayer.seatedCamera = dt => {
    // Round 3's first disclosed gap: the occupied vehicle's own drivetrain
    // physics steps every tick it exists, no matter which of its seats is
    // actually active — the world's occupied-vehicle step runs for the whole
    // time the player is mounted, so a nested seat (the Sherman's hull
    // gunner) leaves the hull coasting on its existing momentum rather than
    // freezing it. A bare gun/seat root has no drivetrain either way —
    // `aircraft`/`car` both stay null for one — so neither camera call does
    // anything for it.
    if (localPlayer.aircraft) localPlayer.pilot(dt);
    else if (localPlayer.car) localPlayer.drive(dt);
    else if (!localPlayer.mannedActive()) localPlayer.passenger(dt);
    // Beaching groan: when the ship's keel first touches the seabed, play the
    // collision effect for the seabed's material against the hull's — the
    // same `effects[attGroup][defGroup]` cell `onCrashDamage` reads
    // (`crash-damage.js` `effectNameFor`), attacker = terrain under the keel,
    // victim = the hull's own collision material. Fires regardless of the
    // damage threshold — the real game sounds every ground contact even when
    // the speed is too low to score damage — and bills nothing (W9-A:
    // beaching costs no hit points). Single groan on the beach frame only;
    // the script's layers are one-shots, so a grind loop while sliding would
    // need new machinery — not built here. No `speed`: the picture's `speed`
    // is the emitter clock, and `EngineAudio` has no `Effect::Speed` channel
    // (an `extern` source it never feeds), so the scrape plays at its
    // authored level with `beachSpeed` as the gate, not the gain.
    if (localPlayer.aircraft?.beachedThisTick && localPlayer.aircraft.beachSpeed > 0.5) {
      const p = localPlayer.aircraft.state.position;
      const terrainId = page.collider?.heightfield?.material
        ? page.collider.heightfield.material(p.x, p.z) : 0;
      const hullId = page.hullCollisionMaterial(localPlayer.aircraft.node);
      const effect = effectNameFor(page.damageTables, terrainId, hullId);
      if (effect) page.effects.play(effect, {
        position: [p.x, p.y, p.z],
        normal: [0, 1, 0],
      });
    }
    if (localPlayer.mannedActive()) {
      // A bare gun/seat root, or a nested seat of a vehicle whose own root
      // `pilot`/`drive` just took its physics step above — the camera and
      // the trigger are `manned()`'s alone from here, checked after so the
      // two paths never both claim the camera the same frame.
      //
      // FOV correction lives here, not a one-time set on entry: switching seats
      // moves between a manned gun and a drivetrain root without ever calling
      // `enterVehicle` again, and neither `pilot()`/`drive()` nor `VehicleCamera`
      // (outside this track) touch `camera.fov` at all, so whichever mode ran
      // last otherwise leaves its FOV behind for the next one. Guarded on an
      // actual change so a held seat costs one float compare, not an
      // `updateProjectionMatrix()`, every frame.
      // Inside the gun's own FOV; an external view of the same seat is the
      // world's, the same as the driver's chase.
      const wantFov = localPlayer.view && !localPlayer.view.inside ? localPlayer.FLY_FOV : localPlayer.MANNED_GUN_FOV;
      if (page.camera.fov !== wantFov) {
        page.camera.fov = wantFov;
        page.camera.updateProjectionMatrix();
      }
      localPlayer.manned(dt);
    } else if (page.camera.fov !== localPlayer.FLY_FOV) {
      page.camera.fov = localPlayer.FLY_FOV;
      page.camera.updateProjectionMatrix();
    }
  };

  Object.assign(localPlayer, {
    CHASE_OPTION,
    DEATH_CAM,
    FLY_FOV,
    HUD_DRIVE,
    HUD_PILOT,
    MANNED_GUN_FOV,
    SOLDIER_MAX_HP_FALLBACK,
    applyDamageToPlayer,
    chaseRig,
    cycleView,
    deathCamAt,
    deathCamPos,
    drive,
    driveFwd,
    leavePilot,
    leaveSeat,
    manned,
    mannedActive,
    parachuteLog,
    passenger,
    pilot,
    serverSettings,
    setOnFoot,
    setPilot,
    supplyTarget,
    switchSeat,
    syncLocalSeat,
  });
  return localPlayer;
}
