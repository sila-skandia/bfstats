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
//
// Where the camera stands is the shot style's (replay-shotstyle.js): behind
// the round (chase), in front of it swinging round (Chase 360), alongside it,
// beside the man it kills looking back, or a camera the creator placed. A
// knife's kill has nothing in flight: its swing is shot as a slow orbit round
// the two men, whatever the style, unless the creator placed the camera.

import * as THREE from 'three';
import { isReplicated, positionAt } from './replay-recording.js';
import { whereIs } from './replay-battles.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { holdYaw, isMelee, orbitYaw, styleOf } from './replay-shotstyle.js';

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
/** A soldier's round leaves his eye (ledger XHIT-18), inside his drawn body,
 *  and a hull gun's need not leave its barrel as drawn (Bocage's MG 42 nest:
 *  0.36 m off it, its gunner's camera 2.3 m back); the bullet the round cam
 *  draws leaves the drawn muzzle and joins the round's own line over its
 *  first MUZZLE_BLEND metres (half the way to the man it kills when that is
 *  nearer), so where it strikes does not move. A muzzle further than MUZZLE_MAX from where the
 *  round started is not that gun's. */
const MUZZLE_BLEND = 20;
const MUZZLE_MAX = 3;
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
/** Side-on: abreast of the round, a little behind it, looking just ahead of
 *  it; and abreast of the shooter before he fires. */
const SIDE_RIGS = {
  tracer: { back: 0.15, up: 0.05, side: 0.7, ahead: 0.25, near: 0.1 },
  rocket: { back: 0.6, up: 0.4, side: 3, ahead: 1.2 },
  shell: { back: 0.6, up: 0.4, side: 3, ahead: 1.2 },
  bomb: { back: 1.5, up: 1, side: 7, ahead: 3 },
  thrown: { back: 0.4, up: 0.4, side: 2.4, ahead: 0.8 },
};
const SIDE_SHOULDER = { back: 0.3, up: 0.25, side: 3.2, ahead: 1.5 };
/** From the victim: beyond him along the round's line, to his side, a little
 *  up, metres. */
const REVERSE = { back: 2.2, side: 0.9, up: 0.35 };
/** The orbit holds (Chase 360 and a knife's kill): real seconds the half
 *  turn takes, and how far from what it circles, metres. */
const ORBIT_HOLD = 2.2;
const ORBIT_DIST = 4.5;
const MELEE_DIST = 3.2;
/** The clock through a knife's swing under bullet time. */
const MELEE_SPEED = 0.35;
/** Real seconds a placed camera's turn toward what it follows takes. */
const AIM_EASE = 0.1;

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

/** Where the chased bullet is drawn, into `out`: the round at `pos`, moved
 *  by the muzzle's `offset` from where the round started (`start`), the
 *  move closing to nothing over the first MUZZLE_BLEND metres (or half of
 *  `victimDist`). */
export function drawnRoundAt(pos, start, offset, victimDist, out) {
  out.copy(pos);
  if (!offset) return out;
  const blend = victimDist > 0 ? Math.min(MUZZLE_BLEND, victimDist * 0.5) : MUZZLE_BLEND;
  const k = 1 - smooth(0, blend, pos.distanceTo(start));
  return k > 0 ? out.addScaledVector(offset, k) : out;
}

/** Where a take's bullet time slows the clip, seconds of the round: from
 *  RAMP_LEAD before shot `f` until HOLD_PAST_KILL after its kill (or the
 *  shot), the stretch the clip strip's speed lane draws as automatic. */
export function bulletTimeSpan(f, kill = null) {
  if (!Number.isFinite(f?.t)) return null;
  const end = Number.isFinite(kill?.t) ? Math.max(kill.t, f.t) : f.t;
  return { t0: f.t - RAMP_LEAD, t1: end + HOLD_PAST_KILL };
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
 *  carries, not a v3 press), or null; `pid` null takes anybody's. */
export function nextShotOf(rec, pid, t, { heavy = false } = {}) {
  const fires = rec.fires ?? [];
  for (let i = firstFireAt(fires, t); i < fires.length; i++) {
    const f = fires[i];
    if (pid !== null && pid !== undefined && f.pid !== pid) continue;
    if (f.press || f.feedOnly || !Array.isArray(f.dir)) continue;
    if (heavy && !heavyRound(f.weapon)) continue;
    return f;
  }
  return null;
}

