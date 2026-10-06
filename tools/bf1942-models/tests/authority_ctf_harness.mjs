// The room authority on a CTF layer (`server/authority.mjs` running
// `viewer/ctf.js`): its `ctf` rows, and a client's copy (`ctf.js`
// `applyEvent`, what `ctf-page.js` `onRow` does) agreeing with the server's
// flags after every row. The modules load straight out of the tree with the
// viewer's module hooks (`sim/env.mjs`). Run by `tests/test_authority_ctf.py`;
// prints one JSON object.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { createAuthority } = await import(pathToFileURL(path.join(HERE, '..', 'server', 'authority.mjs')).href);
const { createCtf } = await import(path.join(viewer, 'ctf.js'));

const flagBases = [
  { name: 'USbase', template: 'USbase', position: [0, 0, 100], rotation: [0, 0, 0], team: 2, radius: 5,
    flagLocation: [0, 7.6, 0], flag: { template: 'AmericanFlag', team: 2, radius: 5, timeToRespawn: 30 } },
  { name: 'JPbase', template: 'JPbase', position: [0, 0, -100], rotation: [0, 0, 0], team: 1, radius: 5,
    flagLocation: [0, 7.6, 0], flag: { template: 'JapaneseFlag', team: 1, radius: 5, timeToRespawn: 30 } },
];

function room(extras) {
  const players = new Map();
  const rows = [];
  const world = {
    players, flags: [], extras, tickets: null,
    groundHeight: () => 0,
    setPlayerArmor(slot, armor) { players.get(slot).armor = armor; },
  };
  const authority = createAuthority({ world, loadouts: null, levelDir: 'test', onRow: row => rows.push(row) });
  const join = (slot, team, at) => {
    players.set(slot, { id: slot, team, soldier: { x: at[0], y: at[1], z: at[2] }, occupancy: null, armor: null });
    authority.revive(slot, team, 'assault');
  };
  const move = (slot, at) => Object.assign(players.get(slot).soldier, { x: at[0], y: at[1], z: at[2] });
  return { world, authority, rows, join, move, players };
}

const results = {};
{
  const r = room({ gameplayMode: 'Ctf', flagBases });
  const client = createCtf({ bases: flagBases });
  const DT = 1 / 30;
  let seen = 0;
  let mismatches = 0;
  const tick = () => {
    r.authority.afterStep({ damage: [], crashes: [] }, DT);
    for (; seen < r.rows.length; seen++) if (r.rows[seen].type === 'ctf') client.applyEvent(r.rows[seen]);
    client.follow(slot => { const s = r.players.get(slot)?.soldier; return s ? [s.x, s.y, s.z] : null; });
    const a = JSON.stringify(r.authority.ctf.flags.map(f => [f.home, f.carrier, f.position.map(v => Math.round(v * 10))]));
    const b = JSON.stringify(client.flags.map(f => [f.home, f.carrier, f.position.map(v => Math.round(v * 10))]));
    if (a !== b) mismatches += 1;
  };
  r.join(1, 2, [0, 0, 60]);     // a US player
  r.join(2, 1, [0, 0, -60]);    // a Japanese player
  tick();
  // The US player takes the Japanese flag and carries it home.
  r.move(1, [1, 0, -100]);
  tick();
  r.move(1, [0, 0, 0]);
  tick();
  r.move(1, [1, 0, 100]);
  tick();
  // The Japanese player takes the US flag and dies in the open: it falls.
  r.move(2, [0, 0, 101]);
  tick();
  r.move(2, [30, 0, 30]);
  tick();
  r.players.get(2).armor.applyDamage(1000);
  r.authority.afterStep({ damage: [], crashes: [] }, DT);   // the death decree
  for (; seen < r.rows.length; seen++) if (r.rows[seen].type === 'ctf') client.applyEvent(r.rows[seen]);
  // The US player walks over it: returned.
  r.move(1, [30, 0, 31]);
  tick();
  results.ctf = {
    active: !!r.authority.ctf,
    rows: r.rows.filter(x => x.type === 'ctf').map(x => `${x.kind}:${x.flag}:${x.player}:${x.team}`),
    dropAt: r.rows.find(x => x.type === 'ctf' && x.kind === 'dropped')?.position ?? null,
    killed: r.rows.filter(x => x.type === 'killed').map(x => x.slot),
    mismatches,
    captures: { 1: r.authority.round.teams[1].captures, 2: r.authority.round.teams[2].captures },
    mode: r.authority.round.gamePlayMode,
    bleeds: r.authority.round.bleeding,
  };
}
{
  // A Conquest layer has no CTF and sends no `ctf` row, whatever it lists.
  const r = room({ gameplayMode: 'Conquest', flagBases });
  r.join(1, 2, [1, 0, -100]);
  r.authority.afterStep({ damage: [], crashes: [] }, 1 / 30);
  results.conquest = { active: !!r.authority.ctf, rows: r.rows.filter(x => x.type === 'ctf').length,
                       mode: r.authority.round.gamePlayMode };
}
console.log(JSON.stringify(results));
