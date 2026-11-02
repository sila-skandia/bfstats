// `replay-recording.js` `inferKits` under node: the kit of a soldier the file
// never saw take one, from his recorded item slots and the weapon each upper
// state names. Synthetic recordings, a small kit table; one JSON report.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(root, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(root, 'viewer'));
installModuleHooks(viewer);
const { inferKits, kitAt } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

const slots = list => list.map(([slot, weapon]) => ({ slot, weapon }));
const loadouts = { kits: {
  US_Medic: { team: 2, weapons: slots([[1, 'KnifeAllies'], [2, 'Colt'], [3, 'Thompson'], [4, 'GrenadeAllies']]) },
  USMarine_Medic: { team: 2, weapons: slots([[1, 'KnifeAllies'], [2, 'Colt'], [3, 'Thompson'], [4, 'GrenadeAllies']]) },
  Us_Assault: { team: 2, weapons: slots([[1, 'KnifeAllies'], [2, 'Colt'], [3, 'Bar1918'], [4, 'GrenadeAllies']]) },
  German_Medic: { team: 1, weapons: slots([[1, 'KnifeAxis'], [2, 'WalterP38'], [3, 'Mp40'], [4, 'GrenadeAxis']]) },
  German_Medic_Desert: { team: 1, weapons: slots([[1, 'KnifeAxis'], [2, 'WalterP38'], [3, 'Mp40'], [4, 'GrenadeAxis']]) },
} };

// One soldier life per `rows` entry ([item, upper state] rows), nid 10 up.
function recordingOf(lives) {
  const names = [];
  const idx = name => { let i = names.indexOf(name); if (i < 0) { names.push(name); i = names.length - 1; } return i; };
  const rec = { animStates: [], stances: new Map(), lives: [], fires: [] };
  lives.forEach((l, n) => {
    const nid = 10 + n;
    rec.lives.push({ nid, soldier: true, tmpl: l.tmpl, team: l.team, created: 0, destroyed: Infinity,
      ...(l.kits ? { kits: l.kits, kitTemplate: l.kits[0].tmpl } : {}) });
    rec.stances.set(nid, l.rows.map(([item, upper], i) => ({ t: i * 0.1, lower: idx('Lb_Stand'), upper: idx(upper), item })));
  });
  rec.animStates = names.map(name => ({ name, flags: 0 }));
  return rec;
}

const rec = recordingOf([
  // 0: Kerem's pattern, Thompson at 3 and grenades at 4. US_Medic and
  // USMarine_Medic agree alike; the template's other lives carry USMarine.
  { tmpl: 'USSoldier', team: 2, rows: [[3, 'Ub_RunForwardThompson'], [3, 'Ub_RunJumpThompson'],
    [4, 'Ub_StandRaiseWeaponGrenadeAllies'], [4, 'Ub_FireGrenadeAllies'], [3, 'Ub_StandRaiseWeaponThompson'],
    [255, 'Ub_HitChestStand']] },
  // 1: a USSoldier whose kit the file saw, for the tie.
  { tmpl: 'USSoldier', team: 2, kits: [{ t: 0, tmpl: 'USMarine_Medic' }], rows: [[3, 'Ub_RunForwardThompson']] },
  // 2: weapon names ending in digits, and the knife's numbered swing.
  { tmpl: 'GermanSoldier', team: 1, rows: [[3, 'Ub_StandAimMp40'], [3, 'Ub_FireMp40'], [2, 'Ub_RunJumpWalterP38'],
    [1, 'Ub_FireKnifeAxis5']] },
  // 3: a Thompson at slot 3 with too much against it (the Bar at 3 twice).
  { tmpl: 'USSoldier', team: 2, rows: [[3, 'Ub_RunForwardThompson'], [3, 'Ub_RunForwardThompson'],
    [3, 'Ub_FireBar1918'], [3, 'Ub_FireBar1918']] },
  // 4: an Allied weapon on the Axis side: no kit of his side agrees.
  { tmpl: 'GermanSoldier', team: 1, rows: [[3, 'Ub_RunForwardThompson']] },
  // 5: dead on first sight, no weapon named.
  { tmpl: 'USSoldier', team: 2, rows: [[255, 'Ub_DieLie']] },
  // 6: a kit the file saw is never replaced.
  { tmpl: 'USSoldier', team: 2, kits: [{ t: 0, tmpl: 'Us_Assault' }], rows: [[3, 'Ub_RunForwardThompson']] },
]);
const given = inferKits(rec, loadouts);
const kitOf = i => ({ kit: kitAt(rec.lives[i], 1), inferred: !!rec.lives[i].kitInferred });

console.log(JSON.stringify({
  given,
  kerem: kitOf(0),
  digits: kitOf(2),
  against: kitOf(3),
  wrongSide: kitOf(4),
  deadOnSight: kitOf(5),
  seen: kitOf(6),
  noTable: inferKits(recordingOf([{ tmpl: 'USSoldier', team: 2, rows: [[3, 'Ub_RunForwardThompson']] }]), null),
}));
