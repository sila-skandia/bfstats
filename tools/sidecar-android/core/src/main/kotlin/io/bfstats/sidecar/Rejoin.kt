package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/rejoin.mjs; keep in step.
//
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

// The disconnect reasons the server sends (Disconnect datagram [8], u32).
object DISCONNECT {
  const val TIMEOUT = 0x0aL      // PRTimeOut; also the sidecar's own quiet watchdog (session.mjs)
  const val LEFT = 0x0dL         // PRDisconnect: the client left (handleGameEventManagerEvent 0x08135cb0)
  const val KICKED = 0x15L       // GameServer::kickPlayers 0x08148b20, key not banned
  const val BANNED = 0x16L       // the same, isKeyBanned (vslot 0x380) true
  const val LEVEL_CHANGE = 0x19L // gameStatusEndGame 0x08152ca0, before the restart
  fun toJs(): Map<String, Any?> = linkedMapOf("TIMEOUT" to TIMEOUT, "LEFT" to LEFT, "KICKED" to KICKED, "BANNED" to BANNED, "LEVEL_CHANGE" to LEVEL_CHANGE)
}

// ConnectDenied reasons that no amount of waiting changes. ServerIsFull (2)
// is not one of them: during the reconnect window a fresh join is refused
// with it while the slots are held, and a slot frees when anyone leaves.
// 0x1e is the same full-server answer when reserved slots exist.
private val FINAL_DENIALS = setOf(
  0x11L, // PRInvalidPassword: the server password
  0x16L, // the address is banned (handleConnectRequest's ban list)
  0x17L, // VersionTooOld
  0x18L, // VersionTooNew
)

fun denialIsFinal(reason: Long?): Boolean = reason != null && reason in FINAL_DENIALS

/** kickNoticeFor's answer. */
data class KickNotice(val banned: Boolean, val text: String) {
  fun toJs(): Map<String, Any?> = linkedMapOf("banned" to banned, "text" to text)
}

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
// `levelChange` is truthy-tested as the Node copy tests it: any non-null value.
fun classifyDisconnect(reason: Long?, levelChange: Any? = null, kickNotice: KickNotice? = null): String {
  if (reason == DISCONNECT.KICKED) return "kicked"
  if (reason == DISCONNECT.BANNED) return "banned"
  if (reason == DISCONNECT.LEVEL_CHANGE || (levelChange != null && levelChange != false)) return "level-change"
  if (kickNotice != null) return if (kickNotice.banned) "banned" else "kicked"
  if (reason == DISCONNECT.TIMEOUT) return "drop"
  return "closed"
}

// Whether the sidecar may get back on by itself after a disconnect of this kind.
fun rejoinable(kind: String?): Boolean = kind == "level-change" || kind == "drop"

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
private val BOX_CODE = mapOf(0x13L to 3, 0x14L to 2, 0x15L to 4, 0x16L to 5, 0x1aL to 9, 0x1bL to 10)
private val BOX_LINE = mapOf(
  2 to listOf("ERROR_INVALID_CD_KEY", "INVALID CD KEY"),      // reason 0x14
  3 to listOf("ERROR_CD_KEY_IN_USE", "CD KEY IN USE"),        // reason 0x13
  4 to listOf("ERROR_KICKED_FROM_SERVER", "KICKED FROM SERVER"),
  5 to listOf("ERROR_BANNED_FROM_SERVER", "BANNED FROM SERVER"),
  10 to listOf("ERROR_MESSAGE_DATA_DIFFERS", "DATA DIFFERS FROM SERVER"), // reason 0x1b
)
private val BOX_DEFAULT = listOf("ERROR_DISCONNECT_FROM_SERVER", "DISCONNECTED FROM SERVER")

