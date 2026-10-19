#!/usr/bin/env node
// What a recording SAYS a soldier's body was doing around a time: the recorded
// animation states (stance, firing, reloading, held item) straight from the
// ndjson, resolved with the viewer's own reader (replay-recording.js), so the
// answer is what the page would resolve, not a re-implementation.
//
//   node body_states.mjs <recording.ndjson> --at <seconds> [--window 10]
//        [--player <name substring>] [--nid <netId>] [--all]
//
// `--at` is the replay bar's clock (1:26 -> 86). Output is JSON:
//   header   { v, hz, start, animStates, animStatesSkipped } — zero animStates
//            with animStatesSkipped set means the recorder refused the state
//            table and NO stance can resolve: that is a recorder-side finding.
//   soldiers one row per soldier with stance records in the window, with his
//            pid and name at that time, `bodyAt` sampled at --at, and every
//            recorded state change in the window (t, lower, upper, stance).
// Filter to one player with --player/--nid; --all includes soldiers whose
// stance never changes in the window (parked in one state).
//
// No browser, no server. Pair it with viewer_drawn.mjs to tell data from draw.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const { installModuleHooks, viewerDir } = await import(
  pathToFileURL(path.join(REPO, 'tools', 'bf1942-models', 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(REPO, 'tools', 'bf1942-models', 'viewer'));
installModuleHooks(viewer);
const recording = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!file || opt('at') === null) {
  console.error('usage: node body_states.mjs <recording.ndjson> --at <seconds> [--window 10] [--player name] [--nid id] [--all]');
  process.exit(2);
}
const at = Number(opt('at'));
const window = Number(opt('window', 10));
const wantName = opt('player')?.toLowerCase() ?? null;
const wantNid = opt('nid') ? Number(opt('nid')) : null;
const all = args.includes('--all');

const rec = recording.parseRecording(await readFile(file, 'utf8'));
const { nameAt, bodyAt } = recording;

// Whose body a nid is: the pid controlling it around `at` (soldiers only).
const pidOf = nid => {
  for (const [pid, list] of rec.playerNids ?? []) {
    for (const row of list) if (row.nid === nid && row.t <= at + window) return pid;
  }
  return null;
};

const soldiers = [];
for (const [nid, entries] of rec.stances ?? []) {
  if (wantNid !== null && nid !== wantNid) continue;
  const life = rec.lives.find(l => l.nid === nid);
  const inWindow = entries.filter(e => e.t >= at - window && e.t <= at + window);
  if (!inWindow.length && !all) continue;
  const pid = pidOf(nid);
  const name = pid !== null ? nameAt(rec, pid, at) : null;
  if (wantName && !(name ?? '').toLowerCase().includes(wantName)) continue;
  const state = i => rec.animStates?.[i]?.name ?? `#${i}`;
  const body = bodyAt(rec, nid, at);
  soldiers.push({
    nid,
    pid,
    name,
    template: life?.tmpl ?? null,
    alive: life ? at >= life.created && (life.diedAt === undefined || at < life.diedAt) : null,
    bodyAtT: body ? {
      stance: body.stance, lower: body.lower?.name ?? null, upper: body.upper?.name ?? null,
      firing: body.firing, reloading: body.reloading, item: body.item ?? null,
    } : null,
    changes: inWindow.map(e => ({
      t: +e.t.toFixed(2), lower: state(e.lower), upper: state(e.upper),
      stance: (rec.animStates?.[e.lower]?.flags ?? 0) & 0x40 ? 'prone'
        : (rec.animStates?.[e.lower]?.flags ?? 0) & 0x20 ? 'crouch' : 'stand',
    })),
  });
}

const out = {
  file: path.basename(file),
  at,
  window,
  header: {
    v: rec.version ?? null, start: rec.start || null, duration: +(+rec.duration).toFixed(1),
    level: rec.level ?? null,
    animStates: (rec.animStates ?? []).filter(Boolean).length,
    animStatesSkipped: rec.animStatesSkipped ?? null,
    soldiersWithStances: rec.stances?.size ?? 0,
  },
  crouchedOrProne: soldiers.filter(s => s.bodyAtT && s.bodyAtT.stance !== 'stand')
    .map(s => ({ nid: s.nid, name: s.name, stance: s.bodyAtT.stance })),
  soldiers: soldiers.sort((a, b) => a.nid - b.nid),
};
console.log(JSON.stringify(out, null, 1));
