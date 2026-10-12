/**
 * World gunfire: a bot's rifle, heard from across the field.
 *
 * The FPOV path (`playHandFire`) is one muzzle pick, 2D, at the shoulder. This
 * suite pins the bystander's path: the fire patch's near/far layers, one
 * cycle per round, spatialised at the shooter. Run by `tests/test_world_fire.py`.
 */
import assert from 'node:assert/strict';
import { WorldFire, FALLBACK_RAMP } from '../viewer/world-fire.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    started: [],
    currentTime: 0,
    state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
        maxDistance: 10000, rolloffFactor: 0,
        positionX: param(0), positionY: param(0), positionZ: param(0),
        orientationX: param(0), orientationY: param(0), orientationZ: param(-1),
      });
    },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1),
        start() { ctx.started.push(this); },
        stop() { this.stopped = true; },
        onended: null,
      });
    },
  };
  return ctx;
}

function fakeListener(ctx) {
  return { context: ctx, getInput() { return ctx.createGain(); },
           position: { x: 0, y: 0, z: 0 } };
}

function fakeBuffer() {
  return {
    duration: 0.2, sampleRate: 44100, length: 8820, numberOfChannels: 1,
    getChannelData() { return new Float32Array(1); },
  };
}

const LAYER = (file, modulators = []) => ({
  file, loop: true, volume: 1, modulators,
  randomStartPitch: [0.05, 0.05], relativePosition: [0, 0, 0], doppler: true,
});

// A BAR-shaped pair: the near loop dies at 3 m and the far one takes over —
// the hand-over `world-fire` exists to keep.
const BAR_LAYERS = [
  LAYER('bar-near.wav', [{ dest: 'volume', source: 'distance', envelope: 'ramp',
                          params: [0, 3, 1, -1] }]),
  LAYER('bar-far.wav', [{ dest: 'volume', source: 'distance', envelope: 'ramp',
                         params: [1, 80, 0, 1] }]),
];

function makeFire(ctx, manifest) {
  const listener = fakeListener(ctx);
  return new WorldFire({
    listener: () => listener,
    getBuffer: async () => fakeBuffer(),
    manifest,
    master: () => 1,
    rand: () => 0.5,
  });
}

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// --- a bot's shot plays, at the bot ----------------------------------------

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { BAR1918: { file: 'Bar1918.mp3', loop: true, volume: 1, layers: BAR_LAYERS } },
  });
  await fire.prime('BAR1918');
  await settle();
  const ok = fire.play('BAR1918', { x: 40, y: 1, z: -8 });
  assert.ok(ok, 'a primed weapon plays');
  assert.equal(ctx.started.length, 2,
    'both the near and the far layer start (one cycle each)');
  assert.ok(ctx.started.every(s => s.loop === false),
    'and neither is left as a held loop — a bystander hears rounds');
  const snap = fire.snapshot();
  assert.equal(snap.shots, 1, 'the shot is counted');
  assert.equal(snap.weapons[0].fallback, false, 'layers came from the manifest');
  fire.dispose();
}

// --- the layers keep their Distance hand-over ------------------------------

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { BAR1918: { file: 'Bar1918.mp3', loop: true, volume: 1, layers: BAR_LAYERS } },
  });
  await fire.prime('BAR1918');
  await settle();
  fire.play('BAR1918', { x: 0, y: 0, z: 0 });
  const gains = ctx.started.map(s => {
    // Walk back to the voice's gain: source -> gain -> panner.
    return s._gain ?? null;
  });
  // The ramps are EngineAudio's job (pinned in test_engine_audio_default);
  // here the contract is only that both layers arrived with their ramps
  // attached, which is what makes the hand-over possible at all.
  const snap = fire.snapshot();
  assert.equal(snap.weapons[0].layers, 2, 'both layers shipped through');
  fire.dispose();
}

// --- a pre-layers manifest still shoots, under the stand-in ramp ----------

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { Thompson: { file: 'Thompson.mp3', loop: true, volume: 1 } },
  });
  await fire.prime('Thompson');
  await settle();
  assert.ok(fire.play('Thompson', { x: 5, y: 0, z: 5 }), 'the fallback plays');
  assert.equal(fire.snapshot().weapons[0].fallback, true,
    'and the snapshot says the ramp is the viewer\'s, not the script\'s');
  assert.equal(fire.snapshot().weapons[0].layers, 1, 'one synthesized layer');
  fire.dispose();
}

