// Surviving a level change the way the retail client does
// (features/udp-sidecar/wire.md §29; ledger RECON-1..RECON-8).
//
// A dedicated server does not load the next level in place: at the end of a
// level's last round it restarts its own process. What carries the players
// across is a reconnect password and a count of reserved "reconnect slots":
//
//   1. GameServer::gameStatusFirstEndGame 0x08152a60 (the last round ends, or
//      an admin restart set GameServer+0x467) rolls four random digits,
//      Game::setReconnectPassword (vslot 0x11c), sets numReconnectSlots
//      (GameServer+0x4cc) to the number of client connections, and sends
//      every client GameStatus 5 whose five raw bytes are those four digits
//      and a NUL and whose text is the next level's mod (Setup::
//      nextLevelInMaplist 0x080bff80 entry +8; GameStatusEvent ctor
//      0x0815b490 copies 4 bytes, NUL, and up to 31 of text).
//   2. After the end-of-round delay gameStatusEndGame 0x08152ca0 sends the
//      same GameStatus 5 again, closes every connection with reason 0x19, and
//      Setup::restartBf1942exe 0x080c7290 execs the server with
//      "+hostServer 1 +reconnectPassword NNNN +reconnectSlots N".
//   3. The new process's GameServer::startServer 0x08133330 hands both to
//      NetServer::setReconnectPassword 0x08434890, which also arms a 180 s
//      window (NetServer+0x104 = 180000 ms); _updateConnections 0x08433af0
//      counts it down and zeroes the slots when it runs out.
//   4. NetServer::handleConnectRequest 0x08436810: while slots remain, a
//      ConnectRequest whose bytes [80..83] match the password
//      (checkReconnectPassword 0x08436750, four bytes) takes a slot and is
//      admitted while connections < max; anyone else is refused ServerIsFull
//      (2) once connections + slots left reach max. So on a full server only
//      the previous level's players get back in during the window.
//
// The retail client (BF1942.exe): its event switch 0x004933d0, case 0x24,
// on status 5 sets the wait flag (+0x248), stores the four digits with
// Game::setReconnectPassword (vslot 0x11c) and the mod (0x004444c0). Its
// receive loop 0x004957d0 sets the same flag on disconnect reason 0x19 and
// then shows no "disconnected" box. While the flag is up, 0x0048ff90 polls
// the server with a ServerInfoRequest (0x004b7030): first after 16 s, then
// every 3 s, for at most 180 s; on an answer it relaunches itself (0x006b4130
// -> 0x00454dd0, CreateProcessA after Sleep(2000)) with "+game <mod>
// +restart 1 +joinServer <addr> +isInternet N +reconnectPassword NNNN", and
// the new process's connect (0x0060f7d0 -> 0x0060f300) writes the digits into
// the ConnectRequest. Nothing else crosses: neither process keeps a player's
// team, kit or score, and the client asks for team 0 (auto) as on any join.
//
// The sidecar keeps its process, its page socket and its recording, so it
// does the same thing in place: recognise the restart (reason 0x19, or any
// drop after a GameStatus 5), wait for the server with the retail probe, join
// with the digits, and ask for the team it had (the server honours a
// requested side unless it forces auto-balance). It probes on the client's
// own schedule: bf42++'s 1 s then every 2 s, the retail 16 s when the server
// sent UI&nfr (bf42++ keeps its 2 s interval then), or 16 s / 3 s for a retail
// identity (plus.mjs restartTiming, wire.md §30). It probes longer than the
// client's 180 s (a big mod level can take minutes to load before the server
// answers), and stops only on a real refusal: a kick or ban (or any close the
// server chose, classifyDisconnect below), a wrong server
// password, or a version mismatch.

import { EventEmitter } from 'node:events';
import { PLUS_RESTART } from './plus.mjs';

