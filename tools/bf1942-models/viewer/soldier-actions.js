// What each half of a third-person soldier plays, beside his gait: the stance
// transitions the engine runs between standing, crouching and lying, the fire
// and the reload -- and the morph that carries the bones from one state into
// the next.
//
// The engine runs two animation state machines over a soldier, the lower body
// (11 bones: the root, the pelvis, the legs, `Spine Root`) and the upper (44:
// `Bip01 Spine` out to the fingertips), each with a phase of its own. The
// clips are baked into the shared gait sidecars under the engine's own state
// names (`extract_pose.py` `STANCE_TRANSITIONS` / `UPPER_ACTIONS`), and this
// decides which one each half plays, from the stance and gait the page
// already simulates and four events:
//
//  * **a stance change.** `BFSoldier::handlePlayerInput` (lnxded `0x08273c70`)
//    enters the first state of a chain on both machines by name and each
//    state's `addTransitionWhenDone` does the rest (`STANCE_ENTRY`). Standing
//    to prone is the DIVE, `Lb_RunStandToLie`, unless the soldier is moving
//    backward (ledger PHY-8); only then is it `Lb_StandToLie` into
//    `Lb_CrouchToLie`. The torso's transition is set only while the weapon is
//    ready (`HandFireArms::isReadyToUse`, vt+0x120), so a reload keeps the
//    torso while the legs go down.
//  * **a round fired.** `Ub_Fire` (standing and crouched alike: no vanilla
//    weapon has a crouched fire state, ledger ANIM-12) or `Ub_LieFire`. A
//    single-shot weapon's is a one-shot that cuts in (`setMorphFactor 10000`)
//    and hands back to the pose -- or, for the bolt-action rifles, to
//    `Ub_StandReload`, the bolt. An automatic's loops while the trigger is
//    held (`addTransitionOne c_PIFire`) and `returnToState _POSE_` on release.
//  * **the water.** `BFSoldier::updateSwimming` sets the swim states on both
//    machines by name, and while one holds them nothing else is entered: no
//    stance chain, no fire, no reload (`c_AsmHideWeapon`). `followSwim`.
//  * **a reload.** `Ub_StandReload` or `Ub_LieReload`, a one-shot that cuts in
//    and returns to the pose when its clip is done -- which is shorter than the
//    weapon's `reloadTime` on most weapons; the torso aims again while the
//    magazine is still going in, as it does in the engine.
//
// The transitions end on each machine's base state, `Lb_Stand`/`Lb_Crouch`/
// `Lb_Lie` and `Ub_StandAim`/`Ub_Crouch`/`Ub_Lie` (`_POSE_` in a one-shot's
// `addTransitionWhenDone`), which are the gait families this module hands back
// as the half's base: the same `stand.lower`/`run.upper` pairs `soldier-body.js`
// plays.
//
// THE MORPH. On entering a state the engine's blend weight starts at 0 (or 1
// when the state's `setMorphFactor` is above 1000) and every update adds `dt x
// morph`, and `Skeleton::setRelativeBoneTransform` slerps each bone from its
// CURRENT local toward the new state's clip by that weight (ledger ANIM-4:
// `updateState` 0x0832b270 sets `+0xd` to 0/1 on entry and adds `dt x
// state+0x2c` after; the parked previous clip is dropped when the new state
// has one). So the bones never jump: they start where the last state left
// them and converge on the new clip, and a transition clip whose first frame
// is not quite the stance it leaves (`3PStand2CrouchLower` starts 0.1 m under
// `3PStandLower`) is never seen to jump either. `entries` carries each state's
// morph for the renderer, which does the slerp (`MorphBlend` below).
//
// Free of `three` and of the DOM, so `tests/soldier_actions_harness.mjs` runs
// the real thing under node.

/** A gait family's two baked clips (`soldier-body.js` `BODY_CLIPS`). */
export const FAMILY_HALVES = Object.freeze({
  stand: Object.freeze({ lower: 'stand.lower', upper: 'stand.upper' }),
  walk: Object.freeze({ lower: 'walk.lower', upper: 'walk.upper' }),
  run: Object.freeze({ lower: 'run.lower', upper: 'run.upper' }),
  crouch: Object.freeze({ lower: 'crouch.lower', upper: 'crouch.upper' }),
  crouchwalk: Object.freeze({ lower: 'crouchwalk.lower', upper: 'crouchwalk.upper' }),
  prone: Object.freeze({ lower: 'lie.lower', upper: 'lie.upper' }),
  crawl: Object.freeze({ lower: 'crawl.lower', upper: 'crawl.upper' }),
});

