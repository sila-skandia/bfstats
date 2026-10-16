// The human's camera on foot: the interpolated eye, the predicted look, the
// death cam, the swim and parachute views, the soldier's third-person views
// (`SoldierView`, the canopy framing), and the supply depot and fire calls
// the on-foot frame makes. Lifted out of map.html (features/vehicle-
// instance-refactor Part 2); `soldier-camera.js` stays the view law.

import * as THREE from 'three';
import { soldierLookDegrees } from './mouse-input.js';
import { CHASE_BEHIND, CHASE_AHEAD, CHASE_RADIUS_SCALE, chaseTarget, chaseStep, chaseEye } from './chase-camera.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import {
  SoldierView, PARACHUTE_VIEW_CYCLE, PARACHUTE_VIEW_RADIUS, VIEW_INSIDE, VIEW_FRONT,
  FOOT_VIEW_CYCLE, FOOT_CHASE_RADIUS, FOOT_CHASE_SHOULDER, FOOT_WALL_MARGIN, FOOT_WALL_MIN,
  aimDistance, lookAngles,
} from './soldier-camera.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyLook`, `camera`, `collectSupplyDepots`, `collider`, `currentRoot`,
 * `deathCamPos`, `deathCamShot`, `deathCamTarget`,
 * `deathCamTimer`, `deathYaw`, `DEG_TO_RAD`, `deployActive`, `deployTeamId`,
 * `dieOnFoot`, `footBody`, `footCanopy`, `footEyeCur`, `footEyePrev`,
 * `footFire`, `footLookPending`, `footPending`, `footView`,
 * `frameInputLast`, `hudBridge`, `lastAttackerAt`, `openDeploy`, `params`, `presentAlpha`,
 * `runDeathCam`, `scanForEntry`, `serverSettings`, `setLook`, `soldier`,
 * `soldierArmor`, `soldierDead`, `supplyTarget`, `world`.
 */
