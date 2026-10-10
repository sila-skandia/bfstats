// The replay's camera: which object the followed player controls at a time
// (`focusLife`), and the three ways of watching him (features/round-replay-ux):
//
//   orbit  locked on him, or the hull he rides, or once he dies the death
//          cam over where he fell (`deathAt`) until he is back or the
//          camera goes on to his killer (replay.js `followKiller`);
//          dragged, wheeled and keyed around him, never away from him.
//          Wheeled in all the way, it goes through his eyes.
//   pov    through his eyes: on foot his recorded body turned by his torso
//          twist and raised by his aim pitch (lying down, on the slope he
//          lies on), on the axis each of his rounds left along; in a seat
//          the seat's own Camera node (the cockpit view's eye), or in an
//          aircraft its nose cam (`povView`).
//   free   a fly camera, moved with the keys (a thumbstick on a touch
//          screen), looked with the mouse or a finger.
//
// The input is replay-ui.js's; this turns it into the camera's pose. While a
// replay is open the page's own free camera leaves the camera alone
// (local-player.js `frameCameras`), and the replay places it before it draws
// its soldiers, whose renderer culls against it (replay.js `update`).

import * as THREE from 'three';
import {
  AIM_PITCH_SCALE, AIM_TWIST_SCALE, aimAt, controlledAt, eyeLiftAt, lifeAt, rootOf, sampleAt, settledTime,
  soldierLivesOf,
} from './replay-recording.js';
import { NETWORKED_ROUNDS, weaponOfProjectile } from './replay-props.js';
import { toViewPosition, toViewQuaternion } from './replay-actors.js';
import { nextSpawn, playerStatusAt } from './replay-chapters.js';
import { whereIs } from './replay-battles.js';
import { DEATH_HOLD } from './replay-director.js';
import { finite, finiteVector } from './replay-guard.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { noseCamOffset, NoseHull } from './seat-view.js';

export const CAMERA_MODES = Object.freeze(['orbit', 'pov', 'free']);

// Orbit distance at zoom 1 and the point orbited, over a soldier's feet; a
// hull's scale with its size. The spectator camera (a player on the spawn
// screen) is only a viewpoint, looked down on from well above.
const SOLDIER = { base: 6, lift: 1.2 };
const BODY = { base: 6, lift: 0.4 };
const SPECTATOR = { base: 60, lift: 0, minPitch: 0.6 };
const HULL_BASE = 2.4;           // x the hull's bounding radius
const HULL_LIFT = 0.15;          // x the radius, above its root

// The death cam, framed as the page's own (local-player.js `DEATH_CAM`,
// soldier-view.js `corpseCam`): killed on foot, 4.2 m back from the body and
// 1.8 m over it, on the far side from his killer so the killer stands beyond
// it in the frame; killed in a hull, straight down on it from 30 m, or from
// far enough to take a bigger hull in at the same size. The pitch is the
// orbit's steepest.
const DEATH_FOOT = { dist: Math.hypot(4.2, 1.8), pitch: Math.atan2(1.8, 4.2) };
const DEATH_WRECK = { dist: 30, perRadius: 7.5 };
/** Seconds apart within which a kill line and a death line are one death. */
const SAME_DEATH = 0.25;
/** Metres from his recorded place within which a drawn body is his. */
const CORPSE_NEAR = 6;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 25;
const DIST_MIN = 1.5;
const DIST_MAX = 1500;
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.52;
const CLEARANCE = 0.6;           // metres the camera keeps above ground and water

const SMOOTH = 0.05;             // s: the orbit's input easing
const GLIDE = 0.28;              // s: a change of target or mode eases out over this
const CUT = 250;                 // m: a target further than this is cut to, not flown to
const LOOK_RETURN = 0.3;         // s: a first-person look-around springs back

const KEY_TURN = 1.8;            // rad/s, A/D
const KEY_TILT = 1.1;            // rad/s, Q/E
const KEY_ZOOM = 1.6;            // e-folds/s, W/S
const DRAG = 0.005;              // rad/px, orbit
const LOOK = 0.0024;             // rad/px, free and first person
const FREE_SPEED = 30;           // m/s
const FREE_FAST = 4;             // x with Shift
// The thumbstick (touch, replay-ui.js): the speed grows as the square of the
// push, so a nudge creeps and a full push flies at twice the keys' speed.
const STICK_FAST = 2;
const PINCH_FLY = 6;             // wheel steps per e-fold of a free camera's pinch

// The game's lenses (local-player.js `LENS`): the soldier's 57.3 degrees and
// 0.2 m near plane, a seat's 60 and 0.1 (a tank's interior is 0.09 m ahead of
// its eye). The orbit and the free camera keep the page's own.
const FOOT_LENS = { fov: 57.3, near: 0.2 };
const SEAT_LENS = { fov: 60, near: 0.1 };

/** A zoom's lens eases 0.3 of the way a frame and snaps within this, degrees
 *  (hand-fire.js `FOV_SNAP`, the arms' `BFSoldier::handleVisualUpdate` law the
 *  world lens borrows). */
const ZOOM_EASE = 0.3;
const ZOOM_SNAP = 0.001;

/** Radians of view per recorded degree of aim pitch and torso twist
 *  (replay-recording.js `AIM_PITCH_SCALE`, `AIM_TWIST_SCALE`). */
const PITCH = AIM_PITCH_SCALE * Math.PI / 180;
const TWIST = AIM_TWIST_SCALE * Math.PI / 180;

/** Seconds either side of a round over which the view is laid on the round's
 *  own axis: a hand weapon fires along the camera (`fireInCameraDof`, every
 *  vanilla one), so at a round the recording has exactly where he looked.
 *  Two rounds closer than twice this are one burst, and the view goes from
 *  the one axis to the next. */
const SHOT_HOLD = 0.25;
/** A round further off his recorded aim than this is not his view's: a
 *  respawn's first sample, a round from a hand he no longer holds. */
const SHOT_MAX_YAW = 30 * Math.PI / 180;
const SHOT_MAX_PITCH = 20 * Math.PI / 180;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _body = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lensOk = cam => cam.fov > 0 && cam.fov < 180 && cam.near > 0 && cam.near < Infinity;

/** The followed player's controlled object: their soldier, the hull whose
 *  seat they hold (a gunner's seat id resolves to its hull, `rootOf`), or
 *  before spawning the spectator camera, which has a pose but no model.
 *  `preferBody` keeps a dead player's body in view while it lies, even when
 *  his own spectator camera was recorded (the orbit's death cam); without it
 *  the recording player's camera is his view. */
