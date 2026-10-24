// The server's spawn groups, from the wire to the page's answer.
//
// The BFSpawnPointManager is a networkable (sidecar/ghost/spawn-manager.mjs):
// per group its side, whether a human can spawn on it now and its ring. This
// drives the decoder on the owner's own Midway session (sidecar-2026-10-24-
// 11-53-03, netId 513: the 550-bit first send and two deltas), the ghost
// writer's `spawnGroups` row, the live snapshot that hands it to a page joining
// later, and `viewer/server-spawn-groups.js`, which lines the unnamed entries
// up with the level's groups and answers per group id.
//
// Run by tests/test_server_spawn_groups.py: argv[2] is the sidecar directory,
// the viewer module is copied beside this file.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { alignGroups, createServerSpawnGroups, knownGroups } from './server-spawn-groups.js';

const sidecar = process.argv[2];
const load = (rel) => import(pathToFileURL(path.join(sidecar, rel)).href);
const { decodeSpawnManagerBody, looksLikeSpawnManagerBody } = await load('ghost/spawn-manager.mjs');
const { GhostWriter } = await load('ghost-writer.mjs');
const { createLiveState } = await load('live-snapshot.mjs');

// Midway, conquest, BF1942-AUSTRALIA: 25 groups (1..5 and the fleet's 64..83).
const FIRST = { bits: 550, hex: 'ffffff0300800000887379707010000004008000002000000400804ccb946e980100200000883e5439882a0b51635f5434848a815001004000000800000100100000020000' };
// The airfield (ordinal 3, group 4) going to side 2, then the Shokaku's three
// groups (16..18) going down at once.
const AIRFIELD = { bits: 46, hex: '080000e4e020' };
const SHOKAKU_DOWN = { bits: 88 };
// The 88-bit body, built here: mask bits 16, 17, 18, then side 1, off, (0, 0).
function encode(n, rows) {
  const bits = [];
  const put = (v, k) => { for (let i = 0; i < k; i++) bits.push((v >> i) & 1); };
  const set = new Set(rows.map((r) => r[0]));
  for (let i = 0; i < n; i++) bits.push(set.has(i) ? 1 : 0);
  for (const [, team, active, qx, qz] of rows.sort((a, b) => a[0] - b[0])) { put(team, 4); put(active, 1); put(qx, 8); put(qz, 8); }
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 1 << (i & 7); });
  return { bits: bits.length, hex: bytes.toString('hex') };
}
Object.assign(SHOKAKU_DOWN, encode(25, [[16, 1, 0, 0, 0], [17, 1, 0, 0, 0], [18, 1, 0, 0, 0]]));

const out = {};
out.detect = {
  first: looksLikeSpawnManagerBody(FIRST.hex, FIRST.bits),
  delta: looksLikeSpawnManagerBody(AIRFIELD.hex, AIRFIELD.bits),
  score: looksLikeSpawnManagerBody('ff'.repeat(54), 426),
};
const first = decodeSpawnManagerBody(FIRST.hex, FIRST.bits, 25);
out.first = { rows: first.rows.length, consumed: first.consumed, sample: first.rows.filter((r) => [2, 3, 13, 14, 16].includes(r[0])) };
out.airfield = decodeSpawnManagerBody(AIRFIELD.hex, AIRFIELD.bits, 25)?.rows ?? null;
out.wrongLength = decodeSpawnManagerBody(AIRFIELD.hex, AIRFIELD.bits + 1, 25);

// The ghost writer: the whole table on each change, nothing on a repeat, and
// a level's first send written even where it matches the last level's.
const written = [];
const gw = new GhostWriter({ write: (r) => written.push(r), objInfo: new Map() });
const rec = (body) => ({ action: 1, netId: 513, cls: 'SpawnPointManager', body });
gw.block(1, [rec(first)]);
gw.block(2, [rec(first)]);
gw.block(3, [rec(decodeSpawnManagerBody(AIRFIELD.hex, AIRFIELD.bits, 25))]);
gw.note({ k: 'e', e: 'setLevel', level: 'bf1942/levels/midway/' }, 4);
gw.block(5, [rec(first)]);
const rows = written.filter((r) => r.e === 'spawnGroups');
out.writer = { rows: rows.length, ts: rows.map((r) => r.t), airfieldTeam: rows[1]?.g[3]?.[0] ?? null };

// The live snapshot: the newest table only, and none after a level change.
const live = createLiveState();
for (const r of rows.slice(0, 2)) live.remember(r);
const snap = live.liveSnapshot().map((l) => JSON.parse(l)).filter((r) => r.e === 'spawnGroups');
live.remember({ k: 'e', t: 4, e: 'setLevel', level: 'x' });
out.snapshot = { kept: snap.length, newestTeam: snap[0]?.g[3]?.[0] ?? null,
  afterLevel: live.liveSnapshot().filter((l) => l.includes('spawnGroups')).length };

// The page: Midway's level data names 3 and 4 (with points) and 64..83 (the
// fleet's carried points); 1, 2 and 5 are the server's alone.
const W = 4096;
const extras = {
  soldierSpawns: [
    { group: 4, position: [2073, 24, -2110] }, { group: 4, position: [2093, 24, -2174] },
    { group: 3, position: [1837, 28, -1925] },
  ],
  vehicleSoldierSpawns: Array.from({ length: 20 }, (_, i) => ({ group: 64 + i, position: [3000, 25, -2200] })),
  controlPoints: [{ spawnGroupId: 4 }, { spawnGroupId: 3 }],
};
const groups = createServerSpawnGroups({ known: () => knownGroups(extras, W), width: () => W });
out.before = { live: groups.live, active72: groups.active(72) };
groups.apply(rows[0]);
out.page = {
  live: groups.live,
  order: Object.fromEntries([3, 4, 64, 68, 72, 73, 74, 75, 83].map((g) => [g, groups.order.get(g)])),
  active: Object.fromEntries([72, 73, 74, 75, 4].map((g) => [g, groups.active(g)])),
  ring73: groups.ring(73)?.map((v) => Math.round(v)) ?? null,
  ring70: groups.ring(70),
  unknown: groups.active(1),
};
// The Shokaku sunk: her groups go off, and lose their ring.
const sunk = { ...rows[0], g: rows[0].g.map((e) => [...e]) };
for (const [i] of decodeSpawnManagerBody(SHOKAKU_DOWN.hex, SHOKAKU_DOWN.bits, 25).rows) sunk.g[i] = [1, 0, 0, 0];
groups.apply(sunk);
out.sunk = { active75: groups.active(75), ring75: groups.ring(75), active73: groups.active(73) };
// More groups named than the server holds: nothing is read.
out.tooMany = alignGroups(rows[0].g.slice(0, 5), knownGroups(extras, W));
groups.clear();
out.cleared = { live: groups.live, active73: groups.active(73) };

process.stdout.write(JSON.stringify(out));
