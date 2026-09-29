// The camera track (features/replay-creator-view): the camera's pose kept at
// moments of the round (K), and the path through them, time for time -- the
// dolly camera of Rocket League's and CoD Theater's replays, Unreal
// Sequencer's camera keys.
//
// The path is a Catmull-Rom spline whose knots are the keys' own times, so
// the camera is exactly at each key at its moment and flies between them at
// the pace their spacing sets, with no stop at a key. The rotation is the same
// spline over the keys' quaternions, each turned into the last one's
// hemisphere and normalised; the lens the same over their fields of view.
// Before the first key and after the last the camera holds there.
//
// Pure but for three's vectors, so `tests/replay_creator_harness.mjs` runs it.

import * as THREE from 'three';

/** Two keys closer than this, seconds, are one: a key kept again replaces it. */
export const KEY_MERGE = 0.05;

/** A key from a camera at `t`: `{ t, pos, quat, fov }` in plain numbers. */
export function keyOf(camera, t) {
  const p = camera.position;
  const q = camera.quaternion;
  return { t, pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], fov: camera.fov };
}

/** Whether a key is all numbers (one read back from storage may not be). */
export function keyValid(k) {
  return Boolean(k) && Number.isFinite(k.t) && Array.isArray(k.pos) && k.pos.length === 3
    && Array.isArray(k.quat) && k.quat.length === 4 && [...k.pos, ...k.quat].every(Number.isFinite)
    && Math.hypot(...k.quat) > 1e-6 && (k.fov === undefined || (k.fov > 1 && k.fov < 179));
}

/** `keys` with `key` in its place by time, replacing one within KEY_MERGE. */
export function addKey(keys, key) {
  const out = keys.filter(k => Math.abs(k.t - key.t) >= KEY_MERGE);
  out.push(key);
  return out.sort((a, b) => a.t - b.t);
}

/** The Barry-Goldman form of a Catmull-Rom segment between knots `t1` and
 *  `t2` at `t`, over one number of each of four points. */
function catmull(p0, p1, p2, p3, t0, t1, t2, t3, t) {
  const a1 = ((t1 - t) * p0 + (t - t0) * p1) / (t1 - t0);
  const a2 = ((t2 - t) * p1 + (t - t1) * p2) / (t2 - t1);
  const a3 = ((t3 - t) * p2 + (t - t2) * p3) / (t3 - t2);
  const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
  const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
  return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
}

/** The keys' quaternions, each turned into the hemisphere of the one before
 *  it: q and -q are one rotation, and a spline across the two turns the long
 *  way round. Once a set of keys (a new key makes a new array). */
const aligned = new WeakMap();
function alignedQuats(keys) {
  if (aligned.has(keys)) return aligned.get(keys);
  const out = [];
  let last = null;
  for (const k of keys) {
    const q = [...k.quat];
    if (last && q[0] * last[0] + q[1] * last[1] + q[2] * last[2] + q[3] * last[3] < 0) {
      for (let i = 0; i < 4; i++) q[i] = -q[i];
    }
    out.push(q);
    last = q;
  }
  aligned.set(keys, out);
  return out;
}

/**
 * The track's pose at `t`: `{ pos, quat, fov }` into `out` (three's Vector3
 * and Quaternion, a number), or null for no keys. Holds the first key before
 * it and the last after it.
 */
export function poseAt(keys, t, out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: null }) {
  const n = keys.length;
  if (!n) return null;
  const set = (pos, quat, fov) => {
    out.pos.set(pos[0], pos[1], pos[2]);
    out.quat.set(quat[0], quat[1], quat[2], quat[3]).normalize();
    out.fov = Number.isFinite(fov) ? fov : null;
    return out;
  };
  if (n === 1 || t <= keys[0].t) return set(keys[0].pos, keys[0].quat, keys[0].fov);
  if (t >= keys[n - 1].t) return set(keys[n - 1].pos, keys[n - 1].quat, keys[n - 1].fov);
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= t) i++;
  const quats = alignedQuats(keys);
  const k1 = keys[i];
  const k2 = keys[i + 1];
  // Past either end the spline runs on a mirrored phantom key, as far out in
  // time and place as the neighbour on the other side.
  const k0 = keys[i - 1] ?? null;
  const k3 = keys[i + 2] ?? null;
  const t1 = k1.t;
  const t2 = k2.t;
  const t0 = k0 ? k0.t : t1 - (t2 - t1);
  const t3 = k3 ? k3.t : t2 + (t2 - t1);
  const mirror = (a, b) => a.map((v, j) => 2 * v - b[j]);
  const p0 = k0 ? k0.pos : mirror(k1.pos, k2.pos);
  const p3 = k3 ? k3.pos : mirror(k2.pos, k1.pos);
  const q1 = quats[i];
  const q2 = quats[i + 1];
  const q0 = k0 ? quats[i - 1] : mirror(q1, q2);
  const q3 = k3 ? quats[i + 2] : mirror(q2, q1);
  const pos = [0, 1, 2].map(j => catmull(p0[j], k1.pos[j], k2.pos[j], p3[j], t0, t1, t2, t3, t));
  const quat = [0, 1, 2, 3].map(j => catmull(q0[j], q1[j], q2[j], q3[j], t0, t1, t2, t3, t));
  const f1 = Number.isFinite(k1.fov) ? k1.fov : null;
  const f2 = Number.isFinite(k2.fov) ? k2.fov : null;
  let fov = null;
  if (f1 !== null && f2 !== null) {
    const u = (t - t1) / (t2 - t1);
    fov = f1 + (f2 - f1) * u * u * (3 - 2 * u);
  }
  return set(pos, quat, fov ?? f1 ?? f2);
}

/** `count` points along the track's path, for drawing it: `[[x, y, z]...]`. */
export function pathPoints(keys, count = 160) {
  if (keys.length < 2) return keys.map(k => [...k.pos]);
  const out = [];
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: null };
  const t0 = keys[0].t;
  const t1 = keys[keys.length - 1].t;
  for (let i = 0; i < count; i++) {
    poseAt(keys, t0 + ((t1 - t0) * i) / (count - 1), pose);
    out.push([pose.pos.x, pose.pos.y, pose.pos.z]);
  }
  return out;
}

/**
 * The track as a rig of replay-camera.js (`setRig`): the camera on the path
 * at the replay's clock. It takes no drags: the keys are the shot.
 */
export class TrackRig {
  constructor(keys) {
    this.keys = keys;
    this.pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: null };
  }

  place(cam, dt, t) {
    if (!poseAt(this.keys, t, this.pose)) return false;
    cam.position.copy(this.pose.pos);
    cam.quaternion.copy(this.pose.quat);
    return true;
  }

  /** The lens the path has at `t` (a key keeps the field of view it was
   *  kept with), or null. */
  fovAt(t) {
    return poseAt(this.keys, t, this.pose)?.fov ?? null;
  }
}