export function focusLife(player, t, preferBody = false) {
  const { rec } = player;
  const nid = controlledAt(rec, player.followPid, t);
  if (nid === null) return null;
  const root = rootOf(rec, nid, t, player.followPid);
  const life = root?.life ?? rec.lives.find(l => l.nid === nid && t >= l.created && t < l.destroyed) ?? null;
  // A bot's free camera is never replicated (a bot looks through nothing), so
  // following it would sit at wherever the camera was made. While he is dead
  // the camera stays on his body instead, for as long as it lies there.
  if (life?.camera && (preferBody || !life.keys.length)) {
    let body = null;
    for (const l of rec.lives) {
      if (!l.soldier || l.pid !== player.followPid || l.created > t || t >= l.destroyed) continue;
      if (!body || l.created > body.created) body = l;
    }
    return body ?? life;
  }
  return life;
}

const deathLists = new WeakMap();

/** `pid`'s deaths in time order, `[{ t, pid, killer }]`: the score stream's,
 *  and any a soldier's handover to his free camera alone marks
 *  (replay-recording.js `diedAt`). A kill line and the death line of the
 *  same instant are one death, the killer's. */
function deathsOf(rec, pid) {
  let byPid = deathLists.get(rec);
  if (!byPid) deathLists.set(rec, (byPid = new Map()));
  let list = byPid.get(pid);
  if (list) return list;
  const raw = [
    ...(rec.deaths ?? []).filter(d => d.pid === pid).map(d => ({ t: d.t, killer: d.killer ?? null })),
    ...soldierLivesOf(rec, pid).filter(l => l.diedAt !== undefined).map(l => ({ t: l.diedAt, killer: l.killer ?? null })),
  ].filter(d => Number.isFinite(d.t)).sort((a, b) => a.t - b.t);
  list = [];
  for (const d of raw) {
    const last = list.at(-1);
    if (last && d.t - last.t < SAME_DEATH) {
      last.killer ??= d.killer;
      continue;
    }
    list.push({ t: d.t, pid, killer: d.killer });
  }
  byPid.set(pid, list);
  return list;
}

/** The last of time-ordered `list` at or before `t`, or undefined. */
function lastAtOrBefore(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return list[lo - 1];
}

/**
 * The death `pid` is in at `t`, `{ t, pid, killer }` (`killer` null for his
 * own hand, a fall, the world), from the moment he dies until he is back;
 * null while he is alive. The same object every frame of one death.
 *
 * He is back on a living soldier, or on anything the recording knows that
 * he took after the death but his free camera. His status alone does not
 * say: a man who died in a seat is still named in it; one whose new seat
 * the status cannot yet place reads dead (pid 28 at 147.4 s of
 * replay_20260928-133433, which put the camera back over his last death for
 * a tenth of a second); and one the recording only ever saw in a seat reads
 * `spawning` once he dies in it, his free camera an id it never made (pid 19
 * at 7 s of replay_20260928-214112).
 */
export function deathAt(rec, pid, t, kills = rec.kills) {
  if (pid === null || pid === undefined || !Number.isFinite(t)) return null;
  const death = lastAtOrBefore(deathsOf(rec, pid), t);
  if (!death) return null;
  if (playerStatusAt(rec, pid, t, kills).state === 'foot') return null;
  const took = lastAtOrBefore(rec.playerNids?.get(pid) ?? [], t);
  const held = took && took.t > death.t ? lifeAt(rec, took.nid, t) : null;
  return held && !held.camera ? null : death;
}

/** What `death` happened in: his soldier, whose body then lies, or the hull
 *  he rode. Worked out once a death. */
function diedIn(rec, death) {
  if (death.life !== undefined) return death.life;
  const before = death.t - 0.05;
  const nid = controlledAt(rec, death.pid, before);
  let life = rootOf(rec, nid, before, death.pid)?.life ?? null;
  if (life && (life.camera || life.kit || life.projectile || life.controlPoint)) life = null;
  if (!life || life.soldier) {
    life = soldierLivesOf(rec, death.pid).find(l => l.diedAt !== undefined
      && Math.abs(l.diedAt - death.t) < SAME_DEATH) ?? life;
  }
  death.life = life;
  return life;
}

/**
 * Whom the camera goes on to as the clock plays from `prevT` to `t`,
 * following `pid`: his killer, at the moment the death cam has held his
 * death DEATH_HOLD seconds (the Auto camera's own beat), if the killer is
 * in the round to be watched then; else null. A frame that does not play
 * forward through that moment hands nothing on: a step back, or a seek,
 * which leaves the frame no step (replay.js `seek`).
 */
export function killerToFollow(rec, pid, prevT, t, kills = rec.kills) {
  if (!(t > prevT)) return null;
  const death = deathAt(rec, pid, t, kills);
  if (!death) return null;
  const at = death.t + DEATH_HOLD;
  if (!(prevT < at && at <= t)) return null;
  const killer = death.killer;
  if (killer === null || killer === undefined || killer === pid) return null;
  const state = playerStatusAt(rec, killer, t, kills).state;
  if (state !== 'foot' && state !== 'vehicle') return null;
  return deathAt(rec, killer, t, kills) ? null : killer;
}

/** Each hull's cockpit graft, asked for once (`setFirstPersonHull`). */
const cockpits = new WeakMap();

/** A hull's bounding radius about its root, collision meshes left out;
 *  measured once per hull. */
const radii = new WeakMap();
export function hullRadius(hull) {
  if (radii.has(hull)) return radii.get(hull);
  const root = hull.root;
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const centre = new THREE.Vector3();
  let radius = 0;
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    for (let n = obj; n && n !== root; n = n.parent) {
      if (n.userData?.collision || /collision/i.test(n.name || '')) return;
    }
    if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
    const sphere = obj.geometry.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius)) return;
    local.multiplyMatrices(inverse, obj.matrixWorld);
    centre.copy(sphere.center).applyMatrix4(local);
    radius = Math.max(radius, centre.length() + sphere.radius * local.getMaxScaleOnAxis());
  });
  radius = radius > 0.5 && Number.isFinite(radius) ? Math.min(radius, 200) : 4;
  radii.set(hull, radius);
  return radius;
}

/** The heading a camera looking along `q` (three's -Z forward) has. */
function headingOf(q) {
  _fwd.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-_fwd.x, -_fwd.z);
}

