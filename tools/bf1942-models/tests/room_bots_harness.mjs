// A room's bots (`server/room-bots.mjs`, gap audit entry 13), on the room
// server in-process with virtual peers on a manual clock.
//
//   off      a room whose server has bots off, and one on a level with no bot
//            data: no bot, ever
//   topup    retail's top-up (`gameStatusPlaying` 0x08150e8b): the room fills
//            to its max players on the side `getTeamToAddPlayer` names, and
//            only once the round plays; the bots' rows on the wire
//   late     a late joiner's HELLO and first snapshot carry the bots
//   over     a human joining a full room is seated (`createPlayer` counts
//            humans), the room holds one over its max, and the next bot to
//            die on the heavier side goes (`killPlayer` 0x0814dd15); a human
//            leaving is topped up again
//   slots    all 16 slots held: a bot goes at once for the human
//   fight    one human and bots play: a bot's kill of the human, with the
//            killer's slot, and the board's numbers for the bots; the human's
//            reported round kills a bot and is credited; the bot comes back
//            on the wave
//   round    the round ends on tickets, restarts, and the bots stand up again
//   caps     the per-room cap, the node-wide cap over two rooms, the host's
//            two words (`numberOfBots`, `coopAiSkill`)
//   empty    the last human gone, the bots go too
//
//   node tests/room_bots_harness.mjs [viewerDir]
// prints one JSON object. Run by `tests/test_room_bots.py`.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2]);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const netcode = await import(at(viewer, 'netcode.js'));
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { buildLevelFromDescriptor, fakeLevelDescriptor } = await import(at(HERE, '..', 'server', 'level.mjs'));
const roomBots = await import(at(HERE, '..', 'server', 'room-bots.mjs'));
const registry = await import(at(HERE, '..', 'server', 'room-registry.mjs'));
const { MSG_JOIN, MSG_ACTION, MSG_HELLO, MSG_EVENT, MSG_SNAPSHOT, MSG_JOIN_SNAPSHOT, MSG_LEAVE, MSG_PING,
        decodeSnapshot } = netcode;

const FRAME_MS = 1000 / 30;
const out = {};
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.error = quiet;

// --- the rig -------------------------------------------------------------------

/** The harness level with bot data: `ai.generated` marks a layer the bots may
 *  play (no strategic areas: each walks to the nearest enemy flag), and the
 *  flags stand 40 m apart so the two sides meet at once. */
function botLevel({ tickets = 100, vehicles = false } = {}) {
  const descriptor = fakeLevelDescriptor({ viewerDir: viewer });
  descriptor.name = 'botlevel';
  descriptor.extras.ai = { generated: { test: true }, strategicAreas: [] };
  descriptor.extras.tickets = { team1: tickets, team2: tickets, lossPerMin: { team1: 0, team2: 0 } };
  if (!vehicles) descriptor.vehicles = [];
  // Two bases that cannot change hands: a side that lost its only flag would
  // stand up on the enemy's and take its side (`world-players.js` `spawnPlayer`).
  for (const point of descriptor.extras.controlPoints) point.unableToChangeTeam = true;
  const level = buildLevelFromDescriptor({ viewerDir: viewer, descriptor });
  // The tree's own AI file for the hulls (`_shared/vehicle-ai.json`).
  level.paths = { levelDir: null, sharedDir: path.join(viewer, 'maps', '_shared'),
                  modelsDirs: [path.join(viewer, 'models')], glbsDir: path.join(viewer, 'glbs') };
  return level;
}

