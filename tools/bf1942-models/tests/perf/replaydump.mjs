// Everything the replay works out of a recording, as one JSON file, for a
// before/after diff of a change meant to alter no answer
// (features/replay-performance): the lives, the feed's rows, the chapters,
// the activity, battles, medals, plays and standouts, the Auto camera's picks,
// and, every 7.3 s of the round, every player's place and state, the vehicles
// crewed, the battles burning, the roster, the tallies, the seats, the crews,
// the hit points and the lives the players control.
//
//   node replaydump.mjs <recording.ndjson> <out.json> [--viewer <other viewer dir>]
//   cmp before.json after.json
//
// `--viewer` loads the modules from another tree (an older checkout's
// `tools/bf1942-models/viewer`); by default this tree's. Lives are written by
// their index, so the files compare byte for byte.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../../sim/env.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--viewer');
const viewer = viewerDir(at >= 0 ? args[at + 1] : null);
const [file, out] = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
if (!file || !out) throw new Error('usage: node replaydump.mjs <recording.ndjson> <out.json> [--viewer <dir>]');
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, C, B, D, H] = await Promise.all([
  imp('replay-recording.js'), imp('replay-chapters.js'), imp('replay-battles.js'), imp('replay-director.js'),
  imp('replay-highlights.js'),
]);

const rec = R.parseRecording(fs.readFileSync(file, 'utf8'));
const index = new Map(rec.lives.map((life, i) => [life, i]));
const clean = value => JSON.parse(JSON.stringify(value, (key, x) => {
  if (x && typeof x === 'object' && index.has(x)) return `life#${index.get(x)}`;
  if (x instanceof Map) return [...x.entries()];
  if (x instanceof Set) return [...x];
  if (ArrayBuffer.isView(x)) return [...x];
  if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
  return x;
}));

const res = {};
res.lives = clean(rec.lives.map(l => ({
  nid: l.nid, tmpl: l.tmpl, pid: l.pid, kit: l.kit, soldier: l.soldier, created: l.created, destroyed: l.destroyed,
  diedAt: l.diedAt, killer: l.killer, kitTemplate: l.kitTemplate, killedAt: l.killedAt, keys: l.keys.length,
})));
res.events = clean(rec.events);
res.fires = clean(rec.fires.map(f => ({ t: f.t, pid: f.pid, nid: f.nid, soldier: f.soldier, kitTemplate: f.kitTemplate })));
const kills = C.killsOf(rec, []);
const chapters = C.buildChapters(rec, [], kills);
res.chapters = clean(chapters);
const model = H.buildModel(rec, { kills, chapters });
for (const key of ['activity', 'battles', 'medals', 'plays', 'intensity', 'hullKills']) res[key] = clean(model[key]);
res.standouts = clean(B.standoutsOf(rec, model.battles, { kills }));
const pids = [...new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])])];
const times = [];
for (let t = 0; t <= rec.duration; t += 7.3) times.push(+t.toFixed(3));
res.frames = times.map(t => clean({
  t,
  where: pids.map(pid => B.whereIs(rec, pid, t, kills)),
  status: pids.map(pid => C.playerStatusAt(rec, pid, t, kills)),
  vehicles: B.vehiclesAt(rec, t, model.hullKills),
  battlesAt: B.battlesAt(model.battles, t).map(b => [b.track.id, b.s.t]),
  roster: C.rosterOf(rec, t),
  tally: C.tallyAt(kills, t, rec),
  roots: pids.map(pid => R.rootOf(rec, R.controlledAt(rec, pid, t), t, pid)),
  hp: rec.lives.filter((l, i) => i % 7 === 0).map(l => R.hpAt(l, t)),
  crews: rec.lives.filter(l => !l.soldier && l.tmpl && l.created <= t && t < l.destroyed).map(l => R.crewOf(rec, l, t)),
  lifeAt: pids.map(pid => R.lifeAt(rec, R.controlledAt(rec, pid, t), t)),
}));
const director = new D.ReplayDirector(model, { fallback: null });
res.director = times.map(t => clean(director.update(t, null)));
fs.writeFileSync(out, JSON.stringify(res));
console.log(`${out}: ${rec.lives.length} lives, ${times.length} instants`);
