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
//   chase, front, flyby
//          the game's own outside views of the seat he holds (F10, F11,
//          F12; ledger CVM-1..3): `vehicle-camera.js` `VehicleCamera` over
//          the recorded hull, the chase and front chase under the engine's
//          law (`chase-camera.js`, CVM-2), each gated on the seat Camera's
//          `CVM*` words (`seat-view.js` `seatViewModes`). On foot every one
//          is the soldier's chase over his shoulder
//          (features/soldier-third-person-camera), the only outside view the
//          page gives a man on foot.
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
import { noseCamOffset, NoseHull, seatViewModes } from './seat-view.js';
import { CameraShake, applyViewShake } from './fire-shake.js';
import { VehicleCamera } from './vehicle-camera.js';
import {
  CHASE_AHEAD, CHASE_BEHIND, CHASE_SPEED_LAG, boundingRadius, chaseEye, chaseStep, chaseTarget,
} from './chase-camera.js';
import {
  FOOT_CHASE_RADIUS, FOOT_CHASE_SHOULDER, FOOT_WALL_MARGIN, FOOT_WALL_MIN, aimDistance,
} from './soldier-camera.js';
import { motionAt } from './replay-kinematics.js';
import { positionAt } from './replay-recording.js';

export const CAMERA_MODES = Object.freeze(['orbit', 'pov', 'free', 'chase', 'front', 'flyby']);
/** The game's outside views of a seat (`VehicleCamera`'s names). */
export const EXTERNAL_MODES = Object.freeze(['chase', 'front', 'flyby']);
const EXTERNAL = new Set(EXTERNAL_MODES);
/** F9-F12, the common map's `c_PICameraMode1..4` (INSIDE, CHASE REAR, CHASE
 *  FRONT, FLY BY on the game's options screen), as the replay's modes. */
export const CAMERA_KEY_MODES = Object.freeze({ 1: 'pov', 2: 'chase', 3: 'front', 4: 'flyby' });
/** What each outside view is called where the replay says so. */
export const EXTERNAL_LABELS = Object.freeze({ chase: 'Chase', front: 'Front chase', flyby: 'Fly-by' });

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
// 0.2 m near plane, a seat's the same 57.3 (the render view's one 1 rad,
// ledger VIEW-8; it was 60 until 2026-10-11) and 0.1 (a tank's interior is
// 0.09 m ahead of its eye). The orbit and the free camera keep the page's own.
const FOOT_LENS = { fov: 57.3, near: 0.2 };
const SEAT_LENS = { fov: 57.3, near: 0.1 };
/** The outside views keep the render view's one 1 rad lens (VIEW-8): the
 *  game has no other for them. */
const OUTSIDE_LENS = { fov: 57.3, near: 0.2 };
/** Seconds of the round the outside views ease over in one frame at most: a
 *  seek is a jump, and settles them where they rest. */
const OUTSIDE_STEP_MAX = 0.25;
/** Seconds either side the soldier's velocity is differenced over. */
const FOOT_VELOCITY_HALF = 0.1;

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
const _aimQ = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

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
  // A gunner's or passenger's seat has an id of its own that the recording
  // never creates: it is his hull's (`rootOf`). Read as nothing, he stayed
  // dead and the camera sat over his last death while he rode on (skandia in
  // a Ho-Ha's MG seat at 228.7 s of FHSW Makin, replay_20261017-070041).
  const held = took && took.t > death.t
    ? lifeAt(rec, took.nid, t) ?? rootOf(rec, took.nid, t, pid)?.life ?? null
    : null;
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

/**
 * A hull's `getBoundingRadius()` as CVM-2's chase reads it (`chase-camera.js`
 * `boundingRadius`, lnxded `0x08165630`): each node's own mesh reach about
 * its origin or, over its children, their offset plus their radius, the
 * collision meshes and the effects left out. Once a hull, from its first
 * outside view, as the engine caches it on the object (+0xb4).
 */
const chaseRadii = new WeakMap();
export function hullChaseRadius(hull) {
  if (chaseRadii.has(hull)) return chaseRadii.get(hull);
  const skip = n => n.userData?.collision || n.userData?.effect || /collision/i.test(n.name || '');
  const tree = node => {
    let radius = 0;
    if (node.isMesh && node.geometry) {
      if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
      const sphere = node.geometry.boundingSphere;
      if (sphere && Number.isFinite(sphere.radius)) radius = sphere.center.length() + sphere.radius;
    }
    return { radius, offset: node.position.toArray(), children: node.children.filter(c => !skip(c)).map(tree) };
  };
  let radius = boundingRadius(tree(hull.root));
  radius = radius > 0.5 && Number.isFinite(radius) ? Math.min(radius, 200) : 4;
  chaseRadii.set(hull, radius);
  return radius;
}

