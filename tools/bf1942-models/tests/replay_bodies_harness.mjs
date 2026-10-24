// Dead soldiers' bodies in the replay viewer, against the server's own rows.
//
// The server keeps a dead man's soldier object until its DestroyObject
// (`timeToLiveAfterDeath`, 10 s, DIE-9), and a body can leave this client's
// scope (a `d` row: ghost action 3, or the object disabled in a bf42plus
// client's registry) and come back (`o`) while it lies. A respawn is a new
// soldier object, so a man killed again inside 10 s has two bodies lying.
// `replay-bodies.js` drew a corpse for the renderer's own clock wherever the
// body went: a body scoped out stayed drawn (7 such scope-outs in
// sidecar-2026-10-24-11-53-03).
//
// The sidecar sessions' fixtures (the same as sidecar_bodies_harness.mjs)
// are parsed by `replay-recording.js` and played through `ReplaySoldiers`
// every 100 ms. The bodies renderer is a stand-in that keeps the corpse
// list's contract (`bot-visuals.js`: `killBot` leaves a body on a clock of
// `opts.ttl` or 10 s, `corpseOf`, `disposeCorpse`, a disposed body leaves the
// root), so what is counted is which bodies the replay keeps drawn, by netId.
// The expected set is read from the raw rows on their own: a soldier netId a
// death row named, from its `o` to its `d` and never past its DestroyObject.
//
// Run by tests/test_replay_bodies.py with the fixture path; one JSON line out.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, { ReplaySoldiers }, { createBotVisuals }, { bag }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-bodies.js'),
  imp('bot-visuals.js'), imp('page-bag.js'),
]);

const [fixture] = process.argv.slice(2);
// A whole recording can be passed as well, plain or gzipped.
const text = (fixture.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(fixture)) : fs.readFileSync(fixture)).toString('utf8');
const rows = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
const rec = recording.parseRecording(text);
// The join's world dump replays the round so far in a burst before simStart,
// its deaths, spawns and kills a few milliseconds apart and not at their own
// times: the bodies of deaths in it are not compared (the sidecar harness
// leaves them out of its spans for the same reason).
const dumpEnd = rows.find(r => r.e === 'simStart')?.t ?? -Infinity;
// The replay plays a file's first round (`rec.roundEnded`, the first round
// end): a client file that ran on into the next rounds is compared up to it.
const roundEnd = rec.roundEnded;
// What kind of file: the sidecar's ghost scope covers a seat's child, a
// bf42plus client's registry and a server recorder's world do not.
const plus = String(rows.find(r => r.k === 'h')?.plus ?? '');
const kind = plus === 'sidecar' ? 'sidecar' : /^server-replay-recorder/.test(plus) ? 'server' : 'client';

