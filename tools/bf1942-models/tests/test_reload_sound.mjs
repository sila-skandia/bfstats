/**
 * A magazine change's foley: the script's Reload slot, triggered once as the
 * change starts (ledger SND-17, `FireArms::Reload` lnxded `0x08289d80`,
 * client `0x00539c80`), for the shooter, a bot, and a seated gun.
 *
 * Every reload in every mod was silent: no `weapons.json` carried a reload
 * and no audio module played slot 1. The four roads it now takes, each with
 * its own hook:
 *
 *   * the player's hand weapon: `hand-fire.js` `startReload` ->
 *     `hand-fire-sound.js` `playReload`, each load at its own `delay`;
 *   * a bot's: `bot-referee.js` `magazineTick` -> `env.onReload` ->
 *     `world-fire.js` `playReload`, the patch's own `Volume <- Distance`
 *     ramps deciding who hears it (nobody past a metre, in the data);
 *   * a seated gun's: `vehicle-audio.js` reads the gun's reload clock and
 *     triggers its `reload` patch as the clock comes off zero.
 *
 * Stub Web Audio, no browser. Run by `tests/test_reload_sound.py`.
 */
import assert from 'node:assert/strict';
import { createHandFireSound } from '../viewer/hand-fire-sound.js';
import { WorldFire } from '../viewer/world-fire.js';
import { VehicleAudioRack } from '../viewer/vehicle-audio.js';
import { loadViewerModules, viewerDir } from '../sim/env.mjs';

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
    currentTime: 10,
    state: 'running',
    resume() { return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({ positionX: param(0), positionY: param(0), positionZ: param(0),
                    refDistance: 1, rolloffFactor: 0 });
    },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1),
        start(when = 0) { this.when = when; ctx.started.push(this); },
        stop() { this.stopped = true; },
        onended: null,
      });
    },
  };
  return ctx;
}

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const buffer = file => ({ file, duration: 0.3 });

// DC's M16 Reload slot, three of its thirteen loads: a step `Volume <- Time`
// gate each (`trigger Volume`), and the near-only `Volume <- Distance` ramp
// every vanilla reload load carries (1 below a metre, 0 above).
const near = { dest: 'volume', source: 'distance', envelope: 'ramp', params: [1, 1, 1, -1] };
const at = seconds => ({ dest: 'volume', source: 'time', envelope: 'ramp', params: [seconds, seconds, 0, 1] });
const reloadLayer = (file, seconds) => ({
  file, loop: false, volume: 1, minDistance: 1, trigger: 'volume', doppler: true,
  relativePosition: null, modulators: [at(seconds), near],
});
const M16 = {
  file: 'M16.mp3', wav: 'M16_loop_ST.wav', slot: 'fireLoop', volume: 0.75, loop: true,
  reload: {
    slot: 1,
    picks: [
      { load: 0, file: 'M16.r1.0.mp3', wav: 'rl2mp18.wav', volume: 1, delay: 0.55 },
      { load: 5, file: 'M16.r1.5.mp3', wav: 'SoFa1.wav', volume: 0.4, delay: 0.7,
        randomStartPitch: [0.03, 0] },
      { load: 2, file: 'M16.r1.2.mp3', wav: 'rl1mp18.wav', volume: 1, delay: 1.5 },
    ],
    layers: [reloadLayer('M16.r1.0.mp3', 0.55), reloadLayer('M16.r1.5.mp3', 0.7),
             reloadLayer('M16.r1.2.mp3', 1.5)],
  },
};

// --- the shooter -----------------------------------------------------------

{
  const ctx = stubCtx();
  const listener = { context: ctx, getInput: () => ctx.createGain() };
  const sound = createHandFireSound({
    AUDIO_OFF: false,
    audioListener: listener,
    bust: () => '',
    masterVolume: () => 1,
    MODELS_BASE: 'models',
    modelSoundBuffer: async rel => buffer(rel),
    weaponToken: 1,
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ weapons: { M16 } }) });
  const fire = await sound.fetchHandFireSound('M16');
  assert.equal(fire.reload.picks.length, 3, 'the reload picks are decoded with the report');
  fire.playReload();
  const plays = ctx.started.map(s => [s.buffer.file, +(s.when - ctx.currentTime).toFixed(3)]);
  assert.deepEqual(plays, [['sounds/M16.r1.0.mp3', 0.55], ['sounds/M16.r1.5.mp3', 0.7],
                           ['sounds/M16.r1.2.mp3', 1.5]],
    'every load starts on its own Time gate, from the moment the change starts');
  const sofa = ctx.started[1];
  assert.ok(sofa.playbackRate.value >= 1 && sofa.playbackRate.value <= 1.03,
    "SoFa1's randomStartPitch 0.03/0 rolls its rate");

  // A weapon whose manifest carries no reload (a tree from before this, or
  // a knife) reloads in silence, as before, and does not throw.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ weapons: { Knife: { file: 'Knife.mp3' } } }) });
  sound.weaponSoundsIndex = null;
  const knife = await sound.fetchHandFireSound('Knife');
  const before = ctx.started.length;
  assert.doesNotThrow(() => knife.playReload());
  assert.equal(ctx.started.length, before, 'no reload, no sound');

  // A patch that rolls one load a trigger plays one (SND-15).
  const picking = { ...M16, reload: { ...M16.reload, randomPlay: true, loads: 13 } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ weapons: { M16: picking } }) });
  sound.weaponSoundsIndex = null;
  const rolled = await sound.fetchHandFireSound('M16');
  const ahead = ctx.started.length;
  const random = Math.random;
  Math.random = () => 5 / 13 + 1e-6;
  rolled.playReload();
  Math.random = random;
  assert.deepEqual(ctx.started.slice(ahead).map(s => s.buffer.file), ['sounds/M16.r1.5.mp3'],
    'a randomPlay reload plays the one load it rolls');
}

