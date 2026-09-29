// The round cam (features/replay-creator-view): the camera riding behind a
// round in flight, from the muzzle to whatever it hits, the way Sniper
// Elite's kill cam does -- in slow motion, set by the round's own speed, so a
// rifle bullet and a bazooka rocket cross the screen at about the same pace.
//
// What is chased is the page's own round: a recorded shot goes through the
// page's guns (replay.js `fireShot`), which fly it, test it against the
// level, the hulls and the bodies, and end it where it strikes. The round is
// found as it appears, by its muzzle and its direction against the recorded
// shot's (`claim`), so it flies, hits and stops where the drawn round does.
// A round the server flies (a grenade, recorded as an object of its own,
// replay-props.js) is chased along the recording instead.
//
// Armed with a recorded shot before it is fired (the dossier's bullet cam,
// the Next round key), the camera waits over the shooter's shoulder looking
// down the line he is about to fire along, and the clock slows as the trigger
// comes: the replay knows the future.
//
// A rig of replay-camera.js (`setRig`): it places the camera while it has
// something to chase, and hands back when it is done. It owns the replay's
// speed while it runs and gives it back as it found it.

import * as THREE from 'three';
import { isReplicated, positionAt } from './replay-recording.js';
import { whereIs } from './replay-battles.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';

/**
 * Bullet time. A round whose target is known (the man it killed) takes
 * `flight` seconds of real time to reach him, however far and fast: a sniper's
 * round over 340 m at the game's 2,000 m/s and a sub-machine gun's over 20 m
 * both land in about that long. One with no known end crosses the screen at
 * `pace` metres a second instead. Off, the clock is left alone.
 */
export const BULLET_TIME = Object.freeze({
  off: null,
  subtle: Object.freeze({ pace: 90, flight: 1 }),
  strong: Object.freeze({ pace: 40, flight: 2.5 }),
  extreme: Object.freeze({ pace: 16, flight: 5 }),
});
const SLOW_MIN = 0.004;
/** Real seconds a chase with no known end runs at most before it lets go. */
const CHASE_MAX_REAL = 7;
/** Seconds of recording before an armed shot over which the clock slows, and
 *  the over-the-shoulder shot starts this long before it. */
const RAMP_LEAD = 0.45;
const SETUP_LEAD = 2.5;
/** Real seconds: the clock's easing toward its target, and the camera's
 *  glide from one shot into the next. */
const CLOCK_EASE = 0.12;
const GLIDE = 0.22;
/** A new round is the armed shot's when it leaves within MATCH_DIST metres of
 *  the recorded muzzle (a first person's leaves his eye) along a direction
 *  within about 5.7 degrees of the recorded one. */
const MATCH_DOT = 0.995;
const MATCH_DIST = 4;
/** Seconds of recording after an armed shot with no round of its own: it was
 *  never drawn (its shooter out of the recording's range), and the camera
 *  stops waiting. */
const GIVE_UP = 0.6;
/** The hold on the impact: real seconds at least, the clock's pace through it,
 *  and how long past a known kill it lasts, seconds of recording, so the man
 *  is seen to fall. */
const HOLD_REAL = 1.4;
const HOLD_SPEED = 0.35;
const HOLD_PAST_KILL = 0.9;
const HOLD_MAX_REAL = 4;
/** The hold draws back this far behind the hit and this far up, over this
 *  many real seconds. */
const PULL_DIST = 4.5;
const PULL_UP = 1.3;
const PULL_BACK = 0.9;
/** Estimated speeds, metres a second, before a round exists to measure. */
const SPEED_GUESS = [
  [/bazooka|panzers?c?hreck|piat|rocket/i, 50],
  [/grenade/i, 18],
  [/bomb/i, 60],
  [/barrel|cannon|howitzer|mortar|artillery/i, 320],
];
const BULLET_GUESS = 650;

/** How the camera sits behind each kind of round: back along its path, up
 *  and to the side, metres, and how far ahead of it the camera looks. */
/** Metres the camera keeps above ground and water: less than the orbit's. */
const CLEARANCE = 0.15;
/** The shot before the trigger: over his right shoulder, looking down the
 *  line he fires along. */
