// `viewer/rocket-pack.js` under node: XPack2's rocket pack, the engine's
// `ActiveKitPart::update` and `getAcceleration` (lnxded 0x082628e0, 0x082632f0)
// run against the numbers `GermanElite_RocketPack` writes.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const pack = await import(pathToFileURL(path.join(viewer, 'rocket-pack.js')).href);
const hum = await import(pathToFileURL(path.join(viewer, 'pack-hum.js')).href);

// The row `extract_loadouts.py` writes for GermanElite_JetPack, as the .con has it.
const ROW = {
  template: 'GermanElite_RocketPack', bone: 'backpack',
  activeAcceleration: [0, 72, 0], passiveAcceleration: [0, 7.7, 0],
  trigger: 'PIAction', negativeMask: ['Climbing', 'Crouching', 'Swiming', 'Lying'], positiveMask: [],
  burstFrequency: 30, activeHeatIncrement: 2.25, passiveHeatIncrement: 0, coolingFactor: 0.07,
  effectPersistance: 0, damping: 0, overrideAirMovementInhibitations: true,
  inAirAnims: ['Lb_RocketeeringIdle', 'Empty'], effects: ['e_RocketPack', 'e_RocketPackDefault'],
  defaultEffect: 'e_RocketPackDefault',
};
const spec = pack.packSpec(ROW);
const flags = new Set();
const results = {};

results.spec = {
  trigger: spec.trigger, activeHeat: spec.activeHeat, cooling: spec.cooling,
  burstPeriod: spec.burstPeriod, persistence: spec.persistence, damping: spec.damping,
  negative: [...spec.negativeMask].sort(), inAirLower: spec.inAirLower, inAirUpper: spec.inAirUpper,
  noRow: pack.packSpec({ template: 'nochute', overrideAirMovementInhibitations: true }),
};

// A pack nobody has touched: state off until its first tick, but it lifts
// once it has ticked idle (`hasRoom` starts true, the constructor's byte).
{
  const p = new pack.RocketPack(spec);
  const fresh = { state: p.state, accel: [...p.acceleration] };
  p.update({ flags });
  results.fresh = { ...fresh, afterIdle: { state: p.state, accel: [...p.acceleration], heat: p.heat } };
}

// Trigger held from a standing start: how many ticks it burns, the heat it
// reaches, and what it does after.
{
  const p = new pack.RocketPack(spec);
  let burning = 0;
  let firstDark = null;
  let lastBurn = null;
  const trace = [];
  for (let i = 0; i < 60; i++) {
    p.update({ trigger: true, flags });
    if (p.burning) { burning += 1; lastBurn = i; }
    if (p.state === 3 && firstDark === null) firstDark = i;
    if (i < 3) trace.push([i, p.state, +p.heat.toFixed(4), [...p.acceleration][1]]);
  }
  results.held = { burning, trace, firstDark, lastBurn, heatAfter60: +p.heat.toFixed(4) };
}

// Cooling: from an overheated pack with the trigger up, ticks until it is
// ready (`heat < 1`) and until it is cold.
{
  const p = new pack.RocketPack(spec);
  while (p.state !== 3 || p.heat < 1) p.update({ trigger: true, flags });
  let ready = 0;
  while (p.heat >= 1) { p.update({ flags }); ready += 1; }
  let cold = ready;
  while (p.heat > 0) { p.update({ flags }); cold += 1; }
  results.cooling = { ready, cold, fromReady: cold - ready, fuelAtCold: p.fuel };
}

// A flag of the negative mask blocks a burst and the idle lift both.
{
  const p = new pack.RocketPack(spec);
  p.update({ trigger: true, flags: new Set(['crouching']) });
  results.crouched = { state: p.state, accel: [...p.acceleration], heat: p.heat };
  const q = new pack.RocketPack(spec);
  q.update({ trigger: true, flags: new Set(['swimming']) });
  results.swimming = { state: q.state };
}

// No room overhead: the burst does not start, the heat does not move, and the
// idle lift is the last answer's (none).
{
  const p = new pack.RocketPack(spec);
  p.update({ trigger: true, flags, room: () => false });
  results.noRoom = { state: p.state, heat: p.heat, accel: [...p.acceleration], hasRoom: p.hasRoom };
  p.update({ trigger: true, flags, room: () => true });
  results.roomAgain = { state: p.state, accel: [...p.acceleration] };
}

// The burst timer: a trigger held for one tick, then released and pressed
// again on the next, starts again at the engine's 30 Hz (the period is one
// tick, so the timer is already out).
{
  const p = new pack.RocketPack(spec);
  const seq = [];
  for (const down of [true, false, true, true]) {
    p.update({ trigger: down, flags });
    seq.push(p.burning);
  }
  results.burstSequence = seq;
}

// A replayed burn's sound is triggered on every burst: a 2 s burn sampled at
// 60 fps triggers 30 times (15 a second), not once at its start.
{
  let last; let was = false; let n = 0;
  for (let i = 0; i <= 120; i++) {
    const t = 10 + i / 60;
    if (pack.packBurstDue(t, last, was)) { n++; last = t; }
    was = true;
  }
  results.burnTriggers = {
    n,
    fresh: pack.packBurstDue(5, 4.99, false),
    seekBack: pack.packBurstDue(3, 4, true),
    tooSoon: pack.packBurstDue(4.03, 4, true),
    spacing: pack.PACK_BURST_SPACING,
  };
}

// The pack's idle hum (patch 1 of `EngineHigh.ssc`): silent until 0.4 s after
// a burst, full (0.5 x volume 2.0, held to 1) from 1.2 s, gone at 5 m.
{
  const IDLE = {
    volume: 2.0,
    modulators: [
      { dest: 'volume', source: 'time', envelope: 'ramp', params: [0.4, 1.2, 0.0, 0.5] },
      { dest: 'volume', source: 'distance', envelope: 'ramp', params: [1.0, 5.0, 1.0, -1.0] },
    ],
  };
  results.hum = {
    justBurst: hum.packHumLevel(IDLE, 0.1, 0),
    rising: hum.packHumLevel(IDLE, 0.8, 0),
    settled: hum.packHumLevel(IDLE, 3, 0),
    neverBurst: hum.packHumLevel(IDLE, Infinity, 0),
    at3m: hum.packHumLevel(IDLE, 3, 3),
    at5m: hum.packHumLevel(IDLE, 3, 5),
    none: hum.packHumLevel(null, 3, 0),
  };
}

results.damping = {
  pack: pack.kitDamping([ROW]), none: pack.kitDamping([]), mixed: pack.kitDamping([{ damping: 0.5 }, ROW]),
};
// Heights at 10 Hz from replay_4dbzkzc6sv's soldier 2936 (1.42 s of a flight).
results.replay = {
  burst: pack.replayBurning(51.98, 52.70, 53.48, 0.1),        // 94.93 s: +12 m/s^2
  idle: pack.replayBurning(56.33, 57.05, 57.68, 0.1),         // 95.43 s: -6.4
  apex: pack.replayBurning(52.33, 52.14, 51.90, 0.1),         // 67.77 s: falling on the lift
  still: pack.replayBurning(51.45, 51.45, 51.45, 0.1),        // standing: 0 m/s^2 is no deceleration
  noInterval: pack.replayBurning(1, 2, 3, 0),
  alias: pack.rocketeeringClip('Lb_RocketeeringIdle'), plain: pack.rocketeeringClip('Lb_Stand'),
};
process.stdout.write(JSON.stringify(results));