// The corpse list's contract, without rigs to load.
let laid = 0;   // bodies laid already down (`layCorpse`), not by a death watched
function standInBodies(shim) {
  const root = new THREE.Group();
  const botVisuals = new Map();
  const corpses = [];
  const visualFor = id => {
    let vis = botVisuals.get(id);
    if (!vis) {
      vis = { group: new THREE.Group() };
      root.add(vis.group);
      botVisuals.set(id, vis);
    }
    return vis;
  };
  const dispose = c => { root.remove(c.scene); };
  return {
    botVisuals,
    ensureRoot() {},
    ensureBotVisual: actor => visualFor(actor.playerId),
    layCorpse(spec = {}) {
      const scene = new THREE.Group();
      root.add(scene);
      corpses.push({ name: spec.name, scene, ttl: spec.ttl ?? Infinity, laid: true, seated: !!spec.seat });
      laid++;
      return scene;
    },
    killBot(actor, opts = {}) {
      const vis = visualFor(actor.playerId);
      botVisuals.delete(actor.playerId);
      vis.group.visible = true;
      corpses.push({ name: actor.playerId, scene: vis.group, ttl: opts.ttl ?? 10 });
      visualFor(actor.playerId);
      return opts.family ?? 'stand';
    },
    corpseOf(id) {
      for (let i = corpses.length - 1; i >= 0; i--) if (corpses[i].name === id) return corpses[i].scene;
      return null;
    },
    disposeCorpse(scene) {
      const i = corpses.findIndex(c => c.scene === scene);
      if (i >= 0) { dispose(corpses[i]); corpses.splice(i, 1); }
    },
    disposeCorpses() { for (const c of corpses) dispose(c); corpses.length = 0; },
    disposeBotVisual(id) { const vis = botVisuals.get(id); if (vis) root.remove(vis.group); botVisuals.delete(id); },
    disposeBotVisuals() { for (const id of [...botVisuals.keys()]) this.disposeBotVisual(id); this.disposeCorpses(); },
    captureBotPresentationTick() {},
    updateBotVisuals(dt) {
      // A drawn man's body is shown unless he lies dead (`armorOf`), as the
      // renderer shows it.
      for (const bot of shim.bots) {
        const vis = botVisuals.get(bot.playerId);
        if (vis) vis.group.visible = !shim.world.armorOf(bot.playerId)?.destroyed;
      }
      for (let i = corpses.length - 1; i >= 0; i--) {
        corpses[i].ttl -= dt;
        if (corpses[i].ttl <= 0) { dispose(corpses[i]); corpses.splice(i, 1); }
      }
    },
  };
}

const player = {
  rec, playing: true, guard: null, root: new THREE.Group(), viewmodel: null,
  ctx: {
    scene: new THREE.Scene(), bust: () => '', modelsBase: 'models', loadouts: () => null,
    waterLevel: () => NaN, makeReplayBodies: shim => standInBodies(shim),
  },
};
const soldiers = new ReplaySoldiers(player);
// The replayed hulls, as far as a seat's body needs them: every life that is
// a hull has seats to sit in.
const hulls = {
  get(life) {
    if (!life || life.soldier || life.kit || life.camera || life.projectile || life.controlPoint) return undefined;
    return { seatIdAt: i => `seat ${i}`, occupancy: { rootId: life.nid, seatInfo: id => ({ id }) } };
  },
};

