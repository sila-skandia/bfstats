// The engine's own external (chase / front-chase) camera law.
//
// Framework-free: no three.js, no DOM. Vectors are plain `[x, y, z]` arrays in
// whatever world frame the caller uses, so the file runs unchanged under node
// (`tests/test_chase_camera.py`). The three.js half - reading node poses and
// writing the camera - is a few lines in `seat-camera.js`.
//
// WHAT WAS READ. `Camera::getTransformation(float dt, Mat4& out)`, lnxded
// `0x081aaf90` and its MSVC twin in the client, `0x005659b0`, instruction for
// instruction. Both open the same way:
//
//     root   = getRootParent(camera)               // lnxded 0x0818d4b0
//     rootM  = root->getAbsoluteTransformation()   // the HULL's matrix
//     camM   = camera->getAbsoluteTransformation() // the seat Camera's own
//     R      = root->getBoundingRadius() * 1.2
//
// and for view mode 12 (`CVMChase`) and 13 (`CVMFrontChase`) do
//
//     want = (-/+ rootM.forward + 0.3 * rootM.up) * R
//     rel += (want - rel -/+ 0.6 * velocity) * (1 - exp(-2 * dt))
//     eye  = camM.position + rel,   eye.y >= terrain(eye.x, eye.z) + 1
//     out  = lookAt(eye, camM.position, worldUp (0,1,0))
//
// `rel` is carried between frames as (last output translation - camM
// translation), in every mode, so C out of the cockpit starts from rel = 0 and
// the camera swoops out of the vehicle over about a second.
//
// WHICH NODE FRAMES IT (re-read 2026-09-30, ledger CVM-2). Two matrices
// enter the function and nothing else: `rootM`, whose rows +0x20 (forward)
// and +0x10 (up) give the direction, and `camM`, whose translation is the
// anchor and the look-at point. `getRootParent` climbs `+0x50` until the
// no-parent flag `0x02000000` is set, and `BCompositeObject::setParent`
// 0x08166050 is the only writer of that flag on an object (the two other
// `or 0x2000000` sites in the image, 0x08113149 and 0x0815c96a, are
// `PlayerAction` input bits), so it is the vehicle's root
// PlayerControlObject for every seat: a nested gunner's PCO included, never
// the tower. `camM` is the seat Camera's own absolute matrix, so its
// `setPivotPosition` is in the anchor (`Camera::handleUpdate` 0x081aa940,
// camera-pivot.js), but its rotation is not used at all: the view is a
// `calcLookAt` with world up, and the Camera's `setRotation` -- the
// `-179.999` a pintle MG's Camera carries to face back down a mount that is
// itself turned round -- and its parent play no part in an external view.
// They matter only to the inside view (mode 3), which is the Camera's whole
// matrix.
//
// WHAT THIS PAGE DOES. The law as read is the default for every seat whose
// Camera rides an aim axis: hull frame, anchored on that seat's Camera.
//
// Until 2026-09-30 the default was the W4-C brief's: the frame was the
// Camera's PARENT, so the view followed the turret (the owner kept that on
// 2026-09-21). On 268 seats across the trees the parent is turned 180
// degrees against the Camera -- the M1A1 and T72 commander MGs, the Humvee
// gunners, the Sherman, Panzer IV, Chi-ha and T34-85 pintle MGs -- and there
// that frame hung the eye in front of the gun looking back at it. The binary
// has no parent frame to get wrong. `?chase=turret` keeps a turret-following
// view for comparison, framed off the Camera node's own axes (its
// `setRotation` included, so a flipped mount faces the right way); that one
// is a VIEWER CHOICE, not an engine reading.

