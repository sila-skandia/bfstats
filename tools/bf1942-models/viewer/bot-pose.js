// A bot soldier's pose: the variable pose a plan statement computes, and how
// the bot's pose request reaches the soldier. Read 2026-09-24 from
// bf1942_lnxded.static (ledger BODY-10..BODY-13; features/bot-stance-variety).
//
//  * `BAPAComponentSoldierPose` (ctor 0x0853ed10, `computeCurrentPose`
//    0x0853efa0) is a normal, a danger and an incoming-fire pose, a
//    fire-objects threshold (the ctor stores `threshold x (1 + 5 x rand)`),
//    a control threshold clamped to [-1, 1] and a duration. It decides again
//    at most once a duration: the danger pose when `fire` is above the
//    threshold, else the normal pose when `control` is at least the control
//    threshold, else the incoming-fire pose. On a deciding tick, water deeper
//    than 0.4 m (`getWaterLevel` minus `getHeight` at the bot's x, z; the
//    constant is 0x86c4f70) stands the soldier up, and any water turns a
//    prone pick into a crouch. The water rule runs only on a deciding tick.
//
//  * Who carries one, and its arguments:
//      - `BAPASoldierPose(normal, danger, int threshold, incoming, control,
//        run, break)` 0x08548a00: the plan's SoldierPose statement, duration
//        5.0. Scout builds (stand, prone, trunc(1 + 9 x rand), crouch, 0)
//        (`BBPScoutInfantery::createPlan` 0x085c5070, call 0x085c55bc; the
//        fistp runs under a truncating control word, 0x085c557c); TakeCover
//        with a cover object (stand, prone, 5, crouch, 0) beside its move
//        (`BBPTakeCoverInfantry::createPlan` 0x085c97d0, call 0x085ca6ac).
//      - The fixed `BAPASoldierPose(pose, ...)` 0x08548770 / 0x08548810
//        passes the one pose three times, threshold 2.0: only the water rule
//        moves it.
//      - Every move: `BAPAMoveTo::BAPAMoveTo` 0x08540350 builds (stand,
//        prone, 1 + 14 x rand, crouch, 0, 10.0 s) (call 0x08540480, 14.0 at
//        0x86ffd78); `BAPAMoveToDirection` (stand, prone, 1.0, crouch, 0,
//        5.0 s) (call 0x0854333b).
//
//  * What they are fed (the callers are virtual, `call *0x3c` on the
//    component): `EntrySoldierPose::execute` 0x08622bb0 passes `fire` =
//    `BotMain::getAttackerStrength` 0x0852f1c0 (bot-sense.js
//    `attackerStrength`) and `control` = `BFEnvironment::getSecurity(Bot*)`
//    0x085e6000 (IAIEnvironment vt+0x70), and requests the pose only while
//    the soldier's differs. The infantry move entries (`EntryInfanteryMoveTo`
//    0x08616270, `...ToObject` 0x086176a0, `...ToDirection` 0x08616780,
//    `EntryMoveToMediumSoldier` 0x0861cb30, `EntryMoveToObjectMediumSoldier`
//    0x0861ecc0) pass the same `fire` and `control` = `getControl(Bot*)`
//    0x085e60a0 (vt+0x78), and request on every tick they steer.
//    `getSecurity` is the security of the strategic area the SAI holds the
//    bot in (`SAI::getBotCurrentPos` 0x08636490 -> `getSecurity(int, int)`
//    0x085e6060, the area's +0xac + side x 4), 1.0 in none; only the
//    `AIStrategicObject` ctor writes that slot (0 at 0x08643441 / 0x0864344b).
//    `getControl` is the area's friendly / (friendly + hostile) strength
//    (`AIStrategicArea::update` 0x0863dd5c), 0 in none or with no strength.
//    Neither falls below the builders' control threshold 0, so the
//    incoming-fire pose is never taken in the retail game: the component
//    stands, lies down when the fire passes its threshold, and crouches only
//    in shallow water.
//
//  * The request: `BotMain::requestSoldierPose` 0x0852e910 stores the pose
//    (+0x1cc) only while no change is in flight (+0x1d4 clear). At the end
//    of every `planExecution` 0x085202c0 (call 0x08520479),
//    `pollRequestedSoldierPose` 0x0852e930 applies it: a request for any
//    pose but prone waits until 10.0 s (0x86b9314) after the last change it
//    pressed (+0x1d0, -FLT_MAX at construction 0x0851d380); prone is never
//    held back. A change presses the keys (crouch is held, lie is a toggle),
//    stamps the time and sets the in-flight flag, which clears once the
//    soldier's pose matches. No reset touches the pose: `infanteryResetControls`
//    0x08627740 never writes the crouch or lie channel, and `resetAllControls`
//    0x08526650 releases them only for a dead bot or a unit without soldier
//    poses. So a bot that drops prone stays down at least 10 s, and nothing a
//    plan asks for in a single tick can stand it up.
//
// INVENTION, labelled: the rand draw is the bot's own generator, not
// `dice::ref2::Rand`'s LCG; the viewer holds the pose as a level on its input
// word where the engine presses keys, so a change is "pressed" by holding the
// new pose; the ammunition half of a fire object's strength (bot-perception.js)
// is taken as full.

