package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/chat.mjs; keep in step.
//
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

const val CHAT_PIECE = 15     // 0x08120d30: the piece length clamps at 0xf
const val CHAT_MAX = 63       // 0x0815d280: strncpy of at most 0x3f bytes
const val CHAT_QUEUE = 4      // 0x0815d280: 4 lines waiting (16 for the server's own)
const val CHAT_PIECE_MS = 500 // 0x0815d3c0: a piece when 0.5 s have passed since the last
const val CHAT_RECV_MAX = 0x40 // 0x0815d580: a line that would pass 64 bytes is refused

/** A ChatFragment body (events.mjs's object): `team` .. `total` are set on a
 *  first piece only (null elsewhere, where the Node object has no key). */
data class ChatPiece(
  val first: Boolean,
  val text: String,
  val team: Boolean? = null,
  val noSender: Boolean? = null,
  val serverFlag: Boolean? = null,
  val playerId: Int? = null,
  val total: Int? = null,
) {
  fun toJs(): Map<String, Any?> = linkedMapOf<String, Any?>("first" to first, "text" to text).also { m ->
    if (first) {
      m["team"] = team ?: Undefined; m["noSender"] = noSender ?: Undefined; m["serverFlag"] = serverFlag ?: Undefined
      m["playerId"] = playerId ?: Undefined; m["total"] = total ?: Undefined
    }
  }
}

/** A finished line: { pid, text, team, server }, or a refusal. */
data class ChatLine(val pid: Int = -1, val text: String = "", val team: Boolean = false, val server: Boolean = false, val refused: String? = null) {
  fun toJs(): Map<String, Any?> =
    if (refused != null) linkedMapOf("refused" to refused)
    else linkedMapOf("pid" to pid, "text" to text, "team" to team, "server" to server)
}

/** The line as the wire carries it: one byte a character (a character past
 *  latin1 becomes `?`), cut to 63. */
fun chatBytes(text: String?): ByteArray {
  // /[^\x00-\xff]/gu: a code point, so a surrogate pair is one '?'.
  val s = text ?: ""
  val sb = StringBuilder()
  var i = 0
  while (i < s.length) {
    val cp = s.codePointAt(i)
    sb.append(if (cp > 0xff) '?' else cp.toChar())
    i += Character.charCount(cp)
  }
  val b = latin1(sb.toString())
  return if (b.size > CHAT_MAX) b.copyOf(CHAT_MAX) else b
}

/** The pieces of one line, as ChatFragment bodies, the retail client's own:
 *  the first carries the team flag, the sender (0xff, the server fills it in)
 *  and the whole length; each carries up to 15 bytes. */
fun chatFragments(text: String?, team: Boolean = false, playerId: Int = -1, noSender: Boolean = false, serverFlag: Boolean = false): List<ChatPiece> {
  val bytes = chatBytes(text)
  val out = mutableListOf<ChatPiece>()
  var at = 0
  do {
    val n = minOf(CHAT_PIECE, bytes.size - at)
    val t = String(bytes, at, n, Charsets.ISO_8859_1)
    out += if (at == 0) ChatPiece(true, t, team, noSender, serverFlag, playerId, bytes.size) else ChatPiece(false, t)
    at += n
  } while (at < bytes.size)
  return out
}

/** The receiver, StringManager::processReceivedEvent: one line open at a time
 *  on a connection. `push(piece)` returns the finished line
 *  `{ pid, text, team, server }`, null while it is still in pieces, or
 *  `{ refused }` where the engine's receiver returns false. */
class ChatAssembler {
  var open = false; private set
  private var parts = mutableListOf<ByteArray>()
  private var count = 0
  private var total = 0
  private var pid = -1
  private var team = false
  private var server = false
  private var serverFlag = false

  fun reset() { open = false; parts = mutableListOf(); count = 0 }

  fun push(piece: ChatPiece): ChatLine? {
    val bytes = latin1(piece.text)
    if (open) {
      if (piece.first) return ChatLine(refused = "first piece while a line is open")
      if (count + bytes.size > CHAT_RECV_MAX) return ChatLine(refused = "line longer than 64 bytes")
      parts.add(bytes)
      count += bytes.size
    } else {
      if (!piece.first) return ChatLine(refused = "a later piece with no line open")
      open = true
      parts = mutableListOf(bytes)
      count = bytes.size
      total = piece.total ?: 0
      pid = if (piece.noSender == true) -1 else (piece.playerId ?: -1)
      team = piece.team == true
      server = piece.noSender == true
      serverFlag = piece.serverFlag == true
    }
    if (count != total) return null
    open = false
    val all = java.io.ByteArrayOutputStream().also { o -> parts.forEach { o.write(it) } }.toByteArray()
    val line = ChatLine(pid, String(all, Charsets.ISO_8859_1), team, server)
    parts = mutableListOf()
    return line
  }
}

/** The sender, StringManager::addStringMsg + updateSendStream on one
 *  session: lines wait in a queue of four, the head goes out one piece every
 *  0.5 s, a line is finished before the next starts. `queue(name, body)` is
 *  the session's event outbox. */
class ChatSender(
  private val queue: (name: String, body: ChatPiece) -> Unit,
  private val timers: Timers,
  private val pieceMs: Double = CHAT_PIECE_MS.toDouble(),
) {
  private class Line(val pieces: List<ChatPiece>, var sent: Int = 0)
  private val lines = ArrayDeque<Line>()
  private var lastAt = Double.NEGATIVE_INFINITY
  private var timer: Any? = null

  /** Queue a line. False when four are already waiting (the engine drops it)
   *  or there is nothing to say. */
  fun say(text: String?, team: Boolean = false): Boolean {
    if (chatBytes(text).isEmpty()) return false
    if (lines.size >= CHAT_QUEUE) return false
    lines.addLast(Line(chatFragments(text, team = team)))
    pump()
    if (timer == null && lines.isNotEmpty()) timer = timers.setInterval(maxOf(20.0, pieceMs / 5)) { pump() }
    return true
  }

  /** One piece if the half second has passed (updateSendStream). */
  fun pump() {
    val head = lines.firstOrNull()
    if (head == null) { stop(); return }
    val t = timers.now().toDouble()
    if (t - lastAt < pieceMs) return
    lastAt = t
    queue("ChatFragment", head.pieces[head.sent++])
    if (head.sent >= head.pieces.size) lines.removeFirst()
    if (lines.isEmpty()) stop()
  }

  fun stop() { if (timer != null) { timers.clear(timer); timer = null } }
}
