// The replay's camera: which object the followed player controls at a time
// (`focusLife`), and the three ways of watching him (features/round-replay-ux):
//
//   orbit  locked on him, or the hull he rides, or his body once he dies;
//          dragged, wheeled and keyed around him, never away from him.
//   pov    through his eyes: on foot his recorded eye, heading and aim pitch,
//          in a seat the seat's own Camera node (the cockpit view's eye).
//   free   a fly camera, moved with the keys, looked with the mouse.
//
// The input is replay-ui.js's; this turns it into the camera's pose, last in
// the frame (map.html runs the replay after its own camera controls).

import * as THREE from 'three';
import { bodyAt, controlledAt, rootOf, sampleAt } from './replay-recording.js';
import { toViewPosition, toViewQuaternion } from './replay-actors.js';
import { EYE_HEIGHT, POSE_CROUCH, POSE_PRONE, POSE_STAND } from './soldier-pose.js';

export const CAMERA_MODES = Object.freeze(['orbit', 'pov', 'free']);

// Orbit distance at zoom 1 and the point orbited, over a soldier's feet; a
// hull's scale with its size. The spectator camera (a player on the spawn
// screen) is only a viewpoint, looked down on from well above.
const SOLDIER = { base: 6, lift: 1.2 };
const BODY = { base: 6, lift: 0.4 };
const SPECTATOR = { base: 60, lift: 0, minPitch: 0.6 };
const HULL_BASE = 2.4;           // x the hull's bounding radius
const HULL_LIFT = 0.15;          // x the radius, above its root

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
const POV_SMOOTH = 0.06;         // s: the recorded 10 Hz heading, eased
const LOOK_RETURN = 0.3;         // s: a first-person look-around springs back

const KEY_TURN = 1.8;            // rad/s, A/D
const KEY_TILT = 1.1;            // rad/s, Q/E
const KEY_ZOOM = 1.6;            // e-folds/s, W/S
const DRAG = 0.005;              // rad/px, orbit
const LOOK = 0.0024;             // rad/px, free and first person
const FREE_SPEED = 30;           // m/s
const FREE_FAST = 4;             // x with Shift

// The game's lenses (local-player.js `LENS`): the soldier's 57.3 degrees and
// 0.2 m near plane, a seat's 60 and 0.1 (a tank's interior is 0.09 m ahead of
// its eye). The orbit and the free camera keep the page's own.
const FOOT_LENS = { fov: 57.3, near: 0.2 };
const SEAT_LENS = { fov: 60, near: 0.1 };

/** The soldier pose glb's half turn, as replay-bodies.js reads a heading. */
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);
/** The recorded aim pitch is 0.4 of the aim (capture README section 16). */
const AIM_PITCH_SCALE = 2.5 * Math.PI / 180;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

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

