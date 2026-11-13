/**
 * A replayed automatic weapon is heard every recorded round, from the first,
 * over the span the live page's Fire Loop holds for the same rounds.
 *
 * The owner (2026-11-12): "In the replays, regular players sound like they're
 * firing pretty much every half second ... If you're holding one and firing
 * (live), they sound fine." The recording carries every round: on qu3znew633
 * (gazala, a client recording) pid 2's Thompson burst is eleven `f` rows,
 * 574.191 to 575.193, 0.097 to 0.105 s apart. The live page holds the
 * Thompson's Fire Loop from the first round and lets the cycle in flight run
 * out after the last (`hand-fire-sound.js` `playHandFire`, ledger SND-12,
 * SND-14). The replay plays a bystander's rounds through `world-fire.js`, one
 * cycle of the same loop a round. What it lost was the first rounds of a
 * weapon's first burst: `WorldFire.play` drops a round whose weapon has no
 * pooled slot yet, and the replay never primed one (`map.html` handed it a
 * `playWorldShot` with no `prime`), so on 3cqup373fj (manchuria-1945, pid 16)
 * an Mp18's first 9 of 41 rounds went unheard. `ReplaySoldiers.primeReports`
 * primes every weapon the recording fires as the replay opens.
 *
 * Stub Web Audio, no browser. Run by `tests/test_replay_auto_fire_sound.py`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const VIEWER = viewerDir();
installModuleHooks(VIEWER);
const viewer = file => import(pathToFileURL(path.join(VIEWER, file)).href);
const { WorldFire } = await viewer('world-fire.js');
const { createHandFireSound } = await viewer('hand-fire-sound.js');
const { ReplaySoldiers } = await viewer('replay-bodies.js');

// --- the recording and the weapon -------------------------------------------

/** qu3znew633 (gazala), pid 2's Thompson: every `f` row of the burst. */
const BURST = [574.191, 574.288, 574.393, 574.491, 574.588, 574.693, 574.790,
               574.887, 574.991, 575.089, 575.193];

/** One cycle of `thompmlp.wav`, as the live tree's mp3 decodes. */
const CYCLE = 0.1;

const distance = params => ({ dest: 'volume', source: 'distance', envelope: 'ramp', params });
/** Vanilla's `Thompson` row of `models/sounds/weapons.json`, as published. */
const THOMPSON = {
  file: 'Thompson.mp3', wav: 'thompmlp.wav', slot: 'fireLoop', volume: 1.0, loop: true,
  layers: [
    { file: 'thompmlp.mp3', loop: true, trigger: null, stop: 'finishsample', volume: 1.0,
      minDistance: 2, priority: 0, stereo: false, doppler: true, randomStartPitch: null,
      relativePosition: [0, 0, 0], modulators: [distance([1, 1, 1, -1])] },
    { file: 'thompmlp.mp3', loop: true, trigger: null, stop: 'finishsample', volume: 1.0,
      minDistance: 2, priority: 0, stereo: false, doppler: true, randomStartPitch: [0.02, 0.01],
      relativePosition: [0, 0, 0], modulators: [distance([1, 1, 0, 1]), distance([10, 150, 1, -1])] },
  ],
};

function stubCtx(clock) {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    sources: [],
    get currentTime() { return clock.t; },
    state: 'running',
    resume() { return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 0,
        positionX: param(), positionY: param(), positionZ: param(),
        orientationX: param(), orientationY: param(), orientationZ: param(-1),
      });
    },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1), onended: null,
        start(when = 0) { this.when = Math.max(when, clock.t); this.looped = this.loop; ctx.sources.push(this); },
        stop() { this.stoppedAt = clock.t; },
      });
    },
  };
  return ctx;
}

const buffer = file => ({ file, duration: CYCLE, sampleRate: 44100, length: 4410, numberOfChannels: 1,
                          getChannelData: () => new Float32Array(1) });
const settle = async (n = 16) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

/** The page's frames at 60 Hz over the burst, each firing the rounds since the
 *  last as `replay.js` `update` does (`t > prevT && t <= now`). */
function frames(times, fps = 60) {
  const out = [];
  let prev = times[0] - 0.05;
  for (let t = prev + 1 / fps; t < times.at(-1) + 0.5; t += 1 / fps) {
    out.push({ t, rounds: times.filter(x => x > prev && x <= t) });
    prev = t;
  }
  return out;
}

