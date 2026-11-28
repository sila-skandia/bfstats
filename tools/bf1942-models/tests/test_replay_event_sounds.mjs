// What a replay sounds from its rows rather than its poses: a soldier healed
// at a depot or by a medic (`ReplaySoldiers.healSounds`), and a round that
// flies with a script of its own, the thrown knife's whoosh
// (`ReplayFlights.updateSounds`). Run by test_replay_event_sounds.py.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const VIEWER = viewerDir();
installModuleHooks(VIEWER);
const viewer = file => import(pathToFileURL(path.join(VIEWER, file)).href);
const { ReplaySoldiers } = await viewer('replay-bodies.js');
const { ReplayFlights } = await viewer('replay-flights.js');
const { parseRecording } = await viewer('replay-recording.js');

// --- the heal -----------------------------------------------------------------

{
  // Hellendoorn (5txd9vj8ap): a depot healed the player at 60.767, last at 62.252;
  // a wrench's repair of a hull is no heal of a man.
  const heals = [
    { t: 60.767, t1: 62.252, kind: 'depot', pid: null, to: 0 },
    { t: 67.689, t1: 68.99, kind: 'repair', pid: 0, to: null },
    { t: 70, t1: 70.2, kind: 'medpack', pid: 3, to: 7 },
    { t: 80, t1: 81, kind: 'depot', pid: null, to: null },
  ];
  const played = [];
  const actors = new Map([[0, { state: { dead: false, soldier: { x: 1, y: 2, z: 3 } } }],
                          [7, { state: { dead: false, soldier: { x: 9, y: 0, z: 0 } } }]]);
  let ears = null;
  const self = {
    player: { playing: true, rec: { heals }, ctx: { playSoldierHeal: at => played.push(at) } },
    dragging: false, actors, healAt: null, earsPid: () => ears,
  };
  const frame = t => { ReplaySoldiers.prototype.healSounds.call(self, t); };
  const walk = (from, to, step = 1 / 60) => { for (let t = from; t <= to + 1e-9; t += step) frame(t); };

  walk(60.0, 63.0);
  // 60.767, then every half second to the last heal at 62.252: 60.767, 61.267,
  // 61.767, 62.267 is past it.
  assert.equal(played.length, 3, `one sound a depot cycle across the visit: ${played.length}`);
  assert.deepEqual(played[0], { x: 1, y: 3, z: 3 }, 'at the patient, at his chest');

  // The followed soldier in his own eyes hears it as his body's own.
  played.length = 0; self.healAt = null; ears = 0;
  walk(60.0, 61.0);
  assert.deepEqual(played, [null], 'null: the listener\'s own body');

  // A medic's visit heals the patient, once the first heal has come.
  played.length = 0; ears = null; self.healAt = null;
  walk(69.9, 70.5);
  assert.equal(played.length, 1);
  assert.deepEqual(played[0], { x: 9, y: 1, z: 0 });

  // A repair of a hull, a depot with no patient: nothing.
  played.length = 0; self.healAt = null;
  walk(67.5, 69.2);
  walk(79.9, 81.2);
  assert.equal(played.length, 0, 'a hull repaired and a depot with no man in it are silent');

  // Paused, dragged or after a seek the rows crossed make no sound.
  played.length = 0; self.healAt = null;
  frame(59); frame(65);                       // a seek across the visit
  assert.equal(played.length, 0, 'a seek plays nothing');
  self.player.playing = false;
  walk(60.0, 61.0);
  assert.equal(played.length, 0, 'paused plays nothing');
  self.player.playing = true; self.dragging = true; self.healAt = null;
  walk(60.0, 61.0);
  assert.equal(played.length, 0, 'dragging plays nothing');

  // A dead patient is not healed; a page with no heal sound is not an error.
  self.dragging = false; self.healAt = null; actors.get(0).state.dead = true;
  walk(60.0, 61.0);
  assert.equal(played.length, 0);
  ReplaySoldiers.prototype.healSounds.call({ ...self, player: { ...self.player, ctx: {} }, healAt: null }, 60);
}

// --- a round's own sound while it flies ---------------------------------------