/** `R = getBoundingRadius() * 1.2`. lnxded `0x086c4f64`, client `0x008fb7d0`. */
export const CHASE_RADIUS_SCALE = 1.2;
/** The up term of the wanted offset. lnxded `0x086c030c`, client `0x008d6434`. */
export const CHASE_UP_FRACTION = 0.3;
/** Seconds of velocity the camera trails by. lnxded `0x086c4f68`, client `0x008eb33c`. */
export const CHASE_SPEED_LAG = 0.6;
/** `1 - exp(-2 dt)`. lnxded `0x086c4f6c` (-2.0 into `expf`), client `0x008ea538`. */
export const CHASE_EASE_RATE = 2.0;
/** The eye never sits lower than this above the terrain. lnxded
 *  `0x081ac233`-`0x081ac238` (terrain-height call, `fld1`, `faddp`), client
 *  `0x00565ed2`-`0x00565ed5`. */
export const CHASE_FLOOR_CLEARANCE = 1.0;

// THE FLY-BY (mode 14, `CVMFlyBy`, F12; read 2026-11-01, ledger CVM-5). The
// same function, lnxded `0x081abba8`-`0x081abd4d`, client `0x00565f00`-
// `0x00566040`. With the view's `traceValid` set it stands a tripod AHEAD of
// the hull and keeps it there:
//
//     if (lastViewMode != 14) frames.clear()       // entering the mode
//     P = camM.pos + (rootM.forward * R + 0.3 * velocity) * (0.4 * K)
//     P.y >= terrain(P.x, P.z) + 1
//     writeFrame(clock, P, K * 60)   // appended only once the OLDEST frame is
//                                    // K * 60 s old (or the list is empty)
//     eye = readFrame(clock)         // the newest frame whose time has come
//     out = lookAt(eye, camM.position, worldUp), eye.y >= terrain + 0.5
//
// `K` is `Camera+0x198` (client `+0x1b0`), seeded 8.0 by both constructors
// (lnxded `0x081a99ae`, `0x081a9d9e`; client `0x005655d7`) and written by
// nothing else, so the tripod is planted 3.84 R plus 0.96 s of travel ahead
// and a new one is written only after 480 s in the mode: in practice one
// tripod for as long as the view is held. The frames are written at the
// current clock, so `readFrame`'s interpolation never runs between two of
// them; a new frame is a cut. Leaving the mode and coming back plants again.

/** `0.4` of the fly-by's offset. lnxded `0x086c4f70`, client `0x008eb264`. */
export const FLYBY_OFFSET_SCALE = 0.4;
/** Seconds of velocity in the offset: the same 0.3 as the chase's up term,
 *  lnxded `0x086c030c`, client `0x008d6434`. */
export const FLYBY_SPEED_FRACTION = 0.3;
/** `Camera+0x198`, 8.0 from both constructors and never rewritten. */
export const FLYBY_CAMERA_K = 8.0;
/** Seconds before a second tripod is written: `K * 60`. lnxded `0x086c08b8` (60.0), client `0x008dba44`. */
export const FLYBY_HOLD = FLYBY_CAMERA_K * 60;
/** The tripod is planted at least this far over the terrain (`fld1` after the height call at `0x081abcf1`). */
export const FLYBY_PLANT_CLEARANCE = 1.0;
/** The eye output is held this far over the terrain (`0x081ab436`, mode 14 only). */
export const FLYBY_EYE_CLEARANCE = 0.5;

/**
 * Where the fly-by's tripod stands: `anchor + (forward R' + 0.3 v) 0.4 K`,
 * with `R' = 1.2 R`, at least a metre over `floorY`.
 *
 * @param {number[]} anchor   the seat Camera's world position (`camM.pos`)
 * @param {number[]} forward  unit forward of the hull's root
 * @param {number[]} velocity the root's velocity, metres a second
 * @param {number} radius     the root's bounding radius, unscaled
 * @param {(x: number, z: number) => number} [floor] terrain height under a point
 * @param {number[]} [out]
 */
