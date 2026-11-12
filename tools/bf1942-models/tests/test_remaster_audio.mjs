/**
 * Remaster audio's laws and its chain (features/remaster-browser, AUDIO.md):
 * the air-absorption cutoff, the reverb send, the surroundings classifier,
 * the passing round's crack timing, the generated impulse responses, and the
 * chain's insertion behind a panner. Stub Web Audio, no browser. Run by
 * `tests/test_remaster_audio.py`.
 *
 * The retail chain is pinned by `test_ds3d_pan.mjs`; the last test here
 * checks that removing the hook gives it back unchanged.
 */
import assert from 'node:assert/strict';
import {
  AIR_FLOOR, AIR_TOP, CRACK_REACH, OCCLUDED_CUTOFF, OCCLUDED_GAIN, SPACES, SPACE_IRS,
  SPEED_OF_SOUND, WET_AT_10M, airAbsorptionCutoff, classifySurroundings, crackArrival, crackDuration,
  crackGain, generateImpulse, isTreeTemplate, nWave, occlusionFilter, occlusionFromRays,
  occlusionPriority, reportDelay, surveyProbe, wetSendFor,
} from '../viewer/remaster-audio-law.js';
import { RemasterAudio, installRemasterAudio, terrainBlocks, uninstallRemasterAudio }
  from '../viewer/remaster-audio.js';
import { addTree, treesNear } from '../viewer/remaster-audio-world.js';
import {
  DS3D_HARDWARE_PANNING_MODEL, DS3D_PANNING_MODEL, configureDs3dPanner, ds3dPanningModel,
  ds3dRenderPoint, ds3dSpatialHook,
} from '../viewer/ds3d-pan.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// --- a stub Web Audio -----------------------------------------------------------

class Param {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
class Node {
  constructor(ctx) { this.context = ctx; this.outs = new Set(); }
  connect(dest) { this.outs.add(dest); return dest; }
  disconnect(dest) { if (dest) this.outs.delete(dest); else this.outs.clear(); }
}
function stubContext() {
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createGain: () => Object.assign(new Node(ctx), { gain: new Param(1) }),
    createBiquadFilter: () => Object.assign(new Node(ctx), { type: 'lowpass', frequency: new Param(350), Q: new Param(1) }),
    createConvolver: () => Object.assign(new Node(ctx), { buffer: null, normalize: true }),
    createPanner: () => Object.assign(new Node(ctx), {
      panningModel: 'equalpower', positionX: new Param(), positionY: new Param(), positionZ: new Param(),
    }),
    createBufferSource: () => Object.assign(new Node(ctx), { buffer: null, start() {} }),
    createBuffer: (channels, length, rate) => ({
      numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      data: Array.from({ length: channels }, () => new Float32Array(length)),
      copyToChannel(src, c) { this.data[c].set(src); },
    }),
  };
  return ctx;
}

// --- distance -------------------------------------------------------------------

test('air absorption: untouched near, falling with distance, floored', () => {
  assert.equal(airAbsorptionCutoff(0), AIR_TOP);
  assert.equal(airAbsorptionCutoff(15), AIR_TOP);
  near(airAbsorptionCutoff(100), 4823, 5);
  near(airAbsorptionCutoff(400), 1705, 5);
  assert.equal(airAbsorptionCutoff(5000), AIR_FLOOR);
  let last = Infinity;
  for (let d = 0; d <= 3000; d += 25) {
    const f = airAbsorptionCutoff(d);
    assert.ok(f <= last, `monotone at ${d}`);
    last = f;
  }
  assert.equal(airAbsorptionCutoff(NaN), AIR_TOP);
});

test('the reverb send grows with distance and is capped', () => {
  near(wetSendFor(10), WET_AT_10M);
  near(wetSendFor(1), WET_AT_10M * 0.5);
  near(wetSendFor(100), WET_AT_10M * Math.sqrt(10));
  near(wetSendFor(10000), WET_AT_10M * 3.5);
  assert.ok(wetSendFor(50) > wetSendFor(20));
});

// --- occlusion ------------------------------------------------------------------

