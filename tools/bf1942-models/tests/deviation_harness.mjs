// Drives `viewer/deviation.js` outside a browser and prints one JSON blob.
//
// `tests/test_deviation.py` copies this file and the module under test into a
// temporary directory and asserts on the output. The weapon blocks below are
// **the shipped data**, read back out of the glbs' document extras rather than
// invented for the test: the Thompson's is the block every assertion leans on,
// the K98Sniper's is the degenerate shape (no floor, no fire, no mod), the AT
// family's is the other vocabulary entirely. If one of them stops matching
// `models/<Name>.glb`, the extractor changed and this file is lying about
// what it tests.
//
// What is asserted is the DECOMPILED rule — `HandFireArms::updateDeviation`,
// client 0x00551f50 / lnxded 0x08293e80, per the corpus doc
// `features/bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md`:
// the floor is minDev unscaled; the dynamic channels raise by M², cap at a·M
// and decay d/M per tick; the speed gates are binary on the 0.01 deadzone;
// the turn terms are analog in the look input; miscDev is the jump channel;
// firing blooms +b per shot to cap a and decays c/M per tick; and aiming
// changes NOTHING. The clock (TICK_HZ) is the engine's fixed 30 Hz simulation
// tick; what stays approximate is only the AT family's floor-and-lid, marked
// OPEN in the module.

