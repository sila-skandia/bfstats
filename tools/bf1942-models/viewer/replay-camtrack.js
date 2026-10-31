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

/** How the camera gets from view A to view B: `[id, label, title]`. */
export const MOVE_STYLES = Object.freeze([
  ['glide', 'Glides', 'Moves smoothly from view A to view B'],
  ['orbit', 'Orbits', 'Swings round the action from view A to view B, turning to keep it in frame'],
  ['cut', 'Cuts', 'Holds view A, then cuts to view B at its moment'],
]);
export const moveStyleOf = id => (MOVE_STYLES.some(([m]) => m === id) ? id : 'glide');

/** How the camera goes from a keyframe to the next, picked on the keyframe
 *  itself (`key.move`, features/replay-creator-view, "A move on each
 *  keyframe"): `[id, label, title]`. */
export const KEY_MOVES = Object.freeze([
  ['glide', 'Glide', 'Moves smoothly to the next keyframe'],
  ['orbit', 'Orbit', 'Swings round the action to the next keyframe, the short way'],
  ['orbit360', '360 round the action', 'A full turn round the action on the way to the next keyframe'],
  ['whip', 'Whip pan', 'Holds, then whips across to the next keyframe at the last moment'],
  ['cut', 'Cut', 'Holds this view, then cuts to the next keyframe at its moment'],
]);

/** What the camera does after the last keyframe, to the clip's end. */
export const END_MOVES = Object.freeze([
  ['hold', 'Hold', 'Stays on this view to the end of the clip'],
  ['spin', '360 round the action', 'Circles what it looks at, a full turn by the end of the clip'],
  ['push', 'Push in', 'Moves in on what it looks at'],
  ['pull', 'Pull back', 'Backs away and up from what it looks at'],
  ['crane', 'Crane up', 'Rises high over what it looks at, looking down on it'],
]);

const KEY_MOVE_IDS = new Set(KEY_MOVES.map(([m]) => m));
const END_MOVE_IDS = new Set(END_MOVES.map(([m]) => m));

/** A keyframe's own move, or null where it has none (the clip's default). */
export function keyMoveOf(id) {
  return KEY_MOVES.some(([m]) => m === id) || END_MOVES.some(([m]) => m === id) ? id : null;
}

/** A label for move `id` between keyframes or after the last. */
export function moveLabel(id) {
  return KEY_MOVES.find(([m]) => m === id)?.[1] ?? END_MOVES.find(([m]) => m === id)?.[1] ?? 'Glide';
}

const ease = u => u * u * (3 - 2 * u);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _vb = new THREE.Vector3();

/**
 * Where two views look at once: the point midway between their lines of
 * sight where they pass closest, or, for lines that never come near each
 * other in front of both, 15 m ahead of the first. The orbit's centre when
 * the clip knows no kill to turn round.
 */
export function meetingPoint(a, b) {
  const fa = new THREE.Vector3(0, 0, -1).applyQuaternion(_qa.fromArray(a.quat));
  const fb = new THREE.Vector3(0, 0, -1).applyQuaternion(_qb.fromArray(b.quat));
  const pa = new THREE.Vector3().fromArray(a.pos);
  const pb = new THREE.Vector3().fromArray(b.pos);
  const w = pa.clone().sub(pb);
  const A = fa.dot(fa);
  const B = fa.dot(fb);
  const C = fb.dot(fb);
  const D = fa.dot(w);
  const E = fb.dot(w);
  const den = A * C - B * B;
  if (den > 1e-6) {
    const s = (B * E - C * D) / den;
    const t = (A * E - B * D) / den;
    if (s > 1 && t > 1 && s < 500 && t < 500) {
      return pa.addScaledVector(fa, s).add(pb.addScaledVector(fb, t)).multiplyScalar(0.5).toArray();
    }
  }
  return pa.addScaledVector(fa, 15).toArray();
}

/**
 * The pose `u` (0 to 1, eased here) of the way from view `a` to view `b`
 * swinging round `centre`: the bearing, the distance and the height off the
 * centre each blended, the short way round, and the camera turning with the
 * swing so it starts on A's framing and lands on B's.
 */
