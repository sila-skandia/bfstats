// Artillery spotting in a replay (replay-spotting.js) under node: a small
// recording written here line by line -- a scout who marks twice from one
// pooled marker, a gunner of his side in a Priest's gun seat, an enemy scout
// -- read through the pure half (the placements, their owners and matrices,
// the list at a time) and through spotter.js's selector run over that list,
// as the page runs it. When the owner's Battleaxe round is on disk
// (`viewer/replays`, untracked), its markers are read too.
//
// Same pattern as `replay_minimap_harness.mjs`: one node run, one JSON report.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, B, S, P] = await Promise.all([
  imp('replay-recording.js'), imp('replay-battles.js'), imp('replay-spotting.js'), imp('spotter.js'),
]);

const results = {};
const round = v => Math.round(v * 1000) / 1000;
const vec = v => v.map(round);

function recording(build) {
  const lines = [];
  build(o => lines.push(o));
  // In time order, as a recorder writes them.
  const sorted = lines.map((o, i) => [o, i]).sort((x, y) => (x[0].t ?? 0) - (y[0].t ?? 0) || x[1] - y[1]);
  return R.parseRecording(sorted.map(([o]) => JSON.stringify(o)).join('\n'));
}

// A quarter turn about +x, then the recorder's three decimals: a marker
// looking straight down. And one looking along +x and down 45 degrees.
const DOWN = [0.707, 0, 0, 0.707];
const AHEAD = [0.271, 0.653, -0.271, 0.653];
const NORTH = [0, 0, 0, 1];

// S1 (Axis, team 1) stands at (100, 10, 200). His marker (pool object 300)
// is placed at 20 s 30 m over him, drifts for two samples as a client
// extrapolates it and snaps back; at 40 s he marks again from the same spot
// in another direction (the pool hands the same object back); it goes back
// to the pool at 70 s. E1 (Allied, team 2) marks at 30 s over (500, 10, 0)
// with object 310, which the recording stops having at 50 s. G1 (Axis) is
// in the Priest's gun seat (seat 1) from 1 s.
const rec = recording(L => {
  L({ k: 'h', v: 5 });
  for (const [pid, name, team] of [[1, 'S1', 1], [2, 'E1', 2], [3, 'G1', 1]]) {
    L({ k: 'e', t: 0.2, e: 'createPlayer', pid, name, team, ai: 1 });
  }
  L({ k: 'e', t: 0.5, e: 'projPool', tid: 1235, tmpl: 'BinocularsProjectile', netId: 300, count: 1 });
  L({ k: 'e', t: 0.5, e: 'projPool', tid: 1235, tmpl: 'BinocularsProjectile', netId: 310, count: 1 });
  const men = [[200, 'GermanSoldier', [100, 10, 200]], [201, 'USSoldier', [500, 10, 0]], [202, 'GermanSoldier', [0, 10, 0]]];
  for (const [nid, tmpl, pos] of [...men, [500, 'Priest', [0, 10, 0]]]) {
    L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl, tid: 900 + nid, pos, rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: nid, tmpl, tid: 900 + nid, team: 0, maxhp: 100 });
  }
  for (const nid of [300, 310]) L({ k: 'o', t: 1, id: nid, tmpl: 'BinocularsProjectile', tid: 1235, team: 0 });
  const marker = (t, nid, p, q) => ({ k: 's', t, o: [[nid, ...p, ...q]] });
  for (let t = 1; t <= 80; t += 1) {
    L({ k: 's', t, o: [...men.map(([nid, , pos]) => [nid, pos[0], pos[1] + 1, pos[2], ...NORTH]), [500, 0, 10, 0, ...NORTH]] });
    if (t < 20 || t >= 70) L(marker(t, 300, [0, 0, 0], NORTH));
    if (t < 30) L(marker(t, 310, [0, 0, 0], NORTH));
  }
  // S1's first mark, its extrapolated drift and its snap back.
  L(marker(20.0, 300, [100, 41.6, 200], DOWN));
  L(marker(20.1, 300, [101, 41.7, 201], DOWN));
  L(marker(20.2, 300, [102, 41.8, 202], DOWN));
  L(marker(20.3, 300, [100, 41.6, 200], DOWN));
  // His second, from the same spot.
  L(marker(40.0, 300, [100, 41.6, 200], AHEAD));
  L(marker(40.1, 300, [100, 41.6, 200], AHEAD));
  // E1's.
  L(marker(30.0, 310, [500, 41.6, 0], DOWN));
  L({ k: 'p', t: 1, p: [[1, 1, 200], [2, 2, 201], [3, 1, 501, 500, 1]] });
  L({ k: 'd', t: 50, id: 310 });
});

