// The camera track (features/replay-creator-view): a clip's cameras as a rig
// (`CutRig`, "Cameras on the strip"), and the camera's pose kept at moments
// of the round and the path through them, time for time (`TrackRig`) -- the
// dolly camera of Rocket League's and CoD Theater's replays, whose moves
// (push in, pull back, circle, crane up) a camera of your own makes.
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
import { ARMED_CAMS, GAME_VIEW, HAND_OVER_LEN, PAGE_FILMED, ROUND_STYLE, camIndexAt, resolveCams, timeOf } from './replay-cuts.js';

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

/** The circle round the man killed: metres out, metres up, radians a second
 *  of the video it turns, and how far off the round's line it starts. */
const CIRCLE = Object.freeze({ dist: 5.5, up: 1.4, rate: 0.32, off: 0.9 });

/** The cameras that wait on the shooter (over the shoulder, facing him) keep
 *  their own framing: a drag that swings the chase round its round does not
 *  carry them off with it. */
const NO_SWING = Object.freeze({ yaw: 0, pitch: 0, dist: 1 });

const _cutQ = new THREE.Quaternion();
const _cutV = new THREE.Vector3();
const _aimM = new THREE.Matrix4();
const _aimQ = new THREE.Quaternion();
const _aimV = new THREE.Vector3();

/**
 * The clip's cameras as a rig of replay-camera.js (features/replay-creator-
 * view, "Cameras on the strip"): each stretch of the clip filmed by its own
 * camera (replay-cuts.js), each handing over to the next by a cut, a glide
 * or a whip, the glide and the whip taking their seconds of the video.
 *
 * The round cameras borrow the round cam's framing: the take's own round cam
 * (`scene.live`) while it rides this time round, so the shot stays on the
 * round the page drew, and a stand-in laid out on the line to the man killed
 * (`scene.ghost`, RoundCam `modelAt`) while the clip is paused or scrubbed.
 * A hand-over kept at the hit or the man down never comes while the round is
 * still in the air: it waits for the page's own round to land, and one kept
 * at a share of the flight comes when the round is that far along.
 *
 * `scene` is the creator's: `live`, `ghost`, `take` ({ f, kill } or null),
 * `moments()` (the clip's `{ start, end, shot, hit, down }` as laid out),
 * `screen(t)` (seconds of the video), `real(t)` (real seconds of the hold),
 * `victimAt(t)` and `subjectAt(t)` (points, arrays), `line` (the round's
 * heading), `centre` (the action, for your camera's moves), `eyes()` (the
 * view handed to the shooter's eyes, true when it can be), `keepAbove(v)`
 * and `baseFov()`.
 */
export class CutRig {
  constructor(scene, cams) {
    this.scene = scene;
    this.cams = cams;
    this.lastT = null;
    this.index = -1;
    this.since = [];                 // the clock each camera took over at, this time round
    this.seen = { hit: null, down: null, prev: null }; // the take's round as the page flew it this time round
    this.cut = null;                 // the view on screen as the camera handed over: { i, pos, quat }
    this.scratch = new THREE.PerspectiveCamera();
    this.active = null;              // the camera filming now (resolveCams's)
    this.from = null;                // the round cam that placed it: a drag swings it
    this.fovNow = null;
    this.moves = new Map();          // a camera of your own's move: its TrackRig
    this.fresh = true;
  }

  /** No keyframes: the cameras are the clip's camera. */
  get keys() {
    return [];
  }

  /** Whether the take's round cam rides this take this time round: riding
   *  it now, or rode it to the hit already (it lets go of its target when
   *  the hold is over). */
  running() {
    const live = this.scene.live;
    const take = this.scene.take;
    if (!live || !take) return false;
    if (live.target?.f === take.f && live.state !== 'idle') return true;
    return this.seen.hit !== null;
  }