/**
 * The first state of each machine on a stance change, `handlePlayerInput`'s
 * own pairs (string VAs `0x086d1ee8`..`0x086d1f8f`). Crouch -> stand is not
 * entered there: `Lb_Crouch` and `Ub_Crouch<W>` declare `returnToState
 * Lb_CrouchToStand` / `Ub_CrouchToStand`, which the machine takes when the
 * crouch channel lets go.
 */
export const STANCE_ENTRY = Object.freeze({
  'stand>crouch': Object.freeze({ lower: 'Lb_StandToCrouch', upper: 'Ub_StandToCrouch' }),
  'crouch>stand': Object.freeze({ lower: 'Lb_CrouchToStand', upper: 'Ub_CrouchToStand' }),
  'stand>prone': Object.freeze({ lower: 'Lb_RunStandToLie', upper: 'Ub_RunStandToLie' }),
  'stand>prone backward': Object.freeze({ lower: 'Lb_StandToLie', upper: 'Ub_StandToLie' }),
  'crouch>prone': Object.freeze({ lower: 'Lb_CrouchToLie', upper: 'Ub_CrouchToLie' }),
  'prone>crouch': Object.freeze({ lower: 'Lb_LieToCrouch', upper: 'Ub_LieToCrouch' }),
  'prone>stand': Object.freeze({ lower: 'Lb_LieToStand', upper: 'Ub_LieToStand' }),
});

/** A stance's gait family standing still. */
const STILL_FAMILY = Object.freeze({ stand: 'stand', crouch: 'crouch', prone: 'prone' });

/** The pose each gait family's lower state holds (`Lb_Crouch`,
 *  `Lb_CrouchForward` crouch; `Lb_Lie`, `Lb_LieForward` lie). */
const FAMILY_POSE = Object.freeze({
  stand: 'stand', walk: 'stand', run: 'stand', crouch: 'crouch', crouchwalk: 'crouch',
  prone: 'prone', crawl: 'prone',
});

/** The states that mean "back to the pose": a machine's base states, and the
 *  `_POSE_` sentinel (`AnimationState::update` maps it to the base, ANIM-6). */
const BASE_STATES = Object.freeze(new Set([
  '_POSE_', 'Lb_Stand', 'Lb_Crouch', 'Lb_Lie',
  'Ub_StandAim', 'Ub_Stand', 'Ub_Crouch', 'Ub_Lie',
]));

/**
 * What the vanilla scripts say, for a tree whose bundles predate the
 * `extras.states` they now carry. The bundle wins wherever it speaks; these
 * are the same numbers, frozen (`animations/AnimationStates*.con` after
 * `3pAnimationsTweaking.con`).
 */
