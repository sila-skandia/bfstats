// `viewer/replay-merge.js` under node (features/round-replay-merge): several
// recordings of one round merged into one, first on a small synthetic round
// two clients recorded, then on a real round split by side and merged back
// (replay_split.mjs). One node run, one JSON report, asserted by
// test_replay_merge.py. The modules are imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, so the files under test are the files
// the page loads.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';
import { indexRecording, playerAt, splitRecording } from './replay_split.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [merge, recording, chapters, { eventKey, maxOf, minOf, spread }] = await Promise.all([
  imp('replay-merge.js'), imp('replay-recording.js'), imp('replay-chapters.js'), imp('replay-merge-read.js'),
]);
const here = path.dirname(fileURLToPath(import.meta.url));
const results = {};
const L = o => JSON.stringify(o);
const round3 = t => Math.round(t * 1000) / 1000;

// --- a synthetic round, recorded by two clients --------------------------------
//
// Client A (pid 3, Allies) records from the round's second 0, client B (pid 8,
// Axis) from second 30, its clock running 50 ppm fast and its events arriving
// up to 20 ms from A's. A Sherman (600) crosses the field at 1 m/s: B's player
// stands 10 m from it from 30 s, drives it from 60 to 80 s and walks 200 m
// off; A's player watches from 300 m from 50 s, runs up to 5 m of it at 80 s,
// and loses it at 90 s. Its turret turns; each file numbers its parts itself.