const SHOULDER = { back: 2.4, up: 0.45, side: 0.6, ahead: 40 };
const RIGS = {
  tracer: { back: 0.55, up: 0.085, side: 0.07, ahead: 8, near: 0.1 },
  rocket: { back: 2.6, up: 0.55, side: 0.35, ahead: 14 },
  shell: { back: 2.2, up: 0.45, side: 0.3, ahead: 14 },
  bomb: { back: 5, up: 1.4, side: 0.8, ahead: 18 },
  thrown: { back: 1.8, up: 0.5, side: 0.3, ahead: 6 },
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _vb = new THREE.Vector3();
const _vo = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _vl = new THREE.Vector3();
const _vn = new THREE.Vector3();
const _qs = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, -1);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** A recorded shot's muzzle and direction in the view's frame (BF1942's with
 *  z negated), into `pos` and `dir` (unit); false for a shot with no
 *  direction. */
export function shotRay(f, pos, dir) {
  if (!Array.isArray(f?.pos) || !Array.isArray(f?.dir)) return false;
  pos.set(f.pos[0], f.pos[1], -f.pos[2]);
  dir.set(f.dir[0], f.dir[1], -f.dir[2]);
  const n = dir.length();
  if (!(n > 1e-6) || !Number.isFinite(n)) return false;
  dir.divideScalar(n);
  return Number.isFinite(pos.x + pos.y + pos.z);
}

/** A round's speed guessed from its weapon's name, metres a second. */
export function guessSpeed(weapon) {
  const name = String(weapon ?? '');
  for (const [re, speed] of SPEED_GUESS) if (re.test(name)) return speed;
  return BULLET_GUESS;
}

/** The replay's clock for a round at `speed` m/s under bullet time `preset`
 *  (BULLET_TIME): its `flight` over `distance` metres when the distance is
 *  known, else its `pace`; 1 when bullet time is off. */
export function slowFor(speed, preset, distance = null) {
  if (!preset || !(speed > 0)) return 1;
  const k = distance > 0 && preset.flight > 0 ? distance / speed / preset.flight : preset.pace / speed;
  return clamp(k, SLOW_MIN, 1);
}

/** Index of the first of `fires` (time order) at or after `t`. */
export function firstFireAt(fires, t) {
  let lo = 0;
  let hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `pid`'s next round from `t` on (a round the page flies or the recording
 *  carries, not a v3 press), or null. */
export function nextShotOf(rec, pid, t) {
  const fires = rec.fires ?? [];
  for (let i = firstFireAt(fires, t); i < fires.length; i++) {
    const f = fires[i];
    if (f.pid === pid && !f.press && !f.feedOnly && Array.isArray(f.dir)) return f;
  }
  return null;
}

/**
 * The recorded round object a shot threw, when the server flies it (a
 * grenade: replay-props.js): the round life whose first pose away from the
 * origin comes within 1.5 s of the shot and 6 m of its muzzle. null when the
 * recording has none (out of range, or a round the page flies).
 */
export function thrownLifeOf(rec, f) {
  if (!Array.isArray(f?.pos)) return null;
  let best = null;
  for (const life of rec.lives ?? []) {
    if (!life.projectile || life.created > f.t + 1.5 || life.destroyed < f.t) continue;
    const key = life.keys?.find(k => k.t >= f.t - 0.2 && Math.hypot(k.p[0], k.p[1], k.p[2]) > 1);
    if (!key || key.t > f.t + 1.5) continue;
    const d = Math.hypot(key.p[0] - f.pos[0], key.p[1] - f.pos[1], key.p[2] - f.pos[2]);
    if (d < 6 && (!best || d < best.d)) best = { life, d, from: key.t };
  }
  return best;
}

/** What kind of round a live object of the page's guns is, for the rig. */
function kindOfLive(obj, inTracers) {
  if (inTracers) return 'tracer';
  if (obj.body || obj.fuse) return 'thrown';
  // The bazooka's round flies as a shell (a 50 m/s one): its template says
  // it is a rocket.
  const tmpl = obj.group?.stats?.projectile?.template ?? obj.group?.name ?? '';
  if (obj.kind === 'rocket' || /bazooka|panzers?c?hreck|piat|rocket/i.test(tmpl)) return 'rocket';
  if (/bomb/i.test(tmpl)) return 'bomb';
  return 'shell';
}