export const VANILLA_STATES = Object.freeze({
  'stand.lower': { morph: 2.0 }, 'walk.lower': { morph: 2.0 },
  'run.lower': { morph: 2.0 }, 'crouch.lower': { morph: 2.0 },
  'crouchwalk.lower': { morph: 2.0 }, 'lie.lower': { morph: 2.0 },
  'crawl.lower': { morph: 2.0 },
  'stand.upper': { morph: 0.7 }, 'crouch.upper': { morph: 0.7 },
  'lie.upper': { morph: 0.7 }, 'walk.upper': { morph: 0.5 },
  'run.upper': { morph: 0.5 }, 'crouchwalk.upper': { morph: 0.5 },
  'crawl.upper': { morph: 0.5 },
  Lb_StandToCrouch: { speed: 12, loop: false, morph: 2.0, then: 'Lb_Crouch', pose: 'crouch' },
  Lb_CrouchToStand: { speed: -10, loop: false, morph: 2.0, then: 'Lb_Stand' },
  Lb_StandToLie: { speed: 6, loop: false, morph: 2.0, then: 'Lb_CrouchToLie', pose: 'prone' },
  Lb_CrouchToLie: { speed: 1.6, loop: false, morph: 4.0, then: 'Lb_Lie', pose: 'prone' },
  // `rem AnimationStateMachine.setFlag c_AsmIsLying`: getting up to the
  // crouch is crouching from its first frame.
  Lb_LieToCrouch: { speed: -2, loop: false, morph: 4.0, then: 'Lb_Crouch', pose: 'crouch' },
  Lb_LieToStand: { speed: -3, loop: false, morph: 2.0, then: 'Lb_CrouchToStand', pose: 'prone' },
  Lb_RunStandToLie: { speed: 1.4, loop: false, morph: 4.0, then: 'Lb_Lie', pose: 'prone' },
  // The torso transitions with no clip, which still say what comes next.
  Ub_StandToCrouch: { morph: 2.0, then: 'Ub_Crouch' },
  Ub_CrouchToStand: { morph: 2.0, then: 'Ub_StandAim' },
  Ub_StandToLie: { morph: 2.0, then: 'Ub_CrouchToLie' },
  Ub_CrouchToLie: { speed: 1.6, loop: false, morph: 4.0, then: 'Ub_Lie' },
  Ub_LieToCrouch: { speed: -2, loop: false, morph: 4.0, then: 'Ub_Crouch' },
  Ub_LieToStand: { speed: -3, loop: false, morph: 4.0, then: 'Ub_CrouchToStand' },
  Ub_RunStandToLie: { speed: 1.4, loop: false, morph: 4.0, then: 'Ub_Lie' },
  Ub_StandReload: { loop: false, morph: 10000, then: '_POSE_' },
  Ub_LieReload: { loop: false, morph: 10000, then: '_POSE_' },
  // `animations/AnimationStatesSwim.con`, after `3pAnimationsTweaking.con`
  // (`set3pAnimationSpeed Lb_StartSwim 2.60`). Every one is `setMorphFactor
  // 4.0` but `Ub_EndSwim`'s 1.0, so the stroke, the float and the way in and
  // out are all a quarter-second morph from wherever the bones stood.
  Lb_StartSwim: { speed: 2.6, loop: false, morph: 4.0, then: 'Lb_SwimForward' },
  Ub_StartSwim: { speed: 2.6, loop: false, morph: 4.0, then: 'Ub_SwimForward' },
  Lb_Floating: { speed: 0.4, loop: true, morph: 4.0 },
  Ub_Floating: { speed: 0.4, loop: true, morph: 4.0 },
  Lb_SwimForward: { speed: 1.0, loop: true, morph: 4.0, then: 'Lb_Floating' },
  Ub_SwimForward: { speed: 1.0, loop: true, morph: 4.0, then: 'Ub_Floating' },
  Lb_SwimBackward: { speed: 1.0, loop: true, morph: 4.0, then: 'Lb_Floating' },
  Ub_SwimBackward: { speed: 1.0, loop: true, morph: 4.0, then: 'Ub_Floating' },
  Lb_EndSwim: { speed: -3.2, loop: false, morph: 4.0, then: 'Lb_Stand' },
  Ub_EndSwim: { speed: -3.2, loop: false, morph: 1.0, then: 'Ub_Stand' },
});

/** `AnimationState`'s constructor default (lnxded `0x08328bf8`). */
export const DEFAULT_MORPH = 5.0;
/** Above this a state is entered at full weight (`.rodata` 1000.0 at
 *  `0x0832b481`): a cut, not a blend. */
export const MORPH_CUT = 1000;
/** Die states: `setMorphFactor 20` on all but the seated and free-fall ones. */
export const DIE_MORPH = 20;

/**
 * The key for `STANCE_ENTRY`. `backward` is the engine's dive test: the
 * forward input times the current state's own forward speed below zero
 * (`fStack_268 < 0`), which for every stand/walk/run state (`setSpeed 1.0`)
 * is the input's sign.
 */
export function stanceEntryKey(from, to, backward = false) {
  const key = `${from}>${to}`;
  return key === 'stand>prone' && backward ? 'stand>prone backward' : key;
}

/**
 * The two half-bodies' state machines for one drawn soldier.
 *
 * `rig`:
 *   `has(name)`       a clip of that name is bound on this body
 *   `info(name)`      `{ morph, then, loop, speed }` for a clip or a clipless
 *                     state, or null (`VANILLA_STATES` fills the gaps)
 *   `duration(name)`  seconds one pass of a bound clip lasts at the weapon's
 *                     own rate
 *
 * Drive it once a frame with `update({ stance, family, trigger }, dt)`; it
 * returns the states entered since the last call as `{ half, name, morph }`,
 * in order, for the renderer to switch and to start the morph from the bones
 * as they stand.
 */