test('occlusion: rays to amount, amount to filter', () => {
  assert.equal(occlusionFromRays(false), 0);
  assert.equal(occlusionFromRays(true), 1);
  assert.equal(occlusionFromRays(true, false), 0.5);
  assert.equal(occlusionFromRays(true, true), 1);
  near(occlusionFilter(0).cutoff, AIR_TOP);
  near(occlusionFilter(0).gain, 1);
  near(occlusionFilter(1).cutoff, OCCLUDED_CUTOFF);
  near(occlusionFilter(1).gain, OCCLUDED_GAIN);
  const half = occlusionFilter(0.5);
  near(half.cutoff, Math.sqrt(AIR_TOP * OCCLUDED_CUTOFF), 1e-6);
  assert.ok(occlusionPriority(1, 10, 0) > occlusionPriority(1, 200, 0), 'nearer first');
  assert.ok(occlusionPriority(1, 200, 2) > occlusionPriority(1, 10, 0), 'a stale voice climbs');
  assert.equal(occlusionPriority(0, 1, 9), 0, 'a silent voice is never rayed');
});

test('terrain blocks a line under a hill, not over flat ground', () => {
  const hill = (x) => (x > 40 && x < 60 ? 20 : 0);
  assert.equal(terrainBlocks({ x: 0, y: 2, z: 0 }, { x: 100, y: 2, z: 0 }, x => hill(x)), true);
  assert.equal(terrainBlocks({ x: 0, y: 2, z: 0 }, { x: 100, y: 2, z: 0 }, () => 0), false);
  assert.equal(terrainBlocks({ x: 0, y: 30, z: 0 }, { x: 100, y: 30, z: 0 }, x => hill(x)), false);
});

// --- surroundings ---------------------------------------------------------------

const sum = w => w.open + w.woods + w.builtup + w.inside;

test('the classifier: open, woods, built-up, inside', () => {
  const open = classifySurroundings({ overhead: null, walls: Array(8).fill(null), trees: 0 });
  assert.equal(open.open, 1);
  const woods = classifySurroundings({ overhead: null, walls: Array(8).fill(null), trees: 20 });
  assert.ok(woods.woods > 0.99, JSON.stringify(woods));
  const town = classifySurroundings({ overhead: null, walls: [20, null, 25, 30, null, 18, null, 40], trees: 2 });
  assert.ok(town.builtup > 0.99, JSON.stringify(town));
  const room = classifySurroundings({ overhead: 2.5, walls: [3, 4, 3, 5, 3, 4, 3, 5], trees: 30 });
  assert.ok(room.inside > 0.99, JSON.stringify(room));
  const hangar = classifySurroundings({ overhead: 8, walls: [6, null, null, null, 6, null, null, null] });
  assert.ok(hangar.builtup >= 0.5 && hangar.inside < 0.5, JSON.stringify(hangar));
  const sparse = classifySurroundings({ overhead: null, walls: Array(8).fill(null), trees: 10 });
  assert.ok(sparse.woods > 0.4 && sparse.woods < 0.6, JSON.stringify(sparse));
  for (const w of [open, woods, town, room, hangar, sparse]) near(sum(w), 1, 1e-9);
  assert.deepEqual(Object.keys(open).sort(), [...SPACES].sort());
  // A valley's walls count half a building's.
  const cutting = classifySurroundings({ overhead: null, walls: Array(8).fill(null), terrain: 8 });
  assert.ok(cutting.builtup > 0.5);
});

test('a survey of a box room finds a roof and close walls', () => {
  // A 6 x 6 x 3 m room around the origin, ear at 1.6 m.
  const castHull = (ox, oy, oz, dx, dy, dz, max) => {
    let best = null;
    const planes = [[dx, 3 - ox, 3], [dx, -3 - ox, -3], [dz, 3 - oz, 3], [dz, -3 - oz, -3], [dy, 3 - oy, 3]];
    for (const [d, gap] of planes) {
      if (Math.abs(d) < 1e-9) continue;
      const t = gap / d;
      if (t > 0 && t <= max && (best == null || t < best)) best = t;
    }
    return best;
  };
  const probe = surveyProbe({ x: 0, y: 1.6, z: 0 }, { castHull, trees: () => 0 });
  near(probe.overhead, 1.2, 1e-9);
  assert.equal(probe.walls.length, 8);
  assert.ok(probe.walls.every(d => d != null && d < 5));
  assert.ok(classifySurroundings(probe).inside > 0.99);
});

