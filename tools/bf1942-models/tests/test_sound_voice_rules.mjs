/**
 * The client's voice rules, as the page plays them (ledger SND-37, SND-38;
 * features/fh-fhsw-open-issues FHX-13, FHX-16):
 *
 * - `trigger Volume` flags the Volume effect declared last above it. The
 *   sample waits while a flagged effect reads zero, and on the first update
 *   they all read above it, it plays if its whole volume is above zero, and
 *   is spent either way. Vanilla's `Projectile_High.ssc` flags `Time` on
 *   `bulletair1` and `Distance` on the other six.
 * - A sample buffer holds eight instances across every object; a ninth
 *   one-shot takes the one that started longest ago.
 * - World fire: a patch per shooter up to the buffer's eight; past it a
 *   one-shot patch gives up the shooter whose round is oldest, a Fire Loop
 *   patch the farthest, and only to a nearer shooter.
 * - A bot's bullet, an instant ray, flies its round's script past the
 *   listener (`passing-rounds.js`).
 *
 * Voices are counted by the stub context's `createBufferSource().start`.
 * Run by `test_sound_voice_rules.py`.
 */
import assert from 'node:assert/strict';
import { EffectAudio } from '../viewer/effect-audio.js';
import { EngineAudio } from '../viewer/engine-audio.js';
import { WorldFire } from '../viewer/world-fire.js';
import { PassingRounds } from '../viewer/passing-rounds.js';
import { oneShotsOf } from '../viewer/sample-instances.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
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
        buffer: null, loop: false, playbackRate: param(1), onended: null,
        start() { ctx.started.push(this); this.playing = true; },
        stop() { this.playing = false; this.stopped = true; },
      });
    },
  };
  return ctx;
}

const listenerOf = ctx => ({ context: ctx, getInput: () => ctx.createGain(),
                             position: { x: 0, y: 0, z: 0 } });
const buffer = file => ({ duration: 0.3, sampleRate: 44100, length: 13230,
                          numberOfChannels: 1, file,
                          getChannelData() { return new Float32Array(1); } });
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// --- trigger Volume: which effect the line flags -----------------------------

const DIST = { dest: 'volume', source: 'distance', envelope: 'ramp', params: [10, 10, 1, -1] };
const TIME = { dest: 'volume', source: 'time', envelope: 'ramp', params: [0.075, 0.075, 0, 1] };

/** One `bulletair` layer: `flag` is which modulator the `trigger Volume`
 *  line flagged ('distance', 'time', or null for a tree without the flag). */
function crack(flag) {
  return {
    file: 'sounds/bulletair1.mp3', patch: 0, randomPlay: false, loop: false,
    volume: 1, minDistance: 5, priority: -1, trigger: 'volume', stereo: false,
    doppler: false, randomStartPitch: null, relativePosition: null,
    modulators: [
      { ...DIST, ...(flag === 'distance' ? { trigger: true } : {}) },
      { ...TIME, ...(flag === 'time' ? { trigger: true } : {}) },
    ],
  };
}

async function roundPast(flag, { downrange, lateral = 0, speed = 400, dt = 1 / 60, life = 2 }) {
  const ctx = stubCtx();
  const audio = new EffectAudio({
    listener: listenerOf(ctx),
    getBuffer: async file => buffer(file),
    manifest: {
      level: 'high', voiceLimit: 32, reserved2d: 6,
      scripts: { 'projectile#flight': { script: 'Projectile_High.ssc', layers: [crack(flag)] } },
      bundles: { round: { script: 'projectile#flight' } },
      silent: {},
    },
  });
  audio.setMaster(1);
  await audio.prime('round');
  // The listener stands `downrange` metres along +x from the muzzle, `lateral`
  // off the line; the round flies +x from the muzzle at the origin.
  const ear = { x: downrange, y: lateral, z: 0 };
  audio.update(0, ear);
  const at = { x: 0, y: 0, z: 0 };
  audio.play('round', [0, 0, 0], { follow: () => [at.x, at.y, at.z], token: Symbol('r') });
  const cracks = [];
  for (let t = 0; t < life; t += dt) {
    const before = ctx.started.length;
    audio.update(dt, ear);
    if (ctx.started.length > before) cracks.push(at.x);
    at.x += speed * dt;
  }
  return cracks;
}

