// A round's own motor: the `Engine` child a rocket carries, flown on the
// engine's own law instead of an invented ramp.
//
// A Refractor rocket is not a special kind of projectile. It is a projectile
// with an `addTemplate`d `Engine` (and usually a `Wing`), and the engine runs
// that Engine exactly as it runs a Spitfire's (ledger PHY-16..PHY-19, read on
// lnxded 2026-10-06; `features/rocket-flight/README.md` section 3):
//
//  1. **It is stepped like any vehicle engine.** `RotationalBundle`'s
//     constructor (`0x081d73d0`) sets object flag `0x1000`, which
//     `BObject::updateFlags` (`0x08193390`) turns into
//     `ObjectManager::addObjectToUpdate`, so `Engine::handleUpdate`
//     (`0x0823e120`) runs every tick from `ObjectManager::updateObjects`
//     (`0x0819be10`). `EngineTemplate::setPhysicsNodeComponent` (`0x0823fc20`)
//     registers its `PhysicsEngine` with the `PhysicsNodeManager`, whose
//     all-nodes loop (`0x08255740`, called from `GameServer::simulateFrame`
//     `0x0815c2a0` after the object update) runs `PhysicsEngine::updatePhysics`
//     (`0x0824cbb0`). Its push goes to `getRootNode` (`0x082548d0`) =
//     `getRootParent(object)+0x60`, the round's own physics node.
//
//  2. **`c_ETRocket` is 0x11** (TANK-1): bit 0, so the thrust body runs; bit 4,
//     so `Engine::Engine` (`0x0823e030`) sends itself TemplateMessage 4 (the
//     engine is running from birth, PHY-14) and every `handleUpdate` pins the
//     roll input `Engine+0x124` to 1.0 (`0x0823e16e`); bit 3 clear, so it
//     thrusts above the water and, below it, has its revs zeroed and pushes
//     nothing (`getWaterLevel`, `PatchTerrain` vtable `+0x5c`, at `0x0824cc50`).
//
//  3. **The thrust law is the aircraft's** (physics.md section 5):
//
//         rho = 1 - clamp(y / airDensityZeroAtHeight, 0, 1)      at the engine
//         e   = revs - rho * (v . fwd) / setNoPropellerEffectAtSpeed
//         K   = 0.1*|revs| + e*|e|
//         a   = fwd * K * getCurrentRatio()
//
//     an acceleration, mass-independent (`addAccelerationAtAbsolutePosition`
//     `0x08255110`), along the engine's own +Z axis. `revs` is the gearbox's
//     rev state, not the pinned input: `T1 = clipped roll angle /
//     maxRotation.z`, the angle run by the `calculateAndClipAngle` servo
//     (GUN-2) at the authored `setAcceleration` / `setMaxSpeed`, then
//     `revs += 0.05*((T1 - L) - 0.5*revs)` per tick (TANK-12) against the load
//     `L = 0.99 * K*ratio/getCurrentTorque()` that `feedbackLoop` (`0x0824c850`)
//     leaves (bits 1 and 2 clear: the running mean, TANK-13).
//
// That last term is what gives a rocket a top speed: thrust falls away as the
// round approaches `noPropellerEffectAtSpeed`, the load pulls the revs down as K
// climbs, and the drag law (the box law for a full physics body, PHY-4) meets
// what is left. The 25 m/s^2 this replaced had none of it, so a Hellfire that
// lives 50 s left at 350 m/s and went on gaining speed for its whole life.
//
// Pure arithmetic over the baked `spec.parts`, with no three.js, so the
// harness and the page run the same thing.

import { currentRatio, currentTorque, loadSample, revAdvance } from './engine-revs.js';

/** `g_simulationFps` (physics.md section 3): the gearbox filter's 0.05 is per tick. */
export const ENGINE_TICK_HZ = 30;

/** `BasicPhysicsSystem`'s `airDensityZeroAtHeight`, 1000.0 (physics.md section 2). */
export const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;

/** `0.1*|throttle|`, the half of `K` that does not fade with speed. */
const ENGINE_IDLE = 0.1;

/** `operator<<(ostream&, EngineType)`'s table (ledger TANK-1). */
const ENGINE_TYPE_BITS = {
  c_etplane: 0x1, c_etcar: 0x2, c_ettank: 0x6, c_etship: 0x9,
  c_etrocket: 0x11, c_ettorpedo: 0x19,
};