// The independent reading of the rows.
const cam = new Map(), tmpl = new Map(), ctl = new Map(), boarded = new Map();
const dead = new Map();      // body netId -> pid, until its DestroyObject
const scoped = new Set();    // netIds in scope: an `o` since their last `d`
const deaths = [];
const diedAt = new Map();         // body netId -> its death row's time
// Bodies of men killed in a seat -> { hull, end }: each stays in the seat,
// the seat's child (DIE-11), drawn while the server's object is in scope
// (the sidecar's ghost scope has the soldier; a client's or a server file's
// has only the hull), to its DestroyObject and never past the hull's. A
// server file has no destroys: the corpse clock, none if the hull went.
const seatedBodies = new Map();
const created = new Set();   // netIds of objects made (CreateObject, or first seen in a server file)
const pNid = new Map();      // a server file's controlled object per pid (`p` rows)
// A server file's hull hit points, whole file, to tell a hull that blew up
// with its crew.
const hullHp = new Map();
if (kind === 'server') for (const r of rows) if (r.k === 'a') for (const [n, hp] of r.a) {
  if (!hullHp.has(n)) hullHp.set(n, []);
  hullHp.get(n).push([r.t, hp]);
}
const hpAt = (n, t) => { let hp = null; for (const [at, v] of hullHp.get(n) ?? []) { if (at > t) break; hp = v; } return hp; };
const isHull = n => created.has(n) && !/Soldier|Camera/i.test(tmpl.get(n) ?? '');
function hullOf(seat) {
  for (let n = seat; n >= seat - 8; n--) if (isHull(n)) return n;
  return seat;
}
const sampled = new Set();   // netIds with a pose so far: one with none has nowhere to be drawn
const endBody = n => { dead.delete(n); seatedBodies.delete(n); };
function seatedShown(n, t) {
  const b = seatedBodies.get(n);
  if (t >= b.end) return false;
  return kind === 'sidecar' ? scoped.has(n) : scoped.has(b.hull);
}
function note(r) {
  if (r.k === 's') { for (const o of r.o) sampled.add(o[0]); return; }
  if (r.k === 'o') {
    scoped.add(r.id); if (r.tmpl) tmpl.set(r.id, r.tmpl);
    if (kind !== 'sidecar') created.add(r.id);
    return;
  }
  if (r.k === 'd') {
    scoped.delete(r.id);
    // A server file's `d` is the object gone from the world: a hull's
    // takes its seats' bodies with it.
    if (kind === 'server') for (const [n, b] of [...seatedBodies]) if (b.hull === r.id) endBody(n);
    return;
  }
  if (r.k === 'p') { for (const e of r.p) if (Array.isArray(e)) pNid.set(e[0], e[2]); return; }
  if (r.k !== 'e') return;
  switch (r.e) {
    case 'createPlayer': cam.set(r.pid, r.camNetId); ctl.set(r.pid, r.vehNetId); break;
    case 'createObject':
      // A new object under a netId ends whatever held it (654 in
      // sidecar-2026-10-24-14-21-07, made again with no destroy of its body).
      tmpl.set(r.netId, r.tmpl); created.add(r.netId); endBody(r.netId);
      for (const [n, b] of [...seatedBodies]) if (b.hull === r.netId) endBody(n);
      break;
    case 'control': ctl.set(r.pid, r.netId); break;
    case 'enterVehicle': boarded.set(r.pid, r.netId); break;
    case 'exitVehicle': if (!r.flag) boarded.delete(r.pid); break;
    case 'destroyObject':
      endBody(r.netId); scoped.delete(r.netId); created.delete(r.netId);
      for (const [n, b] of [...seatedBodies]) if (b.hull === r.netId) endBody(n);
      break;
    case 'score':
      if (r.kind === 4 || r.kind === 5) {
        const n = ctl.get(r.pid);
        // Seated: boarded (a sidecar's or a client's enterVehicle), or a
        // server file's controlled object a hull.
        const seat = boarded.has(r.pid) ? boarded.get(r.pid)
          : kind === 'server' && isHull(hullOf(pNid.get(r.pid) ?? -1)) && pNid.get(r.pid) !== n ? pNid.get(r.pid) : null;
        if (n !== cam.get(r.pid) && /Soldier/.test(tmpl.get(n) ?? '')) {
          dead.set(n, r.pid);
          diedAt.set(n, r.t);
          seatedBodies.delete(n);
          if (seat !== null) {
            const hull = hullOf(seat);
            let end = Infinity;
            if (kind === 'server') {
              const hp = hpAt(hull, r.t + 0.5);
              end = hullHp.has(hull) && !(hp > 0) ? r.t : r.t + 10;
            }
            seatedBodies.set(n, { hull, end });
          }
          deaths.push({ t: r.t, pid: r.pid, nid: n, seated: seat !== null, scopedAtDeath: scoped.has(n) });
        }
        boarded.delete(r.pid);
      }
      break;
  }
}

