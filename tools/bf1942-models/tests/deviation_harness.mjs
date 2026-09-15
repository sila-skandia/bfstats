// Drives `viewer/deviation.js` outside a browser and prints one JSON blob.
//
// `tests/test_deviation.py` copies this file and the module under test into a
// temporary directory and asserts on the output. The weapon blocks below are
// **the shipped data**, read back out of the glbs' document extras rather than
// invented for the test: the Thompson's is the block every assertion about
// ordering leans on, the K98Sniper's is the degenerate shape (no floor, no
// fire), the AT family's is the other vocabulary entirely. If one of them
// stops matching `models/<Name>.glb`, the extractor changed and this file is
// lying about what it tests.
//
// What is asserted is the *shape* of the approximation, not the engine —
// the engine's combining rule is unread (see the module header). Prone must
// beat crouch must beat stand, movement must cost, firing must bloom and
// decay, aiming must tighten. Those orderings are what the shipped numbers
// declare regardless of how the engine sums them, so they are the part of
// the model that can be held to account today.

import {
  DeviationModel, STANCE_INDEX, RUN_SPEED_DEFAULT,
  FIRE_DECAY_HZ, TURN_REF, AIM_FACTOR, AIRBORNE_MULT, DEV_CAP_DEG,
} from './deviation.js';

// `Objects/HandWeapons/Thompson.con` via `models/Thompson.glb` extras.
const THOMPSON = {
  min: 0.4,
  fire: [2.0, 0.35, 0.06],
  mod: [1.2, 1.05, 0.9],
  turn: [0.0, 0.0, 0.0, 0.0],
  speed: [0.8, 0.2, 0.2, 0.1],
  misc: [2.5, 2.5, 0.1],
};

// `models/K98Sniper.glb`: no min, no fire, no mod — a sniper wanders only
// when its shooter does.
const SNIPER = {
  speed: [0.8, 0.2, 0.2, 0.1],
  misc: [2.5, 2.5, 0.1],
};

// The AT/thrown vocabulary (`models/Bazooka.glb`): a floor and a lid and
// nothing else extracted yet. The speed block is synthetic, here only to
// prove the lid clamps what the additive terms would exceed.
const CAPPED = {
  minDeviation: 0.0,
  maxDeviation: 0.5,
  speed: [2.0, 0.2, 0.2, 0.1],
};

// A synthetic turn block, because every vanilla weapon declares zeros and a
// zero cannot show whether the term is wired at all.
const TURNER = { min: 0.4, turn: [1.0, 0.0, 0.0, 0.0] };

const DT = 1 / 60;

function model(deviation, runSpeed = RUN_SPEED_DEFAULT) {
  return new DeviationModel({ deviation, runSpeed });
}

/** Settle a model into `state` and read the cone. */
function at(deviation, state) {
  return model(deviation).update(DT, state).current();
}

const results = { constants: {
  stanceIndex: STANCE_INDEX,
  runSpeedDefault: RUN_SPEED_DEFAULT,
  fireDecayHz: FIRE_DECAY_HZ,
  turnRef: TURN_REF,
  aimFactor: AIM_FACTOR,
  airborneMult: AIRBORNE_MULT,
  capDeg: DEV_CAP_DEG,
} };

// --- the stance ladder ------------------------------------------------------

results.still = {
  stand: at(THOMPSON, { stance: 'stand' }),
  crouch: at(THOMPSON, { stance: 'crouch' }),
  prone: at(THOMPSON, { stance: 'prone' }),
};

// --- movement costs ---------------------------------------------------------

results.moving = {
  still: at(THOMPSON, { speed: 0 }),
  walking: at(THOMPSON, { speed: 2 }),      // GAIT_SPEED.walk
  running: at(THOMPSON, { speed: 6 }),      // GAIT_SPEED.run
  overRun: at(THOMPSON, { speed: 60 }),     // clamped at the run, not beyond
};

// --- turning costs, when the weapon declares it -----------------------------

results.turning = {
  still: at(TURNER, {}),
  half: at(TURNER, { turning: TURN_REF / 2 }),
  full: at(TURNER, { turning: TURN_REF }),
  negative: at(TURNER, { turning: -TURN_REF }),   // sign is dropped
  vanillaZeros: at(THOMPSON, { turning: TURN_REF }),
};

// --- firing blooms, then decays --------------------------------------------

{
  const m = model(THOMPSON);
  m.update(DT, {});
  const rest = m.current();
  m.onShot();
  const oneShot = m.current();
  // A held burst: ten more rounds with no time passing, which must saturate
  // at the declared cap rather than growing without bound.
  for (let i = 0; i < 10; i++) m.onShot();
  const burst = m.current();
  // Then let go of the trigger and watch it come home.
  const decay = [];
  for (let i = 0; i < 120; i++) {          // two seconds at 60 Hz
    m.update(DT, {});
    decay.push(m.current());
  }
  const settledAt = decay.findIndex(v => Math.abs(v - rest) < 1e-9);
  results.fire = {
    rest, oneShot, burst,
    fireCap: THOMPSON.fire[0],
    addPerShot: THOMPSON.fire[1],
    monotonic: decay.every((v, i) => i === 0 || v <= decay[i - 1] + 1e-12),
    settledAt,                              // frames until back at the floor
    settledSeconds: settledAt >= 0 ? settledAt / 60 : null,
    end: decay[decay.length - 1],
  };
}

// --- aiming tightens --------------------------------------------------------

results.aim = {
  hip: at(THOMPSON, { speed: 6 }),
  aimed: at(THOMPSON, { speed: 6, aiming: true }),
  aimedStill: at(THOMPSON, { aiming: true }),
};

// --- airborne is the worst case ---------------------------------------------

results.airborne = {
  grounded: at(THOMPSON, {}),
  jumping: at(THOMPSON, { airborne: true }),
  misc: THOMPSON.misc[0],
  // No misc block: the floor is multiplied instead.
  jumpingNoMisc: at(TURNER, { airborne: true }),
  floorNoMisc: at(TURNER, {}),
};

// --- the degenerate shapes --------------------------------------------------

results.sniper = {
  still: at(SNIPER, {}),
  running: at(SNIPER, { speed: 6 }),
};
results.capped = {
  still: at(CAPPED, {}),
  running: at(CAPPED, { speed: 6 }),       // 2.0 additive, clamped to 0.5
  lid: CAPPED.maxDeviation,
};
results.none = {
  still: new DeviationModel({}).update(DT, {}).current(),
  running: new DeviationModel({}).update(DT, { speed: 6 }).current(),
};

process.stdout.write(JSON.stringify(results, null, 1));
