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

console.log('test_engine_audio_default.mjs: ok');