const pids = [...rec.players.keys()];
const where = (pid, t) => B.whereIs(rec, pid, t);
const table = { markerWeapons: [{ template: 'Binoculars', projectile: 'BinocularsProjectile', timeToLive: 120 }] };
const markers = S.scoutMarkers(rec, { table, where, pids });
results.markers = markers.map(m => ({
  id: m.id, nid: m.nid, owner: m.owner, team: m.team, birth: round(m.birth), end: round(m.end), ttl: m.timeToLive,
  eye: vec(m.matrix.position), forward: vec(m.matrix.forward), up: vec(m.matrix.up),
}));
results.live = Object.fromEntries([15, 25, 35, 45, 60, 75].map(t => [t, S.liveMarkers(markers, t).map(m => m.id)]));
// A marker the recording holds past its life leaves the list at its life's
// end (Battleaxe's marker 4: 468.3 s to 595.2 s on a 120 s life).
{
  const late = [{ id: 1, birth: 10, end: 200, timeToLive: 120 }, { id: 2, birth: 20, end: 60, timeToLive: 120 }];
  const removed = [];
  const lateList = new S.RecordedScoutList(late);
  lateList.onRemove = m => removed.push([m.id, lateList.list.length]);
  const seen = {};
  for (const t of [25, 59.9, 60, 129.9, 130, 150]) {
    lateList.update(t);
    seen[t] = lateList.list.map(m => [m.id, round(lateList.remaining(m, t))]);
  }
  results.expiry = { seen, removed, expiry: late.map(m => S.markerExpiry(m)),
                     noLife: S.markerExpiry({ birth: 10, end: 200, timeToLive: 0 }) };
}
results.templates = [...S.markerTemplates({ markerWeapons: [{ projectile: 'Land_Spotter_Projectile', timeToLive: 180 }] })];
results.owner = {
  under: S.markerOwner([0, 40, 0], [{ pid: 7, team: 1, pos: [1, 11, 0] }, { pid: 8, team: 2, pos: [3, 10, 0] }]),
  tooFar: S.markerOwner([0, 40, 0], [{ pid: 7, team: 1, pos: [5, 10, 0] }]),
};

// The selector over the recording's list, as replay-spotting.js runs it: G1
// (Axis) in an artPos seat.
const list = new S.RecordedScoutList(markers);
const view = new P.ScoutView({ save: () => ({}), restore: () => {} });
let now = 0;
const selector = new P.ScoutSelector(list, view, () => ({
  artPos: true, externTrace: true, team: 1, teamOf: pid => R.teamAt(rec, pid, now) || null, now,
}));
const at = t => { now = t; list.update(t); return selector.frame(); };
const snap = () => ({ selected: selector.selected, view: view.markerId, viewing: selector.viewing, line: selector.line,
                      eye: view.matrix ? vec(view.matrix.position) : null });
const sel = {};
at(15); sel.gateBefore = selector.gate();
at(25); sel.gate = selector.gate(); sel.toggle = selector.toggle(); sel.on = snap();
sel.look = view.on ? vec(view.step(null).target) : null;
sel.lookShell = view.on ? vec(view.step([150, 10, 200]).target) : null;
at(35); sel.withEnemy = { live: list.list.map(m => m.id), ...snap() };
sel.stepNext = selector.step(1); sel.afterNext = snap();
at(41); sel.remarked = { live: list.list.map(m => m.id), ...snap() };
sel.toggleAgain = selector.toggle(); sel.newest = snap();
sel.seconds = at(42);
sel.off = (selector.toggle(), snap());
at(75); sel.end = { gate: selector.gate(), ...snap() };
results.selector = sel;

// --- the owner's Battleaxe round, when it is on disk -----------------------------------------

const real = 'replays/20261024-154335-relay-wake-devix-rec/replay_20261024-161456.ndjson';
const full = path.join(viewer, real);
if (fs.existsSync(full)) {
  const r = R.parseRecording(fs.readFileSync(full, 'utf8'));
  const rp = [...new Set([...r.players.keys(), ...(r.playerNids?.keys() ?? [])])];
  const ms = S.scoutMarkers(r, { table, where: (pid, t) => B.whereIs(r, pid, t), pids: rp });
  results.battleaxe = ms.map(m => ({ nid: m.nid, birth: round(m.birth), end: round(m.end), owner: m.owner, team: m.team }));
  // Every whole second of the round: the list never holds a marker whose
  // countdown has run out.
  let worst = Infinity;
  for (let t = 0; t <= (r.duration ?? 2000); t += 0.5) {
    for (const m of S.liveMarkers(ms, t)) worst = Math.min(worst, m.timeToLive - (t - m.birth));
  }
  results.battleaxeLeastRemaining = worst;
  results.battleaxeAt590 = S.liveMarkers(ms, 590).map(m => round(m.birth));
}

process.stdout.write(JSON.stringify(results));
