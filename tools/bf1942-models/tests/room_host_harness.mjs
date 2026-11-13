// The room's host half under test (`server/room-host.mjs`, `room-votes.mjs`,
// `room-settings.mjs`): one node run, many assertions, the pattern of
// `room_harness.mjs` (virtual peers on a manual clock, no ports).
//
// Scenarios: the settings a create row carries and NET-21's defaults; the
// join gate (password, reserved slots, max players, bans); the admin and its
// words; the three votes on retail's law; auto-balance on death; the welcome
// lines; the round count and the map list's level change.

import { RoomServerCore, frame } from './server/rooms.mjs';
import { buildLevelFromDescriptor } from './server/level.mjs';
import { votesNeeded, VOTE_ISSUE_GAP, VOTE_MAJORITY, VOTING_TIME } from './server/room-votes.mjs';
import { ROOM_SETTING_DEFAULTS, sanitizeSettings } from './server/room-settings.mjs';
import { friendlyDamage } from './viewer/friendly-fire.js';
import {
  MSG_JOIN, MSG_ACTION, MSG_EVENT, MSG_HELLO, MSG_CLOSED,
} from './viewer/netcode.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OVERLAY = fileURLToPath(new URL('.', import.meta.url));
const VIEWER_DIR = join(OVERLAY, 'viewer');
const FRAME_MS = 1000 / 30;

const clock = { ms: 0 };
const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
const levels = new Map([['test', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR })]]);
levels.set('second', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR,
  descriptor: { ...base, name: 'second' } }));
let coin = 0;
const core = new RoomServerCore({
  levels, defaultLevel: 'test', now: () => clock.ms, random: () => coin,
});
// A server whose operator set no pre-game, for the scenarios that spawn.
const quick = new RoomServerCore({
  levels, defaultLevel: 'test', now: () => clock.ms, random: () => coin,
  rules: { gameStartDelay: 0, roundStartDelay: 0 },
});

let tag = 1;
function peerOn(server) {
  const peer = { tag: tag++, sent: [], closed: null,
                 send(bytes) { this.sent.push(Buffer.from(bytes)); },
                 close(code, reason) { this.closed = { code, reason }; } };
  peer._core = server;
  server.attach(peer);
  return peer;
}
const rowOf = buf => JSON.parse(Buffer.from(buf.subarray(1)).toString('utf8'));
const rows = (peer, type) => peer.sent.filter(b => b[0] === MSG_EVENT).map(rowOf)
  .filter(r => !type || r.type === type);
const closedCode = peer => { const b = peer.sent.find(x => x[0] === MSG_CLOSED); return b ? rowOf(b).code : null; };
const sendJson = (peer, type, row) => peer._core.onMessage(peer, frame(type, Buffer.from(JSON.stringify(row))));
function join_(server, room, name, extra = {}) {
  const peer = peerOn(server);
  sendJson(peer, MSG_JOIN, { room, name, team: 0, ...extra });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  peer.hello = hello ? rowOf(hello) : null;
  return peer;
}
const action = (peer, row) => sendJson(peer, MSG_ACTION, row);
function step(server, code, n) {
  for (let i = 0; i < n; i++) {
    clock.ms += FRAME_MS;
    const room = server.room(code);
    if (!room) return;
    for (const c of room.players.values()) c.lastSeen = clock.ms;
    room.frame(FRAME_MS);
  }
}

const results = {};

