/**
 * Seated occupants: which body a seat draws, which pose it plays, and where
 * `addSkeletonIK` puts the hands.
 *
 * Plain numbers throughout, no `three` import, so `tests/seat_ik_harness.mjs`
 * can exercise the whole of it under node. `map.html` reads three.js matrices,
 * hands the numbers here, and writes the answers back onto bones.
 *
 * ## What the engine does
 *
 * `AnimatedBundle::updateIk` (lnxded `0x08265880`) runs once per frame for a
 * bundle that has a seated `BFSoldier` above it. For each `SkeletonIkInfo` on
 * its template it:
 *
 *  1. walks `getChild()` and then `targetChild` siblings (`0x82659f4`), or
 *     takes the declaring bundle itself when the index is negative
 *     (`0x82659f2`), and reads `getAbsoluteTransformation()` off what it lands
 *     on (`vptr+0x40`);
 *  2. transforms the entry's position triple by that matrix (`0x8265a94`
 *     onwards -- a row-vector point transform, translation row added last);
 *  3. re-expresses the result in the soldier's own frame by the rigid inverse
 *     of the soldier's world matrix, built inline at `0x8265b3f`;
 *  4. multiplies the entry's baked rotation matrix by the target's rotation in
 *     that same frame (`BaseMatrix4<float>::mult`, `0x826600f`);
 *  5. and calls `Skeleton::applyIk(boneIndex, position, rotation)`
 *     (`0x08342610`), which only *records* an `IkHandle` against the bone.
 *
 * The solve happens in `Skeleton::transform` (`0x083420f0`): a bone carrying a
 * handle goes through `Skeleton::applyIK2BoneSolver` (`0x083418f0`, which is a
 * wrapper over `maya::applyIK2BoneSolver`, `0x08332e10`) using bones `i-1` and
 * `i-2` -- the forearm and the upper arm -- to reach the recorded position;
 * then the bone's world **rotation rows are overwritten outright** with the
 * handle's (`0x8342233`-`0x83422a7`), keeping the translation the solve just
 * produced. So it is a two-bone reach *and* a hand override, not one or the
 * other: the arm reaches, and the hand is then planted at the declared angle
 * regardless of where the arm came from.
 *
 * ## The two triples
 *
 * `ObjectTemplate.addSkeletonIK <bone> <x/y/z> <yaw/pitch/roll>` -- the second
 * triple is **Refractor yaw/pitch/roll in degrees**, in the target child's
 * frame, and is baked into a matrix at parse time by `dice::ref2::setRotation`
 * (`0x08060d30`), which is the *same* helper `BundleTemplate::setRotation`
 * (`0x081a9085`) uses for `ObjectTemplate.setRotation`. It applies
 * `yaw` about the matrix's own Y row, then `pitch` about its X row, then
 * `roll` about its Z row (`0x08061db0`/`0x08061dd0`/`0x08061df0`), each
 * through `rotateZDeg` (`0x080625f0`) -- hence degrees, and hence exactly the
 * convention `bf42/gltf.py`'s `quat_from_ypr` already converts for every
 * placed node in the export. Vanilla's values run to +-180 (`-80/60/50` on the
 * Willys' right hand), which no radian reading survives.
 */

// -- small vector / quaternion helpers --------------------------------------- //

const EPS = 1e-8;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = a => Math.hypot(a[0], a[1], a[2]);

