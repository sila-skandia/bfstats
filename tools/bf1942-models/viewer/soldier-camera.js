// What C does to a soldier: the engine's camera view modes, and the one the
// viewer adds under a parachute.
//
// Imports nothing, so `tests/soldier_camera_harness.mjs` runs it under node.
// The three.js half -- placing the eye -- is a few lines in `map.html`, and the
// external offsets and ease it uses are `chase-camera.js`'s, which are the
// engine's own (W4-C read them out of both binaries).
//
// WHAT WAS READ.
//
// The key. `c_PIToggleCameraMode` is **input channel 26**, decoded from
// `dice::ref2::io::Module::init()` (lnxded `0x083f8870`) by walking its
// `addConstantHelper(name, index)` calls (`0x083f7f40`) -- the same sweep that
// AI-2 did, re-run here, and it puts `c_PIToggleCamera` at 27 and
// `c_PIMenuSelect9` at 22, which is PARA-4's ripcord bit. The shipped control
// maps bind it to C in **every** context, infantry included:
//
//     Settings/Default/Controls/{Infantry,Land,Air,Common,Common_Japanese}.con
//     ControlMap.addKeyToTriggerMapping c_PIToggleCameraMode IDFKeyboard IDKey_C c_CMNonRepetive
//
// and `IDKey_C` is bound to nothing else in any of them (`grep -n 'IDKey_C\b'`
// over that directory returns those five lines and no others).
//
// The modes. `Camera::setViewMode(CameraViewMode, IObject*, bool)` (lnxded
// `0x081ac7c0`) is a switch over the mode id in which **every arm is gated on
// one byte of the camera's template**, and returns 0 -- refusing the change --
// when that byte is zero:
//
//     mode 3     template +0x1bc     also calls BFSoldier::setFirstPerson(true)
//     mode 0xc   template +0x1bd
//     mode 0xd   template +0x1c1
//     mode 0xe   template +0x1be
//     mode 0x10  template +0x1bf     plants the eye 20 m along the object's forward
//     mode 0x11  template +0x1c0     uses the externally set transform (+0x8c/+0x90)
//     default    return 0
//
// `CameraTemplate::CameraTemplate()` (`0x081acc20`) seeds +0x1bc, +0x1bd,
// +0x1be and +0x1c1 to **1** and +0x1bf, +0x1c0 to **0**, so a camera that
// authors no `CVM*` word at all -- which is every vehicle camera in vanilla
// but ten -- allows inside, chase, front-chase and fly-by, and refuses the two
// trace modes. That is why the ten artillery pieces that want the spotter view
// say `ObjectTemplate.CVMExternTrace 1` and nothing else does.
//
// The soldier. `Objects/Soldiers/Common/Objects.con` is the only place in
// vanilla that writes the other five words, and it writes them all to zero:
//
//     ObjectTemplate.create Camera SoldierCamera
//     ObjectTemplate.CVMInside 1
//     ObjectTemplate.CVMChase 0
//     ObjectTemplate.CVMFrontChase 0
//     ObjectTemplate.CVMFlyBy 0
//     ObjectTemplate.CVMTrace 0
//     ObjectTemplate.CVMExternTrace 0
//
// `CommonSoldierData.inc` hangs exactly one of these on every soldier
// (`addTemplate SoldierCamera`), `BFSoldier::getCameras()` (`0x0827f7a0`)
// returns the one-element `std::list<ICameraObject*>` at `BFSoldier+0x3f0`,
// and `BFSoldier::nextCamera()` (`0x0827f7c0`) is an **empty function** --
// `PlayerControlObject::nextCamera()` (`0x083186b0`) is the one that really
// cycles, and a soldier does not inherit it. Nothing in the parachute path
// (`setIsParachuting` `0x08276f90`, `handleUpdate`'s two parachute arms,
// `handleMessage`'s message 18) touches the camera or its template.
//
// So the engine's own set for a soldier -- standing or under a canopy -- is
// ONE view, and `setViewMode` refuses the rest.
//
// WHAT THIS FILE DOES ANYWAY, AND WHY IT IS MARKED. The owner plays the game
// and reports that C rotates the view of a parachuting soldier. The dedicated
// server is not the authority for that: it never toggles a view mode at all.
// `Camera::setViewMode` has exactly **two** call sites in the whole image
// (`0x081a9a4a` and `0x081a9e3a`, both inside the Camera subsystem itself),
// and neither is reached from an input path -- a headless server has no camera
// to toggle, which is also the likely reason `BFSoldier::nextCamera` is empty
// there. The consumer is in the client, and this stream did not find it. So
// the CVM reading above may be the whole story, or the client may reach past
// it for a parachutist.
//
// (A `PlayerInput` is a **59-slot array of analog values**, not a packed
// bitfield: `BFSoldier::handlePlayerInput` copies it with `mov eax,0x3b; rep
// movsd` at `0x08273cfc`, and `GameServer::checkPlayerTriggers(BFPlayer*,
// PlayerInput)` -- which takes it by value -- reads channels 14 to 22 at
// `[ebp+0x48]` through `[ebp+0x68]`, four bytes apart, and nothing past 22.
// So a channel is never read with a shift, and scanning for one proves
// nothing; the call-site count above is the evidence.)
//
// `PARACHUTE_VIEW_CYCLE` is therefore a **VIEWER CHOICE MADE TO THE OWNER'S
// PLAY, not an engine reading**, in the same way `chase-camera.js`'s default
// frame is a choice made to the W4-C brief. It is confined to the canopy: on
// foot and in free fall `SOLDIER_VIEW_CYCLE` is the engine's own set of one,
// and C does nothing, which is what the shipped data says.
//
// 2026-10-15: on foot the page widens it again, to `FOOT_VIEW_CYCLE`
// (inside and chase, on F9 and F10 and not on C), because the owner plays
// retail and reports a third-person view on foot there. That is a second
// viewer departure, marked where it is defined below.