/**
 * A soldier's recorded aim at `t`, `{ body, yaw, pitch }`: `body` his
 * sample's rotation in the view's frame, into `body`; `yaw` and `pitch` the
 * view's turn off it, radians, about the body's own up and then its own
 * right: his torso's twist and his aim pitch (`viewQuaternion` puts them
 * together). His recorded rotation looks where he does, as a hull's does (its
 * -Z is his forward; `targetAt` reads it the same way); the pose glb's half
 * turn (replay-bodies.js `SOLDIER_YAW_FLIP`) is the body model's, never the
 * view's: with it, the view looked out of the back of his head. The twist
 * turns the view the other way from BF1942's yaw, as the frame's z is
 * negated.
 *
 * Standing, his body is upright and this is his heading plus the twist, his
 * aim pitch off the level. Lying down, his body lies along the slope under
 * him, and his aim is off that: prone on 27 degrees of downhill from 35:24 of
 * replay_20260928-161948, 8.7 recorded degrees of pitch are 21.8 up off the
 * slope, 5 below the level, and his rounds left 6 below it; read off the
 * level, they put the view 22 degrees into the sky (replay-recording.js
 * `AIM_PITCH_SCALE`).
 */
export function eyeAim(rec, life, t, body = new THREE.Quaternion()) {
  const s = sampleAt(life, settledTime(life, t));
  if (!s) return { body: body.identity(), yaw: 0, pitch: 0 };
  toViewQuaternion(s.a.q, body);
  if (s.b) body.slerp(toViewQuaternion(s.b.q, _q2), s.k);
  const aim = aimAt(rec, life.nid, t);
  return { body, yaw: (aim?.twist ?? 0) * TWIST, pitch: (aim?.pitch ?? 0) * PITCH };
}

/** The camera's rotation for a view (`eyeAim`, `viewOf`): its body turned by
 *  `yaw` about the body's up and raised by `pitch` about its right, into
 *  `out`. */
export function viewQuaternion(view, out = new THREE.Quaternion()) {
  return out.copy(view.body).multiply(_q.setFromEuler(_e.set(view.pitch, view.yaw, 0, 'YXZ')));
}