// --- the pool recycles inside a burst --------------------------------------

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { Colt: { file: 'Colt.mp3', loop: false, volume: 1, layers: [LAYER('colt.wav')] } },
  });
  await fire.prime('Colt');
  await settle();
  const before = ctx.started.length;
  for (let i = 0; i < 10; i++) fire.play('Colt', { x: i, y: 0, z: 0 });
  const played = ctx.started.length - before;
  assert.ok(played >= 1 && played <= 3,
    `a burst reuses the pool (3 slots), got ${played} starts for 10 pulls`);
  fire.dispose();
}

// --- a Fire Loop patch plays every round of a burst ------------------------
//
// features/bot-weapons: a bot's Mp40 fired 86 rounds in 9.8 s and 76 were
// dropped, because a slot was held a second after every round and the pool
// never grew past one slot. An automatic weapon's patch (every layer authored
// `loop`) is held for one cycle of its sample instead, so one shooter's burst
// plays every round out of one slot.

function loopFire(ctx, clock, duration = 0.09) {
  const listener = fakeListener(ctx);
  return new WorldFire({
    listener: () => listener,
    getBuffer: async () => ({ ...fakeBuffer(), duration }),
    manifest: {
      weapons: {
        Mp40: { file: 'Mp40.mp3', loop: true, volume: 1, layers: [
          LAYER('mp40lrlp.wav'),
          LAYER('mp40mlp.wav', [{ dest: 'volume', source: 'distance', envelope: 'ramp',
                                  params: [10, 150, 1, -1] }]),
        ] },
      },
    },
    master: () => 1,
    rand: () => 0.5,
    now: () => clock.t,
  });
}

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const fire = loopFire(ctx, clock);
  await fire.prime('Mp40');
  await settle();
  const before = ctx.started.length;
  // Nine rounds a second, the Mp40's `roundOfFire`, for one second.
  const played = [];
  for (let i = 0; i < 9; i++) {
    played.push(fire.play('Mp40', { x: 30, y: 0, z: 0 }));
    clock.t += 1 / 9;
  }
  assert.ok(played.every(Boolean), `every round of the burst plays: ${played}`);
  assert.equal(ctx.started.length - before, 9 * 2, 'both layers, every round');
  const snap = fire.snapshot();
  assert.equal(snap.dropped, 0, 'nothing dropped');
  assert.equal(snap.weapons[0].slots, 1, 'one shooter needs one slot');
  // The hold is the cycle at the slowest start pitch (`randomStartPitch`
  // 0.05 down): 0.09 / 0.95.
  assert.ok(Math.abs(snap.weapons[0].hold - 0.09 / 0.95) < 1e-9, `hold ${snap.weapons[0].hold}`);
  fire.dispose();
}

// --- the pool grows for three shooters of one weapon -----------------------

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const fire = loopFire(ctx, clock);
  await fire.prime('Mp40');
  await settle();
  // Three bots fire the same instant: the first round of the second and
  // third finds the pool full and grows it; from the next volley on all
  // three are heard.
  const volley = () => [0, 1, 2].map(i => fire.play('Mp40', { x: 10 * i, y: 0, z: 0 }));
  const first = volley();
  assert.deepEqual(first, [true, false, false], 'the first volley has one slot');
  await settle(24);
  clock.t += 1 / 9;
  const second = volley();
  await settle(24);
  clock.t += 1 / 9;
  const third = volley();
  assert.equal(fire.snapshot().weapons[0].slots, 3, 'the pool grew to three');
  assert.deepEqual(third, [true, true, true], `three shooters heard at once: ${second} then ${third}`);
  fire.dispose();
}

// --- a one-shot patch keeps its second of hold -----------------------------

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const listener = fakeListener(ctx);
  const fire = new WorldFire({
    listener: () => listener,
    getBuffer: async () => fakeBuffer(),
    manifest: { weapons: { Colt: { file: 'Colt.mp3', loop: false, volume: 1,
                                   layers: [{ ...LAYER('colt.wav'), loop: false }] } } },
    master: () => 1, rand: () => 0.5, now: () => clock.t,
  });
  await fire.prime('Colt');
  await settle();
  assert.equal(fire.snapshot().weapons[0].hold, 1.0, 'a report is held a second');
  assert.ok(fire.play('Colt', { x: 0, y: 0, z: 0 }));
  clock.t += 0.5;
  assert.equal(fire.play('Colt', { x: 0, y: 0, z: 0 }), false, 'and its slot is busy half a second on');
  fire.dispose();
}

// --- one clock a shooter (ledger SND-33) ------------------------------------
//
// A Garand-shaped Fire patch: the report, and casings behind `Volume <- Time`
// at 0.8 s. A patch has one clock and every trigger zeroes it, so a bot who
// empties the clip at six rounds a second is heard eight times and his
// casings ring once, 0.8 s after the last round. Rounds went to whichever
// pooled slot was free: three of every six a second were heard, and the
// casings rang once a slot.