/**
 * Whether a weapon sends one round at a time, slow enough to watch: a
 * bazooka, a tank's gun, a bomb, a grenade -- whatever SPEED_GUESS knows by
 * name. A machine gun's rounds are not: they leave in bursts along one line
 * and most of them hit nothing, so riding one at random shows nothing. The
 * round cam's own slow motion is set the same way, from the round's speed.
 */
export function heavyRound(weapon) {
  return guessSpeed(weapon) < BULLET_GUESS;
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
    this.style = 'chase';          // replay-shotstyle.js SHOT_STYLES
    this.angle = null;             // the placed camera: { pos, look, aim } (replay-shotstyle.js `angleOf`)
    this.target = null;            // { f, pid, kill, victim, weapon, obj, list, kind, life, label }
    this.born = new WeakMap();     // a live round -> the recording time it was first seen at
    this.lastT = null;
    this.savedSpeed = null;
    this.orbit = { yaw: 0, pitch: 0, dist: 1 };
    this.pos = new THREE.Vector3();
    this.drawPos = new THREE.Vector3();   // where the chased bullet is drawn (`drawn`)
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
  arm(f, { kill = null, again = false } = {}) {
    if (!shotRay(f, this.shotPos, this.shotDir)) return false;
    // Armed `again` (the clip looping round to its start): the swing of the
    // camera the creator dragged in is kept, and there is no glide in from
    // wherever the last take left the camera.
    const orbit = again ? { ...this.orbit } : null;
    this.begin({
      f, pid: f.pid, kill, victim: kill?.victim ?? null, weapon: f.weapon, obj: null, list: null,
      kind: null, life: null, thrown: null, victimAt: null, victimDist: null, melee: isMelee(f.weapon),
    }, 'armed');
    if (orbit) {
      this.orbit = orbit;
      this.from.w = 0;
    }
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
    if (known) this.target.muzzleOff = this.muzzleOffset(this.target);
    this.readLive();
    return true;
  }

  /** The drawn muzzle's offset from where the target's round started (the
   *  page's round's own origin, else the recorded eye), for a bullet the
   *  round cam draws itself (a rocket or shell is the page's own body on the
   *  round's line), or null. Keeps that start as `target.launchAt`. */
  muzzleOffset(target) {
    const f = target?.f;
    if (!f || target.kind !== 'tracer') return null;
    const m = this.player.shotMuzzles?.get(f);
    if (!m) return null;
    const o = target.obj?.origin;
    const start = Array.isArray(o) && o.every(Number.isFinite) ? new THREE.Vector3(o[0], o[1], o[2]) : this.shotPos.clone();
    const off = new THREE.Vector3(m[0] - start.x, m[1] - start.y, m[2] - start.z);
    if (!(off.length() <= MUZZLE_MAX)) return null;
    target.launchAt = start;
    return off;
  }

  /** Where the chased round is drawn now: on its line, out of the muzzle. */
  drawn() {
    const target = this.target;
    return drawnRoundAt(this.pos, target?.launchAt ?? this.shotPos, target?.muzzleOff ?? null, target?.victimDist ?? null, this.drawPos);
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
    this.aimAt = null;
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
    // A camera the creator placed stays where he put it.
    if (this.shotStyle() === 'fixed') {
      this.hooks.free?.(cam.position, cam.quaternion);
      return;
    }
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
      if (target.melee) {
        // Nothing flies: the swing lands at the shot, and the hold is the
        // shot of it. The page's own knife round is never claimed (it would
        // be drawn as a bullet).
        if (t >= f.t) this.startMelee(t);
        else {
          const k = smooth(f.t - RAMP_LEAD, f.t, t);
          this.easeClock(this.savedSpeed + (Math.min(this.savedSpeed, MELEE_SPEED) - this.savedSpeed) * k, dt);
          return;
        }
      } else {
        this.tagBorn(prev);
        if (t >= f.t - 0.02) this.claim(t);
      }
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
      // How far along its flight: Chase 360 turns by it.
      target.progress = target.victimDist > 0
        ? clamp(this.pos.distanceTo(this.shotPos) / target.victimDist, 0, 1)
        : clamp(target.real / (this.bulletTime?.flight ?? 2.5), 0, 1);
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
      // An orbit hold runs its half turn out.
      const least = this.orbitHold() ? ORBIT_HOLD : HOLD_REAL;
      if ((im.real >= least && fell) || im.real >= Math.max(least, HOLD_MAX_REAL) || !this.player.playing && im.real >= least) {
        this.stop(true);
        return;
      }
      this.easeClock(Math.min(this.savedSpeed, target.melee ? MELEE_SPEED : HOLD_SPEED), dt);
    }
  }

  /** The replay's clock toward `speed`, over CLOCK_EASE of real time. */
  easeClock(speed, dt) {
    // A clip with slow motion of its own runs its own clock (the creator's
    // `clockOwned`): what the speed lane shows is what plays.
    if (!this.bulletTime || this.hooks.clockOwned?.()) return;
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
      target.muzzleOff = this.muzzleOffset(target);
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

  /** A knife's swing landing: the hold, circling the two men, from where the
   *  shoulder shot had the camera. */
  startMelee(t) {
    const target = this.target;
    const victim = target.victimAt ?? _v.copy(this.shotPos).addScaledVector(this.shotDir, 1.5);
    const shooter = this.shoulderAnchor(t, _v2);
    this.pos.copy(victim);
    this.dir.copy(this.shotDir);
    this.state = 'impact';
    this.impact = {
      at: victim.clone(), centre: _v3.copy(shooter).lerp(victim, 0.5).clone(),
      cam: this.camPos.clone(), dir: this.shotDir.clone(), real: 0, t,
    };
    this.hooks.changed?.();
  }

  /** The style the camera is placed by now: a placed camera with no angle
   *  kept is the chase, and a knife's kill is its orbit unless the camera
   *  was placed. */
  shotStyle() {
    const style = styleOf(this.style);
    if (style === 'fixed' && !this.angle) return 'chase';
    if (this.target?.melee && style !== 'fixed') return 'melee';
    return style;
  }

  /** Whether the hold is a turn round the man (Chase 360, a knife's kill). */
  orbitHold() {
    const style = this.shotStyle();
    return style === 'orbit' || style === 'melee';
  }

  // --- the rig ---------------------------------------------------------------------------

  /** The camera, for replay-camera.js: over the shooter's shoulder while the
   *  shot is coming, behind the round in flight, held on the impact. False
   *  while there is nothing to place it by (a shot still seconds off: the
   *  orbit on the shooter until then). */
  place(cam, dt, t) {
    this.placing = false;
    if (this.state === 'idle') return false;
    if (this.state === 'armed' && t < this.target.f.t - SETUP_LEAD) return false;
    const style = this.shotStyle();
    if (style === 'fixed') return this.placeFixed(cam, dt, t);
    if (style === 'reverse' && this.target.victimAt) return this.placeReverse(cam, dt, t);
    if (this.state === 'impact' && this.orbitHold()) return this.placeOrbitHold(cam);
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
    // Chase 360 starts in front, looking back at the shooter and then the
    // round, and swings round behind it as it lands.
    let turn = 0;
    if (this.state === 'armed') {
      anchor = this.shoulderAnchor(t, _v3);
      dir = this.shotDir;
      rig = style === 'side' ? SIDE_SHOULDER : SHOULDER;
      if (style === 'orbit') turn = Math.PI;
    } else {
      anchor = this.drawn();
      dir = this.dir;
      const kind = this.target.kind ?? 'tracer';
      rig = (style === 'side' ? SIDE_RIGS[kind] ?? SIDE_RIGS.tracer : RIGS[kind] ?? RIGS.tracer);
      if (style === 'orbit') turn = orbitYaw(this.target.progress ?? 0);
    }
    // The round's frame: its heading, its right, its up.
    const side = _v.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = _v2.crossVectors(side, dir).normalize();
    _m.makeBasis(side, up, _vb.copy(dir).negate());
    const { pitch, dist } = this.orbit;
    const yaw = this.orbit.yaw + turn;
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

  /** What the camera looks at now: the shooter's muzzle before the shot, the
   *  round in flight, the man it hit (a knife's: the two men) after. */
  subjectNow(t, out) {
    if (this.state === 'armed') return this.shoulderAnchor(t, out);
    if (this.state === 'impact') return out.copy(this.impact.centre ?? this.impact.at);
    return out.copy(this.drawn());
  }

  /** The camera as placed, then the glide in and the ground. */
  finish(cam, pos, look, dt) {
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

  /** The hold as a half turn round the man it killed (Chase 360, the rest of
   *  its full turn) or round the two men of a knife's kill, from where the
   *  camera was at the hit. */
  placeOrbitHold(cam) {
    const im = this.impact;
    const centre = im.centre ?? im.at;
    const melee = Boolean(im.centre);
    const k = clamp(im.real / ORBIT_HOLD, 0, 1);
    im.bearing ??= Math.atan2(im.cam.x - centre.x, im.cam.z - centre.z);
    im.from ??= Math.hypot(im.cam.x - centre.x, im.cam.z - centre.z);
    const radius = (melee ? MELEE_DIST : ORBIT_DIST) * this.orbit.dist;
    const r = im.from + (radius - im.from) * smooth(0, 0.35, k);
    const a = im.bearing + holdYaw(k) + this.orbit.yaw;
    const height = (melee ? 0.9 : PULL_UP) + this.orbit.pitch * 2;
    const pos = _vp.set(centre.x + Math.sin(a) * r, centre.y + height, centre.z + Math.cos(a) * r);
    pos.y = im.cam.y + (pos.y - im.cam.y) * smooth(0, 0.35, k);
    this.from.w = 0;
    return this.finish(cam, pos, _vl.copy(centre), 0);
  }

  /** From the victim: beside him, beyond him along the round's line, looking
   *  back at the shooter, then the round coming, then down on him. A drag
   *  swings the camera round him. */
  placeReverse(cam, dt, t) {
    const target = this.target;
    const v = target.victimAt;
    const side = _v.crossVectors(this.shotDir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const d = this.orbit.dist;
    const offset = _vo.copy(this.shotDir).multiplyScalar(REVERSE.back * d).addScaledVector(side, REVERSE.side * d)
      .add(_vn.set(0, REVERSE.up * d, 0)).applyAxisAngle(UP, this.orbit.yaw);
    offset.y += this.orbit.pitch * 2;
    const pos = _vp.copy(v).add(offset);
    const look = this.state === 'impact' ? _vl.copy(v) : this.subjectNow(t, _vl);
    return this.finish(cam, pos, look, dt);
  }

  /** The camera the creator placed: still where he put it, looking where he
   *  had it look (`lock`), or turning to keep the shooter, the round and the
   *  man it hits in the middle of the frame (`track`). */
  placeFixed(cam, dt, t) {
    const a = this.angle;
    const pos = _vp.fromArray(a.pos);
    const want = a.aim === 'lock' ? _v.fromArray(a.look) : this.subjectNow(t, _v);
    this.aimAt ??= new THREE.Vector3().copy(want);
    if (a.aim === 'lock') this.aimAt.copy(want);
    else this.aimAt.lerp(want, 1 - Math.exp(-Math.max(0, dt) / AIM_EASE));
    // A placed camera is the cut, not a glide.
    this.from.w = 0;
    return this.finish(cam, pos, _vl.copy(this.aimAt), dt);
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
    // A placed camera stays put; the drag is swallowed rather than turning
    // the view under it.
    if (this.shotStyle() === 'fixed') return true;
    this.orbit.yaw -= dx * 0.005;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.004, -1.35, 1.35);
    return true;
  }

  wheel(steps) {
    if (!this.placing) return false;
    if (this.shotStyle() === 'fixed') return true;
    this.orbit.dist = clamp(this.orbit.dist * Math.exp(steps * 0.15), 0.35, 14);
    return true;
  }

  /** The near plane the chase needs, metres, or null for the page's own: a
   *  bullet is chased from half a metre, inside the page's 0.5 m. */
  nearPlane() {
    if (this.state !== 'flying') return null;
    const style = this.shotStyle();
    if (style === 'side') return SIDE_RIGS[this.target?.kind]?.near ?? null;
    if (style !== 'chase' && style !== 'orbit') return null;
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
    hero.position.copy(this.drawn());
    // Close behind it the round is drawn at 2.2 times its size; from a camera
    // further off it grows with the distance, or it is a pixel.
    hero.scale.setScalar(Math.max(2.2, this.camPos.distanceTo(hero.position) * 0.6));
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