export class ReplayCamera {
  constructor(player) {
    this.player = player;
    const cam = player.ctx.camera;
    this.mode = 'orbit';
    // A seat's first person: its cockpit, or the nose cam of an aircraft
    // whose Camera has one (seat-view.js): the same eye pushed past the
    // propeller, no cockpit drawn, the reticle over open air. The game's
    // first-person key reaches it on a second press; C does here
    // (replay-ui.js). Kept while the first person is, so it comes back
    // when he climbs into the next aircraft.
    this.povView = 'cockpit';
    // Orbit: the wanted angles and zoom, and the eased ones drawn.
    this.yaw = -Math.PI / 4;
    this.pitch = 0.35;
    this.zoom = 1;
    this.eased = { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
    this.aimed = false;          // the orbit has been put behind a first target
    // The death the orbit is framed on (`deathAt`), and the tilt and zoom it
    // had before, put back once he is out of it.
    this.death = null;
    this.beforeDeath = null;
    // The glide: what is left of the last view, easing out.
    this.carryPos = new THREE.Vector3();
    this.carryLook = new THREE.Vector3();
    this.lastPos = new THREE.Vector3();
    this.lastLook = new THREE.Vector3();
    this.lastLife = null;
    this.valid = false;
    // Free.
    this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
    // First person: the view's turn off his body last drawn (`eyeAim`), and
    // the look-around offset.
    this.pov = { yaw: 0, pitch: 0, ready: false, lookYaw: 0, lookPitch: 0, life: null };
    this.shotAxes = new WeakMap();  // soldier life -> his rounds' axes off his recorded aim
    this.footFov = FOOT_LENS.fov;   // the first person's lens, degrees: his zoom's, eased
    this.zoomLife = null;
    this.looking = false;        // a drag is turning the first-person view
    this.keys = new Set();       // held movement keys (KeyW ..., ShiftLeft)
    this.stick = null;           // the free camera's thumbstick: { x, y } in the unit disc, y ahead
    this.hidePid = null;         // whose body the first-person view is inside
    // What the first-person view looks out of this frame, for his HUD
    // (replay-hud.js): `{ kind: 'foot', life }` his eyes, `{ kind: 'seat',
    // life, hull, seat }` a seat's camera, or null.
    this.sight = null;
    this.firstPersonHull = null;
    this.noseHull = new NoseHull();
    this.pageLens = { fov: cam.fov, near: cam.near };
    this.lens = 'page';
    this.target = null;          // the last orbit target, for the UI's read
    // The last pose drawn that was all numbers, which a view that cannot be
    // placed holds (`update`), and what went wrong, said once a kind.
    this.good = { pos: new THREE.Vector3(0, 100, 0), quat: new THREE.Quaternion() };
    if (finiteVector(cam.position) && finiteVector(cam.quaternion)) {
      this.good.pos.copy(cam.position);
      this.good.quat.copy(cam.quaternion);
    }
    this.faults = new Set();
    // The creator view's (replay-creator.js): a rig that places the camera
    // over the mode while it will (`placeRig`: a round in flight, a camera
    // track), and a lens over every view but his eyes (`setLensHook`).
    this.rig = null;
    this.lensHook = null;
  }

  /** A rig places the camera instead of the mode from now on, while its
   *  `place(cam, dt, t)` answers true; null hands back. A rig's `drag(dx,
   *  dy)` and `wheel(steps)` take the view's drags and wheel when they answer
   *  true. */
  setRig(rig) {
    this.rig = rig ?? null;
  }

  /** `fn(cam)` shapes the lens of every view but his eyes, each frame, before
   *  the soldiers are culled against it; null puts the page's lens back. */
  setLensHook(fn) {
    this.lensHook = fn ?? null;
    if (!fn && this.lens === 'page') {
      this.lens = null;
      this.useLens('page');
    }
  }

  // --- input -----------------------------------------------------------------

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode) || mode === this.mode) return false;
    const cam = this.player.ctx.camera;
    if (mode !== 'pov') this.povView = 'cockpit';
    if (mode === 'free') {
      this.free.pos.copy(cam.position);
      _e.setFromQuaternion(cam.quaternion, 'YXZ');
      this.free.yaw = _e.y;
      this.free.pitch = clamp(_e.x, -1.5, 1.5);
    }
    if (mode === 'orbit') {
      // Out of the free camera: the orbit picks up on the side of him the
      // camera already is. Out of first person: behind him, where his eyes
      // were looking.
      const target = this.targetAt(this.player.time);
      if (target && this.mode === 'free') {
        _v.copy(cam.position).sub(target.point);
        const d = _v.length();
        if (d > 0.5 && d < CUT) {
          this.yaw = Math.atan2(_v.x, _v.z);
          this.pitch = clamp(Math.asin(clamp(_v.y / d, -1, 1)), PITCH_MIN, PITCH_MAX);
          this.zoom = clamp(d / target.base, ZOOM_MIN, ZOOM_MAX);
        }
      } else if (target && this.mode === 'pov') {
        this.yaw = headingOf(cam.quaternion);
        this.pitch = 0.3;
        this.zoom = Math.min(this.zoom, 1);
      }
      this.eased = { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
      this.startGlide(cam.position, _v2.set(0, 0, -20).applyQuaternion(cam.quaternion).add(cam.position));
    }
    if (mode === 'pov') this.pov.ready = false;
    this.mode = mode;
    return true;
  }

  /** The first person's other seat view, the cockpit or the nose cam: what
   *  it went to, or null where he sits in nothing that has a nose cam. */
  toggleNose() {
    if (this.mode !== 'pov' || this.sight?.kind !== 'seat' || !this.sight.nose) return null;
    this.povView = this.povView === 'nose' ? 'cockpit' : 'nose';
    return this.povView;
  }

  cycleMode() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  /** The orbit behind the target again, at its own distance. */
  resetOrbit() {
    const target = this.targetAt(this.player.time);
    this.yaw = target?.heading ?? this.yaw;
    this.pitch = 0.35;
    this.zoom = 1;
  }

  /** A drag of `dx`, `dy` pixels. */
  drag(dx, dy) {
    if (!finite(dx, dy)) return;
    if (this.rig?.drag?.(dx, dy)) return;
    if (this.mode === 'orbit') {
      this.yaw -= dx * DRAG;
      this.pitch = clamp(this.pitch + dy * DRAG * 0.8, PITCH_MIN, PITCH_MAX);
    } else if (this.mode === 'free') {
      this.free.yaw -= dx * LOOK;
      this.free.pitch = clamp(this.free.pitch - dy * LOOK, -1.5, 1.5);
    } else {
      this.pov.lookYaw = clamp(this.pov.lookYaw - dx * LOOK, -2.6, 2.6);
      this.pov.lookPitch = clamp(this.pov.lookPitch - dy * LOOK, -1.2, 1.2);
    }
  }

  /** The wheel: `steps` > 0 is out (away from him, or backwards). */
  wheel(steps) {
    if (!finite(steps)) return;
    if (this.rig?.wheel?.(steps)) return;
    if (this.mode === 'orbit') {
      // Wheeled in on a man or his seat once the orbit is as close as it
      // goes: into his eyes, the way wheeling out of them comes back here.
      const eyes = this.target?.kind === 'soldier' || this.target?.kind === 'hull';
      if (steps < 0 && eyes && this.zoom <= ZOOM_MIN * 1.001) {
        this.setMode('pov');
        return;
      }
      this.zoom = clamp(this.zoom * Math.exp(steps * 0.15), ZOOM_MIN, ZOOM_MAX);
    } else if (this.mode === 'free') {
      _fwd.set(0, 0, -1).applyEuler(_e.set(this.free.pitch, this.free.yaw, 0, 'YXZ'));
      this.free.pos.addScaledVector(_fwd, -steps * 4 * (this.fast() ? FREE_FAST : 1));
    } else if (steps > 0) {
      // Wheeling out of his eyes leaves them for the orbit, close behind.
      this.setMode('orbit');
      this.zoom = ZOOM_MIN * 2;
    }
  }

  /** A pinch: `ratio` > 1 is fingers apart (in; the free camera flies
   *  ahead, as the wheel moves it). */
  pinch(ratio) {
    if (!(ratio > 0)) return;
    if (this.mode === 'orbit') this.zoom = clamp(this.zoom / ratio, ZOOM_MIN, ZOOM_MAX);
    else if (this.mode === 'free') this.wheel(-Math.log(ratio) * PINCH_FLY);
  }

  fast() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** A new player to follow: the orbit eases over to him (or cuts, if he is
   *  far), a free camera becomes the orbit. */
  followChanged() {
    if (this.mode === 'free') this.setMode('orbit');
    this.pov.ready = false;
  }

  /** A seek: whatever was eased toward is now somewhere else. */
  snap() {
    this.valid = false;
    this.pov.ready = false;
  }

  // --- the target ---------------------------------------------------------------

  /** What the orbit circles at `t`: `{ life, kind, point, base, minPitch,
   *  heading }`, or null when the followed player has nothing to look at.
   *  A death's is `{ kind: 'death', key, pitch }` as well: `key` what the
   *  glide tells it apart by, `pitch` and `heading` its shot. */
  targetAt(t) {
    const { player } = this;
    if (player.followPid === null) return null;
    // Dead: over where he fell until he is back, never over the spawn he
    // has not chosen yet. That was read off his next soldier's first
    // sample, which after a vehicle can lie anywhere: 1.2 km from the
    // fight at 120 s of replay_20260928-133433 (the 2026-10-06 report, "it
    // snaps you to a random spot").
    const death = deathAt(player.rec, player.followPid, t, player.kills);
    if (death) {
      const target = this.deathTarget(death, t);
      if (target) return target;
    }
    const life = focusLife(player, t, true);
    // Waiting to spawn with no body of his to watch: over where he will
    // appear, framed as he will be there. His spectator camera sits wherever
    // the game left it, the world's origin before his first spawn.
    if (!life || life.camera) {
      const spawn = nextSpawn(player.rec, player.followPid, t);
      const target = spawn && this.spawnTarget(spawn.life);
      if (target) return target;
    }
    if (!life) return null;
    // A man just out of a vehicle where the recording next has him, as he is
    // drawn (replay-recording.js `settledTime`).
    const s = sampleAt(life, settledTime(life, t));
    if (!s) return null;
    const point = toViewPosition(s.a.p, new THREE.Vector3());
    if (s.b) point.lerp(toViewPosition(s.b.p, _v), s.k);
    toViewQuaternion(s.a.q, _q);
    if (s.b) _q.slerp(toViewQuaternion(s.b.q, _q2), s.k);
    if (life.soldier) {
      const dead = life.diedAt !== undefined && t >= life.diedAt;
      const rig = dead ? BODY : SOLDIER;
      point.y += rig.lift;
      return { life, kind: dead ? 'body' : 'soldier', point, base: rig.base, minPitch: PITCH_MIN, heading: headingOf(_q) };
    }
    if (life.camera) {
      return { life, kind: 'camera', point, base: SPECTATOR.base, minPitch: SPECTATOR.minPitch, heading: headingOf(_q) };
    }
    const hull = player.hulls?.get(life);
    let radius = 4;
    if (hull) {
      // The hull as drawn this frame, which is where the orbit must centre.
      hull.root.getWorldPosition(point);
      hull.root.getWorldQuaternion(_q);
      radius = hullRadius(hull);
    }
    point.y += radius * HULL_LIFT;
    return { life, kind: 'hull', hull, point, base: clamp(radius * HULL_BASE, 8, 400), minPitch: PITCH_MIN, heading: headingOf(_q) };
  }

  /** The orbit over where `life`, a soldier yet to spawn, first stands. */
  spawnTarget(life) {
    const key = life.keys.at(0);
    if (!key) return null;
    const point = toViewPosition(key.p, new THREE.Vector3());
    point.y += SOLDIER.lift;
    return { life, kind: 'spawn', point, base: SOLDIER.base, minPitch: PITCH_MIN, heading: headingOf(toViewQuaternion(key.q, _q)) };
  }

  /** The death cam on `death` at `t`: his body as it lies, or the hull he
   *  died in as it is drawn (a burning plane still falling), held where it
   *  last was once the server takes it away. Null when the recording has
   *  no place for either. */
  deathTarget(death, t) {
    const { player } = this;
    const life = diedIn(player.rec, death);
    if (!life) return null;
    const point = new THREE.Vector3();
    const hull = life.soldier ? null : player.hulls?.get(life) ?? null;
    if (hull?.group.visible) {
      hull.root.getWorldPosition(point);
      hull.root.getWorldQuaternion(_q);
    } else {
      const at = Math.max(life.created, Math.min(t, life.destroyed - 0.01));
      const s = sampleAt(life, life.soldier ? settledTime(life, at) : at);
      if (!s) return null;
      toViewPosition(s.a.p, point);
      if (s.b) point.lerp(toViewPosition(s.b.p, _v), s.k);
      toViewQuaternion(s.a.q, _q);
      if (s.b) _q.slerp(toViewQuaternion(s.b.q, _q2), s.k);
    }
    if (!finiteVector(point)) return null;
    if (life.soldier) {
      // His body as drawn, falling and then lying, and where it came to rest
      // once the corpse is cleared away; his recorded place where none is.
      const heading = headingOf(_q);
      const drawn = player.soldiers?.pelvisOf?.(death.pid, _v);
      if (drawn && finiteVector(drawn) && drawn.distanceTo(point) < CORPSE_NEAR) {
        death.rest = (death.rest ?? new THREE.Vector3()).copy(drawn);
      }
      if (death.rest) point.copy(death.rest);
      else point.y += BODY.lift;
      death.shotYaw ??= this.corpseShotYaw(death, point, heading);
      return { life, key: death, death, kind: 'death', point, base: DEATH_FOOT.dist, pitch: DEATH_FOOT.pitch,
               minPitch: PITCH_MIN, heading: death.shotYaw };
    }
    const radius = hull ? hullRadius(hull) : 4;
    point.y += radius * HULL_LIFT;
    // Straight down, the hull's nose to the top of the frame.
    death.shotYaw ??= headingOf(_q);
    return { life, key: death, death, kind: 'death', hull, point,
             base: clamp(Math.max(DEATH_WRECK.dist, radius * DEATH_WRECK.perRadius), DIST_MIN, DIST_MAX),
             pitch: PITCH_MAX, minPitch: PITCH_MIN, heading: death.shotYaw };
  }

  /** The way the death cam looks at a body at `point`: from beyond it,
   *  away from where his killer stood as he died; with no killer to place,
   *  behind him along `heading`, the way he fell (soldier-view.js
   *  `corpseShotYaw`). */
  corpseShotYaw(death, point, heading) {
    const { player } = this;
    if (death.killer !== null && death.killer !== death.pid) {
      const from = whereIs(player.rec, death.killer, death.t, player.kills ?? player.rec.kills).pos;
      if (from) {
        const dx = point.x - from[0];
        const dz = point.z - from[2];
        if (Math.hypot(dx, dz) > 1) return Math.atan2(dx, dz);
      }
    }
    return heading;
  }

  // --- per frame -----------------------------------------------------------------

  update(dt, t) {
    const cam = this.player.ctx.camera;
    this.hidePid = null;
    this.sight = null;
    this.sanitize();
    let firstPersonHull = null;
    let noseHull = null;
    try {
      if (this.rig && this.placeRig(dt, t)) {
        this.useLens('page');
      } else if (this.mode === 'free') {
        this.updateFree(dt);
        this.useLens('page');
      } else if (this.mode === 'pov' && this.placePov(dt, t)) {
        firstPersonHull = this.povHull;
        noseHull = this.povNoseHull;
      } else {
        this.updateOrbit(dt, t);
        this.useLens('page');
      }
    } catch (error) {
      this.fault(`the ${this.mode} camera threw`, error);
      this.hidePid = null;
      this.sight = null;
    }
    // A pose that is not all numbers is never drawn: it froze the page (the
    // audio listener throws on it, before the render) and, carried into the
    // orbit's angles and the free camera's place, it outlived every change
    // of mode and of player. The last good pose holds instead.
    if (this.poseFinite(cam)) {
      this.good.pos.copy(cam.position);
      this.good.quat.copy(cam.quaternion);
    } else {
      this.fault(`the ${this.mode} camera came out as no position`);
      this.hold(cam);
      firstPersonHull = null;
      noseHull = null;
    }
    this.setFirstPersonHull(firstPersonHull);
    this.noseHull.hide(noseHull?.root ?? null);
    // The creator's lens, never over his eyes: the game's own lens and his
    // zoom are what he saw.
    if (this.lensHook && this.lens !== 'foot' && this.lens !== 'seat') {
      try {
        this.lensHook(cam);
      } catch (error) {
        this.fault('the lens threw', error);
        this.setLensHook(null);
      }
      if (!this.poseFinite(cam)) {
        this.fault('the lens came out as no pose');
        this.setLensHook(null);
        this.hold(cam);
      }
    }
    cam.updateMatrixWorld();
  }

  /**
   * The rig's frame (`setRig`): true when it placed the camera. One that
   * throws, or places it at no position, is dropped and the mode takes the
   * frame; one that lets go hands the mode its last view to glide out of.
   */
  placeRig(dt, t) {
    const cam = this.player.ctx.camera;
    const rig = this.rig;
    try {
      if (!rig.place(cam, dt, t)) return false;
      if (this.poseFinite(cam)) {
        this.startGlide(cam.position, _v2.set(0, 0, -20).applyQuaternion(cam.quaternion).add(cam.position));
        return true;
      }
      this.fault('a creator rig came out as no position');
    } catch (error) {
      this.fault('a creator rig threw', error);
    }
    if (this.rig === rig) this.rig = null;
    this.hold(cam);
    return false;
  }

  /**
   * First person, where his eyes give a pose the view can take (`updatePov`).
   * One that throws, or comes out as no position (a rig or a record that is
   * not all numbers), is no first person this frame: the orbit stands in, as
   * it does for a man with no eyes to look through, and nothing of the first
   * person is left set.
   */
  placePov(dt, t) {
    const cam = this.player.ctx.camera;
    try {
      if (!this.updatePov(dt, t)) return false;
      if (this.poseFinite(cam)) return true;
      this.fault('first person came out as no position', { pid: this.player.followPid, t });
    } catch (error) {
      this.fault('first person threw', error);
    }
    this.hidePid = null;
    this.sight = null;
    this.povHull = null;
    this.povNoseHull = null;
    this.hold(cam);
    this.startGlide(this.good.pos, _v2.set(0, 0, -6).applyQuaternion(this.good.quat).add(this.good.pos));
    return false;
  }

  /** Whether the camera's pose and lens are all numbers. */
  poseFinite(cam) {
    return finiteVector(cam.position) && finiteVector(cam.quaternion) && lensOk(cam);
  }

  /** The last pose drawn that was all numbers, back on the camera, with the
   *  page's lens if the lens is what broke. */
  hold(cam) {
    cam.position.copy(this.good.pos);
    cam.quaternion.copy(this.good.quat);
    if (!lensOk(cam)) {
      this.lens = null;
      this.useLens('page');
    }
  }

  /**
   * Any of the camera's own state that is not a number any more, back to
   * something it can be drawn from: the orbit's angles and zoom, the free
   * camera's place and look, the look-around and the glide. One bad frame
   * (a pose from a broken rig, a drag the browser measured as nothing) must
   * not leave every later frame bad.
   */
  sanitize() {
    if (!finite(this.yaw)) this.yaw = finite(this.eased.yaw) ? this.eased.yaw : 0;
    if (!finite(this.pitch)) this.pitch = 0.35;
    if (!finite(this.zoom) || this.zoom <= 0) this.zoom = 1;
    for (const key of ['yaw', 'pitch', 'zoom']) {
      if (!finite(this.eased[key])) this.eased[key] = this[key];
    }
    const free = this.free;
    if (!finiteVector(free.pos)) free.pos.copy(this.good.pos);
    if (!finite(free.yaw)) free.yaw = 0;
    if (!finite(free.pitch)) free.pitch = 0;
    const pov = this.pov;
    if (!finite(pov.lookYaw, pov.lookPitch)) {
      pov.lookYaw = 0;
      pov.lookPitch = 0;
    }
    if (!finiteVector(this.carryPos)) this.carryPos.set(0, 0, 0);
    if (!finiteVector(this.carryLook)) this.carryLook.set(0, 0, 0);
    if (!finiteVector(this.lastPos) || !finiteVector(this.lastLook)) this.valid = false;
    if (this.stick && !finite(this.stick.x, this.stick.y)) this.stick = { x: 0, y: 0 };
  }

  /** What the camera could not do, said once a kind; the frame goes on. */
  fault(what, detail = undefined) {
    if (this.faults.has(what)) return;
    this.faults.add(what);
    console.warn(`replay camera: ${what}`, ...(detail === undefined ? [] : [detail]));
  }

  startGlide(fromPos, fromLook) {
    this.lastPos.copy(fromPos);
    this.lastLook.copy(fromLook);
    this.valid = true;
    this.lastLife = null;       // the next orbit frame measures the glide
  }

  updateOrbit(dt, t) {
    const cam = this.player.ctx.camera;
    const target = this.targetAt(t);
    this.target = target;
    if (!target) return;
    this.frameDeath(target.kind === 'death' ? target : null);
    if (!this.aimed) {
      // The first sight of anyone: behind him, the way the game's own
      // third-person view starts.
      this.yaw = target.heading;
      this.eased.yaw = this.yaw;
      this.aimed = true;
    }
    const k = this.keys;
    const turn = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const tilt = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const push = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    if (turn) this.yaw += turn * KEY_TURN * dt;
    if (tilt) this.pitch = clamp(this.pitch + tilt * KEY_TILT * dt, PITCH_MIN, PITCH_MAX);
    if (push) this.zoom = clamp(this.zoom * Math.exp(push * KEY_ZOOM * dt), ZOOM_MIN, ZOOM_MAX);

    const ease = 1 - Math.exp(-dt / SMOOTH);
    this.eased.yaw += (this.yaw - this.eased.yaw) * ease;
    this.eased.pitch += (this.pitch - this.eased.pitch) * ease;
    this.eased.zoom += (this.zoom - this.eased.zoom) * ease;
    const pitch = Math.max(this.eased.pitch, target.minPitch);
    const dist = clamp(target.base * this.eased.zoom, DIST_MIN, DIST_MAX);
    const desired = _v.set(
      Math.sin(this.eased.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.eased.yaw) * Math.cos(pitch),
    ).multiplyScalar(dist).add(target.point);

    // A new target (another player, his seat, his death) or a new mode:
    // carry the last view and let it ease out, unless the new one is far.
    const key = target.key ?? target.life;
    if (key !== this.lastLife) {
      if (this.valid && this.lastLook.distanceTo(target.point) < CUT) {
        this.carryPos.copy(this.lastPos).sub(desired);
        this.carryLook.copy(this.lastLook).sub(target.point);
      } else {
        this.carryPos.set(0, 0, 0);
        this.carryLook.set(0, 0, 0);
      }
      this.lastLife = key;
    }
    const fade = Math.exp(-dt / GLIDE);
    this.carryPos.multiplyScalar(fade);
    this.carryLook.multiplyScalar(fade);

    cam.position.copy(desired).add(this.carryPos);
    this.keepAbove(cam.position);
    this.lastLook.copy(target.point).add(this.carryLook);
    cam.lookAt(this.lastLook);
    this.lastPos.copy(cam.position);
    this.valid = true;
  }

  /**
   * Into a death (`target`, a `deathTarget`) or out of one (null): the
   * death cam's shot is put on once, the orbit's tilt and zoom kept for
   * after, and a drag or the wheel still moves it. Out of it, they come back
   * and the orbit goes behind whoever it is on now, his killer or himself
   * respawned. Each change glides (`updateOrbit`).
   */
  frameDeath(target) {
    const death = target?.death ?? null;
    if (death === this.death) return;
    if (death) {
      this.beforeDeath ??= { pitch: this.pitch, zoom: this.zoom };
      this.yaw = target.heading;
      this.pitch = target.pitch;
      this.zoom = 1;
      this.eased = { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
      this.aimed = true;
    } else if (this.beforeDeath) {
      this.pitch = this.beforeDeath.pitch;
      this.zoom = this.beforeDeath.zoom;
      this.eased = { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
      this.beforeDeath = null;
      this.aimed = false;
    }
    this.death = death;
  }

  /** Above the ground and the water, where the level has them. */
  keepAbove(p) {
    const ctx = this.player.ctx;
    let floor = -Infinity;
    const ground = ctx.groundHeight?.(p.x, p.z);
    if (Number.isFinite(ground)) floor = ground;
    const water = ctx.waterLevel?.();
    if (Number.isFinite(water)) floor = Math.max(floor, water);
    if (p.y < floor + CLEARANCE) p.y = floor + CLEARANCE;
  }

  updateFree(dt) {
    const cam = this.player.ctx.camera;
    const k = this.keys;
    let fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const lift = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const stick = this.stick;
    const push = stick ? Math.min(1, Math.hypot(stick.x, stick.y)) : 0;
    if (push > 0) {
      const gain = (STICK_FAST * push * push) / Math.hypot(stick.x, stick.y);
      fwd += stick.y * gain;
      side += stick.x * gain;
    }
    const { free } = this;
    _e.set(free.pitch, free.yaw, 0, 'YXZ');
    if (fwd || side || lift) {
      const step = FREE_SPEED * (this.fast() ? FREE_FAST : 1) * dt;
      _fwd.set(0, 0, -1).applyEuler(_e);
      _v.set(1, 0, 0).applyEuler(_e);
      free.pos.addScaledVector(_fwd, fwd * step).addScaledVector(_v, side * step);
      free.pos.y += lift * step;
    }
    this.keepAbove(free.pos);
    cam.position.copy(free.pos);
    cam.quaternion.setFromEuler(_e);
    this.startGlide(cam.position, _v2.set(0, 0, -20).applyQuaternion(cam.quaternion).add(cam.position));
  }

  /** First person; false when there are no eyes to look through (dead, not
   *  yet spawned, a bot's camera), and the orbit's death cam stands in. A
   *  recording player's own camera while he is dead is not his view either:
   *  after his death it flies to wherever the spawn screen shows. */
  updatePov(dt, t) {
    const { player } = this;
    const cam = player.ctx.camera;
    this.povHull = null;
    this.povNoseHull = null;
    if (deathAt(player.rec, player.followPid, t, player.kills)) return false;
    const life = focusLife(player, t);
    if (!life) return false;
    let lens = null;
    if (life.soldier) {
      if (life.diedAt !== undefined && t >= life.diedAt) return false;
      const s = sampleAt(life, settledTime(life, t));
      if (!s) return false;
      toViewPosition(s.a.p, cam.position);
      if (s.b) cam.position.lerp(toViewPosition(s.b.p, _v), s.k);
      // Where his eyes looked, which is where the game drew his crosshair:
      // the screen's centre (`viewOf`).
      const view = this.viewOf(life, t);
      // And where they were: the template's camera offset from his origin (a
      // metre over his feet), along his body's own up, which lying on a
      // slope is not the world's (replay-recording.js `eyeLiftAt`).
      cam.position.y += CHARACTER_HEIGHT;
      cam.position.add(_v.set(0, eyeLiftAt(player.rec, life.nid, t), 0).applyQuaternion(view.body));
      const pov = this.pov;
      pov.yaw = view.yaw;
      pov.pitch = view.pitch;
      pov.ready = true;
      pov.life = life;
      viewQuaternion(view, cam.quaternion);
      this.hidePid = player.followPid;
      this.sight = { kind: 'foot', life };
      lens = 'foot';
      // His zoom (replay-recording.js `ZOOM_BIT`): the weapon's own lens.
      const zoom = player.hud?.zoomOf?.(life, t);
      const target = zoom?.zoomed && zoom.fov ? zoom.fov : FOOT_LENS.fov;
      const fresh = this.lens !== 'foot' || this.zoomLife !== life;
      this.zoomLife = life;
      this.footFov = fresh || Math.abs(target - this.footFov) <= ZOOM_SNAP
        ? target : this.footFov + (target - this.footFov) * ZOOM_EASE;
    } else if (life.camera) {
      // His own spectator camera (the recording player on the spawn screen):
      // what he was looking at.
      const s = sampleAt(life, t);
      if (!s || !life.keys.length) return false;
      // One the game has not placed yet sits at the world's origin, looking
      // at nothing: the orbit stands in, over where he will spawn.
      if (!s.a.p[0] && !s.a.p[1] && !s.a.p[2]) return false;
      toViewPosition(s.a.p, cam.position);
      if (s.b) cam.position.lerp(toViewPosition(s.b.p, _v), s.k);
      toViewQuaternion(s.a.q, cam.quaternion);
      if (s.b) cam.quaternion.slerp(toViewQuaternion(s.b.q, _q2), s.k);
      this.pov.ready = false;
      lens = 'page';
    } else {
      const hull = player.hulls?.get(life);
      if (!hull?.group.visible) return false;
      const nid = controlledAt(player.rec, player.followPid, t);
      const seat = rootOf(player.rec, nid, t, player.followPid)?.seat ?? 0;
      const seatId = hull.seatIdAt(seat) ?? hull.occupancy.rootId;
      const eye = hull.occupancy.cameraNodeOf(seatId);
      eye.updateWorldMatrix(true, false);
      eye.getWorldPosition(cam.position);
      eye.getWorldQuaternion(cam.quaternion);
      // The nose cam: `OutsideHudOffset` along the Camera's own axes, the
      // hull not drawn (seat-view.js `NoseHull`).
      const offset = player.rec.noseCam === false ? null : noseCamOffset(eye.name, eye.userData?.cameraView);
      const nose = this.povView === 'nose' && offset !== null;
      if (nose) cam.position.add(_v.fromArray(offset).applyQuaternion(cam.quaternion));
      this.hidePid = player.followPid;
      this.povHull = seat === 0 && !nose ? hull : null;
      this.povNoseHull = nose ? hull : null;
      this.pov.ready = false;
      this.sight = { kind: 'seat', life, hull, seat, nose: offset !== null, view: nose ? 'nose' : 'cockpit' };
      lens = 'seat';
    }
    this.applyLook(dt, cam);
    // Dragged off his aim, the view's centre is not where he looked.
    if (this.sight) this.sight.looking = Math.hypot(this.pov.lookYaw, this.pov.lookPitch) > 0.005;
    this.useLens(lens);
    if (lens === 'foot' && cam.fov !== this.footFov) {
      cam.fov = this.footFov;
      cam.updateProjectionMatrix();
    }
    this.startGlide(cam.position, _v2.set(0, 0, -6).applyQuaternion(cam.quaternion).add(cam.position));
    this.frameDeath(null);
    return true;
  }

  /**
   * Where a soldier's eyes looked at `t`, `{ body, yaw, pitch }` as `eyeAim`
   * gives it (`viewQuaternion` makes it a rotation): his recorded aim, laid
   * onto the axis his rounds left along around each one (`shotFix`). Nothing
   * is eased: the samples and the aim are eased into each next record
   * already, and an eased view trails a turn, which leaves the crosshair
   * behind the rounds.
   */
  viewOf(life, t) {
    const view = eyeAim(this.player.rec, life, t);
    const fix = this.shotFix(life, t);
    view.yaw += fix.yaw;
    view.pitch += fix.pitch;
    return view;
  }

  /** The view's offset at `t` from `life`'s recorded aim onto his rounds'
   *  axes (`SHOT_HOLD`): whole at a round, eased across a burst, gone a
   *  quarter of a second from the nearest. */
  shotFix(life, t) {
    const axes = this.roundAxes(life);
    if (!axes.length) return { yaw: 0, pitch: 0 };
    let lo = 0;
    let hi = axes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (axes[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    const before = axes[hi - 1] ?? null;
    const after = axes[hi] ?? null;
    if (before && after && after.t - before.t <= 2 * SHOT_HOLD) {
      const k = (t - before.t) / (after.t - before.t);
      return { yaw: before.yaw + (after.yaw - before.yaw) * k, pitch: before.pitch + (after.pitch - before.pitch) * k };
    }
    const near = !after || (before && t - before.t <= after.t - t) ? before : after;
    const w = Math.max(0, 1 - Math.abs(t - near.t) / SHOT_HOLD);
    return { yaw: near.yaw * w, pitch: near.pitch * w };
  }

  /** `life`'s rounds as offsets from his recorded aim at each, `[{ t, yaw,
   *  pitch }]` about his body's own axes (`eyeAim`), once a life: every round
   *  of a weapon fired along the camera, so not what he throws or lays (a
   *  grenade leaves above his view). */
  roundAxes(life) {
    let axes = this.shotAxes.get(life);
    if (axes) return axes;
    axes = [];
    const { rec } = this.player;
    const rounds = this.player.networkedRounds ?? new Set(NETWORKED_ROUNDS.map(n => n.toLowerCase()));
    const thrown = new Set([...rounds].map(weaponOfProjectile).filter(Boolean).map(w => w.toLowerCase()));
    for (const f of rec.fires ?? []) {
      if (f.press || f.nid !== life.nid || !Array.isArray(f.dir)) continue;
      if (f.t < life.created || f.t >= life.destroyed || thrown.has(String(f.weapon).toLowerCase())) continue;
      const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
      if (!(n > 0.1)) continue;
      // BF1942's frame to the view's (z negated), then into his body's own:
      // three's camera looks down its -Z, so a yaw of atan2(-x, -z) and a
      // pitch of asin(y).
      const aim = eyeAim(rec, life, f.t, _body);
      _v.set(f.dir[0] / n, f.dir[1] / n, -f.dir[2] / n).applyQuaternion(_q2.copy(aim.body).invert());
      const yaw = wrap(Math.atan2(-_v.x, -_v.z) - aim.yaw);
      const pitch = Math.asin(clamp(_v.y, -1, 1)) - aim.pitch;
      if (Math.abs(yaw) > SHOT_MAX_YAW || Math.abs(pitch) > SHOT_MAX_PITCH) continue;
      axes.push({ t: f.t, yaw, pitch });
    }
    axes.sort((a, b) => a.t - b.t);
    this.shotAxes.set(life, axes);
    return axes;
  }

  /** A drag turns the head; let go, it comes back to his view. */
  applyLook(dt, cam) {
    const pov = this.pov;
    if (!this.looking) {
      const back = Math.exp(-dt / LOOK_RETURN);
      pov.lookYaw *= back;
      pov.lookPitch *= back;
    }
    if (Math.abs(pov.lookYaw) < 1e-4 && Math.abs(pov.lookPitch) < 1e-4) return;
    cam.quaternion.multiply(_q.setFromEuler(_e.set(pov.lookPitch, pov.lookYaw, 0, 'YXZ')));
  }

  /** The camera's lens: the page's own, or the game's first-person ones. */
  useLens(kind) {
    if (kind === this.lens) return;
    this.lens = kind;
    const cam = this.player.ctx.camera;
    const lens = kind === 'foot' ? FOOT_LENS : kind === 'seat' ? SEAT_LENS : this.pageLens;
    cam.fov = lens.fov;
    cam.near = lens.near;
    cam.updateProjectionMatrix();
  }

  /** A pilot's or driver's first person shows the hull's own inside, the
   *  `<Template>.cockpit.glb` the flown vehicle grafts (vehicle-base.js
   *  `loadCockpit`, fetched the first time anyone looks through that hull's
   *  eyes); every other hull stays as seen from outside. */
  setFirstPersonHull(hull) {
    if (hull === this.firstPersonHull) return;
    this.firstPersonHull?.drive?.setFirstPerson?.(false);
    this.firstPersonHull = hull;
    const drive = hull?.drive;
    if (!drive?.setFirstPerson) return;
    if (!cockpits.has(hull) && typeof drive.loadCockpit === 'function') {
      cockpits.set(hull, drive.loadCockpit().catch(() => null).then(() => {
        // The graft keeps whatever the drive last showed; show the inside if
        // this hull is still the one being looked out of.
        drive.setFirstPerson(this.firstPersonHull === hull);
      }));
    }
    drive.setFirstPerson(true);
  }

  dispose() {
    this.setFirstPersonHull(null);
    this.noseHull.hide(null);
    this.useLens('page');
  }
}
