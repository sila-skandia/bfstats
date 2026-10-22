// How far behind the server the page draws a remote hull, measured live.
//
// Runs the page's own sidecar client (viewer/net-sidecar.js
// createSidecarClient) under node against a probe sidecar's WebSocket, the
// way map.html does: it joins, spawns, sends one zero word per 30 Hz world
// tick, and every 16 ms reads each in-scope aircraft as the renderer would
// (`remoteVehicle(id, performance.now())`). It logs, on the page's clock:
//
//   {kind:'draw', p, id, x,y,z, lead}    the drawn pose (page frame) and the
//                                        client's render lead, seconds
//   {kind:'s', p, tick, o:[[id,x,y,z]]}  every ghost sample of an aircraft
//                                        (page frame: z negated)
//   {kind:'sent', p, seq}                each page word
//   {kind:'ack', p, seq, tick, iq}       each ack (tick = the block that ran it)
//   {kind:'veh', id, tmpl}               the aircraft found
//
// `remote_lag_check.py` puts the drawn pose against the server's own track:
// the server's present at the frame, and the tick at which a word sent at
// that frame was run (where a round fired then leaves).
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name lagp1 --team 2 --ws 17981 \
//       --out /tmp/x/run.ndjson --review /tmp/x/rev.ndjson
//   node lab/remote_lag_probe.mjs ws://127.0.0.1:17981 /tmp/x/lag.ndjson 60
//   python3 lab/remote_lag_check.py /tmp/x/lag.ndjson
//
// Env: TEAM (default 2), GROUP (spawn group, default cycles 1..3),
// CLOCK=lookback draws by the old render clock (sidecar clock - 100 ms).
import fs from 'node:fs';
import { createSidecarClient } from '../viewer/net-sidecar.js';

const [url = 'ws://127.0.0.1:17981', outPath = 'lag.ndjson', secs = '60'] = process.argv.slice(2);
const out = fs.createWriteStream(outPath);
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ...rec }) + '\n');
const TEAM = Number(process.env.TEAM ?? 2);
const AIR = /aichi|zero|corsair|sbd|hellcat|wildcat|spitfire|bf109|stuka|mustang|yak|il2|b17|ju88|mosquito|bf110|p51|a6m|val\b/i;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const client = createSidecarClient({ ws, now, ...(process.env.CLOCK ? { remoteClock: process.env.CLOCK } : {}) });
const air = new Map();   // id -> template
ws.onmessage = (ev) => {
  const p = now();
  const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(new Uint8Array(ev.data));
  for (const line of text.split('\n')) {
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.k === 's' && air.size) {
      const o = (rec.o ?? []).filter((r) => air.has(r[0])).map((r) => [r[0], r[1], r[2], -r[3]]);
      if (o.length) log('s', { p, tick: rec.tick ?? null, o });
    } else if (rec.k === 'ack') {
      log('ack', { p, seq: rec.seq, tick: rec.tick ?? null, iq: rec.iq ?? null });
    } else if (rec.k === 'e' && rec.e === 'hitMark') {
      log('hit', { p });
    }
  }
  client.handleMessage(ev.data);
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

const t0 = now();
while (client.state !== 'joined' && now() - t0 < 15000) await delay(100);
if (client.state !== 'joined') { console.log('not joined'); process.exit(1); }
client.join({ name: '', team: TEAM });
// One word a world tick, as the page sends them.
const words = setInterval(() => {
  const seq = client.sendInput({}, { x: 0, y: 0 });
  if (seq) log('sent', { p: now(), seq });
}, 1000 / 30);

let alive = false;
for (let tries = 0; tries < 12 && !alive; tries++) {
  const group = Number(process.env.GROUP ?? (1 + (tries % 3)));
  client.action({ type: 'spawn', flag: 0, team: TEAM, spawnGroup: group, kitIndex: 0 });
  for (let k = 0; k < 30 && !alive; k++) { await delay(100); alive = client.selfPlayer()?.alive ?? false; }
}
console.log(alive ? 'spawned' : 'not spawned (measuring anyway)');

const end = now() + Number(secs) * 1000;
const frames = setInterval(() => {
  for (const v of client.vehicles.values()) {
    if (!v.template || !AIR.test(v.template)) continue;
    if (!air.has(v.id)) { air.set(v.id, v.template); log('veh', { id: v.id, tmpl: v.template }); }
    if (!v.inScope) continue;
    const p = now();
    const pose = client.remoteVehicle(v.id, p);
    if (pose) log('draw', { p, id: v.id, x: pose.x, y: pose.y, z: pose.z, lead: client.renderLead?.() ?? 0 });
  }
}, 16);
while (now() < end) await delay(500);
clearInterval(frames); clearInterval(words);
out.end();
try { client.close(); } catch { /* gone */ }
setTimeout(() => process.exit(0), 300);