export function flybyPlant(anchor, forward, velocity, radius, floor, out = [0, 0, 0]) {
  const r = radius * CHASE_RADIUS_SCALE;
  const k = FLYBY_OFFSET_SCALE * FLYBY_CAMERA_K;
  for (let i = 0; i < 3; i += 1) {
    const v = velocity ? velocity[i] : 0;
    out[i] = anchor[i] + (forward[i] * r + FLYBY_SPEED_FRACTION * v) * k;
  }
  const y = floor ? floor(out[0], out[2]) : NaN;
  if (Number.isFinite(y) && out[1] < y + FLYBY_PLANT_CLEARANCE) out[1] = y + FLYBY_PLANT_CLEARANCE;
  return out;
}

/**
 * The fly-by's tripod for this frame: the one planted at `state.t`, or a new
 * one when there is none, the clock ran backwards, or `FLYBY_HOLD` seconds
 * have passed since it was planted. `plant()` returns the new position.
 * `state` is `{ at: number[] | null, t: number }`, updated in place.
 *
 * @returns {boolean} whether it planted this frame
 */
export function flybyStep(state, clock, plant) {
  if (!state.at || !(clock >= state.t) || clock - state.t >= FLYBY_HOLD) {
    state.at = plant();
    state.t = clock;
    return true;
  }
  return false;
}

/** View-mode sign: the chase camera hangs behind (-forward), front-chase ahead. */
export const CHASE_BEHIND = -1;
export const CHASE_AHEAD = 1;

/**
 * `BCompositeObject::getBoundingRadius` (lnxded `0x08165630`): the larger of
 * the object's own geometry radius and, over its children, `|child relative
 * position| + child radius`, recursively.
 *
 * What the engine takes for "own geometry radius" is the geometry object's
 * slot `+0x20`, which was not read; the page feeds each mesh's bounding-sphere
 * reach about its own origin. UNVERIFIED that the two agree to the centimetre.
 *
 * @param {{radius?: number, offset?: number[], children?: object[]}} node
 *   `radius` is the node's own geometry radius about its origin, `offset` its
 *   position relative to its parent.
 */
export function boundingRadius(node) {
  if (!node) return 0;
  let best = Number.isFinite(node.radius) ? Math.max(0, node.radius) : 0;
  for (const child of node.children || []) {
    const o = child.offset || [0, 0, 0];
    const reach = Math.hypot(o[0], o[1], o[2]) + boundingRadius(child);
    if (reach > best) best = reach;
  }
  return best;
}

/**
 * The offset the camera is easing toward, from the anchor.
 *
 * @param {number[]} forward unit forward of the frame (the hull's, in the engine)
 * @param {number[]} up      unit up of the same frame
 * @param {number} radius    the root's bounding radius, unscaled
 * @param {number} sign      CHASE_BEHIND or CHASE_AHEAD
 * @param {number[]} [out]
 */
export function chaseTarget(forward, up, radius, sign, out = [0, 0, 0]) {
  const r = radius * CHASE_RADIUS_SCALE;
  for (let i = 0; i < 3; i += 1) {
    out[i] = (sign * forward[i] + CHASE_UP_FRACTION * up[i]) * r;
  }
  return out;
}

/**
 * One frame of the ease. `rel` is updated in place and returned.
 *
 * The velocity term has the view's own sign: the chase camera trails a moving
 * vehicle by 0.6 s of travel, the front camera leads it by as much.
 *
 * `dt <= 0` leaves `rel` alone, which is what the engine does (it replays the
 * previous matrix on a zero `dt`, lnxded `0x081aafe8`).
 */
export function chaseStep(rel, target, velocity, sign, dt) {
  if (!(dt > 0)) return rel;
  const k = 1 - Math.exp(-CHASE_EASE_RATE * dt);
  for (let i = 0; i < 3; i += 1) {
    const v = velocity ? velocity[i] : 0;
    rel[i] += (target[i] - rel[i] + sign * CHASE_SPEED_LAG * v) * k;
  }
  return rel;
}

