/**
 * A hand weapon's patch has one clock, and every trigger starts it over.
 *
 * Reported from FHSW's M1 Garand: "the bullet casing sounds build up and so
 * you get this rattling for the entire clip expended quickly. In retail it
 * doesn't play in a row, just once." Its Fire patch holds the report and
 * five casings behind `Volume <- Time` at 0.8 s (vanilla's
 * `M1Garand/Sounds/ShellBounce.ssc`, included into slot 0). The engine starts
 * a gated sample on the first update that finds its volume above zero
 * (`SoundPatch__updateSample` 0x00802a40), and a trigger sets the patch's
 * clock to nothing (`SoundPatch__trigger` 0x008030a0, `+0x84 = 0`): at six
 * rounds a second the gate never opens until 0.8 s after the last round
 * (ledger SND-33). The page scheduled five voices per round and took none
 * back: forty casings over two seconds.
 *
 * Stub Web Audio, no browser. Run by `tests/test_hand_fire_patch_clock.py`.
 */
import assert from 'node:assert/strict';
import { createHandFireSound } from '../viewer/hand-fire-sound.js';

function stubCtx() {
  const param = (initial = 0) => ({ value: initial });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    sources: [],
    currentTime: 100,
    state: 'running',
    resume() { return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1), onended: null,
        start(when = 0) { this.when = when; ctx.sources.push(this); },
        stop() { this.stoppedAt = ctx.currentTime; },
      });
    },
  };
  return ctx;
}

const buffer = file => ({ file, duration: 0.3 });
const casing = (load, wav) => ({ load, file: `M1Garand.f${load}.mp3`, wav, volume: 3,
                                 randomStartPitch: [0.05, 0.05], delay: 0.8 });
// The manifest `extract_weapon_sounds` writes for the Garand, in every tree.
const GARAND = {
  file: 'M1Garand.mp3', wav: 'M1Garand_Fire_4.wav', slot: 'fire', volume: 10, loop: false,
  also: [casing(1, 'patron1.wav'), casing(2, 'patron2.wav'), casing(4, 'patron3.wav'),
         casing(5, 'patron4.wav'), casing(6, 'patron5.wav')],
};
// DC's M16 shape: a Fire Loop, its tail on release, and a Shell Bounce slot
// that rolls one of three casings 0.2 s after the burst ends.
const M16 = {
  file: 'M16.mp3', wav: 'M16_loop_ST.wav', slot: 'fireLoop', volume: 0.75, loop: true,
  release: [
    { slot: 2, picks: [{ load: 0, file: 'M16.s2.0.mp3', wav: 'M16_release.wav', volume: 1 }] },
    { slot: 3, randomPlay: true, loads: 3, picks: [
      { load: 0, file: 'M16.s3.0.mp3', wav: 'patronrelease.wav', volume: 0.6, delay: 0.2 },
      { load: 1, file: 'M16.s3.1.mp3', wav: 'patronrelease2.wav', volume: 0.6, delay: 0.2 },
      { load: 2, file: 'M16.s3.2.mp3', wav: 'patronrelease3.wav', volume: 0.6, delay: 0.2 }] },
  ],
};
// The Bazooka: a hiss with the thump, and nothing gated.
const BAZOOKA = { file: 'Bazooka.mp3', wav: 'rktfirest.wav', slot: 'fire', volume: 1, loop: false,
                  also: [{ load: 1, file: 'Bazooka.f1.mp3', wav: 'rcktfiremono.wav', volume: 1 }] };

async function weapon(spec, name) {
  const ctx = stubCtx();
  const sound = createHandFireSound({
    AUDIO_OFF: false,
    audioListener: { context: ctx, getInput: () => ctx.createGain() },
    bust: () => '',
    masterVolume: () => 1,
    MODELS_BASE: 'models',
    modelSoundBuffer: async rel => buffer(rel),
    weaponToken: 1,
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ weapons: { [name]: spec } }) });
  return { ctx, sound, fire: await sound.fetchHandFireSound(name) };
}

