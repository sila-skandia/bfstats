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
// A whole session can be passed as well, plain or gzipped.
const rows = (fixture.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(fixture)) : fs.readFileSync(fixture)).toString('utf8')
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
  orphanBodies: () => st.orphanBodies(),
};

// The independent reading of the rows.
const cam = new Map(), tmpl = new Map(), ctl = new Map(), boarded = new Map();
const dead = new Map();      // body netId -> pid
const posed = new Set();     // netIds with a ghost pose since their last k:"d"
const scoped = new Set();    // netIds in scope: a k:"o" since their last k:"d"
const seatedBodies = new Map();  // bodies of men killed in a seat -> their hull: drawn in it while in scope
const created = new Set();   // netIds a CreateObject named (a hull; a gunner's seat is never one)
// The hull a seat netId belongs to: itself when the server made it, else the
// made object just below it (a gunner's seat is a nested object on the
// hull's id plus its place).
function hullOf(seat) {
  for (let n = seat; n >= seat - 8; n--) if (created.has(n) && !/Soldier/.test(tmpl.get(n) ?? '')) return n;
  return seat;
}
const deaths = [];
function expectedBodies() {
  return [...dead.keys()].filter((n) => (seatedBodies.has(n) ? scoped.has(n) : posed.has(n))).sort((a, b) => a - b);
}
function note(r) {
  if (r.k === 's') for (const o of r.o) posed.add(o[0]);
  else if (r.k === 'o') scoped.add(r.id);
  else if (r.k === 'd') { posed.delete(r.id); scoped.delete(r.id); }
  else if (r.k !== 'e') return;
  switch (r.e) {
    case 'createPlayer': cam.set(r.pid, r.camNetId); ctl.set(r.pid, r.vehNetId); break;
    case 'createObject':
      // A new object under a netId ends whatever held it: the server made
      // 654 again 4 s after its man died in a Daihatsu that blew up, with
      // no DestroyObject for the body (sidecar-2026-10-24-14-21-07).
      tmpl.set(r.netId, r.tmpl); created.add(r.netId);
      dead.delete(r.netId); seatedBodies.delete(r.netId);
      for (const [n, hull] of [...seatedBodies]) if (hull === r.netId) { dead.delete(n); seatedBodies.delete(n); }
      break;
    case 'control': ctl.set(r.pid, r.netId); break;
    case 'enterVehicle': boarded.set(r.pid, r.netId); break;
    case 'exitVehicle': boarded.delete(r.pid); break;
    case 'destroyObject':
      dead.delete(r.netId); posed.delete(r.netId); scoped.delete(r.netId); seatedBodies.delete(r.netId);
      created.delete(r.netId);
      // A body in a seat goes with its hull: the netId is free again after.
      for (const [n, hull] of [...seatedBodies]) if (hull === r.netId) { dead.delete(n); seatedBodies.delete(n); }
      break;
    case 'score':
      if (r.kind === 4 || r.kind === 5) {
        const n = ctl.get(r.pid);
        // A body is the server's object, not the man's: a second death
        // inside the first body's 10 s leaves both lying. A man killed in a
        // seat leaves his soldier in it, in scope and unposed, until its
        // DestroyObject (at once when the hull went with him).
        if (n !== cam.get(r.pid) && /Soldier/.test(tmpl.get(n) ?? 'Soldier')) {
          dead.set(n, r.pid);
          seatedBodies.delete(n);
          if (boarded.has(r.pid)) seatedBodies.set(n, hullOf(boarded.get(r.pid)));
          deaths.push({ t: r.t, pid: r.pid, nid: n, seated: boarded.has(r.pid) });
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
let seatedFrames = 0;        // frames x bodies drawn in a seat
const seatedDrawn = new Set();
const together = new Map();  // pid -> the most of his bodies drawn in one frame
let togetherFrames = 0;      // frames with some man's two or more bodies drawn
function frame(t) {
  const dt = Math.max(1e-3, t - lastT);
  lastT = t;
  renderer.update(dt, client, t * 1000);
  frames++;
  const drawn = renderer.debugBodies().filter((b) => b.slot !== OWN_PID + 1);
  for (const b of drawn) if (b.seated) { seatedFrames++; seatedDrawn.add(b.id); }
  // A body in a seat is named with an `s`: drawn on the ground, or the
  // other way about, is a mismatch too.
  const got = [...drawn].sort((a, b) => a.id - b.id).map((b) => (b.seated ? `${b.id}s` : b.id));
  for (const b of drawn) {
    if (b.left) leftSeen.add(b.id);
    const life = bodyLife.get(b.id) ?? [t, t];
    life[1] = t;
    bodyLife.set(b.id, life);
  }
  const want = expectedBodies().filter((n) => dead.get(n) !== OWN_PID).map((n) => (seatedBodies.has(n) ? `${n}s` : n));
  const perPid = new Map();
  for (const g of got) { const n = parseInt(g, 10); if (dead.has(n)) perPid.set(dead.get(n), (perPid.get(dead.get(n)) ?? 0) + 1); }
  let two = false;
  for (const [pid, k] of perPid) {
    if (k > 1) two = true;
    together.set(pid, Math.max(together.get(pid) ?? 0, k));
  }
  if (two) togetherFrames++;
  maxBodies = Math.max(maxBodies, got.length);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    mismatches++;
    if (!firstMismatch) firstMismatch = { t: +t.toFixed(3), got, want, drawn };
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
  .map((d) => ({ nid: d.nid, pid: d.pid, died: d.t, seated: d.seated, posed: d.seated ? d.t : posedAfter(d.nid, d.t),
                 from: bodyLife.get(d.nid)[0], to: bodyLife.get(d.nid)[1],
                 gone: goneAfter(d.nid, posedAfter(d.nid, d.t) ?? d.t), destroyed: destroyAt.get(d.nid) }));

console.log(JSON.stringify({
  frames, mismatches, firstMismatch, maxBodies, deaths: deaths.length,
  seatedDeaths: deaths.filter((d) => d.seated).length, seatedFrames, seatedDrawn: [...seatedDrawn].sort((a, b) => a - b),
  scopeLeaves, burst, burstSecond: leaveTimes.filter((x) => Math.abs(x - burst.t) <= 0.5).length,
  leftBodies: [...leftSeen].sort((a, b) => a - b), spans,
  togetherFrames, together: Object.fromEntries([...together].filter(([, k]) => k > 1)),
}));
