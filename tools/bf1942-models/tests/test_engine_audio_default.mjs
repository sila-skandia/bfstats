/**
 * Land engine `.ssc` scripts modulate Pitch/Volume on `controlSource Default`.
 * That channel must track the same normalised rpm the viewer already feeds as
 * `engine::rpm` — a constant 1 freezes every jeep/Sherman layer at full song.
 */
import assert from 'node:assert/strict';
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

console.log('test_engine_audio_default.mjs: ok');