export function orbitPose(a, b, centre, u, out, { full = false } = {}) {
  const k = ease(Math.min(1, Math.max(0, u)));
  const ra = [a.pos[0] - centre[0], a.pos[1] - centre[1], a.pos[2] - centre[2]];
  const rb = [b.pos[0] - centre[0], b.pos[1] - centre[1], b.pos[2] - centre[2]];
  const ba = Math.atan2(ra[0], ra[2]);
  let turn = Math.atan2(rb[0], rb[2]) - ba;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  // A full turn more, the way the short turn goes (360 round the action).
  if (full) turn += turn < 0 ? -Math.PI * 2 : Math.PI * 2;
  const da = Math.hypot(ra[0], ra[2]);
  const db = Math.hypot(rb[0], rb[2]);
  const r = da + (db - da) * k;
  const h = ra[1] + (rb[1] - ra[1]) * k;
  const bearing = ba + turn * k;
  out.pos.set(centre[0] + Math.sin(bearing) * r, centre[1] + h, centre[2] + Math.cos(bearing) * r);
  // A's view carried round by the swing so far, B's carried back by what is
  // left of it, and the two blended.
  _qa.fromArray(a.quat).premultiply(_qy.setFromAxisAngle(_up, turn * k));
  _qb.fromArray(b.quat).premultiply(_qy.setFromAxisAngle(_up, turn * (k - 1)));
  if (_qa.dot(_qb) < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w);
  out.quat.copy(_qa).slerp(_qb, k).normalize();
  const fa = Number.isFinite(a.fov) ? a.fov : null;
  const fb = Number.isFinite(b.fov) ? b.fov : null;
  out.fov = fa !== null && fb !== null ? fa + (fb - fa) * k : fa ?? fb;
  return out;
}

/** The point a keyframe looks at: along its view, as far as `centre` (the
 *  action) is from it, else 15 m. The after-the-last moves turn round it, so
 *  the frame starts exactly as kept. */
export function lookPointOf(key, centre = null) {
  const pos = _vb.fromArray(key.pos);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_qa.fromArray(key.quat));
  const d = centre ? Math.max(3, Math.hypot(centre[0] - pos.x, centre[1] - pos.y, centre[2] - pos.z)) : 15;
  return [pos.x + fwd.x * d, pos.y + fwd.y * d, pos.z + fwd.z * d];
}

const _m4 = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
/** The whip pan's clock: still for most of the stretch, then across fast. */
const WHIP_HOLD = 0.6;
const whipEase = u => {
  if (u <= WHIP_HOLD) return 0;
  const x = (u - WHIP_HOLD) / (1 - WHIP_HOLD);
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
};

/**
 * The track as a rig of replay-camera.js (`setRig`): the camera on the path
 * at the replay's clock. It takes no drags: the keys are the shot. Each
 * keyframe says how the camera goes on from it (`key.move`, KEY_MOVES: a
 * glide, an orbit, a full 360 round the action, a whip pan, a cut), else
 * the clip's `mode`; the last keyframe's move runs to the clip's `end`
 * (END_MOVES: hold, a 360, push in, pull back, crane up). Before the first
 * it holds the first. Keys with no moves of their own on a gliding clip run
 * one spline through them all, as they always did.
 */