// The disconnect reasons the server sends (Disconnect datagram [8], u32).
export const DISCONNECT = {
  TIMEOUT: 0x0a,      // PRTimeOut; also the sidecar's own quiet watchdog (session.mjs)
  LEFT: 0x0d,         // PRDisconnect: the client left (handleGameEventManagerEvent 0x08135cb0)
  KICKED: 0x15,       // GameServer::kickPlayers 0x08148b20, key not banned
  BANNED: 0x16,       // the same, isKeyBanned (vslot 0x380) true
  LEVEL_CHANGE: 0x19, // gameStatusEndGame 0x08152ca0, before the restart
};

// ConnectDenied reasons that no amount of waiting changes. ServerIsFull (2)
// is not one of them: during the reconnect window a fresh join is refused
// with it while the slots are held, and a slot frees when anyone leaves.
// 0x1e is the same full-server answer when reserved slots exist.
const FINAL_DENIALS = new Set([
  0x11, // PRInvalidPassword: the server password
  0x16, // the address is banned (handleConnectRequest's ban list)
  0x17, // VersionTooOld
  0x18, // VersionTooNew
]);

export function denialIsFinal(reason) { return FINAL_DENIALS.has(reason); }

// What a drop means, and whether getting back on is ours to do.
//
// Only two kinds rejoin: a level change (the server restarts itself and holds
// a reconnect slot for us, RECON-1..RECON-8) and a drop (the session's own
// quiet watchdog, or the server's PRTimeOut: a network that went away, a
// server that crashed). Everything else is the server choosing to end this
// connection, and a client that comes straight back is getting round the
// server's rules: a kick (0x15) or a ban (0x16) from GameServer::kickPlayers
// 0x08148b20, which every kick path runs through (an admin's or BFSM's
// admin.kickPlayer, a won kick vote, TKPunish 0x081593d0, a CD-key refusal,
// PunkBuster), the server closing us for a malformed packet
// (processReceivedPackets), or any reason we do not know. A drop that the
// server's own chat announced as a kick a moment before (kickPlayers says
// "Player %s was kicked from the server." to everyone, through
// GameServer::say vslot 0x464, before the Disconnect; BFSM and bf42++ servers
// announce theirs the same way) is a kick too, whatever datagram followed.
//
// A GameStatus 5 already seen makes any other drop a level change (the retail
// client's flag is set by either), so a lost 0x19 datagram or a quiet timeout
// during the restart still rejoins with the digits.
export function classifyDisconnect(reason, { levelChange = null, kickNotice = null } = {}) {
  if (reason === DISCONNECT.KICKED) return 'kicked';
  if (reason === DISCONNECT.BANNED) return 'banned';
  if (reason === DISCONNECT.LEVEL_CHANGE || levelChange) return 'level-change';
  if (kickNotice) return kickNotice.banned ? 'banned' : 'kicked';
  if (reason === DISCONNECT.TIMEOUT) return 'drop';
  return 'closed';
}

// Whether the sidecar may get back on by itself after a disconnect of this kind.
export function rejoinable(kind) { return kind === 'level-change' || kind === 'drop'; }

