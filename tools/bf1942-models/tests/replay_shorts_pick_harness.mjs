// Replay Shorts' kill picker under node (replay-shorts-pick.js): how a kill is
// classed, how its Short is titled and keyed, and which of a recording's kills
// are filmed. One node run, one JSON report.
// watches: tools/bf1942-models/viewer/replay-shorts-pick.js

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const P = await import(pathToFileURL(path.join(viewer, 'replay-shorts-pick.js')).href);

const models = new Map([
  ['m4a1', { category: 'land', hitpoints: 123 }],
  ['tiger', { category: 'land', hitpoints: 155 }],
  ['willys', { category: 'land', hitpoints: 50 }],
  ['mortar', { category: 'land', hitpoints: 100 }],
  ['bf109', { category: 'air', hitpoints: 60 }],
  ['mustang', { category: 'air', hitpoints: 60 }],
  ['lct', { category: 'sea', hitpoints: 400 }],
]);
const hull = tmpl => ({ tmpl, kind: P.hullKind(tmpl, models) });
const foot = { foot: true };

const cand = (kind, t, score, extra = {}) => ({ key: `k${t}`, kind, t, score, ...extra });
const list = [
  cand('tank-to-tank', 100, 95), cand('tank-to-tank', 104, 93), cand('tank-to-tank', 300, 90),
  cand('long-shot', 500, 70), cand('tank-to-tank', 700, 85),
];

console.log(JSON.stringify({
  hullKinds: ['M4A1', 'Tiger', 'Willys', 'Mortar', 'Bf109', 'LCT', 'Unknown'].map(t => P.hullKind(t, models)),
  kinds: {
    airToAir: P.kindOfKill(hull('Mustang'), hull('Bf109'), 400, 'MustangGuns'),
    groundToAir: P.kindOfKill(hull('Tiger'), hull('Bf109'), 300, 'Tiger'),
    aaFromFoot: P.kindOfKill(foot, hull('Bf109'), 120, 'Bazooka'),
    tankToTank: P.kindOfKill(hull('M4A1'), hull('Tiger'), 190, 'M4A1'),
    tankToJeep: P.kindOfKill(hull('M4A1'), hull('Willys'), 190, 'M4A1'),
    tankToMortar: P.kindOfKill(hull('Tiger'), hull('Mortar'), 190, 'Tiger'),
    longShot: P.kindOfKill(foot, foot, 140, 'K98Sniper'),
    shortShot: P.kindOfKill(foot, foot, 60, 'K98Sniper'),
    longGrenade: P.kindOfKill(foot, foot, 140, 'GrenadeAllies'),
    tankOnFoot: P.kindOfKill(hull('Tiger'), foot, 140, 'Tiger'),
  },
  key: P.shortKey('xhf8sfkt7k', 1664.892, 6),
  levels: ['meuse_river_line-1944', 'el_alamein', 'battle_of_the_bulge'].map(P.levelWords),
  titles: [
    P.titleOf({ kind: 'tank-to-tank', killerVehicle: 'M4A1', victimVehicle: 'Tiger', distance: 192 }, s => s.toUpperCase()),
    P.titleOf({ kind: 'air-to-air', killerVehicle: 'Mustang', victimVehicle: 'Bf109', distance: 410 }),
    P.titleOf({ kind: 'ground-to-air', killerVehicle: null, victimVehicle: 'Bf109', weapon: 'Bazooka', distance: 120 }),
    P.titleOf({ kind: 'long-shot', weapon: 'K98Sniper', distance: 412, level: 'bocage-1944' }),
    P.titleOf({ kind: 'long-shot', weapon: null, distance: 206, level: 'omaha_beach' }),
  ],
  picked: P.pickShorts(list).map(c => c.t),
  pickedOne: P.pickShorts(list, { max: 1 }).map(c => c.t),
  pickedTaken: P.pickShorts(list, { taken: new Set(['k100', 'k500']) }).map(c => c.t),
}));