test('trees are counted from a grid within a radius', () => {
  const cells = new Map();
  for (let i = 0; i < 10; i++) addTree(cells, 100 + i * 5, -200);
  addTree(cells, 500, -200);
  assert.equal(treesNear({ cells }, 120, -200, 30), 10);
  assert.equal(treesNear({ cells }, 120, -200, 5), 3);
  assert.equal(treesNear({ cells }, 500, -200, 1), 1);
  assert.ok(isTreeTemplate('PALMHIGH_M1'));
  assert.ok(isTreeTemplate('EU_pine1_M1'));
  assert.ok(isTreeTemplate('Jungle_plantBall_M1'));
  assert.ok(isTreeTemplate('EU_asp3_M1'));
  assert.ok(!isTreeTemplate('tankobs_ste_M1'));
  assert.ok(!isTreeTemplate('stnwall_smlfrench_m1'));
});

// --- the passing round ----------------------------------------------------------

test('a supersonic round cracks before its report, from up-range', () => {
  const v = 800, along = 400, miss = 5;
  const M = v / SPEED_OF_SOUND;
  const k = Math.sqrt(M * M - 1);
  const crack = crackArrival(along, miss, v);
  near(crack.time, (along + miss * k) / v);
  near(crack.emit, along - miss / k);
  near(crack.distance, Math.hypot(miss / k, miss));
  const report = reportDelay(Math.hypot(along, miss));
  near(report, Math.hypot(along, miss) / 343);
  assert.ok(crack.time < report - 0.6, `crack ${crack.time} report ${report}`);
  // The shock reaches the ear no earlier than the round passes it and no
  // later than sound from the emission point would take.
  assert.ok(crack.time >= along / v);
  near(crack.time, crack.emit / v + crack.distance / SPEED_OF_SOUND, 1e-9);
});

test('no crack: subsonic, beside the muzzle, past the round\'s end', () => {
  assert.equal(crackArrival(100, 2, 300), null);
  assert.equal(crackArrival(1, 0.5, 800), null);
  assert.equal(crackArrival(0, 3, 800), null);
  assert.equal(crackArrival(400, 5, 800, 100), null);
  assert.ok(crackArrival(400, 5, 800, 500));
  assert.equal(reportDelay(0), 0);
  assert.equal(reportDelay(NaN), 0);
});

test('the N-wave: longer and quieter with distance off the line', () => {
  assert.ok(crackDuration(20) > crackDuration(1));
  near(crackDuration(1), 0.0002);
  assert.ok(crackGain(2) === 1 && crackGain(20) < crackGain(5));
  assert.ok(CRACK_REACH >= 20);
  const w = nWave(48000, 4);
  let max = -Infinity, min = Infinity, iMax = 0, iMin = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] > max) { max = w[i]; iMax = i; }
    if (w[i] < min) { min = w[i]; iMin = i; }
  }
  assert.ok(iMax < iMin, 'over-pressure first, then under');
  assert.ok(max > 0.9 && min < -0.9);
  assert.ok(iMin - iMax < 48, 'a fraction of a millisecond');
});

// --- the impulse responses ------------------------------------------------------

test('each space\'s impulse is its level in energy and decays', () => {
  for (const name of SPACES) {
    const p = SPACE_IRS[name];
    const [l, r] = generateImpulse(8000, p, 5);
    assert.equal(l.length, r.length);
    near(l.length / 8000, Math.min(2.2, p.rt60 * 1.15 + p.predelay), 1 / 8000 + 1e-9);
    let e = 0;
    for (let i = 0; i < l.length; i++) e += l[i] * l[i] + r[i] * r[i];
    near(Math.sqrt(e), p.level, 1e-4);
    const rms = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += l[i] * l[i];
      return Math.sqrt(s / (b - a));
    };
    const q = Math.floor(l.length / 4);
    assert.ok(rms(3 * q, l.length) < rms(0, q) * 0.3, `${name} decays`);
    // Two channels, not one copied.
    let same = 0;
    for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same += 1;
    assert.ok(same < l.length * 0.5, `${name} is decorrelated`);
  }
  const a = generateImpulse(8000, SPACE_IRS.woods, 3)[0];
  const b = generateImpulse(8000, SPACE_IRS.woods, 3)[0];
  assert.deepEqual(a, b, 'repeatable');
  assert.ok(SPACE_IRS.inside.rt60 < SPACE_IRS.builtup.rt60);
  assert.ok(SPACE_IRS.woods.rt60 > SPACE_IRS.open.rt60);
});