export class SoldierActions {
  constructor(rig) {
    this.rig = rig;
    this.stance = 'stand';
    this.family = 'stand';
    this.trigger = false;
    this.dead = false;
    /** The lower swim state both halves are held in, or null when dry. */
    this.swim = null;
    this.lower = { half: 'lower', name: null, base: true, time: 0, duration: 0, loop: true, action: null };
    this.upper = { half: 'upper', name: null, base: true, time: 0, duration: 0, loop: true, action: null };
    this.entries = [];
  }

  info(name) {
    return this.rig.info?.(name) ?? VANILLA_STATES[name] ?? null;
  }

  morphOf(name) {
    const m = this.info(name)?.morph;
    return Number.isFinite(m) ? m : DEFAULT_MORPH;
  }

  /** The base clip a half plays for the current family. */
  baseClip(h) {
    return FAMILY_HALVES[this.family]?.[h.half] ?? FAMILY_HALVES.stand[h.half];
  }

  /** Walk a state name through clipless states and base markers to what the
   *  half can actually play: `{ name }`, or `{ base: true }`. */
  resolve(name) {
    for (let guard = 0; guard < 8; guard++) {
      if (!name || BASE_STATES.has(name)) return { base: true };
      if (this.rig.has(name)) return { name };
      const next = this.info(name)?.then;
      if (!next || next === name) return { base: true };
      name = next;
    }
    return { base: true };
  }

  enterBase(h, force = false) {
    const name = this.baseClip(h);
    if (!force && h.base && h.name === name) return;
    h.name = name;
    h.base = true;
    h.time = 0;
    h.loop = true;
    h.action = null;
    this.entries.push({ half: h.half, name, morph: this.morphOf(name) });
  }

  enter(h, name, action = null) {
    const r = this.resolve(name);
    if (r.base) { this.enterBase(h, true); return; }
    const info = this.info(r.name);
    h.name = r.name;
    h.base = false;
    h.time = 0;
    h.loop = !!info?.loop;
    h.duration = this.rig.duration?.(r.name) ?? 0;
    h.action = action ?? actionOf(r.name);
    this.entries.push({ half: h.half, name: r.name, morph: this.morphOf(r.name) });
  }

  /**
   * The pose the legs hold the soldier in: `BFSoldier::getPose` (lnxded
   * `0x0827ddc0`) is the lower machine's current state's `c_AsmIsCrouching`
   * / `c_AsmIsLying` flags, so a transition is the pose its flags say --
   * `Lb_LieToStand` still lies, `Lb_LieToCrouch` already crouches.
   */
  bodyPose() {
    const h = this.lower;
    if (!h.name) return this.stance;
    const pose = this.info(h.name)?.pose;
    if (pose) return pose;
    if (h.base) {
      const family = Object.keys(FAMILY_HALVES).find(f => FAMILY_HALVES[f].lower === h.name);
      return FAMILY_POSE[family] ?? 'stand';
    }
    return 'stand';
  }

  /** The soldier's stance changed between two world ticks. `backward`: he
   *  was moving backward, which turns a dive into the plain lie-down.
   *  `family` is the gait family of the new stance (its still one when not
   *  given), so a torso whose transition has no clip lands on the right loop.
   *
   *  The chain starts from the pose the BODY is in (`bodyPose`), not from the
   *  stance the soldier left: the engine keys it on the lower state's flags.
   *  So a stance that comes straight back -- prone, a tick standing, prone
   *  again, which the bots' behaviour loop does when Change wins a single
   *  tick of a fight -- finds the legs still lying in `Lb_LieToStand` and
   *  settles back into the lie loop by the morph, instead of standing up and
   *  diving again. */
  stanceChanged(from, to, { backward = false, family = null } = {}) {
    if (this.dead || from === to) return;
    this.stance = to;
    this.family = family ?? STILL_FAMILY[to] ?? 'stand';
    // The swim states hold both machines; a stance the tick changed under
    // them starts no chain (the body is posed standing in the water).
    if (this.swim) return;
    const pose = this.bodyPose();
    if (pose === to) {
      if (!this.lower.base) this.enterBase(this.lower, true);
      if (this.upper.action === 'move' && !this.upper.base) this.enterBase(this.upper, true);
      return;
    }
    const entry = STANCE_ENTRY[stanceEntryKey(pose, to, backward)];
    if (!entry) return;
    this.enter(this.lower, entry.lower, 'move');
    // `isReadyToUse`: a reload in progress keeps the torso.
    if (this.upper.action !== 'reload') this.enter(this.upper, entry.upper, 'move');
  }