const isCasing = s => /M1Garand\.f\d\.mp3$/.test(s.buffer.file);
/** A source that reaches the ear: started, and not taken back before then. */
const heard = s => !(s.stoppedAt != null && s.stoppedAt <= s.when);

// --- a clip fired fast: the casings ring once, after the last round ----------
{
  const { ctx, sound, fire } = await weapon(GARAND, 'M1Garand');
  const t0 = ctx.currentTime;
  const shots = [];
  for (let i = 0; i < 8; i++) {          // FHSW's `roundOfFire 6`
    shots.push(ctx.currentTime);
    sound.playHandFire(fire);
    ctx.currentTime += 1 / 6;
  }
  const reports = ctx.sources.filter(s => s.buffer.file === 'sounds/M1Garand.mp3');
  assert.equal(reports.length, 8, 'every round is reported');
  assert.ok(reports.every(heard), 'and no report is taken back');
  const casings = ctx.sources.filter(isCasing);
  assert.equal(casings.length, 40, 'five casings are scheduled a round');
  const rung = casings.filter(heard);
  assert.equal(rung.length, 5, 'and only the last round\'s five are heard');
  for (const s of rung) {
    assert.ok(Math.abs(s.when - (shots[7] + 0.8)) < 1e-9, 'on their gate after the LAST round');
  }
  assert.deepEqual(rung.map(s => s.buffer.file).sort(),
    [1, 2, 4, 5, 6].map(n => `sounds/M1Garand.f${n}.mp3`), 'one of each sample');
  assert.equal(sound.handFireVoices().filter(v => v.waiting).length, 5,
    'the five still behind the gate are the only ones waiting');
  assert.ok(t0 < shots[7]);
}

// --- fired slower than the gate: every round rings its own -------------------
{
  const { ctx, sound, fire } = await weapon(GARAND, 'M1Garand');
  sound.playHandFire(fire);
  ctx.currentTime += 0.9;                // past the 0.8 s gate: they have started
  sound.playHandFire(fire);
  const casings = ctx.sources.filter(isCasing);
  assert.equal(casings.length, 10);
  assert.ok(casings.every(heard), 'a casing already sounding is left to play out');
  assert.ok(casings.every(s => s.stoppedAt == null), 'nothing was stopped');
}

// --- an ungated companion is never taken back ---------------------------------
{
  const { ctx, sound, fire } = await weapon(BAZOOKA, 'Bazooka');
  sound.playHandFire(fire);
  ctx.currentTime += 0.05;
  sound.playHandFire(fire);
  assert.equal(ctx.sources.length, 4);
  assert.ok(ctx.sources.every(heard), 'the hiss plays with each thump');
}

// --- each slot is its own patch, with its own clock --------------------------
{
  const { ctx, sound, fire } = await weapon(M16, 'M16');
  const random = Math.random;
  Math.random = () => 0.5;               // rolls load 1 of the Shell Bounce
  fire.playRelease();
  ctx.currentTime += 0.1;                // a second burst ends inside the 0.2 s gate
  fire.playRelease();
  Math.random = random;
  const tails = ctx.sources.filter(s => s.buffer.file === 'sounds/M16.s2.0.mp3');
  assert.equal(tails.length, 2);
  assert.ok(tails.every(heard), 'the ungated release tail plays each time');
  const bounces = ctx.sources.filter(s => /M16\.s3\./.test(s.buffer.file));
  assert.equal(bounces.length, 2);
  assert.deepEqual(bounces.map(heard), [false, true],
    'the first bounce was still behind its gate when the slot was triggered again');
  assert.ok(Math.abs(bounces[1].when - (ctx.currentTime + 0.2)) < 1e-9);
}

// --- a release does not reach into the Fire patch ----------------------------
{
  const both = { ...GARAND, release: M16.release };
  const { ctx, sound, fire } = await weapon(both, 'M1Garand');
  sound.playHandFire(fire);
  ctx.currentTime += 0.05;               // SND-12: a single shot's release, 50 ms on
  fire.playRelease();
  assert.ok(ctx.sources.filter(isCasing).every(heard),
    'the Fire patch\'s casings wait on their own clock');
}

console.log('hand-fire patch clock: ok');
