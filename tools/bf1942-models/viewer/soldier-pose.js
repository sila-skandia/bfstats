// The soldier's poses: the flag bits and the pose they select, and what each
// pose measures — eye height, collision extents, the eye's travel time.
//
// Split out of `physics.js`, which re-exports all of it.

// --- the soldier -----------------------------------------------------------

export const POSE_STAND = 0;
export const POSE_CROUCH = 1;
export const POSE_PRONE = 2;

/** `c_SstCrouch`, `c_SstLie`, `c_SstJump` as they sit in the pose flags byte. */
export const POSE_FLAG_CROUCH = 0x20;
export const POSE_FLAG_PRONE = 0x40;
export const POSE_FLAG_JUMP = 0x80;

/**
 * The pose index the engine derives from the flags, at `0x005013f8`:
 *
 *     pose = (flags & 0x20) ? 1 : (flags & 0x40) >> 5
 *
 * Crouch wins over prone when both bits are somehow set, and the prone bit is
 * shifted rather than tested, which is how bit 6 becomes the value 2.
 */
export function poseFromFlags(flags) {
  return (flags & POSE_FLAG_CROUCH) ? POSE_CROUCH
    : ((flags & POSE_FLAG_PRONE) >> 5);
}

/**
 * Eye height above the feet, per pose.
 *
 * `CommonSoldierData.inc` gives the camera as an offset from the soldier's own
 * origin, not from the ground:
 *
 *     setPoseCameraPos c_BfSoldierStanding   0/0.65/0
 *     setPoseCameraPos c_BfSoldierCrouching  0/0.12/0
 *     setPoseCameraPos c_BfSoldierLying      0/-0.7/0
 *     setCharacterHeight -1.00
 *
 * Read literally the standing eye would be 0.65 m off the floor, which is
 * absurd, so the origin is not at the feet. `setCharacterHeight -1.00` is the
 * missing metre: the contact point sits 1 m *below* the origin. Adding it back
 * gives 1.65 / 1.12 / 0.30 m, which are exactly the heights a standing,
 * crouching and prone man's eyes sit at. The three offsets are `confirmed`
 * shipped data; reading `characterHeight` as the origin-to-feet distance is
 * `strong inference`.
 */
export const CHARACTER_HEIGHT = 1.0;
export const POSE_CAMERA_POS = Object.freeze([0.65, 0.12, -0.7]);
export const EYE_HEIGHT = Object.freeze(
  POSE_CAMERA_POS.map(offset => CHARACTER_HEIGHT + offset));

/**
 * Collision extents per pose. **Viewer choices, not engine data.**
 *
 * The shipped body collider is a mesh (`ObjectTemplate.geometry BodyCollision`)
 * plus eight `setSkeletonCollisionBone` capsules for *hit* detection, neither
 * of which is a movement volume. **The engine has no movement capsule at all**
 * (PHY-1): the collider it sweeps is the object's own `SimpleCollisionMesh`
 * vertices, walked by `ResponsePhysics::checkVsTerrain` (`0x0825a960`) over
 * `getVertexCollision` and `getFaceCollision`. There is no ray and no capsule
 * to go looking for.
 *
 * These are a plain vertical capsule sized off the eye heights above: a man is
 * about 0.15 m of skull above his eyes, and 0.3 m is a shoulder's half-width.
 * Prone is modelled as a short column rather than a lying capsule, which is
 * wrong in the pedantic sense and invisible in the first-person view this
 * drives.
 */
export const BODY_HEIGHT = Object.freeze([1.80, 1.30, 0.60]);
export const BODY_RADIUS = 0.3;

/**
 * Seconds the eye takes to travel between two poses, when nobody says otherwise.
 *
 * A pose change that teleported the camera half a metre reads as a glitch
 * rather than as ducking, so the eye is animated. 0.09 s is a placeholder for a
 * caller that does not care; `soldier.js` passes the real per-transition
 * durations, which come off the animation clips
 * (`animations/AnimationStatesCrouching.con` and `...Lie.con`) and differ by a
 * factor of four between dropping prone and standing back up.
 */
export const POSE_TRANSITION = 0.09;
