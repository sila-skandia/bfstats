/**
 * A bullet's passing crack, end to end through `EffectAudio`: a round's own
 * script, shaped the way `extract_effects.py` ships `Bullet_Heavy.ssc` (seven
 * `trigger Volume` one-shots, one picked per round by `randomPlay 1`), played
 * for a round that flies past the listener (`round-launch.js` `playSound`).
 *
 * The crack must sound once per round, when the round first comes within the
 * distance ramp (15 m), and never for a round that stays out of that reach.
 * Run under node against a stubbed Web Audio context, like
 * `test_effect_audio.mjs`. Run by `test_flyby_cracks.py`.
 */
import assert from 'node:assert/strict';
import { EffectAudio } from '../viewer/effect-audio.js';

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
    live: 0,
    currentTime: 0,
    state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
        rolloffFactor: 0,
        positionX: param(0), positionY: param(0), positionZ: param(0),
      });
    },
    createBufferSource() {
      const source = node({
        buffer: null, loop: false, playbackRate: param(1), onended: null,
        start() { ctx.started.push(this); ctx.live += 1; this.playing = true; },
        stop() {
          if (this.playing) { ctx.live -= 1; this.playing = false; }
          this.stopped = true;
        },
      });
      return source;
    },
  };
  return ctx;
}

/** Bullet_Heavy.ssc's shape: seven one-shots, each gated by the distance
 *  ramp (full inside 10 m, gone past 15 m) and a 75 ms time gate, with the
 *  patch's `randomPlay 1` on every layer. */
function crackLayers(n = 7) {
  return Array.from({ length: n }, (_, i) => ({
    file: `sounds/bulletair_heavy${i + 1}.mp3`,
    patch: 0, randomPlay: true, loop: false, volume: 1,
    minDistance: 5, priority: -1, trigger: 'volume', stereo: false,
    doppler: false, randomStartPitch: [0.05, 0.05], relativePosition: null,
    modulators: [
      { dest: 'volume', source: 'distance', envelope: 'ramp', params: [10, 15, 1, -1] },
      { dest: 'volume', source: 'time', envelope: 'ramp', params: [0.075, 0.075, 0, 1] },
    ],
  }));
}

function manifest() {
  return {
    level: 'high', voiceLimit: 32, reserved2d: 6,
    scripts: { 'bullet#flight': { script: 'Bullet_Heavy.ssc', patches: 1, layers: crackLayers() } },
    bundles: { flybybullet: { name: 'FlybyBullet', script: 'bullet#flight' } },
    silent: {},
  };
}

async function build(rand = Math.random) {
  const ctx = stubCtx();
  const audio = new EffectAudio({
    listener: { context: ctx, getInput: () => ctx.createGain() },
    getBuffer: async (file) => ({ duration: 0.3, sampleRate: 44100, length: 13230,
                                  numberOfChannels: 1, file }),
    manifest: manifest(), budget: null, perScript: 3, rand,
  });
  audio.setMaster(1);
  await audio.prime('flybybullet');
  audio.update(0, { x: 0, y: 0, z: 0 });
  return { ctx, audio };
}

/** One round from `start` metres on +x, flying to -x at `speed` past the
 *  listener at the origin, `lateral` metres to one side. Returns the crack
 *  starts as `{ x, file }`, where `x` is the round's own position when the
 *  sample started. */
async function flyBy({ rand = Math.random, start = 100, lateral = 0, speed = 400,
                       dt = 1 / 30 } = {}) {
  const { ctx, audio } = await build(rand);
  const at = { x: start, y: lateral, z: 0 };
  audio.play('flybybullet', [at.x, at.y, at.z], {
    follow: () => [at.x, at.y, at.z], token: Symbol('round'),
  });
  const cracks = [];
  for (let frame = 0; at.x > -start && frame < 2000; frame += 1) {
    const before = ctx.started.length;
    audio.update(dt, { x: 0, y: 0, z: 0 });
    for (const source of ctx.started.slice(before)) {
      cracks.push({ x: at.x, file: source.buffer.file });
    }
    at.x -= speed * dt;
  }
  return cracks;
}

/** A deterministic `rand` so a `randomPlay` pick is assertable. */
function sequence(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

// --- a round that passes close sounds its crack, once ---------------------

{
  const cracks = await flyBy({ start: 100, lateral: 0 });
  assert.equal(cracks.length, 1,
               `one passing round, one crack, got ${cracks.length}`);
  // The crack opens when the round first comes within 15 m, not before and
  // not after it has gone by. One 13 m frame of slack either side.
  const [crack] = cracks;
  assert.ok(crack.x <= 15 + 13.5 && crack.x >= -15,
            `the crack opens as the round comes within 15 m, not at ${crack.x.toFixed(1)} m`);
  assert.match(crack.file, /^sounds\/bulletair_heavy[1-7]\.mp3$/,
               'the crack is one of the round\'s seven samples');
}

// --- randomPlay: one of the seven, a different one each round -------------

{
  const picks = [];
  for (const value of [0.05, 0.3, 0.6, 0.95]) {
    const cracks = await flyBy({ rand: sequence([value]), start: 60 });
    assert.equal(cracks.length, 1, 'each round cracks once, not once per alternate');
    picks.push(cracks[0].file);
  }
  assert.equal(new Set(picks).size, 4,
               `four rounds, four different alternates, got ${picks.join(', ')}`);
}

// --- a round that stays out of the ramp is silent --------------------------

{
  const cracks = await flyBy({ start: 100, lateral: 40 });
  assert.equal(cracks.length, 0,
               `a round 40 m off the listener never enters the 15 m ramp, got ${cracks.length} cracks`);
}

// --- a stream of rounds: one crack each, through the shared pool -----------

/** `rounds` rounds fired one a frame, each flying from 100 m past the listener
 *  at 400 m/s: the rate a gun fires, not one synchronous batch. The pool grows
 *  between frames, as the page's does, so each await is a frame's gap. */
async function stream(rounds) {
  const { ctx, audio } = await build();
  const flying = [];
  let cracks = 0;
  for (let frame = 0; frame < rounds + 200; frame += 1) {
    if (frame < rounds) {
      const p = { x: 100, y: 0, z: 0 };
      flying.push(p);
      audio.play('flybybullet', [p.x, p.y, p.z], {
        follow: () => [p.x, p.y, p.z], token: Symbol('round'),
      });
    }
    await new Promise(r => setTimeout(r, 0));
    const before = ctx.started.length;
    audio.update(1 / 30, { x: 0, y: 0, z: 0 });
    cracks += ctx.started.length - before;
    for (const p of flying) p.x -= 400 / 30;
  }
  return cracks;
}

{
  const cracks = await stream(6);
  assert.equal(cracks, 6, `six rounds past the listener, six cracks, got ${cracks}`);
}

{
  // Twelve rounds in a stream: the rounds in flight at once fit in the pool
  // (up to the engine's eight instances), so every round cracks.
  const cracks = await stream(12);
  assert.equal(cracks, 12, `twelve in a stream, twelve cracks, got ${cracks}`);
}

console.log('flyby cracks: ok');
