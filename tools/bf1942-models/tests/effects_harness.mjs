// Drives `viewer/effects-core.js` outside a browser and prints one JSON blob.
// The module imports nothing, which is what makes this possible; the
// three.js glue in `effects.js` is exercised in the browser instead.
import {
  sampleCrd, sampleCurve, basisFromNormal, basisFromAxes, rollBasis, inFrame,
  EmitterClock, spawnParticle, integrateParticle, evalParticle, damageFactor,
} from './effects-core.mjs';

// A deterministic generator so the assertions are exact.
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const out = {};

out.crd = {
  none: sampleCrd(['n', 0.1, 0, 0], () => 0.3),
  uniformTop: sampleCrd(['u', 15, 1, 0], () => 0.0),      // r = 1 -> b
  uniformBottom: sampleCrd(['u', 15, 1, 0], () => 0.999),  // r -> 0 -> a
  mirrored: [0.2, 0.9].map(m => sampleCrd(['u', 3, 3, 1], () => m)),
  exponential: sampleCrd(['e', 2, 0, 0], () => 1 - Math.exp(-1)), // r = e^-1 -> 2
  bare: sampleCrd(0.5),
};
out.curve = {
  alphaAt85: sampleCurve([[0, 1], [70, 1], [100, 0]], 85),
  rgbaMid: sampleCurve([[0, 255, 255, 255, 204], [100, 0, 0, 0, 0]], 50),
};
out.basis = {
  ground: basisFromNormal([0, 1, 0]),
  wallMinusZ: basisFromNormal([0, 0, -1]),
  wallPlusX: basisFromNormal([1, 0, 0]),
  attached: basisFromAxes([0, 0, -1], [0, 1, 0]),
  rolled90: rollBasis(basisFromNormal([0, 1, 0]), 90),
  point: inFrame(basisFromNormal([0, 1, 0]), 1, 2, 3),
};

// The decal emitter: intensity 2 over 0.1 s must still spawn exactly once.
const decal = new EmitterClock({ timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 2, 0, 0] }, lcg(3));
const decalSpawns = [];
for (let i = 0; i < 12; i++) decalSpawns.push(decal.step(1 / 60));
out.clock = {
  decalSpawns: decalSpawns.reduce((a, b) => a + b, 0),
  decalDone: decal.done,
};
// 100 per second for 0.1 s: eleven (t = 0 and every 10 ms after).
const dense = new EmitterClock({ timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 100, 0, 0] }, lcg(5));
let denseCount = 0;
for (let i = 0; i < 12; i++) denseCount += dense.step(1 / 60);
out.clock.dense = denseCount;
// A delay holds the first spawn back.
const delayed = new EmitterClock({ delay: ['n', 0.2, 0, 0], timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 10, 0, 0] }, lcg(7));
out.clock.delayedFirstStep = delayed.step(0.1);
out.clock.delayedSecondStep = delayed.step(0.15);
// A looping emitter never finishes; a -1 lifetime runs until stopped.
const loop = new EmitterClock({ looping: true, timeToLive: ['n', 0.05, 0, 0], intensity: ['n', 10, 0, 0] }, lcg(9));
for (let i = 0; i < 30; i++) loop.step(1 / 60);
out.clock.loopDone = loop.done;
const forever = new EmitterClock({ timeToLive: ['n', -1, 0, 0], intensity: ['n', 1, 0, 0] }, lcg(11));
for (let i = 0; i < 300; i++) forever.step(1 / 60);
out.clock.foreverDone = forever.done;
out.clock.foreverSpawned = forever.spawned;
// Zero intensity is one spawn per hundred seconds, not a division by zero.
const idle = new EmitterClock({ timeToLive: ['n', 5, 0, 0], intensity: ['n', 0, 0, 0] }, lcg(13));
out.clock.idleInterval = idle.interval(0);
// IntensityAtSpeed scales with the emitter's speed.
const atSpeed = new EmitterClock({ timeToLive: ['n', 1, 0, 0], intensity: ['n', 23, 0, 0], intensityAtSpeed: 20 }, lcg(15));
out.clock.atSpeedInterval = atSpeed.interval(100);

// A decal spawn: offset 1 mm along the normal, no velocity, 0.2 m quad.
const ground = basisFromNormal([0, 1, 0]);
const decalSpec = {
  timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 2, 0, 0],
  relativePosition: { up: ['n', 0.001, 0, 0] },
  particle: { kind: 'mesh', timeToLive: ['u', 15, 1, 0], size: ['u', 1, 1, 0],
              gravityModifier: ['n', 0, 0, 1], sizeModifier: [1, 1, 1],
              alphaOverTime: [[0, 1], [70, 1], [100, 0]] },
};
const d = spawnParticle(decalSpec, ground, [10, 5, -3], null, lcg(21));
out.decal = { position: d.position, velocity: d.velocity, ttl: d.ttl, size: d.size };
const early = evalParticle(d);
d.age = d.ttl * 0.85;
const late = evalParticle(d);
out.decal.opacityEarly = early.opacity;
out.decal.opacityAt85 = late.opacity;
out.decal.scale = late.scale;
integrateParticle(d, 1);
out.decal.afterOneSecond = d.position;

// A smoke puff inheriting the rocket's speed and dragged to a stop.
const puffSpec = {
  timeToLive: ['n', 7, 0, 0], intensity: ['n', 100, 0, 0], addEmitterSpeed: true, emitterSpeedScale: 1,
  particle: { kind: 'sprite', timeToLive: ['n', 2.5, 0, 0], size: ['n', 1.2, 0, 0],
              drag: ['n', 20, 0, 0], gravityModifier: ['n', 0, 0, 0],
              sizeOverTime: [[0, 0.4], [100, 0.75]],
              colorRGBAOverTime: [[0, 212, 208, 200, 255], [100, 200, 200, 200, 0]] },
};
const puff = spawnParticle(puffSpec, basisFromAxes([0, 0, -1], [0, 1, 0]), [0, 0, 0], [0, 0, -50], lcg(31));
out.puff = { speed0: Math.hypot(...puff.velocity) };
for (let i = 0; i < 6; i++) integrateParticle(puff, 1 / 60);
out.puff.speedAfter100ms = Math.hypot(...puff.velocity);
out.puff.travelled = -puff.position[2];
out.puff.look = evalParticle(puff);

// Gravity: a chip with gravityModifier 0.6 falls at 0.6 g.
const chip = spawnParticle({ particle: { kind: 'mesh', timeToLive: ['n', 1, 0, 0], gravityModifier: ['n', 0.6, 0, 0] } },
                           ground, [0, 0, 0], null, lcg(41));
integrateParticle(chip, 0.5);
out.chip = { vy: chip.velocity[1] };

// Damage falloff, the Thompson's 0.5 / 40 / 80.
out.damage = [0, 40, 60, 80, 200].map(x => damageFactor({ minDamage: 0.5, distToStartLoseDamage: 40, distToMinDamage: 80 }, x));
out.damageNone = damageFactor(null, 500);

console.log(JSON.stringify(out));