import {
  DeviationModel, STANCE_INDEX, TICK_HZ, INPUT_DEADZONE,
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
// when its shooter does, and with no `setDevMod` the multiplier is 1.
const SNIPER = {
  speed: [0.8, 0.2, 0.2, 0.1],
  misc: [2.5, 2.5, 0.1],
};

// The AT/thrown vocabulary (`models/Bazooka.glb`): a floor and a lid,
// combine rule OPEN. The speed block is synthetic, here only to prove the
// lid clamps what the additive terms would exceed.
const CAPPED = {
  minDeviation: 0.0,
  maxDeviation: 0.5,
  speed: [2.0, 0.2, 0.2, 0.1],
};

// A synthetic turn block, because every vanilla weapon declares
// `setTurnDev 0 0 0 0` and a zero cannot show whether the term is wired.
// [cap, per-MouseLookY, per-MouseLookX, decay/tick].
const TURNER = { min: 0.4, turn: [1.0, 0.5, 0.5, 0.01] };

// One engine tick per update call: (1/60)·60 is exactly 1 in IEEE doubles,
// so the accumulator fires exactly one tick and carries nothing.
const DT = 1 / TICK_HZ;

function model(deviation) {
  return new DeviationModel({ deviation });
}

/** Hold `state` for `ticks` updates and read the cone. */
function settle(deviation, state, ticks = 600) {
  const m = model(deviation);
  for (let i = 0; i < ticks; i++) m.update(DT, state);
  return m.current();
}

/** One tick under `state`, from rest. */
function afterOne(deviation, state) {
  return model(deviation).update(DT, state).current();
}

const results = { constants: {
  stanceIndex: STANCE_INDEX,
  tickHz: TICK_HZ,
  deadzone: INPUT_DEADZONE,
} };

// --- the floor is minDev, unscaled ------------------------------------------
// devMod does NOT multiply minDev (the old approximation is REFUTED): a
// still soldier's cone is 0.4 in every stance.

results.still = {
  stand: settle(THOMPSON, { stance: 'stand' }),
  crouch: settle(THOMPSON, { stance: 'crouch' }),
  prone: settle(THOMPSON, { stance: 'prone' }),
};

// --- movement: binary gates, M-scaled channels ------------------------------
// The stance ladder lives in the dynamic channels: caps scale by M, so a
// moving prone man beats a moving crouched man beats a moving standing man.

results.moving = {
  standStill: settle(THOMPSON, { throttle: 0 }),
  stand: settle(THOMPSON, { stance: 'stand', throttle: 1 }),
  crouch: settle(THOMPSON, { stance: 'crouch', throttle: 1 }),
  prone: settle(THOMPSON, { stance: 'prone', throttle: 1 }),
  // The gate is binary on the 0.01 deadzone — a soft press is a full press,
  // and below the deadzone nothing at all. NOT scaled by speed.
  softThrottle: settle(THOMPSON, { throttle: 0.3 }),
  deadzone: settle(THOMPSON, { throttle: 0.005 }),
  // Strafe drives the c term of the same channel with the same cap.
  strafe: settle(THOMPSON, { strafe: 1 }),
  both: settle(THOMPSON, { throttle: 1, strafe: 1 }),
  // The raise carries M twice; one tick from rest shows the M² against the
  // linear cap (asserted against the formula, not a magic number).
  standOneTick: afterOne(THOMPSON, { stance: 'stand', throttle: 1 }),
  proneOneTick: afterOne(THOMPSON, { stance: 'prone', throttle: 1 }),
};

// --- turning: analog in the look input --------------------------------------

results.turning = {
  still: settle(TURNER, {}),
  steady: settle(TURNER, { lookY: 6 }),
  steadyX: settle(TURNER, { lookX: 6 }),
  oneTickFull: afterOne(TURNER, { lookY: 6 }),
  oneTickHalf: afterOne(TURNER, { lookY: 3 }),
  oneTickNegative: afterOne(TURNER, { lookY: -6 }),   // sign is dropped
  vanillaZeros: settle(THOMPSON, { lookY: 6, lookX: 6 }),
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
  // Then let go of the trigger and watch it come home: fireDev.c / M per
  // tick, standing M = 1.2, so 2.0 / (0.06/1.2) = 40 ticks exactly.
  const decay = [];
  for (let i = 0; i < 120; i++) {
    m.update(DT, {});
    decay.push(m.current());
  }
  const settledAt = decay.findIndex(v => Math.abs(v - rest) < 1e-9);
  // The same bloom worked off prone: decay is ÷M, so M < 1 recovers FASTER.
  const p = model(THOMPSON);
  p.update(DT, { stance: 'prone' });
  for (let i = 0; i < 11; i++) p.onShot();
  let proneSettledAt = -1;
  for (let i = 0; i < 120; i++) {
    p.update(DT, { stance: 'prone' });
    if (proneSettledAt < 0 && Math.abs(p.current() - 0.4) < 1e-9) proneSettledAt = i;
  }
  results.fire = {
    rest, oneShot, burst,
    fireCap: THOMPSON.fire[0],
    addPerShot: THOMPSON.fire[1],
    monotonic: decay.every((v, i) => i === 0 || v <= decay[i - 1] + 1e-12),
    settledAt,                       // ticks until back at the floor
    proneSettledAt,
    end: decay[decay.length - 1],
  };
}

// --- aiming changes nothing --------------------------------------------------
// Zoom appears nowhere in the deviation formula, in either binary. The model
// has no aim input at all; a state carrying one is carrying dead weight.

results.aim = {
  hip: settle(THOMPSON, { throttle: 1 }),
  aimed: settle(THOMPSON, { throttle: 1, aiming: true, zoomed: true }),
};

// --- jumping is the misc channel ---------------------------------------------

{
  const m = model(THOMPSON);
  for (let i = 0; i < 60; i++) m.update(DT, { jumping: true });
  const jumping = m.current();
  // Land, release, and the channel decays d/M back to nothing.
  let recovered = -1;
  for (let i = 0; i < 120; i++) {
    m.update(DT, { jumping: false });
    if (recovered < 0 && Math.abs(m.current() - 0.4) < 1e-9) recovered = i;
  }
  results.airborne = {
    grounded: settle(THOMPSON, {}),
    jumping,
    jumpCap: THOMPSON.misc[0],
    recovered,
    end: m.current(),
    // No mod block: M = 1, cap = misc.a exactly, and no floor under it.
    sniperJumping: settle(SNIPER, { jumping: true }),
  };
}

// --- the degenerate shapes --------------------------------------------------

results.sniper = {
  still: settle(SNIPER, {}),
  moving: settle(SNIPER, { throttle: 1 }),
};
results.capped = {
  still: settle(CAPPED, {}),
  moving: settle(CAPPED, { throttle: 1 }),   // channel cap 2.0, lid 0.5
  lid: CAPPED.maxDeviation,
};
results.none = {
  still: settle(null, {}),
  moving: settle(null, { throttle: 1 }),
};

process.stdout.write(JSON.stringify(results, null, 1));