// The box retail shows for a Disconnect: { key, title, text }, `title` the
// lexicon line and `text` the server's message when retail shows it. null for
// a level change (0x19), which shows no box.
fun retailDisconnectBox(reason: Long?, message: String? = ""): Map<String, Any?>? {
  if (reason == DISCONNECT.LEVEL_CHANGE) return null
  val code = BOX_CODE[reason] ?: 0
  val said = if (code != 0 && message != null && message.isNotEmpty()) message else ""
  val (key, title) = if (said.isNotEmpty()) BOX_LINE.getValue(4) else (BOX_LINE[code] ?: BOX_DEFAULT)
  return linkedMapOf("key" to key, "title" to title, "text" to said)
}

// The line for each kind of end, when there is no reason code to go by (the
// rejoiner giving up). A kick and a ban are the box's codes 4 and 5.
val DISCONNECT_TITLE: Map<String, String> = linkedMapOf(
  "kicked" to BOX_LINE.getValue(4)[1],
  "banned" to BOX_LINE.getValue(5)[1],
  "closed" to BOX_DEFAULT[1],
  "drop" to BOX_DEFAULT[1],
  "level-change" to BOX_DEFAULT[1],
)

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
private fun box(key: String?, title: String, text: String): Map<String, Any?> = linkedMapOf("key" to key, "title" to title, "text" to text)
private val FAILED = box("CONFIRMATION_FAILED_TO_CONNECT", "ERROR", "FAILED TO CONNECT TO SERVER")
fun retailDenial(reason: Long?, retry: Boolean = false): Map<String, Any?> = when (reason) {
  0x02L -> box("CONFIRMATION_FAILED_TO_CONNECT_SERVER_FULL", "WARNING", "FAILED TO CONNECT TO SERVER! SERVER IS FULL!")
  0x11L -> if (retry) box("PASSWORD_INVALID", "PASSWORD", "This server requires password. Please try again!")
    else box("PASSWORD_INVALID_FIRST_ATTEMPT", "PASSWORD", "This server requires password.")
  0x1eL -> if (retry) FAILED else box(null, "PASSWORD", "")
  0x17L -> box("CONFIRMATION_FAILED_TO_CONNECT_OLD_VERSION", "ERROR", "WRONG VERSION! DO YOU WANT TO UPDATE?")
  else -> FAILED
}

// The refusal's line for the sidecar's own join, which is retail's join from
// the server list (retailDenial without `retry`), for every reason a server
// sends. Keys are the reasons in decimal, as a JS object's are.
val DENIAL_TEXT: Map<String, String> = linkedMapOf<String, String>().also { m ->
  for (r in listOf(0x02L, 0x11L, 0x16L, 0x17L, 0x18L, 0x1eL)) m[r.toString()] = retailDenial(r)["text"] as String
}

private val WORD_CHAR = "A-Za-z0-9_"
private fun wordRe(body: String) = Regex("(?<![$WORD_CHAR])(?:$body)(?![$WORD_CHAR])", RegexOption.IGNORE_CASE)
private val KICK_WORD = wordRe("kicked|kicking|banned|banning")
private val KICK_DONE = Regex(
  "(?<![$WORD_CHAR])(?:was|were|been|got|being) (?:kicked|banned)(?![$WORD_CHAR])|(?<![$WORD_CHAR])(?:kicking|banning)(?![$WORD_CHAR])",
  RegexOption.IGNORE_CASE)
private val KICK_PENDING = Regex(
  "(?<![$WORD_CHAR])will(?![$WORD_CHAR])|'ll(?![$WORD_CHAR])|(?<![$WORD_CHAR])(?:be|get|gets) (?:kicked|banned)(?![$WORD_CHAR])" +
    "|(?<![$WORD_CHAR])warn(?:s|ed)?(?![$WORD_CHAR])|(?<![$WORD_CHAR])warning(?![$WORD_CHAR])(?! ?[0-9])",
  RegexOption.IGNORE_CASE)
private val BAN_WORD = wordRe("ban(?:ned|ning)")
private val LEADING_STARS = Regex("^\\*+")
private val JS_SPACES = Regex("[$JS_WS]+")
private val NAME_PART = Regex("[a-z0-9_\\-]")

