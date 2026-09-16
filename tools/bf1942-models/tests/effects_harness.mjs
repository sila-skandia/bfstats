// Drives `viewer/effects-core.js` outside a browser and prints one JSON blob.
// The module imports nothing, which is what makes this possible; the
// three.js glue in `effects.js` is exercised in the browser instead.
import {
  sampleCrd, sampleCurve, basisFromNormal, basisFromAxes, rollBasis, inFrame,
  EmitterClock, spawnParticle, integrateParticle, evalParticle, damageFactor,
  atlasGrid, frameIndex,
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
// A delay holds the first spawn back. EMT-2: on the tick the delay runs out,
// age grows by the delay's own pre-tick value (0.2 - 0.1 = 0.1), not by the
// leftover past zero (0.5 - 0.1 = 0.4) — so a big second dt (0.5, comfortably
// overshooting) still only advances age by 0.1, two spawns due at 0.1 s
// intervals (t=0 and t=0.1), not the five a leftover-based age would owe.
const delayed = new EmitterClock({ delay: ['n', 0.2, 0, 0], timeToLive: ['n', 1, 0, 0], intensity: ['n', 10, 0, 0] }, lcg(7));
out.clock.delayedFirstStep = delayed.step(0.1);
out.clock.delayedSecondStep = delayed.step(0.5);
out.clock.delayedAgeAfterSecondStep = delayed.age;
// EMT-2's other edge: the burst ends at age >= timeToLive, not age > timeToLive.
// A single step landing exactly on timeToLive must not spawn there and must
// already be done, not wait one more tick.
const edge = new EmitterClock({ timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 10, 0, 0] }, lcg(17));
out.clock.edgeSpawnsAtTtl = edge.step(0.1);
out.clock.edgeDoneAtTtl = edge.done;
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

// EMT-5: the same drag=20 as the smoke puff above, but on a *mesh* particle
// carrying a bounding radius (0.1413 m, Fx_RichoStoneDecal's own geometry,
// R8-14) — the engine's law is `pi*r^2*drag` (mass=1, R8-11), not the bare
// `drag` sprites still use, so this barely slows over the same 0.1 s where
// the sprite above lost seven eighths of its speed.
const meshDragSpec = {
  addEmitterSpeed: true, emitterSpeedScale: 1,
  particle: { kind: 'mesh', timeToLive: ['n', 5, 0, 0], drag: ['n', 20, 0, 0],
              gravityModifier: ['n', 0, 0, 0], radius: 0.1413 },
};
const meshDrag = spawnParticle(meshDragSpec, basisFromAxes([0, 0, -1], [0, 1, 0]), [0, 0, 0], [0, 0, -50], lcg(51));
out.meshDrag = { speed0: Math.hypot(...meshDrag.velocity), radius: meshDrag.radius };
for (let i = 0; i < 6; i++) integrateParticle(meshDrag, 1 / 60);
out.meshDrag.speedAfter100ms = Math.hypot(...meshDrag.velocity);

// A mesh particle whose geometry never resolved a radius (0, the
// `spawnParticle` default) falls back to the old bare-drag exponential
// rather than silently losing all drag — k=0 would mean no deceleration at
// all, a worse regression than an approximate one.
const noRadiusSpec = {
  addEmitterSpeed: true, emitterSpeedScale: 1,
  particle: { kind: 'mesh', timeToLive: ['n', 5, 0, 0], drag: ['n', 20, 0, 0],
              gravityModifier: ['n', 0, 0, 0] },
};
const noRadius = spawnParticle(noRadiusSpec, basisFromAxes([0, 0, -1], [0, 1, 0]), [0, 0, 0], [0, 0, -50], lcg(53));
out.noRadius = { speed0: Math.hypot(...noRadius.velocity), radius: noRadius.radius };
for (let i = 0; i < 6; i++) integrateParticle(noRadius, 1 / 60);
out.noRadius.speedAfter100ms = Math.hypot(...noRadius.velocity);

// Texture-atlas flipbooks (SPR-6). fx_expl_core's own numbers: 16 frames,
// initAnimationFrame 8, animationSpeed 70 (frames/second, no ramp) — over its
// full 1 s life that is 8 + 70*1/16 = 12.375, floor 12, still inside the
// strip (every checked vanilla template stays inside its own strip; see
// effects-core.js). 16 frames is a 4x4 grid, so frame 12 is column 0, row 3.
out.atlas = { grid16: atlasGrid(16), grid9: atlasGrid(9), grid5: atlasGrid(5), grid1: atlasGrid(1) };
const explCore = spawnParticle({
  particle: { kind: 'sprite', timeToLive: ['n', 1, 0, 0], numAnimationFrames: 16,
              initAnimationFrame: ['n', 8, 0, 0], animationSpeed: ['n', 70, 0, 0] },
}, ground, [0, 0, 0], null, lcg(43));
out.atlas.explCoreStartFrame = frameIndex(explCore);
integrateParticle(explCore, 1.0);
out.atlas.explCoreFrameAfterOneSecond = explCore.animFrame;
out.atlas.explCoreIndexAfterOneSecond = frameIndex(explCore);
const g16 = atlasGrid(16);
out.atlas.explCoreCell = { col: frameIndex(explCore) % g16.columns, row: Math.floor(frameIndex(explCore) / g16.columns) };
// animationSpeedOverTime must actually scale the rate: a flat 2x ramp over a
// 10-frame strip at speed 10 covers 2 full frames in one second, not 1.
const ramped = spawnParticle({
  particle: { kind: 'sprite', timeToLive: ['n', 10, 0, 0], numAnimationFrames: 10,
              initAnimationFrame: ['n', 0, 0, 0], animationSpeed: ['n', 10, 0, 0],
              animationSpeedOverTime: [[0, 2], [100, 2]] },
}, ground, [0, 0, 0], null, lcg(45));
integrateParticle(ramped, 1.0);
out.atlas.rampedFrameAfterOneSecond = ramped.animFrame;
// frameIndex wraps both directions: 19 of 16 frames comes back as 3; a
// negative accumulator (never produced by integrateParticle on real data,
// but the function must still be safe) comes back positive.
out.atlas.wrapPositive = frameIndex({ spec: { numAnimationFrames: 16 }, animFrame: 19 });
out.atlas.wrapNegative = frameIndex({ spec: { numAnimationFrames: 16 }, animFrame: -1 });
// A non-sprite / non-flipbook particle never touches any of this.
out.atlas.notAnimated = frameIndex({ spec: {}, animFrame: 123 });

// Gravity: a chip with gravityModifier 0.6 falls at 0.6 g.
const chip = spawnParticle({ particle: { kind: 'mesh', timeToLive: ['n', 1, 0, 0], gravityModifier: ['n', 0.6, 0, 0] } },
                           ground, [0, 0, 0], null, lcg(41));
integrateParticle(chip, 0.5);
out.chip = { vy: chip.velocity[1] };

// Damage falloff, the Thompson's 0.5 / 40 / 80.
out.damage = [0, 40, 60, 80, 200].map(x => damageFactor({ minDamage: 0.5, distToStartLoseDamage: 40, distToMinDamage: 80 }, x));
out.damageNone = damageFactor(null, 500);

console.log(JSON.stringify(out));