/**
 * The round cam. `hooks` are the creator's: `follow(pid)` hands the view to
 * a man after the hit, `free(pos, quat)` leaves a free camera where the chase
 * ended, and `changed()` says the state moved (the plate over the view).
 */
export class RoundCam {
  constructor(player, hooks = {}) {
    this.player = player;
    this.hooks = hooks;
    this.state = 'idle';           // idle | armed | flying | impact
    this.bulletTime = BULLET_TIME.strong;
    this.afterHit = 'victim';      // victim | shooter | stay
    this.target = null;            // { f, pid, kill, victim, weapon, obj, list, kind, life, label }
    this.born = new WeakMap();     // a live round -> the recording time it was first seen at
    this.lastT = null;
    this.savedSpeed = null;
    this.orbit = { yaw: 0, pitch: 0, dist: 1 };
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.speed = 0;
    this.shotPos = new THREE.Vector3();
    this.shotDir = new THREE.Vector3(0, 0, -1);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), w: 0 };
    this.impact = null;            // { at, cam, real, t }
    this.hero = null;
  }

  get active() {
    return this.state !== 'idle';
  }

  get guns() {
    return this.player.ctx.guns ?? null;
  }

  // --- starting and stopping -------------------------------------------------------

  /** Chase the round of recorded shot `f`, fired or yet to be. `kill` is the
   *  kill it made, when it made one: the hold waits for the man to fall. */
  arm(f, { kill = null } = {}) {
    if (!shotRay(f, this.shotPos, this.shotDir)) return false;
    this.begin({
      f, pid: f.pid, kill, victim: kill?.victim ?? null, weapon: f.weapon, obj: null, list: null,
      kind: null, life: null, thrown: null, victimAt: null, victimDist: null,
    }, 'armed');
    this.aimVictim();
    this.primeSeen();
    return true;
  }

  /** Chase a round already in flight: `obj` of the page's `guns.tracers` or
   *  `guns.projectiles` (a click on it), fired by recorded shot `f` when that
   *  is known, which killed `kill` when it did. */
  chaseObject(obj, f = null, { kill = null } = {}) {
    const guns = this.guns;
    if (!guns || !obj) return false;
    const list = guns.tracers.includes(obj) ? guns.tracers : guns.projectiles.includes(obj) ? guns.projectiles : null;
    if (!list) return false;
    const known = Boolean(f) && shotRay(f, this.shotPos, this.shotDir);
    if (!known && obj.origin) this.shotPos.fromArray(obj.origin);
    this.begin({
      f, pid: f?.pid ?? null, kill: known ? kill : null, victim: known ? kill?.victim ?? null : null, weapon: f?.weapon ?? null,
      obj, list, kind: kindOfLive(obj, list === guns.tracers), life: null, thrown: null, victimAt: null, victimDist: null,
    }, 'flying');
    if (known) this.aimVictim();
    this.readLive();
    return true;
  }

  begin(target, state) {
    this.releaseTarget();
    const cam = this.player.ctx.camera;
    this.from.pos.copy(cam.position);
    this.from.look.set(0, 0, -20).applyQuaternion(cam.quaternion).add(cam.position);
    this.from.w = 1;
    if (this.savedSpeed === null) this.savedSpeed = this.player.speed;
    this.target = target;
    this.state = state;
    this.impact = null;
    this.orbit = { yaw: 0, pitch: 0, dist: 1 };
    this.lastT = this.player.time;
    this.player.camera.setRig(this);
    this.hooks.changed?.();
  }

  /**
   * Where the man the shot killed was when it killed him, a little over his
   * origin, and how far that is from the muzzle: the chase ends there. The
   * page flies its own round, which need not strike his drawn body (a sniper's
   * over 340 m flew on past him); the recording says it killed him.
   */
  aimVictim() {
    const target = this.target;
    const kill = target.kill;
    if (!kill || kill.victim === null || kill.victim === undefined) return;
    const w = whereIs(this.player.rec, kill.victim, kill.t - 0.05, this.player.kills ?? this.player.rec.kills);
    if (!w.pos) return;
    // A man on foot is placed at his feet; the rounds point 0.3 m over his
    // origin, a metre up (replay-dossier.js `aimPointOf`). A hull's own.
    const lift = (w.state === 'foot' ? CHARACTER_HEIGHT : 0) + 0.3;
    target.victimAt = new THREE.Vector3(w.pos[0], w.pos[1] + lift, w.pos[2]);
    target.victimDist = target.victimAt.distanceTo(this.shotPos);
  }

  /** Every round flying now is older than the one awaited. */
  primeSeen() {
    const guns = this.guns;
    if (!guns) return;
    for (const list of [guns.tracers, guns.projectiles]) {
      for (const obj of list) if (!this.born.has(obj)) this.born.set(obj, -Infinity);
    }
  }

  /** Stop chasing, the clock given back; `handBack` false leaves the camera
   *  where the mode puts it. */
  stop(handBack = true) {
    if (this.state === 'idle') return;
    const target = this.target;
    const endedAt = this.state;
    this.releaseTarget();
    this.state = 'idle';
    this.target = null;
    this.impact = null;
    if (this.player.camera.rig === this) this.player.camera.setRig(null);
    if (this.savedSpeed !== null) this.player.speed = this.savedSpeed;
    this.savedSpeed = null;
    if (this.hero) this.hero.visible = false;
    if (handBack && target && (endedAt === 'impact' || endedAt === 'flying')) this.handBack(target);
    this.hooks.changed?.();
  }

  /** The chased tracer's streak back as it was (hidden while chased: its
   *  50 m would run through the camera). */
  releaseTarget() {
    const t = this.target;
    if (t?.obj && t.hidMesh && t.list?.includes(t.obj)) t.obj.mesh.visible = true;
    if (t) t.hidMesh = false;
  }

  /** After the hit: the man it killed, its shooter, or a free camera left
   *  where the chase ended. */
  handBack(target) {
    const cam = this.player.ctx.camera;
    const pid = this.afterHit === 'victim' ? target.victim ?? target.pid
      : this.afterHit === 'shooter' ? target.pid : null;
    if (pid !== null && pid !== undefined) this.hooks.follow?.(pid, cam.position);
    else this.hooks.free?.(cam.position, cam.quaternion);
  }

  // --- per frame -----------------------------------------------------------------------

  /**
   * Before the camera is placed (the creator's `lead`): a seek, the round
   * awaited found as it appears, the one chased followed or ended, the clock.
   * `dt` is the page's real frame time.
   */
  step(t, dt) {
    if (this.state === 'idle') return;
    const jumped = this.lastT !== null && (t < this.lastT - 1e-6 || t - this.lastT > 1.2);
    if (jumped && this.state !== 'armed') {
      // A seek clears every round in the air: nothing is left to chase.
      this.stop(false);
      return;
    }
    const prev = jumped ? t : this.lastT ?? t;
    this.lastT = t;
    this.from.w *= Math.exp(-Math.max(0, dt) / GLIDE);
    const target = this.target;
    if (this.state === 'armed') {
      const f = target.f;
      if (jumped && t > f.t) {
        // Taken past the shot by hand: nothing to wait for, nothing missed.
        this.stop(false);
        return;
      }
      if (t > f.t + GIVE_UP) {
        this.stop(false);
        this.hooks.missed?.(target);
        return;
      }
      this.tagBorn(prev);
      if (t >= f.t - 0.02) this.claim(t);
      if (this.state === 'armed') {
        const slow = slowFor(guessSpeed(target.weapon), this.bulletTime, target.victimDist);
        const k = smooth(f.t - RAMP_LEAD, f.t, t);
        this.easeClock(this.savedSpeed + (Math.min(this.savedSpeed, slow) - this.savedSpeed) * k, dt);
        return;
      }
    }
    if (this.state === 'flying') {
      target.real = (target.real ?? 0) + Math.max(0, dt);
      const alive = this.readLive(t);
      if (alive && target.victimAt && this.pos.distanceTo(this.shotPos) >= target.victimDist - 0.2) {
        // Reached the man it killed.
        this.pos.copy(target.victimAt);
        this.startImpact(t);
      } else if (!alive || (!target.victimAt && target.real > CHASE_MAX_REAL)) {
        this.startImpact(t);
      } else {
        this.easeClock(Math.min(this.savedSpeed, slowFor(this.speed, this.bulletTime, target.victimDist)), dt);
        return;
      }
    }
    if (this.state === 'impact') {
      const im = this.impact;
      im.real += Math.max(0, dt);
      const fell = !target.kill || t >= target.kill.t + HOLD_PAST_KILL;
      if ((im.real >= HOLD_REAL && fell) || im.real >= HOLD_MAX_REAL || !this.player.playing && im.real >= HOLD_REAL) {
        this.stop(true);
        return;
      }
      this.easeClock(Math.min(this.savedSpeed, HOLD_SPEED), dt);
    }
  }

  /** The replay's clock toward `speed`, over CLOCK_EASE of real time. */
  easeClock(speed, dt) {
    if (!this.bulletTime) return;
    const player = this.player;
    if (!(speed > 0)) return;
    const k = 1 - Math.exp(-Math.max(0, dt) / CLOCK_EASE);
    player.speed += (speed - player.speed) * k;
    if (!(player.speed > 0)) player.speed = speed;
  }

  /** Every round of the page's guns not seen before was fired at or after
   *  `t` (the last frame's clock: its rounds were fired in that frame). */
  tagBorn(t) {
    const guns = this.guns;
    if (!guns) return;
    for (const list of [guns.tracers, guns.projectiles]) {
      for (const obj of list) if (!this.born.has(obj)) this.born.set(obj, t);
    }
  }

  /** The armed shot's round, if it has appeared: the round of the page's guns
   *  born with it, leaving from its muzzle along its line; or, for a round the
   *  server flies, its recorded object. */
  claim(t) {
    const target = this.target;
    const f = target.f;
    const guns = this.guns;
    let best = null;
    if (guns) {
      for (const [list, tracer] of [[guns.tracers, true], [guns.projectiles, false]]) {
        for (const obj of list) {
          const born = this.born.get(obj);
          if (!(born >= f.t - 1e-3)) continue;
          const v = obj.velocity;
          const n = v?.length?.() ?? 0;
          if (!(n > 1e-3)) continue;
          const dot = (v.x * this.shotDir.x + v.y * this.shotDir.y + v.z * this.shotDir.z) / n;
          if (dot < MATCH_DOT) continue;
          const o = obj.origin ?? [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z];
          const d = Math.hypot(o[0] - this.shotPos.x, o[1] - this.shotPos.y, o[2] - this.shotPos.z);
          if (d > MATCH_DIST) continue;
          const score = (born - f.t) * 10 + d * 0.05 + (1 - dot) * 20;
          if (!best || score < best.score) best = { obj, list, tracer, score };
        }
      }
    }
    if (best) {
      Object.assign(target, { obj: best.obj, list: best.list, kind: kindOfLive(best.obj, best.tracer) });
      this.state = 'flying';
      this.readLive(t);
      this.hooks.changed?.();
      return;
    }
    // A grenade: the server flies it, and the recording carries it.
    target.thrown ??= /grenade/i.test(target.weapon ?? '') ? thrownLifeOf(this.player.rec, f) ?? false : false;
    if (target.thrown && t >= target.thrown.from) {
      Object.assign(target, { life: target.thrown.life, kind: 'thrown' });
      this.state = 'flying';
      this.readLive(t);
      this.hooks.changed?.();
    }
  }

  /** The chased round's place, heading and speed now; false once it is gone
   *  (struck, spent, or out of the recording). */
  readLive(t = this.player.time) {
    const target = this.target;
    if (target.life) {
      const life = target.life;
      if (t >= life.destroyed || !isReplicated(life, t)) return false;
      const p = positionAt(life, t);
      if (!p || Math.hypot(p[0], p[1], p[2]) < 1) return false;
      const q = positionAt(life, Math.max(life.created, t - 0.06));
      this.pos.set(p[0], p[1], -p[2]);
      if (q) {
        _v.set(p[0] - q[0], p[1] - q[1], -(p[2] - q[2]));
        const n = _v.length();
        const span = Math.min(0.06, t - life.created);
        if (n > 1e-4 && span > 0) {
          this.dir.copy(_v).divideScalar(n);
          this.speed = n / span;
        }
      }
      return true;
    }
    const obj = target.obj;
    if (!obj || !target.list?.includes(obj)) {
      // Struck or spent this frame: its mesh still stands where it stopped
      // (the pool keeps it until the next round is fired).
      if (obj?.mesh) this.pos.copy(obj.mesh.position).addScaledVector(this.dir, obj.lead ?? 0);
      return false;
    }
    const v = obj.velocity;
    const n = v.length();
    if (n > 1e-4) {
      this.dir.copy(v).divideScalar(n);
      this.speed = n;
    }
    this.pos.copy(obj.mesh.position).addScaledVector(this.dir, obj.lead ?? 0);
    if (target.kind === 'tracer' && obj.mesh.visible) {
      obj.mesh.visible = false;
      target.hidMesh = true;
    }
    return true;
  }

  startImpact(t) {
    this.state = 'impact';
    this.impact = { at: this.pos.clone(), cam: this.camPos.clone(), dir: this.dir.clone(), real: 0, t };
    if (this.hero) this.hero.visible = false;
    this.hooks.changed?.();
  }

  // --- the rig ---------------------------------------------------------------------------

  /** The camera, for replay-camera.js: over the shooter's shoulder while the
   *  shot is coming, behind the round in flight, held on the impact. False
   *  while there is nothing to place it by (a shot still seconds off: the
   *  orbit on the shooter until then). */
  place(cam, dt, t) {
    this.placing = false;
    if (this.state === 'idle') return false;
    if (this.state === 'impact') {
      // The hold: the camera draws back and up off the round's path, so the
      // man it hit is seen whole as he falls.
      const im = this.impact;
      const k = smooth(0, PULL_BACK, im.real);
      const back = _vo.copy(im.at).addScaledVector(im.dir, -PULL_DIST).add(_vn.set(0, PULL_UP, 0));
      cam.position.copy(im.cam).lerp(back, k);
      this.keepAbove(cam.position);
      cam.lookAt(_v.copy(im.at));
      this.camPos.copy(cam.position);
      this.placing = true;
      return true;
    }
    let rig;
    let anchor;
    let dir;
    if (this.state === 'armed') {
      const f = this.target.f;
      if (t < f.t - SETUP_LEAD) return false;
      anchor = this.shoulderAnchor(t, _v3);
      dir = this.shotDir;
      rig = SHOULDER;
    } else {
      anchor = this.pos;
      dir = this.dir;
      rig = RIGS[this.target.kind] ?? RIGS.tracer;
    }
    // The round's frame: its heading, its right, its up.
    const side = _v.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = _v2.crossVectors(side, dir).normalize();
    _m.makeBasis(side, up, _vb.copy(dir).negate());
    const { yaw, pitch, dist } = this.orbit;
    const offset = _vo.set(rig.side, rig.up, rig.back).multiplyScalar(dist)
      .applyEuler(_e.set(pitch, yaw, 0, 'YXZ')).applyMatrix4(_m);
    const pos = _vp.copy(anchor).add(offset);
    // Looking down its path, or at it as the drag swings round it.
    const ahead = rig.ahead * Math.max(0, Math.cos(yaw) * Math.cos(pitch));
    const look = _vl.copy(anchor).addScaledVector(dir, ahead);
    const w = this.from.w;
    if (w > 1e-3) {
      pos.lerp(this.from.pos, w);
      look.lerp(this.from.look, w);
    }
    this.keepAbove(pos);
    cam.position.copy(pos);
    cam.lookAt(look);
    this.camPos.copy(pos);
    this.camLook.copy(look);
    this.placeHero(dt);
    this.placing = true;
    return true;
  }

  /** Where the shot will leave from, carried along with the shooter until it
   *  does: his place now plus the muzzle's offset from his place at the shot. */
  shoulderAnchor(t, out) {
    const target = this.target;
    const f = target.f;
    out.copy(this.shotPos);
    const rec = this.player.rec;
    const kills = this.player.kills ?? rec.kills;
    target.thenPos ??= whereIs(rec, f.pid, f.t, kills).pos ?? false;
    if (!target.thenPos || t >= f.t) return out;
    const now = whereIs(rec, f.pid, t, kills).pos;
    if (now) out.add(_vn.set(now[0] - target.thenPos[0], now[1] - target.thenPos[1], now[2] - target.thenPos[2]));
    return out;
  }

  /** Above the ground and the water, closer than the orbit keeps: a bullet
   *  skims the grass. */
  keepAbove(p) {
    const ctx = this.player.ctx;
    let floor = -Infinity;
    const ground = ctx.groundHeight?.(p.x, p.z);
    if (Number.isFinite(ground)) floor = ground;
    const water = ctx.waterLevel?.();
    if (Number.isFinite(water)) floor = Math.max(floor, water);
    if (p.y < floor + CLEARANCE) p.y = floor + CLEARANCE;
  }

  /** A drag swings the camera round the round (or the shoulder shot), paused
   *  or not: time frozen round a bullet. Only while this rig is placing. */
  drag(dx, dy) {
    if (!this.placing) return false;
    this.orbit.yaw -= dx * 0.005;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.004, -1.35, 1.35);
    return true;
  }

  wheel(steps) {
    if (!this.placing) return false;
    this.orbit.dist = clamp(this.orbit.dist * Math.exp(steps * 0.15), 0.35, 14);
    return true;
  }

  /** The near plane the chase needs, metres, or null for the page's own: a
   *  bullet is chased from half a metre, inside the page's 0.5 m. */
  nearPlane() {
    if (this.state !== 'flying') return null;
    return RIGS[this.target?.kind]?.near ?? null;
  }

  // --- the round a bullet is drawn as -------------------------------------------------

  /** A rifle round is not drawn by the game (`invisible 1`), and its tracer
   *  streak is 50 m long: the chased bullet is drawn here, a jacketed round
   *  2.2 times its size turning on its rifling, with a faint wake. */
  placeHero(dt) {
    const show = this.state === 'flying' && this.target?.kind === 'tracer';
    if (!show) {
      if (this.hero) this.hero.visible = false;
      return;
    }
    const hero = this.hero ?? this.makeHero();
    hero.visible = true;
    hero.position.copy(this.pos);
    this.spin = ((this.spin ?? 0) + Math.max(0, dt) * 9) % (Math.PI * 2);
    hero.quaternion.setFromUnitVectors(FORWARD, this.dir).multiply(_qs.setFromAxisAngle(FORWARD, this.spin));
    hero.updateMatrixWorld(true);
  }

  makeHero() {
    const group = new THREE.Group();
    group.name = 'creator round';
    const metal = new THREE.MeshStandardMaterial({ color: 0xc08a4a, metalness: 0.85, roughness: 0.3, emissive: 0x2e1504 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0041, 0.0041, 0.02, 14), metal);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.01;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0041, 0.013, 14), metal);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.0065;
    const wake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0004, 0.0032, 0.5, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe6bd, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    wake.rotation.x = Math.PI / 2;
    wake.position.z = 0.27;
    group.add(body, tip, wake);
    group.scale.setScalar(2.2);
    for (const mesh of [body, tip, wake]) mesh.frustumCulled = false;
    this.player.ctx.scene.add(group);
    this.hero = group;
    return group;
  }

  // --- what the plate says --------------------------------------------------------------

  /** `{ phase, text }` for the creator's plate over the view, or null. */
  describe(name = pid => `player ${pid}`, display = s => s) {
    const target = this.target;
    if (this.state === 'idle' || !target) return null;
    const weapon = target.weapon ? display(target.weapon) : 'round';
    const who = target.pid !== null && target.pid !== undefined ? name(target.pid) : null;
    const whose = who ? `${who}'s ${weapon}` : weapon;
    if (this.state === 'armed') {
      const wait = target.f.t - this.player.time;
      return { phase: 'armed', text: wait > 0.05 ? `${whose} in ${wait.toFixed(1)} s` : whose };
    }
    if (this.state === 'flying') {
      const metres = this.speed > 0 ? ` · ${Math.round(this.speed)} m/s` : '';
      return { phase: 'flying', text: `${whose}${metres}` };
    }
    return { phase: 'impact', text: target.victim !== null && target.victim !== undefined ? name(target.victim) : whose };
  }

  dispose() {
    this.stop(false);
    if (this.hero) {
      this.hero.removeFromParent();
      this.hero.traverse(o => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.hero = null;
    }
  }
}
