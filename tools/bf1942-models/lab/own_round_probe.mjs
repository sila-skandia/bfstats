// Whether a thrower is sent his own round's ghost (ledger NET-15): the page's
// own sidecar client (viewer/net-sidecar.js createSidecarClient), under node,
// against a probe sidecar's WebSocket, spawns with a kit, raises an item with
// its number key and fires it a few times, turning a little between
// throws. The sidecar's own recording then shows, for each throw, whether the
// round from the thrower's own pool comes back as transform rows.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14768 --name ownr --team 2 --ws 17991 \
//       --out run/own.ndjson --review /dev/null
//   node lab/own_round_probe.mjs ws://127.0.0.1:17991 run/probe.ndjson
//
// In own.ndjson the thrower's pool is the `projPool` on his `control` row's
// tick; each throw is that pool's ids in `s` rows away from the origin, then a
// `detonate` row (tests/fixtures/sidecar_own_throw.ndjson.gz is one run).
//
// Env: TEAM (2), KIT (the SpawnRequest kit index, 1: the assault),
// ITEM (4: the grenade on a vanilla assault kit), THROWS (4), HOLD (words
// the fire button is held, 3).
import fs from 'node:fs';
import { createSidecarClient } from '../viewer/net-sidecar.js';

const [url = 'ws://127.0.0.1:17991', outPath = 'own-probe.ndjson'] = process.argv.slice(2);
const out = fs.createWriteStream(outPath);
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, p: performance.now(), ...rec }) + '\n');
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 1);
const ITEM = Number(process.env.ITEM ?? 4);
const THROWS = Number(process.env.THROWS ?? 4);
const HOLD = Number(process.env.HOLD ?? 3);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const client = createSidecarClient({ ws, now: () => performance.now() });
ws.onmessage = (ev) => client.handleMessage(ev.data);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

const t0 = performance.now();
while (client.state !== 'joined' && performance.now() - t0 < 15000) await delay(100);
if (client.state !== 'joined') { console.log('not joined'); process.exit(1); }
client.join({ name: '', team: TEAM });

// One word a world tick, as the page sends them; `next` is the next word.
let next = {}, look = { x: 0, y: 0 };
const words = setInterval(() => { client.sendInput(next, look); next = {}; }, 1000 / 30);
const word = async (input, n = 1) => { for (let i = 0; i < n; i++) { next = input; await delay(1000 / 30); } };

let alive = false;
for (let tries = 0; tries < 12 && !alive; tries++) {
  client.action({ type: 'spawn', flag: 0, team: TEAM, spawnGroup: 1 + (tries % 3), kitIndex: KIT });
  for (let k = 0; k < 30 && !alive; k++) { await delay(100); alive = client.selfPlayer()?.alive ?? false; }
}
log('spawn', { alive });
console.log(alive ? 'spawned' : 'not spawned');
await delay(2500);
await word({ menu: ITEM });
await delay(1500);
for (let i = 0; i < THROWS; i++) {
  log('throw', { i });
  await word({ fire: true }, HOLD);
  await delay(4500);
  look = { x: 0.3, y: 0 }; await delay(200); look = { x: 0, y: 0 };
}
await delay(4000);
clearInterval(words);
log('done');
out.end();
try { client.close(); } catch { /* gone */ }
setTimeout(() => process.exit(0), 300);