// What the retail client's disconnect box says (ledger RECON-11). Its receive
// loop (BF1942.exe 0x004957d0) turns the Disconnect's reason into a box code
// through the jump table at 0x00495cac/0x00495cd8: 0x13 -> 3, 0x14 -> 2,
// 0x15 -> 4, 0x16 -> 5, 0x1a -> 9, 0x1b -> 10 (0x00495b1a..0x00495b85); 0x19
// raises the level-change wait instead (0x00495b07) and shows no box; every
// other reason (0x0a, 0x0d, ...) leaves the code 0. When the connection drops,
// 0x00490f00 fetches the server's text (connection vt+0x6c, kept at +0x174)
// and calls the box 0x006b42f0 (through 0x006b4b30) with (code, text) when
// the code is not 0, else with (1, "") (0x00490f6d..0x00490fa5), so the text
// of a code-0 close is never shown. The box puts any non-empty text under
// ERROR_KICKED_FROM_SERVER (0x006b4367), whatever the code; with no text its
// switch on the code picks the line (table 0x006b44e0). The English lines are
// Mods/bf1942/lexiconAll.dat's.
const BOX_CODE = { 0x13: 3, 0x14: 2, 0x15: 4, 0x16: 5, 0x1a: 9, 0x1b: 10 };
const BOX_LINE = {
  2: ['ERROR_INVALID_CD_KEY', 'INVALID CD KEY'],      // reason 0x14
  3: ['ERROR_CD_KEY_IN_USE', 'CD KEY IN USE'],        // reason 0x13
  4: ['ERROR_KICKED_FROM_SERVER', 'KICKED FROM SERVER'],
  5: ['ERROR_BANNED_FROM_SERVER', 'BANNED FROM SERVER'],
  10: ['ERROR_MESSAGE_DATA_DIFFERS', 'DATA DIFFERS FROM SERVER'], // reason 0x1b
};
const BOX_DEFAULT = ['ERROR_DISCONNECT_FROM_SERVER', 'DISCONNECTED FROM SERVER'];

// The box retail shows for a Disconnect: { key, title, text }, `title` the
// lexicon line and `text` the server's message when retail shows it. null for
// a level change (0x19), which shows no box.
export function retailDisconnectBox(reason, message = '') {
  if (reason === DISCONNECT.LEVEL_CHANGE) return null;
  const code = BOX_CODE[reason] ?? 0;
  const said = code && typeof message === 'string' && message.length ? message : '';
  const [key, title] = said ? BOX_LINE[4] : (BOX_LINE[code] ?? BOX_DEFAULT);
  return { key, title, text: said };
}

// The line for each kind of end, when there is no reason code to go by (the
// rejoiner giving up). A kick and a ban are the box's codes 4 and 5.
export const DISCONNECT_TITLE = {
  kicked: BOX_LINE[4][1],
  banned: BOX_LINE[5][1],
  closed: BOX_DEFAULT[1],
  drop: BOX_DEFAULT[1],
  'level-change': BOX_DEFAULT[1],
};

// A ConnectDenied. The connect (0x00490bd0, the +0x144 object's vt+0x64)
// returns 2 for PRInvalidPassword (0x11), 3 for PRInvalidReservedPassword
// (0x1e), 4 for VersionTooOld (0x17), 5 for VersionTooNew (0x18), 6 for
// PRServerIsFull (2) and 0 for anything else, a banned address (0x16)
// included (0x00490d23..0x00490d8c). The join that called it sets the menu
// object's Password/ShowPassword (+0x8) or Join/ShowFailedToJoin (+0x44),
// bound by name at 0x006b3b8b / 0x006b3bf9, and menu/LoadMenu picks the box
// by value. A join from the server list (0x0044eedb): 2 -> ShowPassword 2,
// 3 -> ShowPassword 3, 4 -> ShowFailedToJoin 2, 6 -> 4, else 1
// (0x0044ef54..0x0044efb0). A join from the password box, with a password
// typed (0x0044f062): 2 -> ShowPassword 1, 4 and 6 as before, else 1, the
// reserved password included (0x0044f094..0x0044f0d3). LoadMenu's lines:
// ShowPassword 1 PASSWORD_INVALID, 2 PASSWORD_INVALID_FIRST_ATTEMPT, 3 no
// line (the PASSWORD box alone; RESERVED_PASSWORD_INVALID is in the lexicon
// but no vanilla menu shows it); ShowFailedToJoin 1 CONFIRMATION_FAILED_TO_CONNECT
// under CONFIRMATION_ERROR, 2 CONFIRMATION_FAILED_TO_CONNECT_OLD_VERSION under
// CONFIRMATION_ERROR, 4 CONFIRMATION_FAILED_TO_CONNECT_SERVER_FULL under
// CONFIRMATION_WARNING. `retry` is the password-box join.
const FAILED = { key: 'CONFIRMATION_FAILED_TO_CONNECT', title: 'ERROR', text: 'FAILED TO CONNECT TO SERVER' };
export function retailDenial(reason, { retry = false } = {}) {
  switch (reason) {
    case 0x02: return { key: 'CONFIRMATION_FAILED_TO_CONNECT_SERVER_FULL', title: 'WARNING', text: 'FAILED TO CONNECT TO SERVER! SERVER IS FULL!' };
    case 0x11: return retry
      ? { key: 'PASSWORD_INVALID', title: 'PASSWORD', text: 'This server requires password. Please try again!' }
      : { key: 'PASSWORD_INVALID_FIRST_ATTEMPT', title: 'PASSWORD', text: 'This server requires password.' };
    case 0x1e: return retry ? FAILED : { key: null, title: 'PASSWORD', text: '' };
    case 0x17: return { key: 'CONFIRMATION_FAILED_TO_CONNECT_OLD_VERSION', title: 'ERROR', text: 'WRONG VERSION! DO YOU WANT TO UPDATE?' };
    default: return FAILED;
  }
}

