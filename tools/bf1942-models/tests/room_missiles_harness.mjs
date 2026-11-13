// The round that is a vehicle, on the room server (`server/room-missiles.mjs`,
// ledger FA-29, FA-30): a launch moves the gunner into the missile, the
// warhead and the use key give them back to the launcher alive.
//
// The level is a descriptor with Eve of Destruction's `Hawk` (a stationary
// launcher whose FireArms throws `HawkRocket`, a PlayerControlObject, exactly
// as Secret Weapons' Wasserfall throws `WasserfallRocket`), when that tree is
// extracted. The glbs there predate the exporter's words, so the level's
// `templateWords` carry them, as a published level's does.
//
//   node tests/room_rounds_harness.mjs <viewerDir>
// prints one JSON object. Run by `tests/test_sw_rocket_sub.py`.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
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
const eod = path.join(viewer, 'models', 'mods', 'eod');

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

if (existsSync(path.join(eod, 'Hawk.glb')) && existsSync(path.join(eod, 'HawkRocket.glb'))) {
  // A viewer directory whose `models` is the mod's tree.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'room-missiles-'));
  symlinkSync(eod, path.join(tmp, 'models'));
  try {
    const descriptor = fakeLevelDescriptor({ viewerDir: tmp });
    descriptor.name = 'rounds';
    descriptor.vehicles = [
      { vehicle: 'Hawk', team: 1, position: [40, 0, 40], rotation: [0, 0, 0] },
    ];
    descriptor.extras.templateWords = {
      hawk_rockets: { fireArms: { disableWhenFired: true, projectile: { vehicle: true } } },
      hawkguns: { fireArms: { destroyVehicleWhenNoAmmo: true } },
      hawkrocket: { physics: { destroyOnExit: true } },
    };
    const clock = { ms: 0 };
    const core = new RoomServerCore({
      levels: new Map([['rounds', buildLevelFromDescriptor({ viewerDir: tmp, descriptor })]]),
      defaultLevel: 'rounds', now: () => clock.ms,
      rules: { gameStartDelay: 0, roundStartDelay: 0 },
    });
    const pA = makePeer(core);
    const pB = makePeer(core);
    const hello = join(pA, 'RND', 'Gunner', 1);
    join(pB, 'RND', 'Watcher', 1);
    const room = core.room('RND');
    const world = room.world;
    const run = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
    const hawk = hello.vehicles.find(v => v.template === 'Hawk');
    const rocket = hello.vehicles.find(v => v.round === hawk?.id);
    const templateOf = slot => {
      const occ = world.player(slot)?.occupancy;
      return occ ? room.instance.table.find(e => e.root === occ.root)?.template ?? null : null;
    };
    const alive = slot => { const p = world.player(slot); return !!p?.armor && !p.armor.destroyed; };
    const entry = room.instance.table.find(e => e.id === rocket?.id);
    const hp = () => world.vehicleDamage.get(entry.owner)?.hitPoints ?? null;
    const flag = hello.flags.findIndex(f => f.team === 1);

    out.table = { hawk: !!hawk, rocket: rocket ? { template: rocket.template, live: rocket.live, round: rocket.round } : null,
                  count: room.missiles.count };

    // Not in the launcher: refused.
    sendJson(pA, MSG_ACTION, { type: 'spawn', flag, spawnIndex: 0, kit: null });
    run(1);
    sendJson(pA, MSG_ACTION, { type: 'launch', vehicle: hawk.id });
    run(1);
    const onFoot = { refused: rowsOf(pA, 'launchRefused').map(r => r.why), seat: templateOf(1), live: entry.live };

    // In the launcher: the launch.
    sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: hawk.id, seat: 0, action: 'enter' });
    run(2);
    const inLauncher = templateOf(1);
    sendJson(pA, MSG_ACTION, { type: 'launch', vehicle: hawk.id });
    const state = world.player(1)?.vehicle?.state;
    const launch = {
      seat: templateOf(1), live: entry.live, drives: !!world.player(1)?.vehicle,
      speed: state ? +state.velocity.length().toFixed(3) : null,
      up: state ? +state.velocity.y.toFixed(3) : null,
      at: state ? state.position.toArray().map(v => +v.toFixed(2)) : null,
      spawnRow: rowsOf(pB, 'padSpawn').filter(r => r.vehicle === rocket.id).map(r => ({ round: r.round, pad: r.pad })),
      seatRows: rowsOf(pB, 'seatEnter').filter(r => r.slot === 1).map(r => r.vehicle),
      riding: room.missiles.riding(1)?.round.id ?? null,
    };
    // A second launch while it flies is refused.
    sendJson(pA, MSG_ACTION, { type: 'launch', vehicle: hawk.id });
    const again = rowsOf(pA, 'launchRefused').map(r => r.why);
    run(30);
    const s2 = world.player(1)?.vehicle?.state;
    // Not its flight: a descriptor level has no collision companion file,
    // so no airframe here has an inertia box (the real-level run is the
    // builder's report).
    const flown = { seat: templateOf(1),
                    alive: alive(1) };

    // Somebody else's detonate is nobody's; the rider's kills the round and
    // gives them back.
    sendJson(pB, MSG_ACTION, { type: 'detonate', vehicle: rocket.id });
    const strangers = hp();
    sendJson(pA, MSG_ACTION, { type: 'detonate', vehicle: rocket.id });
    run(2);
    const detonated = {
      strangers, hp: hp(), destroyed: !!world.vehicleDamage.get(entry.owner)?.destroyed,
      seat: templateOf(1), alive: alive(1), riding: room.missiles.riding(1)?.round.id ?? null,
      hullRows: rowsOf(pB, 'hull').filter(r => r.vehicle === rocket.id && r.destroyed).length,
      backRows: rowsOf(pB, 'seatEnter').filter(r => r.slot === 1 && r.vehicle === hawk.id).length,
    };

    // Launched again over its own wreck, and left by the use key:
    // `destroyOnExit` kills it and the rider is back in the launcher.
    sendJson(pA, MSG_ACTION, { type: 'launch', vehicle: hawk.id });
    const relaunched = { seat: templateOf(1), hp: hp(), live: entry.live };
    run(10);
    sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: rocket.id, seat: 0, action: 'exit' });
    run(2);
    const exited = { seat: templateOf(1), alive: alive(1),
                     destroyed: !!world.vehicleDamage.get(entry.owner)?.destroyed };

    // A round that dies under its rider in the world's own damage pass.
    sendJson(pA, MSG_ACTION, { type: 'launch', vehicle: hawk.id });
    run(5);
    world.vehicleDamage.get(entry.owner).damage(1e10);
    run(3);
    const shot = { seat: templateOf(1), alive: alive(1) };
    out.round = { onFoot, inLauncher, launch, again, flown, detonated, relaunched, exited, shot };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(JSON.stringify(out));