/** The replay's path: `ReplaySoldiers.fire` -> `playWorldShot` -> `WorldFire.play`. */
async function replayBurst({ primed }) {
  const clock = { t: BURST[0] - 0.05 };
  const ctx = stubCtx(clock);
  const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
  const fire = new WorldFire({
    listener: () => listener, getBuffer: async rel => buffer(rel),
    manifest: { weapons: { Thompson: THOMPSON } }, master: () => 1, rand: () => 0.5, now: () => clock.t,
  });
  if (primed) { await fire.prime('Thompson'); await settle(); }
  const shooter = { pid: 2 };
  const played = [];
  for (const frame of frames(BURST)) {
    clock.t = frame.t;
    for (const _ of frame.rounds) played.push(fire.play('Thompson', { x: 20, y: 0, z: 0 }, shooter));
    fire.update(1 / 60, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    await settle(2);
  }
  // The far layer is the one a listener 20 m off hears (the near one is
  // `Volume <- Distance` 1 under a metre): its plays, one cycle each.
  const far = ctx.sources.filter(s => !s.looped).map(s => ({ from: s.when, to: s.when + CYCLE }));
  fire.dispose();
  return { played, plays: far.filter((_, i) => i % 2 === 1) };
}

/** The live path: the held Thompson's `playHandFire` each round, and the
 *  release 1/20 s after the last (SND-12) letting the loop's cycle finish. */
async function liveBurst() {
  const clock = { t: BURST[0] - 0.05 };
  const ctx = stubCtx(clock);
  const sound = createHandFireSound({
    AUDIO_OFF: false, audioListener: { context: ctx, getInput: () => ctx.createGain() },
    bust: () => '', masterVolume: () => 1, MODELS_BASE: 'models',
    modelSoundBuffer: async rel => buffer(rel), weaponToken: 1,
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ weapons: { Thompson: THOMPSON } }) });
  const hand = await sound.fetchHandFireSound('Thompson');
  for (const frame of frames(BURST)) {
    clock.t = frame.t;
    for (const _ of frame.rounds) sound.playHandFire(hand);
    if (clock.t >= BURST.at(-1) + 1 / 20 && sound.handFireLoop) sound.releaseHandFireLoop();
  }
  // `looped` as it started: FinishSample turns `loop` off at the release.
  const loops = ctx.sources.filter(s => s.looped);
  const released = BURST.at(-1) + 1 / 20;
  return { loops, from: loops[0]?.when, to: loops[0] ? loops[0].when + Math.ceil((released - loops[0].when) / CYCLE) * CYCLE : null };
}

// --- the replay primes every weapon its recording fires ---------------------

{
  const primed = [];
  const prime = (name, opts) => { primed.push([name, opts]); return Promise.resolve(null); };
  const player = {
    ctx: { playWorldShot: Object.assign(() => {}, { prime }) },
    rec: { fires: [
      { t: 1, weapon: 'Thompson' }, { t: 1.1, weapon: 'thompson' }, { t: 2, weapon: 'Mp40' },
      { t: 3, weapon: 'BF109Guns' }, { t: 4, weapon: null }, { t: 5, weapon: 'USSoldier' },
      { t: 6, weapon: 'K98', press: true },
    ] },
  };
  const names = ReplaySoldiers.prototype.primeReports.call({ player });
  assert.deepEqual(names, ['Thompson', 'Mp40', 'BF109Guns'],
    'each weapon the recording fires once, whatever its case; no press, no soldier stand-in');
  assert.ok(primed.every(([, opts]) => opts?.edges === false), 'the report alone: the replay plays no magazine change');
  assert.deepEqual(ReplaySoldiers.prototype.primeReports.call({ player: { ctx: {}, rec: player.rec } }), [],
    'a page without the prime primes nothing and does not throw');
}

// --- the burst: every round from the first, over the live Fire Loop's span --

{
  const cold = await replayBurst({ primed: false });
  assert.equal(cold.played[0], false,
    'unprimed, the first round finds no slot and is dropped (what the priming removes)');

  const { played, plays } = await replayBurst({ primed: true });
  assert.deepEqual(played, BURST.map(() => true), `primed, every recorded round plays: ${played}`);
  assert.equal(plays.length, BURST.length, 'one cycle of the far layer a round');

  const live = await liveBurst();
  assert.equal(live.loops.length, 1, 'the live page holds one Fire Loop for the burst');
  assert.ok(Math.abs(plays[0].from - live.from) < 1e-9,
    `the replay's first round sounds when the live loop starts: ${plays[0].from} vs ${live.from}`);
  // Nowhere in the burst is the replay silent longer than one 60 Hz frame:
  // the rounds land on frames, the loop does not.
  for (let i = 1; i < plays.length; i++) {
    const gap = plays[i].from - plays[i - 1].to;
    assert.ok(gap <= 1 / 60 + 1e-6, `round ${i} follows the last within a frame: ${gap.toFixed(3)} s`);
  }
  const end = plays.at(-1).to;
  assert.ok(Math.abs(end - live.to) <= CYCLE + 1e-6,
    `and the burst ends within a cycle of the live loop's: ${end.toFixed(3)} vs ${live.to.toFixed(3)}`);
  // Nothing like one report every half second: ten rounds a second.
  const rate = (plays.length - 1) / (plays.at(-1).from - plays[0].from);
  assert.ok(rate > 9 && rate < 11, `the replay's rate of fire is the recording's: ${rate.toFixed(2)} a second`);
}

console.log('replay automatic fire sound: all assertions passed');