export function normalize(a) {
  const l = length(a);
  return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Any unit vector perpendicular to `a`, for the degenerate collinear case. */
export function anyPerpendicular(a) {
  const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const p = cross(a, axis);
  return length(p) < EPS ? [0, 1, 0] : normalize(p);
}

/** Quaternion `[x, y, z, w]` for `angle` radians about a unit `axis`. */
export function quatAxisAngle(axis, angle) {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** `a * b`: b applied first, then a — three.js / glTF column-vector order. */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatApply(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz X v); v' = v + w*t + q.xyz X t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

/** The shortest rotation taking unit `from` onto unit `to`. */
export function quatFromTo(from, to) {
  const f = normalize(from);
  const t = normalize(to);
  if (!length(f) || !length(t)) return [0, 0, 0, 1];
  const d = Math.min(1, Math.max(-1, dot(f, t)));
  if (d > 1 - 1e-9) return [0, 0, 0, 1];
  if (d < -1 + 1e-9) return quatAxisAngle(anyPerpendicular(f), Math.PI);
  const axis = normalize(cross(f, t));
  return quatAxisAngle(axis, Math.acos(d));
}

// -- the export's own handedness --------------------------------------------- //

/**
 * A Refractor position triple as a glTF one.
 *
 * `bf42/gltf.py` exports every vertex and every node placement mirrored about
 * Z (`(x, y, -z)`), so an offset measured in the game's frame has to be
 * mirrored the same way before it can be composed with an exported node's
 * matrix.
 */
export const refractorPoint = p => [p[0], p[1], -p[2]];

/**
 * A Refractor yaw/pitch/roll triple (degrees) as a glTF quaternion.
 *
 * The port of `bf42/gltf.py`'s `quat_from_ypr`, which is pinned there against
 * `quat_from_matrix(ypr_matrix(...))`: R = Ry(yaw) * Rx(pitch) * Rz(roll), and
 * mirroring Z flips the sense of the rotations about X and Y but not the one
 * about Z. `tests/seat_ik_harness.mjs` re-checks this port against the
 * Python's own numbers rather than trusting the transcription.
 */
export function refractorYpr(ypr) {
  const d = Math.PI / 180;
  const y = -ypr[0] * d * 0.5;
  const p = -ypr[1] * d * 0.5;
  const r = ypr[2] * d * 0.5;
  const qy = [0, Math.sin(y), 0, Math.cos(y)];
  const qx = [Math.sin(p), 0, 0, Math.cos(p)];
  const qz = [0, 0, Math.sin(r), Math.cos(r)];
  return quatMul(quatMul(qy, qx), qz);
}

// -- which body a seat draws -------------------------------------------------- //

export const SEAT_HALF_BODY = 'c_seatshowhalfbodysoldier';
export const SEAT_FULL_BODY = 'c_seatshowfullbodysoldier';
export const SEAT_HEAD_ONLY = 'c_seatshowheadofsoldier';
export const SEAT_STANDING = 'c_seatshowstandingsoldier';
export const SEAT_IS_OUTSIDE = 'c_seatisoutside';

/**
 * The five `seatFlags` bits, from the jump table of
 * `operator<<(ostream&, ISeatObjectTemplate::SeatFlags)` (lnxded `0x083207f0`,
 * table at `0x086e1e3c`): 1 half body, 2 full body, 4 head only, 8 is
 * outside, 16 standing. Only three of them reach `setUseSeat`; `c_SeatIsOutside`
 * and `c_SeatShowHeadOfSoldier` are read elsewhere, and vanilla declares the
 * head bit nowhere at all.
 */
export const SEAT_FLAG_BITS = {
  [SEAT_HALF_BODY]: 1,
  [SEAT_FULL_BODY]: 2,
  [SEAT_HEAD_ONLY]: 4,
  [SEAT_IS_OUTSIDE]: 8,
  [SEAT_STANDING]: 16,
};

export function seatFlagMask(flags) {
  let mask = 0;
  for (const flag of flags || []) {
    mask |= SEAT_FLAG_BITS[String(flag).trim().toLowerCase()] || 0;
  }
  return mask;
}

/**
 * What one occupied seat draws, from the SeatObjects it reaches.
 *
 * **A seat with no SeatObject draws nobody.** That is the whole rule for "the
 * Sherman's driver is invisible and its hull gunner is not", and it is in the
 * data rather than in a list of vehicle names: `Sherman`'s own PCO subtree
 * declares two `ShermanEntry` EntryPoints, a Camera and the turret bundles and
 * no SeatObject at all, while `shermanBrowning_PCO1` reaches
 * `ShermanBrowningSeat`. The Willys' root reaches `WillySeat`, which is why
 * its driver shows.
 *
 * `halfBody` hides the legs: `setUseSeat` calls
 * `Skeleton::disableBoneTree(boneIndex("Bip01 Pelvis"))` for that flag
 * (`0x8271b63`), which is the torso-out-of-the-hatch gunner and every plane's
 * pilot.
 */
export function seatBody(seatObjects) {
  const datas = (seatObjects || [])
    .map(o => o?.userData?.seat || o?.seat || o)
    .filter(Boolean);
  if (!datas.length) return { draw: false, halfBody: false, mask: 0 };
  let mask = 0;
  for (const data of datas) mask |= seatFlagMask(data.flags);
  return { draw: true, halfBody: (mask & SEAT_FLAG_BITS[SEAT_HALF_BODY]) !== 0, mask };
}

/**
 * The (upper, lower) animation states one seat plays — `BFSoldier::setUseSeat`
 * (`0x08271950`) exactly, and the mirror of `extract_pose.resolve_seat_states`.
 */
export function resolveSeatStates(seatObjects) {
  const datas = (seatObjects || [])
    .map(o => o?.userData?.seat || o?.seat || o)
    .filter(Boolean);
  let upper = null;
  let lower = null;
  let mask = 0;
  for (const data of datas) {
    mask |= seatFlagMask(data.flags);
    upper = upper || data.poseAnimation?.upperBody || null;
    lower = lower || data.poseAnimation?.lowerBody || null;
  }
  if (!upper) upper = 'Ub_SitInVehicle';
  if (!lower) {
    lower = (mask & SEAT_FLAG_BITS[SEAT_STANDING])
      ? 'Lb_StandInVehicle' : 'Lb_SitInVehicle';
  }
  return { upperBody: upper, lowerBody: lower };
}

/** The pose asset name for a resolved pair — `extract_pose.seat_pose_name`. */
export function seatPoseName(upper, lower) {
  const u = upper.startsWith('Ub_') ? upper.slice(3) : upper;
  const l = (lower || '').startsWith('Lb_') ? lower.slice(3) : (lower || '');
  if (!l || l === u || l === 'Stand') return u;
  return `${u}-${l}`;
}

// -- the IK target ------------------------------------------------------------ //

/**
 * One entry's hand target, given the live world pose of the node it measures
 * from.
 *
 * `targetPosition`/`targetQuaternion` are that node's world translation and
 * rotation — steps 1 and 2 of `updateIk`, in glTF space rather than the
 * engine's soldier-local one. Working in world space is the same composition:
 * the engine only detours through the soldier's frame because `applyIk` stores
 * into a skeleton whose bones are expressed there.
 */
export function ikTarget(entry, targetPosition, targetQuaternion) {
  const offset = refractorPoint(entry.position || [0, 0, 0]);
  return {
    position: add(targetPosition, quatApply(targetQuaternion, offset)),
    quaternion: quatMul(targetQuaternion, refractorYpr(entry.rotation || [0, 0, 0])),
  };
}

// -- the two-bone solve -------------------------------------------------------- //

/**
 * Bend and swing a two-bone chain so its end lands on `target`.
 *
 * Returns two **world-space** rotations for the caller to pre-multiply onto
 * the chain's world orientations, `bend` on the middle bone first and `reach`
 * on the root bone second. Taking them in that order is what makes the pair
 * exact: `reach` is derived from where the end effector sits *after* the bend,
 * and then rigidly carries the bent forearm with it.
 *
 * The bend axis is the current limb plane's own normal, so whichever way the
 * pose's elbow already points is the way it keeps pointing — there is no pole
 * vector in the data to supply one, and the sit clip has the arms roughly
 * right to begin with. A target further than the arm can stretch is clamped to
 * just inside full extension (a straight arm has no plane, and the reach half
 * still aims it at the target).
 */
export function solveTwoBone(rootPos, midPos, endPos, target) {
  const upper = sub(midPos, rootPos);
  const fore = sub(endPos, midPos);
  const l1 = length(upper);
  const l2 = length(fore);
  const toTarget = sub(target, rootPos);
  const reach = length(toTarget);
  if (l1 < EPS || l2 < EPS || reach < EPS) {
    return { bend: [0, 0, 0, 1], reach: [0, 0, 0, 1], bentEnd: endPos,
             clamped: false, degenerate: true };
  }

  // Keep a sliver of bend at full extension: a perfectly straight arm loses
  // the plane the next frame's bend axis would be measured in.
  const maxReach = (l1 + l2) * 0.9995;
  const minReach = Math.abs(l1 - l2) * 1.0005 + EPS;
  const clamped = reach > maxReach || reach < minReach;
  const dist = Math.min(maxReach, Math.max(minReach, reach));

  const currentElbow = elbowAngle(rootPos, midPos, endPos);
  const wantedElbow = Math.acos(clampUnit(
    (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2)));

  let axis = cross(upper, fore);
  axis = length(axis) < 1e-7 ? anyPerpendicular(upper) : normalize(axis);

  // Both are interior angles at the elbow. A positive rotation of the forearm
  // about `cross(upper, fore)` *closes* the joint (take root (0,0,0), mid
  // (1,0,0), end (1,1,0): the axis is +Z and +30 degrees takes the interior
  // angle from 90 to 60), so the difference goes the other way round.
  const bend = quatAxisAngle(axis, currentElbow - wantedElbow);
  const bentEnd = add(midPos, quatApply(bend, fore));
  const swing = quatFromTo(sub(bentEnd, rootPos), toTarget);
  return { bend, reach: swing, bentEnd, clamped, degenerate: false };
}

const clampUnit = v => Math.min(1, Math.max(-1, v));

/**
 * The interior angle at the elbow, for a caller that wants to report one.
 * Exposed because the harness asserts on it.
 */
export function elbowAngle(rootPos, midPos, endPos) {
  const a = normalize(sub(rootPos, midPos));
  const b = normalize(sub(endPos, midPos));
  return Math.acos(clampUnit(dot(a, b)));
}

/**
 * Gather the IK work for one seat: every `extras.skeletonIK` node under it,
 * paired with the child whose pose each entry measures from.
 *
 * `resolveChild(node, index, name)` is the caller's — it turns the export's
 * `targetChild`/`targetNode` into whatever a node is in its world. An index of
 * -1, or a child that cannot be resolved, falls back to the declaring node,
 * which is what the engine does for a negative index.
 */
export function collectIkBindings(nodes, resolveChild) {
  const bindings = [];
  for (const node of nodes || []) {
    const entries = node?.userData?.skeletonIK || node?.skeletonIK;
    if (!Array.isArray(entries) || !entries.length) continue;
    for (const entry of entries) {
      if (!entry?.bone) continue;
      const index = Number.isInteger(entry.targetChild) ? entry.targetChild : -1;
      const target = (index >= 0 && resolveChild
        ? resolveChild(node, index, entry.targetNode) : null) || node;
      bindings.push({ node, target, bone: entry.bone, entry });
    }
  }
  return bindings;
}