// Bodies of men this client never saw alive (no sample of the soldier before
// his death row, so the playback had nowhere to play his death) whose body
// first comes into scope after he is back: the replay laid none, the live
// page drew them. Read from the rows ahead of the play, the join's dump
// included (13-07-56: 10848 and 10873 died at 27.006 in the dump, their men
// were back by 31.82 and the bodies came into scope at 31.97).
const unseen = new Map();   // body netId -> { wanted, drawn } frames
{
  const tm = new Map(), c = new Map(), seen = new Set(), board = new Set(), died = [];
  for (const r of rows) {
    if (r.k === 's') { for (const o of r.o) seen.add(o[0]); continue; }
    if (r.k === 'o' && r.tmpl) { tm.set(r.id, r.tmpl); continue; }
    if (r.k !== 'e') continue;
    if (r.e === 'createObject') tm.set(r.netId, r.tmpl ?? '');
    else if (r.e === 'createPlayer') c.set(r.pid, r.vehNetId);
    else if (r.e === 'control') c.set(r.pid, r.netId);
    else if (r.e === 'enterVehicle') board.add(r.pid);
    else if (r.e === 'exitVehicle' && !r.flag) board.delete(r.pid);
    else if (r.e === 'score' && (r.kind === 4 || r.kind === 5)) {
      const n = c.get(r.pid);
      if (/Soldier/.test(tm.get(n) ?? '') && !seen.has(n) && !board.has(r.pid)) died.push({ t: r.t, pid: r.pid, n });
      board.delete(r.pid);
    }
  }
  for (const d of died) {
    const back = rows.find(r => r.e === 'control' && r.pid === d.pid && r.t > d.t && r.netId !== d.n && /Soldier/.test(tm.get(r.netId) ?? ''))?.t;
    const first = rows.find(r => r.k === 's' && r.t > d.t && r.o.some(o => o[0] === d.n))?.t;
    if (back !== undefined && first !== undefined && first > back) unseen.set(d.n, { wanted: 0, drawn: 0 });
  }
}

const STEP = 0.1;
const firstT = rows.find(r => Number.isFinite(r.t))?.t ?? 0;
let next = Math.ceil(firstT / STEP) * STEP;
let frames = 0, mismatches = 0;
const misses = [];
const together = new Map();
let togetherFrames = 0;
const reentered = new Set();   // bodies out of scope while lying that came back into it
const wasOut = new Set();      // bodies lying out of scope at the last frame
let outFrames = 0;             // frames x bodies lying out of scope: the old law drew every one
const wantAt = [];             // [t, want] per frame, for the seeks
let seatedFrames = 0;          // frames x bodies drawn in a seat
const seatedDrawn = new Set();
const firstDrawn = new Map();  // body netId -> the first frame it is wanted
// A body in a seat is named with an `s`: drawn on the ground, or the other
// way about, is a mismatch too.
const gotOf = (list) => list.filter(b => (diedAt.get(b.id) ?? b.died) > dumpEnd)
  .sort((a, b) => a.id - b.id).map(b => (b.seated ? `${b.id}s` : b.id));
function wantNow(t) {
  return [...dead.keys()].filter(n => diedAt.get(n) > dumpEnd
    && (seatedBodies.has(n) ? seatedShown(n, t) : scoped.has(n) && sampled.has(n)))
    .sort((a, b) => a - b).map(n => (seatedBodies.has(n) ? `${n}s` : n));
}
function frame(t) {
  soldiers.update(t, STEP, hulls);
  frames++;
  const drawn = soldiers.debugBodies();
  const got = gotOf(drawn);
  for (const b of drawn) if (b.seated && (diedAt.get(b.id) ?? b.died) > dumpEnd) { seatedFrames++; seatedDrawn.add(b.id); }
  const want = wantNow(t);
  wantAt.push([t, want]);
  if (unseen.size) {
    const ids = new Set(drawn.map(b => b.id));
    for (const [n, u] of unseen) {
      if (!dead.has(n) || !scoped.has(n) || !sampled.has(n)) continue;
      u.wanted++;
      if (ids.has(n)) u.drawn++;
    }
  }
  for (const n of want) if (!firstDrawn.has(parseInt(n, 10))) firstDrawn.set(parseInt(n, 10), t);
  if (process.env.TRACE_T && Math.abs(t - +process.env.TRACE_T) < 0.05) console.error(JSON.stringify({ t, got, want }));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    mismatches++;
    if (misses.length < +(process.env.MISSES ?? 5)) misses.push({ t: +t.toFixed(2), got, want });
  }
  const perPid = new Map();
  for (const g of got) { const n = parseInt(g, 10); if (dead.has(n)) perPid.set(dead.get(n), (perPid.get(dead.get(n)) ?? 0) + 1); }
  let two = false;
  for (const [pid, k] of perPid) { if (k > 1) two = true; together.set(pid, Math.max(together.get(pid) ?? 0, k)); }
  if (two) togetherFrames++;
  for (const n of dead.keys()) {
    if (!(diedAt.get(n) > dumpEnd)) continue;
    if (scoped.has(n)) {
      if (wasOut.has(n)) reentered.add(n);
      wasOut.delete(n);
    } else {
      wasOut.add(n);
      outFrames++;
    }
  }
}

