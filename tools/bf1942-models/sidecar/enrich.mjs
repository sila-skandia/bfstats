#!/usr/bin/env node
// Turn a sidecar recording + its review log into a recording that MOVES.
//
//   node enrich.mjs run.ndjson run.review.ndjson run.enriched.ndjson
//
// The sidecar writes events to run.ndjson and the raw per-object ghost deltas
// to run.review.ndjson. This reads both, decodes every soldier's position from
// its ghost deltas (soldier-ghost.mjs), and writes run.enriched.ndjson: the
// original records plus k:"s" transform samples (position and facing) and
// k:"st" stance rows (animation states, aim, held item, state bits) at 10 Hz,
// with the engine's animation state table (k:"anim") when --names carries
// one. Open the enriched file in the replay viewer and soldiers move, face,
// go prone and fire.
//
// Soldiers are the netIds that appear as a player's control object (the
// `control` event); vehicles and other classes have different ghost bodies and
// are left alone until their decoders land.

import fs from 'node:fs';
import { decodeSoldierBody, SoldierStateTracker } from './soldier-ghost.mjs';
import { loadTidNames } from './names.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--names');
const [inRec, inReview, outRec] = pos;
if (!inRec || !inReview || !outRec) { console.error('usage: node enrich.mjs run.ndjson run.review.ndjson out.ndjson [--names <bf42plus.ndjson|map.json>]'); process.exit(2); }
// Optional tid->template-name map, so objects get a model (otherwise blank map).
const namesFile = opt('names');
const names = namesFile ? loadTidNames(namesFile) : { tidNames: {}, animStates: null };
const tidNames = names.tidNames;
const animStates = names.animStates; // the engine's state table: names the body's lower/upper indices
const nNames = Object.keys(tidNames).length;

const recLines = fs.readFileSync(inRec, 'utf8').trim().split('\n');
const soldiers = new Set();
let header = null;
const base = [];
for (const l of recLines) {
  let r; try { r = JSON.parse(l); } catch { continue; }
  if (r.k === 'h') header = r;
  if (r.k === 'e' && r.e === 'control' && r.netId != null) soldiers.add(r.netId);
  base.push(r);
}

// Object identity per netId, so a k:"o" can name it and set its side.
const info = new Map(); // netId -> {tid, tmpl, team}
const pidTeam = new Map();
for (const r of base) {
  if (r.e === 'createPlayer') pidTeam.set(r.pid, r.team);
  if (r.e === 'createObject' && r.netId != null) info.set(r.netId, { tid: r.tid, tmpl: tidNames[r.tid] || r.tmpl || '', team: 0 });
}
for (const r of base) { // control links a soldier netId to a player's team
  if (r.e === 'control' && r.netId != null && info.has(r.netId)) info.get(r.netId).team = pidTeam.get(r.pid) ?? 0;
}

// Walk the ghost review log. First time a netId appears it is in range, so
// open a replicated span with a k:"o" (what makes the replayer draw it at all,
// replay-recording.js:954 / replay-actors.js:56). For soldiers, also decode a
// position track (k:"s"). Vehicles get the k:"o" so they render solid at their
// spawn, and will move once the vehicle ghost body is decoded.
const lastPos = new Map();
const lastRot = new Map();
const buckets = new Map();
const stBuckets = new Map();
const stance = new SoldierStateTracker();
const oLines = [];
const seen = new Set();
let decoded = 0, skipped = 0;
for (const l of fs.readFileSync(inReview, 'utf8').trim().split('\n')) {
  let r; try { r = JSON.parse(l); } catch { continue; }
  if (r.tag !== 'ghost-record') continue;
  const t = Math.round((r.dt ?? 0) * 10) / 10;
  if (!seen.has(r.netId)) {
    seen.add(r.netId);
    const inf = info.get(r.netId) || { tid: 0, tmpl: '', team: 0 };
    oLines.push({ k: 'o', t, id: r.netId, tid: inf.tid, tmpl: inf.tmpl, team: inf.team });
  }
  if (!soldiers.has(r.netId)) continue;
  const tr = decodeSoldierBody(r.hex, r.bodyBits, { baselinePos: lastPos.get(r.netId), animStates: animStates ? animStates.length : 0 });
  const row = tr && stance.update(r.netId, tr);
  if (row) { if (!stBuckets.has(t)) stBuckets.set(t, []); stBuckets.get(t).push(row); }
  if (!tr || !tr.pos) { skipped++; continue; }
  lastPos.set(r.netId, tr.pos);
  if (tr.rot) lastRot.set(r.netId, tr.rot);
  decoded++;
  if (!buckets.has(t)) buckets.set(t, new Map());
  buckets.get(t).set(r.netId, { pos: tr.pos, rot: tr.rot || lastRot.get(r.netId) || [0, 0, 0, 1] });
}

// Build k:"s" (transform) and k:"st" (stance) lines and merge with the
// originals by time.
const sLines = [];
for (const [t, o] of stBuckets) sLines.push({ k: 'st', t, o });
for (const [t, m] of buckets) {
  const o = [...m.entries()].map(([netId, tr]) => {
    const p = tr.pos, q = tr.rot || [0, 0, 0, 1];
    return [netId, +p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2), +q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(4), +q[3].toFixed(4)];
  });
  sLines.push({ k: 's', t, o });
}

// Give each object its template name so the replayer loads a model.
let named = 0;
for (const r of base) {
  if ((r.e === 'createObject' || r.e === 'projPool') && r.tid != null && tidNames[r.tid]) {
    if (!r.tmpl) named++;
    r.tmpl = tidNames[r.tid];
  }
}

const out = fs.createWriteStream(outRec);
const events = base.filter((r) => r.k !== 'h');
const merged = events.concat(oLines, sLines).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
if (header) out.write(JSON.stringify(header) + '\n');
if (animStates) out.write(JSON.stringify({ k: 'anim', t: 0, states: animStates }) + '\n');
for (const r of merged) out.write(JSON.stringify(r) + '\n');
out.end();

const nid = soldiers.size;
console.log(`[enrich] ${oLines.length} objects brought in range (k:o), soldiers ${nid}, decoded ${decoded} positions (${skipped} skipped), ${sLines.length} sample + stance frames (${stBuckets.size} stance), ${animStates ? animStates.length : 0} animation states; named ${named} objects from ${nNames}-template map -> ${outRec}`);