const TRUE = [];
const add = r => TRUE.push(r);
const both = (from, r) => ({ ...r, files: 'AB', from });
const head = (t, file) => [
  { t, k: 'e', e: 'serverInfo', mapId: 'BF1942', mod: 'bf1942', gameId: 'BF1942', files: file },
  { t, k: 'e', e: 'setLevel', level: 'bf1942/levels/bocage/', mode: 'conquest.con', files: file },
  { t, k: 'e', e: 'createObject', netId: 600, tmpl: 'Sherman', pos: [0, 0, 0], rot: [0, 0, 0], files: file },
  { t, k: 'e', e: 'createPlayer', pid: 3, name: 'skandia', team: 2, ai: 0, netId: 1, vehNetId: 700, camNetId: 2, kitNetId: 0, files: file },
  { t, k: 'e', e: 'createPlayer', pid: 8, name: 'Rut', team: 1, ai: 0, netId: 3, vehNetId: 701, camNetId: 4, kitNetId: 0, files: file },
  { t: t + 0.5, k: 'e', e: 'dbComplete', files: file },
];
for (const r of [...head(0, 'A'), ...head(30, 'B')]) add(r);
for (let i = 0; i < 40; i++) {
  const t = 2 + 5 * i;
  add(both(0, { t, k: 'e', e: 'score', kind: 3, pid: i % 5, victim: 10 + (i % 7), weapon: 1, bodypart: 1 }));
  add(both(0, { t: t + 1.3, k: 'e', e: 'exitVehicle', pid: i % 9 }));
  add(both(0, { t: t + 2.7, k: 'e', e: 'control', pid: i % 4, netId: 800 + i }));
}
const X = t => [t, 0, 0];
const at = (p, dz, y = 0) => [p[0], y, p[2] + dz];
const q = t => [0, Math.sin(t / 20), 0, Math.cos(t / 20)];
for (let t = 0; t <= 200; t = round3(t + 0.1)) {
  // The Sherman in each file that has it; y tells whose sample it was.
  if (t >= 50 && t < 90) add({ t, k: 's', o: [[600, ...at(X(t), 0, 0.001), 0, 0, 0, 1]], files: 'A' });
  if (t >= 30 && t < 100) add({ t, k: 's', o: [[600, ...at(X(t), 0, 0.002), 0, 0, 0, 1]], files: 'B' });
  // Each player's soldier in his own file.
  add({ t, k: 's', o: [[700, ...(t < 80 ? at(X(t), 300) : at(X(t), 5)), 0, 0, 0, 1]], files: 'A' });
  if (t >= 30) add({ t, k: 's', o: [[701, ...(t < 80 ? at(X(t), 10) : at(X(t), 200)), 0, 0, 0, 1]], files: 'B' });
  if (Math.abs(t - Math.round(t)) < 1e-9) {
    add({ t, k: 'j', o: [[600, 5, ...q(t)], [600, 6, 0, 0, 0, 1]], files: 'A' });
    if (t >= 30) add({ t, k: 'j', o: [[600, 12, ...q(t)], [600, 13, 0, 0, 0, 1]], files: 'B' });
    add({ t, k: 'g', o: [[600, t / 200, 0, 1, 1, 7]], files: 'A' });
    if (t >= 30) add({ t, k: 'g', o: [[600, t / 200, 0, 1, 1, 14]], files: 'B' });
  }
}
add({ t: 0.6, k: 'jn', o: [[600, 5, 'ShermanTower', 0, -0.8, 0], [600, 6, 'ShermanGunBase', 0, 1.15, -0.77]], files: 'A' });
add({ t: 30.6, k: 'jn', o: [[600, 12, 'ShermanTower', 0, -0.8, 0], [600, 13, 'ShermanGunBase', 0, 1.15, -0.77]], files: 'B' });
add({ t: 50, k: 'o', id: 600, gid: 9, tmpl: 'Sherman', tid: 2916, team: 2, maxhp: 100, crit: 12, files: 'A' });
add({ t: 90, k: 'd', id: 600, files: 'A' });
add({ t: 30.6, k: 'o', id: 600, gid: 5, tmpl: 'Sherman', tid: 2916, team: 2, maxhp: 100, crit: 12, files: 'B' });
add({ t: 100, k: 'd', id: 600, files: 'B' });
add({ t: 0.6, k: 'o', id: 700, gid: 1, tmpl: 'USMarineSoldier', tid: 1, team: 2, files: 'A' });
add({ t: 30.6, k: 'o', id: 701, gid: 2, tmpl: 'GermanSoldier', tid: 2, team: 1, files: 'B' });
for (const file of ['A', 'B']) {
  const from = file === 'A' ? 0.6 : 30.6;
  add({ t: from, k: 'p', p: [[3, 2, 700, 700, 0, 0], [8, 1, 701, 701, 0, 0]], files: file });
  add({ t: 60, k: 'p', p: [[8, 1, 600, 600, 0, 0]], files: file });
  add({ t: 80, k: 'p', p: [[8, 1, 701, 701, 0, 0]], files: file });
}
// What one client alone is sent or shows: A's player hit, his team chat, and
// his own chat line, which B's player reads half a second later; a shout both
// heard.
add({ t: 100, k: 'e', e: 'hitFrom', dir: 4, strength: 15, files: 'A' });
add({ t: 120, k: 'e', e: 'chat', pid: 3, first: 1, global: 1, server: 0, total: 5, text: 'hello', files: 'A' });
add({ t: 130, k: 'chat', pid: 3, team: 2, text: 'skandia: gg', files: 'A' });
add({ t: 130.5, k: 'chat', pid: 3, team: 2, text: 'skandia: gg', files: 'B' });
add(both(0, { t: 140, k: 'e', e: 'radio', pid: 5, msg: 15, global: 0 }));
// Each player's own round, marked `local` in his own file: how a file begun at
// the join names its recording player.
add({ t: 3, k: 'f', id: 700, pid: 3, w: 'M1Garand', p: [0, 1, 300], d: [0, 0, 1], local: 1, files: 'A' });
add({ t: 45, k: 'f', id: 701, pid: 8, w: 'K98', p: [45, 1, 10], d: [0, 0, 1], local: 1, files: 'B' });
add({ t: 200, k: 'end', files: 'AB' });

/** The round as client `file` wrote it: from `from`, its clock at `rate`,
 *  its events up to `jitter` s off (a fixed, zero-mean pattern). */
function asFile(file, { from = 0, rate = 1, jitter = 0 } = {}) {
  const mine = TRUE.filter(r => (r.files ?? 'AB').includes(file) && r.t >= from).sort((a, b) => a.t - b.t);
  let n = 0;
  const lines = [L({ k: 'h', v: 5, plus: 'test', start: '2026-09-29T10:00:00', hz: 10 })];
  for (const { files, from: _, ...r } of mine) {
    const off = r.k === 'e' && r.e !== 'dbComplete' && r.t > from + 1 ? jitter * Math.sin(n++ * 2.4) : 0;
    lines.push(L({ ...r, t: round3((r.t - from) * rate + off) }));
  }
  return lines.join('\n');
}
const A = asFile('A');
const B = asFile('B', { from: 30, rate: 1 + 50e-6, jitter: 0.02 });

