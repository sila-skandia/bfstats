// The spawn screen of a dead followed player in a replay under node
// (features/replay-feature-sweep-2026-11-01, entry 14): `spawnPick` parsed,
// what the screen shows while he waits (his pick, kept across lives as
// retail's map keeps it; the wait's countdown to his next spawn), the
// fallback read off his next spawn, the kit rows, and the presenter's show,
// Escape and hide against a stand-in for the page's view.
//
// Same pattern as `replay_debrief_harness.mjs`: the viewer's modules imported
// in place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [recording, deploy] = await Promise.all([imp('replay-recording.js'), imp('replay-deploy.js')]);
const { parseRecording } = recording;
const { ReplayDeploy, deployModelAt, kitRowOf, lastPickOf } = deploy;

const line = o => JSON.stringify(o);
const lines = [line({ k: 'h', v: 5, start: '', hz: 10 })];
const push = o => lines.push(line(o));
push({ k: 'e', t: 0.5, e: 'createPlayer', pid: 5, name: 'Alpha', team: 2, ai: 1 });
push({ k: 'e', t: 0.5, e: 'createPlayer', pid: 6, name: 'Bravo', team: 1, ai: 1 });
/** A soldier of `pid` on `nid`, made and taken at `from`, sampled to `to`. */
const soldier = (pid, nid, team, from, to, pos) => {
  push({ k: 'e', t: from, e: 'createObject', tid: 1763, netId: nid, tmpl: 'GB_Soldier', pos, rot: [0, 0, 0] });
  push({ k: 'e', t: from, e: 'control', pid, netId: nid });
  push({ k: 'o', t: from, id: nid, gid: 1, tmpl: 'GB_Soldier', tid: 1763, team, maxhp: 100 });
  for (let t = from; t <= to + 1e-9; t += 0.5) push({ k: 's', t: +t.toFixed(1), o: [[nid, ...pos, 0, 0, 0, 1]] });
};
// Alpha: a life 1-10 s, dies at 10 (a death with no killer), the body gone
// at 12; picks group 5 with the medic kit at 10.5 (and a clear, group 0, at
// 10.6, which does not undo it); back at 20 at [100, 0, 200]. Dies again at
// 30, picks nothing, back at 40. Bravo: dies at 10, picks nothing, back at
// 20 with no kit recorded; never in the round after 30.
soldier(5, 100, 2, 1, 10, [0, 0, 0]);
soldier(6, 200, 1, 1, 10, [50, 0, 0]);
push({ k: 'e', t: 10, e: 'score', pid: 5, kind: 4 });
push({ k: 'e', t: 10, e: 'score', pid: 6, kind: 4 });
push({ k: 'e', t: 10.5, e: 'spawnPick', pid: 5, group: 5, kit: 3 });
push({ k: 'e', t: 10.6, e: 'spawnPick', pid: 5, group: 0, kit: 3 });
push({ k: 'e', t: 12, e: 'destroyObject', netId: 100 });
push({ k: 'e', t: 12, e: 'destroyObject', netId: 200 });
soldier(5, 101, 2, 20, 30, [100, 0, 200]);
soldier(6, 201, 1, 20, 30, [60, 0, 0]);
push({ k: 'e', t: 30, e: 'score', pid: 5, kind: 4 });
push({ k: 'e', t: 32, e: 'destroyObject', netId: 101 });
soldier(5, 102, 2, 40, 50, [300, 0, 0]);
push({ k: 'end', t: 50 });

const rec = parseRecording(lines.join('\n'));
const loadouts = {
  kits: { German_Assault_Desert: { class: 'Assault' }, GB_Sniper: { class: 'Scout' } },
  levels: { el_alamein: { 1: { slots: { 0: 'German_Scout_Desert', 1: 'German_Assault_Desert' } } } },
};
const opts = { loadouts, level: 'el_alamein' };
const pick = m => m && { team: m.team, group: m.group, kit: m.kit, kitRow: m.kitRow, source: m.source,
                         countdown: m.countdown, since: m.since, spawnAt: m.spawnAt };

const results = {
  skipped: rec.skipped,
  picks: rec.spawnPicks,
  alive: deployModelAt(rec, 5, 5, opts),
  dead: pick(deployModelAt(rec, 5, 10.2, opts)),
  picked: pick(deployModelAt(rec, 5, 15, opts)),
  // His second wait: no pick since, and the first still stands.
  kept: pick(deployModelAt(rec, 5, 35, opts)),
  bravo: pick(deployModelAt(rec, 6, 15, opts)),
  lastPick: [lastPickOf(rec, 5, 10.4), lastPickOf(rec, 5, 11)?.group ?? null],
  rows: [
    kitRowOf('German_Assault_Desert', 1, opts), kitRowOf('german_scout_desert', 1, opts),
    kitRowOf('GB_Sniper', 2, opts), kitRowOf('GB_Medic', 2, opts), kitRowOf('Mystery', 2, opts), kitRowOf(null, 2, opts),
  ],
};

// The presenter, against a stand-in view: first person only, Escape keeps
// it down for the rest of that wait, a new wait brings it back.
const calls = [];
const view = {
  shown: false, flagIndex: -1,
  show(m) { this.shown = true; calls.push(['show', m.group, m.countdown]); },
  hide() { if (this.shown) calls.push(['hide']); this.shown = false; },
};
const player = { rec, kills: rec.kills, followPid: 5, camera: { mode: 'orbit' },
                 ctx: { deployView: () => view, loadouts: () => loadouts, levelDir: () => 'el_alamein' } };
const presenter = new ReplayDeploy(player);
const frames = [];
const frame = (label, t) => { presenter.update(t); frames.push([label, view.shown]); };
frame('orbit, dead', 15);
player.camera.mode = 'pov';
frame('pov, dead', 15);
frame('same second', 15.2);
frame('next second', 16.1);
presenter.onKey({ code: 'Escape', stopPropagation() {}, preventDefault() {} });
frames.push(['escape', view.shown]);
frame('same wait', 17);
frame('alive', 25);
frame('next wait', 35);
presenter.dispose();
results.presenter = { frames, calls };

console.log(JSON.stringify(results));
