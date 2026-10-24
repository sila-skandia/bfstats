// The page's join against a real server, replayed from the owner's second
// session on BF1942-AUSTRALIA (Midway co-op, 63 bots, 2026-10-24,
// `fixtures/sidecar_midway_join.ndjson.gz`, cut from
// sidecar-2026-10-24-11-53-03.ndjson to t 51 s: the h/anim/e/o/d/s rows).
//
// The page connected to the sidecar before the sidecar joined, so every row is
// live. The sidecar's own rows that a recording does not keep are put back
// where sidecar.mjs sends them: `server` connecting at the start, `server`
// joined and `me` at the Simulation event (`simStart`).
//
// Checked through the page's own seams: `net-sidecar.js` (the client:
// `serverLevel`, `worldReady`, `serverAddress`) and `server-entities.js`
// (`prewarm`, `pendingNear`), the two halves of the join law in
// features/udp-sidecar/browser.md, "The join".
//
// Run by tests/test_sidecar_join.py, which copies the viewer modules into a
// temp dir (three shimmed) and passes the fixture.
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createSidecarClient } from './net-sidecar.js';
import { createServerEntities } from './server-entities.js';

const [fixture] = process.argv.slice(2);
const rows = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fakeWs() { return { readyState: 1, send() {}, close() {}, addEventListener() {} }; }

// ---- 1. A first join: connect, the level, the dump --------------------------
async function firstJoin() {
  const client = createSidecarClient({ ws: fakeWs(), now: () => 0 });
  const feed = (rec) => client.handleMessage(JSON.stringify(rec));
  const out = { levelAt: null, readyAt: null, dbCompleteAt: null, simStartAt: null, firstObjectAt: null,
                lastCreatePlayerAt: null, levelBefore: null, readyBefore: null, address: null, level: null,
                modelsAskedAt: {}, enterpriseScopeAt: null, pendingAtSpawn: null, pendingAfterLoad: null,
                pendingNoEntityAtSpawn: null };
  // Models resolve only when the harness says so: the Enterprise's glb is the
  // one a carrier spawn waits on.
  const resolvers = new Map();
  const models = new Map();
  const model = (tmpl) => {
    if (!models.has(tmpl)) {
      out.modelsAskedAt[tmpl] = clientT;
      models.set(tmpl, new Promise((resolve) => resolvers.set(tmpl, resolve)));
    }
    return models.get(tmpl);
  };
  let owner = 10;
  const entities = createServerEntities({
    scene: new THREE.Group(), model, isKit: () => false,
    collider: () => ({ addOwner: () => owner++, setMovedOwner() {}, clearMovedOwner() {} }),
    registerDamageable: () => null, unregisterDamageable() {},
  });
  let clientT = 0;
  let levelKnown = false;
  feed(rows[0]);                                   // the header
  feed({ k: 'live' });
  feed({ k: 'server', state: 'connecting', server: '159.196.188.2:14567' });
  out.address = client.serverAddress();
  out.levelBefore = client.serverLevel();
  out.readyBefore = client.worldReady();
  let spawnChecked = false;
  for (const rec of rows.slice(1)) {
    clientT = rec.t ?? clientT;
    feed(rec);
    if (rec.k === 'e' && rec.e === 'simStart') {
      out.simStartAt = rec.t;
      // sidecar.mjs `s.on('joined')`: the state row, then the player's id.
      feed({ k: 'server', state: 'joined', server: '159.196.188.2:14567' });
      feed({ k: 'me', pid: 0 });
    }
    if (rec.k === 'e' && rec.e === 'dbComplete') out.dbCompleteAt = rec.t;
    if (rec.k === 'e' && rec.e === 'createObject' && out.firstObjectAt == null) out.firstObjectAt = rec.t;
    if (rec.k === 'e' && rec.e === 'createPlayer') out.lastCreatePlayerAt = rec.t;
    if (!levelKnown && client.serverLevel()) { levelKnown = true; out.levelAt = rec.t; out.level = client.serverLevel(); }
    if (out.readyAt == null && client.worldReady()) out.readyAt = rec.t;
    // The page prewarms on every message once the level's report is in; the
    // harness does it on every row.
    if (levelKnown) entities.prewarm(client);
    if (rec.k === 'o' && rec.id === 519) out.enterpriseScopeAt = rec.t;
    // The owner's spawn: his soldier's first record (9871, t 49.491), on the
    // Enterprise's deck. The carrier came into scope 30 ms earlier.
    if (!spawnChecked && rec.k === 'o' && rec.id === 9871) {
      spawnChecked = true;
      // A parked ship sends no transform: its CreateObject pose stands.
      const sp = client.vehicles.get(519)?.spawnPos;
      const deck = client.remoteVehicle(519) ?? (sp ? { x: sp[0], y: sp[1], z: sp[2] } : null);
      out.enterpriseKnown = client.vehicles.has(519);
      out.enterpriseInScope = client.vehicles.get(519)?.inScope ?? null;
      // Before the frame that would stand its entity: no entity at all.
      out.pendingNoEntityAtSpawn = entities.pendingNear(client, deck.x, deck.y + 13, deck.z);
      entities.sync(client, 0);
      out.pendingAtSpawn = entities.pendingNear(client, deck.x, deck.y + 13, deck.z);
      out.deck = [deck.x, deck.y, deck.z].map((v) => +v.toFixed(1));
      // Its glb lands (the prewarm asked for it during the dump).
      resolvers.get('Enterprise')?.(new THREE.Mesh(new THREE.BoxGeometry(280, 30, 40)));
      await flush();
      entities.sync(client, 16);
      out.pendingAfterLoad = entities.pendingNear(client, deck.x, deck.y + 13, deck.z);
      out.far = entities.pendingNear(client, deck.x + 2000, deck.y, deck.z + 2000);
    }
  }
  return out;
}

