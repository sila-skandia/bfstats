import * as THREE from 'three';
import { MouseInput, profileFor } from './mouse-input.js';
import { MOUSE_LOOK_TRIGGER, seatNeedsMouseLookKey, recentreLook } from './mouse-look-key.js';

/**
 * The human's mouse look on the engine's own tick, and the render
 * interpolation that draws his eye, and every occupied hull, between two
 * 30 Hz ticks.
 * Split out of `local-player.js`.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `captureBotPresentationTick`, `car`, `handWeapon`, `held`,
 * `isZoomed`, `LOOK_SENS`, `mannedActive`, `netTickPoses`, `occupancy`,
 * `optOnFoot`, `optPilot`, `roomJoined`, `soldier`, `touchFlying`,
 * `turnLook`, `vehicles`, `view`.
 */
export function createLocalLook(page) {
  const localLook = {};

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
  // `wheeled-vehicle.js`. Only the look path is moved here, which is the whole of this
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
    if (page.optPilot.checked && page.occupancy) {
      return profileFor(page.aircraft && page.occupancy.isActiveRoot() ? 'air' : 'land');
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
  localLook.presentAlpha = 0;
  /** Set by `snapPresentation()`, spent by the next capture. */
  localLook.presentSnap = true;

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
   * Every occupied hull's drawn pose, whoever drives it.
   *
   * One record per `VehicleInstance` in the page's registry (`page.vehicles`),
   * the local player's hull and every bot's alike. Until 2026-09-23 only the
   * local player's hull was drawn between ticks, and every other driven hull
   * was drawn at its raw tick pose: at 60 fps a bot's Spitfire showed a new
   * pose on half the frames and a repeat on the rest (cadencecheck.cjs
   * `--bots`: 50.6% of frames moved, steps `[0, 1.92, 0, 1.92, ...]` m), which
   * reads as a double image or blur on anything fast.
   *
   * `vehicle` is the hull's drivetrain, whose `state` carries the root pose
   * (null for a bare gun/seat root, which does not move); `parts` is every
   * node a tick poses — rig parts, the nodes an Engine spins, and every aim
   * axis of every seat's `TurretRig` — tracked by node so no module has to hand
   * its internals over. Quaternions are slerped, the root position is lerped.
   * A record is rebuilt (and starts snapped) when its hull's drive or rig set
   * changes: a drive built when someone takes the wheel, a rig when a seat is
   * first taken.
   */
  const hullInterps = new Map();
  /** A hull's root moving further than this in one tick was put somewhere
   *  (a respawn, a test hook's placement), not flown there: snap it. Twenty
   *  metres a tick is 600 m/s, three times anything in the game flies. */
  const HULL_JUMP = 20;

  function buildHullInterp(inst) {
    const drive = inst.drive ?? null;
    const rec = {
      instance: inst,
      vehicle: drive,
      /** The node whose position and orientation are drawn (the drive's). */
      root: drive ? drive.node : null,
      /** The node whose subtree's matrices follow the drawn pose. */
      matrixRoot: drive ? drive.node : inst.root,
      rigCount: inst.occupancy.turrets?.size ?? 0,
      parts: [],
      snapped: false,
      active: false,
      posPrev: new THREE.Vector3(),
      posCur: new THREE.Vector3(),
      posDraw: new THREE.Vector3(),
      quatPrev: new THREE.Quaternion(),
      quatCur: new THREE.Quaternion(),
    };
    const seen = new Set();
    const track = node => {
      if (!node || node === rec.root || seen.has(node)) return;
      seen.add(node);
      rec.parts.push({
        node,
        prev: new THREE.Quaternion().copy(node.quaternion),
        cur: new THREE.Quaternion().copy(node.quaternion),
      });
    };
    for (const part of drive?.parts || []) {
      track(part.node);
      for (const spun of part.spun || []) track(spun);
    }
    // Every seat's rig, not only the occupied ones: a rig nobody aims simply
    // never moves, so its prev and cur stay equal and its slerp is the identity.
    for (const rig of inst.occupancy.turrets?.values() || []) {
      for (const axis of rig.axes || []) track(axis.node);
    }
    return rec;
  }

  /** Is `rec` still the record of a hull someone sits in, with the drive it
   *  was built for? A seat change inside a frame (a bot getting out, taking
   *  the wheel) can leave it stale until the next tick's capture. */
  function hullInterpLive(rec) {
    const inst = rec.instance;
    return page.vehicles?.instances.get(inst.root) === inst && (inst.drive ?? null) === rec.vehicle;
  }

  /** The registry's hulls, each with a record that matches it. */
  function syncHullInterps() {
    const instances = page.vehicles?.instances;
    for (const inst of hullInterps.keys()) {
      if (instances?.get(inst.root) !== inst) hullInterps.delete(inst);
    }
    if (!instances) return;
    for (const inst of instances.values()) {
      const rec = hullInterps.get(inst);
      if (rec && rec.vehicle === (inst.drive ?? null)
          && rec.rigCount === (inst.occupancy.turrets?.size ?? 0)) continue;
      hullInterps.set(inst, buildHullInterp(inst));
    }
  }

  /** The drawn record of the local player's hull, or null. */
  function localHullInterp() {
    const inst = page.occupancy?.instance;
    return inst ? hullInterps.get(inst) ?? null : null;
  }

  /** Re-collect the local player's hull after a mount, a seat change or a
   *  dismount (every other hull re-collects itself at the next tick from the
   *  registry), and start every drawn pose from where it stands. */
  function rebuildVehicleInterp() {
    // A vehicle left behind must stop being drawn between ITS ticks, and a
    // vehicle just climbed into starts from where it is parked, not from
    // whatever the last one was doing.
    if (page.view) page.view.drawnPosition = null;
    snapPresentation();
  }

  /**
   * The next capture starts a fresh pair rather than blending out of a pose
   * that no longer means anything: a spawn, a teleport, entering or leaving a
   * vehicle, a seat switch, a death or respawn, a level switch, `__plane().
   * place` / `__placeCar`. Cheap and idempotent, so call it whenever in doubt.
   */
  function snapPresentation() {
    localLook.presentSnap = true;
    capturePresentationTick();
  }

  /**
   * One tick boundary's pose, kept beside the previous one. Registered as the
   * world's `onTick`, so it runs once per tick — including each tick of a frame
   * that ran several — with every piece of that tick's state final.
   */
  function capturePresentationTick() {
    const snap = localLook.presentSnap;
    localLook.presentSnap = false;
    // The room's prediction ledger: one entry per tick the world ran, in the
    // order the words go on the wire, so the authority's `ack` names a pose the
    // client can measure its error at. Here rather than beside the send, because
    // a frame that ran three ticks sends three words and this is the only place
    // that sees each tick's own finished pose (netcode-reconcile.js).
    if (page.roomJoined && page.soldier) page.netTickPoses.push(page.soldier.x, page.soldier.y, page.soldier.z);
    if (page.soldier) {
      if (!snap) Object.assign(footEyePrev, footEyeCur);
      // Alpha 1: this tick's own finished pose. See `Soldier.eye`.
      page.soldier.eye(footEyeCur, 1);
      if (snap) Object.assign(footEyePrev, footEyeCur);
      if (!snap) Object.assign(footFeetPrev, footFeetCur);
      footFeetCur.x = page.soldier.x;
      footFeetCur.y = page.soldier.y;
      footFeetCur.z = page.soldier.z;
      if (snap) Object.assign(footFeetPrev, footFeetCur);
    }
    page.captureBotPresentationTick(snap);
    syncHullInterps();
    for (const rec of hullInterps.values()) captureHull(rec, snap);
  }

  function captureHull(rec, snap) {
    let fresh = snap || !rec.snapped;
    if (rec.vehicle) {
      // The drivetrain's state, not the node: the contact solver may have pushed
      // the hull after `applyTransform` wrote the node, and `stepVehicleBodies`
      // used to be the only thing that drew that push.
      const s = rec.vehicle.state;
      if (!fresh && rec.posCur.distanceTo(s.position) > HULL_JUMP) fresh = true;
      if (!fresh) { rec.posPrev.copy(rec.posCur); rec.quatPrev.copy(rec.quatCur); }
      rec.posCur.copy(s.position);
      rec.quatCur.copy(s.orientation);
      if (fresh) { rec.posPrev.copy(rec.posCur); rec.quatPrev.copy(rec.quatCur); }
    }
    for (const part of rec.parts) {
      if (!fresh) part.prev.copy(part.cur);
      part.cur.copy(part.node.quaternion);
      if (fresh) part.prev.copy(part.cur);
    }
    rec.snapped = true;
    rec.active = true;
  }

  /**
   * Draw every occupied hull where this FRAME is, not where the last tick left
   * it. Runs immediately after `world.step()` and before any camera, because
   * every vehicle camera — the cockpit eye, a gunner's seat camera, the seated
   * soldier's pose target — derives from these nodes' world matrices.
   *
   * `updateMatrixWorld(true)` for the same reason `applyTransform` calls it: the
   * cameras read world poses before the renderer's own matrix walk gets there.
   */
  /** The instant this frame draws: the world step's `alpha`, and the drawn
   *  vehicle pose that follows from it. */
  localLook.present = alpha => {
    localLook.presentAlpha = alpha;
    applyVehicleInterp(alpha);
  };

  function applyVehicleInterp(alpha) {
    for (const rec of hullInterps.values()) {
      if (!rec.active || !hullInterpLive(rec)) continue;
      if (rec.vehicle) {
        rec.posDraw.lerpVectors(rec.posPrev, rec.posCur, alpha);
        rec.root.position.copy(rec.posDraw);
        rec.root.quaternion.slerpQuaternions(rec.quatPrev, rec.quatCur, alpha);
      }
      for (const part of rec.parts) {
        part.node.quaternion.slerpQuaternions(part.prev, part.cur, alpha);
      }
      rec.matrixRoot?.updateMatrixWorld(true);
    }
    // The external camera modes frame the hull from outside and hang off
    // `state.position`; point them at what was actually drawn (flight.js's
    // `drawnPosition`). The cockpit mode needs nothing — it reads the camera
    // node, which the matrix update above has just moved.
    if (page.view) {
      const local = localHullInterp();
      page.view.drawnPosition = local?.active && local.vehicle && hullInterpLive(local) ? local.posDraw : null;
    }
  }

  /**
   * Put every drawn hull back on its last tick's pose. Called at the top of
   * the frame, before anything of the simulation runs: the tick rewrites a
   * hull it integrates anyway, but a frame that runs no tick would otherwise
   * hand the bots' AI (`referee.tick`, which reads gun and hull nodes' world
   * matrices) the previous frame's drawn pose instead of the tick's, and the
   * AI must see the same state whatever the display rate.
   */
  function restoreTickPose() {
    for (const rec of hullInterps.values()) {
      if (!rec.active || !hullInterpLive(rec)) continue;
      if (rec.vehicle) {
        rec.root.position.copy(rec.posCur);
        rec.root.quaternion.copy(rec.quatCur);
      }
      for (const part of rec.parts) part.node.quaternion.copy(part.cur);
      rec.matrixRoot?.updateMatrixWorld(true);
    }
  }

  /** Does the render interpolation draw `drive`'s node? `stepVehicleBodies`
   *  asks before writing a hull's raw state onto it. */
  function drawsHull(drive) {
    if (!drive) return false;
    for (const rec of hullInterps.values()) {
      if (rec.vehicle === drive) return rec.active && hullInterpLive(rec);
    }
    return false;
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
    if (page.optPilot.checked && page.occupancy?.turret) {
      // Not applied here any more: the counts go into the input stage and the
      // frame's pump turns them into one axis pair that every tick of that frame
      // reads (`stepTurret`). Several `mousemove` events between two frames
      // simply add up, which is what DirectInput does between two pumps.
      mouseInput.accumulate(dx, dy);
      return;
    }
    if (page.optPilot.checked && page.mannedActive()) {
      // A manned seat with no aim rig at all: a passenger position. Nothing to
      // turn, and falling through would hand the mouse to the driver's camera.
      return;
    }
    if (page.optPilot.checked && (page.aircraft || page.car)) {
      // Not a stick: the arrow keys fly the aircraft and A/D steer the car. What
      // the mouse does depends on the view — a head inside the cockpit, an orbit
      // outside it, and nothing at all in fly-by, which is a camera standing in
      // the world. `VehicleCamera` owns that distinction and the per-mode clamps
      // that go with it.
      //
      // A pilot's head turns only while the mouse-look key is held: his
      // Camera's `toggleMouseLook` makes the engine drop the look axes for
      // every tick the key is up, in every view (`mouse-look-key.js`). A knock
      // of the mouse does nothing, and the released view eases back
      // (`stepMouseLookKey`).
      if (lookNeedsKey() && !lookKeyHeld()) return;
      page.view.turn(-dx * HEAD_SENS, -dy * HEAD_SENS);
      return;
    }
    if (page.optOnFoot.checked && page.soldier) {
      // Same as the turret: accumulated here, converted once per pumped frame,
      // applied per tick in `stepSoldierLook`. The zoom factor and the pitch
      // clamp moved there with it.
      mouseInput.accumulate(dx, dy);
      return;
    }
    page.turnLook(dx, dy, page.LOOK_SENS);
  }
  // The stick position (-1..1, driven toward a held key's full deflection and
  // springing back to centre on release) is the world's per-player state now —
  // world.js owns it beside the aircraft path that spends it, and the page's
  // resets delegate to `world.resetStick`.
  const HEAD_SENS = 0.0022;

  // --- the mouse-look key (`c_PIMouseLook`) ---------------------------------
  //
  // `mouse-look-key.js` has the engine's read. The page's three uses: the gate
  // in `lookDelta` above, the recentre below (the seat's camera calls it once
  // a frame, before it is posed), and the router's held branch on the input
  // word (`local-player.js` `sampleInput`).

  /** Does the seat the player holds need the key to look around? Only a
   *  pilot's does: his Camera's `toggleMouseLook`. A gunner's (the B17's
   *  turrets, a Stuka's rear gun) and every seat of a hull that is not an
   *  aircraft look freely, as they always did. */
  function lookNeedsKey() {
    const seat = page.optPilot.checked ? page.occupancy : null;
    return !!seat && seatNeedsMouseLookKey({ rootKind: seat.rootKind, root: seat.isActiveRoot() });
  }

  /** Is the look held: the key the profile binds to `c_PIMouseLook` (Left
   *  Shift in the shipped Air map; a joystick button if the profile says so),
   *  or a finger dragging the view on a touch screen, which has no such key
   *  (the viewer's own choice: the game has no touch input). */
  function lookKeyHeld() {
    return !!page.held(MOUSE_LOOK_TRIGGER) || !!page.touchFlying;
  }

  /** Once a frame, before the seat's camera is posed: a pilot's look with the
   *  key up eases back to straight ahead, 0.75 of it kept per 30 Hz tick
   *  (`Camera::handlePlayerInput`). Inside the cockpit that is the head
   *  turning back to the gunsight; outside it, the orbit swinging back
   *  behind the tail. */
  function stepMouseLookKey(dt) {
    const view = page.view;
    if (!view || !lookNeedsKey() || lookKeyHeld()) return;
    recentreLook(view.look, dt);
  }

  Object.assign(localLook, {
    applyVehicleInterp,
    capturePresentationTick,
    drawsHull,
    footEyeCur,
    footEyePrev,
    footFeetCur,
    footFeetPrev,
    footLookPair,
    footLookPending,
    footPending,
    footView,
    footZoomFactor,
    lookDelta,
    lookKeyHeld,
    lookNeedsKey,
    lookProfile,
    mouseInput,
    pumpLook,
    rebuildVehicleInterp,
    restoreTickPose,
    snapPresentation,
    stepMouseLookKey,
  });
  return localLook;
}
