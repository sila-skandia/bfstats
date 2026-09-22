// Drives `viewer/swim.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_swim.py` copies the viewer
// module in under its own name, so the file under test is the file the page
// loads, byte for byte.

import {
  ASM_HIDE_WEAPON, ASM_IS_CLIMBING, ASM_IS_SWIMMING,
  DrownTimer, HP_LOST_WHILE_DAMAGE_FROM_WATER, MATERIAL_WATER,
  SWIM_ACCEL_GAIN, SWIM_CLIPS, SWIM_END_SECONDS, SWIM_ENTER_DEPTH,
  SWIM_FLOAT_DRAFT, SWIM_LEAVE_DEPTH, SWIM_START_SECONDS, SWIM_THROTTLE_BAND,
  SwimState, WATER_DAMAGE_DELAY, WATER_DAMAGE_INTERVAL,
  swimDepth, swimStroke,
} from './swim.js';

const results = {};
const DT = 1 / 60;

results.constants = {
  enter: SWIM_ENTER_DEPTH,
  leave: SWIM_LEAVE_DEPTH,
  draft: SWIM_FLOAT_DRAFT,
  gain: SWIM_ACCEL_GAIN,
  band: SWIM_THROTTLE_BAND,
  hideWeapon: ASM_HIDE_WEAPON,
  isSwimming: ASM_IS_SWIMMING,
  isClimbing: ASM_IS_CLIMBING,
  materialWater: MATERIAL_WATER,
  delay: WATER_DAMAGE_DELAY,
  hpLost: HP_LOST_WHILE_DAMAGE_FROM_WATER,
  interval: WATER_DAMAGE_INTERVAL,
  startSeconds: SWIM_START_SECONDS,
  endSeconds: SWIM_END_SECONDS,
};
results.clips = SWIM_CLIPS;
results.families = Object.keys(SWIM_CLIPS);

// `max(0, surfaceY - feetY)`, and nothing about x or z.
results.depth = {
  under: swimDepth(3, 1),
  atSurface: swimDepth(3, 3),
  above: swimDepth(3, 5),
  noWater: swimDepth(null, -20),
  nan: swimDepth(NaN, 0),
};

results.stroke = {
  hardForward: swimStroke(1),
  band: swimStroke(SWIM_THROTTLE_BAND),
  justOver: swimStroke(SWIM_THROTTLE_BAND + 1e-6),
  still: swimStroke(0),
  gentleBack: swimStroke(-0.4),
  hardBack: swimStroke(-1),
  garbage: swimStroke(undefined),
};

/** Run a swim state over a scripted feet-height sequence. */
function walkDepths(samples, { throttle = 0, climbing = false, dead = false } = {}) {
  const swim = new SwimState();
  const trace = [];
  for (const { surfaceY, feetY, ticks = 1, throttle: t, dead: d } of samples) {
    for (let i = 0; i < ticks; i++) {
      const pin = swim.update({
        dt: DT, surfaceY, feetY,
        throttle: t ?? throttle,
        climbing, dead: d ?? dead,
      });
      trace.push({ swimming: swim.swimming, family: swim.family,
                   depth: round(swim.depth), pin: pin === null ? null : round(pin) });
    }
  }
  return { swim, trace, last: trace[trace.length - 1] };
}

const round = n => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);

// --- the hysteresis --------------------------------------------------------
// Wading: 0.40 m of water over the feet is inside the 0.43 entry threshold, so
// he is still walking. 0.44 puts him in. Then 0.36 keeps him in (the exit is
// 0.35, not 0.43) and 0.34 takes him out.
results.wading = walkDepths([{ surfaceY: 3, feetY: 2.60 }]).last;
results.entering = walkDepths([{ surfaceY: 3, feetY: 2.56 }]).last;
{
  const run = walkDepths([
    { surfaceY: 3, feetY: 2.0, ticks: 40 },   // swimming, one-shot done
    { surfaceY: 3, feetY: 2.64, ticks: 1 },   // 0.36 deep: still swimming
  ]);
  results.staysInAtPointThreeSix = run.last;
  const out = walkDepths([
    { surfaceY: 3, feetY: 2.0, ticks: 40 },
    { surfaceY: 3, feetY: 2.66, ticks: 1 },   // 0.34 deep: the exit clip
  ]);
  results.exitsAtPointThreeFour = out.last;
  // And the exit clip is where the flag drops, not the depth test: it plays out
  // first and `addTransitionWhenDone Lb_Stand` is what ends the swim.
  const done = walkDepths([
    { surfaceY: 3, feetY: 2.0, ticks: 40 },
    { surfaceY: 3, feetY: 2.66, ticks: Math.ceil(SWIM_END_SECONDS / DT) + 2 },
  ]);
  results.exitClipEndsTheSwim = done.last;
  // `Lb_EndSwim` declares `c_AsmIsSwimming` itself, so every tick of the exit
  // clip is still a swimming tick -- and it is the transition to `Lb_Stand`,
  // not the depth test, that drops the flag.
  const ending = done.trace.filter(s => s.family === 'swimEnd');
  results.exitClipHeldTheFlag = ending.length > 1
    && ending.every(s => s.swimming === true);
  results.exitClipTicks = ending.length;
}

