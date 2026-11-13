// The client's `SoldierSound`: which of a soldier's movement scripts plays,
// and when.
//
// `Objects/Soldiers/Common/Sounds/SoldierSound.inc` loads 26 sound scripts on
// the soldier, in an order the engine indexes them by, and sets the cadences.
// Every frame `BFSoldier::updateSound` (lnxded 0x0827dfe0) hands the
// soldier's `SoldierSound` (`+0x4f8`) the frame's seconds, the soldier's
// sound and one trigger id: `BFSoldier::getSoundTrigger` (0x08276f40), the
// `setSoundTrigger` of the lower body's current animation state, or the upper
// body's when the lower declares none. `SoldierSound::update` (BF1942.exe
// 0x00572f20; the Mac client names it) advances ten timers (0x00572ad0), asks
// `triggerSound` (0x00572b40) whether this trigger sounds now, and if so
// plays script `trigger - 1`:
//
//   triggers 1, 2, 3, 5   patch `material`, then patches 8 and 9
//   (stop, walk, run,     (0x00572fba: `+0x4c`, 8, 9). `material` is the
//    landing)             patch index `setMaterial` last stored.
//   trigger 0x17          patches 0, 8 and 9 (0x00572f90): a ladder is metal
//   (ladder)              whatever it stands on.
//   anything else         every patch of the script (0x00572faf).
//
// `triggerSound`, per trigger (the jump table at 0x00572e60):
//
//   0          nothing; the soldier counts as on the ground (`+0x50`).
//   1 stand    when it is not the trigger of the frame before and more than
//              `standFrequency` (1.5 s) has passed since the last stop.
//   2 walk     a cadence: when the walk timer passes its interval, play and
//   3 run      re-roll the interval to `frequency + randomFrequency * rand`,
//   8 crouch   `rand` in 0..1 (`rand() * 3.0518509e-05`, 0x008f69cc). Walk
//   0xb crawl  and run are silent in the air (`+0x51`); the others are not
//   0xd swim   gated on it. An interval starts at 0 (constructor
//   0x17 ladder 0x00572eb0), so the first step of a life sounds at once.
//   0x13 hurt  the same cadence shape on `hitDamageFrequency` (SND-48).
//   5 landing  at most once a second (1.0, 0x008c53c8).
//   0x1a ammo  at most once every 3 s (3.0, 0x008eaf04).
//   0x18 voice always.
//   the rest   on the frame the trigger changes (0x00572e39). A jump (4)
//              that starts on the ground puts the soldier in the air.
//
// The landing is not an animation state. `BFSoldier::handleCollision`
// (lnxded 0x0827d3b0) calls `setMaterial` (0x00572fe0) on every contact whose
// normal points up by more than 0.65 (the double at 0x086d2728) on a material
// other than 99; that stores the material's patch and sets `+0x52`. A soldier
// in the air who has such a contact has the frame's trigger replaced by 5
// (0x00572b44..0x00572b5a). Only a jump puts him in the air, so walking off a
// ledge lands without a sound.
//
// The heal is not a state either: `BFSoldier::handleDamage` (lnxded
// 0x08270f40..0x08270faf) raises trigger 0x16 itself when the damage is
// negative and the soldier's hit points are not at their maximum.
//
// This module is that machine and the trigger a body of the page is in. It
// imports nothing, so the tests run it under node.

/** The `c_Sst*` ids: a script's 1-based place in `SoldierSound.inc`'s
 *  `loadSoundScript` list. */
export const SST = Object.freeze({
  None: 0,
  Stand: 1,
  Walk: 2,
  Run: 3,
  Jump: 4,
  JumpLand: 5,
  ToCrouch: 6,
  FromCrouch: 7,
  CrouchMove: 8,
  ToCrawl: 9,
  StandUp: 10,
  CrawlMove: 11,
  ToSwim: 12,
  Swim: 13,
  SwimStand: 14,
  FromSwim: 15,
  OpenParachute: 16,
  FallingHigh: 17,
  ParachuteLand: 18,
  HitDamage: 19,
  FFHitDamage: 20,
  Killed: 21,
  HealedByMedic: 22,
  ClimbLadder: 23,
  Voice: 24,
  Charge: 25,
  RefillAmmo: 26,
});