export function createSoldierView(page) {
  const soldierView = {};
  /** Wake's 52 `SupplyDepot` nodes, collected once per level (see
   *  `collectSupplyDepots`) and cached against the `currentRoot` they came
   *  from, so a map switch — a new root object — rebuilds the field exactly
   *  once rather than every frame. Built lazily from `onFoot`, this track's
   *  one hook into the per-frame loop. */
  soldierView.supplyField = null;
  soldierView.supplyDepotsRoot = null;

  // --- the corpse cam -----------------------------------------------------------
  //
  // A man killed on foot sees his own body: the side of the shot is chosen
  // on the frame he dies -- the far side from whoever last hit him
  // (`lastAttackerAt`, the message log's own record of the attack), so the
  // body lies in the middle of the frame with his killer beyond it -- and
  // the camera then keeps `back` metres off the body's pelvis on that side
  // and `lift` above it while the death plays, looking at the pelvis. With
  // no attacker (a fall, his own grenade) the camera stands behind him along
  // the heading he fell on. The shot is kept out of walls and hills: pulled
  // in to whatever stands between the body and the camera, and never below
  // the ground. [HOUSE RULES: the client's death cam was never decoded past
  // `FUN_004933d0` opening the spawn screen (hitpoints-and-damage.md §7); the
  // numbers are framing, `local-player.js` `DEATH_CAM.foot`.]
  const corpseShot = { yaw: null, x: 0, y: 0, z: 0 };
  const corpseAt = new THREE.Vector3();
  let pelvisOf = null;
  let pelvisNode = null;

  /** The drawn corpse's pelvis this frame, else the eye's point. */
  function corpseCentre(fallback) {
    const scene = page.footBody?.scene ?? null;
    if (scene !== pelvisOf) {
      pelvisOf = scene;
      pelvisNode = scene?.getObjectByName('Bip01_Pelvis') ?? scene?.getObjectByName('Bip01 Pelvis') ?? null;
    }
    if (pelvisNode && scene.visible) return pelvisNode.getWorldPosition(corpseAt);
    return corpseAt.set(fallback.x, fallback.y, fallback.z);
  }

  /** The heading the shot looks along: toward the killer, else the fall's. */
  function corpseShotYaw(centre) {
    const from = page.lastAttackerAt?.() ?? null;
    if (from) {
      const dx = from.x - centre.x;
      const dz = from.z - centre.z;
      if (Math.hypot(dx, dz) > 1) return Math.atan2(dx, dz);
    }
    return page.deathYaw ?? page.soldier.viewYaw;
  }

  function placeCorpseShot(centre, yaw) {
    const shot = page.deathCamShot;
    const bx = -Math.sin(yaw) * shot.back;
    const bz = -Math.cos(yaw) * shot.back;
    const by = shot.lift;
    const reach = Math.hypot(bx, by, bz);
    let t = reach;
    const hit = page.collider?.cast?.(centre.x, centre.y, centre.z,
                                      bx / reach, by / reach, bz / reach, reach, -1);
    if (hit && hit.t < reach) t = Math.max(0.5, hit.t - 0.3);
    corpseShot.x = centre.x + bx * (t / reach);
    corpseShot.y = centre.y + by * (t / reach);
    corpseShot.z = centre.z + bz * (t / reach);
    const floor = page.collider?.surfaceHeight?.(corpseShot.x, corpseShot.z, corpseShot.y + 2);
    if (Number.isFinite(floor)) corpseShot.y = Math.max(corpseShot.y, floor + 0.4);
  }

  function corpseCam(eye) {
    const centre = corpseCentre(eye);
    if (corpseShot.yaw === null) corpseShot.yaw = corpseShotYaw(centre);
    placeCorpseShot(centre, corpseShot.yaw);
    page.camera.position.set(corpseShot.x, corpseShot.y, corpseShot.z);
    const dx = centre.x - corpseShot.x;
    const dy = centre.y - corpseShot.y;
    const dz = centre.z - corpseShot.z;
    page.setLook(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }

  /**
   * The on-foot camera half of the old `onFoot()` — the sim half went to the
   * world's 30 Hz soldier tick (world.js #soldierTick): the look was applied
   * per tick with the engine's own law (the pumped pair `frame()` handed over,
   *  applied per tick with the engine's own law (the pumped pair `frame()`
   *  handed over, `soldier.look`'s clamp included), the body stepped and the
   *  HP-14 fall damage landed against the world player's Armor — in the old
   *  order, look first because the engine turns the soldier inside the same
   *  `handlePlayerInput` call that reads his movement input. What is left here
   *  is the presentation: the death cam's latch and timer, the supply HUD, the
   *  eye pose, the trigger and the door scan.
   *
   *  The sim runs on fixed ticks inside `step()` above — the world's 30 Hz, the
   *  body's own 60 Hz within it, and since the headless-World refactor the
   *  latter is advanced in whole 1/30 increments from inside the former, so its
   *  alpha is always zero and `soldier.eye()` is raw tick state. This function
   *  therefore does its own interpolation, against the WORLD's clock: the eye
   *  is blended between the last two tick boundaries by `presentAlpha`, and the
   *  view angles are not blended at all but predicted forward from the pending
   *  mouse counts, which costs no latency. The whole argument, and the
   *  tick-exact-pose constraint it has to respect, is in the render-interpolation
   *  block beside `footLookPending`.
   *  The bob's amplitudes are the game's `setCameraShake*`;
   *  `soldier.js` has the citation. A dead body swaps in the death cam: the
   *  same eye base but parked a couple of metres above it and pitched down
   *  onto the corpse, so the view "floats over the dead player" for the beat
   *  before the deploy screen takes over.
   */
  function onFootCamera(dt) {
    if (!page.soldier) return;
    // Which views C may reach this frame -- the engine's one, or the canopy's.
    syncFootView();
    // Death cam → deploy. When the on-foot body's Armor dies (fall damage,
    // `window.__damage(n)`, a future projectile), latch the dead state and hold
    // a short camera beat over/by the corpse (the game's death cam) before the
    // deploy screen opens — `hitpoints-and-damage.md` §7 (client `FUN_004933d0`
    // opens the spawn screen on local death). Latches so a follow-up damage tick
    // cannot re-fire the flow, and is reset by `spawnAtFlag` on the next spawn.
    if (page.soldierArmor && !page.soldierDead && page.soldierArmor.destroyed) {
      page.dieOnFoot();
      // The corpse cam itself is applied downstream, where the eye pose is
      // normally written (`soldierDead` branch) — this block only latches the
      // state and runs the deploy timer.
    }
    if (page.soldierDead) {
      page.runDeathCam(dt);
      if (page.deathCamTimer <= 0 && !page.deployActive()) {
        // The client opens the deploy screen the instant the local player dies;
        // the beat above is the brief float, then the spawn screen takes over.
        page.openDeploy();
      }
    }

    // Wake's SupplyDepot instances: collected once per level (a map switch
    // hands `currentRoot` a new object, caught here by reference), handed to
    // the world which does the ticking on its 30 Hz cadence —
    // `SupplyDepot.tick`'s internal 0.5s self-throttle (verify-r3.md SUP-11)
    // is what actually paces the give/heal, not the tick rate. The
    // `ShowHealIcon`/`ShowReloadIcon` HUD vars are un-throttled on purpose
    // (SUP-33/34): they track proximity every frame, the way the engine's own
    // icon predicates do, independent of the depot's own action cadence.
    if (page.world && soldierView.supplyDepotsRoot !== page.currentRoot) {
      soldierView.supplyDepotsRoot = page.currentRoot;
      page.world.setSupplyDepots(page.collectSupplyDepots(page.currentRoot));
      soldierView.supplyField = page.world.supplyField;
    }
    page.supplyTarget.x = page.soldier.x; page.supplyTarget.y = page.soldier.y; page.supplyTarget.z = page.soldier.z;
    page.supplyTarget.team = page.deployTeamId;
    page.supplyTarget.armor = page.soldierArmor;
    page.hudBridge.vars['ShowHealIcon'] = soldierView.supplyField.canHeal(page.supplyTarget);
    page.hudBridge.vars['ShowReloadIcon'] = soldierView.supplyField.canRearm(page.supplyTarget);
    if (page.soldierArmor) {
      page.hudBridge.vars['Soldier/SoldierHitPoints'] = page.soldierArmor.hitPoints;
      page.hudBridge.vars['Soldier/SoldierMaxHitPoints'] = page.soldierArmor.maxHitPoints;
    }

    // The drawn eye: this frame's instant between the last two tick boundaries.
    // The bob rides in it — `soldier.eye` adds `bobUp`/`bobSide`, and the bob
    // advances once per world tick like everything else — so blending the whole
    // eye smooths the shake as well as the stride.
    footEye.x = page.footEyePrev.x + (page.footEyeCur.x - page.footEyePrev.x) * page.presentAlpha;
    footEye.y = page.footEyePrev.y + (page.footEyeCur.y - page.footEyePrev.y) * page.presentAlpha;
    footEye.z = page.footEyePrev.z + (page.footEyeCur.z - page.footEyePrev.z) * page.presentAlpha;
    // The drawn view: the simulated view plus the rotation the pending mouse
    // counts have already bought and the next tick is going to apply. Through
    // the pump's own conversion (`footLookPending`), the tick's own degrees-
    // per-axis law (`soldierLookDegrees`, x3 on yaw) and the soldier's own
    // pitch clamp (`lookPreview`) — no constant is restated here. Zero on any
    // frame that ran a tick, because that frame's pump consumed the counts.
    page.footLookPending(page.footPending);
    const per = soldierLookDegrees(page.footPending.x, page.footPending.y, 1, !!page.soldier.lookMoving);
    page.soldier.lookPreview(-per.yaw * page.DEG_TO_RAD, -per.pitch * page.DEG_TO_RAD, page.footView);
    if (!page.soldierDead) corpseShot.yaw = null;
    if (page.soldierDead && !page.deathCamTarget) {
      corpseCam(footEye);
    } else if (page.soldierDead) {
      // Behind the subject along its own facing and above it, by `deathCamShot`:
      // the hull for a death inside a vehicle, the man slumped in his seat for
      // one in it (`deathCamTarget`). Forward is `(sin yaw, 0, cos yaw)` — the
      // soldier's convention throughout this file — so "behind" is minus that.
      const at = page.deathCamTarget;
      const camYaw = at.yaw;
      page.deathCamPos.set(
        at.x - Math.sin(camYaw) * page.deathCamShot.back,
        at.y + page.deathCamShot.lift,
        at.z - Math.cos(camYaw) * page.deathCamShot.back);
      page.camera.position.set(page.deathCamPos.x, page.deathCamPos.y, page.deathCamPos.z);
      page.setLook(camYaw, page.deathCamShot.pitch);
    } else if (!footView3p.firstPerson && page.soldier.parachuteState !== 'open') {
      footChase(dt);
    } else if (!footView3p.firstPerson) {
      // C has taken the view outside the man under his canopy. The offsets, the 0.6 s velocity
      // lag and the `1 - exp(-2 dt)` ease are `chase-camera.js`'s, which are the
      // engine's own (`Camera::getTransformation`, lnxded 0x081aaf90); the frame
      // is the soldier's facing, the anchor his eye, and the look-at is the
      // anchor, exactly as the engine's `lookAt(eye, camM.position, worldUp)`.
      // Only the radius and the fact that a soldier may reach the mode at all
      // are the viewer's -- see `soldier-camera.js`.
      const sign = footView3p.mode === VIEW_FRONT ? CHASE_AHEAD : CHASE_BEHIND;
      const yaw = page.footView.yaw;
      foot3pForward[0] = Math.sin(yaw);
      foot3pForward[1] = 0;
      foot3pForward[2] = Math.cos(yaw);
      const v = page.soldier.body.body.velocity;
      foot3pVelocity[0] = v.x; foot3pVelocity[1] = v.y; foot3pVelocity[2] = v.z;
      // How tall the subject is this frame, and therefore how far back and how
      // high the eye has to sit for all of it to be in shot. A man is
      // `PARACHUTE_VIEW_RADIUS`, the number W5-E chose and the only one it had;
      // a man under a canopy is 14 metres of him, and the FIRST frame ever taken
      // of one showed why that matters -- at 3.0 the soldier hung in the middle
      // of the picture with his canopy entirely above the top edge. `canopySpan`
      // is measured off the canopy's own drawn bounding box, not typed in.
      const span = canopySpan();
      const radius = span > 0
        ? (span * CANOPY_VIEW_MARGIN / 2) / Math.tan(FOOT_FOV * 0.5 * page.DEG_TO_RAD)
          / CHASE_RADIUS_SCALE
        : PARACHUTE_VIEW_RADIUS;
      chaseTarget(foot3pForward, FOOT_3P_UP, radius, sign, foot3pTarget);
      chaseStep(foot3pRel, foot3pTarget, foot3pVelocity, sign, dt);
      foot3pAnchor[0] = footEye.x;
      // Centre the subject rather than the man: the eye is near the top of a
      // parachutist, so anchoring on it puts the canopy off-screen however far
      // back the camera goes.
      foot3pAnchor[1] = span > 0 ? footBodyFeetY() + span / 2 : footEye.y;
      foot3pAnchor[2] = footEye.z;
      const floorY = page.collider?.surfaceHeight
        ? page.collider.surfaceHeight(footEye.x + foot3pRel[0], footEye.z + foot3pRel[2])
        : -Infinity;
      chaseEye(foot3pAnchor, foot3pRel, floorY, foot3pEye);
      page.camera.position.set(foot3pEye[0], foot3pEye[1], foot3pEye[2]);
      const dx = footEye.x - foot3pEye[0];
      const dy = footEye.y - foot3pEye[1];
      const dz = footEye.z - foot3pEye[2];
      const flat = Math.hypot(dx, dz);
      page.setLook(Math.atan2(dx, dz), Math.atan2(dy, flat));
    } else {
      page.camera.position.set(footEye.x, footEye.y, footEye.z);
      page.setLook(page.footView.yaw, page.footView.pitch);
      // The engine carries `rel` as the last output less the anchor in every
      // mode, so inside it is zero and the next chase view swoops out of the
      // man (`chase-camera.js`).
      foot3pRel[0] = foot3pRel[1] = foot3pRel[2] = 0;
    }
    page.applyLook();
    placeAimEye();
    // After the camera pose is final: the weapon fires down this frame's view
    // axis, and the crosshair is drawn against this frame's FOV. A dead body
    // cannot fire. The input object is the one frame() built (the same values
    // the world consumed this tick).
    if (!page.soldierDead) page.footFire(dt, page.frameInputLast);
    // And after everything the frame owed: is there a door within reach.
    if (!page.soldierDead) page.scanForEntry(dt);
  }

  const EMPTY_KEYS = new Set();
  const footEye = { x: 0, y: 0, z: 0 };

  // The soldier's view mode and the state the external ones carry between
  // frames. `SoldierView` starts on the engine's own set -- `CVMInside` alone,
  // which is all `SoldierCamera` authorises -- so C is a no-op on foot until
  // `setCycle` widens it under an open canopy.
  const footView3p = new SoldierView();
  const foot3pRel = [0, 0, 0];
  const foot3pTarget = [0, 0, 0];
  const foot3pForward = [0, 0, 0];
  const foot3pVelocity = [0, 0, 0];
  const foot3pAnchor = [0, 0, 0];
  const foot3pEye = [0, 0, 0];
  const FOOT_3P_UP = [0, 1, 0];

  // --- the chase view on foot (F10; F9 back) ------------------------------------
  //
  // The placement is `chase-camera.js`'s, which is the engine's (CVM-2): the
  // offset `(-forward + 0.3 up) * 1.2 R` in the soldier's own yaw frame and
  // world up, the 0.6 s velocity lag, the `1 - exp(-2 dt)` ease and the 1 m
  // floor over the terrain or the sea, anchored on his eye. Two things are the
  // viewer's, each marked in `soldier-camera.js`: the radius
  // (`FOOT_CHASE_RADIUS`, INFERRED), and a pull-in in front of a wall, which
  // the engine's law has not got.
  //
  // Where it LOOKS is the viewer's too. The engine looks at the anchor, so its
  // chase view never pitches with the mouse; a man aiming at a plane would see
  // the back of his own head. Here the camera looks at the point his aim line
  // first meets (`aimDistance`), so the crosshair in the middle of the screen
  // covers what his round will hit, and the round itself still leaves his eye
  // down his own view axis (`footAimEye` below, XHIT-12), not the camera.
  const footAimDir = [0, 0, 0];
  const footAimFrom = [0, 0, 0];
  const footAimAt = [0, 0, 0];
  const groundAt = (x, z) => page.collider?.surfaceHeight?.(x, z) ?? NaN;
  const castStatic = (ox, oy, oz, dx, dy, dz, reach) => page.collider?.cast?.(
    ox, oy, oz, dx, dy, dz, reach, -1) ?? null;
  /** The last aim distance, for `__footView()`. */
  soldierView.footAimDistance = 0;

  function footChase(dt) {
    const yaw = page.footView.yaw;
    const pitch = page.footView.pitch;
    foot3pForward[0] = Math.sin(yaw);
    foot3pForward[1] = 0;
    foot3pForward[2] = Math.cos(yaw);
    const v = page.soldier.body.body.velocity;
    foot3pVelocity[0] = v.x; foot3pVelocity[1] = v.y; foot3pVelocity[2] = v.z;
    chaseTarget(foot3pForward, FOOT_3P_UP, FOOT_CHASE_RADIUS, CHASE_BEHIND, foot3pTarget);
    // Over the right shoulder (`FOOT_CHASE_SHOULDER`, a viewer choice): right
    // is forward x up, `(-cos yaw, 0, sin yaw)` in the page's convention.
    foot3pTarget[0] += -Math.cos(yaw) * FOOT_CHASE_SHOULDER;
    foot3pTarget[2] += Math.sin(yaw) * FOOT_CHASE_SHOULDER;
    chaseStep(foot3pRel, foot3pTarget, foot3pVelocity, CHASE_BEHIND, dt);
    foot3pAnchor[0] = footEye.x;
    foot3pAnchor[1] = footEye.y;
    foot3pAnchor[2] = footEye.z;
    const floorY = groundAt(footEye.x + foot3pRel[0], footEye.z + foot3pRel[2]);
    chaseEye(foot3pAnchor, foot3pRel, Number.isFinite(floorY) ? floorY : -Infinity, foot3pEye);
    // In front of a wall rather than inside it. Not folded back into `rel`, so
    // the view springs back out at the ease's own pace once he steps clear.
    const ox = foot3pEye[0] - footEye.x;
    const oy = foot3pEye[1] - footEye.y;
    const oz = foot3pEye[2] - footEye.z;
    const reach = Math.hypot(ox, oy, oz);
    if (reach > 1e-3) {
      const hit = castStatic(footEye.x, footEye.y, footEye.z, ox / reach, oy / reach, oz / reach, reach);
      if (hit && Number.isFinite(hit.t) && hit.t < reach) {
        const k = Math.max(FOOT_WALL_MIN, hit.t - FOOT_WALL_MARGIN) / reach;
        foot3pEye[0] = footEye.x + ox * k;
        foot3pEye[1] = footEye.y + oy * k;
        foot3pEye[2] = footEye.z + oz * k;
      }
    }
    page.camera.position.set(foot3pEye[0], foot3pEye[1], foot3pEye[2]);
    // Converge on the aim point.
    const cp = Math.cos(pitch);
    footAimDir[0] = Math.sin(yaw) * cp;
    footAimDir[1] = Math.sin(pitch);
    footAimDir[2] = Math.cos(yaw) * cp;
    footAimFrom[0] = footEye.x; footAimFrom[1] = footEye.y; footAimFrom[2] = footEye.z;
    const d = aimDistance(footAimFrom, footAimDir, { ground: groundAt, cast: castStatic });
    soldierView.footAimDistance = d;
    footAimAt[0] = footEye.x + footAimDir[0] * d;
    footAimAt[1] = footEye.y + footAimDir[1] * d;
    footAimAt[2] = footEye.z + footAimDir[2] * d;
    const look = lookAngles(foot3pEye, footAimAt);
    page.setLook(look.yaw, look.pitch);
  }

  // The soldier's own eye, looking where he looks, whatever the drawn camera
  // is doing. The hand weapon launches its rounds and hangs its (undrawn)
  // first-person rig off this in an outside view (`hand-weapon.js`
  // `eyeCamera`), so a round leaves the man and not the chase camera behind
  // him, and the muzzle flash shows at his gun. In first person it is the
  // camera's own pose, and nothing reads it. A camera, so the hand weapon's
  // zoom can write its FOV there without zooming the chase view.
  const footAimEye = new THREE.PerspectiveCamera(FOOT_FOV, 1, 0.1, 1000);
  footAimEye.name = 'soldier aim eye';
  const aimEyeLook = new THREE.Vector3();

  function placeAimEye() {
    const yaw = page.footView.yaw;
    const pitch = page.footView.pitch;
    const cp = Math.cos(pitch);
    footAimEye.position.set(footEye.x, footEye.y, footEye.z);
    aimEyeLook.set(footEye.x + Math.sin(yaw) * cp, footEye.y + Math.sin(pitch),
                   footEye.z + Math.cos(yaw) * cp);
    footAimEye.lookAt(aimEyeLook);
    footAimEye.updateMatrixWorld(true);
    // The drawn view outside the man keeps the soldier's own field of view:
    // the zoom the hand weapon eases goes to `footAimEye` meanwhile.
    if (!footView3p.firstPerson && !page.soldierDead && page.camera.fov !== FOOT_FOV) {
      page.camera.fov = FOOT_FOV;
      page.camera.updateProjectionMatrix();
    }
  }

  // The drawn subject's own height, for the framing above. Measured off the
  // canopy's bounding box the first time it is on screen -- the bundle's six-bone
  // chain rests with `Bone06` 13.68 m up and the mesh spans 13.49 m of that, so
  // the number is the data's and not a guess, and a mod with a different chute
  // gets its own. Zero while no canopy is drawn, which is when the subject is a
  // man and `PARACHUTE_VIEW_RADIUS` is the right distance for him.
  const footCanopyBox = new THREE.Box3();
  soldierView.footCanopyTop = 0;
  // Headroom over the exact fit. `chase-camera.js` lifts the eye by 0.3 R above
  // the anchor and looks back down at it (the engine's own offset), so a camera
  // placed at the distance that exactly fits the subject's height still cuts the
  // top of the canopy off -- measured on the frame, at span 13.303 m. 1.35 is a
  // viewer number, chosen on the frame, like `PARACHUTE_VIEW_RADIUS` beside it.
  const CANOPY_VIEW_MARGIN = 1.35;

  /** The body's feet, which is where its root sits. */
  function footBodyFeetY() {
    return page.footBody ? page.footBody.scene.position.y : footEye.y;
  }

  /** Feet to canopy top, in metres, or 0 when no canopy is drawn. */
  function canopySpan() {
    if (!page.footCanopy || !page.footCanopy.scene.visible) return 0;
    if (!soldierView.footCanopyTop) {
      footCanopyBox.setFromObject(page.footCanopy.scene);
      if (!footCanopyBox.isEmpty()) {
        soldierView.footCanopyTop = Math.max(0, footCanopyBox.max.y - footBodyFeetY());
      }
    }
    return soldierView.footCanopyTop;
  }

  // The canopy's external views. Held behind `?soldier3p=1` until 2026-09-22,
  // when the body and the canopy they point at were built: the flag is now
  // `?no-soldier3p=1` to put them back behind it, which is the one-line revert if
  // the result is not good enough. What they frame is `footBody` below -- the
  // soldier's own pose rig, played from the game's own clips -- and
  // `footCanopy`, the `Parachute` child the soldier has always carried.
  const SOLDIER_3P_VIEWS = !page.params.has('no-soldier3p');
  // A standing soldier had no external view from 2026-09-26 (F11 and C, both
  // beside the keys the owner walks with, were taking him out of first person
  // mid-stride; `features/viewer-foot-first-person`). Since 2026-10-15 he has
  // the chase view again: C toggles first person and the chase view, as the
  // owner reports retail does (2026-10-15), and F10 / F9 go straight to each.
  // F11's front view stays off on foot, so the canopy cycle that took him out
  // of first person mid-stride cannot come back
  // (`features/soldier-third-person-camera`).

  /**
   * Open the canopy's view cycle, close it again on the ground.
   *
   * `setCycle` drops a mode the new cycle cannot reach back to `inside`, so a
   * landing taken in the canopy's front view returns the page to first person,
   * and one taken in the chase view stays in the foot's chase view.
   */
  function syncFootView() {
    const open = SOLDIER_3P_VIEWS && page.soldier?.parachuteState === 'open';
    const before = footView3p.mode;
    // The engine's own cycle is `CVMInside` alone (`SoldierCamera` writes the
    // three external words to zero and `setViewMode` refuses a mode whose
    // byte is zero). The page widens it twice, both marked in
    // `soldier-camera.js`: under an open canopy to three views on C and
    // F9-F11, and on foot (since 2026-10-15) to first person and the chase
    // view on C, F9 and F10. `?no-soldier3p=1` takes both
    // back to the engine's one.
    if (open) footView3p.setCycle(PARACHUTE_VIEW_CYCLE);
    else footView3p.setCycle(SOLDIER_3P_VIEWS ? FOOT_VIEW_CYCLE : null);
    if (footView3p.mode !== before && footView3p.mode === VIEW_INSIDE) {
      foot3pRel[0] = foot3pRel[1] = foot3pRel[2] = 0;
    }
  }

  Object.assign(soldierView, {
    EMPTY_KEYS,
    canopySpan,
    foot3pRel,
    footAimEye,
    footView3p,
    onFootCamera,
    syncFootView,
  });
  return soldierView;
}