/** `setViewMode` case 3. First person -- the only one a soldier authorises. */
export const VIEW_INSIDE = 'inside';
/** `setViewMode` case 0xc, `CVMChase`: behind, `chase-camera.js`'s law. */
export const VIEW_CHASE = 'chase';
/** `setViewMode` case 0xd, `CVMFrontChase`: ahead, the same law mirrored. */
export const VIEW_FRONT = 'front';

/**
 * The engine's own mode ids, as `Camera::setViewMode`'s switch labels them and
 * `Camera::getViewMode` (`0x081acc10`) reads them back out of `Camera+0x14c`.
 *
 * 14, 16 and 17 are named for completeness -- fly-by and the two trace modes.
 *
 * Each `CVM*` word's byte is **read from its console registration**, not
 * inferred. The six words are six `ConsoleClass` singletons built by the
 * static initialiser at `0x081b3fdd`-`0x081b43e3`, each pairing a name string
 * with a descriptor whose `executeObjectMethod` writes one template byte:
 *
 *     CVMInside      0x086c541a  ConsoleClass223  0x081d1a20  -> +0x1bc  (3)
 *     CVMChase       0x086c5411  ConsoleClass224  0x081d1e30  -> +0x1bd  (12)
 *     CVMFrontChase  0x086c5403  ConsoleClass225  0x081d2240  -> +0x1c1  (13)
 *     CVMFlyBy       0x086c53fa  ConsoleClass226  0x081d2650  -> +0x1be  (14)
 *     CVMTrace       0x086c53f1  ConsoleClass227  0x081d2a60  -> +0x1bf  (16)
 *     CVMExternTrace 0x086c53e2  ConsoleClass228  0x081d2e70  -> +0x1c0  (17)
 */
export const VIEW_MODE_ID = Object.freeze({
  [VIEW_INSIDE]: 3,
  [VIEW_CHASE]: 12,
  [VIEW_FRONT]: 13,
  flyby: 14,
  trace: 16,
  externTrace: 17,
});

/**
 * `SoldierCamera`'s six `CVM*` words, verbatim from
 * `Objects/Soldiers/Common/Objects.con`.
 */
export const SOLDIER_CAMERA_CVM = Object.freeze({
  CVMInside: 1,
  CVMChase: 0,
  CVMFrontChase: 0,
  CVMFlyBy: 0,
  CVMTrace: 0,
  CVMExternTrace: 0,
});

/**
 * What a soldier's camera actually allows, per `setViewMode`'s gate: the modes
 * whose `CVM*` word is non-zero. One.
 */
export const SOLDIER_VIEW_CYCLE = Object.freeze(
  [VIEW_INSIDE, VIEW_CHASE, VIEW_FRONT].filter((mode) => (
    SOLDIER_CAMERA_CVM[{
      [VIEW_INSIDE]: 'CVMInside',
      [VIEW_CHASE]: 'CVMChase',
      [VIEW_FRONT]: 'CVMFrontChase',
    }[mode]] !== 0)));

