/**
 * The pan of a placed voice: DirectSound's amplitude pan, never a head.
 *
 * `viewer/ds3d-pan.js` is the law (ledger SND-30) and the point at which a Web
 * Audio equal-power panner reproduces it; `engine-audio.js` stands every
 * unattached, non-`stereo` voice there. The report this pins was "the tank's
 * machine gun plays out of one speaker" (features/sound-mix-parity, "The
 * pan"): an HRTF panner with Forgotten Hope's coaxial gun 1.15 m off the
 * driver's left shoulder.
 *
 * Stub Web Audio, no browser. Run by `tests/test_ds3d_pan.py`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DS3D_PANNING_MODEL, DS3D_RENDER_RADIUS, configureDs3dPanner, ds3dGains,
  ds3dPanAmount, ds3dRenderAzimuth, ds3dRenderPoint, standDs3dPanner,
} from '../viewer/ds3d-pan.js';
import { EngineAudio } from '../viewer/engine-audio.js';

const VIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dB = v => 20 * Math.log10(v);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** What a Web Audio `equalpower` panner gives a mono input at an azimuth. */
function webEqualPower(azimuth) {
  let deg = azimuth * 180 / Math.PI;
  if (deg < -90) deg = -180 - deg;
  else if (deg > 90) deg = 180 - deg;
  const x = (deg + 90) / 180;
  return { left: Math.cos(x * Math.PI / 2), right: Math.sin(x * Math.PI / 2) };
}

/** The azimuth Web Audio reads for a source, listener at `m`. */
function webAzimuth(m, p) {
  const v = [p.x - m[12], p.y - m[13], p.z - m[14]];
  const right = [m[0], m[1], m[2]], up = [m[4], m[5], m[6]], front = [-m[8], -m[9], -m[10]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const upward = dot(v, up);
  const flat = v.map((c, i) => c - up[i] * upward);
  return Math.atan2(dot(flat, right), dot(flat, front));
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('the law: equal power, centred at 0.707 a side, one side only at 90 degrees', () => {
  assert.equal(DS3D_PANNING_MODEL, 'equalpower');
  assert.ok(near(ds3dPanAmount(0), 0.5));
  assert.ok(near(ds3dGains(0).left, Math.SQRT1_2) && near(ds3dGains(0).right, Math.SQRT1_2));
  assert.deepEqual(ds3dGains(1), { left: 0, right: 1 });
  assert.deepEqual(ds3dGains(-1), { left: 1, right: 0 });
  for (let s = -1; s <= 1; s += 0.05) {
    const g = ds3dGains(s);
    assert.ok(near(g.left * g.left + g.right * g.right, 1), `power at ${s}`);
  }
  // 45 degrees to the right: a = 0.75, a 4.8 dB lean, not an ear.
  const g = ds3dGains(Math.SQRT1_2);
  assert.ok(near(dB(g.right / g.left), 4.771, 1e-3));
  // A number that is not one pans nothing.
  assert.ok(near(ds3dPanAmount(NaN), 0.5));
});

test('the render azimuth makes Web Audio\'s curve give DirectSound\'s gains', () => {
  for (let s = -1; s <= 1.0001; s += 0.01) {
    const want = ds3dGains(s);
    const got = webEqualPower(ds3dRenderAzimuth(s));
    assert.ok(near(got.left, want.left, 1e-9) && near(got.right, want.right, 1e-9), `at ${s}`);
  }
});

test('Forgotten Hope\'s coaxial guns lean, by the measured geometry', () => {
  // Camera frame (x right, y up, -z ahead), `tests/sound_pan_measure.cjs`.
  const cases = [
    ['M4A1Sherman', [-0.70, -0.10, 0.91], -3.8],
    ['Tiger', [1.27, -0.05, 0.93], 6.0],
    ['PanzerIVH', [0.94, -0.10, 0.39], 8.3],
  ];
  for (const [name, at, want] of cases) {
    const g = ds3dGains(at[0] / Math.hypot(...at));
    assert.ok(near(dB(g.right / g.left), want, 0.15), `${name}: ${dB(g.right / g.left)}`);
    const p = ds3dRenderPoint(IDENTITY, ...at, {});
    const web = webEqualPower(webAzimuth(IDENTITY, p));
    assert.ok(near(dB(web.right / web.left), want, 0.15), `${name} rendered`);
  }
});

test('the render point: in front, level, at the radius asked for', () => {
  // Behind and to the left reads as in front and to the left.
  const behind = ds3dRenderPoint(IDENTITY, -1, 0, 2, {});
  assert.ok(behind.x < 0 && behind.z < 0 && near(behind.y, 0));
  assert.ok(near(Math.hypot(behind.x, behind.y, behind.z), DS3D_RENDER_RADIUS));
  // Height does not pan: straight overhead is dead ahead.
  const above = ds3dRenderPoint(IDENTITY, 0, 5, 0, {});
  assert.ok(near(above.x, 0) && near(above.y, 0) && near(above.z, -DS3D_RENDER_RADIUS));
  // At the listener: no side.
  const here = ds3dRenderPoint(IDENTITY, 0, 0, 0, {});
  assert.ok(near(here.x, 0) && near(here.z, -DS3D_RENDER_RADIUS));
  // A null radius keeps the voice's own distance for the panner's curve.
  const kept = ds3dRenderPoint(IDENTITY, 3, 0, -4, {}, null);
  assert.ok(near(Math.hypot(kept.x, kept.y, kept.z), 5));
  // Height counts in the angle: the same offset to the right leans less
  // from far overhead, as the angle off the median plane says.
  const low = ds3dRenderPoint(IDENTITY, 1, 0, 0, {});
  const high = ds3dRenderPoint(IDENTITY, 1, 10, 0, {});
  assert.ok(high.x < low.x && high.x > 0);
});

test('the render point follows the listener\'s own frame', () => {
  // Listener at (10, 2, 5) turned to face +x: right is +z, back is -x.
  const m = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 10, 2, 5, 1];
  const right = ds3dRenderPoint(m, 10, 2, 9, {});       // 4 m to its right
  assert.ok(near(right.x, 10) && near(right.y, 2) && near(right.z, 5 + DS3D_RENDER_RADIUS));
  const ahead = ds3dRenderPoint(m, 30, 2, 5, {});
  assert.ok(near(ahead.x, 10 + DS3D_RENDER_RADIUS) && near(ahead.z, 5));
  // A scaled matrix (a camera under a scaled parent) pans the same.
  const scaled = m.map((v, i) => (i < 12 ? v * 3 : v));
  const again = ds3dRenderPoint(scaled, 10, 2, 9, {});
  assert.ok(near(again.z, right.z) && near(again.x, right.x));
});

test('no listener pose, no render point', () => {
  assert.equal(ds3dRenderPoint(null, 1, 2, 3, {}), null);
  assert.equal(ds3dRenderPoint(undefined, 1, 2, 3, {}), null);
  assert.equal(ds3dRenderPoint([], 1, 2, 3, {}), null);
  assert.equal(ds3dRenderPoint(IDENTITY, NaN, 2, 3, {}), null);
});

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0,
    state: 'running',
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
        maxDistance: 10000, rolloffFactor: 1, channelCount: 2, channelCountMode: 'clamped-max',
        positionX: param(0), positionY: param(0), positionZ: param(0),
      });
    },
    createBufferSource() {
      return node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {}, onended: null });
    },
  };
  return ctx;
}