{
  const { text, report } = merge.mergeRecordings([{ name: 'A.ndjson', text: A }, { name: 'B.ndjson', text: B }]);
  const rec = recording.parseRecording(text);
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  const sherman = lines.filter(r => r.k === 's').flatMap(r => r.o.filter(e => e[0] === 600).map(e => [r.t, e[2]]));
  const fileAt = t => sherman.filter(([at]) => Math.abs(at - t) < 0.051).map(([, y]) => (y === 0.001 ? 'A' : 'B'))[0] ?? null;
  const a = report.alignment[0];
  results.synthetic = {
    offset: a.offset, driftPpm: a.driftPpm, matched: a.matched, residualMs: a.residualMs, worldClock: a.worldClock ?? null,
    kills: lines.filter(r => r.e === 'score').length,
    teamChat: lines.filter(r => r.e === 'chat').length,
    chatBox: lines.filter(r => r.k === 'chat').map(r => r.t),
    hit: lines.find(r => r.e === 'hitFrom') ?? null,
    radio: lines.find(r => r.e === 'radio') ?? null,
    missing: report.events.missing,
    shermanFrom: { 40: fileAt(40), 55: fileAt(55), 70: fileAt(70), 81: fileAt(81), 85: fileAt(85), 95: fileAt(95) },
    switches: report.selection.switches,
    parts: [...(rec.joints.get(600)?.values() ?? [])].map(p => ({ name: p.name, keys: p.keys.length })),
    engines: rec.engines.get(600)?.size ?? 0,
    // Each file writes the turret every whole second; a file taking the hull
    // over writes the value it holds since its last one.
    towerTrue: [...(rec.joints.get(600)?.values() ?? [])].filter(p => p.name === 'ShermanTower')
      .every(p => p.keys.every(k => Math.abs(k.q[1] - Math.sin(Math.floor(k.t + 0.01) / 20)) < 0.002)),
    header: lines[0].merged,
    shots: lines.filter(r => r.k === 'f').length,
  };
}

// --- the part-matching options, and a file of another round -------------------
//
// Each file's ids kept apart ('disjoint') leave the Sherman two turrets. Two
// parts of one template listed the other way round in B: 'rank' pairs them
// crosswise and the report counts it; 'position' pairs them where they sit.
{
  const parts = options => {
    const { text, report } = merge.mergeRecordings([{ name: 'A', text: A }, { name: 'B', text: B }], options);
    const rec = recording.parseRecording(text);
    return { parts: rec.joints.get(600)?.size ?? 0, engines: rec.engines.get(600)?.size ?? 0, children: report.children };
  };
  const swap = (text, first, second) => text
    .replace('"ShermanTower",0,-0.8,0', `"AAGun",${first}`)
    .replace('"ShermanGunBase",0,1.15,-0.77', `"AAGun",${second}`);
  const A2 = swap(A, '1,0,0', '-1,0,0');
  const B2 = swap(B, '-1,0,0', '1,0,0');
  const twins = options => merge.mergeRecordings([{ name: 'A', text: A2 }, { name: 'B', text: B2 }], options).report.children;
  results.childMatch = {
    rank: parts({}), disjoint: parts({ childMatch: 'disjoint' }),
    reversedRank: twins({}), reversedPosition: twins({ childMatch: 'position' }),
  };
  // The animation table is the same mod's on every client; one that is not
  // has its bodies' states renumbered by name. B's lists two the other way
  // round, and its soldier crouches.
  const states = order => L({ k: 'anim', t: 0.7, states: order.map((name, i) => [i, name, name === 'Lb_Crouch' ? 0x20 : 0]) });
  const A3 = `${A}\n${states(['Lb_Stand', 'Lb_Crouch'])}`;
  const B3 = `${B}\n${states(['Lb_Crouch', 'Lb_Stand'])}\n${L({ k: 'st', t: 10, o: [[701, 0, 0, 0, 0, 3, 0]] })}`;
  const tables = merge.mergeRecordings([{ name: 'A', text: A3 }, { name: 'B', text: B3 }]);
  const crouched = recording.parseRecording(tables.text);
  results.anim = { tables: tables.report.anim.tables.map(x => x.identical), body: recording.bodyAt(crouched, 701, 45) };
  const other = B.replace('levels/bocage/', 'levels/kursk/');
  try {
    merge.mergeRecordings([{ name: 'A', text: A }, { name: 'B', text: other }]);
    results.otherRound = null;
  } catch (error) {
    results.otherRound = error.message;
  }
}

