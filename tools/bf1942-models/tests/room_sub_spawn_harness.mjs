// The room server's submarine spawn gate (ledger SPAWN-39,
// `disableSpawnPointsOnEnter`): a carried point whose carrier says the word
// is out of the draw while anyone holds the carrier's own seat
// (`server/level-instance.mjs` `pointShutByBoarding`, `server/room-control.mjs`
// `openToBoarding`), and back when they get out.
//
// A descriptor level whose Willy carries two points on two pads' worth of
// rows: one that says `disableOnEnter` (the Gato's row as the `spawns` layer
// writes it) and, on a second flag, one that does not (a destroyer's deck).
//
//   node tests/room_sub_spawn_harness.mjs <viewerDir>
// prints one JSON object. Run by `tests/test_sw_rocket_sub.py`.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2]);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const netcode = await import(at(viewer, 'netcode.js'));
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { buildLevelFromDescriptor, fakeLevelDescriptor } = await import(at(HERE, '..', 'server', 'level.mjs'));
const { MSG_JOIN, MSG_ACTION, MSG_HELLO, MSG_EVENT } = netcode;

const FRAME_MS = 1000 / 30;
const out = {};

function makePeer(core) {
  const peer = { sent: [], closed: null,
                 send(bytes) { this.sent.push(Buffer.from(bytes)); },
                 close(code, reason) { this.closed = { code, reason }; } };
  peer.core = core;
  core.attach(peer);
  return peer;
}
const jsonRow = buf => JSON.parse(Buffer.from(buf.subarray(1)).toString('utf8'));
const sendJson = (peer, type, row) => peer.core.onMessage(peer, frame(type, Buffer.from(JSON.stringify(row))));
const rowsOf = (peer, type) => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).filter(r => r.type === type);
function join(peer, room, name, team) {
  sendJson(peer, MSG_JOIN, { room, name, team });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  return hello ? jsonRow(hello) : null;
}

if (existsSync(path.join(viewer, 'models', 'Willy.glb'))) {
  const descriptor = fakeLevelDescriptor({ viewerDir: viewer });
  descriptor.name = 'subs';
  descriptor.extras.vehicleSoldierSpawns = [
    { vehicle: 'Willy', spawner: 'willyspawner', pad: 0, name: 'gatodriversoldierspawn', group: 79, team: 1,
      position: [40, 0.5, 40], rotation: [0, 0, 0], disableOnEnter: true },
  ];
  const clock = { ms: 0 };
  const core = new RoomServerCore({
    levels: new Map([['subs', buildLevelFromDescriptor({ viewerDir: viewer, descriptor })]]),
    defaultLevel: 'subs', now: () => clock.ms,
    rules: { gameStartDelay: 0, roundStartDelay: 0 },
  });
  const pA = makePeer(core);
  const pB = makePeer(core);
  const hello = join(pA, 'SUBS', 'Helm', 1);
  join(pB, 'SUBS', 'Second', 1);
  const room = core.room('SUBS');
  const world = room.world;
  const run = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  const flag = hello.flags.findIndex(f => f.name === 'gatodriversoldierspawn');
  const willy = hello.vehicles.find(v => v.template === 'Willy');
  const point = room.instance.flags[flag].spawns[0];
  const alive = slot => { const p = world.player(slot); return !!p?.armor && !p.armor.destroyed; };
  const spawnRow = { type: 'spawn', flag, spawnIndex: 0, kit: null };
  const shut = () => room.instance.pointShutByBoarding(point);

  // Nobody aboard: the point is open, and the helm spawns on it.
  const before = shut();
  sendJson(pA, MSG_ACTION, spawnRow);
  run(1);
  const helmSpawned = alive(1);
  const helmAt = (() => { const s = world.player(1).soldier; return [s.x, s.z]; })();

  // The helm takes the carrier's own seat: the point is shut.
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'enter' });
  run(2);
  const seated = !!world.player(1).occupancy;
  const boarded = shut();
  sendJson(pB, MSG_ACTION, spawnRow);
  run(1);
  const refused = { rows: rowsOf(pB, 'spawnRefused').length, alive: alive(2),
                    spawnRows: rowsOf(pA, 'spawn').filter(r => r.slot === 2).length,
                    leaked: rowsOf(pA, 'spawnRefused').length };

  // A seat that is not the carrier's own does not shut it (the word is the
  // root PlayerControlObject's): the helm moves to the passenger's seat.
  const seats = world.player(1).occupancy.order.length;
  let passenger = null;
  if (seats > 1) {
    sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 1, action: 'switch' });
    run(2);
    const occ = world.player(1).occupancy;
    passenger = { moved: occ ? occ.order.indexOf(occ.activeSeatId) : null, shut: shut() };
    sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'switch' });
    run(2);
  }

  // The helm gets out: the point is open again and the second player spawns.
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'exit' });
  run(2);
  const left = shut();
  sendJson(pB, MSG_ACTION, spawnRow);
  run(1);
  const after = { alive: alive(2), spawnRows: rowsOf(pA, 'spawn').filter(r => r.slot === 2).length,
                  refusedRows: rowsOf(pB, 'spawnRefused').length,
                  flagKept: world.player(2).flag === room.instance.flags[flag] };

  // A row without the word is never shut, whoever is aboard.
  const plain = room.instance.pointShutByBoarding({ ...point, disableOnEnter: false });
  out.sub = { flag, before, helmSpawned, helmAt, seated, boarded, refused, passenger, left, after, plain };
}

console.log(JSON.stringify(out));
