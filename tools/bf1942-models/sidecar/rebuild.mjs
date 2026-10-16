#!/usr/bin/env node
// Rebuild a sidecar recording from its own event rows and its review log,
// with today's decoders: the same body decoding (body-decoder.mjs) and the
// same ghost rows (ghost-writer.mjs) the live sidecar writes.
//
//   node rebuild.mjs run.ndjson run.review.ndjson run.rebuilt.ndjson [--ref x,y,z]
//
// --ref: the compression reference for records whose review row carries none
// (logs written before 2026-10-16). Every ghost block opened with the
// sidecar's control state, whose root position is that reference; a sidecar
// that never spawned sat on its free camera, Wake's at 870,97,873. Without
// it, a position sent as a delta comes out near the map's origin (the owner's
// round had his soldier at 203, 14, 338 instead of beside the APC at 1073,
// 111, 1211).
//
// The event rows (k:"h", k:"anim", k:"e") are kept as they were; every ghost
// row (k:"o", k:"d", k:"s", k:"st", k:"a", k:"f") is written again from the
// review log's framed records. The review log's clock (`dt`) is the
// recording's own within a few milliseconds.

import fs from 'node:fs';
import { BodyDecoder } from './body-decoder.mjs';
import { GhostWriter } from './ghost-writer.mjs';
import { namesForLevel } from './names.mjs';
import { gameTables } from './game-tables.mjs';

const argv = process.argv.slice(2);
const refAt = argv.indexOf('--ref');
const defaultRef = refAt >= 0 ? argv.splice(refAt, 2)[1].split(',').map(Number) : null;
const [inRec, inReview, outPath] = argv;
if (!inRec || !inReview || !outPath) {
  console.error('usage: node rebuild.mjs run.ndjson run.review.ndjson out.ndjson');
  process.exit(2);
}

const GHOST_KINDS = new Set(['o', 'd', 's', 'st', 'a', 'f', 'j', 'jn', 'tk', 'win', 'ps']);
// Event rows the ghost writer derives (an exit's hand-back of the soldier) are
// written again too, so a recording already rebuilt does not carry two.
const derived = (r) => r.k === 'e' && (r.derived || r.e === 'cp');
const head = [];
const timeline = []; // [t, order, kind, payload]
let animStates = 0;
for (const l of fs.readFileSync(inRec, 'utf8').split('\n')) {
  if (!l) continue;
  let r; try { r = JSON.parse(l); } catch { continue; }
  if (r.k === 'h') { head.push(r); continue; }
  if (r.k === 'anim') { head.push(r); animStates = r.states?.length ?? 0; continue; }
  if (GHOST_KINDS.has(r.k) || derived(r)) continue;
  timeline.push([r.t ?? 0, 0, 'row', r]);
}
// Group the review log's framed records back into their ghost blocks.
// A block's records are consecutive in the log, so a block is a run of one
// seq:tick. Keyed over the whole log instead, a pair seen again later (the
// tick restarts at 0 with a level load or a round restart; Wake co-op,
// 2026-10-16, 65 pairs) put that block's records into the first one's, and
// the restart's ScoreManager and player bodies were written minutes early.
let block = null, blockKey = null;
for (const l of fs.readFileSync(inReview, 'utf8').split('\n')) {
  if (!l) continue;
  let d; try { d = JSON.parse(l); } catch { continue; }
  if (d.tag !== 'ghost-record') continue;
  const key = `${d.seq}:${d.tick}`;
  if (key !== blockKey) { blockKey = key; block = { t: d.dt, tick: d.tick, records: [] }; timeline.push([d.dt, 1, 'block', block]); }
  block.records.push({ netId: d.netId, action: d.action, bodyBits: d.bodyBits, hex: d.hex, ...(d.ref ? { ref: d.ref } : defaultRef ? { ref: defaultRef } : {}) });
}
timeline.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// A recording made without --names has blank templates, and the replay draws
// nothing it cannot name: fill them from the level's saved map and the class
// map, and add the animation table if the run had none.
const setLevel = timeline.find(([, , kind, r]) => kind === 'row' && r.e === 'setLevel')?.[3];
const level = setLevel?.level;
// The template ids, the animation table and the control point names from the
// install, for the recording's own mod (its serverInfo row) and game type; the
// recorded tables otherwise.
const mod = timeline.find(([, , kind, r]) => kind === 'row' && r.e === 'serverInfo' && r.mod)?.[3].mod ?? null;
const auto = namesForLevel(level, { mod, mode: setLevel?.mode });
const g = gameTables({ mod, level, mode: setLevel?.mode });
if (g.cpNames) auto.cpNames = g.cpNames;
if (g.animStates) auto.animStates = g.animStates;
for (const [, , kind, r] of timeline) {
  if (kind !== 'row' || r.k !== 'e' || r.tmpl || r.tid == null) continue;
  if ((r.e === 'createObject' || r.e === 'projPool') && auto.tidNames[r.tid]) r.tmpl = auto.tidNames[r.tid];
}
if (!animStates && auto.animStates) {
  animStates = auto.animStates.length;
  head.push({ k: 'anim', t: 0, states: auto.animStates });
}

const out = [...head];
const objInfo = new Map();
const pidTeam = new Map();
const bodies = new BodyDecoder({ animStates });
const ghosts = new GhostWriter({ write: (row) => out.push(row), objInfo, cpNames: auto.cpNames });
for (const [t, , kind, x] of timeline) {
  if (kind === 'row') {
    out.push(x);
    if (x.k !== 'e') continue;
    bodies.note(x);
    for (const e of ghosts.note(x, t)) {
      const row = { k: 'e', t: x.t, ...e };
      out.push(row);
      bodies.note(row);
      ghosts.note(row, t);
    }
    if (x.e === 'createPlayer') pidTeam.set(x.pid, x.team);
    if (x.e === 'createObject' && x.netId != null) objInfo.set(x.netId, { tid: x.tid, tmpl: x.tmpl || '', team: 0 });
    if (x.e === 'control' && objInfo.has(x.netId)) objInfo.get(x.netId).team = pidTeam.get(x.pid) ?? 0;
    continue;
  }
  for (const r of x.records) if (r.action === 1 && r.hex) { try { bodies.decode(r); } catch { /* stays raw */ } }
  ghosts.block(+t.toFixed(3), x.records, x.tick);
}
fs.writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ rows: out.length, ...ghosts.stats }));
