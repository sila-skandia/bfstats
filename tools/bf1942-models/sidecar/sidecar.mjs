#!/usr/bin/env node
// The sidecar: join a real BF1942 server, decode its stream, and (a) write a
// bf42plus-v5 replay recording the existing replayer opens unchanged, and (b)
// send everything not yet decodable — the framed per-object ghost (movement)
// deltas and any unknown event or datagram — to a review log, the corpus to
// decode next. Optionally stream the recording live over a localhost
// WebSocket (--ws) for a direct browser link.
//
//   node sidecar.mjs 192.168.1.226:14568 --name sidecar \
//       --out run.ndjson --review run.review.ndjson --ws 17942 --stay 0
//
// The recording holds the static world, roster, and event timeline now;
// movement (k:"s" samples) waits on the ghost-stream decode, so objects sit at
// their created positions until then. Open run.ndjson in the replay viewer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './session.mjs';
import { recordFor, header } from './record.mjs';
import { ReviewLog } from './review.mjs';
import { loadTidNames } from './names.mjs';
import { SoldierStateTracker } from './soldier-ghost.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? '127.0.0.1:14567';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [host, portStr] = target.split(':');
const port = Number(portStr ?? 14567);
const name = opt('name', 'sidecar');
const team = Number(opt('team', 0)); // 0 = auto-assign; set to a human's team to receive their movement
const stay = Number(opt('stay', 0)); // 0 = until Ctrl-C
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const outPath = opt('out', `sidecar-${stamp}.ndjson`);
const reviewPath = opt('review', `sidecar-${stamp}.review.ndjson`);
const wsPort = opt('ws', null);
// Optional tid->template-name map (a bf42plus recording or a saved map), so
// objects carry a model name live. Without it the recording's objects are
// placed but blank. Build one with build-names.mjs.
const namesFile = opt('names', null);
const names = namesFile ? loadTidNames(namesFile) : { tidNames: {}, animStates: null };
const tidNames = names.tidNames;
// The engine's animation state table (from the same source) names the lower
// and upper state indices in a soldier's body: the replayer reads a stance
// (prone, crouch) and a fire from them through the v4 `anim` record.
const animStates = names.animStates;

const out = fs.createWriteStream(outPath);
const review = new ReviewLog(reviewPath);
let t0 = Date.now();
const now = () => +((Date.now() - t0) / 1000).toFixed(3);

let ws = null;
function writeRec(obj) {
  const line = JSON.stringify(obj);
  out.write(line + '\n');
  if (ws) ws.broadcast(line);
}

const stats = { events: 0, records: 0, raws: 0, ghostBlocks: 0, ghostRecords: 0, samples: 0, stances: 0, objects: 0, unknownEvents: 0 };
const stance = new SoldierStateTracker();
// Per-object identity, to name each object and mark it replicated (k:"o") the
// first time it appears in the ghost stream — what makes the replayer draw it.
const objInfo = new Map(); // netId -> {tid, tmpl, team}
const pidTeam = new Map();
const seenGhost = new Set();

const s = new Session(host, port, { name, team, animStates: animStates ? animStates.length : 0 });

s.on('open', async (i) => {
  t0 = Date.now();
  writeRec(header(10, { host, port, name }));
  if (animStates) writeRec({ k: 'anim', t: 0, states: animStates });
  console.log(`[sidecar] ${host}:${port} as "${name}"  recording=${path.resolve(outPath)}  review=${path.resolve(reviewPath)}`);
  if (wsPort) {
    const { WSServer } = await import('./wsserver.mjs');
    ws = new WSServer({ port: Number(wsPort), staticFile: path.join(HERE, 'page', 'index.html') });
    ws.on('connection', (sock) => {
      // Replay the recording so far to a newly-connected page.
      try { for (const l of fs.readFileSync(outPath, 'utf8').trim().split('\n')) if (l) sock.send(l); } catch {}
    });
    const addr = await ws.listen();
    console.log(`[sidecar] live feed: http://127.0.0.1:${addr.port}/  (ws on the same port)`);
  }
});

