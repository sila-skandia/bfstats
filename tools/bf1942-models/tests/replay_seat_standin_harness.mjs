// A player the recording has in a seat but no soldier for (replay-bodies.js
// `seatStandIn`): one already in a vehicle when the recording began. The
// recorder's opening snapshot writes the soldiers on foot, not the seated
// ones, so the first life has no soldier in the file and the hull was drawn
// empty: skandia's Mustang on Bocage (`wxprh7ze6n`) flew six minutes with
// nobody in the cockpit. One node run, one JSON report;
// `test_replay_seat_standin.py` reads it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { ReplaySoldiers } = await import(pathToFileURL(path.join(viewer, 'replay-bodies.js')).href);

// The round, as the reader leaves it: the Mustang (569) from the start, BF6
// (pid 6) in its seat 0 from the start and killed at 371.75 s, their first
// soldier the respawn at 386.05 s as a medic. A German (pid 30) in a Tiger
// (534) from the start who never has a soldier of their own; pid 7 on foot.
const sample = (t, x) => ({ t, p: [x, 90, 1000], q: [0, 0, 0, 1] });
const mustang = { nid: 569, tmpl: 'Mustang', team: 2, created: 0, destroyed: Infinity, keys: [sample(0, 800), sample(400, 900)], pose: null, replicated: [] };
const tiger = { nid: 534, tmpl: 'Tiger', team: 1, created: 0, destroyed: Infinity, keys: [sample(0, 500)], pose: null, replicated: [] };
const respawn = { nid: 2359, pid: 6, tmpl: 'USSoldier', team: 2, created: 386.052, destroyed: 457.6, soldier: true, keys: [sample(386.1, 10)], pose: null,
  replicated: [], kits: [{ t: 386.1, tmpl: 'US_Medic' }] };
const onFoot = { nid: 700, pid: 7, tmpl: 'USSoldier', team: 2, created: 0, destroyed: Infinity, soldier: true, keys: [sample(0, 5)], pose: null, replicated: [] };
const germans = [1, 2, 3].map(k => ({ nid: 900 + k, pid: 40 + k, tmpl: 'GermanSoldier', team: 1, created: 0, destroyed: Infinity, soldier: true, keys: [], pose: null, replicated: [] }));
const rec = {
  duration: 1000,
  lives: [mustang, tiger, respawn, onFoot, ...germans],
  seats: new Map([[6, [{ t: 0, root: 569, seat: 0 }]], [30, [{ t: 0, root: 534, seat: 0 }]]]),
  kills: [{ kind: 'kill', victim: 6, killer: 1, t: 371.751 }],
  players: new Map(),
};
const soldiers = Object.create(ReplaySoldiers.prototype);
soldiers.player = { rec };

const brief = life => (life ? {
  nid: life.nid, pid: life.pid ?? null, tmpl: life.tmpl, team: life.team, standIn: Boolean(life.standIn), created: life.created,
  destroyed: Number.isFinite(life.destroyed) ? life.destroyed : null, kit: life.kitTemplate ?? null, sharesHullTrack: life.keys === mustang.keys || life.keys === tiger.keys,
} : null);

const at268 = soldiers.soldierLife(6, 569, 268);
const results = {
  seated: brief(at268),
  again: soldiers.soldierLife(6, 569, 300) === at268,
  afterDeath: brief(soldiers.soldierLife(6, 569, 380)),
  respawned: brief(soldiers.soldierLife(6, 2359, 400)),
  noLifeEver: brief(soldiers.soldierLife(30, 534, 50)),
  onFoot: brief(soldiers.soldierLife(7, 700, 50)),
  notSeated: brief(soldiers.seatStandIn(7, 700, 50)),
};
console.log(JSON.stringify(results));
