// The replay loads its soldiers' bodies before it shows (replay-bodies.js
// `warmAt`), under node: every pose pair of every kit in the round, those of
// the men alive at the opening first, with progress. One JSON report on
// stdout, read by test_replay_body_warm.py.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { ReplaySoldiers } = await import(pathToFileURL(path.join(viewer, 'replay-bodies.js')).href);

const loadouts = {
  kits: {
    GB_Assault: { weapons: [{ weapon: 'Bar1918' }, { weapon: 'Colt' }] },
    German_Scout: { weapons: [{ weapon: 'K98Sniper' }, { weapon: 'Luger' }] },
    GB_Medic: { weapons: [{ weapon: 'Thompson' }] },
  },
};
// A man alive from the start, one who spawns at 100 and dies at 200, one who
// spawns at 300, and a second man in a kit already listed.
const rec = {
  lives: [
    { soldier: true, tmpl: 'BritishSoldier', team: 2, created: 1, destroyed: 500, kitTemplate: 'GB_Medic' },
    { soldier: true, tmpl: 'GermanSoldier', team: 1, created: 100, destroyed: 200, kitTemplate: 'German_Scout' },
    { soldier: true, tmpl: 'BritishSoldier', team: 2, created: 300, destroyed: 600, kitTemplate: 'GB_Assault' },
    { soldier: true, tmpl: 'BritishSoldier', team: 2, created: 310, destroyed: 600, kitTemplate: 'GB_Medic' },
  ],
};

const run = async t => {
  const warmed = [];
  const progress = [];
  const self = {
    player: { rec },
    bodies: { warmHeld: async (soldier, team, weapon) => { warmed.push(`${soldier}|${team}|${weapon}`); } },
  };
  self.kitItems = ReplaySoldiers.prototype.kitItems.bind(self);
  const done = await ReplaySoldiers.prototype.warmAt.call(self, loadouts, t, (d, n) => progress.push([d, n]));
  return { done, warmed, last: progress[progress.length - 1], first: progress[0] };
};

const results = { at350: await run(350), at0: await run(0) };
// No warm to call: nothing loads, nothing throws.
results.noBodies = await ReplaySoldiers.prototype.warmAt.call({ player: { rec }, bodies: null }, loadouts, 0);
console.log(JSON.stringify(results));