const NAMES = Object.freeze(Object.fromEntries(
  Object.entries(SST).map(([name, id]) => [id, `c_Sst${name}`])));
const IDS = Object.freeze(Object.fromEntries(
  Object.entries(SST).map(([name, id]) => [`c_Sst${name}`.toLowerCase(), id])));

/** `c_SstRun` for 3. */
export function triggerName(id) { return NAMES[id] ?? null; }
/** 3 for `c_SstRun`; 0 for a name the engine has no trigger of. */
export function triggerId(name) { return IDS[String(name ?? '').toLowerCase()] ?? 0; }

/**
 * The cadences with no `SoldierSound.inc` read: the image's own initial
 * values (BF1942.exe 0x0095930c..0x0095933c; hit damage is in .bss, 0).
 */
export const ENGINE_FREQUENCIES = Object.freeze({
  stand: 1.5,
  run: 0.37, randomRun: 0.025,
  walk: 0.66, randomWalk: 0.04,
  swim: 0.66, randomSwim: 0.025,
  crouch: 0.66, randomCrouch: 0.025,
  crawl: 0.66, randomCrawl: 0.025,
  ladder: 0.66, randomLadder: 0.025,
  hitDamage: 0, randomHitDamage: 0,
});

/** Vanilla's `SoldierSound.inc`, for a tree whose manifest predates
 *  `frequencies`. */
export const VANILLA_FREQUENCIES = Object.freeze({
  stand: 1.5,
  run: 0.36, randomRun: 0.017,
  walk: 0.66, randomWalk: 0.04,
  swim: 1, randomSwim: 0.025,
  crouch: 0.50, randomCrouch: 0.04,
  crawl: 0.6, randomCrawl: 0.3,
  ladder: 0.46, randomLadder: 0.01,
  hitDamage: 1.0, randomHitDamage: 0.2,
});

/** Seconds between two landings (0x008c53c8) and two ammo refills (0x008eaf04). */
export const LAND_GATE = 1.0;
export const REFILL_GATE = 3.0;

/** `handleCollision`'s floor test: a contact normal's y over this (0x086d2728). */
export const CONTACT_NORMAL_Y = 0.65;

/** The patches `update` plays beside the material's: cloth and harness. */
export const EXTRA_PATCHES = Object.freeze([8, 9]);

/**
 * `addMaterialToSound` (BF1942.exe 0x00573020): the patch a material's sound
 * name selects. A name with none of the words is 11, a patch no script has.
 */
export const MATERIAL_PATCH = Object.freeze({
  sand: 0, metal: 1, wood: 2, concrete: 3, grass: 4, gravel: 5,
  ice: 6, frozen: 6, mud: 7, water: 10,
});

// trigger -> [timer, interval, frequency key, random key]
const CADENCE = Object.freeze({
  [SST.Walk]: ['walk', 'walk', 'randomWalk'],
  [SST.Run]: ['run', 'run', 'randomRun'],
  [SST.CrouchMove]: ['crouch', 'crouch', 'randomCrouch'],
  [SST.CrawlMove]: ['crawl', 'crawl', 'randomCrawl'],
  [SST.Swim]: ['swim', 'swim', 'randomSwim'],
  [SST.HitDamage]: ['hit', 'hitDamage', 'randomHitDamage'],
  [SST.ClimbLadder]: ['ladder', 'ladder', 'randomLadder'],
});

const MATERIAL_TRIGGERS = new Set([SST.Stand, SST.Walk, SST.Run, SST.JumpLand]);

/** One soldier's `SoldierSound`. */
export class SoldierSound {
  /**
   * `frequencies`: `soldier.json`'s (the mod's `SoldierSound.inc`), over the
   * image's defaults for any it lacks. `random`: 0..1.
   */
  constructor(frequencies = null, random = Math.random) {
    this.frequencies = { ...ENGINE_FREQUENCIES, ...(frequencies ?? {}) };
    this.random = random;
    this.reset();
  }