// --- the defaults (NET-21) and a create row's settings ---------------------------
{
  const plain = join_(core, 'DEF', 'One');
  const room = core.room('DEF');
  results.defaults = {
    table: { ...ROOM_SETTING_DEFAULTS },
    hello: plain.hello.settings,
    rules: { ...room.authority.rules },
    admin: plain.hello.admin, hasKey: typeof plain.hello.adminKey === 'string',
    maps: plain.hello.maps, mapIndex: plain.hello.mapIndex,
    lobby: core.roomList().find(r => r.code === 'DEF'),
  };
  const made = join_(core, 'SET', 'Host', { settings: {
    gameTime: 15, numberOfRounds: 2, spawnTime: 10, gameStartDelay: 5, ticketRatio: 50,
    friendlyFire: 0, maxPlayers: 4, password: 'secret', scoreLimit: 7,
    axisTeamRatio: 2, alliedTeamRatio: 1, autoBalance: true,
    welcome: ['Welcome to the room', 'Play fair'],
    maps: [{ level: 'test' }, { level: 'second', mode: 'Conquest' }, { level: 'nowhere' }],
    bogus: 9,
  } });
  const set = core.room('SET');
  results.settings = {
    hello: made.hello.settings, max: made.hello.maxPlayers,
    maps: made.hello.maps,
    rules: { ...set.authority.rules },
    tickets: made.hello.tickets,
    roundGameTime: set.authority.round.gameTime, roundScoreLimit: set.authority.round.scoreLimit,
    preGameIn: set.authority.round.preGameIn,
    friendly: set.host.friendlyFire(),
    friendlyHit: friendlyDamage(10, { attackerTeam: 1, victimTeam: 1, settings: set.host.friendlyFire() }),
    lobby: core.roomList().find(r => r.code === 'SET'),
    welcome: rows(made, 'welcome').map(r => [r.id, r.text]),
    // Clamped to the CREATE GAME boxes' ranges.
    clamped: sanitizeSettings({ gameTime: 5000, ticketRatio: 1, friendlyFire: 250, maxPlayers: 64,
                                gameStartDelay: 0, password: 'has space' }),
  };
  // The join gate: the password.
  const noPass = join_(core, 'SET', 'Two');
  const wrong = join_(core, 'SET', 'Two', { password: 'nope' });
  const right = join_(core, 'SET', 'Two', { password: 'secret' });
  results.password = { none: closedCode(noPass), wrong: closedCode(wrong), right: !!right.hello,
                       rightAdmin: right.hello?.admin, rightKey: 'adminKey' in (right.hello ?? {}),
                       welcome: rows(right, 'welcome').length };
  // Max players 4.
  join_(core, 'SET', 'Three', { password: 'secret' });
  join_(core, 'SET', 'Four', { password: 'secret' });
  const fifth = join_(core, 'SET', 'Five', { password: 'secret' });
  results.maxPlayers = { fifth: closedCode(fifth), players: set.players.size };
}

// --- reserved slots ----------------------------------------------------------------
{
  const host = join_(core, 'RSV', 'Host', { settings: {
    maxPlayers: 3, reservedPassword: 'vip', numReservedSlots: 1 } });
  const second = join_(core, 'RSV', 'Two');
  // Two in, one slot left and it is reserved: a plain joiner is refused 0x1e.
  const third = join_(core, 'RSV', 'Three');
  const vip = join_(core, 'RSV', 'Vip', { password: 'vip' });
  const full = join_(core, 'RSV', 'Late', { password: 'vip' });
  results.reserved = { host: !!host.hello, second: !!second.hello, third: closedCode(third),
                       vip: !!vip.hello, full: closedCode(full) };
}

// --- the admin ---------------------------------------------------------------------
{
  const host = join_(quick, 'ADM', 'Host');
  const guest = join_(quick, 'ADM', 'Guest', { id: 'guest-browser-0001' });
  const other = join_(quick, 'ADM', 'Other');
  const room = quick.room('ADM');
  action(guest, { type: 'admin', cmd: 'kickPlayer', args: [host.hello.slot] });
  const refused = { hostStill: room.players.has(host.hello.slot),
                    told: rows(guest, 'chat').map(r => r.text) };
  action(host, { type: 'admin', cmd: 'serverMessage', args: ['Restart', 'in', 'five'] });
  const message = { guest: rows(guest, 'chat').at(-1), host: rows(host, 'chat').at(-1) };
  action(host, { type: 'admin', cmd: 'set', args: ['friendlyFire', 25] });
  action(host, { type: 'admin', cmd: 'set', args: ['gameTime', 20] });
  action(host, { type: 'admin', cmd: 'set', args: ['autoBalance', 1] });
  const live = { friendly: room.host.friendlyFire(), gameTime: room.authority.round.gameTime,
                 autoBalance: room.authority.rules.autoBalance,
                 settingsRow: rows(guest, 'settings').at(-1)?.settings?.gameTime };
  action(host, { type: 'admin', cmd: 'restartMap', args: [] });
  step(quick, 'ADM', 1);
  const restarted = rows(guest, 'restart').length;
  action(host, { type: 'admin', cmd: 'kickPlayer', args: [other.hello.slot] });
  const kicked = { code: closedCode(other), closed: other.closed, gone: !room.players.has(other.hello.slot),
                   line: rows(guest, 'chat').at(-1)?.text, leave: rows(guest, 'leave').length };
  action(host, { type: 'admin', cmd: 'banPlayer', args: ['Guest'] });
  const banned = { code: closedCode(guest) };
  const again = join_(quick, 'ADM', 'Guest');
  const renamed = join_(quick, 'ADM', 'Guest2', { id: 'guest-browser-0001' });
  const stranger = join_(quick, 'ADM', 'Stranger');
  banned.byName = closedCode(again);
  banned.byId = closedCode(renamed);
  banned.stranger = !!stranger.hello;
  action(host, { type: 'admin', cmd: 'clearBanList', args: [] });
  banned.cleared = !!join_(quick, 'ADM', 'Guest').hello;
  results.admin = { host: host.hello.admin, guest: guest.hello.admin, refused, message, live,
                    restarted, kicked, banned };
}