// A real round's pose pairs run to hundreds of thousands, and the report's
// summaries must take them: Math.max(...values) threw "Maximum call stack
// size exceeded" on the first real pair (a 21-minute file with a 45-minute one).
{
  const many = Array.from({ length: 300000 }, (_, i) => i % 1000);
  results.bigSpread = { max: spread(many).max, n: spread(many).n, maxOf: maxOf(many), minOf: minOf(many), none: maxOf([]) };
}

// --- a real round, split by side and merged back --------------------------------
//
// `fixtures/merge_bocage_350-385.ndjson.gz` (make_merge_fixture.mjs) is 35 s of
// the public Bocage round of 2026-09-28 as its recording player's client had
// it. It is split into the file its recording player's client (Allies) would
// have written, stopping 5 s early, and the file the Axis player it had in
// range longest would have written, begun 8 s in (so it opens with what the
// recorder keeps of the join), its clock 40 ppm fast, its events up to 30 ms
// off, its parts numbered its own way. Bocage's view distance is 400 m, so
// the radius is 420 m. The merge must give the original back where the two
// cover it. With the full round on this PC, the same again over 536 s.

const rootOf = e => (e.length >= 4 && e[3] >= 0 ? e[3] : e[2]);
const inSpans = (spans, t) => (spans ?? []).some(([a, b]) => t >= a && t < b);
const covered = (spans, a, b) => (spans ?? []).reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

/** The enemy of the original's player it had in range longest. */
function enemyOf(rec) {
  const side = playerAt(rec, rec.local, rec.end)?.[1];
  let best = null;
  for (const pid of rec.players.keys()) {
    let seconds = 0;
    for (let t = 0; t < rec.end; t += 0.5) {
      const e = playerAt(rec, pid, t);
      if (e && e[1] !== side && inSpans(rec.spans.get(rootOf(e)), t) && !/camera/i.test(rec.tmpl.get(rootOf(e)) ?? '')) seconds += 0.5;
    }
    if (!best || seconds > best.seconds) best = { pid, seconds };
  }
  return best.pid;
}

/** Each side's player-time in the world that `spansOf` has in range over
 *  `[from, to]`, by the original's own players' records. */
function playerTime(rec, spansOf, from, to) {
  const out = { 1: [0, 0], 2: [0, 0] };
  for (const [pid, list] of rec.players) {
    list.forEach(([t, e], i) => {
      const a = Math.max(t, from);
      const b = Math.min(list[i + 1]?.[0] ?? rec.end, to);
      const root = rootOf(e);
      if (b <= a || !out[e[1]] || root < 0 || /camera/i.test(rec.tmpl.get(root) ?? '') || !rec.tmpl.has(root)) return;
      out[e[1]][0] += b - a;
      out[e[1]][1] += covered(spansOf(root), a, b);
    });
  }
  return { axis: out[1][1] / out[1][0], allies: out[2][1] / out[2][0] };
}

const union = (...lists) => {
  const all = lists.flatMap(l => l ?? []).map(s => [...s]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of all) {
    if (out.length && s[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], s[1]);
    else out.push(s);
  }
  return out;
};

/** Whether the original's value at `t` (its last sample by then, or the one
 *  before, for a clock fitted to the millisecond) is one for which
 *  `same(key)` holds. A file taking an object over writes the value it holds,
 *  however old. */
function sampled(list = [], t, same) {
  let lo = 0;
  let hi = list.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= t + 0.03) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return [list[i], list[i - 1]].some(k => k && same(k));
}