  /** The take's round as it flies this time round: when it landed and when
   *  its hold let go. A jump in the clock starts the record again. */
  observe(t) {
    const live = this.scene.live;
    const state = live?.state ?? 'idle';
    // The round cam lets go of its target in the frame it stops: whether it
    // was this take's is the frame before's.
    const mine = Boolean(live?.target) && live.target.f === this.scene.take?.f;
    const jumped = this.lastT === null || t < this.lastT - 1e-6 || t - this.lastT > 1.2;
    if (jumped) {
      this.seen = { hit: null, down: null, prev: state, mine };
      this.since = [];
      this.cut = null;
    }
    const seen = this.seen;
    if (mine && state === 'impact' && seen.hit === null) seen.hit = live.impact?.t ?? t;
    if (seen.mine && seen.prev === 'impact' && state === 'idle' && seen.down === null) seen.down = t;
    seen.prev = state;
    seen.mine = mine;
    this.lastT = t;
    return jumped;
  }

  /** The cameras changed under the rig: no hand-over carried over from the
   *  ones before. */
  reset() {
    this.index = -1;
    this.since = [];
    this.cut = null;
    this.moves.clear();
  }

  /** Whether camera `c`'s hand-over has come at `t`, the take's round riding
   *  (`running`): a share of the flight when the round is that far along, the
   *  hit and the man down once the page's round has landed and let go. */
  reached(c, ev, t, running) {
    const at = c.at;
    if (!running) return t >= timeOf(at, ev) - 1e-9;
    const live = this.scene.live;
    const seen = this.seen;
    if (at.ev === 'flight') {
      if (live.state === 'flying') return (live.target?.progress ?? 0) >= at.p;
      if (live.state === 'armed') return false;
      return seen.hit !== null || t >= timeOf(at, ev);
    }
    if (at.ev === 'hit' || at.ev === 'down') {
      const when = at.ev === 'hit' ? seen.hit : seen.down;
      if (when !== null) return t >= when + at.dt;
      // Not yet: never off the round while it flies or is held.
      if (at.dt >= 0 && live.state !== 'idle') return false;
      if (at.ev === 'down' && live.state === 'impact') return false;
    }
    return t >= timeOf(at, ev) - 1e-9;
  }

  place(cam, dt, t) {
    const s = this.scene;
    const jumped = this.observe(t);
    if (this.fresh && s.live) {
      // The clip films from its first frame in its first camera: no glide in
      // from wherever the view was.
      s.live.from.w = 0;
      this.fresh = false;
    }
    const ev = s.moments();
    const list = resolveCams(this.cams, ev);
    const running = this.running();
    let i = 0;
    if (running) while (i + 1 < list.length && this.reached(list[i + 1], ev, t, true)) i++;
    else i = camIndexAt(list, t);
    if (i !== this.index) {
      if (!jumped && this.index >= 0) {
        this.since[i] = t;
        this.cut = { i, pos: cam.position.clone(), quat: cam.quaternion.clone() };
      } else this.cut = null;
      this.index = i;
    }
    const c = list[i];
    this.active = c;
    this.usedGhost = false;
    // The hand-over's share done, in seconds of the video.
    let k = 1;
    const len = i > 0 ? HAND_OVER_LEN[c.into] ?? 0 : 0;
    if (len > 0) {
      const start = this.since[i] ?? c.t0;
      k = Math.max(0, (s.screen(t) - s.screen(start)) / len);
    }
    // The camera handed over from, first: whatever it sets on the round cam
    // is the one on screen's to set again.
    let from = null;
    let fromFov = null;
    if (k < 1) {
      const prev = list[i - 1];
      if (this.poseOf(prev, t, this.scratch, dt)) {
        from = this.scratch;
        fromFov = this.fovNow;
      } else if (this.cut?.i === i) from = { position: this.cut.pos, quaternion: this.cut.quat };
    }
    const placed = this.poseOf(c, t, cam, dt);
    this.showRound(cam, dt);
    if (!placed) return false;
    let fov = this.fovNow;
    if (from) {
      const w = c.into === 'whip' ? whipEase(Math.min(1, k)) : ease(Math.min(1, k));
      _cutV.copy(cam.position);
      _cutQ.copy(cam.quaternion);
      cam.position.copy(from.position).lerp(_cutV, w);
      const q = from.quaternion;
      if (q.dot(_cutQ) < 0) _cutQ.set(-_cutQ.x, -_cutQ.y, -_cutQ.z, -_cutQ.w);
      cam.quaternion.copy(q).slerp(_cutQ, w).normalize();
      if (fov !== null || fromFov !== null) {
        const base = s.baseFov?.() ?? 60;
        fov = (fromFov ?? base) + ((fov ?? base) - (fromFov ?? base)) * w;
      }
    }
    this.fovNow = fov;
    return true;
  }

