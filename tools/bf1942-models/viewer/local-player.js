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
import { findAllVehicleRoots, listEntryPoints, readWorldPose, pickNearest, AIM_INPUTS } from './seats.js';
import { MouseInput, profileFor } from './mouse-input.js';
import { CHASE_BEHIND, CHASE_AHEAD, boundingRadius, chaseTarget, chaseStep, chaseEye, chaseLawFor } from './chase-camera.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { calculateHitOctant } from './hud.js';
import { Armor } from './armor.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `buildSpawnFlags`, `camera`, `captureBotPresentationTick`,
 * `clearVehicleHud`, `collider`, `currentRoot`, `deployActive`,
 * `deployTeamId`, `disposeHandWeapon`, `disposeSeatPose`, `feedVehicleHud`,
 * `footView3p`, `getTouchHudText`, `groundHeight`, `guns`, `handWeapon`,
 * `hud`, `HUD_FLY`, `HUD_FOOT`, `hudBridge`, `isCollision`, `isTouchDevice`,
 * `isZoomed`, `kbLockLeave`, `loadSeatPose`, `LOCAL_PLAYER`, `look`,
 * `LOOK_SENS`, `netSeatRow`, `netSendAction`, `netTickPoses`,
 * `netVehicleIdFor`, `noteOccupiedVehicle`, `optOnFoot`, `optPilot`,
 * `params`, `pickVehicle`, `placeCamera`, `playSoldierHurtSound`,
 * `releaseButtons`, `resetCaptureUi`, `resetMobileControls`, `roomJoined`,
 * `seatHolder`, `showFlagPicker`, `showView`, `spawnAtFlag`, `syncFootView`,
 * `toggleFullMap`, `triggerHitIndicator`, `updateHud`,
 * `updateMobileControls`, `updateSeatPoseVisibility`, `vehicleInput`,
 * `vehicles`, `vehicleSpawnActive`, `warmSubtree`, `world`.
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

  // --- the mouse-look input stage, on the engine's own tick -----------------
  //
  // LOOP-1 and GUN-2b together. The simulation is a fixed 30 Hz step with
  // `dt = 1/30` exactly, rendering runs free on top, and a frame produces 0, 1
  // or several whole ticks; the mouse-look axis is computed ONCE per pumped
  // frame and every tick of that frame reads the same value. That is what makes
  // the same hand movement turn a turret the same amount at 30, 60 and 144 fps,
  // and it is why this page cannot simply hand the render dt to the servo.
  //
  // The rest of the page still steps on the render dt -- the soldier body has
  // its own 60 Hz accumulator in `physics.js`, the drivetrain its own in
  // `ground.js`. Only the look path is moved here, which is the whole of this
  // stream: a page-wide fixed step is a bigger change than one branch should
  // make while four other streams are editing this file.
  const SIM_TICK_HZ = 30;                 // `g_simulationFps`, lnxded 0x08716b5c
  const SIM_TICK_DT = 1 / SIM_TICK_HZ;    // `Setup+0xcc` / client `Setup+0x184`
  const mouseInput = new MouseInput();
  // The 30 Hz clock itself lives in the world (world.js), one authority per
  // player; this page reads its frame's tick count back from `world.lookTicks
  // (dt)` instead of running a second accumulator that could drift out of
  // phase with the world's (a profile switch used to reset this page's simAccum
  // and never the world's). The engine's backlog collapse was that page clock's
  // rule too (`GameClient::update` 0x0048fca8 `cmp ebx,0x9; jle; mov ebx,1`);
  // the world owns the same law as its FixedStep's MAX_CATCH_UP_TICKS cap.

  /** Which sensitivity profile the player is on right now.
   *
   *  The engine reads it off the entered PCO's `getVehicleCategory()` (see
   *  `mouse-input.js`'s `profileFor`), and in vanilla every stationary weapon
   *  and every gunner position -- an aircraft's rear gun included -- declares
   *  `VCLand`, so only an aircraft's own pilot seat is on the Air profile. That
   *  is exactly `flying` here. */
  function lookProfile() {
    if (page.optPilot.checked && localPlayer.occupancy) {
      return profileFor(localPlayer.aircraft && localPlayer.occupancy.isActiveRoot() ? 'air' : 'land');
    }
    return profileFor(null);
  }

  /**
   * One frame's pump, driven by the world's own clock.
   *
   * The pump's argument is the time the frame's ticks CONSUME (`nTicks / 30`),
   * not the wall-clock frame time -- `InputManager::update` 0x0049cff7
   * `fild nTicks; fmul tickDt`. That is what makes the integral exact: the
   * axis is `0.001 * counts * scale / (n/30)`, each of the n ticks contributes
   * its own share, and the total comes to `0.001 * counts * scale * 30`
   * whatever n was. A frame that owes no tick does not pump at all, and its
   * counts wait. `ticks` is the world's count for this frame (`lookTicks`),
   * so the pump and the sim share one tick authority.
   */
  function pumpLook(ticks) {
    const profile = lookProfile();
    if (profile !== mouseInput.profile) {
      // A different control map has been activated (climbing into a plane, or
      // out of one). The engine resets the map it leaves, so nothing a player
      // did on the old profile arrives scaled by the new one. Only the device
      // stage resets here; the world's clock carries on (it is the one clock).
      mouseInput.reset();
      mouseInput.profile = profile;
    }
    if (ticks > 0) mouseInput.pump(ticks * SIM_TICK_DT, profile);
    return ticks;
  }

  /** A pumped frame's turret ticks: set the held axis pair once, then run the
   *  servo that many times at the engine's own dt. The world owns this loop now
   *  (world.js #vehicleTick aims the rig with the latest buffered axis and
   *  steps it once per 30 Hz tick, which is exactly this servo run); the page
   *  keeps only the pump — `pumpLook` above — and hands the world the axis
   *  pair, so `occupancy.turret`'s aim/step moved across unchanged. */

  /** The soldier's own look, per tick.
   *
   *  `BFSoldier::handlePlayerInput` (lnxded 0x08273c70) turns the view by
   *  `input * dt * g_simulationFps` degrees a tick -- so, at the fixed tick,
   *  `input` degrees -- with a x3.0 on the yaw axis alone (`ds:0x86c08c8`, read
   *  at 0x0827457d) and none on the pitch (0x08274537). `mouse-input.js` carries
   *  the addresses. Signs match this page's own convention, which counts yaw the
   *  other way from the engine. */
  function footLookPair() {
    const factor = footZoomFactor();
    return { x: mouseInput.x * factor, y: mouseInput.y * factor };
  }

  /**
   * The zoom half of the law above, split out so the render prediction
   * (`footLookPending`) runs the pair through the SAME factor the tick will.
   *
   * While zoomed the engine scales BOTH mouse-look axes by the weapon's
   * `zoomFov` — the WORLD field of view, `zoom.fov` here — not by
   * `SoldierZoomFov`, which is the arms' own factor. Read out of the
   * authority: `BFSoldier::handlePlayerInput` lnxded `0x08275bdf`
   * `call [eax+0x114]` (the weapon's zoom state), then
   *
   *     0x08275bf2  mov eax,[edi+0x4c]        ; the FireArms TEMPLATE
   *     0x08275bf5  fld [ebp-0x29c]           ; c_PIMouseLookX
   *     0x08275bfb  fld [eax+0x270]
   *     0x08275c01  fmul st(1),st ; 0x08275c03 fmul [ebp-0x2a4]
   *     0x08275c0b  fstp [ebp-0x29c] ; 0x08275c11 fstp [ebp-0x2a4]
   *
   * and `FireArmsTemplate::makeScript` round-trips **`+0x270` as
   * `ObjectTemplate.zoomFov`** (`0x0828f0e2` pushes `0x086d313b` =
   * `'ObjectTemplate.zoomFov '` before `fld [ebx+0x270]`) while
   * **`+0x274` is `ObjectTemplate.SoldierZoomFov`** (`0x0828f0b0` pushes
   * `0x086d35e0`). The two differ per weapon and by a lot: a K98 is
   * `zoomFov 0.4 / soldierZoomFov 0.6`, a Colt `0.7 / 0.5`. Using the arms'
   * factor made a scoped K98 50% too fast and a sighted Colt 29% too slow.
   *
   * Why a whole FOV reads as a factor: the hip FOV is 1 radian, so `zoomFov`
   * IS the ratio. The `-1.0f` template default cannot reach here --
   * `FireArms::setZoom` `0x082881b7` refuses to zoom at all while
   * `+0x270 < 0` -- but the guard costs nothing.
   */
  function footZoomFactor() {
    if (!page.isZoomed()) return 1;
    const zoomFov = page.handWeapon?.data?.zoom?.fov;
    return Number.isFinite(zoomFov) && zoomFov > 0 ? zoomFov : 1;
  }

  /** The axis pair the NEXT tick will read, from the counts standing right now.
   *
   *  `mouseInput.peek` is `pump` without the consumption (mouse-input.js), asked
   *  for one tick's worth of time, through the same zoom factor `footLookPair`
   *  applies to the pumped pair. On a frame that DID pump — every frame that
   *  runs a tick — the counts were just cleared, so this returns `{0, 0}` and
   *  the prediction it feeds is exactly zero. That is the whole continuity
   *  argument for drawing the predicted view: on a tick frame the displayed
   *  view IS the simulated one, by construction rather than by tuning.
   *
   *  Written into `out` — this is a per-frame path (rule 5). */
  function footLookPending(out) {
    mouseInput.peek(SIM_TICK_DT, lookProfile(), out);
    const factor = footZoomFactor();
    out.x *= factor;
    out.y *= factor;
    return out;
  }

  // --- render interpolation: drawing between the sim's 30 Hz ticks -----------
  //
  // THE RULE (features/mesh-viewer-performance, rule 8): the simulation ticks at
  // 30 Hz and the page never draws a raw tick. At 60 Hz the world steps every
  // other frame, so a page that drew tick state showed a new pose on half its
  // frames and the same one on the rest — measured on foot at
  // `[2.16, 0, 1.08, 0, 2.16, 0, 2.55, 0 ...]` degrees of camera rotation per
  // frame during a steady pan, which is what "the frame rate feels bad while
  // aiming" actually was. The renderer was never the problem.
  //
  // Two different fixes, because the two quantities want different things:
  //
  //   * **Positions and rigged angles are INTERPOLATED.** The previous tick's
  //     pose is kept beside the current one and the frame draws `lerp(prev, cur,
  //     alpha)` where `alpha` is `world.step()`'s own report of how far the
  //     clock has carried past the last tick. That costs one tick of positional
  //     latency (33 ms), which nobody can see on a body or a hull.
  //   * **The on-foot VIEW ANGLES are PREDICTED, never lerped.** Thirty-three
  //     milliseconds on the mouse is something a player feels immediately, so
  //     instead of trailing the sim the view LEADS it by exactly the rotation
  //     the next tick is already committed to: the mouse axis is a rate
  //     computed from the counts pending right now (mouse-input.js), a frame
  //     that runs no tick does not pump and those counts keep accruing, so the
  //     pending rotation is a pure function of state the page can read. It is
  //     read through `MouseInput.peek` and `Soldier.lookPreview` — the pump's
  //     own conversion and the tick's own clamp — never a re-derived copy. On
  //     a frame that DID tick the counts were just consumed, the prediction is
  //     zero and the displayed view equals the simulated one, so the hand-off
  //     between predicted and simulated is continuous by construction.
  //
  // THE TICK-EXACT-POSE CONSTRAINT. Anything the SIMULATION reads out of the
  // scene graph during a tick — gun muzzle world matrices (gunfire.js's
  // `updateWorldMatrix` at fire time), seat positions, `setPlayerPosition` —
  // must see the tick's own pose, never an interpolated one. That holds here
  // without a restore pass, because every node this file interpolates is
  // rewritten from exact sim state INSIDE the tick before anything reads it:
  // `Vehicle.integrate` ends in `applyTransform` + `applyRig` (the root and
  // every rig part), and `TurretAxis.step` ends in its own `_apply` (every aim
  // axis), all of which run in world.js's `#vehicleTick`, i.e. before that
  // tick's `guns.advance`. The interpolated pose is written after `world.step()`
  // returns and is dead by the next tick. The one scene read that happens
  // BEFORE the step is `occupancy.root.getWorldPosition` in frame()'s seated
  // branch, and that feeds the combat-area test for a BARE gun/seat root only
  // (a root with a drivetrain reports `vehicle.state.position` instead) — a
  // bare root has no drivetrain, so nothing interpolates its position and the
  // value is exact either way.
  //
  // SNAP, NEVER LERP, ACROSS A DISCONTINUITY. `snapPresentation()` collapses
  // prev onto cur so a spawn, a teleport, a seat change or a level switch does
  // not streak the camera across the map for one frame. A `FixedStep` catch-up
  // collapse needs no entry: `onTick` fires per tick, so prev and cur are
  // always two ADJACENT ticks however many the frame ran or dropped.
  //
  // Rule 5 applies throughout: every vector and quaternion below is allocated
  // once, at module load or at the moment a vehicle is mounted.

  /** `world.step()`'s alpha for this frame: the fraction of the way from the
   *  last tick to the next. Zero until a world exists. */
  localPlayer.presentAlpha = 0;
  /** Set by `snapPresentation()`, spent by the next capture. */
  localPlayer.presentSnap = true;

  /** The on-foot eye at the last two world-tick boundaries, plus the frame's
   *  drawn blend of them. NOT `soldier.eye()`'s own interpolation: the body's
   *  60 Hz clock is advanced in whole 1/30 increments from inside the world
   *  tick, so its alpha is always zero and it returns raw tick state. */
  const footEyePrev = { x: 0, y: 0, z: 0 };
  const footEyeCur = { x: 0, y: 0, z: 0 };
  /** And his FEET at the same two boundaries, for the third-person body.
   *  Interpolated for the same reason the eye is: the body's own clock returns
   *  raw tick state, and drawing the rig at it while the camera is drawn at an
   *  interpolated eye makes the man judder against his own chase view at any
   *  frame rate above the tick. Not derived from the eye, which carries the view
   *  bob and the stance's eye height. */
  const footFeetPrev = { x: 0, y: 0, z: 0 };
  const footFeetCur = { x: 0, y: 0, z: 0 };
  /** Scratch for the predicted view: the pending axis pair and the pair of
   *  angles `Soldier.lookPreview` hands back. */
  const footPending = { x: 0, y: 0 };
  const footView = { yaw: 0, pitch: 0 };

  /**
   * The occupied vehicle's drawn pose.
   *
   * `vehicle` is the drivetrain whose `state` carries the root pose (null for a
   * bare gun/seat root, which does not move); `parts` is every node a tick
   * poses — rig parts, the nodes an Engine spins, and every aim axis of every
   * seat's `TurretRig` — tracked by node so no module has to hand its internals
   * over. Quaternions are slerped, the root position is lerped.
   */
  const vehicleInterp = {
    vehicle: null,
    root: null,
    parts: [],
    active: false,
    posPrev: new THREE.Vector3(),
    posCur: new THREE.Vector3(),
    posDraw: new THREE.Vector3(),
    quatPrev: new THREE.Quaternion(),
    quatCur: new THREE.Quaternion(),
  };

  /** Re-collect the nodes a tick poses. Called on every mount, seat change and
   *  dismount — the only moments the set can change — and never per frame. */
  function rebuildVehicleInterp() {
    vehicleInterp.parts.length = 0;
    vehicleInterp.vehicle = null;
    vehicleInterp.root = null;
    vehicleInterp.active = false;
    if (localPlayer.occupancy) {
      const drive = localPlayer.aircraft || localPlayer.car || null;
      vehicleInterp.vehicle = drive;
      vehicleInterp.root = drive ? drive.node : null;
      const seen = new Set();
      const track = node => {
        if (!node || node === vehicleInterp.root || seen.has(node)) return;
        seen.add(node);
        vehicleInterp.parts.push({
          node,
          prev: new THREE.Quaternion().copy(node.quaternion),
          cur: new THREE.Quaternion().copy(node.quaternion),
        });
      };
      for (const part of drive?.parts || []) {
        track(part.node);
        for (const spun of part.spun || []) track(spun);
      }
      // Every seat's rig, not only the active one: an inactive rig simply never
      // moves, so its prev and cur stay equal and its slerp is the identity.
      for (const rig of localPlayer.occupancy.turrets?.values() || []) {
        for (const axis of rig.axes || []) track(axis.node);
      }
    }
    // A vehicle left behind must stop being drawn between ITS ticks, and a
    // vehicle just climbed into starts from where it is parked, not from
    // whatever the last one was doing.
    if (localPlayer.view) localPlayer.view.drawnPosition = null;
    snapPresentation();
  }

  /**
   * The next capture starts a fresh pair rather than blending out of a pose
   * that no longer means anything: a spawn, a teleport, entering or leaving a
   * vehicle, a seat switch, a death or respawn, a level switch, `__plane().
   * place` / `__placeCar`. Cheap and idempotent, so call it whenever in doubt.
   */
  function snapPresentation() {
    localPlayer.presentSnap = true;
    capturePresentationTick();
  }

  /**
   * One tick boundary's pose, kept beside the previous one. Registered as the
   * world's `onTick`, so it runs once per tick — including each tick of a frame
   * that ran several — with every piece of that tick's state final.
   */
  function capturePresentationTick() {
    const snap = localPlayer.presentSnap;
    localPlayer.presentSnap = false;
    // The room's prediction ledger: one entry per tick the world ran, in the
    // order the words go on the wire, so the authority's `ack` names a pose the
    // client can measure its error at. Here rather than beside the send, because
    // a frame that ran three ticks sends three words and this is the only place
    // that sees each tick's own finished pose (netcode-reconcile.js).
    if (page.roomJoined && localPlayer.soldier) page.netTickPoses.push(localPlayer.soldier.x, localPlayer.soldier.y, localPlayer.soldier.z);
    if (localPlayer.soldier) {
      if (!snap) Object.assign(footEyePrev, footEyeCur);
      // Alpha 1: this tick's own finished pose. See `Soldier.eye`.
      localPlayer.soldier.eye(footEyeCur, 1);
      if (snap) Object.assign(footEyePrev, footEyeCur);
      if (!snap) Object.assign(footFeetPrev, footFeetCur);
      footFeetCur.x = localPlayer.soldier.x;
      footFeetCur.y = localPlayer.soldier.y;
      footFeetCur.z = localPlayer.soldier.z;
      if (snap) Object.assign(footFeetPrev, footFeetCur);
    }
    page.captureBotPresentationTick(snap);
    const vi = vehicleInterp;
    if (!vi.vehicle && !vi.parts.length) return;
    if (vi.vehicle) {
      if (!snap) { vi.posPrev.copy(vi.posCur); vi.quatPrev.copy(vi.quatCur); }
      // The drivetrain's state, not the node: the contact solver may have pushed
      // the hull after `applyTransform` wrote the node, and `stepVehicleBodies`
      // used to be the only thing that drew that push.
      vi.posCur.copy(vi.vehicle.state.position);
      vi.quatCur.copy(vi.vehicle.state.orientation);
      if (snap) { vi.posPrev.copy(vi.posCur); vi.quatPrev.copy(vi.quatCur); }
    }
    for (const part of vi.parts) {
      if (!snap) part.prev.copy(part.cur);
      part.cur.copy(part.node.quaternion);
      if (snap) part.prev.copy(part.cur);
    }
    vi.active = true;
  }

  /**
   * Draw the occupied vehicle where this FRAME is, not where the last tick left
   * it. Runs immediately after `world.step()` and before any camera, because
   * every vehicle camera — the cockpit eye, a gunner's seat camera, the seated
   * soldier's pose target — derives from these nodes' world matrices.
   *
   * `updateMatrixWorld(true)` for the same reason `applyTransform` calls it: the
   * cameras read world poses before the renderer's own matrix walk gets there.
   */
  function applyVehicleInterp(alpha) {
    const vi = vehicleInterp;
    if (!vi.active) return;
    if (vi.vehicle) {
      vi.posDraw.lerpVectors(vi.posPrev, vi.posCur, alpha);
      vi.root.position.copy(vi.posDraw);
      vi.root.quaternion.slerpQuaternions(vi.quatPrev, vi.quatCur, alpha);
    }
    for (const part of vi.parts) {
      part.node.quaternion.slerpQuaternions(part.prev, part.cur, alpha);
    }
    if (vi.root) vi.root.updateMatrixWorld(true);
    // The external camera modes frame the hull from outside and hang off
    // `state.position`; point them at what was actually drawn (flight.js's
    // `drawnPosition`). The cockpit mode needs nothing — it reads the camera
    // node, which the matrix update above has just moved.
    if (localPlayer.view) localPlayer.view.drawnPosition = vi.vehicle ? vi.posDraw : null;
  }

  function lookDelta(dx, dy) {
    if (!dx && !dy) return;
    // P2's one necessary touch outside its owned-function list (see its final
    // report): a bare gun/seat root has no `view` (`VehicleCamera`) to turn at
    // all, and a nested seat of a vehicle that does (the Sherman's hull gunner)
    // must not steal the *driver's* `view.turn` while manned — neither case
    // existed before manned guns did, and both need to reach `occupancy.turret`
    // before the plain aircraft/car branch below ever runs, or a manned-only
    // seat's mouse motion falls through into the on-foot soldier-look branch
    // instead (the soldier is merely suspended, not unmounted, while seated).
    // A turret takes the mouse from whichever seat owns it, driving seat
    // included. `mannedActive()` alone was enough while only gunners had one;
    // a tank's driver aims his own main gun in this engine (`ShermanTower` /
    // `ShermanGunBase` are declared under the Sherman's own control), so the
    // test is now "is there a turret" rather than "is this a gunner". A
    // drivetrain seat with no turret — a jeep, an aircraft — still falls
    // through to `view.turn` below and swings the camera as it always did.
    if (page.optPilot.checked && localPlayer.occupancy?.turret) {
      // Not applied here any more: the counts go into the input stage and the
      // frame's pump turns them into one axis pair that every tick of that frame
      // reads (`stepTurret`). Several `mousemove` events between two frames
      // simply add up, which is what DirectInput does between two pumps.
      mouseInput.accumulate(dx, dy);
      return;
    }
    if (page.optPilot.checked && mannedActive()) {
      // A manned seat with no aim rig at all: a passenger position. Nothing to
      // turn, and falling through would hand the mouse to the driver's camera.
      return;
    }
    if (page.optPilot.checked && (localPlayer.aircraft || localPlayer.car)) {
      // Not a stick: the arrow keys fly the aircraft and A/D steer the car. What
      // the mouse does depends on the view — a head inside the cockpit, an orbit
      // outside it, and nothing at all in fly-by, which is a camera standing in
      // the world. `VehicleCamera` owns that distinction and the per-mode clamps
      // that go with it.
      localPlayer.view.turn(-dx * HEAD_SENS, -dy * HEAD_SENS);
      return;
    }
    if (page.optOnFoot.checked && localPlayer.soldier) {
      // Same as the turret: accumulated here, converted once per pumped frame,
      // applied per tick in `stepSoldierLook`. The zoom factor and the pitch
      // clamp moved there with it.
      mouseInput.accumulate(dx, dy);
      return;
    }
    page.look.yaw -= dx * page.LOOK_SENS;
    page.look.pitch = Math.max(-1.2, Math.min(1.2, page.look.pitch - dy * page.LOOK_SENS));
  }
  // The stick position (-1..1, driven toward a held key's full deflection and
  // springing back to centre on release) is the world's per-player state now —
  // world.js owns it beside the aircraft path that spends it, and the page's
  // resets delegate to `world.resetStick`.
  const HEAD_SENS = 0.0022;
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
    rebuildVehicleInterp();
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
    rebuildVehicleInterp();
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
    rebuildVehicleInterp();
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
    if (Number.isFinite(n) && n > 0) mouseInput.countsPerPixel = n;
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
    rebuildVehicleInterp();
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
  localPlayer.entryPoints = null;           // [{node, vehicle, control, radius}]
  localPlayer.nearEntry = null;             // the seat the HUD is currently offering
  localPlayer.entryScan = 0;

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
    localPlayer.entryPoints = [];
    for (const vehicle of findAllVehicleRoots(page.currentRoot)) {
      if (!page.vehicleSpawnActive(vehicle)) continue;
      const control = vehicle.userData?.control || vehicle.name || 'vehicle';
      for (const entry of listEntryPoints(vehicle, ENTRY_RADIUS_FALLBACK)) {
        localPlayer.entryPoints.push({
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
    if (!localPlayer.entryPoints) collectEntryPoints();
    return pickNearest(localPlayer.entryPoints, entry => {
      if (page.seatHolder(entry.vehicle, entry.seatId)) return Infinity;
      entry.node.getWorldPosition(entryWorld);
      const distance = Math.hypot(entryWorld.x - localPlayer.soldier.x,
        entryWorld.y - (localPlayer.soldier.y + 1), entryWorld.z - localPlayer.soldier.z);
      return distance <= entry.radius ? distance : Infinity;
    });
  }

  /**
   * Watch for a door within reach, a few times a second rather than every
   * frame, and offer it on the HUD. Runs from `onFoot`.
   */
  function scanForEntry(dt) {
    localPlayer.entryScan -= dt;
    if (localPlayer.entryScan > 0) return;
    localPlayer.entryScan = ENTRY_SCAN_PERIOD;
    const near = nearestEntry();
    if (near?.vehicle !== localPlayer.nearEntry?.vehicle) {
      page.hud.textContent = near
        ? page.isTouchDevice ? `ENTER ${near.control}` : `E — enter the ${near.control}`
        : page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    }
    localPlayer.nearEntry = near;
    page.updateMobileControls();
  }

  /**
   * From on foot into a seat. The soldier is suspended rather than torn down —
   * his weapon, magazines and flag selection all wait for the walk back out —
   * so only the presentation is packed away: the viewmodel, the crosshair, the
   * on-foot FOV.
   */
  function enterVehicle(entry) {
    if (page.handWeapon) {
      if (page.handWeapon.group) page.guns.setFiring(page.handWeapon.group, false);
      page.handWeapon.rig.visible = false;
      // Holstering drops zoom — `HandFireArms::disable` (lnxded 0x08293da0)
      // calls setZoom(false) — and the eased FOV factor goes home with it.
      page.handWeapon.zoomed = false;
      page.handWeapon.rezoom = 0;
      page.handWeapon.fovCur = 1;
      page.handWeapon.worldFov = FOOT_FOV;
    }
    // A button held through the climb in must not arrive already pulling the
    // vehicle's trigger — nor, on the way back out, the soldier's.
    page.releaseButtons();
    // Not hidden here any more: `updateCrosshair` runs every frame and reads
    // the seat's own `setCrossHairType`, so a tank keeps its cross.
    localPlayer.useLens('seat');
    localPlayer.nearEntry = null;
    // Checked without an event on purpose: the change handler would tear the
    // waiting soldier down, and the checkbox is only being told the truth —
    // someone is in a vehicle.
    page.optPilot.checked = true;
    setPilot(true, entry.vehicle, entry.seatId);
    if (!localPlayer.occupancy) {
      // The seat refused (a null root; `pickVehicle`-less path). Back on foot
      // as if nothing happened. Every real `PlayerControlObject` root now
      // classifies to something (`seats.js`'s `classifyRoot` never returns
      // null for one), so this is defensive rather than a real refusal path
      // any of the vehicles this round targets can hit.
      localPlayer.useLens('foot');
      if (page.handWeapon) page.handWeapon.rig.visible = true;
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
    const fwd = driveFwd.set(0, 0, -1).applyQuaternion(vehicle.state.orientation);
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
    const vehicle = localPlayer.aircraft || localPlayer.car;
    if (!vehicle) return;
    const exit = exitPose(vehicle);
    // Height above whatever the collider says is under the exit point, and the
    // hull's own velocity — both read before `leaveSeat` lets go of it.
    const groundAt = page.collider?.surfaceHeight ? page.collider.surfaceHeight(exit.x, exit.z) : NaN;
    const bailing = Number.isFinite(groundAt) && exit.y - groundAt > BAIL_OUT_HEIGHT;
    const hullVelocity = vehicle.state?.velocity;
    // The room's control channel: capture the seat row before the seat is
    // given back.
    const netSeat = localPlayer.occupancy ? page.netSeatRow('exit') : null;
    leaveSeat();
    if (netSeat) page.netSendAction(netSeat);
    page.optPilot.checked = false;
    if (page.optOnFoot.checked && localPlayer.soldier) {
      localPlayer.soldier.collider = page.collider;
      if (bailing) {
        localPlayer.soldier.bailOut(exit.x, exit.y, exit.z, exit.yaw,
          hullVelocity?.x ?? 0, hullVelocity?.y ?? 0, hullVelocity?.z ?? 0);
      } else {
        localPlayer.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
      }
      localPlayer.useLens('foot');
      if (page.handWeapon) page.handWeapon.rig.visible = true;
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
    if (!localPlayer.occupancy) return;
    const exit = exitPoseManned(localPlayer.occupancy);
    const netSeat = page.netSeatRow('exit');
    leaveSeat();
    if (netSeat) page.netSendAction(netSeat);
    page.optPilot.checked = false;
    if (page.optOnFoot.checked && localPlayer.soldier) {
      localPlayer.soldier.collider = page.collider;
      localPlayer.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
      localPlayer.useLens('foot');
      if (page.handWeapon) page.handWeapon.rig.visible = true;
      page.hud.textContent = page.isTouchDevice ? page.getTouchHudText() : page.HUD_FOOT;
    } else {
      page.placeCamera();
      page.updateHud();
    }
    page.resetMobileControls();
  }

  function exitSeat() {
    if (!localPlayer.occupancy) return;
    if (!mannedActive() && (localPlayer.aircraft || localPlayer.car)) exitVehicle();
    else exitManned();
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

  Object.assign(localPlayer, {
    leavePilot,
    CHASE_OPTION,
    DEATH_CAM,
    FLY_FOV,
    HUD_DRIVE,
    HUD_PILOT,
    MANNED_GUN_FOV,
    SOLDIER_MAX_HP_FALLBACK,
    applyDamageToPlayer,
    applyVehicleInterp,
    capturePresentationTick,
    chaseRig,
    collectEntryPoints,
    cycleView,
    deathCamAt,
    deathCamPos,
    drive,
    enterVehicle,
    exitPoseManned,
    exitSeat,
    exitVehicle,
    footEyeCur,
    footEyePrev,
    footFeetCur,
    footFeetPrev,
    footLookPair,
    footLookPending,
    footPending,
    footView,
    leaveSeat,
    lookDelta,
    manned,
    mannedActive,
    mouseInput,
    parachuteLog,
    passenger,
    pilot,
    pumpLook,
    rebuildVehicleInterp,
    scanForEntry,
    serverSettings,
    setOnFoot,
    setPilot,
    snapPresentation,
    supplyTarget,
    switchSeat,
    syncLocalSeat,
    vehicleInterp,
  });
  return localPlayer;
}
