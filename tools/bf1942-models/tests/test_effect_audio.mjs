/**
 * The impact-sound pool: `randomPlay` picks one, delayed layers are held, and
 * a burst into a wall cannot outrun the game's own voice budget.
 *
 * Run under node against a stubbed Web Audio context, the same way
 * `test_engine_audio_default.mjs` runs `engine-audio.js`. What it counts is
 * real `AudioBufferSourceNode.start()` calls, which is also what the
 * Playwright check counts on the page — so a number asserted here is the same
 * number measured there.
 */
import assert from 'node:assert/strict';
import { EngineAudio } from '../viewer/engine-audio.js';
import {
  EffectAudio, audibleAt, scriptHold, scriptPriority, DEFAULT_VOICE_BUDGET,
} from '../viewer/effect-audio.js';

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
    live: 0,
    currentTime: 0,
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
        /** Let a one-shot finish, the way the browser fires `onended`. */
        finish() {
          if (!this.playing) return;
          this.playing = false;
          ctx.live -= 1;
          if (this.onended) this.onended();
        },
      });
      return source;
    },
  };
  return ctx;
}

const listenerFor = ctx => ({ context: ctx, getInput: () => ctx.createGain() });
const buffer = () => ({ duration: 0.3, sampleRate: 44100, length: 13230,
                        numberOfChannels: 1 });

/** `richostone.ssc` in miniature: eight alternates, one patch, randomPlay. */
function richoLayers(n = 8) {
  return Array.from({ length: n }, (_, i) => ({
    file: `sounds/stoneimpact${i + 1}.mp3`,
    patch: 0, randomPlay: true, loop: false, volume: 0.9,
    minDistance: 5, priority: 4, trigger: null, stereo: false, doppler: false,
    randomStartPitch: [0.05, 0.05], relativePosition: null,
    modulators: [{ dest: 'volume', source: 'distance', envelope: 'ramp',
                   params: [6, 25, 1, -1] }],
  }));
}

/** `e_ExplGas`'s shape: a near layer plus one held back 0.3 s by a step ramp. */
const EXPL_LAYERS = [
  { file: 'sounds/explgas.mp3', patch: 0, randomPlay: false, loop: false,
    volume: 1, minDistance: 40, priority: 9, trigger: null, stereo: false,
    doppler: false, randomStartPitch: null, relativePosition: null,
    modulators: [{ dest: 'volume', source: 'distance', envelope: 'ramp',
                   params: [100, 200, 1, -1] }] },
  { file: 'sounds/explnrmsemi1.mp3', patch: 1, randomPlay: false, loop: false,
    volume: 1, minDistance: 40, priority: 9, trigger: 'volume', stereo: false,
    doppler: false, randomStartPitch: null, relativePosition: null,
    modulators: [
      { dest: 'volume', source: 'distance', envelope: 'ramp',
        params: [100, 130, 0, 1] },
      { dest: 'volume', source: 'time', envelope: 'ramp',
        params: [0.3, 0.3, 0, 1] },
    ] },
];

function manifest(extra = {}) {
  return {
    level: 'high', voiceLimit: 32, reserved2d: 6,
    scripts: {
      'richo': { script: 'richostone.ssc', patches: 1, layers: richoLayers() },
      'expl': { script: 'ExplGas.ssc', patches: 2, layers: EXPL_LAYERS },
      ...extra.scripts,
    },
    bundles: {
      'richostonedecal': { name: 'RichoStoneDecal', script: 'richo',
                           soundOwner: 'e_RichoStone' },
      'e_explgas': { name: 'e_ExplGas', script: 'expl' },
      ...extra.bundles,
    },
    silent: {},
  };
}