  /** The round on screen whatever films it: the take's own while it flies
   *  this time round, else the stand-in's where the clip is paused in its
   *  flight; the other put away. */
  showRound(cam, dt) {
    const s = this.scene;
    const live = s.live;
    if (this.running() && live.state === 'flying') {
      s.ghost?.hideHero();
      live.camPos.copy(cam.position);
      live.placeHero(dt);
      return;
    }
    if (!this.usedGhost) s.ghost?.hideHero();
  }

  /** Camera `c` at `t` into `cam`: false where the page's own camera films
   *  it (his eyes, the replay's camera). Sets `fovNow`. */
  poseOf(c, t, cam, dt) {
    this.fovNow = null;
    switch (c.cam) {
      case 'shoulder':
      case 'front':
      case 'chase':
      case 'orbit':
      case 'side':
      case 'incoming':
        return this.roundPose(ROUND_STYLE[c.cam], t, cam, dt, ARMED_CAMS.has(c.cam));
      case 'victim':
        return this.circle(c, t, cam);
      case 'placed':
        return this.placedPose(c, t, cam);
      case 'eyes':
        // No eyes to look through (a man with none drawn): over his shoulder.
        return this.scene.eyes?.() ? false : this.roundPose('chase', t, cam, dt, true);
      case 'gamechase':
      case 'gamefront':
      case 'gameflyby':
        // The game's own camera on the shooter (replay-camera.js's outside
        // views); where it cannot be, over his shoulder.
        return this.scene.gameView?.(GAME_VIEW[c.cam]) ? false : this.roundPose('chase', t, cam, dt, true);
      default:
        return false;
    }
  }

  /** A round camera: the take's round cam in `style` while it rides this
   *  time round, else the stand-in laid out at `t`. `armed` holds it on the
   *  shooter (over the shoulder, facing him) whatever the clock says. */
  roundPose(style, t, cam, dt, armed = false) {
    const s = this.scene;
    const take = s.take;
    if (!take) return false;
    const live = s.live;
    if (!armed && this.running() && live.state !== 'idle') {
      this.from = live;
      return live.placeAs(cam, dt, t, style);
    }
    const ghost = s.ghost;
    if (!ghost) return false;
    ghost.orbit = armed || !live ? NO_SWING : live.orbit;
    const ev = s.moments();
    if (!ghost.modelAt(t, take.f, take.kill, { hit: ev.hit, real: s.real(t), armed })) return false;
    this.from = ghost;
    this.usedGhost = true;
    return ghost.placeAs(cam, dt, t, style);
  }

  /** Circle the victim: round the man killed at CIRCLE's distance, starting
   *  off the round's line on the shooter's side, a steady turn in seconds of
   *  the video. */
  circle(c, t, cam) {
    const s = this.scene;
    const centre = s.victimAt?.(t);
    if (!centre) return this.roundPose('reverse', t, cam, 0);
    const line = s.line ?? [0, 0, -1];
    const b = Math.atan2(-line[0], -line[2]) + CIRCLE.off + CIRCLE.rate * (s.screen(t) - s.screen(c.t0));
    cam.position.set(centre[0] + Math.sin(b) * CIRCLE.dist, centre[1] + CIRCLE.up, centre[2] + Math.cos(b) * CIRCLE.dist);
    s.keepAbove?.(cam.position);
    cam.lookAt(_aimV.fromArray(centre));
    this.from = null;
    return true;
  }