  /** A round left the weapon this body holds. */
  fire() {
    // `c_AsmHideWeapon`: a swimmer has no item to fire (`swim.js`
    // `itemsLocked`), so no torso fire either.
    if (this.dead || this.swim) return;
    const u = this.upper;
    // The transition states take no `c_PIFire`; the round flies, the torso
    // finishes lying down.
    if (u.action === 'move' && !u.base) return;
    const name = this.stance === 'prone' ? 'Ub_LieFire' : 'Ub_Fire';
    if (!this.rig.has(name)) return;
    // An automatic already firing keeps its loop running.
    if (u.name === name && u.loop && !u.base) return;
    this.enter(u, name, 'fire');
  }

  /** The weapon began a reload. */
  reload() {
    if (this.dead || this.swim) return;
    const name = this.stance === 'prone' ? 'Ub_LieReload' : 'Ub_StandReload';
    if (!this.rig.has(name)) return;
    this.enter(this.upper, name, 'reload');
  }

  /** The killing blow: both halves to the death `soldier-death.js` chose. */
  die(lowerName, upperName) {
    this.dead = true;
    this.swim = null;
    for (const [h, name] of [[this.lower, lowerName], [this.upper, upperName]]) {
      if (!name || !this.rig.has(name)) continue;
      const info = this.info(name);
      h.name = name;
      h.base = false;
      h.time = 0;
      h.loop = false;
      h.duration = Infinity;            // a corpse holds its last frame
      h.action = 'die';
      this.entries.push({ half: h.half, name,
                          morph: Number.isFinite(info?.morph) ? info.morph : DIE_MORPH });
    }
  }

  /**
   * The swim states, set on both machines by name.
   *
   * `BFSoldier::updateSwimming` (lnxded `0x08282190`) enters `Lb_StartSwim` /
   * `Ub_StartSwim` with `setAnimationState` (`0x082823f7`, `0x08282426`) and
   * leaves by `Lb_EndSwim` / `Ub_EndSwim`; between the two the states' own
   * `addTransitionOne c_PIThrottle 0.5 1` / `-1 -0.5` and `returnToState
   * Lb_Floating` pick the stroke or the tread. `swim.js` `SwimState` runs that
   * whole machine -- the throttle bands and the two one-shot timers -- per
   * tick, and its `clips()` pair is what arrives here: this follows it rather
   * than running a second copy of the timers, and each state is entered with
   * its own morph (4.0; `Ub_EndSwim` 1.0) from the bones as they stand.
   *
   * `pair` is `{ lower, upper }` or null. Null after a swim drops both halves
   * back to the base, which is `Lb_EndSwim`'s `addTransitionWhenDone Lb_Stand`.
   * A tree with no `swim.gait.glb` binds none of the names: the halves stay on
   * whatever the gait asks for.
   */
  followSwim(pair) {
    const lower = pair?.lower ?? null;
    if (lower === this.swim) return;
    const was = this.swim;
    this.swim = lower && this.rig.has(lower) ? lower : null;
    if (this.swim) {
      for (const [h, name] of [[this.lower, pair.lower], [this.upper, pair.upper]]) {
        if (!this.rig.has(name)) { this.enterBase(h, true); continue; }
        const info = this.info(name);
        h.name = name;
        h.base = false;
        h.time = 0;
        h.loop = !!info?.loop;
        h.duration = Infinity;          // `swim.js` ends the one-shots, not this
        h.action = 'swim';
        this.entries.push({ half: h.half, name, morph: this.morphOf(name) });
      }
      return;
    }
    if (was) {
      this.enterBase(this.lower, true);
      this.enterBase(this.upper, true);
    }
  }

