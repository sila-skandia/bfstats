// How the page draws remote soldiers and remote turrets against the server,
// measured live: their facing, their aim registers and their turning parts.
//
// Runs the page's own sidecar client (viewer/net-sidecar.js
// createSidecarClient) under node against a probe sidecar's WebSocket, the
// way map.html does: it joins, spawns, sends one zero word per 30 Hz world
// tick, and every 16 ms reads every remote soldier and every hull with
// turning parts as the renderer would. A second client module (OLD=<path to
// another net-sidecar.js>, optional) is fed the same stream and the same
// words, so one run draws both laws against one server. It logs, on the
// page's clock:
//
//   {kind:'draw', p, law, slot, t, x, z, yaw, aim, twist}   a remote soldier
//   {kind:'part', p, law, id, t, parts:[[name, qx,qy,qz,qw]]}  a hull's parts
//   {kind:'s', p, tick, o:[[id, x, z, qx,qy,qz,qw]]}       soldier samples
//   {kind:'st', p, tick, o:[[id, pitch, twist]]}           aim changes
//   {kind:'j', p, tick, o:[[root, nid, qx,qy,qz,qw]]}       part samples
//   {kind:'jn', o:[[root, nid, name]]}, {kind:'o', id, cls, tmpl}
//   {kind:'lead', p, law, lead}                            once a second
//   {kind:'ack', p, tick, seq, sent}, {kind:'clock', p, law, t}  every ack,
//                                        and each law's render time a frame
//
// `t` is the client's render time (server seconds) for that frame. Frames
// are in the page's frame (z negated, the wire's q mapped as ingest maps
// it), samples in the wire's: `remote_draw_check.py` maps them.
//
//   SIDECAR_LAG_MS=120 node sidecar/sidecar.mjs 127.0.0.1:14568 --name drawp \
//       --team 2 --ws 17983 --out /tmp/x/run.ndjson
//   node lab/remote_draw_probe.mjs ws://127.0.0.1:17983 /tmp/x/draw.ndjson 60
//   python3 lab/remote_draw_check.py /tmp/x/draw.ndjson
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSidecarClient } from '../viewer/net-sidecar.js';

const [url = 'ws://127.0.0.1:17983', outPath = 'draw.ndjson', secs = '60'] = process.argv.slice(2);
const out = fs.createWriteStream(outPath);
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ...rec }) + '\n');
const TEAM = Number(process.env.TEAM ?? 2);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const r4 = (v) => +(+v).toFixed(4);

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const laws = [{ law: 'new', client: createSidecarClient({ ws, now }) }];
if (process.env.OLD) {
  const old = await import(pathToFileURL(process.env.OLD).href);
  const fake = { send() {}, close() {}, readyState: 1 };
  laws.push({ law: 'old', client: old.createSidecarClient({ ws: fake, now }) });
}
const client = laws[0].client;
const soldiers = new Set();
ws.onmessage = (ev) => {
  const p = now();
  const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(new Uint8Array(ev.data));
  for (const line of text.split('\n')) {
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const tick = Number.isInteger(rec.tick) ? rec.tick : null;
    if (rec.k === 'o') {
      if (rec.cls === 'BFSoldierNetworkable') soldiers.add(rec.id);
      log('o', { id: rec.id, cls: rec.cls ?? null, tmpl: rec.tmpl ?? '' });
    } else if (rec.k === 's') {
      const o = (rec.o ?? []).filter((r) => soldiers.has(r[0])).map((r) => [r[0], r[1], r[3], r[4], r[5], r[6], r[7]]);
      if (o.length) log('s', { p, tick, o });
    } else if (rec.k === 'st') {
      log('st', { p, tick, o: (rec.o ?? []).map((r) => [r[0], r[3], r[4]]) });
    } else if (rec.k === 'j') {
      log('j', { p, tick, o: rec.o ?? [] });
    } else if (rec.k === 'jn') {
      log('jn', { o: rec.o ?? [] });
    } else if (rec.k === 'ack') {
      // `sent` the newest word made by now: retail's clock at this control
      // state is (tick + sent - seq) ticks (0x00491c90).
      log('ack', { p, tick, seq: rec.seq, sent: client.sentSeq() });
    }
  }
  for (const { client: c } of laws) c.handleMessage(ev.data);
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

const t0 = now();
while (client.state !== 'joined' && now() - t0 < 15000) await delay(100);
if (client.state !== 'joined') { console.log('not joined'); process.exit(1); }
client.join({ name: '', team: TEAM });
const words = setInterval(() => {
  for (const { client: c } of laws) c.sendInput({}, { x: 0, y: 0 });
}, 1000 / 30);

let alive = false;
for (let tries = 0; tries < 12 && !alive; tries++) {
  const group = Number(process.env.GROUP ?? (1 + (tries % 3)));
  client.action({ type: 'spawn', flag: 0, team: TEAM, spawnGroup: group, kitIndex: 0 });
  for (let k = 0; k < 30 && !alive; k++) { await delay(100); alive = client.selfPlayer()?.alive ?? false; }
}
console.log(alive ? 'spawned' : 'not spawned (measuring anyway)');

const end = now() + Number(secs) * 1000;
let leadAt = 0;
const frames = setInterval(() => {
  const p = now();
  // One render clock for both laws (the old module draws by the same one,
  // and may not say it).
  const t = client.renderTime(p);
  if (t == null) return;
  for (const { law, client: c } of laws) {
    // This law's own render time, off any hull's read (`remoteVehicle` says
    // the time it drew for).
    for (const v of c.vehicles.values()) {
      const lt = c.remoteVehicle(v.id, p)?.t;
      if (Number.isFinite(lt)) { log('clock', { p, law, t: r4(lt) }); break; }
    }
    for (const slot of c.remoteSlots()) {
      const s = c.remotePlayer(slot, p);
      if (!s?.alive || s.inVehicle) continue;
      log('draw', { p, law, slot, t: r4(t), x: r4(s.x), z: r4(s.z), yaw: r4(s.yaw), aim: r4(s.aim ?? 0), twist: r4(s.twist ?? 0) });
    }
    for (const v of c.vehicles.values()) {
      if (!v.inScope) continue;
      const pose = c.remoteVehicle(v.id, p);
      if (!pose?.joints?.length) continue;
      log('part', { p, law, id: v.id, t: r4(t), parts: pose.joints.map((j) => [j.name, ...j.q.map(r4)]) });
    }
    if (p - leadAt > 1000) log('lead', { p, law, lead: r4(c.renderLead?.() ?? 0) });
  }
  if (p - leadAt > 1000) leadAt = p;
}, 16);
while (now() < end) await delay(500);
clearInterval(frames); clearInterval(words);
out.end();
try { client.close(); } catch { /* gone */ }
setTimeout(() => process.exit(0), 300);