// The refusal's line for the sidecar's own join, which is retail's join from
// the server list (retailDenial without `retry`), for every reason a server
// sends.
export const DENIAL_TEXT = Object.fromEntries([0x02, 0x11, 0x16, 0x17, 0x18, 0x1e].map((r) => [r, retailDenial(r).text]));

// A server chat line that says one of `names` was kicked or banned: the
// engine's own "Player <name> was kicked from the server." and the lines a
// server manager (BFSM, bf42++) prints before it kicks. Server chat arrives
// with 0x80 for each space (the BFSM lines in the 2026-10-24 recordings), so
// both are read as spaces. Returns { banned, text } or null.
export function kickNoticeFor(text, names = []) {
  if (typeof text !== 'string' || !text) return null;
  const line = text.replace(/\u0080/g, ' ').replace(/^\*+/, '').replace(/\s+/g, ' ').trim();
  if (!/\b(kicked|kicking|banned|banning)\b/i.test(line)) return null;
  // A warning ("... or you will be kicked", "X was warned for teamkilling")
  // is not the kick. A line that says the kick happened ("was kicked",
  // "Kicking X") is, whatever else it says: a server manager's kick after
  // the last warning reads "X was kicked (warning 3)", and a count after
  // "warning" is that tally, not a warning.
  const done = /\b(?:was|were|been|got|being) (?:kicked|banned)\b|\b(?:kicking|banning)\b/i;
  const pending = /\bwill\b|'ll\b|\b(?:be|get|gets) (?:kicked|banned)\b|\bwarn(?:s|ed)?\b|\bwarning\b(?! ?[0-9])/i;
  if (!done.test(line) && pending.test(line)) return null;
  const low = line.toLowerCase();
  const named = names.filter((n) => typeof n === 'string' && n.trim())
    .some((n) => {
      const at = low.indexOf(n.trim().toLowerCase());
      if (at < 0) return false;
      // The whole name: "skandia" is not "skandia-sc_1"'s owner.
      const before = at > 0 ? low[at - 1] : undefined;
      const after = low[at + n.trim().length];
      const part = (c) => c !== undefined && /[a-z0-9_\-]/.test(c);
      return !part(before) && !part(after);
    });
  if (!named) return null;
  return { banned: /\bban(ned|ning)\b/i.test(line), text: line };
}

// Everything the page needs to say why the server ended the session.
// `message` is the Disconnect datagram's text (the server's player+0x19c,
// set by kickPlayer(int, const char*); empty for a plain kick), `notice` the
// kick line the server's chat carried, if any. `title` and `text` are what
// retail's box would show for this reason and message (retailDisconnectBox);
// the chat line goes in `notice`, since retail's box never shows it. A drop
// the chat called a kick is a kick for the sidecar (it does not rejoin), and
// retail, seeing only the drop, says DISCONNECTED FROM SERVER.
export function describeDisconnect({ kind, reason = null, name = '', message = '', notice = null }) {
  const box = retailDisconnectBox(reason, message) ?? { title: DISCONNECT_TITLE[kind] ?? DISCONNECT_TITLE.closed, text: '' };
  return { kind, reason, name, title: box.title, text: box.text, notice: notice?.text ?? '', final: !rejoinable(kind) };
}

