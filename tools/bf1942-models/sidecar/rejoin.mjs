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
// requested side unless it forces auto-balance). It probes longer than
// retail's 180 s (a big mod level can take minutes to load before the server
// answers), backing off, and stops only on a real refusal: a kick or ban, a
// wrong server password, or a version mismatch.

import { EventEmitter } from 'node:events';

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

// What a drop means. A GameStatus 5 already seen makes any drop a level change
// (the retail client's flag is set by either), so a lost 0x19 datagram or a
// quiet timeout during the restart still rejoins with the digits.
export function classifyDisconnect(reason, { levelChange = null } = {}) {
  if (reason === DISCONNECT.KICKED) return 'kicked';
  if (reason === DISCONNECT.BANNED) return 'banned';
  if (reason === DISCONNECT.LEVEL_CHANGE || levelChange) return 'level-change';
  return 'drop';
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
    firstProbeMs = 3000,          // retail waits 16 s; the probe is one 8-byte datagram
    probeMs = 3000,               // retail's interval (0x004b6f60 sets 3.0 s)
    probeMaxMs = 15000,           // backoff cap, well inside the server's 180 s window
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
  // none). team: the side to ask for (0 = auto).
  start({ kind = 'drop', reason = null, password = '', team = 0 } = {}) {
    if (this.active) return false;
    this.kind = kind;
    this.reason = reason;
    this.password = kind === 'level-change' ? (password ?? '') : '';
    this.team = team ?? 0;
    this.attempts = 0;
    this.probes = 0;
    this.t0 = this.timers.now();
    this.delay = this.probeMs;
    if (kind === 'kicked' || kind === 'banned') { this._fail(kind, reason); return false; }
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
    this._schedule(this._nextDelay());
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
      const kind = classifyDisconnect(i?.reason);
      if (kind === 'kicked' || kind === 'banned') return this._fail(kind, i?.reason);
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
    const delayMs = this._nextDelay();
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