{
  // Distance flagged: the round waits until it comes within 10 m, then
  // cracks, its 75 ms gate long open.
  const cracks = await roundPast('distance', { downrange: 200 });
  assert.equal(cracks.length, 1, `a Distance-flagged crack for a round passing at 200 m: ${cracks}`);
  assert.ok(cracks[0] > 190 - 7 && cracks[0] < 210, `as it comes within 10 m, at ${cracks[0]}`);
}
{
  // ...and a round that is within 10 m before its gate opens is spent: the
  // flagged effect opened first, the whole volume was zero, no crack later.
  const cracks = await roundPast('distance', { downrange: 15 });
  assert.equal(cracks.length, 0, `within 10 m inside the first 75 ms, no crack: ${cracks}`);
}
{
  // Time flagged: everything rides on the moment the gate opens. At 400 m/s
  // the round is 30 m out at 75 ms; a listener there hears it...
  const cracks = await roundPast('time', { downrange: 32 });
  assert.equal(cracks.length, 1, `a Time-flagged crack within 10 m as its gate opens: ${cracks}`);
}
{
  // ...one 200 m down the same line does not, though the round passes him.
  const cracks = await roundPast('time', { downrange: 200 });
  assert.equal(cracks.length, 0, `a Time-flagged crack past its gate is spent: ${cracks}`);
}
{
  // A tree extracted before the flag keeps the older rule: the whole
  // volume's first rise.
  const cracks = await roundPast(null, { downrange: 200 });
  assert.equal(cracks.length, 1, `an unflagged layer still cracks on its first rise: ${cracks}`);
}

// --- one buffer, eight instances across every patch --------------------------