import { EYE_HEIGHT, POSE_STAND, POSE_CROUCH, POSE_PRONE } from './soldier-pose.js';

/** The AI's `SoldierPose` enum (1 stand, 2 crouch, 3 prone), by name. */
export const SOLDIER_POSE = Object.freeze({ stand: 1, crouch: 2, prone: 3 });

/** The eye over the feet per pose name: `setPoseCameraPos` through the
 *  soldier's matrix (`AIObject::getSoldierPoseCameraPosition` 0x085d2200,
 *  soldier-pose.js `EYE_HEIGHT`): 1.65 / 1.12 / 0.30 m. */
export const POSE_EYE = Object.freeze({
  stand: EYE_HEIGHT[POSE_STAND], walk: EYE_HEIGHT[POSE_STAND],
  crouch: EYE_HEIGHT[POSE_CROUCH], prone: EYE_HEIGHT[POSE_PRONE],
});

export const POSE_COMPONENT = Object.freeze({
  /** `threshold x (1 + 5 x rand)` (0x0853ed10). */
  thresholdSpread: 5.0,
  /** The control threshold is clamped to [-1, 1]. */
  controlLimit: 1.0,
  /** Water deeper than this stands the soldier up (0x86c4f70). */
  standDepth: 0.4,
  /** `BAPASoldierPose`'s component duration (0x40a00000). */
  statementDuration: 5.0,
  /** `BAPAMoveTo`'s (0x41200000 at 0x0854045e). */
  moveDuration: 10.0,
  /** `BAPAMoveToDirection`'s (0x0854332d). */
  directionDuration: 5.0,
  /** Scout: `trunc(1 + 9 x rand)` (9.0 at 0x86c08cc). */
  scoutSpread: 9.0,
  /** TakeCover with a cover object: `push 5` (0x085ca6ac). */
  takeCoverThreshold: 5,
  /** A move: `1 + 14 x rand` (14.0 at 0x86ffd78). */
  moveSpread: 14.0,
  /** `BAPAMoveToDirection`: 1.0. */
  directionThreshold: 1.0,
  /** The fixed pose's threshold (0x40000000). */
  fixedThreshold: 2.0,
});

/** `pollRequestedSoldierPose`: a pose other than prone only this long after
 *  the last change pressed (10.0 at 0x86b9314). */
export const POSE_CHANGE_GATE = 10.0;

/** `BAPAComponentSoldierPose`. Poses are names: 'stand', 'crouch', 'prone'. */
export class SoldierPoseComponent {
  constructor({ normal = 'stand', danger = 'prone', threshold, incoming = 'crouch', control = 0,
                duration = POSE_COMPONENT.statementDuration, random = Math.random } = {}) {
    this.normal = normal;                      // +4
    this.danger = danger;                      // +8
    // +0xc: `threshold + u x threshold x 5`, u = ((rand >> 7 | 1) + 1) / 2^24.
    this.fireThreshold = threshold * (1 + POSE_COMPONENT.thresholdSpread * random());
    this.incoming = incoming;                  // +0x10
    this.current = normal;                     // +0x14
    const lim = POSE_COMPONENT.controlLimit;
    this.controlThreshold = control < -lim ? -lim : control > lim ? lim : control;   // +0x18
    this.duration = duration;                  // +0x1c
    this.decidedAt = -Infinity;                // +0x20, -FLT_MAX
  }

  /**
   * `computeCurrentPose(fire, control, now, pos)` 0x0853efa0. `waterDepth`
   * is the water level less the terrain height at the bot's (x, z), what the
   * engine reads through `IAIEnvironment` vt+0xb4 / vt+0x9c (-Infinity where
   * there is no water). The comparisons keep the x87's unordered sense: a NaN
   * fire never passes the threshold, a NaN control takes the normal pose.
   */
  computeCurrentPose(fire, control, now, waterDepth = -Infinity) {
    if (this.duration > now - this.decidedAt) return this.current;
    this.decidedAt = now;
    this.current = fire > this.fireThreshold ? this.danger
      : this.controlThreshold > control ? this.incoming : this.normal;
    if (waterDepth > POSE_COMPONENT.standDepth) this.current = 'stand';
    else if (waterDepth > 0 && this.current === 'prone') this.current = 'crouch';
    return this.current;
  }
}