// --- the votes -----------------------------------------------------------------------
{
  results.needed = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16].map(n => [n, votesNeeded(n)]));
  results.voteConstants = { majority: VOTE_MAJORITY, time: VOTING_TIME, gap: VOTE_ISSUE_GAP };
  coin = 0;
  const peers = ['A', 'B', 'C', 'D', 'E', 'F'].map(name => join_(quick, 'VOT', name));
  const room = quick.room('VOT');
  const [a, b, c, d, e, f] = peers;
  const teams = peers.map(p => p.hello.team);
  const slot = p => p.hello.slot;
  // A kick vote on F: A issues it (and so votes yes).
  action(a, { type: 'vote', kind: 1, target: slot(f) });
  const issued = rows(c, 'vote').at(-1);
  // A second vote of the same type on another target while it runs.
  action(b, { type: 'vote', kind: 1, target: slot(e) });
  const busy = rows(b, 'chat').at(-1)?.text;
  // A no, a repeat (the first vote stands), then yes votes to the count.
  action(b, { type: 'vote', kind: 1, target: slot(f), option: 1 });
  action(b, { type: 'vote', kind: 1, target: slot(f), option: 0 });
  const afterNo = rows(c, 'vote').at(-1);
  action(c, { type: 'vote', kind: 1, target: slot(f) });
  action(d, { type: 'vote', kind: 1, target: slot(f) });
  step(quick, 'VOT', 1);
  const beforeLast = { stillIn: room.players.has(slot(f)), last: rows(c, 'vote').at(-1) };
  action(e, { type: 'vote', kind: 1, target: slot(f) });
  step(quick, 'VOT', 1);
  const passed = rows(c, 'vote').at(-1);
  const kick = { gone: !room.players.has(slot(f)), code: closedCode(f),
                 line: rows(c, 'chat').at(-1)?.text,
                 rejoin: closedCode(join_(quick, 'VOT', 'F')) };
  // A issued a kick vote under 180 s ago.
  action(a, { type: 'vote', kind: 1, target: slot(e) });
  const tooSoon = rows(a, 'chat').at(-1)?.text;
  // A map vote: outside the cycle, then one that runs out.
  action(b, { type: 'vote', kind: 0, target: 3 });
  const outside = rows(b, 'chat').at(-1)?.text;
  action(b, { type: 'vote', kind: 0, target: 0 });
  const mapIssued = rows(c, 'vote').at(-1);
  step(quick, 'VOT', 30 * 59);
  const mapRunning = rows(c, 'vote').at(-1).action;
  step(quick, 'VOT', 30 * 2);
  const mapFailed = rows(c, 'vote').at(-1);
  // A team kick: only the target's side counts and votes.
  const side = teams[0];
  const mates = peers.slice(0, 5).filter(p => p.hello.team === side);
  const foe = peers.slice(0, 5).find(p => p.hello.team !== side);
  action(mates[0], { type: 'vote', kind: 2, target: slot(mates[1]) });
  const teamIssued = rows(mates[1], 'vote').at(-1);
  const foeSaw = rows(foe, 'vote').some(r => r.kind === 2);
  action(foe, { type: 'vote', kind: 2, target: slot(mates[1]) });
  const foeTold = rows(foe, 'chat').at(-1)?.text;
  // Switched off by the admin.
  action(a, { type: 'admin', cmd: 'set', args: ['enableMapVote', 0] });
  action(c, { type: 'vote', kind: 0, target: 0 });
  const disabled = rows(c, 'chat').at(-1)?.text;
  results.votes = { teams, mates: mates.length, issued, busy, afterNo, beforeLast, passed, kick, tooSoon,
                    outside, mapIssued, mapRunning, mapFailed, teamIssued, foeSaw, foeTold, disabled };
}