export class ReplayCamera {
  constructor(player) {
    this.player = player;
    const cam = player.ctx.camera;
    this.mode = 'orbit';
    // Orbit: the wanted angles and zoom, and the eased ones drawn.
    this.yaw = -Math.PI / 4;
    this.pitch = 0.35;
    this.zoom = 1;
    this.eased = { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
    this.aimed = false;          // the orbit has been put behind a first target
    // The glide: what is left of the last view, easing out.
    this.carryPos = new THREE.Vector3();
    this.carryLook = new THREE.Vector3();
    this.lastPos = new THREE.Vector3();
    this.lastLook = new THREE.Vector3();
    this.lastLife = null;
    this.valid = false;
    // Free.
    this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
    // First person: the eased heading and the look-around offset.
    this.pov = { yaw: 0, pitch: 0, ready: false, lookYaw: 0, lookPitch: 0, life: null };
    this.looking = false;        // a drag is turning the first-person view
    this.keys = new Set();       // held movement keys (KeyW ..., ShiftLeft)
    this.hidePid = null;         // whose body the first-person view is inside
    this.firstPersonHull = null;
    this.pageLens = { fov: cam.fov, near: cam.near };
    this.lens = 'page';
    this.target = null;          // the last orbit target, for the UI's read
  }

  // --- input -----------------------------------------------------------------

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode) || mode === this.mode) return false;
    const cam = this.player.ctx.camera;
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
    if (this.mode === 'orbit') {
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

  /** A pinch: `ratio` > 1 is fingers apart (in). */
  pinch(ratio) {
    if (this.mode === 'orbit' && ratio > 0) this.zoom = clamp(this.zoom / ratio, ZOOM_MIN, ZOOM_MAX);
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
   *  heading }`, or null when the followed player has nothing to look at. */
  targetAt(t) {
    const { player } = this;
    if (player.followPid === null) return null;
    const life = focusLife(player, t, true);
    if (!life) return null;
    const s = sampleAt(life, t);
    if (!s) return null;
    const point = toViewPosition(s.a.p, new THREE.Vector3());
    if (s.b) point.lerp(toViewPosition(s.b.p, _v), s.k);
    toViewQuaternion(s.a.q, _q);
    if (s.b) _q.slerp(toViewQuaternion(s.b.q, _q2), s.k);
    if (life.soldier) {
      const dead = life.diedAt !== undefined && t >= life.diedAt;
      const rig = dead ? BODY : SOLDIER;
      _q.multiply(SOLDIER_YAW_FLIP);
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

  // --- per frame -----------------------------------------------------------------

  update(dt, t) {
    this.hidePid = null;
    let firstPersonHull = null;
    if (this.mode === 'free') {
      this.updateFree(dt);
      this.useLens('page');
    } else if (this.mode === 'pov' && this.updatePov(dt, t)) {
      firstPersonHull = this.povHull;
    } else {
      this.updateOrbit(dt, t);
      this.useLens('page');
    }
    this.setFirstPersonHull(firstPersonHull);
    this.player.ctx.camera.updateMatrixWorld();
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

    // A new target (another player, his seat, his body) or a new mode: carry
    // the last view and let it ease out, unless the new one is far.
    if (target.life !== this.lastLife) {
      if (this.valid && this.lastLook.distanceTo(target.point) < CUT) {
        this.carryPos.copy(this.lastPos).sub(desired);
        this.carryLook.copy(this.lastLook).sub(target.point);
      } else {
        this.carryPos.set(0, 0, 0);
        this.carryLook.set(0, 0, 0);
      }
      this.lastLife = target.life;
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
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const lift = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
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
   *  yet spawned, a bot's camera), and the orbit's death cam stands in. */
  updatePov(dt, t) {
    const { player } = this;
    const cam = player.ctx.camera;
    const life = focusLife(player, t);
    this.povHull = null;
    if (!life) return false;
    let lens = null;
    if (life.soldier) {
      if (life.diedAt !== undefined && t >= life.diedAt) return false;
      const s = sampleAt(life, t);
      if (!s) return false;
      toViewPosition(s.a.p, cam.position);
      if (s.b) cam.position.lerp(toViewPosition(s.b.p, _v), s.k);
      toViewQuaternion(s.a.q, _q);
      if (s.b) _q.slerp(toViewQuaternion(s.b.q, _q2), s.k);
      _q.multiply(SOLDIER_YAW_FLIP);
      _e.setFromQuaternion(_q, 'YXZ');
      const body = bodyAt(player.rec, life.nid, t);
      const pose = body?.stance === 'prone' ? POSE_PRONE : body?.stance === 'crouch' ? POSE_CROUCH : POSE_STAND;
      cam.position.y += EYE_HEIGHT[pose];
      this.easeHeading(dt, _e.y, (body?.pitch ?? 0) * AIM_PITCH_SCALE, life);
      _e.set(this.pov.pitch, this.pov.yaw, 0, 'YXZ');
      cam.quaternion.setFromEuler(_e);
      this.hidePid = player.followPid;
      lens = 'foot';
    } else if (life.camera) {
      // His own spectator camera (the recording player on the spawn screen):
      // what he was looking at.
      const s = sampleAt(life, t);
      if (!s || !life.keys.length) return false;
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
      this.hidePid = player.followPid;
      this.povHull = seat === 0 ? hull : null;
      this.pov.ready = false;
      lens = 'seat';
    }
    this.applyLook(dt, cam);
    this.useLens(lens);
    this.startGlide(cam.position, _v2.set(0, 0, -6).applyQuaternion(cam.quaternion).add(cam.position));
    return true;
  }

  /** The recorded heading and aim, eased over the 10 Hz samples. */
  easeHeading(dt, yaw, pitch, life) {
    const pov = this.pov;
    if (!pov.ready || pov.life !== life) {
      pov.yaw = yaw;
      pov.pitch = pitch;
      pov.ready = true;
      pov.life = life;
      return;
    }
    const ease = 1 - Math.exp(-dt / POV_SMOOTH);
    pov.yaw += wrap(yaw - pov.yaw) * ease;
    pov.pitch += (pitch - pov.pitch) * ease;
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
    this.useLens('page');
  }
}