  reset() {
    // `+0x04`..`+0x28`: seconds since each sound last played.
    this.timers = { stand: 0, run: 0, walk: 0, swim: 0, crouch: 0, crawl: 0,
                    ladder: 0, hit: 0, refill: 0, land: 0 };
    // `+0x2c`..`+0x44`: the rolled interval each cadence waits out.
    this.intervals = { run: 0, walk: 0, swim: 0, crouch: 0, crawl: 0, ladder: 0, hit: 0 };
    this.last = SST.None;   // +0x48
    this.material = 0;      // +0x4c, a patch index
    this.onGround = true;   // +0x50
    this.inAir = false;     // +0x51
    this.contact = false;   // +0x52
  }

  /**
   * `setMaterial`: a floor contact this frame. `patch` is the material's
   * patch index, or null for a material `addMaterialToSound` never saw (the
   * stored patch stays).
   */
  setMaterial(patch = null) {
    if (Number.isInteger(patch)) this.material = patch;
    this.contact = true;
  }

  /**
   * One frame. Returns what to play, or null: `{ trigger, name, patches }`
   * with `patches` the script's patch indices to trigger, or null for all of
   * them. `'material'` in `patches` stands for the stored material's patch
   * when the caller resolves the floor itself.
   */
  update(dt, trigger) {
    const t = this.timers;
    if (dt > 0) for (const key in t) t[key] += dt;
    let id = trigger | 0;
    if (this.inAir && this.contact) {
      this.inAir = false;
      id = SST.JumpLand;
    }
    this.contact = false;
    const fired = this.#trigger(id);
    this.last = id;
    if (!fired) return null;
    let patches = null;
    if (MATERIAL_TRIGGERS.has(id)) patches = [this.material, ...EXTRA_PATCHES];
    else if (id === SST.ClimbLadder) patches = [0, ...EXTRA_PATCHES];
    return { trigger: id, name: triggerName(id), patches };
  }