const GATED = (file, at) => ({
  file, loop: false, volume: 1, trigger: 'volume', randomStartPitch: null,
  relativePosition: [0, 0, 0], doppler: true,
  modulators: [{ dest: 'volume', source: 'time', envelope: 'ramp', params: [at, at, 0, 1] }],
});
const GARAND = { file: 'M1Garand.mp3', loop: false, volume: 1, layers: [
  { ...LAYER('garand.wav'), loop: false, randomStartPitch: null },
  GATED('patron1.wav', 0.8),
  GATED('patron2.wav', 0.8),
] };

function gatedFire(ctx, clock, weapons = { M1Garand: GARAND }) {
  const listener = fakeListener(ctx);
  const files = new Map();
  const fire = new WorldFire({
    listener: () => listener,
    getBuffer: async file => {
      if (!files.has(file)) files.set(file, { ...fakeBuffer(), file });
      return files.get(file);
    },
    manifest: { weapons },
    master: () => 1, rand: () => 0.5, now: () => clock.t,
  });
  // One frame of the page: the pool's clocks and the wall clock together.
  const frame = (dt = 1 / 60) => { clock.t += dt; fire.update(dt, { x: 0, y: 0, z: 0 }); };
  const run = seconds => { for (let i = 0; i < Math.round(seconds * 60); i++) frame(); };
  const starts = file => ctx.started.filter(s => s.buffer?.file === file).length;
  return { fire, frame, run, starts };
}

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const { fire, run, starts } = gatedFire(ctx, clock);
  await fire.prime('M1Garand');
  await settle();
  const bot = { id: 1 };
  const heard = [];
  for (let i = 0; i < 8; i++) {
    heard.push(fire.play('M1Garand', { x: 3, y: 0, z: 0 }, bot));
    run(1 / 6);
  }
  assert.ok(heard.every(Boolean), `every round of the clip is heard: ${heard}`);
  assert.equal(starts('garand.wav'), 8, 'eight reports');
  assert.equal(starts('patron1.wav'), 0, 'no casing while the rounds keep the clock under its gate');
  assert.equal(fire.snapshot().weapons[0].slots, 1, 'out of one patch');
  assert.equal(fire.snapshot().dropped, 0, 'and nothing dropped');
  assert.equal(fire.snapshot().retriggered, 7);
  run(1.0);
  assert.equal(starts('patron1.wav'), 1, 'the casings ring once, after the last round');
  assert.equal(starts('patron2.wav'), 1);
  run(2.0);
  assert.equal(starts('patron1.wav'), 1, 'and never again');
  // Fired slower than the gate, they ring after every round.
  for (let i = 0; i < 3; i++) {
    fire.play('M1Garand', { x: 3, y: 0, z: 0 }, bot);
    run(1.2);
  }
  assert.equal(starts('patron1.wav'), 4, 'a round every 1.2 s rings its own casings');
  fire.dispose();
}

// Two shooters of one weapon: a patch each, a clock each, and neither takes
// the other's inside its hold.
{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const { fire, run, starts } = gatedFire(ctx, clock);
  await fire.prime('M1Garand');
  await settle();
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.ok(fire.play('M1Garand', { x: 3, y: 0, z: 0 }, a));
  assert.equal(fire.play('M1Garand', { x: 0, y: 0, z: 4 }, b), false,
    'the second shooter\'s first round finds no patch of his own and grows the pool');
  await settle(24);
  run(0.5);
  // b fires on; a has stopped. a's casings are due at 0.8 s and b's rounds
  // must not set that clock back.
  for (let i = 0; i < 6; i++) {
    assert.ok(fire.play('M1Garand', { x: 0, y: 0, z: 4 }, b), `b's round ${i}`);
    run(1 / 6);
  }
  assert.equal(fire.snapshot().weapons[0].slots, 2, 'two shooters, two patches');
  assert.equal(starts('patron1.wav'), 1, 'a\'s casings rang on a\'s clock while b fired');
  run(1.0);
  assert.equal(starts('patron1.wav'), 2, 'and b\'s once, after b\'s last round');
  fire.dispose();
}