// --- a bot, heard from where the camera stands -------------------------------

async function worldReload(distance) {
  const ctx = stubCtx();
  const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
  let now = 0;
  const fire = new WorldFire({
    listener: () => listener,
    getBuffer: async rel => buffer(rel),
    manifest: { weapons: { M16 } },
    master: () => 1,
    rand: () => 0.5,
    now: () => now,
  });
  await fire.prime('M16#reload');
  await settle();
  fire.update(0, { x: 0, y: 0, z: 0 });
  assert.ok(fire.playReload('M16', { x: distance, y: 0, z: 0 }), 'the reload is pooled and plays');
  for (let i = 0; i < 60; i++) {
    now += 1 / 30;
    fire.update(1 / 30, { x: 0, y: 0, z: 0 });
  }
  return { ctx, fire, step: (seconds, x = 0) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      now += 1 / 30;
      fire.update(1 / 30, { x, y: 0, z: 0 });
    }
  } };
}

{
  // Beside him: each load starts as its gate opens.
  const { ctx, fire } = await worldReload(0.5);
  assert.deepEqual(ctx.started.map(s => s.buffer.file),
    ['M16.r1.0.mp3', 'M16.r1.5.mp3', 'M16.r1.2.mp3'],
    'a listener within a metre hears the whole change, load by load');
  const hold = fire.snapshot().weapons.find(w => w.name === 'M16#reload').hold;
  assert.ok(hold >= 1.5 + 0.3, `the slot is held until the last load has played (${hold} s)`);
}

{
  // Ten metres off: the data's own ramps, nothing. And walking up to the spot
  // after the change is over sets nothing off.
  const { ctx, step } = await worldReload(10);
  assert.equal(ctx.started.length, 0, 'nobody past a metre hears a reload');
  step(2.5);
  step(1, 10);
  assert.equal(ctx.started.length, 0, 'and a stale load does not go off when he walks up');
}

// --- a seated gun -------------------------------------------------------------

{
  const ctx = stubCtx();
  const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
  const shot = file => ({ file, loop: false, volume: 1, modulators: [], relativePosition: [0, 0, 0] });
  const TOW = {
    template: 'M2A3', engine: null, layers: [],
    weapons: [{ fireArms: 'M2A3_TOW', script: 'TOW.ssc', layers: [shot('tow_fire.mp3')],
                reload: [shot('rl8grg.mp3'), shot('rl6grg.mp3')] }],
  };
  let left = 0;
  const rack = new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async (_dir, file) => buffer(file),
    report: () => ({ sounds: { vehicles: [TOW] } }),
    dir: () => 'dc_basrahs_edge',
    master: () => 1,
    reloadOf: () => left,
  });
  const hull = { name: 'M2A3', uuid: 'M2A3', userData: { control: 'M2A3' }, children: [],
                 matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] },
                 updateWorldMatrix() {}, traverse(fn) { fn(hull); hull.children.forEach(c => fn(c)); },
                 getObjectByName(n) { return [hull, ...hull.children].find(o => o.name === n) ?? null; } };
  const gun = { ...hull, name: 'M2A3_TOW', uuid: 'tow', userData: { fireArms: true }, children: [] };
  hull.children.push(gun);
  rack.claim({ seatKey: 'gunner', node: hull, template: 'M2A3', drive: null, groups: [{ node: gun }] });
  await settle();
  const reloads = () => ctx.started.filter(s => s.buffer.file.startsWith('rl')).length;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(reloads(), 0, 'no reload, no foley');
  left = 6;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(reloads(), 2, 'the change starting plays the Reload slot');
  for (let i = 0; i < 30; i++) {
    left -= 1 / 30;
    rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  }
  assert.equal(reloads(), 2, 'once a change, not every frame of it');
  left = 0;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  left = 6;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(reloads(), 4, 'the next change plays it again');
  rack.dispose();
}

// --- a bot's magazine change reaches the page ---------------------------------

{
  const M = await loadViewerModules(viewerDir());
  const heard = [];
  const referee = M.createBotReferee({ world: () => null, onReload: (bot, weapon) => heard.push(weapon) });
  const bot = {
    weaponAi: { name: 'Colt' },
    weaponData: { Colt: { magazine: { size: 8, magazines: 4, reloadTime: 4.0 } } },
    weapons: [{ name: 'Colt' }],
    _fireCooldown: 0,
  };
  const mag = referee.magazineOf(bot, 'Colt');
  referee.magazineTick(bot, 1 / 30);
  assert.deepEqual(heard, [], 'a loaded magazine changes nothing');
  mag.rounds = 0;
  referee.magazineTick(bot, 1 / 30);
  assert.deepEqual(heard, ['Colt'], 'a dry one starts the change, and says so once');
  for (let i = 0; i < 30; i++) referee.magazineTick(bot, 1 / 30);
  assert.deepEqual(heard, ['Colt'], 'not again while it runs');
}

console.log('reload-sound: all assertions passed');