export class TrackRig {
  constructor(keys, { mode = 'glide', centre = null, end = null } = {}) {
    this.keys = keys;
    this.mode = moveStyleOf(mode);
    this.centre = centre;
    this.end = end;
    this.pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: null };
  }

  poseAt(t) {
    const keys = this.keys;
    const n = keys.length;
    if (!n) return null;
    if (t <= keys[0].t) return poseAt([keys[0]], t, this.pose);
    const last = keys[n - 1];
    if (t >= last.t) return this.afterLast(last, t);
    let i = 0;
    while (i < n - 2 && keys[i + 1].t <= t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    // A move made for the last keyframe (a crane, say) is no move to a next one.
    const style = KEY_MOVE_IDS.has(a.move) ? a.move : this.mode;
    // The old spline through every key, for a plain gliding clip.
    if (style === 'glide' && n > 2 && keys.slice(0, -1).every(k => !KEY_MOVE_IDS.has(k.move))) return poseAt(keys, t, this.pose);
    const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    if (style === 'cut') return poseAt([a], t, this.pose);
    if (style === 'orbit' || style === 'orbit360') {
      return orbitPose(a, b, this.centre ?? meetingPoint(a, b), u, this.pose, { full: style === 'orbit360' });
    }
    return this.blend(a, b, style === 'whip' ? whipEase(u) : ease(u));
  }

  /** `a` to `b` at `k` (0 to 1, already eased): place, turn and lens. */
  blend(a, b, k) {
    this.pose.pos.fromArray(a.pos).lerp(_vb.fromArray(b.pos), k);
    _qa.fromArray(a.quat);
    _qb.fromArray(b.quat);
    if (_qa.dot(_qb) < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w);
    this.pose.quat.copy(_qa).slerp(_qb, k).normalize();
    const fa = Number.isFinite(a.fov) ? a.fov : null;
    const fb = Number.isFinite(b.fov) ? b.fov : null;
    this.pose.fov = fa !== null && fb !== null ? fa + (fb - fa) * k : fa ?? fb;
    return this.pose;
  }

  /** After the last keyframe: its own move to the clip's end, else held. */
  afterLast(last, t) {
    const move = END_MOVE_IDS.has(last.move) ? last.move : 'hold';
    if (move === 'hold' || !(this.end > last.t + 1e-3)) return poseAt([last], t, this.pose);
    const u = Math.min(1, Math.max(0, (t - last.t) / (this.end - last.t)));
    const look = lookPointOf(last, this.centre);
    _look.fromArray(look);
    const from = _pos.fromArray(last.pos);
    const off = from.clone().sub(_look);
    const dist = off.length();
    const out = this.pose;
    if (move === 'spin') {
      // A full turn round what it looks at, steady, keeping the frame.
      const angle = Math.PI * 2 * u;
      out.pos.copy(off.applyAxisAngle(_up, angle)).add(_look);
      out.quat.fromArray(last.quat).premultiply(_qy.setFromAxisAngle(_up, angle)).normalize();
      out.fov = Number.isFinite(last.fov) ? last.fov : null;
      return out;
    }
    const k = ease(u);
    if (move === 'push') out.pos.copy(from).lerp(_look, 0.6 * k);
    else if (move === 'pull') out.pos.copy(off).multiplyScalar(1 + 1.2 * k).add(_look).addScaledVector(_up, dist * 0.45 * k);
    else out.pos.copy(from).addScaledVector(_up, Math.min(40, Math.max(6, dist * 0.9)) * k);
    // Still looking at the same point: the frame stays on the action.
    _m4.lookAt(out.pos, _look, _up);
    _qb.setFromRotationMatrix(_m4);
    _qa.fromArray(last.quat);
    if (_qa.dot(_qb) < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w);
    out.quat.copy(_qa).slerp(_qb, Math.min(1, k * 4)).normalize();
    out.fov = Number.isFinite(last.fov) ? last.fov : null;
    return out;
  }

  place(cam, dt, t) {
    if (!this.poseAt(t)) return false;
    cam.position.copy(this.pose.pos);
    cam.quaternion.copy(this.pose.quat);
    return true;
  }

  /** The lens the path has at `t` (a key keeps the field of view it was
   *  kept with), or null. */
  fovAt(t) {
    return this.poseAt(t)?.fov ?? null;
  }
}

/** Seconds before the clip's first keyframe in which the auto camera hands
 *  over to it. */
export const LEAD_IN = 1.2;

/** The shortest hand-over, seconds: a keyframe right on the kill still
 *  glides in rather than cuts. */
export const LEAD_IN_MIN = 0.3;

/** When the hand-over to the first keyframe at `first` starts: LEAD_IN
 *  before it, but not before `after` (the kill the auto camera is filming)
 *  when the keyframe comes after that, so the shot itself is never pulled
 *  off the round; and never less than LEAD_IN_MIN before it. */