s.on('connected', (i) => console.log(`[sidecar] connected id=${i.id}`));
s.on('joined', (i) => console.log(`[sidecar] joined as player ${i.playerId} team ${i.team}: ${i.players} players, ${i.objects} objects`));

s.on('event', (ev) => {
  stats.events++;
  const rec = recordFor(ev);
  if (rec === undefined) return;             // client->server echo; nothing to record
  if (rec === null) {                        // parsed but no v5 mapping yet
    stats.raws++;
    writeRec({ k: 'e', t: now(), e: 'raw', type: ev.id ?? null, name: ev.type });
    return;
  }
  stats.records++;
  if ((rec.e === 'createObject' || rec.e === 'projPool') && rec.tid != null && tidNames[rec.tid]) rec.tmpl = tidNames[rec.tid];
  if (rec.e === 'createPlayer') pidTeam.set(rec.pid, rec.team);
  if (rec.e === 'createObject' && rec.netId != null) objInfo.set(rec.netId, { tid: rec.tid, tmpl: rec.tmpl || '', team: 0 });
  if (rec.e === 'control' && rec.netId != null && objInfo.has(rec.netId)) objInfo.get(rec.netId).team = pidTeam.get(rec.pid) ?? 0;
  writeRec({ k: 'e', t: now(), ...rec });
});

s.on('unknown-event', (u) => {               // 7-bit type with no decoder
  stats.unknownEvents++;
  review.unknownEvent(u);
  writeRec({ k: 'e', t: now(), e: 'raw', type: u.id });
});

s.on('ghost', (g) => {
  stats.ghostBlocks++;
  const moved = [];
  const stances = [];
  if (g.records) for (const r of g.records) {
    stats.ghostRecords++;
    review.ghostRecord({ seq: g.seq, tick: g.tick, ...r });
    // First sight of an object in the ghost stream: bring it in range so the
    // replayer draws it (soldiers at their position, hulls solid at spawn).
    if (!seenGhost.has(r.netId)) {
      seenGhost.add(r.netId);
      const inf = objInfo.get(r.netId) || { tid: 0, tmpl: '', team: 0 };
      stats.objects++;
      writeRec({ k: 'o', t: now(), id: r.netId, tid: inf.tid, tmpl: inf.tmpl, team: inf.team });
    }
    // A decoded soldier position and facing become a replay transform sample.
    if (r.pos) { stats.samples++; const q = r.rot || [0, 0, 0, 1]; moved.push([r.netId, +r.pos[0].toFixed(2), +r.pos[1].toFixed(2), +r.pos[2].toFixed(2), +q[0].toFixed(4), +q[1].toFixed(4), +q[2].toFixed(4), +q[3].toFixed(4)]); }
    // A change of animation state, aim, held item or state bits is a `st`
    // row: the body the replayer poses (stance, fire, reload, chute).
    if (r.body) { const row = stance.update(r.netId, r.body); if (row) { stats.stances++; stances.push(row); } }
  }
  if (moved.length) writeRec({ k: 's', t: now(), o: moved });
  if (stances.length) writeRec({ k: 'st', t: now(), o: stances });
  if (g.raw) review.ghostBlockRaw({ seq: g.seq, reason: g.reason, hex: g.raw });
});

s.on('unknown-datagram', (u) => review.unknownDatagram(u));
s.on('decode-error', (e) => review.decodeError(e));
s.on('denied', (i) => { console.log('[sidecar] denied:', i.name); finish(1); });
s.on('disconnected', (i) => { console.log('[sidecar] server disconnected us:', i.name, i.message); finish(1); });

let finished = false;
function finish(code) {
  if (finished) return; finished = true;
  clearTimeout(stayTimer);
  writeRec({ k: 'end', t: now() });
  out.end();
  const sum = review.summary();
  review.close();
  console.log('[sidecar] stats:', JSON.stringify(stats));
  console.log('[sidecar] review:', JSON.stringify(sum));
  if (ws) ws.close();
  setTimeout(() => process.exit(code), 150);
}

await s.start();
const stayTimer = stay > 0 ? setTimeout(() => { s.leave(); finish(0); }, stay * 1000) : null;
process.on('SIGINT', () => { console.log('\n[sidecar] leaving'); s.leave(); finish(0); });