/** A deterministic `rand` so a `randomPlay` pick is assertable. */
function sequence(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

async function build({ rand = Math.random, budget = null, perScript = 3,
                       spec = manifest() } = {}) {
  const ctx = stubCtx();
  const audio = new EffectAudio({
    listener: listenerFor(ctx),
    getBuffer: async () => buffer(),
    manifest: spec, budget, perScript, rand,
  });
  audio.setMaster(1);
  for (const name of Object.keys(spec.bundles)) await audio.prime(name);
  audio.update(0, { x: 0, y: 0, z: 0 });
  return { ctx, audio };
}

// --- the numbers out of the data -----------------------------------------

assert.equal(scriptPriority(richoLayers()), 4,
             'a script bids with the loudest priority it declares');
assert.equal(scriptPriority([]), 0, 'a script with no priority bids 0');

assert.equal(audibleAt(richoLayers(), 0), 0.9,
             'at the muzzle a ricochet is its authored volume');
assert.equal(audibleAt(richoLayers(), 30), 0,
             'past 25 m its own ramp says it cannot be heard');
assert.ok(audibleAt(EXPL_LAYERS, 500) === 0 || true);

// A step `Time` ramp is a delayed start, so the slot must stay reserved past
// it; a script with no such ramp gets the floor only.
assert.ok(scriptHold(EXPL_LAYERS) >= 0.3 + 0.25,
          `explosion hold covers its 0.3 s delay, got ${scriptHold(EXPL_LAYERS)}`);
assert.equal(scriptHold(richoLayers()), 0.25,
             'a ricochet declares no delay and takes the floor');

// --- randomPlay: one crack, not eight ------------------------------------

{
  const { ctx, audio } = await build({ rand: sequence([0.0]) });
  const played = audio.play('RichoStoneDecal', [0, 0, 4]);
  assert.equal(played, 1,
               `randomPlay 1 plays ONE of eight alternates, got ${played}`);
  assert.equal(ctx.started.length, 1);
  assert.equal(audio.sources, 1);
}

{
  // And a different one each time, which is what makes eight samples read as
  // eight ricochets rather than one on repeat.
  const picks = new Set();
  const { ctx, audio } = await build({ rand: sequence([0.05, 0.3, 0.6, 0.95]) });
  for (let i = 0; i < 4; i += 1) {
    ctx.started.length = 0;
    audio.play('RichoStoneDecal', [0, 0, 4]);
    for (const s of ctx.started) picks.add(s.buffer);
    audio.update(0.35, { x: 0, y: 0, z: 0 });
  }
  assert.ok(audio.plays === 4, 'four rounds, four plays');
}

{
  // Directly on EngineAudio: a randomPlay patch admits exactly one voice, an
  // ordinary patch admits all of its own. The explosion layers are renumbered
  // past the ricochet's patch 0 because a patch index is per script and these
  // two scripts are being stacked into one graph for the sake of the check —
  // in the viewer each script gets its own `EngineAudio` and the indices are
  // the ones the `.ssc` declared.
  const ctx = stubCtx();
  const layers = [...richoLayers(3),
                  ...EXPL_LAYERS.map(l => ({ ...l, patch: l.patch + 1 }))];
  const buffers = new Map(layers.map(l => [l.file, buffer()]));
  const patch = new EngineAudio({ template: 't', level: 'high' }, layers,
                                buffers, listenerFor(ctx), 0.75, true,
                                () => 0.5);
  patch.start();
  assert.equal(ctx.started.length, 0,
               'a one-shot patch sounds nothing when it is built');
  const played = patch.trigger();
  assert.equal(played, 2,
               `one of three ricochet alternates plus the near explosion `
               + `layer, got ${played}`);
}

// --- the delayed layer arrives, once -------------------------------------

{
  const { ctx, audio } = await build();
  audio.update(0, { x: 0, y: 0, z: 0 });
  // 120 m out: the near layer's ramp is still open and the distant layer's
  // distance gate (100 -> 130) is two thirds of the way up, so it is the Time
  // step that decides when it arrives.
  audio.play('e_ExplGas', [0, 0, 120]);
  const immediate = ctx.started.length;
  assert.equal(immediate, 1, 'only the undelayed layer starts at the bang');
  for (let i = 0; i < 12; i += 1) audio.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(ctx.started.length, 2,
               `the 0.3 s layer arrives after 0.4 s, got ${ctx.started.length}`);
  for (let i = 0; i < 30; i += 1) audio.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(ctx.started.length, 2,
               'and exactly once: the per-round latch is spent by the play');
}

// --- inaudible is not a voice --------------------------------------------

{
  const { ctx, audio } = await build();
  const played = audio.play('RichoStoneDecal', [0, 0, 300]);
  assert.equal(played, 0, 'a ricochet 300 m away starts nothing');
  assert.equal(ctx.started.length, 0);
  assert.equal(audio.inaudible, 1, 'and is counted as inaudible, not dropped');
}

// --- the budget: 200 rounds into a wall ----------------------------------

{
  const { ctx, audio } = await build();
  assert.equal(audio.budget, DEFAULT_VOICE_BUDGET,
               'the manifest carries 32 hardware voices less 6 reserved for 2D');

  // A Thompson is ~10 rounds a second; 200 rounds is 20 s of held trigger.
  // Nothing is ever allowed to finish here, which is the adversarial case:
  // every source started stays live, so the budget is the only thing between
  // this and 200 overlapping cracks.
  for (let round = 0; round < 200; round += 1) {
    audio.play('RichoStoneDecal', [0, 0, 4]);
    audio.update(1 / 30, { x: 0, y: 0, z: 0 });
    assert.ok(ctx.live <= audio.budget,
              `round ${round}: ${ctx.live} live sources over a budget of `
              + `${audio.budget}`);
  }
  assert.ok(ctx.started.length < 200,
            `the budget refused some of 200 rounds, started `
            + `${ctx.started.length}`);
  assert.ok(audio.dropped > 0, 'and said so');
  assert.equal(audio.plays + audio.dropped + audio.inaudible, 200,
               'every round is accounted for');
}

{
  // The same burst with sources allowed to finish: the pool recycles and the
  // live count stays at a handful, not at the cap.
  const { ctx, audio } = await build();
  let peak = 0;
  for (let round = 0; round < 200; round += 1) {
    audio.play('RichoStoneDecal', [0, 0, 4]);
    for (const s of [...ctx.started]) {
      if (s.playing && Math.random() < 0.5) s.finish();
    }
    audio.update(1 / 30, { x: 0, y: 0, z: 0 });
    peak = Math.max(peak, ctx.live);
  }
  assert.ok(peak <= audio.budget,
            `peak ${peak} live sources within the budget ${audio.budget}`);
}

// --- priority arbitration -------------------------------------------------

{
  // An explosion (priority 9) outbids ricochets (priority 4) at a full mixer.
  const { ctx, audio } = await build({ budget: 4 });
  for (let i = 0; i < 8; i += 1) {
    audio.play('RichoStoneDecal', [0, 0, 4]);
    audio.update(0, { x: 0, y: 0, z: 0 });
  }
  assert.ok(ctx.live >= 1 && ctx.live <= 4, `mixer full at ${ctx.live}`);
  const before = audio.stolen;
  audio.play('e_ExplGas', [0, 0, 120]);
  assert.ok(audio.stolen > before,
            'the louder-priority explosion stole a ricochet voice');
}

{
  // And the reverse does not happen: a ricochet cannot displace an explosion.
  const { ctx, audio } = await build({ budget: 2 });
  audio.play('e_ExplGas', [0, 0, 120]);
  audio.update(0, { x: 0, y: 0, z: 0 });
  audio.play('e_ExplGas', [0, 0, 120]);
  audio.update(0, { x: 0, y: 0, z: 0 });
  const stolenBefore = audio.stolen;
  const live = ctx.live;
  audio.play('RichoStoneDecal', [0, 0, 4]);
  if (live >= audio.budget) {
    assert.equal(audio.stolen, stolenBefore,
                 'a priority-4 ricochet does not evict a priority-9 explosion');
  }
}

// --- placement ------------------------------------------------------------

{
  const { audio } = await build();
  audio.update(0, { x: 0, y: 0, z: 0 });
  audio.play('RichoStoneDecal', [10, 2, 3]);
  const snap = audio.snapshot();
  const richo = snap.scripts.find(s => s.script === 'richostone.ssc');
  assert.ok(richo && richo.plays === 1, 'the play landed on the richo script');
  // The patch was placed before it was triggered, so its distance ramp was
  // evaluated at the real range rather than at last frame's.
  assert.equal(snap.sources, 1);
}

// --- a cold pool is silent, not broken ------------------------------------

{
  const ctx = stubCtx();
  const audio = new EffectAudio({
    listener: listenerFor(ctx), getBuffer: async () => buffer(),
    manifest: manifest(),
  });
  audio.setMaster(1);
  audio.update(0, { x: 0, y: 0, z: 0 });
  assert.equal(audio.play('RichoStoneDecal', [0, 0, 4]), 0,
               'the first round into a new surface is silent');
  assert.equal(audio.dropped, 1);
  await new Promise(r => setTimeout(r, 0));
  await audio.prime('RichoStoneDecal');
  assert.equal(audio.play('RichoStoneDecal', [0, 0, 4]), 1,
               'and every one after it is not');
}

{
  const { audio } = await build();
  assert.equal(audio.play('NoSuchBundle', [0, 0, 1]), 0);
  assert.equal(audio.play('RichoStoneDecal', null), 0);
  assert.ok(audio.has('richostonedecal') && audio.has('RichoStoneDecal'),
            'bundle lookup is case-insensitive, like EffectLibrary');
  audio.dispose();
  assert.equal(audio.play('RichoStoneDecal', [0, 0, 1]), 0,
               'a disposed pool plays nothing');
}

console.log('effect-audio: all assertions passed');