function splitAndMerge(original, { cutA, fromB, drift, jitter, radius = 420 }) {
  const rec = indexRecording(original);
  const enemy = enemyOf(rec);
  const A = splitRecording(rec, { player: rec.local, radius, from: 0, to: rec.end - cutA });
  const B = splitRecording(rec, { player: enemy, radius, from: fromB, to: rec.end, drift, jitter, seed: 7 });
  const started = Date.now();
  const { text, report } = merge.mergeRecordings([{ name: 'A.ndjson', text: A.text }, { name: 'B.ndjson', text: B.text }]);
  const mergeMs = Date.now() - started;
  // The merged file keeps A's clock, which is the original's.
  const M = indexRecording(text);
  const ideal = id => union(A.range.get(id), B.range.get(id));
  let invented = 0;
  let lost = 0;
  for (const id of new Set([...M.spans.keys(), ...A.range.keys(), ...B.range.keys()])) {
    for (const [a, open] of M.spans.get(id) ?? []) {
      const b = Math.min(open, rec.end);
      invented += (b - a) - covered(rec.spans.get(id), a, b);
    }
    for (const [a, b] of ideal(id)) lost += (b - a) - covered(M.spans.get(id), a, b);
  }
  // Every merged sample is one the original has, where the original has it.
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  let poses = 0;
  let posesOff = 0;
  let joints = 0;
  let jointsOff = 0;
  const partOf = new Map();
  const originalParts = rec.records.filter(x => x.r.k === 'jn').flatMap(x => x.r.o);
  const partKeys = new Map();
  for (const x of rec.records) {
    if (x.r.k !== 'j') continue;
    for (const e of x.r.o) {
      if (!partKeys.has(e[1])) partKeys.set(e[1], []);
      partKeys.get(e[1]).push([x.t, ...e.slice(2)]);
    }
  }
  for (const r of lines) {
    if (r.k === 's') {
      for (const e of r.o) {
        poses += 1;
        if (!sampled(rec.keys.get(e[0]), r.t, k => Math.hypot(k[1] - e[1], k[2] - e[2], k[3] - e[3]) < 0.05)) posesOff += 1;
      }
    } else if (r.k === 'jn') {
      for (const [root, id, tmpl, x, y, z] of r.o) {
        const twin = originalParts.find(p => p[0] === root && p[2] === tmpl && Math.hypot(p[3] - x, p[4] - y, p[5] - z) < 0.011);
        partOf.set(id, twin?.[1] ?? null);
      }
    } else if (r.k === 'j') {
      for (const [, id, ...qv] of r.o) {
        joints += 1;
        if (!sampled(partKeys.get(partOf.get(id)), r.t, k => qv.every((v, j) => Math.abs(v - k[j + 1]) < 0.002))) jointsOff += 1;
      }
    }
  }
  // The same events, once each.
  const keys = records => {
    const out = new Map();
    for (const { r } of records) {
      if (r.k !== 'e' || r.ago !== undefined) continue;
      const key = eventKey(r);
      if (key) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  };
  const before = keys(rec.records);
  const after = keys(M.records);
  let missing = 0;
  let extra = 0;
  for (const [key, n] of before) missing += Math.max(0, n - (after.get(key) ?? 0));
  for (const [key, n] of after) extra += Math.max(0, n - (before.get(key) ?? 0));
  const viewerOf = t => recording.parseRecording(t);
  const vo = viewerOf(original);
  const vm = viewerOf(text);
  const a = report.alignment[0];
  const share = x => ({ axis: Number(x.axis.toFixed(4)), allies: Number(x.allies.toFixed(4)) });
  return {
    duration: rec.end, local: rec.local, enemy, mergeMs,
    offsetErrorMs: Number(((a.offset - fromB) * 1000).toFixed(2)), driftPpm: a.driftPpm, driftFit: a.driftFit,
    matched: a.matched, residualMs: a.residualMs, unmatched: a.unmatched, worldClock: a.worldClock ?? null,
    coverage: {
      original: share(playerTime(rec, id => rec.spans.get(id), 0, rec.end)),
      a: share(playerTime(rec, id => A.range.get(id), 0, rec.end)),
      b: share(playerTime(rec, id => B.range.get(id), 0, rec.end)),
      ideal: share(playerTime(rec, ideal, 0, rec.end)),
      merged: share(playerTime(rec, id => M.spans.get(id), 0, rec.end)),
    },
    inventedSeconds: Number(invented.toFixed(2)), lostSeconds: Number(lost.toFixed(2)),
    poses, posesOff, joints, jointsOff, partsUnmatched: [...partOf.values()].filter(v => v === null).length,
    eventsMissing: missing, eventsExtra: extra,
    header: lines[0].merged.map(m => m.local),
    viewer: {
      kills: [vo.kills.length, vm.kills.length], deaths: [vo.deaths.length, vm.deaths.length],
      hits: vm.hitsTaken.map(h => h.pid), recordingPlayers: chapters.recordingPlayers?.(vm) ?? null,
    },
    report: { pose: report.pose, rates: report.rates, coverage: report.coverage, selection: report.selection, children: report.children },
  };
}

// --- several recording players in the viewer -------------------------------------
//
// A merged file has a recording player per file: the header names them, the
// first is followed first, each one's hits are his own (the wash in his first
// person), each spawns into the round's chapters, and the radio says who
// heard it. Opening two files together in the page merges them first.
{
  const [{ ReplayFeed }, open] = await Promise.all([imp('replay-feed.js'), imp('replay-open.js')]);
  const { text } = merge.mergeRecordings([{ name: 'A.ndjson', text: A }, { name: 'B.ndjson', text: B }]);
  const rec = recording.parseRecording(text);
  const washes = [];
  const comms = { onKill() {}, onCapture() {}, chatLine() {}, clear() {}, tick() {}, setRadioShown() {}, receive() {} };
  const player = { rec, followPid: 8, recordingPid: 3, recordingPids: [3, 8], ctx: { comms, triggerHitIndicator: (octant, alpha) => washes.push(octant) } };
  const feed = new ReplayFeed(player, rec.kills);
  feed.update(90);
  feed.update(110, 8);
  const his = washes.length;
  feed.invalidate();
  feed.update(90);
  feed.update(110, 3);
  // Two players spawning, each into a soldier the merged file sees made.
  const spawning = [
    L({ k: 'h', v: 5, start: '', hz: 10, merged: [{ file: 'a', local: 3 }, { file: 'b', local: 8 }] }),
    ...[[3, 900, 5], [8, 901, 7]].flatMap(([pid, nid, t]) => [
      L({ k: 'e', t, e: 'createObject', netId: nid, tmpl: 'USMarineSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
      L({ k: 'e', t: t + 0.01, e: 'control', pid, netId: nid }),
      L({ k: 'o', t: t + 0.1, id: nid, gid: nid, tmpl: 'USMarineSoldier', tid: 1, team: 2 }),
      L({ k: 's', t: t + 0.1, o: [[nid, 0, 1, 0, 0, 0, 0, 1]] }),
    ]),
  ].join('\n');
  // The page prints the merge's report to its console; this run's stdout is
  // its JSON.
  const info = console.info;
  console.info = () => {};
  const picked = await open.pickedRecording([new File([A], 'A.ndjson'), new File([B], 'B.ndjson')]);
  const single = await open.pickedRecording([new File([A], 'A.ndjson')]);
  console.info = info;
  results.viewer = {
    recordingPlayers: chapters.recordingPlayers(rec),
    recordingPlayer: chapters.recordingPlayer(rec),
    hits: rec.hitsTaken,
    radioTo: rec.radio.map(r => r.to ?? null),
    washes: { followingB: his, followingA: washes.length - his },
    spawnChapters: chapters.buildChapters(recording.parseRecording(spawning)).filter(ch => ch.kind === 'spawn').map(ch => ch.pid),
    oneFile: chapters.recordingPlayers(recording.parseRecording(A)),
    picked: { name: picked.name, merged: Boolean(picked.merged), players: chapters.recordingPlayers(recording.parseRecording(picked.text)) },
    single: { name: single.name, merged: single.merged },
  };
}

const fixture = zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures', 'merge_bocage_350-385.ndjson.gz'))).toString();
results.split = splitAndMerge(fixture, { cutA: 5, fromB: 8, drift: 40e-6, jitter: 0.03 });

const FULL = path.join(process.env.HOME ?? '', '.wine/drive_c/EA Games/Battlefield 1942/replays/replay_20260928-133433.ndjson');
results.fullRound = fs.existsSync(FULL)
  ? splitAndMerge(fs.readFileSync(FULL, 'utf8'), { cutA: 30, fromB: 60, drift: 40e-6, jitter: 0.03 })
  : null;

process.stdout.write(`${JSON.stringify(results)}\n`);