  /**
   * One frame: take the stance, gait family, trigger and swim pair the page
   * simulated, run each half's one-shots out and follow their `then`, and
   * return the states entered (`{ half, name, morph }`) since the last call.
   */
  update({ stance = this.stance, family = this.family, trigger = false, swim = null } = {},
         dt = 0) {
    this.stance = stance;
    this.family = family;
    this.trigger = !!trigger;
    if (!this.dead) this.followSwim(swim);
    for (const h of [this.lower, this.upper]) {
      if (h.action === 'swim' && this.swim) { h.time += dt; continue; }
      if (h.name === null) { this.enterBase(h, true); continue; }
      if (this.dead) continue;
      if (h.base) { this.enterBase(h); continue; }
      h.time += dt;
      if (h.loop) {
        // An automatic's fire: `returnToState _POSE_` once the trigger lets go.
        if (h.action === 'fire' && !this.trigger) this.enter(h, this.info(h.name)?.then ?? '_POSE_');
        continue;
      }
      // A pass ends on the frame its phase passes 1 (`AnimationState::update`);
      // the epsilon keeps six sixtieths from summing to just under a tenth.
      if (h.time >= h.duration - 1e-9) this.enter(h, this.info(h.name)?.then ?? '_POSE_');
    }
    const out = this.entries;
    this.entries = [];
    return out;
  }
}

/** What an upper state is, for the rules that ask: a reload (the bolt after a
 *  rifle's shot counts) keeps the torso through a stance change. */
function actionOf(name) {
  if (/Reload$/.test(name)) return 'reload';
  if (/Fire(End)?$/.test(name)) return 'fire';
  return 'move';
}

/**
 * The engine's morph for one half, as numbers: `update` it once a frame after
 * the mixer has posed the half's bones from the new state's clip, and each
 * bone becomes `slerp(where it was, the clip, w)`, `w` starting at 0 on the
 * frame the state is entered and gaining `dt x morph` a frame after.
 *
 * `bones` are `{ quaternion: {x,y,z,w}, position: {x,y,z} }` (three.js
 * `Object3D`s in the page, plain objects under node). Quaternions are
 * slerped the short way round, positions lerped.
 */
export class MorphBlend {
  constructor(bones) {
    this.bones = bones;
    this.q = new Float64Array(bones.length * 4);
    this.p = new Float64Array(bones.length * 3);
    this.w = 1;
    this.rate = 0;
    this.fresh = false;
  }

  /** A state was entered: remember the bones as they stand, before the mixer
   *  poses them from the new clip. */
  enter(morph) {
    if (!(morph < MORPH_CUT)) { this.w = 1; this.fresh = false; return; }
    this.capture();
    this.w = 0;
    this.rate = morph;
    this.fresh = true;
  }

  capture() {
    const { q, p } = this;
    this.bones.forEach((b, i) => {
      q[i * 4] = b.quaternion.x; q[i * 4 + 1] = b.quaternion.y;
      q[i * 4 + 2] = b.quaternion.z; q[i * 4 + 3] = b.quaternion.w;
      p[i * 3] = b.position.x; p[i * 3 + 1] = b.position.y; p[i * 3 + 2] = b.position.z;
    });
  }

  /** After the mixer: carry the bones from the remembered pose toward the
   *  clip's by this frame's weight. */
  update(dt) {
    if (this.w >= 1) return this.w;
    if (this.fresh) this.fresh = false;
    else this.w = Math.min(1, this.w + dt * this.rate);
    const w = this.w;
    const { q, p } = this;
    this.bones.forEach((b, i) => {
      const o = i * 4;
      slerpInto(b.quaternion, q[o], q[o + 1], q[o + 2], q[o + 3], w);
      const bp = b.position;
      bp.x = p[i * 3] + (bp.x - p[i * 3]) * w;
      bp.y = p[i * 3 + 1] + (bp.y - p[i * 3 + 1]) * w;
      bp.z = p[i * 3 + 2] + (bp.z - p[i * 3 + 2]) * w;
    });
    // The result is where the bones stand now: the next frame starts here.
    this.capture();
    return w;
  }
}

/** `target = slerp(from, target, t)`, the short way round. */
function slerpInto(target, fx, fy, fz, fw, t) {
  let tx = target.x, ty = target.y, tz = target.z, tw = target.w;
  let cos = fx * tx + fy * ty + fz * tz + fw * tw;
  if (cos < 0) { tx = -tx; ty = -ty; tz = -tz; tw = -tw; cos = -cos; }
  let a, b;
  if (cos > 0.9995) {
    a = 1 - t; b = t;
  } else {
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    a = Math.sin((1 - t) * theta) / sin;
    b = Math.sin(t * theta) / sin;
  }
  let x = fx * a + tx * b, y = fy * a + ty * b, z = fz * a + tz * b, w = fw * a + tw * b;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len; y /= len; z /= len; w /= len;
  if (typeof target.set === 'function') target.set(x, y, z, w);
  else { target.x = x; target.y = y; target.z = z; target.w = w; }
}