{
  // An EliteKnifeThrowProjectile, `pn` at 43.124 and `pd` at 45.191 on
  // Hellendoorn (5txd9vj8ap), and a bullet's.
  const lines = [
    { k: 'h', v: 5, plus: 'server-replay-recorder/3', start: '2026-11-28T03:31:13', hz: 30 },
    { k: 'f', t: 43.124, id: 580, pid: 0, w: 'EliteKnife', p: [10, 1, -20], d: [1, 0, 0] },
    { k: 'pn', t: 43.124, o: [[4996, 'EliteKnifeThrowProjectile']] },
    { k: 'pj', t: 43.124, o: [[4996, 10, 1, 20]] },
    { k: 'pj', t: 44.0, o: [[4996, 30, 1, 20]] },
    { k: 'pj', t: 45.0, o: [[4996, 50, 1, 20]] },
    { k: 'pd', t: 45.191, o: [4996] },
    { k: 'pn', t: 43.2, o: [[5001, 'MG42Projectile']] },
    { k: 'pj', t: 43.2, o: [[5001, 0, 1, 0]] },
    { k: 'pj', t: 43.3, o: [[5001, 9, 1, 0]] },
    { k: 'pd', t: 43.4, o: [5001] },
  ];
  const parsed = parseRecording(lines.map(l => JSON.stringify(l)).join('\n'));
  const flights = parsed.flights;
  assert.equal(flights.length, 2, 'both flights read');
  const flight = flights.find(f => /knife/i.test(f.tmpl));
  const calls = [];
  const fs = {
    has: name => name.toLowerCase() === 'eliteknifethrowprojectile',
    play: (name, pos, opts) => { calls.push(['play', name, pos, opts]); return 1; },
    stop: token => calls.push(['stop', token]),
  };
  const self = {
    player: { playing: true, rec: { flights }, ctx: { flightSound: fs }, soldiers: { dragging: false } },
    sounding: new Map(), soundSpan: null, lastT: null,
  };
  const step = t => { const prev = self.lastT; self.lastT = t; ReplayFlights.prototype.updateSounds.call(self, t, prev); };

  for (let t = 43.0; t < 43.3; t += 1 / 60) step(t);
  assert.equal(calls.filter(c => c[0] === 'play').length, 1, 'the knife sounds once, the bullet asks nothing');
  const play = calls.find(c => c[0] === 'play');
  assert.equal(play[1], 'EliteKnifeThrowProjectile');
  assert.equal(typeof play[3].follow, 'function', 'and follows the recorded flight');
  const at = play[3].follow();
  assert.ok(Array.isArray(at) && at.length === 3, 'a point to follow');

  for (let t = 43.3; t < 45.0; t += 1 / 60) step(t);
  assert.equal(calls.filter(c => c[0] === 'stop').length, 0, 'it sounds while it flies');
  for (let t = 45.0; t < 45.4; t += 1 / 60) step(t);
  assert.equal(calls.filter(c => c[0] === 'stop').length, 1, 'and stops when the round is gone');
  assert.equal(calls.filter(c => c[0] === 'play').length, 1, 'without being struck up again');

  // A seek cuts a sounding flight, and playback into one in the air picks it up.
  calls.length = 0; self.sounding.clear(); self.lastT = null;
  step(44.0); step(44.02);
  assert.equal(calls.filter(c => c[0] === 'play').length, 1, 'a seek into a flight picks its sound up there');
  step(43.5);
  assert.ok(calls.some(c => c[0] === 'stop') && self.sounding.size === 0, 'a jump back cuts what sounded');
  calls.length = 0;
  self.player.playing = false;
  step(43.52); step(43.54);
  assert.equal(self.sounding.size, 0, 'paused: none');
  assert.equal(calls.filter(c => c[0] === 'play').length, 0);
  self.player.playing = true; self.player.soldiers.dragging = true;
  step(43.56); step(43.58);
  assert.equal(calls.filter(c => c[0] === 'play').length, 0, 'dragged: none');

  // No flight sounds on the page: nothing asked, nothing thrown.
  ReplayFlights.prototype.updateSounds.call({ ...self, player: { ...self.player, ctx: {} } }, 43.2, 43.1);
}

console.log('replay event sounds: all assertions passed');
