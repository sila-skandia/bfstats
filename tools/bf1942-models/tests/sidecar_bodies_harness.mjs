// Dead soldiers' bodies on a live server, replayed from the session that
// showed the pile-up (BF1942-AUSTRALIA, Midway co-op, 63 bots, 2026-10-24,
// `fixtures/sidecar_midway_bodies.ndjson.gz`: the first 125 s of
// sidecar-2026-10-24-11-53-03.ndjson, cut to the player and soldier rows).
//
// The server keeps a dead man's soldier object for `timeToLiveAfterDeath`
// (10 s, DIE-9) and then sends DestroyObject for it; a respawn is a new
// soldier object. A live soldier who leaves this client's ghost scope gets a
// k:"d" (action 3) and nothing else: he is not dead. The page drew every one
// of those as a fresh corpse for 10 s -- 24 at once when the local player
// spawned at t 49.46 and his scope moved.
//
// Driven through `net-sidecar.js` (the pure state's `playerRow`) and the
// renderer `netcode-render.js` (with nothing to load, so every soldier is a
// bare group: what is counted is which bodies it draws, by netId). The
// expected set is derived from the raw rows on their own: a body is a soldier
// netId a death row named, until its DestroyObject, drawn while it has a
// ghost pose (an `s` row since its last k:"d"). A man killed again before
// his first body's DestroyObject has both (`fixtures/sidecar_midway_bodies_twice`,
// the first 190 s of the session before, sidecar-2026-10-24-11-45-43).
//
// Run by tests/test_sidecar_bodies.py, which copies the viewer modules into a
// temp dir (three shimmed) and passes the fixture (and the sidecar's own pid,
// 0 when left out).
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createSidecarState } from './net-sidecar.js';
import { createRemoteRenderer } from './netcode-render.js';

const [fixture, ownPid = '0'] = process.argv.slice(2);
const rows = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

globalThis.fetch = async () => { throw new Error('offline'); };
const st = createSidecarState();
const renderer = createRemoteRenderer({
  scene: new THREE.Scene(),
  loader: { loadAsync: async () => { throw new Error('offline'); }, load: () => {} },
  modelsBase: 'offline', bust: () => '',
  replicateVehicles: () => false,   // server-authority mode: hulls are server-entities.js's
});
const OWN_PID = +ownPid;   // the sidecar's own player in this session
const client = {
  vehicles: new Map(),
  remoteSlots: () => [...st.state.roster.values()].filter((r) => r.pid !== OWN_PID).map((r) => r.slot),
  remotePlayer: (slot) => st.playerRow(slot),
};

// The independent reading of the rows.
const cam = new Map(), tmpl = new Map(), ctl = new Map(), boarded = new Set();
const dead = new Map();      // body netId -> pid
const posed = new Set();     // netIds with a ghost pose since their last k:"d"
const deaths = [];
function expectedBodies() {
  return [...dead.keys()].filter((n) => posed.has(n)).sort((a, b) => a - b);
}
function note(r) {
  if (r.k === 's') for (const o of r.o) posed.add(o[0]);
  else if (r.k === 'd') posed.delete(r.id);
  else if (r.k !== 'e') return;
  switch (r.e) {
    case 'createPlayer': cam.set(r.pid, r.camNetId); ctl.set(r.pid, r.vehNetId); break;
    case 'createObject': tmpl.set(r.netId, r.tmpl); break;
    case 'control': ctl.set(r.pid, r.netId); break;
    case 'enterVehicle': boarded.add(r.pid); break;
    case 'exitVehicle': boarded.delete(r.pid); break;
    case 'destroyObject': dead.delete(r.netId); posed.delete(r.netId); break;
    case 'score':
      if (r.kind === 4 || r.kind === 5) {
        const n = ctl.get(r.pid);
        // A body is the server's object, not the man's: a second death
        // inside the first body's 10 s leaves both lying.
        if (!boarded.has(r.pid) && n !== cam.get(r.pid) && /Soldier/.test(tmpl.get(n) ?? 'Soldier')) {
          dead.set(n, r.pid);
          deaths.push({ t: r.t, pid: r.pid, nid: n });
        }
        boarded.delete(r.pid);
      }
      break;
  }
}

