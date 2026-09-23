// A round against a soldier's skeleton: the engine's hit test, on the bones the
// page is drawing.
//
// `ObjectTemplate.setSkeletonCollisionBone <bone> <distSq> <stretch> <material>`
// (vanilla `CommonSoldierData.inc` declares eight, every installed mod the same
// eight) registers one capsule per bone. `SkeletonCollisionMesh::
// getDistanceToGeometry` (lnxded `0x083aeb10`) walks them in declaration order
// and takes the FIRST whose segment comes within `distSq` (squared) of the
// round's segment, `checkCapsuleCollision` (`0x083ae510`) being a plain
// segment-to-segment squared distance. The capsule is the bone's own segment,
// bone to parent, moved along itself by `stretch` times its length:
//
//     d = (bone - parent) * stretch
//     capsule = [parent + d, bone + d]          (stretch 0: [bone, parent])
//
// So the head's `0.02 2` is a 0.14 m capsule sitting one neck-length above
// the head bone, the chest's `0.08 -0.45` a 0.28 m one pulled down the spine,
// and the forearm entry, whose parent is the upper arm, covers the upper arm.
// `Skeleton::setSkeletonCollisionBone` (`0x08342570`) stores `distSq` at bone
// `+0xd4`, `stretch` at `+0xd0` and the material at `+0xd8`; see ledger DIE-10.
//
// The table itself is shipped data and rides out in `poses/gaits/gaits.json`
// (`collisionBones`, written by `extract_pose.py`). Free of `three`, so
// `tests/skeleton_hit_harness.mjs` runs it under node; the caller hands in
// the bones' world positions.

/** The bone whose hit is a head shot: `BFSoldierTemplate::init` caches its
 *  skeleton index at `+0x290` and `handleDamage` compares the hit bone to it. */
export const HEAD_BONE = 'Bip01 Head';

/** Bone names as the data writes them (`Bip01_Head`), as the skeleton does
 *  (`Bip01 Head`) and as GLTFLoader leaves them, folded to one key. The engine
 *  itself turns `_` into a space before the lookup (`0x0827cd30`). */
export const boneKey = name => String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();

/**
 * Squared distance between segments `p0-p1` and `q0-q1`: what
 * `checkCapsuleCollision` returns. Arrays of three.
 */
export function segmentDistanceSq(p0, p1, q0, q1) {
  return closestOnSegments(p0, p1, q0, q1).distSq;
}

/** The closest pair of points on two segments: `{ distSq, s }`, `s` the
 *  fraction along the first. */
function closestOnSegments(p0, p1, q0, q1) {
  const d1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const d2 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const r = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0; t = 0;
  } else if (a <= 1e-12) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0; s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const x = r[0] + d1[0] * s - d2[0] * t;
  const y = r[1] + d1[1] * s - d2[1] * t;
  const z = r[2] + d1[2] * s - d2[2] * t;
  return { distSq: x * x + y * y + z * z, s };
}

/** The capsule segment for one entry, from the bone's and its parent's
 *  world positions. */
export function capsuleSegment(bone, parent, stretch) {
  if (!stretch) return [bone, parent];
  const d = [(bone[0] - parent[0]) * stretch, (bone[1] - parent[1]) * stretch,
             (bone[2] - parent[2]) * stretch];
  return [[parent[0] + d[0], parent[1] + d[1], parent[2] + d[2]],
          [bone[0] + d[0], bone[1] + d[1], bone[2] + d[2]]];
}

/**
 * The round `origin + dir * t`, `0 <= t <= maxT`, against `capsules` (each
 * `{ bone, a, b, distSq, material }`, in declaration order). Returns the first
 * capsule it meets, as the engine does -- not the nearest -- with the point on
 * the round closest to it: `{ bone, material, t, at }`, or null.
 */
export function skeletonHit(origin, dir, maxT, capsules) {
  if (!capsules?.length || !(maxT > 0)) return null;
  const end = [origin[0] + dir[0] * maxT, origin[1] + dir[1] * maxT,
               origin[2] + dir[2] * maxT];
  for (const cap of capsules) {
    const near = closestOnSegments(origin, end, cap.a, cap.b);
    if (near.distSq >= cap.distSq) continue;
    const t = near.s * maxT;
    return {
      bone: cap.bone, material: cap.material, t,
      at: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
    };
  }
  return null;
}

/**
 * A round against one soldier: his capsules where the page draws him, else
 * the stand-in sphere (`center`, `radius`: the viewer's one-sphere body, for a
 * soldier nobody draws -- the headless match runner's, or one whose rig has
 * not loaded). `dir` is a unit vector. Returns `{ t, at, bone, material }`,
 * `bone` and `material` null off the sphere, or null for a miss.
 */
export function meetSoldier(origin, dir, maxT, { capsules = null, center = null, radius = 0 } = {}) {
  if (capsules?.length) return skeletonHit(origin, dir, maxT, capsules);
  if (!center) return null;
  const c = [center[0] - origin[0], center[1] - origin[1], center[2] - origin[2]];
  const t = dot(c, dir);
  if (t < 0 || t > maxT) return null;
  if (dot(c, c) - t * t > radius * radius) return null;
  return { t, at: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
           bone: null, material: null };
}

/** Is this the head? */
export function isHeadBone(bone) {
  return bone != null && boneKey(bone) === boneKey(HEAD_BONE);
}

/**
 * Build the capsules from the table and a bone reader: `positionOf(name)`
 * answers `{ bone: [x,y,z], parent: [x,y,z] }` for a bone the drawn skeleton
 * has, or null. An entry whose bone is missing is skipped, the way
 * `setSkeletonCollisionBone` skips a bone the skeleton lacks.
 */
export function buildCapsules(table, positionOf) {
  const out = [];
  for (const entry of table || []) {
    const pos = positionOf(entry.bone);
    if (!pos) continue;
    const [a, b] = capsuleSegment(pos.bone, pos.parent, entry.stretch);
    out.push({ bone: entry.bone, a, b, distSq: entry.distSq, material: entry.material });
  }
  return out;
}

function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