  /** A camera of your own: from its start camera to its end camera over
   *  its stretch (a glide, an orbit, a 360 or a whip), else the view kept,
   *  still, turning to follow the action from the framing kept, or moving on
   *  it (push in, pull back, circle, crane up). TrackRig's moves, in seconds
   *  of the video. */
  placedPose(c, t, cam) {
    const v = c.view;
    if (!v) return false;
    const s = this.scene;
    this.from = null;
    this.fovNow = Number.isFinite(v.fov) ? v.fov : null;
    if (c.end) {
      const s0 = s.screen(c.t0);
      const s1 = Math.max(s0 + 1e-3, s.screen(c.t1));
      const key = `${c.i}|ab|${v.pos.join(',')}|${v.quat.join(',')}|${c.end.pos.join(',')}|${c.end.quat.join(',')}|${c.move}|${s0}|${s1}`;
      let rig = this.moves.get(c.i);
      if (rig?.key !== key) {
        rig = new TrackRig([
          { t: s0, pos: v.pos, quat: v.quat, fov: v.fov, move: c.move ?? 'glide' },
          { t: s1, pos: c.end.pos, quat: c.end.quat, fov: c.end.fov },
        ], { centre: s.centre ?? null, end: s1 });
        rig.key = key;
        this.moves.set(c.i, rig);
      }
      const pose = rig.poseAt(s.screen(t));
      if (!pose) return false;
      cam.position.copy(pose.pos);
      cam.quaternion.copy(pose.quat);
      this.fovNow = Number.isFinite(pose.fov) ? pose.fov : this.fovNow;
      return true;
    }
    const motion = c.motion ?? 'still';
    if (motion === 'still') {
      cam.position.fromArray(v.pos);
      cam.quaternion.fromArray(v.quat).normalize();
      return true;
    }
    if (motion === 'track') {
      cam.position.fromArray(v.pos);
      const a = s.subjectAt?.(c.t0);
      const b = s.subjectAt?.(t);
      cam.quaternion.fromArray(v.quat).normalize();
      if (!a || !b) return true;
      // The framing kept, carried round as the action moves: the view's turn
      // off the line to the action at its start, kept on the line to it now.
      const look0 = aimAt(v.pos, a, new THREE.Quaternion());
      const offset = look0.invert().multiply(cam.quaternion);
      cam.quaternion.copy(aimAt(v.pos, b, _aimQ)).multiply(offset).normalize();
      return true;
    }
    const key = `${c.i}|${v.pos.join(',')}|${motion}|${c.t0}|${c.t1}`;
    let rig = this.moves.get(c.i);
    if (rig?.key !== key) {
      rig = new TrackRig([{ t: s.screen(c.t0), pos: v.pos, quat: v.quat, fov: v.fov, move: motion }], { centre: s.centre ?? null, end: s.screen(c.t1) });
      rig.key = key;
      this.moves.set(c.i, rig);
    }
    const pose = rig.poseAt(s.screen(t));
    if (!pose) return false;
    cam.position.copy(pose.pos);
    cam.quaternion.copy(pose.quat);
    return true;
  }

  fovAt() {
    return this.fovNow;
  }

  /** A drag swings a round camera round its round (the next time round
   *  keeps it); his eyes and the replay's camera take it as their own. */
  drag(dx, dy) {
    const c = this.active;
    if (!c || PAGE_FILMED.has(c.cam)) return false;
    if (ROUND_STYLE[c.cam] && this.from) return this.from.drag(dx, dy);
    return true;
  }

  wheel(steps) {
    const c = this.active;
    if (!c || PAGE_FILMED.has(c.cam)) return false;
    if (ROUND_STYLE[c.cam] && this.from) return this.from.wheel(steps);
    return true;
  }

  nearPlane() {
    const c = this.active;
    const style = c ? ROUND_STYLE[c.cam] : null;
    return style && this.from ? this.from.nearPlaneAs(style) : null;
  }
}

/** The turn of a camera at `pos` looking at `at` (arrays), into `out`. */
function aimAt(pos, at, out) {
  _aimM.lookAt(_cutV.fromArray(pos), _aimV.fromArray(at), new THREE.Vector3(0, 1, 0));
  return out.setFromRotationMatrix(_aimM);
}