export function leadInStart(first, after = null, lead = LEAD_IN) {
  let start = first - lead;
  if (after !== null && after < first) start = Math.max(start, after);
  return Math.min(start, first - LEAD_IN_MIN);
}

/** How far the camera has gone from the auto camera's view toward the first
 *  keyframe at `t`, 0 to 1: nothing until the hand-over starts (`start`,
 *  LEAD_IN before it by default), all of it on it, eased. */
export function leadInWeight(first, t, start = first - LEAD_IN) {
  if (t >= first) return 1;
  if (t <= start) return 0;
  return ease((t - start) / Math.max(1e-6, first - start));
}

/**
 * A kill shot's own camera with keyframes after it (features/replay-creator-
 * view, "Keyframes on the strip"): the auto camera (`auto`, the round cam in
 * its shot style) films the clip up to LEAD_IN before the first keyframe (or
 * the kill it films, when the keyframe is after it: `leadInStart`), glides
 * into it, and the keyframes' track (`track`, a TrackRig) films the
 * rest. Adding a keyframe never switches the auto camera off; the two share
 * the clip. Where the auto camera places nothing (the shot still seconds
 * off, or the chase over), the view it left glides into the keyframe.
 */
export class LeadInRig {
  /** `after`: the kill the auto camera films, which the hand-over waits for
   *  (`leadInStart`). */
  constructor(auto, track, { lead = LEAD_IN, after = null } = {}) {
    this.auto = auto;
    this.track = track;
    this.lead = lead;
    this.after = after;
    this.freeSince = null;         // the clock when the auto camera last stopped riding a round
  }

  /** Whether the auto camera is waiting for its round or riding it: the
   *  hand-over never pulls the shot itself off the round. */
  busy() {
    return this.auto.state === 'armed' || this.auto.state === 'flying';
  }

  /** When the hand-over starts: `leadInStart`, and not while the auto camera
   *  is still on its round (`busy`), but never later than LEAD_IN_MIN before
   *  the keyframe. */
  startAt(t = null) {
    const first = this.firstAt();
    if (first === null) return null;
    const start = leadInStart(first, this.after, this.lead);
    const free = this.freeSince ?? t;
    return free === null ? start : Math.max(start, Math.min(free, first - LEAD_IN_MIN));
  }

  get keys() {
    return this.track.keys;
  }

  set keys(keys) {
    this.track.keys = keys;
  }

  get mode() {
    return this.track.mode;
  }

  firstAt() {
    return this.track.keys[0]?.t ?? null;
  }

  place(cam, dt, t) {
    const first = this.firstAt();
    if (first === null || t >= first) return this.track.place(cam, dt, t);
    const placed = this.auto.place?.(cam, dt, t) ?? false;
    // The clock the auto camera came off its round; a loop round starts again.
    if (this.busy()) this.freeSince = null;
    else if (this.freeSince === null || t < this.freeSince) this.freeSince = t;
    const k = leadInWeight(first, t, this.startAt(t));
    if (k <= 0) return placed;
    const pose = this.track.poseAt(first);
    if (!pose) return placed;
    cam.position.lerp(pose.pos, k);
    _qa.copy(pose.quat);
    if (cam.quaternion.dot(_qa) < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
    cam.quaternion.slerp(_qa, k).normalize();
    return true;
  }

  fovAt(t) {
    const first = this.firstAt();
    return first !== null && t >= first ? this.track.fovAt(t) : null;
  }

  /** A drag swings the auto camera while it films; the keyframes take none. */
  drag(dx, dy) {
    const start = this.startAt();
    return start !== null && this.auto.placing && this.auto.player?.time < start ? this.auto.drag?.(dx, dy) ?? false : false;
  }

  wheel(steps) {
    const start = this.startAt();
    return start !== null && this.auto.placing && this.auto.player?.time < start ? this.auto.wheel?.(steps) ?? false : false;
  }

  nearPlane() {
    return this.auto.nearPlane?.() ?? null;
  }
}