// --- the entry one-shot, and the stroke it hands over to -------------------
{
  const run = walkDepths([{ surfaceY: 3, feetY: 2.0, ticks: 2 }]);
  results.entryPlaysStartSwim = run.last;
  const later = walkDepths([
    { surfaceY: 3, feetY: 2.0, ticks: Math.ceil(SWIM_START_SECONDS / DT) + 2 },
  ]);
  results.entryHandsOverToSwimForward = later.last;
}
results.strokeFromThrottle = {
  forward: walkDepths([{ surfaceY: 3, feetY: 2.0, ticks: 40 }],
                      { throttle: 1 }).last.family,
  backward: walkDepths([{ surfaceY: 3, feetY: 2.0, ticks: 40 }],
                       { throttle: -1 }).last.family,
  floating: walkDepths([{ surfaceY: 3, feetY: 2.0, ticks: 40 }],
                       { throttle: 0 }).last.family,
};

// --- the draft ------------------------------------------------------------
// The pin is `surfaceY - 0.4` and it does not depend on how deep he started.
results.draftPin = {
  deep: walkDepths([{ surfaceY: 3, feetY: -20, ticks: 2 }]).last.pin,
  shallow: walkDepths([{ surfaceY: 3, feetY: 2.0, ticks: 2 }]).last.pin,
  // Above the surface: `0x082822bc` refuses to write the position at all.
  aboveTheSurface: (() => {
    const run = walkDepths([
      { surfaceY: 3, feetY: 2.0, ticks: 40 },
      { surfaceY: 3, feetY: 3.5, ticks: 1 },
    ]);
    return run.last.pin;
  })(),
};

// --- the ladder ----------------------------------------------------------
// `c_AsmIsClimbing` switches the whole function off, and it does not take a
// swimmer out of the state either -- the engine returns before the exit test.
results.ladder = {
  neverEnters: walkDepths([{ surfaceY: 3, feetY: -20, ticks: 10 }],
                          { climbing: true }).last,
  keepsASwimmerIn: (() => {
    const swim = new SwimState();
    for (let i = 0; i < 40; i++) {
      swim.update({ dt: DT, surfaceY: 3, feetY: 2.0 });
    }
    const before = { swimming: swim.swimming, family: swim.family };
    for (let i = 0; i < 10; i++) {
      swim.update({ dt: DT, surfaceY: 3, feetY: 9, climbing: true });
    }
    return { before, after: { swimming: swim.swimming, family: swim.family } };
  })(),
};

// --- no water at all ------------------------------------------------------
results.noWater = walkDepths([{ surfaceY: null, feetY: -400, ticks: 10 }]).last;

// --- death ---------------------------------------------------------------
{
  const swim = new SwimState();
  for (let i = 0; i < 40; i++) swim.update({ dt: DT, surfaceY: 3, feetY: 2.0 });
  results.dieSwim = {
    alive: swim.clips(false),
    dead: swim.clips(true),
  };
  const dry = new SwimState();
  results.dieDry = { dead: dry.clips(true), alive: dry.clips(false) };
}

// --- the drowning clock --------------------------------------------------
// 90 s of grace, then 1 HP a second. Off 30 HP a man who never surfaces is dead
// 120 s after he starts swimming.
{
  const timer = new DrownTimer();
  let hp = 30;
  let firstHitAt = null;
  let deadAt = null;
  const samples = [];
  for (let i = 1; i <= Math.ceil(200 / DT); i++) {
    const lost = timer.update(DT, true);
    if (lost > 0) {
      hp -= lost;
      if (firstHitAt === null) firstHitAt = i * DT;
      if (hp <= 0 && deadAt === null) deadAt = i * DT;
    }
    if (i % Math.round(30 / DT) === 0) samples.push({ t: i * DT, hp });
  }
  results.drowning = {
    firstHitAt, deadAt, hp, lost: timer.lost, samples,
    perHit: HP_LOST_WHILE_DAMAGE_FROM_WATER,
  };
}
// One dry tick puts the full 90 s back.
{
  const timer = new DrownTimer();
  for (let i = 0; i < Math.round(80 / DT); i++) timer.update(DT, true);
  const before = round(timer.timer);
  timer.update(DT, false);
  const after = round(timer.timer);
  let hits = 0;
  for (let i = 0; i < Math.round(85 / DT); i++) {
    if (timer.update(DT, true) > 0) hits++;
  }
  results.surfacingResetsTheClock = { before, after, hitsInNext85Seconds: hits };
}
// A template with `damageFromWater 0` never drowns anybody.
{
  const timer = new DrownTimer({ damageFromWater: false });
  let lost = 0;
  for (let i = 0; i < Math.round(300 / DT); i++) lost += timer.update(DT, true);
  results.damageFromWaterOff = { lost };
}

console.log(JSON.stringify(results, null, 1));