// A server chat line that says one of `names` was kicked or banned: the
// engine's own "Player <name> was kicked from the server." and the lines a
// server manager (BFSM, bf42++) prints before it kicks. Server chat arrives
// with 0x80 for each space (the BFSM lines in the 2026-10-24 recordings), so
// both are read as spaces. Returns { banned, text } or null.
// (\b in the Node copy is ASCII; spelled as lookarounds here so the JVM's and
// Android's regex engines cannot read it as Unicode.)
fun kickNoticeFor(text: String?, names: List<String?> = emptyList()): KickNotice? {
  if (text.isNullOrEmpty()) return null
  val line = JsOps.trim(JS_SPACES.replace(LEADING_STARS.replace(text.replace('\u0080', ' '), ""), " "))
  if (!KICK_WORD.containsMatchIn(line)) return null
  // A warning ("... or you will be kicked", "X was warned for teamkilling")
  // is not the kick. A line that says the kick happened ("was kicked",
  // "Kicking X") is, whatever else it says: a server manager's kick after
  // the last warning reads "X was kicked (warning 3)", and a count after
  // "warning" is that tally, not a warning.
  if (!KICK_DONE.containsMatchIn(line) && KICK_PENDING.containsMatchIn(line)) return null
  val low = line.lowercase()
  val named = names.filter { it != null && JsOps.trim(it).isNotEmpty() }.any { n0 ->
    val n = JsOps.trim(n0!!)
    val at = low.indexOf(n.lowercase())
    if (at < 0) return@any false
    // The whole name: "skandia" is not "skandia-sc_1"'s owner.
    val before = if (at > 0) low[at - 1] else null
    val afterAt = at + n.length
    val after = if (afterAt < low.length) low[afterAt] else null
    fun part(c: Char?) = c != null && NAME_PART.matches(c.toString())
    !part(before) && !part(after)
  }
  if (!named) return null
  return KickNotice(banned = BAN_WORD.containsMatchIn(line), text = line)
}

// Everything the page needs to say why the server ended the session.
// `message` is the Disconnect datagram's text (the server's player+0x19c,
// set by kickPlayer(int, const char*); empty for a plain kick), `notice` the
// kick line the server's chat carried, if any. `title` and `text` are what
// retail's box would show for this reason and message (retailDisconnectBox);
// the chat line goes in `notice`, since retail's box never shows it. A drop
// the chat called a kick is a kick for the sidecar (it does not rejoin), and
// retail, seeing only the drop, says DISCONNECTED FROM SERVER.
fun describeDisconnect(kind: String, reason: Long? = null, name: String = "", message: String = "", notice: KickNotice? = null): Map<String, Any?> {
  val b = retailDisconnectBox(reason, message) ?: linkedMapOf("title" to (DISCONNECT_TITLE[kind] ?: DISCONNECT_TITLE["closed"]), "text" to "")
  return linkedMapOf(
    "kind" to kind, "reason" to reason, "name" to name, "title" to b["title"], "text" to b["text"],
    "notice" to (notice?.text ?: ""), "final" to !rejoinable(kind),
  )
}

/** reconnectFromGameStatus's answer. */
data class Reconnect(val password: String, val mod: String) {
  fun toJs(): Map<String, Any?> = linkedMapOf("password" to password, "mod" to mod)
}

// GameStatus 5's tail (events.mjs: 5 raw bytes, u8 length, text): the four
// reconnect digits NUL-terminated, and the next level's mod.
fun reconnectFromGameStatus(status: Int?, extra: ByteArray?, text: String?): Reconnect? {
  if (status != 5 || extra == null) return null
  val n = extra.indexOf(0)
  val len = if (n < 0) minOf(4, extra.size) else minOf(n, 4)
  return Reconnect(String(extra, 0, len, Charsets.ISO_8859_1), text ?: "")
}