/** Scout's statement (0x085c55bc). */
export function scoutPose(random = Math.random) {
  const threshold = Math.trunc(1 + POSE_COMPONENT.scoutSpread * random());
  return new SoldierPoseComponent({ threshold, random });
}

/** TakeCover's statement beside the move to a cover object (0x085ca6ac). */
export function takeCoverPose(random = Math.random) {
  return new SoldierPoseComponent({ threshold: POSE_COMPONENT.takeCoverThreshold, random });
}

/** A move's own component (`BAPAMoveTo::BAPAMoveTo` 0x08540350). */
export function movePose(random = Math.random) {
  return new SoldierPoseComponent({ threshold: 1 + POSE_COMPONENT.moveSpread * random(),
                                    duration: POSE_COMPONENT.moveDuration, random });
}

/** `BAPAMoveToDirection`'s component (0x0854333b). */
export function directionPose(random = Math.random) {
  return new SoldierPoseComponent({ threshold: POSE_COMPONENT.directionThreshold,
                                    duration: POSE_COMPONENT.directionDuration, random });
}

/** The fixed `BAPASoldierPose(pose)` (0x08548770): one pose three times. */
export function fixedPose(pose, random = Math.random) {
  return new SoldierPoseComponent({ normal: pose, danger: pose, incoming: pose,
                                    threshold: POSE_COMPONENT.fixedThreshold, random });
}

/**
 * The `control` the statements are fed. `getSecurity` (the SoldierPose
 * statement) is 0 in a strategic area and 1.0 in none; `getControl` (a move)
 * is the area's friendly share of strength, 0 in none. Both are at least the
 * builders' threshold of 0 wherever the bot stands, so the value that reaches
 * the comparison never changes the pose; the viewer passes the area value 0
 * rather than tracking which area the SAI holds the bot in.
 */
export const POSE_CONTROL = Object.freeze({ security: 0, control: 0 });

/**
 * The water under the bot: the level's water plane less the terrain height
 * at its (x, z) (`BFEnvironment::getWaterLevel` 0x085e5160 and `getHeight`
 * 0x085e5080, both the terrain's). -Infinity on a level without water.
 */
export function waterDepthAt(collider, x, z) {
  const water = collider?.waterLevel;
  if (!Number.isFinite(water)) return -Infinity;
  const ground = collider?.heightfield?.height?.(x, z);
  return Number.isFinite(ground) ? water - ground : -Infinity;
}

/**
 * `BotMain`'s pose request (+0x1cc), the time of the last change it pressed
 * (+0x1d0) and the in-flight flag (+0x1d4), with `requestSoldierPose` and
 * `pollRequestedSoldierPose`. `held` is the pose the bot's input holds.
 */
export class PoseRequests {
  constructor() { this.reset(); }

  /** The `BotMain` ctor's state (0x0851d46e..0x0851d48f). */
  reset() {
    this.requested = 'stand';
    this.changedAt = -Infinity;
    this.inFlight = false;
    this.held = 'stand';
  }

  /** `requestSoldierPose` 0x0852e910: taken only with no change in flight. */
  request(pose) {
    if (!this.inFlight && (pose === 'stand' || pose === 'crouch' || pose === 'prone')) this.requested = pose;
  }

  /**
   * `pollRequestedSoldierPose` 0x0852e930, once a tick after the plan ran.
   * `current` is the soldier's pose now. Returns the pose to hold.
   */
  poll(now, current) {
    // 0x0852e959..0x0852e986: anything but prone, with nothing in flight,
    // waits out the gate (`last + 10 > now` jumps to 0x0852ec70, which lets
    // go of the lie key and changes nothing).
    if (this.requested !== 'prone' && !this.inFlight && this.changedAt + POSE_CHANGE_GATE > now) return this.held;
    if (current !== 'stand' && current !== 'crouch' && current !== 'prone') {
      // 0x0852e9e7: a pose the machine does not know resets the request.
      this.requested = 'stand';
      this.inFlight = false;
      return this.held;
    }
    if (current === this.requested) {
      this.inFlight = false;                    // 0x0852e9f1
      this.held = current;
      return this.held;
    }
    // A change: the keys pressed, the time stamped, in flight (0x0852ea8d).
    this.held = this.requested;
    this.changedAt = now;
    this.inFlight = true;
    return this.held;
  }
}