/** An Engine's `setEngineType` as its bit flags; 0 for one the table lacks. */
export function engineTypeBits(name) {
  return ENGINE_TYPE_BITS[String(name || '').toLowerCase()] ?? 0;
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Whether an Engine part pushes its round through the air on its own.
 *
 * It must take the thrust body (bit 0), be on the branch that thrusts above
 * the water (bit 3 clear) and be started and throttled by its own type (bit
 * 4): a projectile has no driver to send TemplateMessage 4 or to press a
 * throttle, so an engine without bit 4 stays stopped with its revs held at 0
 * (`0x0823e2e6`). In the shipped data that is exactly `c_ETRocket`; the
 * torpedo's `c_ETTorpedo` (bit 3 set) pushes only under water, which is
 * `torpedo-run.js`'s.
 */
export function isAirMotor(part) {
  if (String(part?.kind || '').toLowerCase() !== 'engine') return false;
  const bits = engineTypeBits(part.engineType);
  return (bits & 0x1) !== 0 && (bits & 0x8) === 0 && (bits & 0x10) !== 0;
}

/**
 * One rocket Engine: the throttle servo, the gearbox and the thrust law.
 */
export class RocketMotor {
  /** @param {object} part one `spec.parts` entry with `kind: 'Engine'` */
  constructor(part) {
    this.template = part.template ?? null;
    // `getCurrentRatio` (`0x0824ca70`): 3.5 * setDifferential / ratioCurve[100]
    // with the one gear every projectile engine has.
    this.ratio = currentRatio(part.differential ?? 1);
    this.torque = part.torque ?? 0;
    this.fadeSpeed = part.noPropellerEffectAtSpeed || 100;
    // The roll axis `T1` reads. `con.py` omits a zero, so absent is 0.
    this.max = part.maxRotation?.[2] ?? 0;
    this.min = part.minRotation?.[2] ?? 0;
    this.maxSpeed = part.maxSpeed?.[2] ?? 0;
    this.acceleration = Math.abs(part.acceleration?.[2] ?? 0);
    this.automaticReset = !!part.automaticReset;
    // The engine's place on the round, glb frame (+Z aft), for the water test
    // and the air density.
    this.position = part.position ?? [0, 0, 0];
    this.angle = 0;
    this.speed = 0;
    /** `PhysicsEngine+0xa0`, the rev state, which IS the thrust law's throttle. */
    this.revs = 0;
    /** `+0xa4` / `+0xac`: the load `feedbackLoop` accumulates within a tick. */
    this.load = 0;
    this.loadCount = 0;
    /** Seconds not yet spent on a whole engine tick, and the push the last
     *  tick left, held until the next (`tick`). */
    this.clock = 0;
    this.accel = 0;
  }

  /**
   * `frameDt` of the engine's own fixed loop: every whole 30 Hz tick runs
   * `handleUpdate` then `updatePhysics` (`advance`, then `thrust`), in
   * `GameServer::simulateFrame`'s order, and the push the last one computed
   * is held until the next. The servo, the gearbox and the load are a loop of
   * their own whose steps the engine takes per tick: run on a 60 Hz frame
   * instead, the revs at 0.2 s came out a sixth lower than the engine's
   * (each step reads the servo's `T1` at its end), and a frame rate moved the
   * spool-up. On the engine's tick every frame rate gets the engine's.
   *
   * The round's state is the frame's: a frame that spans two ticks evaluates
   * both at it, which at the page's 60 Hz never happens.
   *
   * @returns {number} the push along the engine's axis, m/s^2
   */
  tick(frameDt, along, height, underWater = false) {
    this.clock += frameDt;
    const tick = 1 / ENGINE_TICK_HZ;
    while (this.clock >= tick - 1e-9) {
      this.clock -= tick;
      this.advance(tick);
      this.accel = this.thrust(along, height, underWater);
    }
    return this.accel;
  }

  /** `T1 = clippedRollAngle / maxRotation.z` (`0x0823e1e0`-`0x0823e1f4`). */
  get t1() {
    return this.max ? this.angle / this.max : 0;
  }

  /**
   * `Engine::handleUpdate` for `dt` seconds: the roll servo on its pinned 1.0,
   * then the gearbox on the load the last thrust evaluation left, then the
   * load cleared, in the function's own order.
   *
   * The servo is GUN-2's law specialised to a constant input of 1 (the
   * general form is `vectored-engines.js` `clipAngleStep`): the speed register
   * ramps toward `maxSpeed` at `|acceleration|` deg/s^2 and the angle
   * integrates it, or, under `automaticReset`, the angle ramps straight to
   * `maxRotation` at `|acceleration|` deg/s; then the clip. Every shipped
   * rocket authors `maxSpeed 100000` and `acceleration 100000` (the
   * Maverick ten times that), which puts `T1` at 1.0 in about 0.3 s.
   */
  advance(dt) {
    const step = this.acceleration * dt;
    if (step > 0) {
      if (this.automaticReset) {
        this.angle += clamp(this.max - this.angle, -step, step);
      } else {
        this.speed += clamp(this.maxSpeed - this.speed, -step, step);
        this.angle += this.speed * dt;
      }
      if (this.angle > this.max) this.angle = this.max;
      else if (this.angle < this.min) this.angle = this.min;
    }
    this.revs = revAdvance(this.revs, this.t1, this.load, dt * ENGINE_TICK_HZ);
    this.load = 0;
    this.loadCount = 0;
  }

  /**
   * The push along the engine's axis this tick, m/s^2, and the load sample
   * `feedbackLoop` takes from it.
   *
   * @param {number} along the round's velocity along the engine's axis, m/s
   * @param {number} height the engine's world height, for the air density
   * @param {boolean} underWater the engine is below the water level
   */
  thrust(along, height, underWater = false) {
    if (underWater) {
      // `0x0824cc92`: revs zeroed, no thrust, no feedback.
      this.revs = 0;
      return 0;
    }
    const rho = 1 - clamp(height / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
    const e = this.revs - rho * along / this.fadeSpeed;
    const k = ENGINE_IDLE * Math.abs(this.revs) + e * Math.abs(e);
    const torque = currentTorque(this.torque, this.revs);
    if (Math.abs(torque) > 1e-9) {
      this.load = loadSample(this.load, this.loadCount, k * this.ratio / torque);
      this.loadCount++;
    }
    return k * this.ratio;
  }
}

/**
 * The air motors a round's baked parts carry, or null for a round with none
 * (every round in the game but the rockets).
 */
export function rocketMotorsOf(spec) {
  const parts = Array.isArray(spec?.parts) ? spec.parts : [];
  const motors = parts.filter(isAirMotor).map(part => new RocketMotor(part));
  return motors.length ? motors : null;
}
