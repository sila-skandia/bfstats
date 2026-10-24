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
const text = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8');
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

// The corpse list's contract, without rigs to load.
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

// The independent reading of the rows.
const cam = new Map(), tmpl = new Map(), ctl = new Map(), boarded = new Set();
const dead = new Map();      // body netId -> pid, until its DestroyObject
const scoped = new Set();    // netIds in scope: an `o` since their last `d`
const deaths = [];
const diedAt = new Map();         // body netId -> its death row's time
const seatedDeaths = new Set();   // soldier netIds of men killed in a seat (the page's slump, not compared)
const sampled = new Set();   // netIds with a pose so far: one with none has nowhere to be drawn
function note(r) {
  if (r.k === 's') { for (const o of r.o) sampled.add(o[0]); return; }
  if (r.k === 'o') { scoped.add(r.id); if (r.tmpl) tmpl.set(r.id, r.tmpl); return; }
  if (r.k === 'd') { scoped.delete(r.id); return; }
  if (r.k !== 'e') return;
  switch (r.e) {
    case 'createPlayer': cam.set(r.pid, r.camNetId); ctl.set(r.pid, r.vehNetId); break;
    case 'createObject': tmpl.set(r.netId, r.tmpl); break;
    case 'control': ctl.set(r.pid, r.netId); break;
    case 'enterVehicle': boarded.add(r.pid); break;
    case 'exitVehicle': boarded.delete(r.pid); break;
    case 'destroyObject': dead.delete(r.netId); scoped.delete(r.netId); break;
    case 'score':
      if (r.kind === 4 || r.kind === 5) {
        const n = ctl.get(r.pid);
        if (!boarded.has(r.pid) && n !== cam.get(r.pid) && /Soldier/.test(tmpl.get(n) ?? '')) {
          dead.set(n, r.pid);
          diedAt.set(n, r.t);
          deaths.push({ t: r.t, pid: r.pid, nid: n });
        } else if (boarded.has(r.pid) && /Soldier/.test(tmpl.get(n) ?? '')) seatedDeaths.add(n);
        boarded.delete(r.pid);
      }
      break;
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
function frame(t) {
  soldiers.update(t, STEP, new Map());
  frames++;
  const got = soldiers.debugBodies().filter(b => (diedAt.get(b.id) ?? b.died) > dumpEnd).map(b => b.id)
    .filter(n => !seatedDeaths.has(n) || dead.has(n)).sort((a, b) => a - b);
  const want = [...dead.keys()].filter(n => scoped.has(n) && sampled.has(n) && diedAt.get(n) > dumpEnd)
    .sort((a, b) => a - b);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    mismatches++;
    if (misses.length < +(process.env.MISSES ?? 5)) misses.push({ t: +t.toFixed(2), got, want });
  }
  const perPid = new Map();
  for (const n of got) if (dead.has(n)) perPid.set(dead.get(n), (perPid.get(dead.get(n)) ?? 0) + 1);
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

console.log(JSON.stringify({
  frames, mismatches, misses, deaths: deaths.length, dumpEnd: Number.isFinite(dumpEnd) ? dumpEnd : null, lyingScopeOuts,
  reentered: [...reentered].sort((a, b) => a - b), outFrames,
  togetherFrames, together: Object.fromEntries([...together].filter(([, k]) => k > 1)),
}));