// --- a passed map vote changes the level ----------------------------------------------
{
  const host = join_(quick, 'MAP', 'Host', { settings: { maps: [{ level: 'test' }, { level: 'second' }] } });
  const guest = join_(quick, 'MAP', 'Guest');
  const old = quick.room('MAP');
  action(host, { type: 'vote', kind: 0, target: 1 });
  action(guest, { type: 'vote', kind: 0, target: 1 });
  step(quick, 'MAP', 1);
  const change = rows(guest, 'levelChange').at(-1);
  const now = quick.room('MAP');
  const back = join_(quick, 'MAP', 'Host', { admin: host.hello.adminKey });
  const plain = join_(quick, 'MAP', 'Guest');
  results.mapVote = { passed: rows(guest, 'vote').at(-1), change, closed: guest.closed,
                      newRoom: now !== old, level: now.level(), oldEmpty: old.players.size,
                      adminBack: back.hello?.admin, guestAdmin: plain.hello?.admin,
                      mapIndex: back.hello?.mapIndex, maps: back.hello?.maps?.length };
}

// --- auto-balance on death ---------------------------------------------------------------
{
  // The coin puts the first on team 1; force three against one after.
  const off = ['A', 'B', 'C', 'D'].map(name => join_(quick, 'ABO', name));
  const roomOff = quick.room('ABO');
  const forced = (room, peers, teams) => peers.forEach((p, i) => {
    const c = room.players.get(p.hello.slot);
    c.team = teams[i]; room.world.player(p.hello.slot).team = teams[i];
  });
  forced(roomOff, off, [1, 1, 1, 2]);
  off.forEach(p => action(p, { type: 'spawn' }));
  step(quick, 'ABO', 2);
  action(off[0], { type: 'suicide' });
  step(quick, 'ABO', 2);
  const offResult = { team: roomOff.players.get(off[0].hello.slot).team,
                      killed: rows(off[1], 'killed').length };
  const on = ['A', 'B', 'C', 'D'].map((name, i) =>
    join_(quick, 'ABN', name, i === 0 ? { settings: { autoBalance: true } } : {}));
  const roomOn = quick.room('ABN');
  forced(roomOn, on, [1, 1, 1, 2]);
  on.forEach(p => action(p, { type: 'spawn' }));
  step(quick, 'ABN', 2);
  action(on[0], { type: 'suicide' });
  step(quick, 'ABN', 2);
  const moved = { team: roomOn.players.get(on[0].hello.slot).team,
                  world: roomOn.world.player(on[0].hello.slot).team,
                  row: rows(on[1], 'team').at(-1) };
  // Two against two now: a second death moves nobody.
  action(on[1], { type: 'suicide' });
  step(quick, 'ABN', 2);
  results.autoBalance = { off: offResult, moved, even: roomOn.players.get(on[1].hello.slot).team };
}

// --- the spawn time, the time limit ----------------------------------------------------------
{
  const host = join_(quick, 'SPN', 'Host', { settings: { spawnTime: 10, gameTime: 1 } });
  const room = quick.room('SPN');
  action(host, { type: 'spawn' });
  step(quick, 'SPN', 30);                       // the round's clock at 1 s
  action(host, { type: 'suicide' });
  step(quick, 'SPN', 1);
  const killed = rows(host, 'killed').at(-1);
  step(quick, 'SPN', 30 * 61);
  results.limits = { sw: killed?.sw, clockAtDeath: 1 + 1 / 30,
                     end: rows(host, 'roundEnd').at(-1)?.reason };
}

// --- the round count and the map list ------------------------------------------------------------
{
  const host = join_(quick, 'RND', 'Host', { settings: {
    numberOfRounds: 2, maps: [{ level: 'test' }, { level: 'second' }] } });
  const room = quick.room('RND');
  const endRound = r => { r.authority.round.endRound(1, null, 'test'); step(quick, 'RND', 30 * 10 + 3); };
  endRound(room);
  const first = { restarts: rows(host, 'restart').length, changes: rows(host, 'levelChange').length,
                  left: room.host.roundsLeft, same: quick.room('RND') === room };
  endRound(room);
  const second = { restarts: rows(host, 'restart').length, change: rows(host, 'levelChange').at(-1),
                   level: quick.room('RND').level(), closed: host.closed,
                   left: quick.room('RND').host.roundsLeft };
  // One level and its rounds used up: the rounds start over in place.
  const solo = join_(quick, 'ONE', 'Solo', { settings: { numberOfRounds: 1 } });
  const one = quick.room('ONE');
  one.authority.round.endRound(1, null, 'test');
  step(quick, 'ONE', 30 * 10 + 3);
  results.rounds = { first, second,
                     solo: { same: quick.room('ONE') === one, restarts: rows(solo, 'restart').length,
                             changes: rows(solo, 'levelChange').length,
                             won: { ...one.authority.round.roundsWon }, left: one.host.roundsLeft } };
}

console.log(JSON.stringify(results));
