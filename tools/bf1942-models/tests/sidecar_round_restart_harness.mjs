// A round restart with the local player inside the hull the server destroys,
// replayed from the live session that showed it (Wake co-op, 2026-10-24,
// `fixtures/sidecar_wake_round_restart.ndjson.gz`, cut from the sidecar's
// run.ndjson): pid 0 (this page) gunned Sherman 532, switched to its driver's
// seat at t 423.719, and 280 ms later a second human's join restarted the
// round. The server killed everyone (ScoreMsg 4, ExitVehicle flag 1),
// destroyed every hull, made each again under its OLD netId at its spawn
// (532 at 1392.5, 115.83, 737), and sent GameStatus 3 after 1. A bot drove
// 532 off its spawn at t 449; the sidecar of the day wrote no k:"o" for it.
//
// Driven through the page's own seams: `net-sidecar.js` (the client), the
// seat law `server-seat.js` that `net-room.js` follows, and
// `server-entities.js` (the hulls a server-authority page draws). The page's
// seat is modelled as `net-room.js` keeps it: taken from the server's word on
// a snapshot (`adoptServerSeat`, `followServerSeat`), left on the rows
// `seatPlanForRow` names. The driven hull has no entity (`drivenId`).
//
// The ghost writer's half (`sidecar/ghost-writer.mjs`): a hull destroyed and
// made again under its netId writes a fresh k:"o" on its first record.
//
// Run by tests/test_sidecar_round_restart.py, which copies the viewer modules
// into a temp dir (three shimmed) and passes the fixture and the sidecar dir.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createSidecarClient } from './net-sidecar.js';
import { createServerEntities } from './server-entities.js';
import { seatPlanForRow } from './server-seat.js';

const [fixture, sidecarDir] = process.argv.slice(2);
const { GhostWriter } = await import(pathToFileURL(path.join(sidecarDir, 'ghost-writer.mjs')).href);

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function makeEntities(page) {
  let ownerSeq = 100;
  return createServerEntities({
    scene: new THREE.Group(),
    model: () => Promise.resolve(new THREE.Group()),
    isKit: () => false,
    collider: () => ({ addOwner: () => ownerSeq++, setMovedOwner: () => {}, clearMovedOwner: () => {},
                       statics: { disableOwner: () => {} } }),
    registerDamageable: (owner) => ({
      owner, destroyed: false, hitPoints: 100,
      damage(a) { this.hitPoints -= a; if (this.hitPoints <= 0) this.destroyed = true; return a; },
      heal(a) { this.hitPoints = Math.min(100, this.hitPoints + a); },
    }),
    unregisterDamageable: () => {},
    wreckVehicle: () => {},
    // The page drives the root seat only (`vehicle-occupancy.js`).
    drivenId: () => (page.seat && page.seat.index === 0 ? page.seat.hull : null),
    ownId: () => page.seat?.hull ?? null,
  });
}

// ---- the recorded session -------------------------------------------------
const rows = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const out = {};
{
  // The page: alive in a seat or on foot, as net-room.js keeps it.
  const page = { alive: true, seat: null, left: [], died: 0, restarts: 0 };
  const client = createSidecarClient({ ws: { send() {}, close() {} }, now: () => 0 });
  const entities = makeEntities(page);
  const feed = [];
  client.onevent = (row) => {
    feed.push({ t: clock, row });
    const plan = seatPlanForRow(row, { slot: client.slot, occupies: (id) => page.seat?.hull === id });
    if (plan.leave && page.seat) { if (clock > 420) page.left.push({ t: clock, why: row.type, hull: page.seat.hull }); page.seat = null; }
    if (plan.die) { page.alive = false; if (clock > 420) page.died++; }
    if (plan.restart) page.restarts++;
  };
  client.onsnapshot = () => {
    // adoptServerSeat / followServerSeat / leaveSeatServerLeft, by the server's row.
    const self = client.selfPlayer();
    if (!self) return;
    // Alive again: a spawn the server made (`standServerSpawn`).
    if (self.alive && !page.alive) page.alive = true;
    if (self.inVehicle && page.alive) page.seat = { hull: self.vehicleId, index: self.seatIndex ?? 0 };
    else if (!self.inVehicle && page.seat && self.alive) page.seat = null;
  };
  let clock = 0;
  let frameMs = 0;
  const frame = async () => { entities.sync(client, frameMs += 33); await flush(); entities.sync(client, frameMs += 33); };
  const sherman = () => entities.debug().filter((e) => e.template === 'Sherman' && e.id === 532);
  const checks = {};
  const at = async (name, t) => {
    await frame();
    checks[name] = {
      t,
      seat: page.seat ? { ...page.seat } : null,
      alive: page.alive,
      entities532: sherman().map((e) => ({ at: e.at, visible: e.visible, gen: entities.entityFor(532)?.gen ?? null })),
    };
  };
  // The page joined at the session's start: its rows are live from there.
  const first = rows.shift();
  client.handleMessage(JSON.stringify(first));
  client.handleMessage(JSON.stringify({ k: 'live' }));
  client.handleMessage(JSON.stringify({ k: 'me', pid: 0 }));
  const marks = [[423.80, 'driving'], [424.25, 'afterRestart'], [449.10, 'beforeRecord'], [449.40, 'afterRecord']];
  let gen0 = null;
  for (const r of rows) {
    while (marks.length && r.t > marks[0][0]) { const [t, name] = marks.shift(); await at(name, t); }
    clock = r.t;
    client.handleMessage(JSON.stringify(r));
    if (r.k === 'e' && r.e === 'destroyObject' && r.netId === 532 && r.t > 423) gen0 = client.vehicles.get(532)?.gen ?? gen0;
    // A frame every few rows, as a page draws between the sidecar's messages.
    if (r.k === 's') await frame();
    if (gen0 == null && client.vehicles.get(532)) gen0 = client.vehicles.get(532).gen;
  }
  while (marks.length) { const [t, name] = marks.shift(); await at(name, t); }
  const sameRestarts = feed.filter((f) => f.row.type === 'levelChange' && f.row.same).map((f) => f.t);
  out.session = {
    checks,
    left: page.left,
    died: page.died,
    restarts: page.restarts,
    restartRows: sameRestarts,
    // The capture lines a restart's control point rows would print.
    loudCaptures: feed.filter((f) => f.row.type === 'captured' && !f.row.quiet && f.t >= 424 && f.t < 425).length,
    genBefore: gen0,
    genAfter: client.vehicles.get(532)?.gen ?? null,
    inScope532: client.vehicles.get(532)?.inScope ?? null,
  };
}