/** What Rejoiner.connect returns: a session's events and its close(). */
interface RejoinTarget {
  fun on(event: String, fn: Listener): Any?
  fun close()
}

// The rejoin state machine. `connect(reconnectPassword, team)` starts a
// session and returns it (an emitter of connected / joined / denied /
// disconnected, with close()); `probe(done)` calls done with something truthy
// when the server answers a ServerInfoRequest (the Node copy awaits a
// promise; done may be called later, from the loop). The Scheduler and its clock are
// injectable, so the test drives it with a fake session and a fake clock.
//
// States: idle -> waiting (probing) -> connecting -> idle (rejoined)
//                                                 \-> waiting (refused full, timed out)
//         any -> failed (a final refusal, or the horizon passed)
//
// Emits: probe {n, up}, attempt {n, reconnectPassword, team}, retry {why,
// delayMs}, rejoined {attempts, elapsedMs, usedKey, info}, give-up {why, reason}.
class Rejoiner(
  val connect: (reconnectPassword: String, team: Int) -> RejoinTarget,
  val probe: (done: (Any?) -> Unit) -> Unit,
  val timers: Scheduler,
  var horizonMs: Long = 10 * 60 * 1000,   // keep trying this long after the drop
  // The client's pinger (plus.mjs): bf42++'s by default; `start` takes the
  // timing the dropped session's server allowed. Probes are evenly spaced,
  // as both clients space them; only a refused or failed attempt backs off.
  var firstProbeMs: Long = PLUS_RESTART.firstProbeMs,
  var probeMs: Long = PLUS_RESTART.probeMs,
  var probeMaxMs: Long = 15000,           // retry backoff cap, well inside the server's 180 s window
  var backoff: Double = 1.5,
  var connectTimeoutMs: Long = 10000,     // no ConnectAccept: the server went away again
  var joinTimeoutMs: Long = 90000,        // accepted, but no Simulation event (a stalled database)
) : Emitter() {
  var state = "idle"
  private var timer: Cancellable? = null
  private var attemptTimer: Cancellable? = null
  private var session: RejoinTarget? = null
  private var defaultTiming: RestartTiming? = null
  var timing: RestartTiming? = null; private set
  var kind: String? = null; private set
  var reason: Long? = null; private set
  var password = ""; private set
  var team = 0; private set
  var attempts = 0; private set
  var probes = 0; private set
  private var t0: Long? = null
  private var delay = 0.0

  val active get() = state == "waiting" || state == "connecting"

  // kind: classifyDisconnect's answer. password: the GameStatus 5 digits ('' if
  // none). team: the side to ask for (0 = auto). timing: {firstProbeMs,
  // probeMs} for this wait (Session.restartTiming()), else the constructor's.
  fun start(kind: String = "drop", reason: Long? = null, password: String? = "", team: Int? = 0, timing: RestartTiming? = null): Boolean {
    if (active) return false
    if (defaultTiming == null) defaultTiming = RestartTiming(firstProbeMs, probeMs)
    val t = timing ?: defaultTiming!!
    firstProbeMs = t.firstProbeMs
    probeMs = t.probeMs
    this.timing = RestartTiming(t.firstProbeMs, t.probeMs)
    this.kind = kind
    this.reason = reason
    this.password = if (kind == "level-change") (password ?: "") else ""
    this.team = team ?: 0
    attempts = 0
    probes = 0
    t0 = timers.now()
    delay = probeMs.toDouble()
    if (!rejoinable(kind)) { fail(kind, reason); return false }
    state = "waiting"
    schedule(firstProbeMs.toDouble())
    return true
  }

  fun stop() {
    clearTimers()
    dropSession()
    if (active) state = "idle"
  }

  private fun schedule(ms: Double) {
    timer?.cancel()
    timer = timers.schedule(ms) { probeTick() }
  }

  private fun elapsed(): Long = timers.now() - (t0 ?: 0)

  private fun probeTick() {
    if (state != "waiting") return
    if (elapsed() > horizonMs) return fail("horizon", null)
    probes++
    var settled = false
    val done: (Any?) -> Unit = done@{ up ->
      if (settled) return@done
      settled = true
      if (state != "waiting") return@done
      val isUp = truthy(up)
      emit("probe", linkedMapOf<String, Any?>("n" to probes, "up" to isUp))
      if (isUp) return@done attempt()
      schedule(probeMs.toDouble())
    }
    try { probe(done) } catch (_: Exception) { done(null) }
  }

  private fun truthy(v: Any?): Boolean = when (v) {
    null, false, Undefined -> false
    is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
    is String -> v.isNotEmpty()
    else -> true
  }

  private fun nextDelay(): Double {
    val d = delay
    // Math.round: floor(x + 0.5) for these positive delays.
    delay = minOf(probeMaxMs.toDouble(), Math.floor(delay * backoff + 0.5))
    return d
  }

  private fun attempt() {
    state = "connecting"
    attempts++
    emit("attempt", linkedMapOf<String, Any?>("n" to attempts, "reconnectPassword" to password, "team" to team))
    val s: RejoinTarget
    try { s = connect(password, team) } catch (e: Exception) { return retry("connect threw: ${e.message}") }
    session = s
    armAttempt(connectTimeoutMs, "no ConnectAccept")
    val mine = { session === s && state == "connecting" }
    s.on("connected") { if (mine()) armAttempt(joinTimeoutMs, "join did not complete") }
    s.on("joined") { a ->
      if (!mine()) return@on
      clearTimers()
      session = null // the caller owns it now
      state = "idle"
      val usedKey = password.isNotEmpty()
      password = ""   // one level's digits; the next restart rolls new ones
      emit("rejoined", linkedMapOf<String, Any?>("attempts" to attempts, "elapsedMs" to elapsed(), "usedKey" to usedKey, "info" to a.getOrNull(0)))
    }
    s.on("denied") { a ->
      if (!mine()) return@on
      val i = a.getOrNull(0) as? Map<*, *>
      val r = (i?.get("reason") as? Number)?.toLong()
      if (denialIsFinal(r)) return@on fail("denied", r)
      retry("denied ${i?.get("name") ?: i?.get("reason")}")
    }
    s.on("disconnected") { a ->
      if (!mine()) return@on
      val i = a.getOrNull(0) as? Map<*, *>
      val r = (i?.get("reason") as? Number)?.toLong()
      // The server ending the attempt on purpose (a kick, a ban, any reason
      // but a timeout) is as final here as on a live session.
      val k = classifyDisconnect(r)
      if (!rejoinable(k)) return@on fail(k, r)
      retry("disconnected ${i?.get("name") ?: i?.get("reason")} before the join completed")
    }
  }

  private fun armAttempt(ms: Long, why: String) {
    attemptTimer?.cancel()
    attemptTimer = timers.schedule(ms.toDouble()) { if (state == "connecting") retry(why) }
  }

  private fun retry(why: String) {
    attemptTimer?.cancel(); attemptTimer = null
    dropSession()
    if (elapsed() > horizonMs) return fail("horizon", null)
    state = "waiting"
    val delayMs = nextDelay() // first retry after one interval, then longer
    emit("retry", linkedMapOf<String, Any?>("why" to why, "delayMs" to delayMs, "attempts" to attempts))
    schedule(delayMs)
  }

  private fun fail(why: String, reason: Long?) {
    clearTimers()
    dropSession()
    state = "failed"
    emit("give-up", linkedMapOf<String, Any?>("why" to why, "reason" to reason, "attempts" to attempts, "elapsedMs" to if (t0 != null) elapsed() else 0L))
  }

  private fun dropSession() {
    val s = session
    session = null
    if (s != null) { try { s.close() } catch (_: Exception) { /* already closed */ } }
  }

  private fun clearTimers() {
    timer?.cancel(); timer = null
    attemptTimer?.cancel(); attemptTimer = null
  }
}
