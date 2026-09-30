/**
 * A gun whose Fire Loop loops nothing, played the way the engine plays it.
 *
 * DC Final's MG42 plays `mg_temp.wav` (1.7 s, one shot and its tail) once per
 * round. The engine starts each round on a new instance of the sample and lets
 * the last one ring, up to eight per buffer (ledger SND-14); a `randomPlay`
 * patch plays one load per trigger, rolled over every load including the
 * silences (SND-15). Run by `tests/test_gun_one_shots.py` against a stubbed
 * Web Audio context, like `test_effect_audio.mjs`.
 */
import assert from 'node:assert/strict';
import { EngineAudio, INSTANCES_PER_SAMPLE } from '../viewer/engine-audio.js';
import { weaponSpec } from '../viewer/hand-fire-sound.js';
import { WorldFire } from '../viewer/world-fire.js';

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
      return node({
        buffer: null, loop: false, playbackRate: param(1), onended: null,
        start() { ctx.started.push(this); ctx.live += 1; this.playing = true; },
        stop() {
          if (this.playing) { ctx.live -= 1; this.playing = false; }
          this.stopped = true;
        },
      });
    },
  };
  return ctx;
}

const listenerFor = ctx => ({ context: ctx, getInput: () => ctx.createGain() });
const tail = { duration: 1.718, sampleRate: 44100, length: 75764, numberOfChannels: 1 };

const ONE_SHOT = (file, extra = {}) => ({
  file, loop: false, volume: 1, minDistance: 3, priority: 10, trigger: null,
  stereo: false, doppler: false, randomStartPitch: [0.05, 0], relativePosition: null,
  modulators: [], ...extra,
});

function gun(layers, rand = Math.random) {
  const ctx = stubCtx();
  const buffers = new Map(layers.map(l => [l.file, tail]));
  const audio = new EngineAudio({ template: 'MG42', layers }, layers, buffers,
                                listenerFor(ctx), 0.75, true, rand);
  audio.setMaster(1);
  audio.start();
  return { ctx, audio };
}

// --- a round is a new instance; the ninth takes the oldest ----------------

{
  const { ctx, audio } = gun([ONE_SHOT('sounds/mg_temp.mp3')]);
  for (let round = 0; round < 26; round++) {
    ctx.currentTime = round / 15;   // `roundOfFire 15`
    assert.equal(audio.trigger(), 1, `round ${round} starts its shot`);
  }
  assert.equal(ctx.started.length, 26, 'every round started a play');
  assert.equal(ctx.live, INSTANCES_PER_SAMPLE,
               `at most ${INSTANCES_PER_SAMPLE} plays of one sample ring at once, got ${ctx.live}`);
  assert.equal(audio.sources, INSTANCES_PER_SAMPLE, 'the patch counts what is really sounding');
  assert.equal(audio.stolen, 26 - INSTANCES_PER_SAMPLE, 'and says how many it cut short');
  const stopped = ctx.started.filter(s => s.stopped);
  assert.deepEqual(stopped, ctx.started.slice(0, 26 - INSTANCES_PER_SAMPLE),
                   'the oldest go first');
  audio.silence();
  assert.equal(ctx.live, 0, 'a cut patch leaves nothing ringing');
  assert.equal(audio.trigger(), 1, 'and fires again afterwards');
  assert.equal(ctx.live, 1);
}

// --- a play that ends on its own frees its place ---------------------------

{
  const { ctx, audio } = gun([ONE_SHOT('sounds/car15s.mp3')]);
  for (let i = 0; i < 5; i++) audio.trigger();
  ctx.started[0].onended();
  ctx.started[0].playing = false; ctx.live -= 1;
  for (let i = 0; i < 4; i++) audio.trigger();
  assert.equal(audio.stolen || 0, 0, 'eight still sounding, none stolen');
  audio.trigger();
  assert.equal(audio.stolen, 1, 'the ninth steals one');
}

// --- randomPlay: one load per round, and a silence is a load ---------------

{
  // bomb.ssc's release: bmbreal1, a silence, bmbreal3 -> slots 0 and 2 of 3.
  // No pitch jitter, so every roll is a pick; the first is the constructor's.
  const picked = (file, slot) => ONE_SHOT(file, { patch: 1, randomPlay: true, slot, slots: 3,
                                                  randomStartPitch: null });
  const rolls = [0.99, 0.1, 0.5, 0.9, 0.2, 0.4, 0.8];
  let i = 0;
  const { ctx, audio } = gun([picked('sounds/bmbreal1.mp3', 0), picked('sounds/bmbreal3.mp3', 2)],
                             () => rolls[(i++) % rolls.length]);
  const played = [];
  for (let round = 0; round < 6; round++) {
    const before = ctx.started.length;
    audio.trigger();
    played.push(ctx.started.length - before);
  }
  // Rolls 0.1 -> slot 0, 0.5 -> slot 1 (silence), 0.9 -> slot 2, ...
  assert.deepEqual(played, [1, 0, 1, 1, 0, 1],
                   `one clack or none per release, never both: ${played}`);
}

{
  // Without the slot keys (an effect ships its silences as layers) the pick
  // is among the layers themselves, as before.
  const plain = file => ONE_SHOT(file, { patch: 0, randomPlay: true });
  const { ctx, audio } = gun([plain('sounds/a.mp3'), plain('sounds/b.mp3')], () => 0.7);
  audio.trigger();
  assert.equal(ctx.started.length, 1, 'one of two, never none');
}

// --- names are matched without case -----------------------------------------

{
  const manifest = { weapons: { Mk23: { file: 'Mk23.mp3' }, GrenadeAllies: { file: 'g.mp3' } } };
  assert.equal(weaponSpec(manifest, 'MK23')?.file, 'Mk23.mp3', "kits.json's MK23 finds Mk23");
  assert.equal(weaponSpec(manifest, 'grenadeallies')?.file, 'g.mp3');
  assert.equal(weaponSpec(manifest, 'Mk23')?.file, 'Mk23.mp3', 'the exact name still wins');
  assert.equal(weaponSpec(manifest, 'Thompson'), null);
  assert.equal(weaponSpec(null, 'MK23'), null);

  const fire = new WorldFire({
    listener: () => null, getBuffer: async () => null, master: () => 1,
    manifest: { weapons: { Browninghipo: { file: 'b.mp3', layers: [ONE_SHOT('b.mp3')] } } },
  });
  assert.ok(fire.has('BrowningHipo'), 'a bystander hears the kit spelling too');
  assert.ok(fire.has('browninghipo'));
  assert.ok(!fire.has('Thompson'));
  fire.dispose();
}

console.log('gun one-shots: all assertions passed');
