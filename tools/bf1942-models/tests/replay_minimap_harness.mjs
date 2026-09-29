// The replay's minimap marks under node (features/round-replay-minimap): a
// small recording written here line by line, read at one moment with each
// camera, so every case says exactly what the corner map is handed. When the
// owner's real rounds are on disk (`viewer/replays`, untracked), the marks
// are also read through one of them and counted.
//
// Same pattern as `replay_highlights_harness.mjs`: one node run, one JSON
// report, the modules imported from the viewer tree in place through
// `sim/env.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, B, M] = await Promise.all([imp('replay-recording.js'), imp('replay-battles.js'), imp('replay-minimap.js')]);

const results = {};

function recording(build) {
  const lines = [];
  build(o => lines.push(JSON.stringify(o)));
  return R.parseRecording(lines.join('\n'));
}

// A quarter turn about up, in BF1942's frame: faces +x, east on the art.
const EAST = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const NORTH = [0, 0, 0, 1];

// A1 (Axis) stands at (100, 0, 50) facing east, B1 (Allied) at (-100, 0, 0).
// B2 drives a Sherman at the origin with B3 in its seat 1. A Tiger stands
// empty at (300, 0, 0), a Hanomag lies wrecked at (400, 0, 0), a Kubelwagen
// went out of the recording's range at 2 s. G1 (Axis) was last seen at
// (0, 0, 300) at 3 s.
const rec = recording(L => {
  L({ k: 'h', v: 5 });
  for (const [pid, name, team] of [[1, 'A1', 1], [2, 'B1', 2], [3, 'B2', 2], [4, 'B3', 2], [5, 'G1', 1]]) {
    L({ k: 'e', t: 0.2, e: 'createPlayer', pid, name, team, ai: 1 });
  }
  const objects = [
    [200, 'GermanSoldier', 1, [100, 0, 50], EAST, 30],
    [201, 'USSoldier', 2, [-100, 0, 0], NORTH, 30],
    [202, 'GermanSoldier', 1, [0, 0, 300], NORTH, 30],
    [500, 'Sherman', 0, [0, 0, 0], EAST, 100],
    [510, 'Tiger', 0, [300, 0, 0], NORTH, 100],
    [520, 'Hanomag', 0, [400, 0, 0], NORTH, 100],
    [530, 'Kubelwagen', 0, [500, 0, 0], NORTH, 50],
  ];
  for (const [nid, tmpl, team, pos, q, maxhp] of objects) {
    L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl, tid: 900 + nid, pos, rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: nid, tmpl, tid: 900 + nid, team, maxhp });
  }
  for (const t of [1, 2, 3, 4, 5, 6]) {
    L({ k: 's', t, o: objects.map(([nid, , , pos, q]) => [nid, pos[0], pos[1] + 1, pos[2], ...q]) });
  }
  L({ k: 'a', t: 1, a: [[500, 100], [510, 100], [520, 100], [530, 50]] });
  L({ k: 'a', t: 1.5, a: [[520, 0]] });
  L({ k: 'p', t: 1, p: [[1, 1, 200], [2, 2, 201], [3, 2, 500, 500, 0], [4, 2, 501, 500, 1], [5, 1, 202]] });
  L({ k: 'd', t: 2, id: 530 });
  L({ k: 'd', t: 3, id: 202 });
});

const hullLives = rec.lives.filter(l => ['Sherman', 'Tiger', 'Hanomag', 'Kubelwagen'].includes(l.tmpl));
const pids = [...rec.players.keys()];
const where = (pid, t) => B.whereIs(rec, pid, t);
const round = v => Math.round(v * 1000) / 1000;
const view = marks => ({
  focus: marks.focus && { x: round(marks.focus.x), z: round(marks.focus.z), angle: round(M.mapAngle(marks.focus.dir)) },
  soldiers: marks.soldiers.map(s => ({ pid: s.pid, x: round(s.x), z: round(s.z), angle: round(M.mapAngle(s.dir)),
                                       team: s.team, fresh: s.fresh })),
  hulls: marks.hulls.map(h => ({ tmpl: h.tmpl, x: round(h.x), z: round(h.z), angle: round(M.mapAngle(h.dir)),
                                 team: h.team, fresh: h.fresh })),
});
const at = (t, followPid) => M.minimapMarksAt(rec, t, { where, pids, hullLives, followPid });

results.free = view(at(5, null));
results.followA1 = view(at(5, 1));
results.followDriver = view(at(5, 3));
results.followGunner = view(at(5, 4));
results.followG1 = view(at(5, 5));
results.key = {
  same: M.minimapMarksKey(at(5, null)) === M.minimapMarksKey(at(5, null)),
  followChanges: M.minimapMarksKey(at(5, null)) !== M.minimapMarksKey(at(5, 1)),
};

// --- a real round, when the owner's are on disk -------------------------------------------

results.rounds = {};
for (const file of ['replays/replay_20260928-133433.ndjson']) {
  const full = path.join(viewer, file);
  if (!fs.existsSync(full)) continue;
  const real = R.parseRecording(fs.readFileSync(full, 'utf8'));
  const realPids = [...new Set([...real.players.keys(), ...(real.playerNids?.keys() ?? [])])];
  const hulls = real.lives.filter(l => l.tmpl && !l.soldier && !l.kit && !l.controlPoint && !l.camera && !l.projectile);
  const moments = {};
  let worst = 0;
  for (const t of [60, 120, 240, 400]) {
    const started = performance.now();
    const marks = M.minimapMarksAt(real, t, { where: (pid, at) => B.whereIs(real, pid, at), pids: realPids, hullLives: hulls });
    worst = Math.max(worst, performance.now() - started);
    const bySide = list => ({ 1: list.filter(m => m.team === 1).length, 2: list.filter(m => m.team === 2).length,
                              0: list.filter(m => !m.team).length, faded: list.filter(m => !m.fresh).length });
    moments[t] = { soldiers: bySide(marks.soldiers), hulls: bySide(marks.hulls) };
  }
  results.rounds[path.basename(file, '.ndjson')] = { moments, worstMs: Math.round(worst) };
}

process.stdout.write(JSON.stringify(results));