function makeCore({ bots = { enabled: true, perRoom: 15, node: 32 }, levels = null, rules = {}, memoryBudgetMb = null } = {}) {
  const state = { clock: 0 };
  const core = new RoomServerCore({
    levels: levels ?? new Map([['botlevel', botLevel()], ['test', buildLevelFromDescriptor({ viewerDir: viewer })]]),
    defaultLevel: 'botlevel', now: () => state.clock, random: mulberry(7),
    rules: { gameStartDelay: 0, roundStartDelay: 0, ...rules }, bots, memoryBudgetMb,
  });
  core.state = state;
  return core;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
                 t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
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
function join(peer, room, name, team, extra = {}) {
  sendJson(peer, MSG_JOIN, { room, name, team, ...extra });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  return hello ? jsonRow(hello) : null;
}
function lastSnapshot(peer, type = MSG_SNAPSHOT) {
  const snaps = peer.sent.filter(b => b[0] === type);
  if (!snaps.length) return null;
  const b = snaps[snaps.length - 1];
  return decodeSnapshot(new Uint8Array(b.subarray(1)));
}
async function run(core, code, seconds, peers = [], until = null) {
  const room = core.room(code);
  await room.bots.ready;
  const ticks = Math.round(seconds * 30);
  for (let i = 0; i < ticks; i++) {
    core.state.clock += FRAME_MS;
    if (i % 90 === 0) for (const peer of peers) if (!peer.closed) core.onMessage(peer, frame(MSG_PING, Buffer.alloc(4)));
    room.frame(FRAME_MS);
    if (until?.()) return i + 1;
  }
  return ticks;
}
const sides = room => {
  const count = { 1: 0, 2: 0 };
  for (const row of room.bots.slots.values()) count[row.team]++;
  return count;
};

// --- off -----------------------------------------------------------------------
{
  const core = makeCore({ bots: null });
  const peer = makePeer(core);
  const hello = join(peer, 'OFF', 'alice', 1, { level: 'botlevel' });
  await run(core, 'OFF', 5, [peer]);
  const core2 = makeCore();
  const peer2 = makePeer(core2);
  const hello2 = join(peer2, 'NODATA', 'bob', 1, { level: 'test' });
  await run(core2, 'NODATA', 5, [peer2]);
  out.off = {
    serverOff: { bots: core.room('OFF').bots.count, hello: hello.bots, joins: rowsOf(peer, 'join').length },
    noData: { bots: core2.room('NODATA').bots.count, hello: hello2.bots, joins: rowsOf(peer2, 'join').length },
    hasData: [roomBots.layerHasBotData({ ai: { strategicAreas: [{}] } }), roomBots.layerHasBotData({ ai: { generated: {} } }),
              roomBots.layerHasBotData({ ai: { strategicAreas: [] } }), roomBots.layerHasBotData({})],
  };
}

// --- topup, late ------------------------------------------------------------------
{
  const core = makeCore({ rules: { gameStartDelay: 4 } });
  const alice = makePeer(core);
  const hello = join(alice, 'TOP', 'alice', 1, { settings: { maxPlayers: 6 } });
  // The pre-game: nobody is topped up before the round plays.
  await run(core, 'TOP', 2, [alice]);
  const room = core.room('TOP');
  const during = room.bots.count;
  await run(core, 'TOP', 4, [alice]);
  const joins = rowsOf(alice, 'join');
  const snap = lastSnapshot(alice);
  const bob = makePeer(core);
  const helloBob = join(bob, 'TOP', 'bob', 0);
  const joinSnap = lastSnapshot(bob, MSG_JOIN_SNAPSHOT);
  out.topup = {
    hello: hello.bots, preGame: during, bots: room.bots.count, sides: sides(room),
    slots: [...room.bots.slots.keys()],
    joins: joins.map(r => ({ slot: r.slot, team: r.team, bot: r.bot === true, named: typeof r.text === 'string' && r.text.length > 0 })),
    spawns: rowsOf(alice, 'spawn').length,
    snapshotSlots: snap.players.map(p => p.slot).sort((a, b) => a - b),
    snapshotAlive: snap.players.filter(p => p.alive).length,
    worldBots: [...room.world.players.values()].filter(p => p.bot).length,
  };
  out.late = {
    roster: helloBob.slots.map(r => ({ slot: r.slot, bot: r.bot === true, team: r.team, named: !!r.name,
                                       stats: Number.isFinite(r.score) && Number.isFinite(r.kills) && Number.isFinite(r.deaths) })),
    team: helloBob.team,
    joinSnapshotSlots: joinSnap.players.map(p => p.slot).sort((a, b) => a - b),
    bots: helloBob.bots,
  };
}

// --- over: one over the max until a bot of the heavier side dies -------------------
{
  const core = makeCore();
  const alice = makePeer(core);
  join(alice, 'OVER', 'alice', 1, { settings: { maxPlayers: 6 } });
  await run(core, 'OVER', 1, [alice]);
  const room = core.room('OVER');
  const full = { bots: room.bots.count, total: room.bots.count + room.players.size };
  const bob = makePeer(core);
  const helloBob = join(bob, 'OVER', 'bob', 0);
  const seated = { ok: !!helloBob, slot: helloBob?.slot, team: helloBob?.team,
                   bots: room.bots.count, total: room.bots.count + room.players.size };
  const leavesBefore = rowsOf(alice, 'leave').length;
  // The fight thins them: the first bot to die on the side the next player
  // would not be added to is taken out.
  await run(core, 'OVER', 240, [alice, bob], () => room.bots.count + room.players.size <= 6);
  const after = { bots: room.bots.count, total: room.bots.count + room.players.size,
                  leave: rowsOf(alice, 'leave').slice(leavesBefore).map(r => ({ bot: r.bot === true, named: !!r.text })) };
  // Bob leaves: the next tick tops the room up again.
  core.onMessage(bob, frame(MSG_LEAVE, Buffer.alloc(0)));
  const gone = { bots: room.bots.count, total: room.bots.count + room.players.size };
  await run(core, 'OVER', 0.2, [alice]);
  out.over = { full, seated, after, gone, refilled: { bots: room.bots.count, total: room.bots.count + room.players.size } };
}

// --- slots: all sixteen held ----------------------------------------------------------
{
  const core = makeCore();
  const alice = makePeer(core);
  join(alice, 'SLOTS', 'alice', 1);
  await run(core, 'SLOTS', 1, [alice]);
  const room = core.room('SLOTS');
  const before = { bots: room.bots.count, humans: room.players.size };
  const bob = makePeer(core);
  const helloBob = join(bob, 'SLOTS', 'bob', 0);
  out.slots = {
    before, joined: !!helloBob, slot: helloBob?.slot ?? null,
    after: { bots: room.bots.count, humans: room.players.size },
    leaveRows: rowsOf(alice, 'leave').filter(r => r.bot === true).length,
    distinct: new Set([...room.players.keys(), ...room.bots.slots.keys()]).size,
  };
}

// --- fight -----------------------------------------------------------------------------
{
  const core = makeCore();
  const alice = makePeer(core);
  const hello = join(alice, 'FIGHT', 'alice', 1, { settings: { maxPlayers: 8 } });
  const room = core.room('FIGHT');
  await room.bots.ready;
  sendJson(alice, MSG_ACTION, { type: 'spawn', team: 1, flag: 0 });
  const me = hello.slot;
  // Alice stands on her flag; the other side's bots walk to it and shoot.
  const ticks = await run(core, 'FIGHT', 300, [alice],
    () => rowsOf(alice, 'killed').some(r => r.slot === me && room.bots.has(r.other)));
  const mine = rowsOf(alice, 'killed').find(r => r.slot === me && room.bots.has(r.other)) ?? null;
  await run(core, 'FIGHT', 1, [alice]);
  const stats = rowsOf(alice, 'stats').flatMap(r => r.rows);
  const killerRow = mine ? stats.filter(r => r[0] === mine.other).pop() ?? null : null;
  const myRow = stats.filter(r => r[0] === me).pop() ?? null;
  // Alice's own round on a living bot of the other side, as her page reports it.
  // ...once her own wave lets her back (SPAWN-35).
  await run(core, 'FIGHT', 60, [alice], () => room.authority.spawnWaitLeft(me) <= 0);
  sendJson(alice, MSG_ACTION, { type: 'spawn', team: 1, flag: 0 });
  const aliveNow = !room.authority.dead.has(me);
  const target = [...room.bots.slots].find(([slot, row]) => row.team === 2 && !room.world.armorOf(slot)?.destroyed)?.[0] ?? null;
  const hpBefore = target != null ? room.world.armorOf(target).hitPoints : null;
  const spawnsBefore = rowsOf(alice, 'spawn').filter(r => r.slot === target).length;
  const at3 = target != null ? [room.world.player(target).soldier.x, room.world.player(target).soldier.y + 1, room.world.player(target).soldier.z] : [0, 0, 0];
  sendJson(alice, MSG_ACTION, { type: 'impact', point: at3, hit: { slot: target }, damage: 5, splash: null });
  const hpHurt = target != null ? room.world.armorOf(target).hitPoints : null;
  sendJson(alice, MSG_ACTION, { type: 'impact', point: at3, hit: { slot: target }, damage: 500, splash: null });
  await run(core, 'FIGHT', 0.2, [alice]);
  const credited = rowsOf(alice, 'killed').some(r => r.slot === target && r.other === me);
  await run(core, 'FIGHT', 40, [alice], () => rowsOf(alice, 'spawn').filter(r => r.slot === target).length > spawnsBefore);
  out.fight = {
    ticks, killedByBot: mine ? { other: mine.other, sw: mine.sw, otherIsBot: room.bots.has(mine.other),
                                 otherTeam: room.bots.slots.get(mine.other)?.team ?? null } : null,
    killerBoard: killerRow ? { kills: killerRow[2], score: killerRow[1] } : null,
    myBoard: myRow ? { deaths: myRow[3] } : null,
    fireRows: rowsOf(alice, 'fire').filter(r => room.bots.has(r.slot) || r.slot > 1).length,
    aliveNow, target: target != null, hpBefore, hpHurt, credited,
    respawned: rowsOf(alice, 'spawn').filter(r => r.slot === target).length > spawnsBefore,
    targetAlive: target != null ? !room.world.armorOf(target)?.destroyed : null,
    teamKills: room.authority.teamKillsOf(me),
  };
}

// --- hull: a bot in a seat, by the room's own seat law ----------------------------------
{
  const level = botLevel({ vehicles: true });
  const core = makeCore({ levels: new Map([['botlevel', level]]), bots: { enabled: true, perRoom: 15, node: 32, vehicles: true } });
  const alice = makePeer(core);
  join(alice, 'HULL', 'alice', 1, { level: 'botlevel', settings: { maxPlayers: 4 } });
  const room = core.room('HULL');
  await run(core, 'HULL', 1, [alice]);
  const referee = room.bots.referee;
  const [slot, row] = [...room.bots.slots].find(([, r]) => r.team === 1) ?? [];
  const cands = referee ? (room.bots.units?.candidates() ?? []) : [];
  const driver = cands.find(c => c.isRoot && /willy/i.test(String(c.template))) ?? null;
  const entered = driver && row ? referee.enterVehicle(row.bot, driver) : false;
  const entry = room.instance.table.find(e => /willy/i.test(e.template));
  const before = entry ? room.world.vehiclePose(entry.owner) : null;
  await run(core, 'HULL', 6, [alice]);
  const snap = lastSnapshot(alice);
  const me = snap.players.find(p => p.slot === slot) ?? null;
  const after = entry ? room.world.vehiclePose(entry.owner) : null;
  out.hull = {
    candidates: cands.length, kinds: [...new Set(cands.map(c => c.kind))], entered: !!entered,
    seatEnter: rowsOf(alice, 'seatEnter').filter(r => r.slot === slot).map(r => ({ vehicle: r.vehicle, seat: r.seat })),
    tableId: entry?.id ?? null, driver: entry?.driver ?? null, botSlot: slot ?? null,
    snapshot: me ? { seated: me.seated, vehicleId: me.vehicleId, seatIndex: me.seatIndex } : null,
    moved: before && after ? Math.hypot(after.x - before.x, after.z - before.z) : null,
    drives: !!row?.bot.vehicle?.drives, kind: row?.bot.vehicle?.kind ?? null,
  };
  // A human of the bot's side presses Use on the seat the bot holds: nobody
  // is seated, and the bot is asked for it (`playerRequestPlayerControlObject`).
  sendJson(alice, MSG_ACTION, { type: 'spawn', team: 1, flag: 0 });
  sendJson(alice, MSG_ACTION, { type: 'seat', action: 'enter', vehicle: entry?.id, seat: 0 });
  out.hull.request = { refused: rowsOf(alice, 'seatRefused').length, asked: !!row?.bot.seatRequest,
                       stillBots: entry?.driver === slot,
                       humanSeated: !!room.world.player(1)?.occupancy };
  // Out again, by the referee's own leave: the seat row and the soldier back.
  if (row?.bot.vehicle) referee.leaveVehicle(row.bot);
  out.hull.left = { seatExit: rowsOf(alice, 'seatExit').filter(r => r.slot === slot).length,
                    occupancy: !!room.world.player(slot)?.occupancy, driver: entry?.driver ?? null };
}

// --- round: tickets out, restart, the bots again ------------------------------------------
{
  const core = makeCore({ levels: new Map([['botlevel', botLevel({ tickets: 6 })]]) });
  const alice = makePeer(core);
  join(alice, 'ROUND', 'alice', 1, { settings: { maxPlayers: 8 } });
  const room = core.room('ROUND');
  const ticks = await run(core, 'ROUND', 600, [alice], () => rowsOf(alice, 'roundEnd').length > 0);
  const end = rowsOf(alice, 'roundEnd')[0] ?? null;
  const botsAtEnd = room.bots.count;
  const aliveAtEnd = [...room.bots.slots.keys()].filter(slot => !room.world.armorOf(slot)?.destroyed).length;
  await run(core, 'ROUND', 30, [alice], () => rowsOf(alice, 'restart').length > 0);
  const restarted = rowsOf(alice, 'restart').length;
  await run(core, 'ROUND', 3, [alice]);
  out.round = {
    seconds: Math.round(ticks / 30), ended: !!end, reason: end?.reason ?? null, winner: end?.winner ?? null,
    medals: (end?.medals ?? []).length, botsAtEnd, aliveAtEnd, restarted,
    aliveAfter: [...room.bots.slots.keys()].filter(slot => !room.world.armorOf(slot)?.destroyed).length,
    botsAfter: room.bots.count, status: room.authority.round.status,
  };
}

// --- caps and the host's two words ------------------------------------------------------------
{
  const core = makeCore({ bots: { enabled: true, perRoom: 3, node: 4 } });
  const a = makePeer(core), b = makePeer(core);
  join(a, 'CAPA', 'alice', 1);
  await run(core, 'CAPA', 1, [a]);
  join(b, 'CAPB', 'bob', 1);
  await run(core, 'CAPB', 1, [b]);
  const core2 = makeCore();
  const c = makePeer(core2);
  const hello = join(c, 'WORDS', 'carol', 1, { settings: { numberOfBots: 2, coopAiSkill: 50 } });
  await run(core2, 'WORDS', 1, [c]);
  const words = core2.room('WORDS');
  const core3 = makeCore();
  const d = makePeer(core3);
  join(d, 'NONE', 'dave', 1, { settings: { numberOfBots: 0 } });
  await run(core3, 'NONE', 1, [d]);
  out.caps = {
    perRoom: core.room('CAPA').bots.count, second: core.room('CAPB').bots.count, node: core.bots.used(),
    words: { bots: words.bots.count, skill: [...words.bots.slots.values()].map(r => r.bot.botSkill), hello: hello.bots,
             settings: { numberOfBots: hello.settings?.numberOfBots, coopAiSkill: hello.settings?.coopAiSkill } },
    none: core3.room('NONE').bots.count,
    limits: roomBots.BOT_LIMITS, retail: { maxNBots: roomBots.RETAIL_MAX_N_BOTS, skill: roomBots.RETAIL_BOT_SKILL },
    think: roomBots.BOT_THINK_TICKS,
    defaults: roomBots.botSettingsOf(null),
  };
}

// --- empty ------------------------------------------------------------------------------------
{
  const core = makeCore();
  const alice = makePeer(core);
  join(alice, 'EMPTY', 'alice', 1, { settings: { maxPlayers: 5 } });
  await run(core, 'EMPTY', 1, [alice]);
  const room = core.room('EMPTY');
  const before = room.bots.count;
  core.onMessage(alice, frame(MSG_LEAVE, Buffer.alloc(0)));
  await run(core, 'EMPTY', 0.2, []);
  out.empty = { before, after: room.bots.count, world: room.world.players.size };
}

// --- cap: the live rooms the server's memory holds ------------------------------------------
{
  const M = registry.ROOM_MEMORY;
  // Room for two bot rooms on one level, and not a megabyte more.
  const budget = M.process + M.level + 2 * (M.room + M.bots);
  // A server with bots in hulls: a hull room reserves more, so a budget with
  // room for two foot rooms and one room's hulls holds one hull room, not two.
  const hullCore = makeCore({ memoryBudgetMb: M.process + M.level + 2 * (M.room + M.bots) + M.hulls, bots: { enabled: true, perRoom: 15, node: 32, vehicles: true } });
  const h1 = makePeer(hullCore), h2 = makePeer(hullCore);
  const hullFirst = join(h1, 'HULLA', 'alice', 1);
  const hullSecond = join(h2, 'HULLB', 'bob', 1);
  const hullEstimate = hullCore.memoryEstimateMb();
  // ...and a room on a level with no bot data is a plain room's size.
  const plainCore = makeCore({ memoryBudgetMb: 10000 });
  join(makePeer(plainCore), 'PLAIN', 'carol', 1, { level: 'test' });
  const plainEstimate = plainCore.memoryEstimateMb();
  const core = makeCore({ memoryBudgetMb: budget });
  const closedCode = peer => { const b = peer.sent.find(x => x[0] === netcode.MSG_CLOSED); return b ? jsonRow(b).code : null; };
  const a = makePeer(core), b = makePeer(core), c = makePeer(core), d = makePeer(core), e = makePeer(core);
  const first = join(a, 'CAP1', 'alice', 1);
  const second = join(b, 'CAP2', 'bob', 1);
  const fullNow = !core.mayCreate();
  const third = join(c, 'CAP3', 'carol', 1);
  const roomsThen = [...core.rooms.keys()].sort();
  // A room that exists is joined whatever the cap says.
  const existing = join(d, 'CAP1', 'dave', 2);
  // Bob leaves; his room stands empty a minute and is dropped, and the next create fits.
  core.onMessage(b, frame(MSG_LEAVE, Buffer.alloc(0)));
  const early = !core.mayCreate();
  core.state.clock += registry.EMPTY_ROOM_MS + 1000;
  const later = core.mayCreate();
  const fourth = join(e, 'CAP4', 'erin', 1);
  // The numbers the server runs on.
  const whole = new registry.RoomServerCore({ bots: { enabled: true } });
  const est = (levels, rooms, hulls = false) => M.process + M.level * levels + (M.room + M.bots + (hulls ? M.hulls : 0)) * rooms;
  out.cap = {
    first: !!first, second: !!second, fullNow, third: third ? 'joined' : closedCode(c), thirdClosed: !!c.closed,
    rooms: roomsThen, existing: !!existing && existing.room === 'CAP1',
    early, later, fourth: !!fourth, afterReap: [...core.rooms.keys()].sort(),
    estimate: core.memoryEstimateMb(), memory: M, emptyMs: registry.EMPTY_ROOM_MS,
    noCap: whole.mayCreate('anything'),
    // With the server's own budget: rooms on one level, and rooms each on its own.
    fitsOneLevel: [1, 2, 3, 4, 5, 6].filter(n => est(1, n) <= M.budget).length,
    fitsOwnLevels: [1, 2, 3, 4, 5, 6].filter(n => est(n, n) <= M.budget).length,
    hullFitsOneLevel: [1, 2, 3, 4, 5, 6].filter(n => est(1, n, true) <= M.budget).length,
    hullFitsOwnLevels: [1, 2, 3, 4, 5, 6].filter(n => est(n, n, true) <= M.budget).length,
    hull: { first: !!hullFirst, second: hullSecond ? 'joined' : closedCode(h2), estimate: hullEstimate,
            one: M.process + M.level + M.room + M.bots + M.hulls },
    plain: { estimate: plainEstimate, one: M.process + M.level + M.room },
  };
}

process.stdout.write(JSON.stringify(out));