const buffer = { duration: 1, sampleRate: 44100, length: 44100, numberOfChannels: 1,
                 getChannelData() { return new Float32Array(1); } };

/** Forgotten Hope's `Coaxial_Browning/Sounds/Browning.ssc`, as extracted. */
const COAX = [
  { file: '30calLR', loop: true, volume: 1, minDistance: 1, stereo: true, doppler: false,
    modulators: [{ dest: 'volume', source: 'distance', envelope: 'ramp', params: [1, 1, 1, -1] }] },
  { file: '30calmono', loop: true, volume: 1, minDistance: 6, stereo: false, doppler: false,
    modulators: [{ dest: 'volume', source: 'distance', envelope: 'ramp', params: [1, 1, 0, 1] }] },
];

function coaxPatch(listener) {
  const buffers = new Map([['30calLR', buffer], ['30calmono', buffer]]);
  return new EngineAudio({ engine: 'Coaxial_browning' }, COAX, buffers, listener);
}

const control = (position, listenerPosition) => ({
  dt: 1 / 30, position, quaternion: { x: 0, y: 0, z: 0, w: 1 }, listenerPosition,
  listenerForward: { x: 0, y: 0, z: -1 }, rpm: 0, snap: true,
});

test('a gun patch: the `stereo` layer has no panner, the other an amplitude pan', () => {
  const ctx = stubCtx();
  const audio = coaxPatch({ context: ctx, getInput: () => ctx.createGain(), matrixWorld: { elements: IDENTITY } });
  const groups = [...audio.groups.values()];
  assert.equal(groups.length, 2);
  const panners = groups.map(g => g.panner);
  assert.equal(panners[0], null, 'the stereo layer is a 2D voice');
  assert.equal(panners[1].panningModel, 'equalpower', 'never HRTF');
  assert.equal(panners[1].channelCount, 1, 'a 3D voice is a mono buffer');
  assert.equal(panners[1].channelCountMode, 'explicit');
  assert.equal(panners[1].rolloffFactor, 0, 'the distance law stays the patch\'s own');
});

