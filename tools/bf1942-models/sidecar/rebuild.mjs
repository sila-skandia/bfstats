#!/usr/bin/env node
// Rebuild a sidecar recording from its own event rows and its review log,
// with today's decoders: the same body decoding (body-decoder.mjs) and the
// same ghost rows (ghost-writer.mjs) the live sidecar writes.
//
//   node rebuild.mjs run.ndjson run.review.ndjson run.rebuilt.ndjson
//
// The event rows (k:"h", k:"anim", k:"e") are kept as they were; every ghost
// row (k:"o", k:"d", k:"s", k:"st", k:"a", k:"f") is written again from the
// review log's framed records. The review log's clock (`dt`) is the
// recording's own within a few milliseconds.

import fs from 'node:fs';
import { BodyDecoder } from './body-decoder.mjs';
import { GhostWriter } from './ghost-writer.mjs';

const [inRec, inReview, outPath] = process.argv.slice(2);
if (!inRec || !inReview || !outPath) {
  console.error('usage: node rebuild.mjs run.ndjson run.review.ndjson out.ndjson');
  process.exit(2);
}

const GHOST_KINDS = new Set(['o', 'd', 's', 'st', 'a', 'f']);
// Event rows the ghost writer derives (an exit's hand-back of the soldier) are
// written again too, so a recording already rebuilt does not carry two.
const derived = (r) => r.k === 'e' && r.derived;
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
const blocks = new Map();
for (const l of fs.readFileSync(inReview, 'utf8').split('\n')) {
  if (!l) continue;
  let d; try { d = JSON.parse(l); } catch { continue; }
  if (d.tag !== 'ghost-record') continue;
  const key = `${d.seq}:${d.tick}`;
  if (!blocks.has(key)) { const b = { t: d.dt, records: [] }; blocks.set(key, b); timeline.push([d.dt, 1, 'block', b]); }
  blocks.get(key).records.push({ netId: d.netId, action: d.action, bodyBits: d.bodyBits, hex: d.hex, ...(d.ref ? { ref: d.ref } : {}) });
}
timeline.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const out = [...head];
const objInfo = new Map();
const pidTeam = new Map();
const bodies = new BodyDecoder({ animStates });
const ghosts = new GhostWriter({ write: (row) => out.push(row), objInfo });
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
  ghosts.block(+t.toFixed(3), x.records);
}
fs.writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ rows: out.length, ...ghosts.stats }));
