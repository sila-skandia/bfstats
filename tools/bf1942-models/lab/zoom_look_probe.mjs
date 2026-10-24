// The zoomed look law, measured on a real server: does the server scale the
// look axes a client sends by the held weapon's `zoomFov` while it is zoomed?
// A sidecar soldier holding a zoomable rifle (Tobruk's British kit 4, the No4,
// zoomFov 0.4) sends the same look words at the hip and zoomed (one AltFire
// tap toggles the zoom, ZOOM-1) and logs the server's control state for every
// ghost block: the aim register (aimA, pitch) and the twist (aimB).
// `zoom_look_check.py` sums each phase's change of both registers.
//
//   node lab/zoom_look_probe.mjs 127.0.0.1:14578 probe.ndjson
//   python3 lab/zoom_look_check.py probe.ndjson
//
// The retail client sends the device's axis as it is; the zoom factor is
// applied inside `BFSoldier::handlePlayerInput` (lnxded 0x08275bf2) on each
// side to its own copy (ledger DEV-10), so a client that scaled the axis
// before sending it would have its zoomed turns scaled twice on the server.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `zoom${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 4);
const SPAWN_GROUP = Number(process.env.SPAWN_GROUP ?? 0);

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
s.on('control-state', (c) => {
  log('cs', { ok: c.ok, tick: c.tick, seq: c.seq, cls: c.cls,
    aimA: c.body?.aimA ?? null, aimB: c.body?.aimB ?? null, bits: c.body?.stateBits ?? null });
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
});
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.on('sent', (e) => { if (!e.idle) log('sent', { serial: e.serial, axes: e.action.axes, buttons: e.action.buttons }); });
sender.start();

for (let tries = 0; !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: SPAWN_GROUP + (tries % 3) });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
log('spawned', { kit: KIT });
await delay(2500);

// [ticks, word, label]. Each look phase is followed by a still one so the
// acked register settles before the next phase starts.
const still = (n) => [n, {}, 'still'];
const plan = [
  still(30),
  [20, { lookY: 0.5 }, 'hip pitch'],
  still(30),
  [20, { lookX: 0.25 }, 'hip twist'],
  still(30),
  [20, { lookX: -0.25 }, 'hip twist back'],
  still(30),
  [1, { altFire: true }, 'zoom tap'],
  still(45),
  [20, { lookY: -0.5 }, 'zoomed pitch'],
  still(30),
  [20, { lookX: 0.25 }, 'zoomed twist'],
  still(30),
  [20, { lookX: 0.02 }, 'zoomed fine twist'],
  still(30),
  [20, { lookX: -0.27 }, 'zoomed twist back'],
  still(30),
  [1, { altFire: true }, 'unzoom tap'],
  still(45),
  [20, { lookY: -0.5 }, 'hip pitch again'],
  still(30),
];
let phase = 0;
const t0 = performance.now();
let n = 0;
for (const [ticks, st, label] of plan) {
  log('phase', { phase, ticks, st, label });
  for (let i = 0; i < ticks; i++) {
    const due = t0 + n * (1000 / 30);
    const w = due - performance.now();
    if (w > 1) await delay(w);
    log('word', { n, phase, serial: sender.serial, st });
    sender.enqueue(actionFor(st));
    n++;
  }
  phase++;
}
await delay(1500);
sender.stop();
log('done', { stats: sender.stats });
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