  #trigger(id) {
    const t = this.timers, f = this.frequencies;
    const cadence = CADENCE[id];
    if (cadence) {
      const [key, freq, rand] = cadence;
      // Walk and run test the air first and leave `+0x50` alone when in it
      // (0x00572bc6, 0x00572c19).
      if ((id === SST.Walk || id === SST.Run) && this.inAir) return false;
      this.onGround = true;
      if (!(t[key] > this.intervals[key])) return false;
      t[key] = 0;
      this.intervals[key] = f[rand] * this.random() + f[freq];
      return true;
    }
    switch (id) {
      case SST.None:
        this.onGround = true;
        return false;
      case SST.Stand:
        this.onGround = true;
        if (id === this.last || !(t.stand > f.stand)) return false;
        t.stand = 0;
        return true;
      case SST.JumpLand:
        this.onGround = true;
        if (!(t.land > LAND_GATE)) return false;
        t.land = 0;
        return true;
      case SST.RefillAmmo:
        this.onGround = true;
        if (!(t.refill > REFILL_GATE)) return false;
        t.refill = 0;
        return true;
      case SST.Voice:
        return true;
      default:
        if (id === this.last) return false;
        if (id === SST.Jump && this.onGround) {
          this.inAir = true;
          this.onGround = false;
        }
        return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Which trigger a body is in.

/**
 * Vanilla's lower-body states that declare a movement trigger
 * (`animations/AnimationStates*.con`), for a tree whose manifest predates
 * `states`. The parachute's, the deaths' and the hurt grunt are played by
 * their own paths and answer 0 here.
 */
export const VANILLA_STATE_TRIGGERS = Object.freeze({
  Lb_Stand: SST.Stand, Lb_StandRelax: SST.Stand,
  Lb_WalkForward: SST.Walk, Lb_WalkBackward: SST.Walk,
  Lb_RunForward: SST.Run, Lb_RunBackward: SST.Run,
  Lb_StrafeLeft: SST.Run, Lb_StrafeRight: SST.Run,
  Lb_StandJump: SST.Jump, Lb_RunJump: SST.Jump, Lb_RunJumpBackward: SST.Jump,
  Lb_StandToCrouch: SST.ToCrouch, Lb_CrouchToStand: SST.FromCrouch,
  Lb_CrouchForward: SST.CrouchMove, Lb_CrouchBackward: SST.CrouchMove,
  Lb_CrouchStrafeRight: SST.CrouchMove, Lb_CrouchStrafeLeft: SST.CrouchMove,
  Lb_StandToLie: SST.ToCrawl, Lb_CrouchToLie: SST.ToCrawl,
  Lb_LieToCrouch: SST.StandUp,
  Lb_LieForward: SST.CrawlMove, Lb_LieBackward: SST.CrawlMove,
  Lb_LieTurnLeft: SST.CrawlMove, Lb_LieTurnRight: SST.CrawlMove,
  Lb_LieStrafeLeft: SST.CrawlMove, Lb_LieStrafeRight: SST.CrawlMove,
  Lb_StartSwim: SST.ToSwim, Lb_SwimForward: SST.Swim, Lb_SwimBackward: SST.Swim,
  Lb_Floating: SST.SwimStand, Lb_EndSwim: SST.FromSwim,
  Lb_ClimbLadder1: SST.ClimbLadder, Lb_ClimbLadder1B: SST.ClimbLadder,
  Lb_ClimbLadder2: SST.ClimbLadder, Lb_ClimbLadder2B: SST.ClimbLadder,
  Lb_ClimbLadderEnd1: SST.ClimbLadder, Lb_ClimbLadderEnd2: SST.ClimbLadder,
  Lb_ClimbLadderExit: SST.ClimbLadder,
});

/** The triggers this machine plays: the movement set and the heal. */
const MOVEMENT = new Set([
  SST.Stand, SST.Walk, SST.Run, SST.Jump, SST.JumpLand, SST.ToCrouch,
  SST.FromCrouch, SST.CrouchMove, SST.ToCrawl, SST.StandUp, SST.CrawlMove,
  SST.ToSwim, SST.Swim, SST.SwimStand, SST.FromSwim, SST.HealedByMedic,
  SST.ClimbLadder,
]);

/** True for a trigger `SoldierSound` plays here (not the page's own paths). */
export function isMovementTrigger(id) { return MOVEMENT.has(id); }

/**
 * The trigger a named lower-body state declares: a replayed soldier's
 * recorded state. `states` is `soldier.json`'s `states` (names), else
 * vanilla's.
 */
export function triggerOfState(state, states = null) {
  if (!state) return SST.None;
  const id = states ? triggerId(states[state]) : (VANILLA_STATE_TRIGGERS[state] ?? 0);
  return MOVEMENT.has(id) ? id : SST.None;
}

const SWIM_TRIGGER = Object.freeze({
  swimStart: SST.ToSwim, swimForward: SST.Swim, swimBackward: SST.Swim,
  swimFloat: SST.SwimStand, swimEnd: SST.FromSwim,
});

/**
 * The lower-body states a stance change passes through, as `[trigger,
 * seconds]`: each state's trigger and one pass of its clip at the state's
 * speed (`soldier-actions.js`, ANIM-2).
 *
 * The dive (`Lb_RunStandToLie`) and getting up off the ground
 * (`Lb_LieToStand`) declare no trigger, so a dive is silent and standing up
 * from prone sounds a third of a second late, as `Lb_CrouchToStand`.
 */
export const STANCE_STATES = Object.freeze({
  'stand>crouch': [[SST.ToCrouch, 1 / 12]],
  'crouch>stand': [[SST.FromCrouch, 1 / 10]],
  'stand>prone': [[SST.None, 1 / 1.4]],
  'stand>prone backward': [[SST.ToCrawl, 1 / 6 + 1 / 1.6]],
  'crouch>prone': [[SST.ToCrawl, 1 / 1.6]],
  'prone>crouch': [[SST.StandUp, 1 / 2]],
  'prone>stand': [[SST.None, 1 / 3], [SST.FromCrouch, 1 / 10]],
});

const GAIT_TRIGGER = Object.freeze({
  run: SST.Run, walk: SST.Walk, crouch: SST.CrouchMove, prone: SST.CrawlMove,
  crouchwalk: SST.CrouchMove, crawl: SST.CrawlMove,
});

/**
 * Follows one body from frame to frame and answers its trigger.
 *
 * `view` is what the caller knows of the body this frame:
 *   stance    'stand' | 'crouch' | 'prone'
 *   gait      'stand', or the moving gait: 'run' | 'walk' | 'crouch' |
 *             'prone' (`soldier.js`), or a clip family ('crouchwalk', 'crawl')
 *   swim      the swim family (`swim.js` `SwimState.family`), or null
 *   climbing  on a ladder; `climbY` his height up it (a change is a climb
 *             state, a still hand an idle one, which declares no trigger)
 *   jumping   the lower body is in a jump state (`walking-body.js`
 *             `lowerBody.jumping`)
 *   dive      a stand-to-prone change this frame is the dive
 *   backward  ...or the backward lie-down
 *   quiet     dead, seated or under a canopy: no trigger
 */
export class SoldierSoundState {
  constructor() { this.reset(); }

  reset() {
    this.stance = null;
    this.queue = [];
    this.climbY = null;
  }

  trigger(view, dt = 0) {
    const stance = view.stance ?? 'stand';
    const was = this.stance;
    this.stance = stance;
    if (view.quiet) {
      this.queue.length = 0;
      this.climbY = null;
      return SST.None;
    }
    if (view.climbing) {
      this.queue.length = 0;
      const y = view.climbY ?? 0;
      const moved = this.climbY !== null && Math.abs(y - this.climbY) > 1e-5;
      // A frame that ran no tick moved nothing: keep the last answer.
      if (dt > 0 || this.climbY === null) {
        this.climbMoving = moved;
        this.climbY = y;
      }
      return this.climbMoving ? SST.ClimbLadder : SST.None;
    }
    this.climbY = null;
    if (view.swim) {
      this.queue.length = 0;
      return SWIM_TRIGGER[view.swim] ?? SST.None;
    }
    if (was && was !== stance) {
      let key = `${was}>${stance}`;
      if (key === 'stand>prone' && view.backward && !view.dive) key += ' backward';
      this.queue = (STANCE_STATES[key] ?? []).map(([id, seconds]) => [id, seconds]);
    } else if (this.queue.length) {
      this.queue[0][1] -= dt;
      while (this.queue.length && this.queue[0][1] <= 0) {
        const over = this.queue.shift()[1];
        if (this.queue.length) this.queue[0][1] += over;
      }
    }
    if (this.queue.length) return this.queue[0][0];
    if (view.jumping) return SST.Jump;
    const moving = GAIT_TRIGGER[view.gait];
    if (moving) {
      // A crouched or lying body's moving gait is its stance's, whatever the
      // caller named it.
      if (stance === 'prone') return SST.CrawlMove;
      if (stance === 'crouch') return SST.CrouchMove;
      return moving === SST.Walk ? SST.Walk : SST.Run;
    }
    return stance === 'stand' ? SST.Stand : SST.None;
  }
}

/**
 * A layer's `Volume <- Distance` `Ramp p1 p2 v1 v2` at `distance` metres,
 * clamped at zero: the gain the script gives a voice that far off. 1 for a
 * layer with no ramp.
 */
export function distanceGain(ramp, distance) {
  if (!Array.isArray(ramp) || ramp.length < 4) return 1;
  const [p1, p2, v1, v2] = ramp;
  let v;
  if (!(distance > p1)) v = v1;
  else if (!(distance < p2) || !(p2 > p1)) v = v2;
  else v = v1 + (v2 - v1) * ((distance - p1) / (p2 - p1));
  return v > 0 ? v : 0;
}