/**
 * The cycle C runs under an open canopy. **A viewer choice, see the header.**
 *
 * Same order the engine's mode ids are in, so the cycle reads inside ->
 * chase -> front-chase and back, and the first press leaves first person,
 * which is what the owner described.
 */
export const PARACHUTE_VIEW_CYCLE = Object.freeze([
  VIEW_INSIDE, VIEW_CHASE, VIEW_FRONT,
]);

/**
 * The views a soldier ON FOOT may reach (2026-10-15). **A VIEWER DEPARTURE
 * FROM CAM-1, made to the owner's play, not an engine reading.** The shipped
 * `SoldierCamera` writes `CVMChase 0` and the dedicated server's
 * `setViewMode` refuses the mode; the owner plays the retail client and
 * reports that it does give a soldier a third-person view, and that a reload
 * started there never completes. This page builds the view and deliberately
 * does not copy the reload bug. The client's handler for `c_PICameraMode2`
 * was not found (CAM-2 stays UNVERIFIED), so the reading and the report still
 * disagree, and the report is what is built.
 *
 * Inside and chase only. Front-chase and fly-by are left out on purpose: F11
 * (`c_PICameraMode3`) and C were what took the owner out of first person
 * mid-stride on 2026-09-26, when an earlier `FOOT_VIEW_CYCLE` ran all three
 * behind `?foot3p=1` (`features/viewer-foot-first-person`). So on foot F10 is
 * the way out and F9 the way back, and C does not toggle (`toggles: false`
 * in `soldier-view.js`); the touch layout's VIEW button does, a phone having
 * no F keys. See `features/soldier-third-person-camera/README.md`.
 */
export const FOOT_VIEW_CYCLE = Object.freeze([VIEW_INSIDE, VIEW_CHASE]);

/**
 * The chase radius on foot, metres, before `CHASE_RADIUS_SCALE`: the eye
 * rests 3.0 m behind the anchor and 0.9 m above it (`chase-camera.js`'s
 * `(-forward + 0.3 up) * 1.2 R`, which is the engine's, CVM-2).
 *
 * The engine's R is the soldier root's `getBoundingRadius()`, which nobody
 * has pinned for a soldier (PARA-6: 1.0 with the `Parachute` child counting
 * for nothing, 13.79 with its mesh in full). **INFERRED, chosen on the
 * frame**: 2.5 frames the whole man standing, crouched and prone, with room
 * to see what he aims at.
 */
export const FOOT_CHASE_RADIUS = 2.5;

/**
 * The longest aim line the chase view converges on, metres. Past it the
 * crosshair's line and the round's are parallel to within the camera's
 * offset. **INFERRED**, a viewer number: the engine's chase view looks at the
 * eye, not along the aim (CVM-2), so it has no such distance.
 */
export const FOOT_AIM_REACH = 300;

/** The nearest aim point the chase view converges on, metres: closer than
 *  this the view would swing round onto the man's own shoulder. INFERRED. */
export const FOOT_AIM_NEAR = 2;

/** How far in front of a wall the chase camera is pulled in, metres, and the
 *  closest it comes to the anchor. INFERRED: the engine's chase view keeps
 *  1 m above the terrain and nothing else (CVM-2), so a soldier with his back
 *  to a wall would put the camera inside it. The corpse cam does the same. */
export const FOOT_WALL_MARGIN = 0.3;
export const FOOT_WALL_MIN = 0.5;

/**
 * How far along the aim line the first thing in the way is: the point the
 * chase camera looks at, so the crosshair at the centre of the screen covers
 * what the round will hit. The round leaves the soldier's EYE down his view
 * axis (XHIT-12, `fireInCameraDof`), not the chase camera.
 *
 * `ground(x, z)` is the surface height under a point (NaN off it), and
 * `cast(ox, oy, oz, dx, dy, dz, reach)` the first static along a ray as
 * `{ t }` or null. Either may be absent. The ground is marched in steps that
 * grow with the distance (5% of it, at least 0.5 m) and the crossing refined
 * by bisection: a few centimetres near the man, under a metre at the far end,
 * for about a hundred height reads a frame.
 *
 * @param {number[]} eye  the soldier's eye, `[x, y, z]`
 * @param {number[]} dir  his unit view direction
 * @returns {number} metres, clamped to `[FOOT_AIM_NEAR, reach]`
 */
