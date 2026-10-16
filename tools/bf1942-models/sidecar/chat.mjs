// Text chat, both directions: the pieces a line travels in, putting them back
// together, and sending the page's own lines the way the retail client does.
//
// Read from bf1942_lnxded.static. A client and the server run the same
// StringManager, one per connection:
//
//   StringManager::say                  0x0815d250  addStringMsg(text, target, -1, false, false)
//   StringManager::addStringMsg         0x0815d280  queue a ChatMessage: at most 4 lines
//                                                   waiting (16 for the server's own), the
//                                                   text cut to 63 bytes (0x3f)
//   StringManager::updateSendStream     0x0815d3c0  one piece every 0.5 s: the next <= 15
//                                                   bytes of the line at the queue's head
//   ChatFragmentEvent::ChatFragmentEvent 0x08120d30 the piece: first = offset 0, team =
//                                                   (target == 0), noSender = msg+0x50,
//                                                   serverFlag = msg+0x51, sender, total
//   ChatFragmentEvent::serialize        0x08120e10  the wire (events.mjs ChatFragment)
//   StringManager::processReceivedEvent 0x0815d580  the receiver: a first piece opens the
//                                                   line, the rest append, the line is done
//                                                   when the count reaches the total; then
//                                                   game vtable +0x124 (handleChatMessage)
//   GameServer::handleChatMessage       0x08134a70  the server's relay (below)
//   GameServer::sayClient               0x08139ff0  a server line to one player: noSender
//                                                   and serverFlag both set, target 1 (all)
//
// The client sends the sender id as 0xff: the server ignores it and puts the
// connection's own player id there (processReceivedEvent's third argument,
// from handleGameEventManagerEvent 0x08136b17). A piece the receiver refuses
// (a first piece while a line is still open, a later one with no line open,
// or a line that would pass 64 bytes) returns false, and the server then puts
// the connection on its disconnect list (GameServer+0x4b8, the vector of
// DisconnectType, reason 0xd at 0x08136b27): a malformed chat kicks the
// client. So the sender below never interleaves two lines.
//
// The relay, handleChatMessage: for a player's line (no noSender, no
// serverFlag, a sender) the console gets `-- [Global] name: text`, or
// `-- [Axis] ` / `-- [Allies] ` for team chat, and the event log a `chat`
// event with `team` (the sender's side for team chat, 0 for all) and `text`.
// Then every connection with a player gets the line queued on its own
// StringManager (addStringMsg with the same target, sender and flags), except
// the sender's own connection (0x08134bd7: the receiver's id == the sender's)
// and, for team chat, any whose player is on another side (0x08134c0f). There
// is no alive test: the dead and the spawn screen hear it. The sender is never
// sent his own line, so a client draws its own chat itself.

export const CHAT_PIECE = 15;     // 0x08120d30: the piece length clamps at 0xf
export const CHAT_MAX = 63;       // 0x0815d280: strncpy of at most 0x3f bytes
export const CHAT_QUEUE = 4;      // 0x0815d280: 4 lines waiting (16 for the server's own)
export const CHAT_PIECE_MS = 500; // 0x0815d3c0: a piece when 0.5 s have passed since the last
export const CHAT_RECV_MAX = 0x40; // 0x0815d580: a line that would pass 64 bytes is refused

/** The line as the wire carries it: one byte a character (a character past
 *  latin1 becomes `?`), cut to 63. */
export function chatBytes(text) {
  const s = String(text ?? '').replace(/[^\x00-\xff]/gu, '?');
  return Buffer.from(s, 'latin1').subarray(0, CHAT_MAX);
}

/** The pieces of one line, as ChatFragment bodies, the retail client's own:
 *  the first carries the team flag, the sender (0xff, the server fills it in)
 *  and the whole length; each carries up to 15 bytes. */
export function chatFragments(text, { team = false, playerId = -1, noSender = false, serverFlag = false } = {}) {
  const bytes = chatBytes(text);
  const out = [];
  let at = 0;
  do {
    const n = Math.min(CHAT_PIECE, bytes.length - at);
    const piece = { first: at === 0, text: bytes.subarray(at, at + n).toString('latin1') };
    if (piece.first) Object.assign(piece, { team: !!team, noSender: !!noSender, serverFlag: !!serverFlag, playerId, total: bytes.length });
    out.push(piece);
    at += n;
  } while (at < bytes.length);
  return out;
}

/** The receiver, StringManager::processReceivedEvent: one line open at a time
 *  on a connection. `push(piece)` returns the finished line
 *  `{ pid, text, team, server }`, null while it is still in pieces, or
 *  `{ refused }` where the engine's receiver returns false. */
export class ChatAssembler {
  constructor() { this.open = false; this.parts = []; this.count = 0; this.total = 0; this.pid = -1; this.team = false; this.server = false; }

  reset() { this.open = false; this.parts = []; this.count = 0; }

  push(piece) {
    const bytes = Buffer.from(piece.text ?? '', 'latin1');
    if (this.open) {
      if (piece.first) return { refused: 'first piece while a line is open' };
      if (this.count + bytes.length > CHAT_RECV_MAX) return { refused: 'line longer than 64 bytes' };
      this.parts.push(bytes);
      this.count += bytes.length;
    } else {
      if (!piece.first) return { refused: 'a later piece with no line open' };
      this.open = true;
      this.parts = [bytes];
      this.count = bytes.length;
      this.total = piece.total ?? 0;
      this.pid = piece.noSender ? -1 : (piece.playerId ?? -1);
      this.team = !!piece.team;
      this.server = !!piece.noSender;
      this.serverFlag = !!piece.serverFlag;
    }
    if (this.count !== this.total) return null;
    this.open = false;
    const line = { pid: this.pid, text: Buffer.concat(this.parts).toString('latin1'), team: this.team, server: this.server };
    this.parts = [];
    return line;
  }
}

/** The sender, StringManager::addStringMsg + updateSendStream on one
 *  session: lines wait in a queue of four, the head goes out one piece every
 *  0.5 s, a line is finished before the next starts. `queue(name, body)` is
 *  the session's event outbox. */
export class ChatSender {
  constructor(session, { pieceMs = CHAT_PIECE_MS, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
    this.session = session;
    this.pieceMs = pieceMs;
    this.now = now;
    this.lines = [];          // [{ pieces, sent }]
    this.lastAt = -Infinity;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._timer = null;
  }

  /** Queue a line. False when four are already waiting (the engine drops it)
   *  or there is nothing to say. */
  say(text, { team = false } = {}) {
    if (!chatBytes(text).length) return false;
    if (this.lines.length >= CHAT_QUEUE) return false;
    this.lines.push({ pieces: chatFragments(text, { team }), sent: 0 });
    this.pump();
    if (!this._timer && this.lines.length) this._timer = this._setTimer(() => this.pump(), Math.max(20, this.pieceMs / 5));
    return true;
  }

  /** One piece if the half second has passed (updateSendStream). */
  pump() {
    const head = this.lines[0];
    if (!head) { this.stop(); return; }
    const t = this.now();
    if (t - this.lastAt < this.pieceMs) return;
    this.lastAt = t;
    this.session.queue('ChatFragment', head.pieces[head.sent++]);
    if (head.sent >= head.pieces.length) this.lines.shift();
    if (!this.lines.length) this.stop();
  }

  stop() { if (this._timer) { this._clearTimer(this._timer); this._timer = null; } }
}