// ---- 2. A page that connects to a sidecar already on the server -------------
function midRound() {
  const client = createSidecarClient({ ws: fakeWs(), now: () => 0 });
  const feed = (rec) => client.handleMessage(JSON.stringify(rec));
  // sidecar.mjs's connection handler: the live snapshot, `live`, the state.
  feed(rows[0]);
  feed({ k: 'e', t: 0.3, e: 'serverInfo', mod: 'bf1942' });
  feed({ k: 'e', t: 0.3, e: 'setLevel', level: 'bf1942/levels/midway/', mode: 'coop.con' });
  const beforeState = client.worldReady();
  feed({ k: 'live' });
  feed({ k: 'server', state: 'joined', server: '159.196.188.2:14567' });
  return { level: client.serverLevel()?.level ?? null, beforeState, ready: client.worldReady() };
}

// ---- 3. A level change: the server restarts and the sidecar rejoins ---------
function levelChange() {
  const client = createSidecarClient({ ws: fakeWs(), now: () => 0 });
  const events = [];
  client.onevent = (row) => events.push(row);
  const feed = (rec) => client.handleMessage(JSON.stringify(rec));
  feed(rows[0]);
  feed({ k: 'e', t: 0.3, e: 'serverInfo', mod: 'bf1942' });
  feed({ k: 'e', t: 0.3, e: 'setLevel', level: 'bf1942/levels/midway/', mode: 'coop.con' });
  feed({ k: 'live' });
  feed({ k: 'server', state: 'joined', server: 'x:1' });
  const steps = [client.worldReady()];
  feed({ k: 'server', state: 'rejoining', server: 'x:1' });
  steps.push(client.worldReady());
  feed({ k: 'e', t: 400, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'conquest.con' });
  steps.push(client.worldReady());
  feed({ k: 'e', t: 420, e: 'dbComplete' });
  steps.push(client.worldReady());
  feed({ k: 'server', state: 'joined', server: 'x:1' });
  steps.push(client.worldReady());
  const change = events.find((r) => r.type === 'levelChange') ?? null;
  // A same-map restart in place (GameStatus 1 then 3) is not a load.
  feed({ k: 'e', t: 500, e: 'gameStatus', status: 1 });
  feed({ k: 'e', t: 504, e: 'gameStatus', status: 3 });
  const restart = events.filter((r) => r.type === 'levelChange').at(-1);
  return { steps, change, level: client.serverLevel()?.level, restart, readyAfterRestart: client.worldReady() };
}

console.log(JSON.stringify({ first: await firstJoin(), midRound: midRound(), levelChange: levelChange() }));
