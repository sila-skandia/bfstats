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
  return {
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
      return node({
        buffer: null,
        loop: false,
        playbackRate: param(1),
        start() {},
        stop() {},
        onended: null,
      });
    },
  };
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

console.log('test_engine_audio_default.mjs: ok');
