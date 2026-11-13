// What a room's bots cost the server, per 30 Hz tick, headless: one room on a
// real level with one human standing at a flag and N bots, run for a while.
//
//   node tests/room_bots_cost.mjs <viewerDir> <level> <bots> [seconds] [mod]
//
// prints one JSON line (times are the process's CPU time, ms): the room's whole tick (`world.step`, the referee, the
// authority, the snapshot at 20 Hz to the one human) in ms, mean and p95 and
// max, the referee's share, and what the bots did (kills, captures), so a
// cheap tick that is cheap because nobody moves shows.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const netcode = await import(at(viewer, 'netcode.js'));
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { loadRealLevel } = await import(at(HERE, '..', 'server', 'level.mjs'));
const { MSG_JOIN, MSG_ACTION, MSG_EVENT, MSG_PING } = netcode;

const levelName = process.argv[3] ?? 'wake';
const bots = Number(process.argv[4] ?? 8);
const seconds = Number(process.argv[5] ?? 120);
const mod = process.argv[6] ?? null;
const FRAME_MS = 1000 / 30;

const quiet = console.log; console.log = () => {}; console.warn = () => {};
// `BOT_DATA_ROOT`: a maps/models/glbs tree other than the viewer's own (a
// stage fetched from the live volume, for a level this checkout lacks).
const level = loadRealLevel({ viewerDir: process.env.BOT_DATA_ROOT || viewer, name: levelName, mod });
let clock = 0;
const core = new RoomServerCore({
  levels: new Map([[levelName, level]]), defaultLevel: levelName, now: () => clock,
  rules: { gameStartDelay: 0, roundStartDelay: 0 },
  bots: { enabled: bots > 0, perRoom: Math.min(15, bots), node: bots,
          vehicles: process.env.BOT_VEHICLES === '1', capsuleRays: process.env.BOT_CAPSULES !== '0',
          ...(process.env.BOT_THINK ? { thinkTicks: Number(process.env.BOT_THINK) } : {}),
          ...(process.env.BOT_SEAT_THINK ? { seatThinkTicks: Number(process.env.BOT_SEAT_THINK) } : {}) },
});
// `ROOMS` rooms of the level in one process, each with its own human, the
// bots shared out among them: the wire has 16 slots a room, so more than 15
// bots is more than one room, which is also what the node would be running.
const roomCount = Math.max(1, Number(process.env.ROOMS ?? Math.ceil(bots / 15)) || 1);
const peers = [];
const rooms = [];
for (let n = 0; n < roomCount; n++) {
  const peer = { sent: 0, bytes: 0, rows: [], closed: null,
    send(b) { this.sent++; this.bytes += b.length; if (b[0] === MSG_EVENT) this.rows.push(JSON.parse(Buffer.from(b.subarray(1)).toString('utf8'))); },
    close(code, reason) { this.closed = { code, reason }; } };
  core.attach(peer);
  peer.say = (type, row) => core.onMessage(peer, frame(type, Buffer.from(JSON.stringify(row))));
  peer.say(MSG_JOIN, { room: `COST${n}`, name: `human${n}`, team: 1 + (n % 2), level: levelName });
  peers.push(peer);
  rooms.push(core.room(`COST${n}`));
}
await Promise.all(rooms.map(room => room.bots.ready));
for (const [n, peer] of peers.entries()) peer.say(MSG_ACTION, { type: 'spawn', team: 1 + (n % 2) });

const ticks = Math.round(seconds * 30);
const times = new Float64Array(ticks);
const mem0 = process.memoryUsage().rss;
for (let i = 0; i < ticks; i++) {
  clock += FRAME_MS;
  if (i % 60 === 0) for (const peer of peers) core.onMessage(peer, frame(MSG_PING, Buffer.alloc(4)));
  // CPU time, not wall time: the process's own user + system microseconds,
  // which a busy machine does not stretch.
  const c0 = process.cpuUsage();
  for (const room of rooms) room.frame(FRAME_MS);
  const c1 = process.cpuUsage(c0);
  times[i] = (c1.user + c1.system) / 1000;
}
const botCount = rooms.reduce((n, room) => n + room.bots.count, 0);
const refTicks = rooms.reduce((n, room) => n + room.bots.cost.ticks, 0);
const refMs = rooms.reduce((n, room) => n + room.bots.cost.ms, 0);
const count = type => peers.reduce((n, peer) => n + peer.rows.filter(row => row.type === type).length, 0);
const sorted = [...times].sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / ticks;
const r = v => Math.round(v * 1000) / 1000;
console.log = quiet;
console.log(JSON.stringify({
  level: levelName, mod, vehicles: process.env.BOT_VEHICLES === '1', think: Number(process.env.BOT_THINK ?? 0) || 'default', rooms: roomCount, bots: botCount, asked: bots, seconds,
  tickMs: { mean: r(mean), p50: r(sorted[ticks >> 1]), p95: r(sorted[Math.floor(ticks * 0.95)]),
            p99: r(sorted[Math.floor(ticks * 0.99)]), max: r(sorted[ticks - 1]) },
  cpuShare: r(mean / FRAME_MS),
  refereeMs: r(refTicks ? refMs / (ticks) : 0),
  navMs: Math.round(rooms[0].bots.cost.navMs),
  rssMb: Math.round(process.memoryUsage().rss / 1048576), rssGrowMb: Math.round((process.memoryUsage().rss - mem0) / 1048576),
  rows: { killed: count('killed'), captured: count('captured'), fire: count('fire'), join: count('join'),
          spawn: count('spawn'), ticket: count('ticket'), seatEnter: count('seatEnter') },
  // The rounds the room flew itself (`server/room-guns.mjs`): every pull, the
  // seat guns' share and the bots' launchers and grenades.
  guns: rooms.reduce((sum, room) => {
    for (const [k, v] of Object.entries(room.guns?.stats ?? {})) sum[k] = (sum[k] ?? 0) + v;
    return sum;
  }, {}),
  bytesPerSecond: Math.round(peers.reduce((n, peer) => n + peer.bytes, 0) / seconds / roomCount),
}));
