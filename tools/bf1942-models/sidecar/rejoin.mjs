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

// The heading the retail client puts on its disconnect box (BF1942.exe
// 0x006b42f0, the strings from lexiconAll.dat): a Disconnect whose message is
// not empty is shown under ERROR_KICKED_FROM_SERVER with the server's text
// (0x006b4367); otherwise the reason picks the line, ERROR_BANNED_FROM_SERVER
// for a ban and ERROR_DISCONNECT_FROM_SERVER for anything it does not name.
export const DISCONNECT_TITLE = {
  kicked: 'KICKED FROM SERVER',
  banned: 'BANNED FROM SERVER',
  closed: 'DISCONNECTED FROM SERVER',
  drop: 'DISCONNECTED FROM SERVER',
  'level-change': 'DISCONNECTED FROM SERVER',
};

// The refusal's own line, for a ConnectDenied (the lexicon's wording).
export const DENIAL_TEXT = {
  0x02: 'FAILED TO CONNECT TO SERVER! SERVER IS FULL!',
  0x11: 'This server requires password. Please try again!',
  0x16: 'BANNED FROM SERVER',
  0x17: 'VERSION DIFFERS FROM SERVER',
  0x18: 'VERSION DIFFERS FROM SERVER',
  0x1e: 'This server has reserved slots. Enter Reserved Password!',
};

// A server chat line that says one of `names` was kicked or banned: the
// engine's own "Player <name> was kicked from the server." and the lines a
// server manager (BFSM, bf42++) prints before it kicks. Server chat arrives
// with 0x80 for each space (the BFSM lines in the 2026-10-24 recordings), so
// both are read as spaces. Returns { banned, text } or null.
export function kickNoticeFor(text, names = []) {
  if (typeof text !== 'string' || !text) return null;
  const line = text.replace(/\u0080/g, ' ').replace(/^\*+/, '').replace(/\s+/g, ' ').trim();
  if (!/\b(kicked|kicking|banned|banning)\b/i.test(line)) return null;
  // A warning ("... or you will be kicked") is not the kick.
  if (/\bwill\b|\bwarn/i.test(line)) return null;
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
// kick line the server's chat carried, if any.
export function describeDisconnect({ kind, reason = null, name = '', message = '', notice = null }) {
  const text = (message && message.trim()) || notice?.text || '';
  const title = text && kind !== 'banned' ? DISCONNECT_TITLE.kicked : (DISCONNECT_TITLE[kind] ?? DISCONNECT_TITLE.closed);
  return { kind, reason, name, title, text, final: !rejoinable(kind) };
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