export function aimDistance(eye, dir, { ground = null, cast = null,
  reach = FOOT_AIM_REACH } = {}) {
  let best = reach;
  if (cast) {
    const hit = cast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], reach);
    if (hit && Number.isFinite(hit.t) && hit.t < best) best = hit.t;
  }
  if (ground && dir[1] < 0.999) {
    const below = (t) => {
      const h = ground(eye[0] + dir[0] * t, eye[2] + dir[2] * t);
      return Number.isFinite(h) && eye[1] + dir[1] * t <= h;
    };
    let last = 0;
    for (let t = 0.5; t < best; t += Math.max(0.5, t * 0.05)) {
      if (below(t)) {
        let lo = last;
        let hi = t;
        for (let i = 0; i < 6; i += 1) {
          const mid = (lo + hi) / 2;
          if (below(mid)) hi = mid; else lo = mid;
        }
        best = Math.min(best, hi);
        break;
      }
      last = t;
    }
  }
  return Math.max(FOOT_AIM_NEAR, Math.min(reach, best));
}

/**
 * The yaw and pitch that look from `from` at `to`, in the page's convention:
 * forward is `(sin yaw cos pitch, sin pitch, cos yaw cos pitch)`.
 */
export function lookAngles(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * The radius the external views hang at, in metres, before
 * `CHASE_RADIUS_SCALE`.
 *
 * `chase-camera.js` takes the root's `getBoundingRadius()`, and for a soldier
 * that number is exactly the one PARA-6 cannot pin: 1.0 if the `Parachute`
 * child contributes nothing, 13.79 if its mesh counts in full. 3.0 is
 * neither -- it is the distance that frames a man and an open canopy, and it
 * is a **viewer number**, marked as such, like the cycle it serves.
 */
export const PARACHUTE_VIEW_RADIUS = 3.0;

/**
 * One soldier's view mode, and what C does to it.
 *
 * Deliberately not a camera: it holds a mode and answers with the next one,
 * and the page places the eye. That keeps it testable under node and keeps
 * the three.js in `map.html`.
 */
export class SoldierView {
  /**
   * @param {{cycle?: readonly string[]}} [options] the allowed cycle; defaults
   *   to the engine's own set of one, so a caller that asks for nothing gets
   *   the shipped behaviour.
   */
  constructor(options = {}) {
    this._cycle = options.cycle && options.cycle.length
      ? [...options.cycle] : [...SOLDIER_VIEW_CYCLE];
    this.mode = this._cycle[0];
    /** Whether C walks the cycle. The F keys (`setMode`) always may. */
    this.toggles = options.toggles !== false;
  }

  /** The modes this view can reach, in cycle order. */
  get modes() { return [...this._cycle]; }

  /** True while the mode is the engine's `CVMInside`. */
  get firstPerson() { return this.mode === VIEW_INSIDE; }

  /** The engine's own id for the current mode. */
  get modeId() { return VIEW_MODE_ID[this.mode]; }

  /** Swap the cycle -- the page does this as the chute opens and closes.
   *  `toggles: false` keeps C off it (on foot, `FOOT_VIEW_CYCLE`). */
  setCycle(cycle, { toggles = true } = {}) {
    this.toggles = toggles;
    const next = cycle && cycle.length ? [...cycle] : [...SOLDIER_VIEW_CYCLE];
    if (next.length === this._cycle.length
      && next.every((m, i) => m === this._cycle[i])) return this.mode;
    this._cycle = next;
    // A mode the new cycle cannot reach falls back to its first, which is
    // always `inside`: closing the chute must not leave the page in a chase
    // view a standing soldier is not allowed.
    if (!this._cycle.includes(this.mode)) this.mode = this._cycle[0];
    return this.mode;
  }

  /** Select a mode the cycle allows, or leave it alone. `setViewMode`'s gate. */
  setMode(mode) {
    if (this._cycle.includes(mode)) this.mode = mode;
    return this.mode;
  }

  /** What C does: the next view round the cycle. Nothing where the cycle
   *  does not toggle, unless `force` (the touch layout's VIEW button). */
  cycle({ force = false } = {}) {
    if (!this.toggles && !force) return this.mode;
    const i = this._cycle.indexOf(this.mode);
    this.mode = this._cycle[(i + 1) % this._cycle.length];
    return this.mode;
  }

  /** Back to first person, without touching the cycle. */
  reset() {
    this.mode = this._cycle.includes(VIEW_INSIDE) ? VIEW_INSIDE : this._cycle[0];
    return this.mode;
  }
}