// Step the page every 100 ms of recording time.
const STEP = 0.1;
let next = null, lastT = 0;
let mismatches = 0, firstMismatch = null, maxBodies = 0, frames = 0;
const aliveBefore = new Map();
let scopeLeaves = 0, burst = { t: null, n: 0 };
const leaveTimes = [];
const leftSeen = new Set();
const bodyLife = new Map();  // body netId -> [first drawn t, last drawn t]
const together = new Map();  // pid -> the most of his bodies drawn in one frame
let togetherFrames = 0;      // frames with some man's two or more bodies drawn
function frame(t) {
  const dt = Math.max(1e-3, t - lastT);
  lastT = t;
  renderer.update(dt, client, t * 1000);
  frames++;
  const drawn = renderer.debugBodies().filter((b) => b.slot !== OWN_PID + 1);
  const got = drawn.map((b) => b.id).sort((a, b) => a - b);
  for (const b of drawn) {
    if (b.left) leftSeen.add(b.id);
    const life = bodyLife.get(b.id) ?? [t, t];
    life[1] = t;
    bodyLife.set(b.id, life);
  }
  const want = expectedBodies().filter((n) => dead.get(n) !== OWN_PID);
  const perPid = new Map();
  for (const n of got) if (dead.has(n)) perPid.set(dead.get(n), (perPid.get(dead.get(n)) ?? 0) + 1);
  let two = false;
  for (const [pid, k] of perPid) {
    if (k > 1) two = true;
    together.set(pid, Math.max(together.get(pid) ?? 0, k));
  }
  if (two) togetherFrames++;
  maxBodies = Math.max(maxBodies, got.length);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    mismatches++;
    if (!firstMismatch) firstMismatch = { t: +t.toFixed(3), got, want };
  }
  // The old law's corpses: a remote alive last frame and not now with no
  // death row between (out of scope), which the page drew dead for 10 s.
  let leaves = 0;
  for (const slot of client.remoteSlots()) {
    const row = st.playerRow(slot);
    const was = aliveBefore.get(slot);
    if (was && row && !row.alive && !deaths.some((d) => d.pid === row.slot - 1 && d.t > was.t - 1e-6)) leaves++;
    aliveBefore.set(slot, row?.alive ? { t } : null);
  }
  scopeLeaves += leaves;
  leaveTimes.push(...Array(leaves).fill(t));
  if (leaves > burst.n) burst = { t: +t.toFixed(3), n: leaves };
}

for (const r of rows) {
  if (!Number.isFinite(r.t)) { st.ingest(r); note(r); continue; }
  if (next == null) next = r.t;
  while (r.t > next) { frame(next); next += STEP; }
  st.ingest(r);
  note(r);
}
frame(next);

// A body's drawn span against its death row and its DestroyObject.
// It ends at the first of the two: a body scoped out is not drawn either.
const destroyAt = new Map();
for (const r of rows) if (r.e === 'destroyObject' && !destroyAt.has(r.netId)) destroyAt.set(r.netId, r.t);
const goneAfter = (nid, t) => rows.find((r) => r.k === 'd' && r.id === nid && r.t >= t)?.t ?? null;
// Drawn from when the server has a pose for it: the death row, or the body's
// first ghost record after it when it was out of scope then.
const posedAfter = (nid, t) => (posedAt(nid, t) ? t
  : rows.find((r) => r.k === 's' && r.t >= t && r.o.some((o) => o[0] === nid))?.t ?? null);
function posedAt(nid, t) {
  let p = false;
  for (const r of rows) {
    if (r.t > t) break;
    if (r.k === 's' && r.o.some((o) => o[0] === nid)) p = true;
    else if (r.k === 'd' && r.id === nid) p = false;
  }
  return p;
}
const spans = deaths.filter((d) => d.pid !== OWN_PID && bodyLife.has(d.nid) && destroyAt.has(d.nid))
  .map((d) => ({ nid: d.nid, pid: d.pid, died: d.t, posed: posedAfter(d.nid, d.t),
                 from: bodyLife.get(d.nid)[0], to: bodyLife.get(d.nid)[1],
                 gone: goneAfter(d.nid, posedAfter(d.nid, d.t) ?? d.t), destroyed: destroyAt.get(d.nid) }));

console.log(JSON.stringify({
  frames, mismatches, firstMismatch, maxBodies, deaths: deaths.length,
  scopeLeaves, burst, burstSecond: leaveTimes.filter((x) => Math.abs(x - burst.t) <= 0.5).length,
  leftBodies: [...leftSeen].sort((a, b) => a - b), spans,
  togetherFrames, together: Object.fromEntries([...together].filter(([, k]) => k > 1)),
}));