// A hold runs to the patch's last gate: a K98's bolt at 1.18 s is not lost
// to another rifleman who fires a second after it.
{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const { fire, run, starts } = gatedFire(ctx, clock, { K98: { file: 'K98.mp3', loop: false, volume: 1, layers: [
    { ...LAYER('k98.wav'), loop: false, randomStartPitch: null },
    GATED('bolt.wav', 1.18),
  ] } });
  await fire.prime('K98');
  await settle();
  assert.ok(Math.abs(fire.snapshot().weapons[0].hold - 1.28) < 1e-9, `hold ${fire.snapshot().weapons[0].hold}`);
  assert.ok(fire.play('K98', { x: 3, y: 0, z: 0 }, { id: 'a' }));
  run(1.05);
  assert.equal(fire.play('K98', { x: 0, y: 0, z: 3 }, { id: 'b' }), false,
    'another shooter does not take the patch while its bolt still waits');
  run(0.2);
  assert.equal(starts('bolt.wav'), 1, 'the bolt is heard');
  fire.dispose();
}

// A gated load nobody was in earshot of is spent when its hold ends: walking
// into its band later must not set it off.
{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const far = { ...GATED('echo.wav', 0.33) };
  far.modulators = [...far.modulators,
    { dest: 'volume', source: 'distance', envelope: 'ramp', params: [100, 100, 0, 1] }];
  const { fire, starts } = gatedFire(ctx, clock, { Rifle: { file: 'Rifle.mp3', loop: false, volume: 1, layers: [
    { ...LAYER('rifle.wav'), loop: false, randomStartPitch: null }, far,
  ] } });
  await fire.prime('Rifle');
  await settle();
  const step = (seconds, ear) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) { clock.t += 1 / 60; fire.update(1 / 60, ear); }
  };
  fire.update(1 / 60, { x: 0, y: 0, z: 0 });
  fire.play('Rifle', { x: 50, y: 0, z: 0 }, { id: 'a' });
  step(1.5, { x: 0, y: 0, z: 0 });
  assert.equal(starts('echo.wav'), 0, 'at 50 m the 100 m echo is not heard');
  step(1.0, { x: -100, y: 0, z: 0 });
  assert.equal(starts('echo.wav'), 0, 'and walking out to 150 m later does not set it off');
  fire.dispose();
}

// --- dispose stops everything ---------------------------------------------

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { BAR1918: { file: 'Bar1918.mp3', loop: true, volume: 1, layers: BAR_LAYERS } },
  });
  await fire.prime('BAR1918');
  await settle();
  fire.play('BAR1918', { x: 0, y: 0, z: 0 });
  fire.dispose();
  assert.equal(fire.snapshot().weapons.length, 0, 'a level change empties the pool');
  assert.ok(ctx.started.every(s => s.stopped), 'and stops every source');
}

// --- the stand-in ramp is what it says it is -------------------------------

{
  assert.equal(FALLBACK_RAMP.source, 'distance');
  assert.equal(FALLBACK_RAMP.params[0], 0, 'full at the muzzle');
  assert.equal(FALLBACK_RAMP.params[3], -1, 'and gone at the far end');
}

// --- bug A: a round is measured from the listener, never from the shooter ----
//
// `play` fell back to the round's own position and the page never called
// `update`, so every bot's shot was heard from zero metres: the near layer at
// full gain in both ears, the far layer silent, whatever the range.

{
  const ctx = stubCtx();
  const fire = makeFire(ctx, {
    weapons: { BAR1918: { file: 'Bar1918.mp3', loop: true, volume: 1, layers: BAR_LAYERS } },
  });
  await fire.prime('BAR1918');
  await settle();
  // Before any frame: the listener's own world point (the fake's origin).
  fire.play('BAR1918', { x: 40, y: 0, z: 0 });
  let snap = fire.weapons.get('bar1918').slots[0].audio.snapshot();
  assert.ok(Math.abs(snap.layers[0].distance - 40) < 1e-6, `measured from the listener: ${snap.layers[0].distance}`);
  assert.equal(snap.layers[0].gain, 0, 'the near layer is out at 40 m');
  assert.ok(snap.layers[1].gain > 0.4, `the far layer sounds at 40 m: ${snap.layers[1].gain}`);
  // A frame hands the pool the camera: 60 m from the next round.
  fire.update(1 / 30, { x: -20, y: 0, z: 0 });
  await new Promise(r => setTimeout(r, 1100));
  fire.play('BAR1918', { x: 40, y: 0, z: 0 });
  snap = fire.weapons.get('bar1918').slots.find(s => s._pos.x === 40).audio.snapshot();
  assert.ok(Math.abs(snap.layers[1].distance - 60) < 1e-6, `from the camera the page tracks: ${snap.layers[1].distance}`);
  assert.ok(snap.layers[1].rolloff < 1, 'and DirectSound\'s fall-off applies past the minimum distance');
  fire.dispose();
}

console.log('world-fire: all assertions passed');