for (const r of rows) {
  if (Number.isFinite(r.t)) while (r.t > next && next < roundEnd) { frame(next); next += STEP; }
  note(r);
}
if (next < roundEnd) frame(next);

// Scope-outs of a lying body: a `d` for a dead soldier before its destroy.
let lyingScopeOuts = 0;
{
  const destroyAt = new Map();
  for (const r of rows) if (r.e === 'destroyObject' && !destroyAt.has(r.netId)) destroyAt.set(r.netId, r.t);
  for (const d of deaths) {
    const end = destroyAt.get(d.nid) ?? Infinity;
    lyingScopeOuts += rows.filter(r => r.k === 'd' && r.id === d.nid && r.t >= d.t && r.t < end - 1e-3).length;
  }
}

// Bodies that first come into scope after their man is back: killed out of
// this client's scope, and his next soldier made (a control row to a
// soldier) before the body is first wanted.
const lateArrivals = [];
for (const d of deaths) {
  const first = firstDrawn.get(d.nid);
  if (first === undefined || d.seated || d.scopedAtDeath) continue;
  const back = rows.find(r => r.e === 'control' && r.pid === d.pid && r.t > d.t && r.netId !== d.nid
    && /Soldier/.test(tmpl.get(r.netId) ?? ''))?.t;
  if (back !== undefined && back < first) lateArrivals.push(d.nid);
}

// Seeks: a fresh replay instance jumps (`reset`) to frames in a fixed
// pseudo-random order, back and forth, paused and playing, and plays three
// frames on from each: every body that lies there must be drawn at once.
const seekSoldiers = new ReplaySoldiers({ ...player, ctx: { ...player.ctx, makeReplayBodies: shim => standInBodies(shim) } });
let seeks = 0, seekFrames = 0, seekMismatches = 0, seekLying = 0;
const seekMisses = [];
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const nSeeks = Math.min(+(process.env.SEEKS ?? 120), wantAt.length);
for (let i = 0; i < nSeeks; i++) {
  const k = Math.floor(rand() * Math.max(1, wantAt.length - 3));
  seekSoldiers.player.playing = i % 2 === 0;
  seekSoldiers.reset();
  seeks++;
  for (let j = 0; j < 3 && k + j < wantAt.length; j++) {
    const [t, want] = wantAt[k + j];
    seekSoldiers.update(t, j === 0 ? 0 : STEP, hulls);
    seekFrames++;
    if (j === 0) seekLying += want.length;
    const got = gotOf(seekSoldiers.debugBodies());
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      seekMismatches++;
      if (seekMisses.length < 5) seekMisses.push({ t: +t.toFixed(2), after: j, got, want });
    }
  }
}

console.log(JSON.stringify({
  frames, mismatches, misses, deaths: deaths.length, kind,
  seatedDeaths: deaths.filter(d => d.seated).length, seatedFrames, seatedDrawn: [...seatedDrawn].sort((a, b) => a - b),
  lateArrivals, laid, unseen: Object.fromEntries([...unseen].filter(([, u]) => u.wanted > 0)),
  seeks, seekFrames, seekMismatches, seekMisses, seekLying, dumpEnd: Number.isFinite(dumpEnd) ? dumpEnd : null, lyingScopeOuts,
  reentered: [...reentered].sort((a, b) => a - b), outFrames,
  togetherFrames, together: Object.fromEntries([...together].filter(([, k]) => k > 1)),
}));
