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
const R = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

/** A plane flying +x at 100 m/s from t 0 to 10, sampled every 0.1 s; `hole`
 *  leaves out the samples in [a, b), as a recorder out of range does. */
function flight(hole = null) {
  const lines = [];
  const L = o => lines.push(JSON.stringify(o));
  L({ k: 'e', t: 0, e: 'createObject', netId: 7, tmpl: 'Mustang', tid: 1701, pos: [0, 100, 0], rot: [0, 0, 0] });
  L({ k: 'o', t: 0, id: 7, tmpl: 'Mustang', tid: 1701, team: 1, maxhp: 60 });
  for (let i = 0; i <= 100; i++) {
    const t = Math.round(i) / 10;
    if (hole && t >= hole[0] && t < hole[1]) continue;
    L({ k: 's', t, o: [[7, t * 100, 100, 0, 0, 0, 0, 1]] });
  }
  return R.parseRecording(lines.join('\n')).lives.find(l => l.tmpl === 'Mustang');
}

const models = new Map([
  ['m4a1', { category: 'land', hitpoints: 123 }],
  ['tiger', { category: 'land', hitpoints: 155 }],
  ['willys', { category: 'land', hitpoints: 50 }],
  ['mortar', { category: 'land', hitpoints: 100 }],
  ['bf109', { category: 'air', hitpoints: 60 }],
  ['mustang', { category: 'air', hitpoints: 60 }],
  ['lct', { category: 'sea', hitpoints: 400 }],
  ['flak38', { category: 'land', hitpoints: 100 }],
  ['wirbelwind', { category: 'land', hitpoints: 140 }],
  ['76mmspaa29k', { category: 'land', hitpoints: 150 }],
  ['20mmtype2multi_wide', { category: 'land', hitpoints: 120 }],
  ['ho-ri2', { category: 'land', hitpoints: 200 }],
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
    tankToAir: P.kindOfKill(hull('Tiger'), hull('Bf109'), 300, 'Tiger'),
    groundToAir: P.kindOfKill(hull('Flak38'), hull('Bf109'), 300, 'Flak38'),
    spaaOnPlane: P.kindOfKill(hull('Wirbelwind'), hull('Bf109'), 300, 'Wirbelwind'),
    spaaNamedOnPlane: P.kindOfKill(hull('76mmSPAA29K'), hull('Bf109'), 346, '76mmSPAA29K'),
    boreNamedGunOnPlane: P.kindOfKill(hull('20mmType2Multi_wide'), hull('Bf109'), 183, '20mmType2Multi_wide'),
    tankDestroyerOnPlane: P.kindOfKill(hull('Ho-Ri2'), hull('Bf109'), 162, 'Ho-Ri2'),
    aaFromFoot: P.kindOfKill(foot, hull('Bf109'), 120, 'Bazooka'),
    tankToTank: P.kindOfKill(hull('M4A1'), hull('Tiger'), 190, 'M4A1'),
    tankToJeep: P.kindOfKill(hull('M4A1'), hull('Willys'), 190, 'M4A1'),
    tankToMortar: P.kindOfKill(hull('Tiger'), hull('Mortar'), 190, 'Tiger'),
    longShot: P.kindOfKill(foot, foot, 140, 'K98Sniper'),
    shortShot: P.kindOfKill(foot, foot, 60, 'K98Sniper'),
    longGrenade: P.kindOfKill(foot, foot, 140, 'GrenadeAllies'),
    tankOnFoot: P.kindOfKill(hull('Tiger'), foot, 140, 'Tiger'),
    footOnTank: P.kindOfKill(foot, hull('Tiger'), 43, 'Piat'),
    footOnJeep: P.kindOfKill(foot, hull('Willys'), 30, 'Piat'),
    sniperOnBoat: P.kindOfKill(foot, hull('LCT'), 428, 'K98Sniper'),
    sniperOnJeep: P.kindOfKill(foot, hull('Willys'), 226, 'K98Sniper'),
    sniperOnGun: P.kindOfKill(foot, hull('Stationary_mg42'), 186, 'K98Sniper'),
    closeOnBoat: P.kindOfKill(foot, hull('LCT'), 60, 'K98Sniper'),
    sniperOnTankCrew: P.kindOfKill(foot, hull('Tiger'), 240, 'No4Sniper', { hullDied: false }),
    sniperOnPlane: P.kindOfKill(foot, hull('Bf109'), 240, 'K98Sniper'),
    rocketOnTankCrew: P.kindOfKill(foot, hull('Tiger'), 43, 'Piat', { hullDied: false }),
  },
  key: P.shortKey('xhf8sfkt7k', 1664.892, 6),
  levels: ['meuse_river_line-1944', 'el_alamein', 'battle_of_the_bulge'].map(P.levelWords),
  titles: [
    P.titleOf({ kind: 'tank-to-tank', killerVehicle: 'M4A1', victimVehicle: 'Tiger', distance: 192 }, s => s.toUpperCase()),
    P.titleOf({ kind: 'air-to-air', killerVehicle: 'Mustang', victimVehicle: 'Bf109', distance: 410 }),
    P.titleOf({ kind: 'tank-to-air', killerVehicle: 'IS2', victimVehicle: 'Ki-67', distance: 431 }, s => (s === 'IS2' ? 'IS-2' : s === 'Ki-67' ? 'Ki-67 Hiryu' : s)),
    P.titleOf({ kind: 'ground-to-air', killerVehicle: null, victimVehicle: 'Bf109', weapon: 'Bazooka', distance: 120 }),
    P.titleOf({ kind: 'long-shot', weapon: 'K98Sniper', distance: 412, level: 'bocage-1944' }, s => `${s} `),
    P.titleOf({ kind: 'tank-buster', weapon: 'Piat', victimVehicle: 'Tiger', distance: 43 }),
    P.titleOf({ kind: 'long-shot', weapon: null, distance: 206, level: 'omaha_beach' }),
    P.titleOf({ kind: 'own-goal', cause: 'crash', air: true, victimVehicle: 'Spitfire', level: 'battle_of_britain' }),
    P.titleOf({ kind: 'spawn-death', lived: 0.7, level: 'battle_of_britain' }),
    P.titleOf({ kind: 'spawn-death', lived: 5, teamkill: true, level: 'meuse_river_line-1944' }),
    P.titleOf({ kind: 'spawn-death', reel: true, parts: [{}, {}, {}, {}], level: 'savoy' }),
    P.titleOf({ kind: 'own-goal', reel: true, parts: [{ cause: 'crash' }, { cause: 'crash' }, { cause: 'crash' }], level: 'battle_of_britain' }),
    P.titleOf({ kind: 'own-goal', reel: true, parts: [{ cause: 'crash' }, { cause: 'fall' }, { cause: 'explosive' }], level: 'meuse_river_line-1944' }),
    P.titleOf({ kind: 'own-goal', cause: 'fall', distance: 36, level: 'meuse_river_line-1944' }),
    P.titleOf({ kind: 'own-goal', cause: 'explosive', weapon: 'SatchelShort', level: 'meuse_river_line-1944' }, s => (s === 'SatchelShort' ? 'Satchel' : s)),
  ],
  picked: P.pickShorts(list).map(c => c.t),
  pickedOne: P.pickShorts(list, { max: 1 }).map(c => c.t),
  pickedTaken: P.pickShorts(list, { taken: new Set(['k100', 'k500']) }).map(c => c.t),
  // Two tank-to-air kills past a max of 3 are both picked; one at the same
  // moment as a pick is not.
  pickedAlways: P.pickShorts([...list, cand('tank-to-air', 900, 160), cand('tank-to-air', 950, 150), cand('tank-to-air', 102, 155)]).map(c => c.t),
  reels: (() => {
    const c = (kind, t, score) => ({ key: `k${t}`, kind, t, score, lived: 1.5, level: 'savoy' });
    const cands = [c('own-goal', 50, 90), c('own-goal', 10, 95), c('spawn-death', 5, 80), c('spawn-death', 20, 85), c('own-goal', 30, 70), c('tank-to-tank', 40, 99)];
    const own = P.reelOf(cands, 'own-goal', { slug: 's' });
    return { own: own && { key: own.key, times: own.parts.map(p => p.t), victim: own.victim }, spawn: P.reelOf(cands, 'spawn-death', { slug: 's' }), picked: P.pickShorts(cands).map(x => x.kind) };
  })(),
  streaks: (() => {
    // 1 kills 2, 3 and 4, dies to 5; kills 6 after respawning; 7 kills 8 and
    // falls (an uncredited death); 9 teamkills 10 and kills 11 to the end.
    const k = (t, killer, victim, kind = 'kill') => ({ t, killer, victim, kind });
    const rec = { kills: [k(1, 1, 2), k(2, 1, 3), k(3, 1, 4), k(4, 5, 1), k(5, 1, 6),
      k(6, 7, 8), k(7, null, 7, 'death'), k(8, 9, 10, 'teamkill'), k(9, 9, 11)] };
    return P.streaksOf(rec).map(s => [s.pid, s.kills.length, s.endedAt, s.endedBy]);
  })(),
  stretches: (() => {
    // ration's 16 on Baytown (4jxespez6a): times, metres and weapons as
    // recorded; pipi (victim 16) killed him at 1121.4.
    const rows = [[985.1, 22, 16], [1002.3, 130, 32], [1029.7, 79, 40], [1035.5, 94, 29], [1037.4, 39, 12], [1042.8, 58, 40],
      [1058.8, 20, 40], [1060.7, 31, 41], [1062.9, 66, 12], [1071.6, 7, 12], [1072.1, 19, 43], [1084.2, 45, 41],
      [1087.1, 34, 16], [1091.4, 59, 12, 'WalterP38'], [1096.0, 3, 16, 'Colt'], [1117.3, 118, 12]];
    const kills = rows.map(([t, distance, victim, weapon = 'Breda'], i) => ({ t, distance, victim, weapon, streakIndex: i + 1 }));
    const shown = s => ({ kills: s.kills.map(k => k.streakIndex), ending: s.ending, t1: s.t1 });
    return {
      ended: P.pickStretches(kills, { endedBy: 16, endT: 1121.4 }).map(shown),
      alive: P.pickStretches(kills).map(shown),
      // Not held whole over kills 7-11: the next best instead.
      holed: P.pickStretches(kills, { endedBy: 16, endT: 1121.4, whole: t0 => !(t0 > 1050 && t0 < 1060) }).map(shown),
    };
  })(),
  playerReel: (() => {
    const k = (t, victim, score = 10) => ({ t, victim, score, killer: 6, killerName: 'A', air: false, level: 'x' });
    // 290.86 and 763.06 each killed two men with one shell.
    const reels = P.playerReelsOf([k(241.83, 18), k(290.86, 11), k(290.86, 24), k(763.06, 18), k(763.06, 15), k(771.4, 13)], { slug: 's' });
    return reels.map(r => ({ total: r.total, parts: r.parts.map(p => [p.t, p.count]) }));
  })(),
  underFire: (() => {
    // Ruud (2) stands 100 m down +x from Omen (1) and Kar (3); Omen's MP40
    // puts 20 rounds 2 m past his head from 5 s (its dummy FireArms beside
    // each), Kar's K98 five 3 m past; Bot (4) fires 20 more and counts for
    // nothing. Ruud dies at 8.5 s, so the moment ends 0.4 s before.
    const lines = [];
    const L = o => lines.push(JSON.stringify(o));
    L({ k: 'h', v: 5 });
    const man = (pid, name, team, ai = 0) => L({ k: 'e', t: 0.2, e: 'createPlayer', pid, name, team, ai });
    man(1, 'Omen', 1); man(2, 'Ruud', 2); man(3, 'Kar', 1); man(4, 'Bot', 1, 1);
    const at = { 1: [0, 0, 0], 2: [100, 0, 0], 3: [0, 0, 50], 4: [0, 0, -50] };
    for (const [pid, pos] of Object.entries(at)) {
      const nid = 100 * Number(pid);
      const team = pid === '2' ? 2 : 1;
      const tmpl = team === 1 ? 'GermanSoldier' : 'USSoldier';
      L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl, tid: 1700 + team, pos, rot: [0, 0, 0] });
      L({ k: 'o', t: 1, id: nid, tmpl, tid: 1700 + team, team, maxhp: 30 });
      L({ k: 'p', t: 1, p: [[Number(pid), team, nid]] });
    }
    for (let i = 10; i <= 200; i++) {
      const t = i / 10;
      L({ k: 's', t, o: Object.entries(at).map(([pid, p]) => [100 * Number(pid), p[0], p[1] + 1, p[2], 0, 0, 0, 1]) });
    }
    const head = [100, 1.65, 0];
    const past = (from, side) => {
      const d = [head[0] - from[0], head[1] - from[1], head[2] + side - from[2]];
      const n = Math.hypot(...d);
      return d.map(x => x / n);
    };
    const eyeOf = p => [p[0], p[1] + 1.65, p[2]];
    for (let i = 0; i < 20; i++) {
      const t = 5 + i * 0.15;
      L({ k: 'f', t, pid: 1, id: 100, w: 'Mp40', p: eyeOf(at[1]), d: past(at[1], 2) });
      L({ k: 'f', t, pid: 1, id: 100, w: 'Mg34V_dummy', p: eyeOf(at[1]), d: past(at[1], 2) });
      L({ k: 'f', t, pid: 4, id: 400, w: 'Thompson', p: eyeOf(at[4]), d: past(at[4], 2) });
    }
    for (let i = 0; i < 5; i++) L({ k: 'f', t: 6 + i * 0.4, pid: 3, id: 300, w: 'K98', p: eyeOf(at[3]), d: past(at[3], -3) });
    L({ k: 'e', t: 8.5, e: 'score', kind: 3, pid: 1, victim: 2, weaponName: 'Mp40' });
    L({ k: 's', t: 20, o: [] });
    const rec = R.parseRecording(lines.join('\n'));
    const m = P.underFireMomentsOf(rec);
    return m.map(x => ({ pid: x.pid, weapon: x.weapon, weapons: x.weapons.sort(), shooters: x.shooters.sort(),
      passes: x.shots.length, t1: Math.round(x.t1 * 100) / 100, slowAt: x.slowAt >= x.t + 1 }));
  })(),
  families: [P.gunFamily('Coaxial_MG34') === P.gunFamily('MG34_bowMG'), P.gunFamily('Coaxial_Mg34Dual_PZIIIE') === P.gunFamily('Mg34V'),
    P.gunFamily('Coaxial_MG34') === P.gunFamily('PPSh'), P.gunFamily('BrowningCal50') === P.gunFamily('BMG_Browning')],
  week: (() => {
    const m = (what, slug, t, score, weapon) => ({ what, t, score, weapon, slug });
    const rounds = [
      { slug: 'a', moments: [m('automatic', 'a', 10, 30, 'Bren'), m('automatic', 'a', 100, 29, 'Mp40'),
        m('under-fire', 'a', 300, 90, 'Coaxial_MG34'), m('under-fire', 'a', 400, 85, 'MG34_bowMG'), m('under-fire', 'a', 500, 20, 'PPSh')] },
      { slug: 'b', moments: [m('automatic', 'b', 10, 28, 'Thompson'), m('automatic', 'b', 100, 27, 'Breda'),
        m('automatic', 'b', 200, 26, 'Sten')] },
    ];
    const show = list => list?.map(x => `${x.what}:${x.slug}:${x.t}`) ?? null;
    return { automatic: show(P.asmrWeekOf(rounds, 'automatic')), underFire: show(P.asmrWeekOf(rounds, 'under-fire')),
      whips: show(P.asmrMixOf(rounds, 'under-fire', { max: 2, min: 1 })) };
  })(),
  arsenal: (() => {
    const aim = t => ({ t, pos: [0, 0, 0], dir: [1, 0, 0] });
    const m = (what, slug, t, score, weapon, nid = 1) => ({ what, t, score, weapon, nid, platform: 'Tiger', onFoot: false,
      shots: [t, t + 0.5, t + 9], aims: [aim(t), aim(t + 0.5), aim(t + 2)] });
    const rounds = [
      { slug: 'a', moments: [m('cannon', 'a', 100, 90, 'TigerCannon'), m('cannon', 'a', 200, 89, 'PantherCannon'),
        m('cannon', 'a', 300, 88, 'ShermanCannon'), m('automatic', 'a', 400, 20, 'Coaxial_MG34'), m('under-fire', 'a', 500, 99, 'MG42')] },
      { slug: 'b', moments: [m('cannon', 'b', 100, 87, 'StugCannon'), m('automatic', 'b', 200, 19, 'MG34_bowMG'),
        m('automatic', 'b', 300, 18, 'Browning_BowMG'), m('automatic', 'b', 400, 17, 'BesaCoax'), m('clip', 'b', 500, 30, 'M1Garand', null)] },
    ];
    const list = P.arsenalOf(rounds);
    return { picked: list.map(x => `${x.what}:${x.slug}:${x.weapon}`), window: [list[0].t0, list[0].t1] };
  })(),
  continuity: {
    whole: P.continuityOf(flight(), 2, 8),
    hop: P.continuityOf(flight([5, 5.8]), 2, 8),
    hopOutside: P.continuityOf(flight([0.5, 1.3]), 2, 8),
  },
}));
