// The recording tables export (features/recording-ml), on a round written
// here row by row in the recorder's own format. Prints one JSON blob for
// `test_recording_tables.py`.
//
// The round, 45 s: a Bf 109 ("Prey", Axis) flies a level circle, a Spitfire
// ("Hunter", Allies) follows it 25 degrees behind and fires aimed bursts
// from 30 s to 34 s, when the score says it shot the other down. A second
// Bf 109 ("Passer", Axis) flies straight past 700 m from the circle's
// centre and nobody fires at it or from it. So: one fight by the dogfight
// detector's rules, and two encounters, the second with no shot.
//
// The export runs twice under one name key and once under another.
//
// watches: nothing
// (the folders it lists are its own temporary ones)

import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPORTER = path.resolve(HERE, '..', 'export_recording_tables.mjs');

const DT = 0.1, END = 45, RADIUS = 300, V = 60, Y = 500;
const W = V / RADIUS;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
function onCircle(a) {
  const p = [RADIUS * Math.cos(a), Y, RADIUS * Math.sin(a)];
  const vel = [-Math.sin(a) * V, 0, Math.cos(a) * V];
  const h = Math.atan2(vel[0], vel[2]);
  return { p, vel, q: [0, Math.sin(h / 2), 0, Math.cos(h / 2)] };
}
const prey = t => onCircle(W * t);
const hunter = t => onCircle(W * t - 25 * Math.PI / 180);
const passer = t => ({ p: [-2250 + 100 * t, Y, 700], vel: [100, 0, 0], q: [0, 0.7071, 0, 0.7071] });

const NAMES = ['Hunter', 'Prey', 'Passer'];
const lines = [];
const row = o => lines.push(JSON.stringify(o));
row({ k: 'h', v: 5, plus: '2.0', start: '2026-11-10T10:00:00', hz: 10 });
row({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/battle_of_britain/', mode: 'conquest.con' });
const players = [[1, 'Hunter', 2], [2, 'Prey', 1], [3, 'Passer', 1]];
for (const [pid, name, team] of players) row({ k: 'e', t: 0, e: 'createPlayer', pid, name, team, ai: 0, netId: pid * 10, vehNetId: pid * 10, camNetId: pid * 10, kitNetId: 0 });
const objects = [[100, 'Spitfire', hunter], [200, 'BF109', prey], [300, 'BF109', passer]];
for (const [id, tmpl] of objects) row({ k: 'o', t: 0, id, tmpl, team: 0 });
row({ k: 'p', t: 0, p: [[1, 2, 100, 100, 0, 0], [2, 1, 200, 200, 0, 0], [3, 1, 300, 300, 0, 0]] });
row({ k: 'tk', t: 0, v: [100, 100] });
for (let i = 0; i * DT <= END + 1e-9; i++) {
  const t = r3(i * DT);
  row({ k: 's', t, o: objects.map(([id, , at]) => { const s = at(t); return [id, ...s.p.map(r2), ...s.q.map(v => Math.round(v * 1e4) / 1e4)]; }) });
  if (t >= 30 && t <= 34) {
    // Aimed at the lead: where a 400 m/s round, carrying the plane's own
    // velocity, meets the other.
    const me = hunter(t);
    let aim = prey(t).p;
    for (let k = 0; k < 3; k++) aim = prey(t + Math.hypot(aim[0] - me.p[0], aim[1] - me.p[1], aim[2] - me.p[2]) / 400).p;
    const tof = Math.hypot(aim[0] - me.p[0], aim[1] - me.p[1], aim[2] - me.p[2]) / 400;
    const d = [0, 1, 2].map(k => (aim[k] - me.p[k]) / tof - me.vel[k]);
    const n = Math.hypot(...d);
    row({ k: 'f', t, id: 100, pid: 1, w: 'SpitfireGuns', p: me.p.map(r2), d: d.map(c => r3(c / n)) });
  }
}
row({ k: 'e', t: 34, e: 'score', kind: 3, pid: 1, victim: 2, weaponName: 'SpitfireGuns' });
row({ k: 'tk', t: 34, v: [99, 100] });
row({ k: 'chat', t: 35, pid: 1, team: 2, text: 'Hunter: got one' });
row({ k: 'end', t: END });

const tmp = await mkdtemp(path.join(os.tmpdir(), 'recording-tables-'));
const out = {};
try {
  await mkdir(path.join(tmp, 'raw'), { recursive: true });
  await writeFile(path.join(tmp, 'raw', 'test.ndjson.gz'), gzipSync(lines.join('\n')));
  // The exporter's tally is the last line it writes to stderr.
  const run = (...extra) => {
    const done = spawnSync(process.execPath, [EXPORTER, '--data', tmp, '--no-catalogue', ...extra], { encoding: 'utf8' });
    if (done.status !== 0) throw new Error(`export failed:\n${done.stderr}`);
    return done.stderr;
  };
  const tables = async dir => {
    const got = {};
    for (const name of await readdir(dir)) {
      const text = await readFile(path.join(dir, name), 'utf8');
      got[name.replace(/\.jsonl$/, '')] = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
    }
    return got;
  };
  const dir = path.join(tmp, 'tables', 'test');
  const first = run();
  const t = await tables(dir);
  const text = (await Promise.all((await readdir(dir)).map(n => readFile(path.join(dir, n), 'utf8')))).join('\n');
  const second = run();
  const again = await tables(dir);
  const forced = run('--force');
  const other = path.join(tmp, 'other-key');
  run('--force', '--key-file', other, '--out', path.join(tmp, 'tables-other'));
  const rekeyed = await tables(path.join(tmp, 'tables-other', 'test'));
  const tally = s => JSON.parse(s.trim().split('\n').at(-1));
  const tick = (enc, side, tr) => t.air_ticks.find(x => x.encounter === enc && x.side === side && Math.abs(x.tr - tr) < 0.05) ?? null;
  const shot = t.air_encounters.find(e => e.ref === 'shot') ?? null;
  Object.assign(out, {
    files: Object.keys(t).sort(),
    recording: t.recordings[0],
    players: t.players,
    kills: t.kills,
    tickets: t.tickets.length,
    fights: t.air_fights.map(f => ({ kind: f.kind, kill_side: f.kill_side, planes: [f.plane0, f.plane1] })),
    encounters: t.air_encounters.map(e => ({ ref: e.ref, first_shot_side: e.first_shot_side, kill_side: e.kill_side, fight: e.fight !== null,
      planes: [e.plane0, e.plane1], nids: [e.nid0, e.nid1], aimed: [e.aimed0, e.aimed1], t_ref: e.t_ref, closest: e.closest })),
    tickSpan: shot ? [Math.min(...t.air_ticks.filter(x => x.encounter === shot.encounter).map(x => x.tr)), Math.max(...t.air_ticks.filter(x => x.encounter === shot.encounter).map(x => x.tr))] : null,
    // The hunter (side 0) is behind the prey: nose on, and the prey's nose away.
    before: shot ? [tick(shot.encounter, 0, -10), tick(shot.encounter, 1, -10)] : null,
    namesInTables: NAMES.filter(n => text.includes(n)),
    chatInTables: text.includes('got one'),
    tallies: [tally(first), tally(second), tally(forced)].map(x => ({ written: x.written, skipped: x.skipped, outside: x.fightsOutsideAnEncounter })),
    sameKeysOnASecondRun: JSON.stringify(again.players) === JSON.stringify(t.players),
    keysUnderAnotherKey: rekeyed.players.map(p => p.player),
  });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