test('the driver\'s coaxial gun stands where its pan is a lean, not at its own point', () => {
  const ctx = stubCtx();
  const audio = coaxPatch({ context: ctx, getInput: () => ctx.createGain(), matrixWorld: { elements: IDENTITY } });
  audio.start();
  audio.setMaster(1);
  // The M4A1's coaxial Browning from its driver's eye: 1.15 m, behind-left.
  audio.update(control({ x: -0.70, y: -0.10, z: 0.91 }, { x: 0, y: 0, z: 0 }));
  const panner = [...audio.groups.values()][1].panner;
  const at = { x: panner.positionX.value, y: panner.positionY.value, z: panner.positionZ.value };
  assert.ok(at.z < 0, 'in front, though the gun is behind');
  assert.ok(near(at.y, 0));
  const web = webEqualPower(webAzimuth(IDENTITY, at));
  assert.ok(near(dB(web.right / web.left), -3.8, 0.15), `${dB(web.right / web.left)} dB`);
  // The real point through the same panner would lean further still, and the
  // far channel would be near 6 dB down instead of 2.
  const real = webEqualPower(webAzimuth(IDENTITY, { x: -0.70, y: -0.10, z: 0.91 }));
  assert.ok(dB(real.right / real.left) < -5.5);
  // The script's Distance is still the true one: past 1 m, the far layer.
  const [nearVoice, farVoice] = audio.voices;
  assert.equal(nearVoice.targetGain, 0);
  assert.equal(farVoice.targetGain, 1);
  assert.equal(farVoice.rolloff, 1, 'inside its 6 m minimum distance');
});

test('attached, the voice stands dead ahead; with no listener pose, at its own point', () => {
  const ctx = stubCtx();
  const audio = coaxPatch({ context: ctx, getInput: () => ctx.createGain(), matrixWorld: { elements: IDENTITY } });
  audio.start();
  audio.setAttachedToListener(true);
  audio.update(control({ x: -0.70, y: -0.10, z: 0.91 }, { x: 0, y: 0, z: 0 }));
  const attached = [...audio.groups.values()][1].panner;
  assert.deepEqual([attached.positionX.value, attached.positionY.value, attached.positionZ.value], [0, 0, -10]);

  const bare = coaxPatch({ context: ctx, getInput: () => ctx.createGain() });
  bare.start();
  bare.update(control({ x: -0.70, y: -0.10, z: 0.91 }, { x: 0, y: 0, z: 0 }));
  const panner = [...bare.groups.values()][1].panner;
  assert.deepEqual([panner.positionX.value, panner.positionY.value, panner.positionZ.value],
                   [-0.70, -0.10, 0.91]);
});

test('a one-shot panner is configured and stood once, at its own distance', () => {
  const ctx = stubCtx();
  const panner = standDs3dPanner(ctx.createPanner(), IDENTITY, 3, 0, 4);   // behind-right, 5 m
  assert.equal(panner.panningModel, 'equalpower');
  assert.equal(panner.rolloffFactor, 1, 'its distance curve is its caller\'s');
  const at = [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
  assert.ok(near(Math.hypot(...at), 5) && at[0] > 0 && at[2] < 0);
  const bare = standDs3dPanner(ctx.createPanner(), null, 3, 0, 4);
  assert.deepEqual([bare.positionX.value, bare.positionY.value, bare.positionZ.value], [3, 0, 4]);
  // A node that refuses the channel words is still panned by amplitude.
  const stiff = { set channelCount(_) { throw new Error('no'); }, panningModel: 'HRTF' };
  assert.equal(configureDs3dPanner(stiff).panningModel, 'equalpower');
  assert.equal(configureDs3dPanner(null), null);
});

test('no module of the viewer asks for a head', () => {
  const own = fs.readdirSync(VIEWER).filter(f => /\.(js|html)$/.test(f));
  const offenders = own.filter(f =>
    /panningModel\s*=\s*['"]HRTF['"]|setPanningModel\(\s*['"]HRTF/.test(
      fs.readFileSync(path.join(VIEWER, f), 'utf8')));
  assert.deepEqual(offenders, []);
  // Every bare `createPanner()` is configured where it is made.
  for (const f of own) {
    const text = fs.readFileSync(path.join(VIEWER, f), 'utf8');
    const made = (text.match(/createPanner\(\)/g) || []).length;
    const set = (text.match(/configureDs3dPanner\(|standDs3dPanner\(/g) || []).length;
    if (f === 'ds3d-pan.js') continue;
    assert.ok(set >= made, `${f}: ${made} panners made, ${set} configured`);
  }
  // three's PositionalAudio makes an HRTF panner of its own.
  const page = fs.readFileSync(path.join(VIEWER, 'page-audio.js'), 'utf8');
  const positional = (page.match(/new THREE\.PositionalAudio\(/g) || []).length;
  assert.ok(positional >= 1);
  assert.ok((page.match(/configureDs3dPanner\(sound\.panner\)/g) || []).length >= positional);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n${err.stack}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