/**
 * The eye: anchor + rel, lifted clear of the ground. The lift is folded back
 * into `rel`, as the engine's is - it stores `rel` from the matrix it output.
 *
 * @param {number[]} anchor the seat Camera's world position
 * @param {number[]} rel
 * @param {number} floorY terrain height under the eye, or -Infinity
 * @param {number[]} [out]
 */
export function chaseEye(anchor, rel, floorY, out = [0, 0, 0]) {
  out[0] = anchor[0] + rel[0];
  out[1] = anchor[1] + rel[1];
  out[2] = anchor[2] + rel[2];
  if (Number.isFinite(floorY) && out[1] < floorY + CHASE_FLOOR_CLEARANCE) {
    out[1] = floorY + CHASE_FLOOR_CLEARANCE;
    rel[1] = out[1] - anchor[1];
  }
  return out;
}

/**
 * Which law an external view runs under, from the page's `?chase=` switch,
 * whether the seat Camera rides an aim axis, whether the hull floats, and
 * whether it flies.
 *
 *   (absent)  the law as read, for a seat whose Camera rides an aim axis, or
 *             whose hull floats or flies: hull (root) frame, anchored on the
 *             seat's Camera. Every other seat keeps the old viewer framing,
 *             as the W4-C brief fenced it
 *   engine    the law as read for every driven vehicle, turret or not
 *   turret    a seat whose Camera rides an aim axis follows it: the frame is
 *             the Camera node's own (a viewer choice, not the engine's)
 *   legacy    the old viewer framing everywhere
 *
 * A floating hull takes the engine law because the viewer's own framing
 * offsets from the hull's ORIGIN, and a ship's origin is the keel: a PBR's
 * floaters sit 2.6 m up its frame, so the front view's 1.6 m of lift put the
 * eye a metre under the river. The engine's anchor is the seat Camera, on
 * the bridge, and its 1 m floor is over the sea (`groundHeight` is
 * `max(terrain, sea)`).
 *
 * An aircraft takes it since 2026-11-01 (CVM-6): nothing in
 * `getTransformation` tells an aircraft from a tank -- the radius and the
 * velocity are the root's, whatever it is -- so the chase hangs `1.2 R`
 * plus 0.6 s of flight behind, 50-70 m at cruise, where the viewer's
 * framing held a plane 17 m back. The replay already ran the law; the page
 * and the replay now agree.
 *
 * `frame` names the node whose axes give forward and up: `hull` for the
 * vehicle root, `camera` for the seat's Camera node itself. There is no
 * parent frame: the Camera's parent is turned round under every pintle MG
 * whose Camera faces back down it, and nothing in the engine reads it.
 *
 * @returns {{law: 'engine'|'legacy', frame: 'hull'|'camera'}}
 */
export function chaseLawFor(option, ridesTurret, floats = false, flies = false) {
  switch (option) {
    case 'legacy': return { law: 'legacy', frame: 'hull' };
    case 'engine': return { law: 'engine', frame: 'hull' };
    case 'turret': return ridesTurret
      ? { law: 'engine', frame: 'camera' }
      : floats || flies ? { law: 'engine', frame: 'hull' } : { law: 'legacy', frame: 'hull' };
    default: return ridesTurret || floats || flies
      ? { law: 'engine', frame: 'hull' }
      : { law: 'legacy', frame: 'hull' };
  }
}

/**
 * The node whose axes `chaseTarget` hangs the offset off, for `law.frame`:
 * the vehicle root, or under `?chase=turret` the seat Camera itself. Never
 * the Camera's parent (see `chaseLawFor`). Generic, so the node harness can
 * hand it plain objects.
 *
 * @template T
 * @param {{frame: 'hull'|'camera'}|null} law `chaseLawFor`'s answer
 * @param {T} root the vehicle's root node
 * @param {T} camera the seat's Camera node
 * @returns {T}
 */
export function chaseFrameNode(law, root, camera) {
  return law?.frame === 'camera' && camera ? camera : root;
}