// GameStatus 5's tail (events.mjs: 5 raw bytes, u8 length, text): the four
// reconnect digits NUL-terminated, and the next level's mod.
export function reconnectFromGameStatus(ev) {
  if (!ev || ev.status !== 5 || !ev.extra) return null;
  const raw = Buffer.from(ev.extra);
  const n = raw.indexOf(0);
  const password = raw.subarray(0, n < 0 ? Math.min(4, raw.length) : Math.min(n, 4)).toString('latin1');
  return { password, mod: ev.text ?? '' };
}

const realTimers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t),
};

// The rejoin state machine. `connect({reconnectPassword, team})` starts a
// session and returns it (an emitter of connected / joined / denied /
// disconnected, with close()); `probe()` resolves truthy when the server
// answers a ServerInfoRequest. Timers and the clock are injectable, so the
// test drives it with a fake session and a fake clock.
//
// States: idle -> waiting (probing) -> connecting -> idle (rejoined)
//                                                 \-> waiting (refused full, timed out)
//         any -> failed (a final refusal, or the horizon passed)
//
// Emits: probe {n, up}, attempt {n, reconnectPassword, team}, retry {why,
// delayMs}, rejoined {attempts, elapsedMs, usedKey}, give-up {why, reason}.
export class Rejoiner extends EventEmitter {
  constructor({
    connect, probe, timers = realTimers,
    horizonMs = 10 * 60 * 1000,   // keep trying this long after the drop
    // The client's pinger (plus.mjs): bf42++'s by default; `start` takes the
    // timing the dropped session's server allowed. Probes are evenly spaced,
    // as both clients space them; only a refused or failed attempt backs off.
    firstProbeMs = PLUS_RESTART.firstProbeMs,
    probeMs = PLUS_RESTART.probeMs,
    probeMaxMs = 15000,           // retry backoff cap, well inside the server's 180 s window
    backoff = 1.5,
    connectTimeoutMs = 10000,     // no ConnectAccept: the server went away again
    joinTimeoutMs = 90000,        // accepted, but no Simulation event (a stalled database)
  } = {}) {
    super();
    Object.assign(this, { connect, probe, timers, horizonMs, firstProbeMs, probeMs, probeMaxMs, backoff, connectTimeoutMs, joinTimeoutMs });
    this.state = 'idle';
    this._timer = null;
    this._attemptTimer = null;
    this._session = null;
  }

  get active() { return this.state === 'waiting' || this.state === 'connecting'; }

  // kind: classifyDisconnect's answer. password: the GameStatus 5 digits ('' if
  // none). team: the side to ask for (0 = auto). timing: {firstProbeMs,
  // probeMs} for this wait (Session.restartTiming()), else the constructor's.
  start({ kind = 'drop', reason = null, password = '', team = 0, timing = null } = {}) {
    if (this.active) return false;
    if (!this._defaultTiming) this._defaultTiming = { firstProbeMs: this.firstProbeMs, probeMs: this.probeMs };
    const t = timing ?? this._defaultTiming;
    this.firstProbeMs = t.firstProbeMs;
    this.probeMs = t.probeMs;
    this.timing = { firstProbeMs: t.firstProbeMs, probeMs: t.probeMs };
    this.kind = kind;
    this.reason = reason;
    this.password = kind === 'level-change' ? (password ?? '') : '';
    this.team = team ?? 0;
    this.attempts = 0;
    this.probes = 0;
    this.t0 = this.timers.now();
    this.delay = this.probeMs;
    if (!rejoinable(kind)) { this._fail(kind, reason); return false; }
    this.state = 'waiting';
    this._schedule(this.firstProbeMs);
    return true;
  }