// ---- one frame: destroyed and made again before the page draws ------------
// A hull wrecked on the server, then destroyed and made again under its
// netId between two of the page's frames (a slow frame across a restart).
{
  const page = { seat: null };
  const client = createSidecarClient({ ws: { send() {}, close() {} }, now: () => 0 });
  const entities = makeEntities(page);
  const send = (r) => client.handleMessage(JSON.stringify(r));
  send({ k: 'h', v: 5, name: 'p' });
  send({ k: 'live' });
  send({ k: 'e', t: 1, e: 'createObject', tid: 2916, netId: 900, tmpl: 'Sherman', pos: [10, 100, 20], rot: [0, 0, 0] });
  send({ k: 'o', t: 1, id: 900, tid: 2916, tmpl: 'Sherman', team: 0, cls: 'SimpleObjectNetworkable' });
  send({ k: 's', t: 1.05, tick: 30, o: [[900, 10, 100, 20, 0, 0, 0, 1]] });
  entities.sync(client, 0); await flush(); entities.sync(client, 33);
  entities.hull(900, 0, true);
  const before = entities.entityFor(900);
  const wrecked = !!before?.damageable?.destroyed;
  send({ k: 'e', t: 2, e: 'destroyObject', netId: 900 });
  send({ k: 'e', t: 2.08, e: 'createObject', tid: 2916, netId: 900, tmpl: 'Sherman', pos: [50, 100, 60], rot: [0, 0, 0] });
  send({ k: 's', t: 2.1, tick: 63, o: [[900, 50, 100, 60, 0, 0, 0, 1]] });
  entities.sync(client, 66); await flush(); entities.sync(client, 99);
  const after = entities.entityFor(900);
  out.oneFrame = {
    wreckedBefore: wrecked,
    sameEntity: after === before,
    count: entities.debug().filter((e) => e.id === 900).length,
    at: after ? [after.group.position.x, after.group.position.y, after.group.position.z].map((v) => +v.toFixed(2)) : null,
    destroyedAfter: !!after?.damageable?.destroyed,
  };
}

// ---- a hull destroyed under him with no death row -------------------------
// The server removes a hull outright (a wreck's time to live, HP-19; the end
// of a round, HP-20) and says nothing of the man in it first.
{
  const page = { seat: { hull: 900, index: 0 }, alive: true };
  const client = createSidecarClient({ ws: { send() {}, close() {} }, now: () => 0 });
  const send = (r) => client.handleMessage(JSON.stringify(r));
  const plans = [];
  client.onevent = (row) => {
    const plan = seatPlanForRow(row, { slot: client.slot, occupies: (id) => page.seat?.hull === id });
    if (plan.leave || plan.die || plan.restart) plans.push({ type: row.type, ...plan });
    if (plan.leave) page.seat = null;
    if (plan.die) page.alive = false;
  };
  send({ k: 'h', v: 5, name: 'p' });
  send({ k: 'live' });
  send({ k: 'e', t: 1, e: 'createPlayer', pid: 0, name: 'p', team: 2, ai: 0, netId: 1, vehNetId: 2, camNetId: 2, kitNetId: 0 });
  send({ k: 'me', pid: 0 });
  send({ k: 'e', t: 1, e: 'createObject', tid: 2916, netId: 900, tmpl: 'Sherman', pos: [10, 100, 20], rot: [0, 0, 0] });
  send({ k: 'e', t: 2, e: 'enterVehicle', pid: 0, netId: 900 });
  // Another hull going is not his.
  send({ k: 'e', t: 3, e: 'destroyObject', netId: 901 });
  const stillIn = page.seat?.hull ?? null;
  send({ k: 'e', t: 4, e: 'destroyObject', netId: 900 });
  out.goneUnderHim = { stillIn, seat: page.seat, alive: page.alive, plans,
                       serverSeat: client.selfPlayer()?.inVehicle ?? null };
}

// ---- the sidecar's ghost writer -------------------------------------------
{
  const written = [];
  const objInfo = new Map([[532, { tid: 2916, tmpl: 'Sherman', team: 0 }]]);
  const gw = new GhostWriter({ write: (r) => written.push(r), objInfo });
  const rec = (action) => ({ action, netId: 532, cls: 'SimpleObjectNetworkable', pos: [1392.5, 116.7, 737], rot: [0, 0, 0, 1] });
  gw.block(423.9, [rec(1)], 12690);
  gw.note({ e: 'destroyObject', netId: 532 }, 423.998);
  gw.note({ e: 'createObject', netId: 532, tid: 2916 }, 424.083);
  gw.block(449.127, [rec(1)], 154);
  out.ghostWriter = written.filter((r) => r.k === 'o' && r.id === 532).map((r) => r.t);
}

console.log(JSON.stringify(out));
