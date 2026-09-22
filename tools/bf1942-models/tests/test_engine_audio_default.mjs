/**
 * Land engine `.ssc` scripts modulate Pitch/Volume on `controlSource Default`.
 * That channel must track the same normalised rpm the viewer already feeds as
 * `engine::rpm` — a constant 1 freezes every jeep/Sherman layer at full song.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EngineAudio } from '../viewer/engine-audio.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
  });
  const node = (extra = {}) => ({
    connect() { return this; },
    disconnect() {},
    ...extra,
  });
  const ctx = {
    started: [],
    currentTime: 0,
    // Real Web Audio starts a fresh context `suspended` until a user gesture;
    // tests that do not care about that default to already running.
    state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 10000,
        rolloffFactor: 0,
        positionX: param(0), positionY: param(0), positionZ: param(0),
        orientationX: param(0), orientationY: param(0), orientationZ: param(-1),
      });
    },
    createBufferSource() {
      const source = node({
        buffer: null,
        loop: false,
        playbackRate: param(1),
        start() { ctx.started.push(this); },
        stop() { this.stopped = true; },
        onended: null,
      });
      return source;
    },
  };
  return ctx;
}

function fakeListener(ctx) {
  return { context: ctx, getInput() { return ctx.createGain(); } };
}

function fakeBuffer() {
  return {
    duration: 1, sampleRate: 44100, length: 44100, numberOfChannels: 1,
    getChannelData() { return new Float32Array(1); },
  };
}

function layer(file, modulators) {
  return {
    file, loop: true, volume: 1, modulators,
    randomStartPitch: [0, 0], relativePosition: [0, 0, 0], doppler: true,
  };
}

function run(layers, rpm) {
  const ctx = stubCtx();
  const buffers = new Map(layers.map(l => [l.file, fakeBuffer()]));
  const audio = new EngineAudio(
    { template: 'Willy', engine: 'WillyEngine', layers },
    layers,
    buffers,
    fakeListener(ctx),
  );
  audio.start();
  audio.setMaster(1);
  audio.update({
    dt: 1 / 30, rpm, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  return audio;
}

const WILLY_MAIN = layer('main.wav', [
  { dest: 'pitch', source: 'default', envelope: 'linear', params: [0.45, 0.55] },
]);
const WILLY_HI = layer('hi.wav', [
  { dest: 'volume', source: 'default', envelope: 'ramp', params: [0.55, 1, 0, 1] },
  { dest: 'pitch', source: 'default', envelope: 'linear', params: [0.65, 0.2] },
]);

{
  const audio = run([WILLY_MAIN], 0);
  const rate = audio.snapshot().layers[0].playbackRate;
  assert.ok(Math.abs(rate - 0.45) < 0.05,
    `idle Default must pitch the main loop near 0.45, got ${rate}`);
  audio.dispose();
}

{
  const audio = run([WILLY_MAIN], 1);
  const rate = audio.snapshot().layers[0].playbackRate;
  assert.ok(Math.abs(rate - 1.0) < 0.05,
    `full Default must pitch the main loop near 1.0, got ${rate}`);
  audio.dispose();
}

{
  const idle = run([WILLY_HI], 0);
  assert.ok(idle.snapshot().layers[0].gain < 0.05,
    `hi-rpm layer must be silent at Default 0, got ${idle.snapshot().layers[0].gain}`);
  idle.dispose();

  const full = run([WILLY_HI], 1);
  assert.ok(full.snapshot().layers[0].gain > 0.9,
    `hi-rpm layer must be up at Default 1, got ${full.snapshot().layers[0].gain}`);
  full.dispose();
}

// --- a gun patch is a one-shot event, not a loop to un-mute -----------------
//
// Every layer of every vehicle weapon on Aberdeen is `loop: false` (the
// Sherman's cannon is twenty of them: muzzle blast, casing, crew, breech).
// `start()` used to fire the lot once, inaudibly, at the moment the patch was
// built, `onended` cleared each voice, and the gain gate in `map.html` then
// had nothing running left to un-mute -- so no vehicle gun in the viewer ever
// made a sound. `oneShotsOnTrigger` holds them back for `trigger()`.

function shot(file) {
  return {
    file, loop: false, volume: 1, modulators: [],
    randomStartPitch: [0, 0], relativePosition: [0, 0, 0], doppler: false,
  };
}

function gunPatch(layers, { oneShotsOnTrigger = true } = {}) {
  const ctx = stubCtx();
  const buffers = new Map(layers.map(l => [l.file, fakeBuffer()]));
  const audio = new EngineAudio(
    { template: 'Sherman', engine: 'ShermanGunBarrel', layers },
    layers, buffers, fakeListener(ctx), 1, oneShotsOnTrigger,
  );
  return { ctx, audio };
}

{
  const { ctx, audio } = gunPatch([shot('bang.wav'), shot('breech.wav')]);
  audio.start();
  assert.equal(ctx.started.length, 0,
    'a gun patch must make no sound until a round is fired');
  const played = audio.trigger();
  assert.equal(played, 2, `a round plays every one-shot, got ${played}`);
  assert.equal(ctx.started.length, 2, 'both layers must actually start');
  audio.dispose();
}

{
  // The old behaviour is still what an ENGINE patch needs: a starter cough
  // fires the moment the engine does.
  const { ctx, audio } = gunPatch([shot('starter.wav')], { oneShotsOnTrigger: false });
  audio.start();
  assert.equal(ctx.started.length, 1,
    'an engine one-shot must still play on start()');
  audio.dispose();
}

{
  // A burst stacks rather than cutting its own tail: the previous source is
  // orphaned to play out while a new one takes the voice's slot.
  const { ctx, audio } = gunPatch([shot('mg.wav')]);
  audio.start();
  audio.trigger();
  audio.trigger();
  audio.trigger();
  assert.equal(ctx.started.length, 3, 'every round starts its own source');
  assert.ok(!ctx.started.some(s => s.stopped),
    'a round in flight must not be cut short by the next one');
  audio.dispose();
}

{
  // The patch's own clock restarts with the round, because a gun `.ssc`
  // sequences its layers off `Time` measured from the shot.
  const { audio } = gunPatch([shot('bang.wav')]);
  audio.start();
  audio.update({
    dt: 0.5, rpm: 0, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  assert.ok(audio.snapshot().elapsed > 0.4, 'the clock runs between rounds');
  audio.trigger();
  assert.equal(audio.snapshot().elapsed, 0, 'and restarts with the round');
  audio.dispose();
}

{
  // `hasLoops` is what tells `map.html` whether gating the master on the
  // trigger means anything for this patch.
  const oneShots = gunPatch([shot('bang.wav')]);
  assert.equal(oneShots.audio.hasLoops, false);
  oneShots.audio.dispose();
  const looped = gunPatch([WILLY_MAIN]);
  assert.equal(looped.audio.hasLoops, true);
  looped.audio.dispose();
}

{
  // `trigger Volume` plays on the volume's first rise, once per round. The
  // shape is a PanzerIV cannon layer's own: a step `Time` ramp that trips at
  // 0.06 s and then stays at 1. The old gate ("no source, some volume")
  // replayed it every time the sample ended, for as long as the patch lived.
  const delayed = {
    ...shot('blast.wav'), trigger: 'volume',
    modulators: [
      { dest: 'volume', source: 'time', envelope: 'ramp', params: [0.06, 0.06, 0, 1] },
    ],
  };
  const { ctx, audio } = gunPatch([delayed]);
  const tick = dt => audio.update({
    dt, rpm: 0, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  const endAll = () => {
    for (const source of ctx.started) source.onended?.();
  };
  audio.start();
  tick(1);
  assert.equal(ctx.started.length, 0,
    'a gun patch built long ago must not sound before its first round');
  audio.trigger();
  assert.equal(ctx.started.length, 0, 'the layer waits for its own ramp');
  tick(0.03);
  assert.equal(ctx.started.length, 0, 'still inside the delay');
  tick(0.05);
  assert.equal(ctx.started.length, 1, 'and plays as the ramp trips');
  endAll();
  tick(0.5);
  tick(0.5);
  assert.equal(ctx.started.length, 1,
    'a sample that has ended must not replay while its volume stays up');
  audio.trigger();
  tick(0.1);
  assert.equal(ctx.started.length, 2, 'the next round plays it again, once');
  audio.dispose();
}

{
  // Off a gun, the latch re-arms when the volume falls back to zero: each
  // rise is its own event, and one rise is still one play.
  const gated = {
    ...shot('whine.wav'), trigger: 'volume',
    modulators: [
      { dest: 'volume', source: 'default', envelope: 'ramp', params: [0.5, 0.5, 0, 1] },
    ],
  };
  const { ctx, audio } = gunPatch([gated], { oneShotsOnTrigger: false });
  const tick = rpm => audio.update({
    dt: 1 / 30, rpm, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  audio.start();
  tick(0);
  assert.equal(ctx.started.length, 0, 'silent below the ramp');
  tick(1);
  assert.equal(ctx.started.length, 1, 'plays on the rise');
  for (const source of ctx.started) source.onended?.();
  tick(1);
  assert.equal(ctx.started.length, 1, 'and not again while it stays up');
  tick(0);
  tick(1);
  assert.equal(ctx.started.length, 2, 'a second rise is a second event');
  audio.dispose();
}

// --- a suspended context drops one-shots instead of queuing them ----------
//
// The ordinary state before the page's first gesture. Queuing at a frozen
// `currentTime` is how ten triggers become twenty sources that all sound
// together the instant the context wakes (S4 gap 2); a one-shot asked for
// while suspended is simply lost instead.

{
  const { ctx, audio } = gunPatch([shot('bang.wav'), shot('breech.wav')]);
  ctx.state = 'suspended';
  audio.start();
  const played = audio.trigger();
  assert.equal(played, 0, 'a suspended context drops the round, not queues it');
  assert.equal(ctx.started.length, 0, 'no source is ever created for it');
  assert.equal(audio.snapshot().suspended, 2, 'both layers counted as lost');
  ctx.state = 'running';
  const after = audio.trigger();
  assert.equal(after, 2, 'the next round, once running, plays normally');
  audio.dispose();
}

{
  // A vehicle engine's own loop must still begin once the context can render
  // it, even though `start()` was called while suspended -- the one thing a
  // fix here must not break.
  const ctx = stubCtx();
  ctx.state = 'suspended';
  const buffers = new Map([[WILLY_MAIN.file, fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Willy', engine: 'WillyEngine', layers: [WILLY_MAIN] },
    [WILLY_MAIN], buffers, fakeListener(ctx));
  audio.start();
  assert.equal(ctx.started.length, 0,
    'a loop cannot render into a suspended context');
  assert.equal(audio.snapshot().pendingLoops, 1,
    'and is remembered instead of lost');
  ctx.state = 'running';
  audio.setMaster(1);
  const tick = () => audio.update({
    dt: 1 / 30, rpm: 1, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  tick();
  assert.equal(ctx.started.length, 1,
    'and starts for real the first frame the context wakes');
  assert.equal(audio.snapshot().pendingLoops, 0);
  tick();
  assert.equal(ctx.started.length, 1, 'and only once -- a loop, not retriggered');
  audio.dispose();
}

{
  // A patch cut while its loop is still waiting for the context to wake must
  // not spring to life later -- a level change silencing a wreck's fire has
  // to be the end of it, resume or not.
  const ctx = stubCtx();
  ctx.state = 'suspended';
  const buffers = new Map([[WILLY_MAIN.file, fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Willy', engine: 'WillyEngine', layers: [WILLY_MAIN] },
    [WILLY_MAIN], buffers, fakeListener(ctx));
  audio.start();
  audio.silence();
  ctx.state = 'running';
  audio.setMaster(1);
  audio.update({
    dt: 1 / 30, rpm: 1, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  assert.equal(ctx.started.length, 0,
    'a silenced patch must not start its pending loop on resume');
  audio.dispose();
}

// --- the engine bus plays the authored mix -----------------------------------
//
// It used to be scaled by 0.28, the worst-case concurrent layer sum of a
// Corsair heard from its own cockpit, which left a Sherman idling at a peak of
// 0.089 with the master at 0.7 — under a fifth of the BAR in the same scene.
// The clipping that constant existed to prevent is now the listener's
// limiter's job (`map.html`'s `ensureListener`), so the bus passes the `.ssc`
// volumes through.
{
  const ctx = stubCtx();
  const layers = [WILLY_MAIN];
  const buffers = new Map([[WILLY_MAIN.file, fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Willy', engine: 'WillyEngine', layers }, layers, buffers,
    fakeListener(ctx));
  audio.start();
  audio.setMaster(0.7);
  audio.update({
    dt: 1 / 30, rpm: 1, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  assert.equal(audio.headroom, 1, 'the engine bus carries no divisor of its own');
  assert.ok(Math.abs(audio.bus.gain.value - 0.7) < 1e-9,
    `the bus is the master, unscaled: ${audio.bus.gain.value}`);
  audio.dispose();
}

{
  // A caller that wants its own scale still gets it: the gun patches pass
  // WEAPON_HEADROOM, and `effect-audio.js` its own pooled figure.
  const ctx = stubCtx();
  const layers = [WILLY_MAIN];
  const buffers = new Map([[WILLY_MAIN.file, fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Willy', engine: 'WillyEngine', layers }, layers, buffers,
    fakeListener(ctx), 0.75);
  audio.start();
  audio.setMaster(0.8);
  audio.update({
    dt: 1 / 30, rpm: 1, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  assert.ok(Math.abs(audio.bus.gain.value - 0.6) < 1e-9,
    `an explicit headroom still scales the bus: ${audio.bus.gain.value}`);
  audio.dispose();
}

// --- a near/far pair hands over on the real distance, `stereo` included ------
//
// `mg42.ssc`'s Fire Loop is two loads of one 114 ms `MG42_fire.wav`: a `stereo`
// near layer at `Volume <- Distance ramp 1/1/1/-1` (1 below a metre, 0 above)
// and a spatialised far layer at the exact complement, `1/1/0/1`. Exactly one
// of them is ever meant to sound.
//
// `stereo` used to short-circuit the group bookkeeping and hand the voice a
// throwaway group frozen at `distance: 0`, so the near layer read "below a
// metre" wherever the listener actually was. At the gunner's real 1.4 m both
// halves then ran at full gain -- two coherent copies of one short buffer,
// +6 dB and flanging, which is the drone the "tank machine gun sounds like a
// car horn" report was about. Aircraft escaped it because their far pair is
// gated at 4 m and never came in at cockpit range.

function pairLayer(stereo, params) {
  return {
    file: 'mg42.wav', loop: true, volume: 1, stereo, doppler: false,
    randomStartPitch: [0, 0], relativePosition: [0, 0, -1],
    modulators: [
      { dest: 'volume', source: 'distance', envelope: 'ramp', params },
    ],
  };
}

function pairAt(distance) {
  const layers = [pairLayer(true, [1, 1, 1, -1]), pairLayer(false, [1, 1, 0, 1])];
  const ctx = stubCtx();
  const buffers = new Map([['mg42.wav', fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'PanzerIV', engine: 'Coaxial_MG42', layers }, layers, buffers,
    fakeListener(ctx), 0.75, true);
  audio.start();
  audio.setMaster(0.7);
  // Two frames: the first primes each group's distance, the second reads it.
  for (let i = 0; i < 2; i++) {
    audio.update({
      dt: 1 / 60, rpm: 0, speed: 0, acceleration: 0, diveAngle: 0,
      // The voice offset is [0,0,-1], so a listener at `-1 + distance` stands
      // exactly `distance` from the sound.
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      listenerPosition: { x: 0, y: 0, z: -1 + distance },
    });
  }
  const snap = audio.snapshot();
  audio.dispose();
  return { gains: snap.layers.map(l => l.gain),
           distances: snap.layers.map(l => l.distance) };
}

{
  const near = pairAt(0.5);
  assert.ok(Math.abs(near.distances[0] - 0.5) < 1e-6,
    `a stereo layer must carry the real distance, got ${near.distances[0]}`);
  assert.ok(near.gains[0] > 0.9 && near.gains[1] < 1e-6,
    `inside a metre only the near half sounds, got ${near.gains}`);

  const far = pairAt(1.4);
  assert.ok(Math.abs(far.distances[0] - 1.4) < 1e-6,
    `and it must track the listener, got ${far.distances[0]}`);
  assert.ok(far.gains[0] < 1e-6 && far.gains[1] > 0.9,
    `past a metre only the far half sounds, got ${far.gains}`);
}

{
  // A stereo layer still gets no panner -- `stereo` is about panning, and HRTF
  // at 1.2 m is wrong when the data says 2D. It shares the bus instead.
  const layers = [pairLayer(true, [1, 1, 1, -1])];
  const ctx = stubCtx();
  const buffers = new Map([['mg42.wav', fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'PanzerIV', engine: 'Coaxial_MG42', layers }, layers, buffers,
    fakeListener(ctx), 0.75, true);
  assert.equal(audio.groups.size, 1, 'a stereo layer gets a group');
  assert.equal([...audio.groups.values()][0].panner, null,
    'but no panner: it is played 2D');
  audio.dispose();
}

// --- one voice never plays above unity --------------------------------------
//
// `Coaxial_Browning/Sounds/High.ssc` says `volume 10`. Across the 23 vanilla
// levels that is one of three authoring outliers -- 5,458 of 5,484 layers are
// at or below 1 -- and read literally it put the Sherman's and M10's coaxial
// Browning 20 dB hot: measured pre-limiter peak 5.02 and RMS 1.51 against
// 0.596/0.185 for the BAR in the same scene, which drove the master limiter
// 14 dB into 20:1 and flattened a 7.7 Hz periodic comb into a honk.

function gainOf(layer, headroom = 0.75, oneShots = true) {
  const layers = [layer];
  const ctx = stubCtx();
  const buffers = new Map([[layer.file, fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Sherman', engine: 'Coaxial_browning', layers }, layers,
    buffers, fakeListener(ctx), headroom, oneShots);
  audio.start();
  audio.setMaster(1);
  audio.update({
    dt: 1 / 60, rpm: 1, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  const gain = audio.snapshot().layers[0].gain;
  audio.dispose();
  return gain;
}

{
  assert.equal(gainOf({
    file: 'brownmlp.wav', loop: true, volume: 10, stereo: true, doppler: false,
    randomStartPitch: null, relativePosition: [0, 0, 0], modulators: [],
  }), 1, 'an authored volume above unity is clamped, not multiplied');

  // The clamp is on the modulated result, so a ramp that itself overshoots
  // cannot get round it either.
  assert.equal(gainOf({
    file: 'x.wav', loop: true, volume: 0.6, stereo: true, doppler: false,
    randomStartPitch: null, relativePosition: [0, 0, 0],
    modulators: [
      { dest: 'volume', source: 'default', envelope: 'linear', params: [4, 0] },
    ],
  }), 1, 'a modulator overshoot is clamped too');

  // And everything the scripts actually author is untouched.
  const quiet = gainOf({
    file: 'x.wav', loop: true, volume: 0.6, stereo: true, doppler: false,
    randomStartPitch: null, relativePosition: [0, 0, 0], modulators: [],
  });
  assert.ok(Math.abs(quiet - 0.6) < 1e-9,
    `a sub-unity volume is left alone, got ${quiet}`);
}


// --- the car horn: two coherent copies of one sample ------------------------
//
// THE INVARIANT THIS SECTION EXISTS TO HOLD, in one sentence:
//
//   **No two voices of a patch may sound at once out of the same sample, at
//   the same point in space, at the same playback rate.**
//
// That is not a style rule, it is the whole of the "the tank's machine gun
// sounds like a car horn" report, and it has now arrived by three unrelated
// routes: a `stereo` layer's Distance channel frozen at 0 (2026-09-21), a
// `volume 10` outlier read literally (2026-09-21), and two `Volume <-
// Distance` ramps whose bands simply overlap where the gunner's head is
// (2026-09-23). Each fix closed its own route; the bug came back through the
// next one. So assert the invariant, not the route.
//
// Why it sounds like a horn: `#play` starts a loop at a random point in its
// own buffer, so two copies of one sample sum at a FIXED random phase offset
// — a static comb filter over the whole spectrum, and on a 114 ms loop
// (`brownmlp`, `MG42_fire`) the comb is already at 8.8 Hz. Measured on the
// Sherman's coaxial Browning through the page's own limiter, ten renders of
// the same patch at the same distance: tonality 57.1..81.4 before (a
// different draw of the comb every session, which is why this reads as
// intermittent) against 61.6..62.9 after, which is the single-layer baseline
// the same patch measures at 8 m.

function twin(file, { offset = [0, 0, 0], priority = 0, stereo = false,
                      volume = 1, rate = null, band = null } = {}) {
  const modulators = [];
  if (band) {
    modulators.push({ dest: 'volume', source: 'distance', envelope: 'ramp', params: band });
  }
  if (rate !== null) {
    modulators.push({ dest: 'pitch', source: 'default', envelope: 'linear', params: [rate, 0] });
  }
  return {
    file, loop: true, volume, priority, stereo, doppler: false,
    randomStartPitch: null, relativePosition: offset, modulators,
  };
}

/** One frame of a patch at `distance` metres, as `{gain, rate, suppressed}[]`. */
function atDistance(layers, distance, { oneShots = false, rpm = 0 } = {}) {
  const ctx = stubCtx();
  const buffers = new Map(layers.map(l => [l.file, fakeBuffer()]));
  const audio = new EngineAudio(
    { template: 'Sherman', engine: 'Coaxial_browning', layers },
    layers, buffers, fakeListener(ctx), 1, oneShots, () => 0.5);
  audio.start();
  audio.setMaster(1);
  audio.update({
    dt: 1 / 60, rpm, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: distance, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  const out = audio.snapshot().layers;
  audio.dispose();
  return out;
}

// `Objects/Stationary_Weapons/Coaxial_Browning/Sounds/Browning.ssc`, verbatim
// in the shape `extract_map.py` ships it: one `brownmlp` held below 2 m and a
// second `brownmlp` held above 1 m, at one offset. 1 m..2 m is authored with
// both at full, and the driver's camera sits 1.4 m from the coax node.
const COAX_NEAR = twin('brownmlp.mp3', { priority: 10, stereo: true, volume: 10,
                                         band: [2, 2, 1, -1] });
const COAX_FAR = twin('brownmlp.mp3', { priority: 8, band: [1, 1, 0, 1] });

{
  for (const d of [0.2, 0.5, 1.0, 1.2, 1.4, 1.6, 1.9, 2.0, 2.4, 3, 6, 20, 150]) {
    const [near, far] = atDistance([COAX_NEAR, COAX_FAR], d);
    assert.ok(!(near.gain > 0.02 && far.gain > 0.02),
      `the coaxial Browning doubles on itself at ${d} m: `
      + `near ${near.gain}, far ${far.gain} — this is the car horn`);
    // ...and the hand-over must not become a hole: something always sounds.
    assert.ok(near.gain > 0.9 || far.gain > 0.9,
      `the hand-over went silent at ${d} m (${near.gain} / ${far.gain})`);
  }
  // Inside the overlap the script's own `priority` picks the winner: the near
  // layer is 10 against the far layer's 8, and at 1.4 m you are on top of it.
  const [near, far] = atDistance([COAX_NEAR, COAX_FAR], 1.4);
  assert.equal(near.gain, 1, 'the higher-priority half keeps its gain');
  assert.equal(far.gain, 0, 'the lower-priority half is the one that goes');
  assert.equal(far.suppressed, true, 'and it is reported as arbitrated away');
  assert.equal(near.suppressed, false);
  // Outside it, nothing is arbitrated at all — the ramps already agree.
  const [outNear, outFar] = atDistance([COAX_NEAR, COAX_FAR], 20);
  assert.equal(outFar.gain, 1, 'past the hand-over the far layer carries it');
  assert.equal(outFar.suppressed, false, 'and nothing was suppressed to get there');
  assert.equal(outNear.gain, 0);
}

{
  // **The thing this must never touch.** Refractor builds a rich engine by
  // stacking ONE sample at DIFFERENT pitches, and those copies beat and smear
  // each other instead of combing — that is the authored sound. The Willy
  // runs two loads of `WillyHiRPM2` at rates 0.40 and 0.875; the T34 two of
  // `t34eng2` 0.9% apart, the tightest authored detune in the vanilla set.
  const willy = atDistance([twin('WillyHiRPM2.mp3', { rate: 0.4 }),
                            twin('WillyHiRPM2.mp3', { rate: 0.875 })], 4, { rpm: 1 });
  assert.ok(willy.every(l => l.gain > 0.9 && !l.suppressed),
    `a detuned stack is the engine's own sound and must survive: `
    + `${JSON.stringify(willy.map(l => l.gain))}`);

  const t34 = atDistance([twin('t34eng2.mp3', { rate: 1.0 }),
                          twin('t34eng2.mp3', { rate: 0.991 })], 4, { rpm: 1 });
  assert.ok(t34.every(l => l.gain > 0.9 && !l.suppressed),
    'a 0.9% detune is authored, not a duplicate');

  // A rate that really is the same, though, is the defect however small the
  // gap: 0.1% apart is one buffer with a slow phase creep, still a comb.
  const locked = atDistance([twin('t34eng2.mp3', { rate: 1.0 }),
                             twin('t34eng2.mp3', { rate: 1.001 })], 4, { rpm: 1 });
  assert.equal(locked.filter(l => l.gain > 0.02).length, 1,
    'two copies at effectively one rate are one voice');
}

{
  // Two DIFFERENT samples at one offset are a mix, not a duplicate — the
  // Spitfire's cockpit pair (SFMG1 6.53 Hz, SFMG2 13.61 Hz: incommensurate
  // combs that smear each other) is the known-good control this whole
  // investigation measured against, and it must measure the same after.
  const spit = atDistance([twin('SFMG1.mp3', { priority: 10 }),
                           twin('SFMG2.mp3', { priority: 8 })], 1.4);
  assert.ok(spit.every(l => l.gain > 0.9 && !l.suppressed),
    'two different samples at one point never contest');

  // And one sample at two DIFFERENT points is a stereo spread, not a
  // duplicate: the Sherman cannon fires `aafire` from +-1.4 m deliberately.
  const spread = atDistance([twin('aafire.mp3', { offset: [1.4, 0.4, 0] }),
                             twin('aafire.mp3', { offset: [-1.4, 0.4, 0] })], 6);
  assert.ok(spread.every(l => l.gain > 0.9 && !l.suppressed),
    'one sample at two points is a spread, not a duplicate');
}

{
  // The `stereo` half and the spatialised half of a hand-over live in separate
  // groups by design (`stereo:<offset>` vs `<offset>`) — the arbitration keys
  // on the offset so that they still meet. A regression here would silently
  // re-open the whole defect while every other assertion still passed.
  const [a, b] = atDistance([twin('one.mp3', { stereo: true, priority: 10 }),
                             twin('one.mp3', { stereo: false, priority: 8 })], 1.4);
  assert.equal(a.gain, 1);
  assert.equal(b.gain, 0, 'a stereo layer and a panned one at one offset still contest');
}

{
  // Ties resolve the same way every frame, or the arbitration itself becomes
  // a source of flutter: priority, then loudness, then declaration order.
  const byGain = atDistance([twin('one.mp3', { volume: 0.5 }),
                             twin('one.mp3', { volume: 1 })], 6);
  assert.equal(byGain[0].gain, 0, 'the quieter of two equals loses');
  assert.equal(byGain[1].gain, 1);

  const byOrder = atDistance([twin('one.mp3'), twin('one.mp3')], 6);
  assert.equal(byOrder[0].gain, 1, 'and dead equals fall to declaration order');
  assert.equal(byOrder[1].gain, 0);
}

{
  // A one-shot that loses the contest must not spend its `trigger Volume`
  // latch on a round nobody hears — the arbitration runs BEFORE the gate.
  const shotLayer = (priority) => ({
    file: 'blast.wav', loop: false, volume: 1, priority, stereo: false,
    doppler: false, randomStartPitch: null, relativePosition: [0, 0, 0],
    trigger: 'volume',
    modulators: [
      { dest: 'volume', source: 'time', envelope: 'ramp', params: [0.06, 0.06, 0, 1] },
    ],
  });
  const layers = [shotLayer(10), shotLayer(8)];
  const ctx = stubCtx();
  const buffers = new Map([['blast.wav', fakeBuffer()]]);
  const audio = new EngineAudio(
    { template: 'Sherman', engine: 'gun', layers }, layers, buffers,
    fakeListener(ctx), 1, true, () => 0.5);
  audio.start();
  audio.trigger();
  audio.update({
    dt: 0.1, rpm: 0, speed: 0, acceleration: 0, diveAngle: 0,
    position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    listenerPosition: { x: 0, y: 0, z: 0 },
  });
  assert.equal(ctx.started.length, 1,
    'one round of two coherent one-shots starts one source, not two');
  audio.dispose();
}

// --- the same invariant over the real shipped data --------------------------
//
// The synthetic cases above pin the mechanism; this pins the actual `.ssc`
// files, which is where all three regressions came from. `viewer/maps` is an
// extracted tree rather than a tracked one, so this skips when it is absent
// (CI, a fresh worktree) and runs for anyone who has extracted a level.

{
  const mapsDir = new URL('../viewer/maps/', import.meta.url);
  let levels = [];
  try {
    levels = fs.readdirSync(mapsDir).filter(
      name => fs.existsSync(new URL(`${name}/scene.json`, mapsDir)));
  } catch (_) { levels = []; }

  // Every distance a listener can plausibly be at, from inside the turret to
  // the far end of a layer's last band. The three known regressions all lived
  // in a narrow window, so the sweep is deliberately dense where heads are.
  const DISTANCES = [0.1, 0.3, 0.5, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2,
                     2.5, 3, 4, 5, 6, 8, 10, 15, 20, 40, 80, 150, 300];
  const offences = [];
  for (const level of levels) {
    const scene = JSON.parse(
      fs.readFileSync(new URL(`${level}/scene.json`, mapsDir), 'utf8'));
    for (const vehicle of scene.sounds?.vehicles ?? []) {
      const patches = [];
      if (vehicle.layers?.length) {
        patches.push({ name: vehicle.engine, layers: vehicle.layers, oneShots: false });
      }
      for (const weapon of vehicle.weapons ?? []) {
        if (weapon.layers?.length) {
          patches.push({ name: weapon.fireArms, layers: weapon.layers, oneShots: true });
        }
      }
      for (const patch of patches) {
        for (const distance of DISTANCES) {
          for (const rpm of patch.oneShots ? [0] : [0, 0.5, 1]) {
            const heard = atDistance(patch.layers, distance,
                                     { oneShots: patch.oneShots, rpm });
            const seen = new Map();
            heard.forEach((voice, i) => {
              if (voice.gain <= 0.02) return;
              const offset = (patch.layers[i].relativePosition || [0, 0, 0]).join(',');
              const key = `${voice.file}@${offset}`;
              for (const other of seen.get(key) ?? []) {
                const spread = Math.abs(other.playbackRate - voice.playbackRate);
                if (spread <= 0.004 * Math.max(other.playbackRate, voice.playbackRate)) {
                  offences.push(`${level} ${vehicle.template}/${patch.name} `
                    + `${key} at ${distance} m: two voices at rate `
                    + `${voice.playbackRate.toFixed(4)}`);
                }
              }
              seen.set(key, [...(seen.get(key) ?? []), voice]);
            });
          }
        }
      }
    }
  }
  assert.equal(offences.length, 0,
    `coherent duplicates in shipped sound data:\n  ${offences.slice(0, 12).join('\n  ')}`);
  console.log(`  swept ${levels.length} extracted level(s) for coherent duplicates`
    + (levels.length ? '' : ' (none extracted — viewer/maps is not in the tree)'));
}

console.log('test_engine_audio_default.mjs: ok');