  stop() {
    this._clearTimers();
    this._dropSession();
    if (this.active) this.state = 'idle';
  }

  _schedule(ms) {
    this.timers.clear(this._timer);
    this._timer = this.timers.set(() => this._probeTick(), ms);
  }

  _elapsed() { return this.timers.now() - this.t0; }

  async _probeTick() {
    if (this.state !== 'waiting') return;
    if (this._elapsed() > this.horizonMs) return this._fail('horizon', null);
    this.probes++;
    let up = null;
    try { up = await this.probe(); } catch { up = null; }
    if (this.state !== 'waiting') return;
    this.emit('probe', { n: this.probes, up: !!up });
    if (up) return this._attempt();
    this._schedule(this.probeMs);
  }

  _nextDelay() {
    const d = this.delay;
    this.delay = Math.min(this.probeMaxMs, Math.round(this.delay * this.backoff));
    return d;
  }

  _attempt() {
    this.state = 'connecting';
    this.attempts++;
    const opts = { reconnectPassword: this.password, team: this.team };
    this.emit('attempt', { n: this.attempts, ...opts });
    let s;
    try { s = this.connect(opts); } catch (e) { return this._retry(`connect threw: ${e.message}`); }
    this._session = s;
    this._armAttempt(this.connectTimeoutMs, 'no ConnectAccept');
    const mine = () => this._session === s && this.state === 'connecting';
    s.on('connected', () => { if (mine()) this._armAttempt(this.joinTimeoutMs, 'join did not complete'); });
    s.on('joined', (info) => {
      if (!mine()) return;
      this._clearTimers();
      this._session = null; // the caller owns it now
      this.state = 'idle';
      const usedKey = !!this.password;
      this.password = '';   // one level's digits; the next restart rolls new ones
      this.emit('rejoined', { attempts: this.attempts, elapsedMs: this._elapsed(), usedKey, info });
    });
    s.on('denied', (i) => {
      if (!mine()) return;
      if (denialIsFinal(i?.reason)) return this._fail('denied', i?.reason);
      this._retry(`denied ${i?.name ?? i?.reason}`);
    });
    s.on('disconnected', (i) => {
      if (!mine()) return;
      // The server ending the attempt on purpose (a kick, a ban, any reason
      // but a timeout) is as final here as on a live session.
      const kind = classifyDisconnect(i?.reason);
      if (!rejoinable(kind)) return this._fail(kind, i?.reason);
      this._retry(`disconnected ${i?.name ?? i?.reason} before the join completed`);
    });
  }

  _armAttempt(ms, why) {
    this.timers.clear(this._attemptTimer);
    this._attemptTimer = this.timers.set(() => { if (this.state === 'connecting') this._retry(why); }, ms);
  }

  _retry(why) {
    this.timers.clear(this._attemptTimer); this._attemptTimer = null;
    this._dropSession();
    if (this._elapsed() > this.horizonMs) return this._fail('horizon', null);
    this.state = 'waiting';
    const delayMs = this._nextDelay(); // first retry after one interval, then longer
    this.emit('retry', { why, delayMs, attempts: this.attempts });
    this._schedule(delayMs);
  }

  _fail(why, reason) {
    this._clearTimers();
    this._dropSession();
    this.state = 'failed';
    this.emit('give-up', { why, reason, attempts: this.attempts ?? 0, elapsedMs: this.t0 != null ? this._elapsed() : 0 });
  }

  _dropSession() {
    const s = this._session;
    this._session = null;
    if (s) { try { s.close(); } catch { /* already closed */ } }
  }

  _clearTimers() {
    this.timers.clear(this._timer); this._timer = null;
    this.timers.clear(this._attemptTimer); this._attemptTimer = null;
  }
}
