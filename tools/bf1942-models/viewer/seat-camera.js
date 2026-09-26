import * as THREE from 'three';
import { VehicleCamera, FixedSubject } from './vehicle-camera.js';
import { seatViewModes, noseCamOffset } from './seat-view.js';
import { ServerSettings, readServerSettings } from './server-settings.js';
import { readWorldPose, AIM_INPUTS } from './seats.js';
import { CHASE_BEHIND, CHASE_AHEAD, boundingRadius, chaseTarget, chaseStep, chaseEye, chaseLawFor } from './chase-camera.js';
import { effectNameFor } from './crash-damage.js';

/**
 * The seated player's cameras: the seat's view rig and the C cycle, the
 * server's view switches, the chase law, and the pilot, driver, passenger and
 * manned-gun cameras. Split out of `local-player.js`.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `camera`, `car`, `collider`, `damageTables`, `effects`,
 * `FLY_FOV`, `footView3p`, `groundHeight`, `guns`, `hullCollisionMaterial`,
 * `isCollision`, `MANNED_GUN_FOV`, `mouseInput`, `occupancy`, `optOnFoot`,
 * `optPilot`, `params`, `soldier`, `stepMouseLookKey`,
 * `updateSeatPoseVisibility`, `vehicleInput`.
 */
export function createSeatCamera(page) {
  const seatCamera = {};

  // The views C cycles from the ACTIVE SEAT -- one `VehicleCamera` per seat
  // taken (`seatCamera.view`), rebuilt on every mount and seat switch
  // (`buildSeatView`), never one per vehicle. Cockpit and nose are read from data (the seat's own Camera node
  // and its `OutsideHudOffset`; the look clamps are `CorsairCamera`'s own
  // setMin/setMaxRotation). Chase, front and fly-by are ours; the engine
  // declares that they exist (`CVMChase`, `CVMFrontChase`, `CVMFlyBy`) and never
  // where they sit. Which of them a seat reaches is `seat-view.js`'s answer from
  // the seat's `CVM*` words and the server switches. See flight.js. The subject
  // it frames when the hull has no drivetrain -- a Defgun, an AA gun, a tripod
  // Browning, a jeep nobody drives -- is `seatCamera.gunSubject`, built once per mount.

  /** The seat's view rig and the (seat, drive) it was built for. */
  seatCamera.view = null;
  seatCamera.viewFor = null;
  /** The subject `VehicleCamera` frames when the hull has no drivetrain. */
  seatCamera.gunSubject = null;
  /** The seat's view rig goes with the seat (the next mount builds its own),
   *  and with the level (it holds nodes of the old scene). */
  seatCamera.forgetSeatViews = () => {
    seatCamera.view = null;
    seatCamera.viewFor = null;
    seatCamera.gunSubject = null;
  };

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
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = serverSettings[key];
    el.addEventListener('change', () => serverSettings.set(key, el.checked));
  }
  // Both of these gate a SEAT's cycle. A soldier on foot has no external view
  // to re-gate: the page dropped the third switch that used to widen him
  // (2026-09-26, `features/viewer-foot-first-person/README.md`).
  serverSettings.onChange(refreshSeatViewModes);

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
    const seat = page.occupancy;
    if (!seat) {
      seatCamera.view = null;
      seatCamera.viewFor = null;
      return null;
    }
    let subject = page.aircraft || page.car;
    if (!subject) {
      if (!seatCamera.gunSubject || seatCamera.gunSubject.node !== seat.root) {
        seatCamera.gunSubject = new FixedSubject(seat.root);
      }
      subject = seatCamera.gunSubject;
    }
    const info = seat.seatInfo(seat.activeSeatId);
    const eyeNode = seat.cameraNode();
    const nose = noseCamOffset(info?.camera?.name, info?.camera?.userData?.cameraView);
    const modes = seatViewModes({
      cvm: info?.cameraViewModes, nose: !!nose, settings: serverSettings,
    });
    seatCamera.view = new VehicleCamera(subject, {
      groundHeight: page.groundHeight, eyeNode, modes, nose, mode: seatCamera.view?.mode,
    });
    seatCamera.viewFor = { seat, seatId: seat.seatId, drive: seat.drive };
    // The constructor sets the mode without the swap; the interior follows the
    // view from here, exactly as it does on a C press.
    subject.setFirstPerson(seatCamera.view.firstPerson);
    mountChaseLaw();
    page.updateSeatPoseVisibility();
    return seatCamera.view;
  }

  /** A server switch changed under a seated player: re-gate the cycle. */
  function refreshSeatViewModes() {
    if (!seatCamera.view || !page.occupancy) return;
    const seat = page.occupancy.seatInfo(page.occupancy.activeSeatId);
    seatCamera.view.setModes(seatViewModes({
      cvm: seat?.cameraViewModes, nose: !!seatCamera.view.nose, settings: serverSettings,
    }));
    page.updateSeatPoseVisibility();
  }

  /** C: the next view of whatever the player is sitting in, or standing as. */
  function cycleView() {
    if (page.optPilot.checked && seatCamera.view) seatCamera.view.cycle();
    else if (page.optOnFoot.checked && page.soldier && page.footView3p.modes.length > 1) {
      page.footView3p.cycle();
    }
    // Seat poses only draw in external views, so every mode change re-gates
    // them: hidden in the cockpit (CVMInside), where the player looks out
    // from the pilot's own eyes rather than at the seat.
    page.updateSeatPoseVisibility();
  }

  /** F9-F12, the common map's `c_PICameraMode1..4` — INSIDE, CHASE REAR,
   *  CHASE FRONT and FLY BY on the options screen: straight to that view
   *  rather than round the C cycle. A view the seat or the server does not
   *  allow is refused (the cycle's own gate). INSIDE pressed again inside a
   *  cockpit goes to the nose cam where the seat has one: the retail key is
   *  one "inside" key for both first-person views (unverified in the binary;
   *  see features/viewer-profile-controls §7). On foot the soldier's own
   *  cycle gates it — first person, and chase/front where it allows them. */
  const SEAT_VIEW_FOR = { 1: 'cockpit', 2: 'chase', 3: 'front', 4: 'flyby' };
  const FOOT_VIEW_FOR = { 1: 'inside', 2: 'chase', 3: 'front', 4: 'flyby' };
  function cameraMode(n) {
    if (page.optPilot.checked && seatCamera.view) {
      const view = seatCamera.view;
      let want = SEAT_VIEW_FOR[n];
      if (n === 1 && view.mode === 'cockpit' && view.modes.includes('nose')) want = 'nose';
      if (!want || !view.modes.includes(want)) return;
      view.setMode(want);
      page.updateSeatPoseVisibility();
    } else if (page.optOnFoot.checked && page.soldier) {
      const want = FOOT_VIEW_FOR[n];
      const was = page.footView3p.mode;
      const now = page.footView3p.setMode(want);
      if (now !== was) page.updateSeatPoseVisibility();
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
    chaseRig.camera = page.occupancy?.cameraNode() || null;
    chaseRig.root = page.occupancy?.root || null;
    chaseRig.rel.fill(0);
    if (!seatCamera.view || !chaseRig.camera || !chaseRig.root) {
      if (seatCamera.view) seatCamera.view.externalLaw = null;
      return;
    }
    const rides = cameraRidesTurret(
      chaseRig.camera, page.occupancy.seatInfo(page.occupancy.activeSeatId), chaseRig.root);
    chaseRig.law = chaseLawFor(CHASE_OPTION, rides);
    if (chaseRig.law.law !== 'engine') { seatCamera.view.externalLaw = null; return; }
    if (!chaseRadiusCache.has(chaseRig.root)) {
      chaseRadiusCache.set(chaseRig.root, boundingRadius(chaseRadiusTree(chaseRig.root)));
    }
    chaseRig.radius = chaseRadiusCache.get(chaseRig.root);
    seatCamera.view.externalLaw = chaseExternalLaw;
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
      if (mode === 'flyby' && seatCamera.view.anchored) {
        rig.rel[0] = seatCamera.view.anchor.x - rig.anchor.x;
        rig.rel[1] = seatCamera.view.anchor.y - rig.anchor.y;
        rig.rel[2] = seatCamera.view.anchor.z - rig.anchor.z;
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
    const v = seatCamera.view.vehicle.state.velocity;
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

  function passenger(dt) {
    if (!seatCamera.view) return;
    const pose = seatCamera.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
    page.guns.firstPerson = seatCamera.view.inside;
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
    if (!page.car) return;
    // The world has already run this function's old sim half (world.js
    // #vehicleTick): the HP-15 gate (`driving` below reads its answer), the
    // keyboard into c_PIThrottle/c_PIYaw/c_PIFire/c_PIAltFire, `car.integrate`,
    // the rigs (`applyTurrets` after, never before — the world keeps the page's
    // own ordering comment), the turret's aim and step, the FireStates and the
    // `vehicleGuns` loop with the unconditional-off `setFiring` semantics. The
    // shell left here is the presentation half: the muzzle flash's 1P choice
    // and the camera, including the passenger-seat pose.
    const driving = page.occupancy.isActiveRoot() && !page.vehicleInput.blocked;
    page.guns.firstPerson = page.car.firstPerson;
    // A non-driving seat (the Willy's passenger, a Sherman's hull gunner) still
    // needs the camera — the VehicleCamera owns the C-cycle for every seat of a
    // flyable vehicle, not only the root. The drivetrain step above is gated on
    // `driving` for the same reason the throttle is: the passenger can't steer.
    // But the camera pose is not steering, and letting it lapse here leaves the
    // view pinned to wherever the passenger's `setFirstPerson` swap left it —
    // exactly the "stuck in the passenger POV" bug SEAT-9 (camera-modes.md §3)
    // describes. Manned guns keep their own camera in `manned()` below, so this
    // only matters for the passenger seat of a drivable vehicle.
    if (!driving && !mannedActive() && seatCamera.view) {
      const pose = seatCamera.view.update(dt);
      page.camera.position.copy(pose.position);
      page.camera.quaternion.copy(pose.quaternion);
      return;
    }
    if (!driving) return;
    // Runs after the world integrated, so an external camera hangs off this
    // frame's attitude rather than last frame's.
    const pose = seatCamera.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
    // The dashboard readout this used to write into `#ammo` (road speed, gear)
    // has no line to go to. `car.control`/`.gear` stay live on `__car` for a
    // headless check that wants them; the vehicle HUD panel due from a future
    // seats.js track is the real replacement.
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
    if (!page.occupancy || !page.occupancy.activeSeatId) return false;
    if (page.occupancy.isActiveRoot() && (page.aircraft || page.car)) return false;
    // A passenger seat ('seat' kind: no guns, no aim axes) is NOT a manned gun —
    // its camera belongs to VehicleCamera, not `manned()`, and forcing first-
    // person here locks the view to the passenger's eye node. Let drive()'s
    // non-driving branch claim the C-cycle instead (GUN-12).
    if (page.occupancy.seatKind(page.occupancy.activeSeatId) === 'seat') return false;
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
    if (seatCamera.view) {
      const pose = seatCamera.view.update(dt);
      page.camera.position.copy(pose.position);
      page.camera.quaternion.copy(pose.quaternion);
      // Inside: the 1P muzzle emitter, not the mesh-mounted third-person flash
      // that sits metres ahead of the eye. Outside: the reverse. "Inside" is
      // view mode 3, which the nose cam is too -- see `pilot()`.
      page.guns.firstPerson = seatCamera.view.inside;
    } else {
      readWorldPose(page.occupancy.cameraNode(), mannedCamPos, mannedCamQuat);
      page.camera.position.copy(mannedCamPos);
      page.camera.quaternion.copy(mannedCamQuat);
      page.guns.firstPerson = true;
    }
    // The world's occupied-vehicle tick has already written this seat's trigger
    // (`guns.setFiring`, gated on the HP-15 byte exactly as this function's old
    // loop did); the HUD feed for it happens in frame() after guns.advance.
  }

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
    if (!page.aircraft) return;
    // The pilot's look with the mouse-look key up eases back to straight
    // ahead before any view below is posed from it (`local-look.js`).
    page.stepMouseLookKey(dt);
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
    const flying = page.occupancy.isActiveRoot() && !page.vehicleInput.blocked;
    // The flash's 1P/3P choice is the engine's view mode 3, not whether the
    // cockpit interior is drawn: the nose cam is mode 3 with the interior off,
    // and retail plays the small `em_1P_*` sprite there. Keyed off the interior,
    // the nose cam got the third-person `em_MuzzHeavy` mesh -- a 1.76 m cone
    // ramped toward 9.4x, parked on cowl guns 1.9 m behind the eye, so a held
    // burst (12 rps against a 0.07 s life) was one static shape across the view.
    page.guns.firstPerson = seatCamera.view ? seatCamera.view.inside : page.aircraft.firstPerson;
    // A non-flying seat with no gun of its own (a transport's passenger) still
    // needs its camera moved, exactly as `drive()`'s passenger branch does.
    if (!flying && !mannedActive() && seatCamera.view) {
      const pose = seatCamera.view.update(dt);
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
    const pose = seatCamera.view.update(dt);
    page.camera.position.copy(pose.position);
    page.camera.quaternion.copy(pose.quaternion);
  }

  /** The seated player's cameras and the rest of the seat's presentation. */
  seatCamera.seatedCamera = dt => {
    // Round 3's first disclosed gap: the occupied vehicle's own drivetrain
    // physics steps every tick it exists, no matter which of its seats is
    // actually active — the world's occupied-vehicle step runs for the whole
    // time the player is mounted, so a nested seat (the Sherman's hull
    // gunner) leaves the hull coasting on its existing momentum rather than
    // freezing it. A bare gun/seat root has no drivetrain either way —
    // `aircraft`/`car` both stay null for one — so neither camera call does
    // anything for it.
    if (page.aircraft) seatCamera.pilot(dt);
    else if (page.car) seatCamera.drive(dt);
    else if (!seatCamera.mannedActive()) seatCamera.passenger(dt);
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
    if (page.aircraft?.beachedThisTick && page.aircraft.beachSpeed > 0.5) {
      const p = page.aircraft.state.position;
      const terrainId = page.collider?.heightfield?.material
        ? page.collider.heightfield.material(p.x, p.z) : 0;
      const hullId = page.hullCollisionMaterial(page.aircraft.node);
      const effect = effectNameFor(page.damageTables, terrainId, hullId);
      if (effect) page.effects.play(effect, {
        position: [p.x, p.y, p.z],
        normal: [0, 1, 0],
      });
    }
    if (seatCamera.mannedActive()) {
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
      const wantFov = seatCamera.view && !seatCamera.view.inside ? page.FLY_FOV : page.MANNED_GUN_FOV;
      if (page.camera.fov !== wantFov) {
        page.camera.fov = wantFov;
        page.camera.updateProjectionMatrix();
      }
      seatCamera.manned(dt);
    } else if (page.camera.fov !== page.FLY_FOV) {
      page.camera.fov = page.FLY_FOV;
      page.camera.updateProjectionMatrix();
    }
  };

  Object.assign(seatCamera, {
    CHASE_OPTION,
    cameraMode,
    buildSeatView,
    cameraRidesTurret,
    chaseExternalLaw,
    chaseRadiusTree,
    chaseRig,
    cycleView,
    drive,
    driveFwd,
    manned,
    mannedActive,
    mountChaseLaw,
    pageStorage,
    passenger,
    pilot,
    refreshSeatViewModes,
    serverSettings,
  });
  return seatCamera;
}
