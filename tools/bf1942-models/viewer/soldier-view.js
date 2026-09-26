// The human's camera on foot: the interpolated eye, the predicted look, the
// death cam, the swim and parachute views, the soldier's third-person views
// (`SoldierView`, the canopy framing), and the supply depot and fire calls
// the on-foot frame makes. Lifted out of map.html (features/vehicle-
// instance-refactor Part 2); `soldier-camera.js` stays the view law.

import * as THREE from 'three';
import { soldierLookDegrees } from './mouse-input.js';
import { CHASE_BEHIND, CHASE_AHEAD, CHASE_RADIUS_SCALE, chaseTarget, chaseStep, chaseEye } from './chase-camera.js';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { SoldierView, PARACHUTE_VIEW_CYCLE, PARACHUTE_VIEW_RADIUS, VIEW_INSIDE, VIEW_FRONT } from './soldier-camera.js';

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
    const per = soldierLookDegrees(page.footPending.x, page.footPending.y);
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
    } else if (!footView3p.firstPerson) {
      // C has taken the view outside the man. The offsets, the 0.6 s velocity
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
    }
    page.applyLook();
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
  // A standing soldier gets no external view (2026-09-26). Between 2026-09-23
  // and here the page widened his cycle on a switch of its own
  // (`soldierExternalViews`), because the engine gives him one view and the
  // owner wanted the seat's. He plays with it off: F11 and C sit beside the
  // keys he walks with, and an accidental F11 was taking him out of first
  // person mid-stride. See `features/viewer-foot-first-person/README.md`.

  /**
   * Open the canopy's view cycle, close it again on the ground.
   *
   * `setCycle` drops a mode the new cycle cannot reach back to `inside`, so a
   * landing always returns the page to first person however C left it, and the
   * offset is reset with it -- otherwise the next chute would open with the
   * camera still swinging in from the last one.
   */
  function syncFootView() {
    const open = SOLDIER_3P_VIEWS && page.soldier?.parachuteState === 'open';
    const before = footView3p.mode;
    // The canopy is the one place a soldier's cycle is wider than the
    // engine's. Everywhere else it is `SOLDIER_VIEW_CYCLE`, which is
    // `CVMInside` alone: `SoldierCamera` writes the three external words to
    // zero and `setViewMode` refuses a mode whose byte is zero, so C and
    // F9-F12 do nothing for a man on the ground. See `soldier-camera.js`.
    footView3p.setCycle(open ? PARACHUTE_VIEW_CYCLE : null);
    if (footView3p.mode !== before && footView3p.mode === VIEW_INSIDE) {
      foot3pRel[0] = foot3pRel[1] = foot3pRel[2] = 0;
    }
  }

  Object.assign(soldierView, {
    EMPTY_KEYS,
    canopySpan,
    foot3pRel,
    footView3p,
    onFootCamera,
    syncFootView,
  });
  return soldierView;
}