{
  const ctx = stubCtx();
  const shared = buffer('rifle.wav');
  const layer = { file: 'rifle.wav', loop: false, volume: 1, stereo: false,
                  randomStartPitch: null, relativePosition: null, doppler: false,
                  modulators: [] };
  const patches = [];
  for (let i = 0; i < 3; i++) {
    const a = new EngineAudio({ template: `rifle${i}`, level: 'high' }, [layer],
                              new Map([['rifle.wav', shared]]), listenerOf(ctx), 1, true);
    a.setMaster(1);
    a.start();
    a.update({ dt: 0, position: { x: 5 * i, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
               listenerPosition: { x: 0, y: 0, z: 0 } });
    patches.push(a);
  }
  // Nine reports across three soldiers' patches, none ended yet.
  for (let i = 0; i < 9; i++) patches[i % 3].trigger();
  const sounding = ctx.started.filter(s => !s.stopped);
  assert.equal(ctx.started.length, 9, 'nine plays start');
  assert.equal(sounding.length, 8, `eight sound at once, across the patches: ${sounding.length}`);
  assert.equal(ctx.started[0].stopped, true, 'the ninth took the one that started first');
  assert.equal(oneShotsOf(ctx, shared, true), 8);
  // A patch cut gives its instances back.
  patches[1].silence();
  assert.equal(oneShotsOf(ctx, shared, true), 8 - 3, 'the cut patch\'s three are given back');
  for (const p of patches) p.dispose();
  assert.equal(oneShotsOf(ctx, shared, true), 0, 'and every one on dispose');
}

{
  // A muted play (the far layer of a hand-over, out of its band) holds no
  // instance: the game starts none for a layer at zero.
  const ctx = stubCtx();
  const shared = buffer('far.wav');
  const layer = { file: 'far.wav', loop: false, volume: 1, stereo: false,
                  randomStartPitch: null, relativePosition: null, doppler: false,
                  modulators: [{ dest: 'volume', source: 'distance', envelope: 'ramp', params: [100, 150, 0, 1] }] };
  const a = new EngineAudio({ template: 'far', level: 'high' }, [layer],
                            new Map([['far.wav', shared]]), listenerOf(ctx), 1, true);
  a.setMaster(1);
  a.start();
  a.update({ dt: 0, position: { x: 5, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
             listenerPosition: { x: 0, y: 0, z: 0 } });
  a.trigger();
  assert.equal(oneShotsOf(ctx, shared, true), 0, 'a muted one-shot draws on no instance');
  a.dispose();
}

// --- world fire: a patch a shooter, up to the buffer's eight ------------------

function rifleFire(ctx, clock, { loop = false } = {}) {
  const files = new Map();
  const listener = listenerOf(ctx);
  return new WorldFire({
    listener: () => listener,
    getBuffer: async file => {
      if (!files.has(file)) files.set(file, buffer(file));
      return files.get(file);
    },
    manifest: { weapons: { K98: { file: 'k98.mp3', loop, volume: 1, layers: [{
      file: 'k98.wav', loop, volume: 1, randomStartPitch: null, relativePosition: [0, 0, 0],
      doppler: true, modulators: [] }] } } },
    master: () => 1, rand: () => 0.5, now: () => clock.t,
  });
}

/** Let the pool grow to `n` patches: a round per shooter, a frame apart. */
async function grow(fire, clock, n) {
  for (let round = 0; round < n + 2; round++) {
    for (let i = 0; i < n; i++) fire.play('K98', { x: 10 + i, y: 0, z: 0 }, { id: i });
    await settle(24);
    clock.t += 1.5;
  }
}

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const fire = rifleFire(ctx, clock);
  await fire.prime('K98');
  await settle();
  await grow(fire, clock, 4);
  const shooters = [0, 1, 2, 3].map(i => ({ id: i }));
  // Four rifles fire inside one second: every one is heard (three were).
  const heard = shooters.map((s, i) => fire.play('K98', { x: 10 + i, y: 0, z: 0 }, s));
  assert.deepEqual(heard, [true, true, true, true], `four shooters of one rifle: ${heard}`);
  assert.equal(fire.snapshot().weapons[0].slots, 4);
  fire.dispose();
}

{
  const ctx = stubCtx();
  const clock = { t: 100 };
  const fire = rifleFire(ctx, clock);
  await fire.prime('K98');
  await settle();
  await grow(fire, clock, 8);
  assert.equal(fire.snapshot().weapons[0].slots, 8, 'the pool stops at the buffer\'s eight');
  for (let i = 0; i < 8; i++) {
    fire.play('K98', { x: 10 + i, y: 0, z: 0 }, { id: `s${i}` });
    clock.t += 0.01;
  }
  // A ninth shooter inside everyone's hold: a one-shot buffer gives up the
  // oldest instance, so he is heard and the first shooter's patch is his.
  const stolenBefore = fire.snapshot().stolen;
  assert.equal(fire.play('K98', { x: 500, y: 0, z: 0 }, { id: 'ninth' }), true,
               'a ninth shooter takes the oldest round\'s patch');
  assert.equal(fire.snapshot().stolen, stolenBefore + 1);
  fire.dispose();
}

{
  // A Fire Loop patch: the buffer's loops are kept by distance.
  const ctx = stubCtx();
  const clock = { t: 100 };
  const fire = rifleFire(ctx, clock, { loop: true });
  await fire.prime('K98');
  await settle();
  await grow(fire, clock, 8);
  for (let i = 0; i < 8; i++) fire.play('K98', { x: 10 + 10 * i, y: 0, z: 0 }, { id: `s${i}` });
  fire.update(0, { x: 0, y: 0, z: 0 });
  assert.equal(fire.play('K98', { x: 300, y: 0, z: 0 }, { id: 'far' }), false,
               'a ninth farther than all eight is not heard');
  assert.equal(fire.play('K98', { x: 5, y: 0, z: 0 }, { id: 'near' }), true,
               'a ninth nearer than the farthest takes its patch');
  fire.dispose();
}

// --- a bot's bullet: its round's script flown down the ray -------------------

{
  const ctx = stubCtx();
  const audio = new EffectAudio({
    listener: listenerOf(ctx),
    getBuffer: async file => buffer(file),
    manifest: {
      level: 'high', voiceLimit: 32, reserved2d: 6,
      scripts: { 'k98projectile#flight': { script: 'Projectile_High.ssc', layers: [crack('distance')] } },
      bundles: { k98projectile: { script: 'k98projectile#flight' } },
      silent: {},
    },
  });
  audio.setMaster(1);
  await audio.prime('k98projectile');
  const ear = { x: 300, y: 3, z: 0 };
  audio.update(0, ear);
  const rounds = new PassingRounds({ effectAudio: audio, listener: () => audio.listenerPosition });
  assert.equal(rounds.fly('k98Projectile', [0, 0, 0], [1, 0, 0], 800, 800, 0), true,
               'a round whose line passes 3 m from the listener flies');
  assert.equal(rounds.fly('k98Projectile', [0, 0, 0], [0, 0, 1], 800, 800, 0), false,
               'one whose line never comes within the script\'s reach does not');
  let cracks = 0;
  for (let i = 0; i < 90; i++) {
    const before = ctx.started.length;
    rounds.tick(1 / 60);
    audio.update(1 / 60, ear);
    cracks += ctx.started.length - before;
  }
  assert.equal(cracks, 1, `the bot's round cracks once as it passes: ${cracks}`);
  assert.equal(rounds.live.length, 0, 'and is let go once it has flown its length');
  assert.equal(audio.snapshot().scripts[0].slots >= 1, true);
  // The crack itself rings on (the stub's sources never end); what was only
  // promised is gone.
  assert.equal(audio.committed - audio.sources, 0, 'nothing is left armed once it has landed');
  // A round flown that lands before it reaches him leaves no latch armed.
  const near = { x: 100, y: 3, z: 0 };
  audio.update(0, near);
  assert.equal(rounds.fly('k98Projectile', [0, 0, 0], [1, 0, 0], 800, 95, 0), true);
  rounds.tick(1 / 60);
  audio.update(1 / 60, near);
  assert.ok(audio.committed - audio.sources > 0, 'in flight, its crack is promised');
  for (let i = 0; i < 30; i++) { rounds.tick(1 / 60); audio.update(1 / 60, near); }
  assert.equal(audio.committed - audio.sources, 0, 'landed short, the promise is spent');
}

console.log('sound voice rules: ok');