/** The outside views a seat's Camera node allows, in `VehicleCamera`'s
 *  names: its `CVM*` words (CVM-1: one left out is on) and the recording's
 *  `game.serverExternalViews` (`rec.extViews`, false only where the round
 *  said 0). Inside is never refused. */
export function seatOutsideModes(eye, rec = null) {
  const cvm = eye?.userData?.cameraView?.cvm ?? null;
  const settings = { externalViews: rec?.extViews !== false && rec?.extViews !== 0, allowNoseCam: true };
  return seatViewModes({ cvm, settings }).filter(m => EXTERNAL.has(m));
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
    // The followed man's camera-shake triggers (`BFSoldier +0x31c`), the hit
    // shake for now (`hurt`, `shakeView`).
    this.triggerShake = { shake: new CameraShake(), pid: null, t: null, out: {}, drawn: false,
                          slots: undefined, log: [] };
    this.triggerSlots(null);
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
    this.firstPersonInside = false;
    // The first-person seat view's eye, world space, as the drive of the
    // hull looked out of asks for it (vehicle-base.js `viewEye`).
    this.povEye = new THREE.Vector3();
    this.povInside = true;
    this.eyeOf = () => this.povEye;
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
    // The game's outside views (`placeOutside`): the seat's VehicleCamera
    // and the engine's chase state, rebuilt when the seat changes, and the
    // soldier's chase on foot. `outsideT` is the round's clock they last
    // stepped on; `outsideFresh` that the next frame enters them, easing out
    // from the view on screen.
    this.outside = null;
    this.footChase = { life: null, rel: [0, 0, 0], target: [0, 0, 0], eye: [0, 0, 0], aimAt: new THREE.Vector3(), aim: 0 };
    this.outsideT = null;
    this.outsideFresh = true;
    // What the outside view is filming this frame, for a probe and the UI:
    // `{ kind: 'seat' | 'foot', mode, ... }`, or null.
    this.outsideShot = null;
    // The fight cam's (replay-highlights.js `watchFront`): while it answers,
    // the orbit circles a front's fight instead of the followed man,
    // `{ key, point, base, minPitch }`.
    this.fightAt = null;
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
    // Into an outside view from another: it eases out from the view on
    // screen, as the engine's carries `rel` from its last output.
    if (EXTERNAL.has(mode)) this.outsideFresh = true;
    this.mode = mode;
    return true;
  }

  /**
   * F9-F12 (`c_PICameraMode1..4`): `n` 1 his eyes (a second press in an
   * aircraft, its nose cam), 2 the chase, 3 the front chase, 4 the fly-by.
   * A view the seat he holds does not allow (`seatOutsideModes`), or one the
   * page gives no man on foot (only the chase, features/soldier-third-
   * person-camera), is refused and nothing changes. What it went to, or
   * `{ refused }`.
   */
  cameraKey(n) {
    const want = CAMERA_KEY_MODES[n];
    if (!want) return null;
    if (want === 'pov') {
      if (this.mode === 'pov') {
        const view = this.toggleNose();
        return { mode: 'pov', view: view ?? this.povView, changed: Boolean(view) };
      }
      return { mode: 'pov', view: this.povView, changed: this.setMode('pov') };
    }
    const allowed = this.outsideModesAt(this.player.time);
    if (allowed && !allowed.includes(want)) return { refused: want, allowed, foot: Boolean(allowed.foot) };
    return { mode: want, changed: this.setMode(want) };
  }

  /** The outside views the followed man can have at `t`: his seat's
   *  (`seatOutsideModes`), the chase alone on foot, or null where nothing
   *  says (dead, waiting to spawn). */
  outsideModesAt(t) {
    const { player } = this;
    if (player.followPid === null || deathAt(player.rec, player.followPid, t, player.kills)) return null;
    const life = focusLife(player, t);
    if (!life || life.camera) return null;
    if (life.soldier) return Object.assign(['chase'], { foot: true });
    const seat = this.seatOf(life, t);
    return seat ? seatOutsideModes(seat.eye, player.rec) : null;
  }

  /** The seat the followed man holds in `life`'s hull at `t`: `{ hull,
   *  seat, seatId, eye }`, or null with no hull drawn. */
  seatOf(life, t) {
    const { player } = this;
    const hull = player.hulls?.get(life);
    if (!hull?.group.visible) return null;
    const nid = controlledAt(player.rec, player.followPid, t);
    const seat = rootOf(player.rec, nid, t, player.followPid)?.seat ?? 0;
    const seatId = hull.seatIdAt(seat) ?? hull.occupancy.rootId;
    const eye = hull.occupancy.cameraNodeOf(seatId);
    return eye ? { hull, seat, seatId, eye } : null;
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
    // The game's outside views take no mouse: the engine's chase looks at
    // the seat's Camera (CVM-2), the fly-by is a tripod.
    if (EXTERNAL.has(this.mode)) return;
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
    if (EXTERNAL.has(this.mode)) return;
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
    this.outsideFresh = true;
  }

  /** A seek: whatever was eased toward is now somewhere else. */
  snap() {
    this.valid = false;
    this.pov.ready = false;
    this.outsideFresh = true;
  }

  // --- the target ---------------------------------------------------------------

  /** What the orbit circles at `t`: `{ life, kind, point, base, minPitch,
   *  heading }`, or null when the followed player has nothing to look at.
   *  A death's is `{ kind: 'death', key, pitch }` as well: `key` what the
   *  glide tells it apart by, `pitch` and `heading` its shot. */
  targetAt(t) {
    const { player } = this;
    const fight = this.fightAt?.(t);
    if (fight) return { kind: 'fight', key: fight.key, point: fight.point, base: fight.base, minPitch: fight.minPitch, heading: this.yaw };
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
    this.outsideShot = null;
    this.povHull = null;
    this.povNoseHull = null;
    this.sanitize();
    let firstPersonHull = null;
    let inside = false;
    let noseHull = null;
    try {
      if (this.rig && this.placeRig(dt, t)) {
        this.useLens('page');
      } else if (this.mode === 'free') {
        this.updateFree(dt);
        this.useLens('page');
      } else if (this.mode === 'pov' && this.placePov(dt, t)) {
        firstPersonHull = this.povHull;
        inside = this.povInside;
        noseHull = this.povNoseHull;
      } else if (EXTERNAL.has(this.mode) && this.placeOutsideOrInside(dt, t)) {
        firstPersonHull = this.povHull;
        inside = this.povInside;
        noseHull = this.povNoseHull;
      } else {
        this.updateOrbit(dt, t);
        this.useLens('page');
      }
    } catch (error) {
      this.fault(`the ${this.mode} camera threw`, error);
      this.hidePid = null;
      this.sight = null;
      this.outsideShot = null;
    }
    // A frame the outside views did not film: the next one they film eases
    // out from whatever is on screen then.
    if (!this.outsideShot) {
      this.outsideT = null;
      this.outsideFresh = true;
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
    this.setFirstPersonHull(firstPersonHull, inside);
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
    // A nicety: a shake that throws shakes nothing.
    try {
      this.stepTriggerShake(t);
    } catch (error) {
      this.fault('the hit shake threw', error);
      this.triggerShake.drawn = false;
    }
    cam.updateMatrixWorld();
  }

  /**
   * He was hurt and lives (`replay-bodies.js` `hurt`, on foot): the victim's
   * own view shakes. `BFSoldier::handleDamage` (lnxded 0x08270980) calls
   * `triggerCameraShake(CstHitShake, 1.0, 0)` at 0x08270a69, which enters the
   * state `BFSoldierTemplate::init` looked up as `HitShake` (0x0827af47,
   * template `+0x1fc`) on the soldier's trigger machine (`+0x31c`), and
   * `updateCameraShake` (0x0827dea0) puts that machine's shake on his view at
   * factor 1.0. A trigger into the state the machine is already in does not
   * restart it (0x0827de20), and the shake's end puts the machine back in
   * state 0 (`getCameraShakeTransform` 0x0832b6c0, `reset(0)` for a state
   * with no transitions), so a blow during the shake adds nothing and one
   * after starts it again. Only the followed man's is kept: his is the one
   * the first person draws. The blocks are the tree's own (`gaits.json`
   * `triggerShakes`): vanilla's is a 4.0 degree roll at 50 rad/s and a 1.5
   * degree pitch at 200 rad/s, cut in and fading out at 5.0 a second.
   */
  hurt(pid) {
    const ts = this.triggerShake;
    if (pid === null || pid !== this.player.followPid) return false;
    if (ts.pid !== pid) this.resetTriggerShake(pid);
    const slots = this.triggerSlots('CstHitShake');
    if (!slots) return false;
    if (ts.shake.slot < 0) ts.shake.key = null;
    const started = ts.shake.enter('HitShake', slots);
    ts.log.push({ t: +this.player.time.toFixed(3), pid, started });
    if (ts.log.length > 64) ts.log.shift();
    return started;
  }

  /** A trigger's shake blocks from the tree's `gaits.json`, once fetched;
   *  null before then and on a tree without them. */
  triggerSlots(trigger) {
    const ts = this.triggerShake;
    if (ts.slots === undefined) {
      ts.slots = null;
      Promise.resolve(this.player.ctx.triggerShakes?.()).then(table => {
        ts.slots = table ?? null;
      }, () => {});
    }
    return ts.slots?.[trigger]?.cameraShake ?? null;
  }

  resetTriggerShake(pid) {
    const ts = this.triggerShake;
    ts.shake = new CameraShake();
    ts.pid = pid;
    ts.drawn = false;
  }

  /** One frame of the trigger machine's shake, on the replay's clock: a seek
   *  or a change of player ends it, a pause holds it. */
  stepTriggerShake(t) {
    const ts = this.triggerShake;
    const followed = this.player.followPid ?? null;
    const jump = ts.t !== null && Math.abs(t - ts.t) > 0.5;
    if (ts.pid !== followed || jump) this.resetTriggerShake(followed);
    const step = ts.t === null ? 0 : Math.max(0, t - ts.t);
    ts.t = t;
    ts.drawn = ts.shake.update(step, ts.out);
  }

  /** The followed man's trigger shake on the drawn view, around the render
   *  and his arms' near pass, as the page's own is (`fire-shake.js`
   *  `applyViewShake`, ledger CS-11); his rounds do not ride it. Only in
   *  his first person on foot. A function that puts the camera back, or
   *  null. */
  shakeView() {
    const ts = this.triggerShake;
    if (!ts.drawn || this.mode !== 'pov' || this.sight?.kind !== 'foot') return null;
    const s = ts.out;
    if (!(s.pitch || s.yaw || s.roll || s.x || s.y || s.z)) return null;
    return applyViewShake(this.player.ctx.camera, s);
  }

  /** The trigger shake now, for a probe: `{ key, slot, factor, t, out, log }`. */
  debugShake() {
    const ts = this.triggerShake;
    return { key: ts.shake.key, slot: ts.shake.slot, factor: +ts.shake.factor.toFixed(4),
             t: +ts.shake.t.toFixed(4), drawn: ts.drawn,
             out: Object.fromEntries(Object.entries(ts.out).map(([k, v]) => [k, +v.toFixed(4)])),
             log: ts.log.slice(-8) };
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

  // --- the game's outside views ----------------------------------------------------

  /**
   * The outside view the mode asks for (`placeOutside`); where the seat he
   * holds does not allow it, the seat's own inside view, which is the
   * engine's fallback (`Camera::setViewMode` keeps a seat in mode 3 when a
   * mode's `CVM*` byte is off, `VehicleCamera.setModes`). False when neither
   * can be placed (dead, waiting to spawn), and the orbit's death cam stands
   * in. One that throws is no view this frame, as first person's is.
   */
  placeOutsideOrInside(dt, t) {
    const cam = this.player.ctx.camera;
    let placed = false;
    try {
      placed = this.placeOutside(dt, t);
    } catch (error) {
      this.fault(`the ${this.mode} view threw`, error);
      this.outside = null;
      placed = false;
    }
    if (placed === 'inside') return this.placePov(dt, t);
    if (!placed) return false;
    if (!this.poseFinite(cam)) {
      this.fault(`the ${this.mode} view came out as no position`, { pid: this.player.followPid, t });
      this.hold(cam);
      this.outside = null;
      this.outsideShot = null;
      return false;
    }
    this.useLens('outside');
    // What the orbit would circle, for those that read where the camera's
    // subject is (replay-markers.js).
    this.target = this.targetAt(t);
    this.startGlide(cam.position, _v2.set(0, 0, -6).applyQuaternion(cam.quaternion).add(cam.position));
    this.frameDeath(null);
    return true;
  }

  /** The round's clock since the outside views last stepped, held to
   *  OUTSIDE_STEP_MAX; whether that was a jump (a seek, a first frame) that
   *  they settle across instead of easing. */
  outsideStep(t) {
    const last = this.outsideT;
    this.outsideT = t;
    if (last === null) return { step: 0, jump: false };
    if (t < last - 1e-6 || t - last > OUTSIDE_STEP_MAX) return { step: 0, jump: true };
    return { step: t - last, jump: false };
  }

  /**
   * The game's outside view of what the followed man holds at `t`: true
   * when it placed the camera, 'inside' when his seat does not allow this
   * one, false when there is nothing to film. On foot, his chase
   * (`placeFootChase`).
   *
   * A seat's view is `VehicleCamera`'s (vehicle-camera.js) over the hull
   * as drawn this frame, its Camera node the seat's own: the chase and the
   * front chase under the engine's law (`outsideLaw`, CVM-2), the fly-by
   * the page's tripod. It steps on the round's clock, so a paused replay
   * holds still and slow motion eases slowly, as the game's camera runs on
   * its game time; a seek settles it where it rests.
   */
  placeOutside(dt, t) {
    const { player } = this;
    const cam = player.ctx.camera;
    if (player.followPid === null || deathAt(player.rec, player.followPid, t, player.kills)) return false;
    const life = focusLife(player, t);
    if (!life || life.camera) return false;
    const { step, jump } = this.outsideStep(t);
    const settle = jump || this.outsideFresh;
    if (life.soldier) {
      if (life.diedAt !== undefined && t >= life.diedAt) return false;
      return this.placeFootChase(life, t, step, settle, jump);
    }
    const at = this.seatOf(life, t);
    if (!at) return false;
    const modes = seatOutsideModes(at.eye, player.rec);
    if (!modes.includes(this.mode)) return 'inside';
    let o = this.outside;
    if (!o || o.hull !== at.hull || o.seatId !== at.seatId) {
      o = this.outside = this.outsideRig(at);
    }
    o.life = life;
    // The subject the view hangs off: the hull as drawn, its velocity the
    // recording's (replay-kinematics.js `motionAt`, already the view's frame).
    const state = o.subject.state;
    at.hull.root.updateWorldMatrix(true, false);
    at.hull.root.getWorldPosition(state.position);
    at.hull.root.getWorldQuaternion(state.orientation);
    const v = motionAt(life, t)?.velocity;
    if (v && v.every(Number.isFinite)) state.velocity.set(v[0], v[1], v[2]);
    else state.velocity.set(0, 0, 0);
    const view = o.view;
    view.setModes(['cockpit', ...modes], false);
    if (view.mode !== this.mode) {
      view.setMode(this.mode);
      o.entered = true;
    }
    if (settle || o.entered) {
      // Into the view: from the view on screen when it is near (the engine's
      // `rel` is its last output's), else at rest; after a seek, at rest.
      at.eye.updateWorldMatrix(true, false);
      at.eye.getWorldPosition(o.anchor);
      const from = !jump && this.valid && cam.position.distanceTo(o.anchor) < CUT;
      this.settleChase(o, from ? cam.position : null);
      view.followValid = false;
      if (jump) view.anchored = false;
      o.entered = false;
    }
    this.outsideFresh = false;
    const pose = view.update(step);
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    this.outsideShot = {
      kind: 'seat', mode: this.mode, hull: at.hull, seat: at.seat, seatId: at.seatId, modes,
      radius: o.radius, law: this.mode === 'flyby' ? 'viewer' : 'engine',
      anchor: o.anchor.toArray(), rel: [...o.rel],
    };
    return true;
  }

  /** A seat's outside view: its `VehicleCamera` over a stand-in subject
   *  (the replayed hull has no drivetrain state of its own to hand it) and
   *  the engine's chase state (`outsideLaw`). */
  outsideRig(at) {
    const ctx = this.player.ctx;
    // The ground or the sea, whichever is higher: the engine's floor and the
    // tripod's (`groundHeight` on the page is the same max).
    const floor = (x, z) => {
      const g = ctx.groundHeight?.(x, z);
      const w = ctx.waterLevel?.();
      return Math.max(Number.isFinite(g) ? g : -Infinity, Number.isFinite(w) ? w : -Infinity);
    };
    const subject = {
      state: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), velocity: new THREE.Vector3(), throttle: 0 },
      // The replay draws the hull's inside itself (`setFirstPersonHull`):
      // an outside view never shows it.
      setFirstPerson: () => false,
      cameraPose(out) {
        at.eye.updateWorldMatrix(true, false);
        at.eye.getWorldPosition(out.position);
        at.eye.getWorldQuaternion(out.quaternion);
        return out;
      },
    };
    const o = {
      hull: at.hull, seatId: at.seatId, eye: at.eye, subject, life: null, entered: true,
      radius: hullChaseRadius(at.hull), floor,
      rel: [0, 0, 0], target: [0, 0, 0], out: [0, 0, 0], anchor: new THREE.Vector3(),
      basis: new THREE.Matrix4(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), quat: new THREE.Quaternion(),
    };
    o.view = new VehicleCamera(subject, { groundHeight: floor, eyeNode: at.eye, modes: ['cockpit', ...EXTERNAL_MODES] });
    o.view.externalLaw = (mode, step, pose) => this.outsideLaw(o, mode, step, pose);
    return o;
  }

  /** `rel` carried from `from`, a world position the camera was at, or at
   *  rest for the view's mode: the ease's fixed point, `want + sign 0.6 v`
   *  (`chaseStep`). */
  settleChase(o, from) {
    if (from) {
      o.rel[0] = from.x - o.anchor.x;
      o.rel[1] = from.y - o.anchor.y;
      o.rel[2] = from.z - o.anchor.z;
      return;
    }
    if (this.mode !== 'chase' && this.mode !== 'front') {
      o.rel.fill(0);
      return;
    }
    const sign = this.mode === 'front' ? CHASE_AHEAD : CHASE_BEHIND;
    this.chaseWant(o, sign);
    const v = o.subject.state.velocity;
    o.rel[0] = o.target[0] + sign * CHASE_SPEED_LAG * v.x;
    o.rel[1] = o.target[1] + sign * CHASE_SPEED_LAG * v.y;
    o.rel[2] = o.target[2] + sign * CHASE_SPEED_LAG * v.z;
  }

  /** CVM-2's wanted offset into `o.target`: `(sign fwd + 0.3 up) 1.2 R` off
   *  the hull's (the root's) axes. */
  chaseWant(o, sign) {
    o.hull.root.getWorldQuaternion(o.quat);
    o.fwd.set(0, 0, -1).applyQuaternion(o.quat);
    o.up.set(0, 1, 0).applyQuaternion(o.quat);
    chaseTarget(o.fwd.toArray(), o.up.toArray(), o.radius, sign, o.target);
  }

  /**
   * `VehicleCamera.externalLaw` for a replayed seat: the engine's
   * `Camera::getTransformation` for modes 12 and 13 (ledger CVM-2, the same
   * arithmetic `seat-camera.js` runs for the page's own seats): the eye at
   * the seat Camera plus `rel`, eased by `1 - exp(-2 dt)` toward the hull's
   * `(-/+fwd + 0.3 up) 1.2 R` less or plus 0.6 s of its velocity, a metre
   * over the ground or the sea, looking at the Camera with world up. Every
   * seat takes it, as `?chase=engine` does on the page: the older framing
   * the page keeps for a seat with no turret is the page's, and the binary
   * has one law. `rel` is carried in every mode, so the fly-by hands back to
   * the chase from its tripod.
   */
  outsideLaw(o, mode, step, pose) {
    o.eye.updateWorldMatrix(true, false);
    o.eye.getWorldPosition(o.anchor);
    if (mode !== 'chase' && mode !== 'front') {
      const view = o.view;
      if (mode === 'flyby' && view.anchored) {
        o.rel[0] = view.anchor.x - o.anchor.x;
        o.rel[1] = view.anchor.y - o.anchor.y;
        o.rel[2] = view.anchor.z - o.anchor.z;
      } else o.rel.fill(0);
      return false;
    }
    const sign = mode === 'front' ? CHASE_AHEAD : CHASE_BEHIND;
    this.chaseWant(o, sign);
    const v = o.subject.state.velocity;
    chaseStep(o.rel, o.target, [v.x, v.y, v.z], sign, step);
    const a = o.anchor.toArray();
    chaseEye(a, o.rel, o.floor(a[0] + o.rel[0], a[2] + o.rel[2]), o.out);
    pose.position.fromArray(o.out);
    o.basis.lookAt(pose.position, o.anchor, WORLD_UP);
    pose.quaternion.setFromRotationMatrix(o.basis);
    return true;
  }

  /**
   * The soldier's chase on foot (features/soldier-third-person-camera,
   * `soldier-view.js` `footChase`): CVM-2's offset in his heading's frame
   * with world up at `FOOT_CHASE_RADIUS`, over his right shoulder
   * (`FOOT_CHASE_SHOULDER`), eased as the engine eases it, a metre over the
   * ground, pulled in front of a wall, and looking at the point his
   * recorded aim first meets, so the frame's centre is where he aimed.
   * Anchored on his eye where first person places it.
   */
  placeFootChase(life, t, step, settle, jump) {
    const { player } = this;
    const ctx = player.ctx;
    const cam = ctx.camera;
    const fc = this.footChase;
    const s = sampleAt(life, settledTime(life, t));
    if (!s) return false;
    const view = this.viewOf(life, t);
    const eye = toViewPosition(s.a.p, _v);
    if (s.b) eye.lerp(toViewPosition(s.b.p, _v2), s.k);
    eye.y += CHARACTER_HEIGHT;
    eye.add(_v2.set(0, eyeLiftAt(player.rec, life.nid, t), 0).applyQuaternion(view.body));
    const anchor = [eye.x, eye.y, eye.z];
    // His aim, the view's -Z, and his heading, its level part.
    viewQuaternion(view, _aimQ);
    _fwd.set(0, 0, -1).applyQuaternion(_aimQ);
    const aim = [_fwd.x, _fwd.y, _fwd.z];
    let hx = _fwd.x;
    let hz = _fwd.z;
    if (Math.hypot(hx, hz) < 1e-4) {
      _v2.set(0, 0, -1).applyQuaternion(view.body);
      hx = _v2.x;
      hz = _v2.z;
    }
    const n = Math.hypot(hx, hz) || 1;
    hx /= n;
    hz /= n;
    chaseTarget([hx, 0, hz], [0, 1, 0], FOOT_CHASE_RADIUS, CHASE_BEHIND, fc.target);
    // Right is forward x up.
    fc.target[0] += -hz * FOOT_CHASE_SHOULDER;
    fc.target[2] += hx * FOOT_CHASE_SHOULDER;
    const vel = this.lifeVelocity(life, t);
    if (settle || fc.life !== life) {
      // Into the view from the one on screen when it is near (the engine's
      // `rel` is its last output's); after a seek, at rest.
      const from = !jump && this.valid && cam.position.distanceTo(eye) < CUT;
      for (let i = 0; i < 3; i++) {
        fc.rel[i] = from ? cam.position.getComponent(i) - anchor[i] : fc.target[i] - CHASE_SPEED_LAG * vel[i];
      }
      fc.life = life;
    }
    this.outsideFresh = false;
    chaseStep(fc.rel, fc.target, vel, CHASE_BEHIND, step);
    const ground = (x, z) => {
      const g = ctx.groundHeight?.(x, z);
      return Number.isFinite(g) ? g : NaN;
    };
    const water = ctx.waterLevel?.();
    let floor = ground(anchor[0] + fc.rel[0], anchor[2] + fc.rel[2]);
    if (Number.isFinite(water)) floor = Number.isFinite(floor) ? Math.max(floor, water) : water;
    chaseEye(anchor, fc.rel, Number.isFinite(floor) ? floor : -Infinity, fc.eye);
    const collider = ctx.guns?.collider;
    const cast = typeof collider?.cast === 'function'
      ? (ox, oy, oz, dx, dy, dz, reach) => collider.cast(ox, oy, oz, dx, dy, dz, reach, -1) ?? null
      : null;
    // In front of a wall, not inside it; not folded into `rel`, so the view
    // springs back out at the ease's own pace once he steps clear.
    if (cast) {
      const ox = fc.eye[0] - anchor[0];
      const oy = fc.eye[1] - anchor[1];
      const oz = fc.eye[2] - anchor[2];
      const reach = Math.hypot(ox, oy, oz);
      const hit = reach > 1e-3 ? cast(anchor[0], anchor[1], anchor[2], ox / reach, oy / reach, oz / reach, reach) : null;
      if (hit && Number.isFinite(hit.t) && hit.t < reach) {
        const k = Math.max(FOOT_WALL_MIN, hit.t - FOOT_WALL_MARGIN) / reach;
        fc.eye[0] = anchor[0] + ox * k;
        fc.eye[1] = anchor[1] + oy * k;
        fc.eye[2] = anchor[2] + oz * k;
      }
    }
    cam.position.fromArray(fc.eye);
    const d = aimDistance(anchor, aim, { ground, cast });
    fc.aim = d;
    fc.aimAt.set(anchor[0] + aim[0] * d, anchor[1] + aim[1] * d, anchor[2] + aim[2] * d);
    cam.up.set(0, 1, 0);
    cam.lookAt(fc.aimAt);
    this.outsideShot = { kind: 'foot', mode: this.mode, life, anchor, rel: [...fc.rel], aim: d };
    return true;
  }

  /** A life's recorded velocity at `t`, the view's frame, m/s: its place
   *  (a soldier's settled place) differenced over FOOT_VELOCITY_HALF either
   *  side; none across a teleport. */
  lifeVelocity(life, t) {
    const t0 = Math.max(life.created, t - FOOT_VELOCITY_HALF);
    const t1 = Math.min(Number.isFinite(life.destroyed) ? life.destroyed - 1e-3 : Infinity, t + FOOT_VELOCITY_HALF);
    const span = t1 - t0;
    if (!(span > 1e-3)) return [0, 0, 0];
    const a = positionAt(life, life.soldier ? settledTime(life, t0) : t0, [0, 0, 0]);
    const b = positionAt(life, life.soldier ? settledTime(life, t1) : t1, [0, 0, 0]);
    if (!a || !b) return [0, 0, 0];
    const v = [(b[0] - a[0]) / span, (b[1] - a[1]) / span, -(b[2] - a[2]) / span];
    return Math.hypot(...v) > 400 || !v.every(Number.isFinite) ? [0, 0, 0] : v;
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
      // The driver's seat looks out through the hull's own interior, in
      // either view: what each swap draws is the page's rule (vehicle-camera.js
      // `firstPerson` and `modeEye`). The cockpit view is the interior, and so
      // is a tank's or a gun's nose view (its sight); an aircraft's nose cam
      // draws none. A distance-selected interior answers where this eye
      // stands (LOD-3, `CockpitSwap.apply`): FHSW's M36B1 hangs its sight on
      // a 0.1 m DistanceSelector 1.4 m ahead of M36Camera, where its
      // `OutsideHudOffset` puts the nose view's eye, and with no eye to ask
      // the replay drew it in the cockpit view and hid it in the nose view.
      const air = hull.kind === 'air' || hull.root?.userData?.physics?.vehicleCategory === 'VCAir';
      this.povHull = seat === 0 ? hull : null;
      this.povInside = !nose || !air;
      this.povEye.copy(cam.position);
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
    const lens = kind === 'foot' ? FOOT_LENS : kind === 'seat' ? SEAT_LENS
      : kind === 'outside' ? OUTSIDE_LENS : this.pageLens;
    cam.fov = lens.fov;
    cam.near = lens.near;
    cam.updateProjectionMatrix();
  }

  /** A pilot's or driver's first person shows the hull's own inside, the
   *  `<Template>.cockpit.glb` the flown vehicle grafts (vehicle-base.js
   *  `loadCockpit`, fetched the first time anyone looks through that hull's
   *  eyes); every other hull stays as seen from outside. `inside` is whether
   *  this view draws the seat's interior (`povInside`), and the drive asks
   *  the view's eye (`povEye`) where an interior is distance-selected, every
   *  frame, as the page's seat view does: a hull let go of keeps no eye, so
   *  no sight of it is drawn from the orbit or the free camera. */
  setFirstPersonHull(hull, inside = true) {
    if (hull !== this.firstPersonHull) {
      const last = this.firstPersonHull?.drive;
      if (last) {
        // The eye first: with it a distance-selected sight answers the
        // eye's reach and not the view, so it would stay up.
        if (last.viewEye === this.eyeOf) last.viewEye = null;
        last.setFirstPerson?.(false);
      }
      this.firstPersonHull = hull;
      const drive = hull?.drive;
      if (drive?.setFirstPerson) {
        drive.viewEye = this.eyeOf;
        if (!cockpits.has(hull) && typeof drive.loadCockpit === 'function') {
          // The interior arrives as the model browser's export, standard
          // materials and all. The page shades it by the level's light at the
          // brightness retail measures (level-shading.js `shadeCockpit`, ledger
          // DL-5), the same call its own flown vehicles make; left as exported, the model
          // browser's hemisphere and sun tint a grey interior olive: the
          // Flettner's `Flettner_interior` measures rgb(50,54,56) and came out
          // olive green in a replay.
          const ctx = this.player.ctx;
          const prepare = root => {
            ctx.shadeCockpit?.(root);
            return ctx.warmSubtree?.(root);
          };
          cockpits.set(hull, drive.loadCockpit(undefined, prepare).catch(() => null).then(() => {
            // The graft keeps whatever the drive last showed; show the inside if
            // this hull is still the one being looked out of.
            drive.setFirstPerson(this.firstPersonHull === hull && this.firstPersonInside);
          }));
        }
      }
    }
    this.firstPersonInside = Boolean(hull) && inside;
    hull?.drive?.setFirstPerson?.(this.firstPersonInside);
  }

  dispose() {
    this.setFirstPersonHull(null);
    this.noseHull.hide(null);
    this.useLens('page');
  }
}
