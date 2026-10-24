// The sidecar's live snapshot carries the server's object table, so a page
// that joins mid-round can prewarm every hull model the server has, not only
// the hulls in its ghost scope (features/udp-sidecar/browser.md, "The join").
//
// Replays the owner's second Midway session (`fixtures/sidecar_midway_join.
// ndjson.gz`) through `sidecar/live-snapshot.mjs` up to t 40 s, after the dump
// and before the Enterprise came into scope (49.461 s), then hands the snapshot
// to a fresh `net-sidecar.js` client the way sidecar.mjs does for a page that
// connects, and asks `server-entities.js` what it prewarms.
//
// Run by tests/test_sidecar_live_snapshot.py, which copies the viewer modules
// and live-snapshot.mjs into a temp dir (three shimmed) and passes the fixture.
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createSidecarClient } from './net-sidecar.js';
import { createServerEntities } from './server-entities.js';
import { createLiveState } from './live-snapshot.mjs';

const [fixture] = process.argv.slice(2);
const rows = zlib.gunzipSync(fs.readFileSync(fixture)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const CUT = 40;

function fakeWs() { return { readyState: 1, send() {}, close() {}, addEventListener() {} }; }

/** A page connecting with `snapshot` (sidecar.mjs: the rows, `live`, the state
 *  row), and the hull models its prewarm asks for. */
function join(snapshot) {
  const client = createSidecarClient({ ws: fakeWs(), now: () => 0 });
  for (const line of snapshot) client.handleMessage(line);
  client.handleMessage(JSON.stringify({ k: 'live' }));
  client.handleMessage(JSON.stringify({ k: 'server', state: 'joined', server: '159.196.188.2:14567' }));
  const asked = new Set();
  const entities = createServerEntities({
    scene: new THREE.Group(), model: (tmpl) => { asked.add(tmpl); return new Promise(() => {}); },
    isKit: () => false,
    collider: () => ({ addOwner: () => 1, setMovedOwner() {}, clearMovedOwner() {} }),
    registerDamageable: () => null, unregisterDamageable() {},
  });
  entities.prewarm(client);
  return { asked: [...asked].sort(), ready: client.worldReady(), level: client.serverLevel()?.level ?? null,
           enterpriseKnown: client.vehicles.has(519), enterpriseInScope: client.vehicles.get(519)?.inScope ?? null };
}

const L = createLiveState();
let destroyed = null;
for (const rec of rows) {
  if ((rec.t ?? 0) > CUT) break;
  L.remember(rec);
  if (rec.k === 'e' && rec.e === 'destroyObject' && destroyed == null) destroyed = rec.netId;
}
const snap = L.liveSnapshot();
const created = snap.filter((l) => l.includes('"e":"createObject"'));
const bytes = (lines) => lines.reduce((a, l) => a + l.length + 1, 0);

const withTable = join(snap);
// The snapshot as it was before: no CreateObject rows.
const without = join(snap.filter((l) => !l.includes('"e":"createObject"')));

// A destroyed object leaves the table; a SetLevel clears it.
const destroyedKept = created.some((l) => JSON.parse(l).netId === destroyed);
L.remember({ k: 'e', t: CUT + 1, e: 'createObject', tid: 1, netId: 99999, tmpl: 'Jeep', pos: [0, 0, 0], rot: [0, 0, 0] });
const addedKept = L.liveSnapshot().some((l) => l.includes('"netId":99999'));
L.remember({ k: 'e', t: CUT + 2, e: 'destroyObject', netId: 99999 });
const addedAfterDestroy = L.liveSnapshot().some((l) => l.includes('"netId":99999'));
L.remember({ k: 'e', t: CUT + 3, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'conquest.con' });
const afterLevel = L.liveSnapshot().filter((l) => l.includes('"e":"createObject"')).length;

console.log(JSON.stringify({
  created: created.length, createdBytes: bytes(created), snapshotBytes: bytes(snap),
  withTable, without, destroyed, destroyedKept, addedKept, addedAfterDestroy, afterLevel,
}));