// --- the chain ------------------------------------------------------------------

test('a panner is adopted: chain between it and its node, taps refcounted, released on disconnect', () => {
  const ctx = stubContext();
  const input = new Node(ctx);
  const remaster = installRemasterAudio({ context: ctx, input });
  try {
    assert.equal(ds3dSpatialHook(), remaster);
    assert.equal(ds3dPanningModel(), DS3D_HARDWARE_PANNING_MODEL);
    const bus = Object.assign(new Node(ctx), { gain: new Param(1) });
    const p1 = configureDs3dPanner(ctx.createPanner());
    const p2 = configureDs3dPanner(ctx.createPanner());
    assert.equal(p1.panningModel, DS3D_HARDWARE_PANNING_MODEL);
    p1.positionX.value = 100;
    p1.connect(bus);
    p2.connect(bus);
    assert.ok(!p1.outs.has(bus), 'not straight to the bus');
    const voice = p1.__remaster;
    assert.ok(p1.outs.has(voice.air) && voice.gain.outs.has(bus));
    assert.equal(remaster.taps.size, 1, 'one tap for the bus');
    assert.ok([...bus.outs].some(n => remaster.taps.get(bus).node === n));
    remaster.update(1 / 60, { x: 0, y: 0, z: 0 }, null);
    near(voice.distance, 100);
    near(voice.air.frequency.value, airAbsorptionCutoff(100), 1e-6);
    p1.disconnect();
    assert.equal(remaster.taps.size, 1);
    p2.disconnect();
    assert.equal(remaster.taps.size, 0, 'the last voice takes the tap with it');
    assert.equal(remaster.voices.size, 0);
    // A one-shot straight to the listener gets its own wet send.
    const p3 = configureDs3dPanner(ctx.createPanner());
    p3.connect(input);
    assert.ok(p3.__remaster.wet && p3.__remaster.wet.outs.has(remaster.reverbIn));
    // A render point is the real point while the hook is in.
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    assert.deepEqual(ds3dRenderPoint(m, 5, 2, -7, {}), { x: 5, y: 2, z: -7 });
  } finally {
    uninstallRemasterAudio();
  }
  assert.equal(ds3dSpatialHook(), null);
  assert.equal(ds3dPanningModel(), DS3D_PANNING_MODEL, 'the retail pan, back');
  const retail = configureDs3dPanner(ctx.createPanner());
  assert.equal(retail.__remaster, undefined, 'never adopted without the hook');
});

test('occlusion: a wall between ear and source, and over it', () => {
  const ctx = stubContext();
  const remaster = new RemasterAudio({ context: ctx, input: new Node(ctx) });
  // A wall at x = 10, 2 m high.
  const castHull = (ox, oy, oz, dx, dy, dz, max) => {
    if (dx <= 0) return null;
    const t = (10 - ox) / dx;
    if (t > max) return null;
    return oy + dy * t < 2 ? t : null;
  };
  const env = { castHull, groundAt: () => 0 };
  assert.equal(remaster.occlusionOf({ x: 0, y: 1.6, z: 0 }, { x: 30, y: 1, z: 0 }, env), 0.5);
  assert.equal(remaster.occlusionOf({ x: 0, y: 1.6, z: 0 }, { x: 30, y: 10, z: 0 }, env), 0);
  assert.equal(remaster.occlusionOf({ x: 0, y: 1.6, z: 0 }, { x: -30, y: 1, z: 0 }, env), 0);
  const tall = { castHull: (ox, oy, oz, dx) => (dx > 0 ? (10 - ox) / dx : null), groundAt: () => 0 };
  assert.equal(remaster.occlusionOf({ x: 0, y: 1.6, z: 0 }, { x: 30, y: 1, z: 0 }, tall), 1);
  remaster.dispose();
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n${e.stack}`);
  }
}
if (failed) {
  console.log(`${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`${tests.length} passed`);
