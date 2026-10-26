package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/session.mjs; keep in step.
//
// A reusable sidecar session: owns the UDP connection, runs the join the real
// client runs (wire.md §5-6), decodes the server's event stream, frames the
// ghost (object-update) stream into per-object records, and emits all of it.
// join.mjs (the CLI tester) and sidecar.mjs (the browser bridge) are thin
// layers over this.
//
// Events emitted:
//   open {local}                connected {id, serverTime}   joined {playerId, team, players, objects}
//   event <decoded event>       (every known server event, in order; after a
//                               ChatFragment that finishes a line, a synthetic
//                               {type:'Chat', pid, text, team, server})
//   unknown-event {id, seq, block, bitOffset, hex}
//   ghost {seq, tick, count, hasControl, records:[{netId,action,bodyBits,hex}], raw?}
//   unknown-datagram {type, hex}   decode-error {where, seq, message, hex}
//   denied {...}  disconnected {...}  pong rttMs  stats {...}  left
//   level-change {password, mod}   (GameStatus 5: the server will restart for
//                               the next level; rejoin.mjs)
//   plus-settings <settings>    (a welcome line carried bf42++ server settings;
//                               plus.mjs parseServerSettings, wire.md §30)
//   skip-static-objects         (bf42++ SpecialGame 2 before the SetLevel: this
//                               connection's level loads without StaticObjects.con)
//
// Port notes. Every payload is a JS value (JsOps's model: maps in the Node
// copy's key order, every number a Double, bytes a ByteArray): the decoded
// events are converted once on arrival (`jsValue`), so the decoders, the
// recording and a parity transcript see what Node's objects hold. The timers
// and the clock are the Scheduler's; everything runs on its thread (Node's
// event loop). `levelGate` stands in for the promise: it returns true when the
// level load must wait and calls `done(result)` later, from any thread.

import io.bfstats.sidecar.ghost.ControlBaselines
import io.bfstats.sidecar.ghost.ControlState

private const val SERVER_EXE_CHECKSUM = 0xa14aac64L // GameServer::calculateServerCheckSums 0x08133220
// ChallengeResponse's 1-bit `flag` is the client's PunkBuster switch. Both of
// retail's responses store `[0x00971eac]+0xd1 != 0` there (BF1942.exe
// 0x00444500 returns that byte; setne at 0x0049503d and 0x00495197 into event
// +0x65, which serialize 0x004a4f80 writes as the last bit). The byte is
// `game.clientPunkBuster` (accessor 0x00416b80, setter 0x00447e40), which
// can only be switched on while pb/pbcl.dll exists (0x00447e57 asks for the
// file and keeps it off without one; 0x0044804f clears it when the file is
// gone). The server copies it to BFPlayer+0x198 (lnxded 0x08136992) and
// hands it to PbAuthClient after the CD-key check (0x08135940). A client with
// no PunkBuster sends 0, as the owner's retail capture did; the sidecar runs
// no PunkBuster client, so it sends 0 in both responses.
const val CLIENT_PUNKBUSTER = 0
object STREAM { const val INPUT = 1 shl 0; const val EVENTS = 1 shl 1; const val GHOSTS = 1 shl 2; const val DOWNLOAD = 1 shl 3 }
private const val MASK_BITS = 6

/**
 * The Ack the content check reads (content-crc.mjs): the level's content
 * CRC xor the challenge's first u32, as the retail client sends it
 * (BF1942.exe 0x00494a4a). 0 when the CRC is unknown.
 */
fun contentAck(challenge0: Long?, crc: Long?): Long =
  if (crc == null || challenge0 == null) 0 else (challenge0 xor crc) and 0xffffffffL

/**
 * The ChallengeResponse events a Challenge is answered with, in order. The
 * retail client (BF1942.exe builds them at 0x0049502b and 0x00495177) always
 * sends one with xpack -1 (0x0049514c, `addEvent` 0x0049515b), and when the
 * Challenge names an expansion (`+0x27` != -1, 0x00495160) a second with
 * that xpack in the same block (0x0049526f, `addEvent` 0x0049527a): the
 * base game's key, then the expansion's. The server needs both on an
 * expansion's level:
 * `GameServer::authentificationOk` (lnxded 0x08139950) counts each
 * authentication on the connection (`+0x16c`) and, while
 * `XpackUtils::checkXpackMapModIdForProdAuth` (0x080d6320, the map id XPack1
 * or XPack2) holds, returns before SetLevel until the second. Answered with
 * only the expansion's, a Secret Weapons server (xpack 783) never sent the
 * level.
 *
 * Each carries the key hash for its product (cdkey.mjs): `keyFor(xpack)`
 * names the key, the base game's for -1. An internet server checks it
 * through GameSpy; a LAN server does not look.
 *
 * `b` is the CRC-32/BZIP2 of the mod's objects.rfa XORed with the
 * challenge's first u32 (0x005c1280, 0x004950af): `checksumFor(mod)` gives
 * the CRC (objects-checksum.mjs), "BF1942" for the base response and the
 * Challenge's mod for an expansion's; null sends 0. `c` is 0, as retail's.
 * `flag` is CLIENT_PUNKBUSTER in both. `statsResponse` stays zero: retail
 * never writes the event's +0x66..+0x85 (the builder fills keyHash, xpack,
 * a, b, c and flag only), so it sends whatever its stack held; the server
 * keeps it as a C string (BFPlayer::setStatsChallengeResponse, lnxded
 * 0x081369bf). The builder reads only the challenge (+0xc), the mod (+0x16)
 * and xpack (+0x27) of the Challenge, so its 8-byte tail, the stats
 * challenge, goes unanswered in 1.612.
 *
 * `challenge` is the decoded event ({challenge: bytes, xpack, mod}).
 * `randomInt` feeds retailRand (a test seeds it).
 */
fun challengeResponses(
  challenge: Map<String, Any?>,
  keyFor: (Long?) -> String? = { null },
  checksumFor: (String?) -> Long? = { null },
  randomInt: (Int) -> Int = defaultRandomInt,
): List<LinkedHashMap<String, Any?>> {
  val bytes = challenge["challenge"] as ByteArray
  val ch0 = bytes.u32le(0)
  val a = (ch0 xor SERVER_EXE_CHECKSUM) and 0xffffffffL
  val ch = challengeString(bytes, (challenge["mod"] as? String) ?: "")
  fun answer(xpack: Long, mod: String?): LinkedHashMap<String, Any?> {
    val key = keyFor(xpack)
    val crc = checksumFor(mod)
    val b = if (crc == null) 0L else (crc xor ch0) and 0xffffffffL
    return linkedMapOf("keyHash" to (if (!key.isNullOrEmpty()) keyHashResponse(key, ch, retailRand(randomInt)) else Undefined),
      "a" to a.toDouble(), "b" to b.toDouble(), "c" to 0.0, "xpack" to xpack.toDouble(), "flag" to CLIENT_PUNKBUSTER.toDouble())
  }
  val out = mutableListOf(answer(-1, "BF1942"))
  val xpack = JsOps.toNumber(challenge["xpack"])
  if (xpack != -1.0) out.add(answer(xpack.toLong(), challenge["mod"] as? String))
  return out
}

/** The event stream's send window (Session above): true while
 *  `(next - lastConfirmed) & 31` has reached retail's cap of 15. */
const val EVENT_WINDOW = 15
fun eventWindowFull(nextBlock: Int, lastConfirmed: Int): Boolean = ((nextBlock - lastConfirmed) and 0x1f) >= EVENT_WINDOW

/** A decoded value as Node holds it: every integer a Double, a vector a list. */
fun jsValue(v: Any?): Any? = when (v) {
  is Double, is String, is Boolean, null, is ByteArray -> v
  is Long -> v.toDouble()
  is Int -> v.toDouble()
  is Short -> v.toDouble()
  is Byte -> v.toDouble()
  is Float -> v.toDouble()
  is DoubleArray -> v.mapTo(ArrayList<Any?>()) { it }
  is Map<*, *> -> LinkedHashMap<String, Any?>(v.size * 2).also { m -> for ((k, x) in v) m[k as String] = jsValue(x) }
  is List<*> -> v.mapTo(ArrayList<Any?>()) { jsValue(it) }
  else -> v
}

/** The level the SetLevel names, as the gate is asked about it. */
typealias LevelGate = (info: Map<String, Any?>, done: (Any?) -> Unit) -> Boolean

class SessionOptions(
  val name: String = "sidecar",
  // Team to request in CreatePlayer. 0 lets the server auto-assign (and
  // balance), which usually lands the sidecar opposite a lone human; a human
  // on the other team is relevance-culled from a sidecar parked on the spawn
  // screen (§19/P-5), so set this to the human's team to receive their
  // movement map-wide. A non-zero team is honoured unless the server forces
  // auto-balance (GameServer::createPlayer 0x081310e0 rebalances only when
  // the requested team is 0 or auto-balance is on).
  val team: Int = 0,
  val password: String = "",
  // The reconnect password is the four digits the previous level's
  // GameStatus 5 carried (rejoin.mjs); empty on an ordinary join.
  val reconnectPassword: String = "",
  // The bf42++ identity the ConnectAcceptAck carries (plus.mjs; the default is
  // this PC's bf42++ build, null a retail client).
  val plus: PlusIdentity? = PlusIdentity(),
  val templateExists: ((String) -> Boolean)? = null,
  val keyFor: ((Long?) -> String?)? = null,
  val cdkey: String? = null,
  val checksumFor: ((String?) -> Long?)? = null,
  val contentCrcFor: ((Map<String, Any?>) -> Long?)? = null,
  val silenceMs: Double = 20000.0,
  val animStates: Double = 0.0,
  val levelGate: LevelGate? = null,
  val levelHoldMs: Double = 30000.0,
  /** For the key hash's r (retailRand). */
  val randomInt: (Int) -> Int = defaultRandomInt,
  /** The socket (a test's fake); the real UDP socket by default. */
  val transport: Transport? = null,
  val faults: PathFaults = PathFaults.fromEnv(),
  /** Math.random for the path faults. */
  val random: () -> Double = Math::random,
)

/** session.mjs's `me`. */
class SessionMe : InputPlayer {
  override var playerId: Any? = null
  override var team: Any? = null
  var netIds: MutableMap<String, Any?>? = null
  var challengeA: Long = 0
  var challenge0: Long? = null
  var challengeXpack: Any? = -1.0
  var contentMod: String? = null
  var mapId: String? = null
  var level: MutableMap<String, Any?>? = null
  var dbAcked = false
}

/** What a bf42++ client keeps for the life of its process (wire.md §30). */
class PlusState(val settings: ServerSettings = defaultServerSettings(), var skipStaticObjects: Boolean = false, var setLevelSeen: Boolean = false)

class Session(
  val host: String,
  val port: Int,
  opts: SessionOptions = SessionOptions(),
  val scheduler: Scheduler,
) : Emitter(), InputSession, RejoinTarget {
  var name = opts.name
  var team = opts.team
  override val conn = NetConnection(host, port, scheduler, password = opts.password, reconnectPassword = opts.reconnectPassword,
    plus = opts.plus, log = {}, faults = opts.faults, random = opts.random, transport = opts.transport)
  // What a bf42++ client keeps for the life of its process (wire.md §30):
  // the server settings from the welcome lines (g_serverSettings), and
  // whether a SpecialGame 2 came before the SetLevel (g_skipLoadingStatic-
  // Objects, setLevelEventReceived). The client restarts its process at a
  // level change, and the sidecar starts a new Session there, so a Session
  // is the unit. `templateExists(name)` answers for a 3DO's template.
  val plus = PlusState()
  val templateExists = opts.templateExists
  // The CD key for each product the Challenge asks after (cdkey.mjs):
  // `cdkey` is the base game's (--cdkey), else this PC's generated one.
  val keyFor: (Long?) -> String? = opts.keyFor ?: run { val store = cdKeyStore(override = opts.cdkey?.ifEmpty { null } ?: systemEnv()["SIDECAR_CDKEY"]); { x: Long? -> store(x) } }
  val checksumFor: (String?) -> Long? = opts.checksumFor ?: { mod -> objectsChecksum(mod) }
  // The content check's CRC for the server's level (content-crc.mjs).
  val contentCrcFor: (Map<String, Any?>) -> Long? = opts.contentCrcFor ?: { l ->
    contentCrc(l["mod"] as? String, l["mapId"] as? String, l["levelPath"] as? String, l["modeFile"] as? String)
  }
  private val randomInt = opts.randomInt
  // A server that goes quiet this long while connected has gone (a lost
  // Disconnect datagram, a crash, a restart we were not told of): report it
  // as a PRTimeOut disconnect. A live server sends ghosts at 20 Hz and pings
  // after 3 s of quiet (_updateConnections 0x08433af0), so 20 s is no false alarm.
  val silenceMs = opts.silenceMs
  // Set by GameStatus 5: {password, mod}. The next drop is a level change.
  var levelChange: Reconnect? = null
  val players = LinkedHashMap<Any?, Map<String, Any?>>()
  val objects = LinkedHashMap<Any?, Map<String, Any?>>()
  val soldiers = LinkedHashSet<Any?>()   // netIds that are a player's on-foot control object
  val animStates = opts.animStates // engine animation state count (sizes a body's state fields; 0 = the level's, from the install)
  // Picks each ghost body's reader from the events (body-decoder.mjs).
  val bodies = BodyDecoder(linkedMapOf("animStates" to animStates))
  override var joined = false
  override val me = SessionMe()
  // event stream (our side)
  val outbox = ArrayList<Pair<String, Map<String, Any?>>>()
  var nextSendBlock = 0
  val unconfirmed = LinkedHashMap<Int, List<Pair<String, Map<String, Any?>>>>()
  private class Resend(val index: Int, val events: List<Pair<String, Map<String, Any?>>>)
  private val resendQueue = ArrayList<Resend>()
  // The block window is retail's (GameEventManager, lnxded): `+0x98` the
  // last block confirmed IN ORDER, starting at 31 (the ctor 0x0812bc70);
  // `getNumUnconfirmed` 0x0812e540 is (next - lastConfirmed) & 31, and
  // `transmit` 0x0812d770 opens no new block while that is >= `+0x9c` = 15
  // (0x0812bc7a). A delivered block ahead of a lost one does not move it
  // (`advanceLastConfirmedBlockIndex` 0x0812ddf0 steps only over
  // delivered blocks), so a lost block holds the window shut until its
  // resend lands, and the 5-bit index can never lap the receiver.
  var lastConfirmedBlock = 0x1f
  private val confirmedAhead = HashSet<Int>()
  // event stream (server side), reordered by block index
  var nextRecvBlock = 0
  private val pendingBlocks = HashMap<Int, List<EventBody>>()
  // What the server sent, in order, and whether a level load holds it
  // (pump below; `levelGate(info, done)` -> false | true).
  private class Work(val ev: MutableMap<String, Any?>? = null, val seq: Any? = null, val fn: (() -> Unit)? = null) { var gated = false }
  private val work = ArrayDeque<Work>()
  private var held = false
  val levelGate = opts.levelGate
  val levelHoldMs = opts.levelHoldMs
  // chat (chat.mjs): the server's lines put back together, and our own sent
  // a piece at a time
  val chatIn = ChatAssembler()
  val chatSender = ChatSender({ name, body -> queue(name, body.toJs()) }, scheduler)
  override val chatOut: ChatOut = object : ChatOut { override fun say(text: String, team: Boolean) = chatSender.say(text, team) }
  private var flushTimer: Cancellable? = null
  private var pingTimer: Cancellable? = null
  private var quietTimer: Cancellable? = null
  private var holdTimer: Cancellable? = null
  private var closed = false
  private var controlBaselines: ControlBaselines? = null

  init { wire() }

  // ---- public ----
  /** Bind, connect, and start the flush, ping and quiet timers (on the loop). */
  fun start() {
    val addr = conn.bind()
    emit("open", linkedMapOf("local" to "${addr.host}:${addr.port}"))
    conn.connect()
    flushTimer = scheduler.every(33.0) { flush() }
    pingTimer = scheduler.every(2000.0) { conn.pingRequest() }
    quietTimer = scheduler.every(1000.0) { checkQuiet() }
  }

  private fun checkQuiet() {
    if (conn.state != "connected") return
    if (scheduler.now() - conn.lastHeardAt <= silenceMs) return
    conn.state = "closed"
    emit("disconnected", linkedMapOf("reason" to DISCONNECT.TIMEOUT.toDouble(), "name" to "PRTimeOut", "message" to "", "local" to true))
  }

  fun leave() {
    flushTimer?.cancel(); pingTimer?.cancel(); quietTimer?.cancel()
    closed = true; holdTimer?.cancel()
    chatSender.stop()
    conn.disconnect(0xd, "")
    emit("left")
    emit("stats", JsOps.spread(conn.stats.toJs(), linkedMapOf("players" to players.size.toDouble(), "objects" to objects.size.toDouble(), "joined" to joined)))
    conn.close()
  }

  // The server ended the connection: stop this session's timers and socket
  // without the goodbye leave() sends. A replaced session left its flush and
  // ping timers running against a closed socket for the rest of the process.
  override fun close() {
    flushTimer?.cancel(); pingTimer?.cancel(); quietTimer?.cancel()
    closed = true; holdTimer?.cancel()
    chatSender.stop()
    try { conn.close() } catch (_: Exception) { /* already closed */ }
  }

  override fun queue(name: String, body: Map<String, Any?>) { outbox.add(name to body) }
  fun queue(name: String) = queue(name, emptyMap())

  // When to start probing, and how often, after this connection's server
  // restarts for the next level: bf42++'s faster pinger unless the server
  // said UI&nfr, or the retail pinger for a retail identity (plus.mjs).
  fun restartTiming(): RestartTiming = restartTiming(plus = conn.plus != null, settings = plus.settings)

  // ---- connection wiring ----
  private fun wire() {
    conn.on("connected") { a -> emit("connected", jsValue(a[0])) }
    conn.on("denied") { a -> emit("denied", jsValue(a[0])) }
    conn.on("disconnected") { a -> emit("disconnected", jsValue(a[0])) }
    conn.on("pong") { a -> emit("pong", jsValue(a[0])) }
    conn.on("unknown") { a -> emit("unknown-datagram", linkedMapOf("type" to jsValue(a[0]), "hex" to (a[1] as ByteArray).hex())) }
    conn.on("status") { a -> onStatus(a[0] as Map<*, *>) }
    conn.on("data") { a -> onData(a[0] as ByteArray, (a[1] as Number).toDouble()) }
  }

  private fun flush() {
    if (conn.state != "connected") return
    var index: Int
    var resend: Boolean
    var events: List<Pair<String, Map<String, Any?>>>
    if (resendQueue.isNotEmpty()) {
      val r = resendQueue.removeAt(0)
      index = r.index; resend = true; events = r.events
    } else if (outbox.isNotEmpty()) {
      if (eventWindowFull(nextSendBlock, lastConfirmedBlock)) return
      val n = minOf(outbox.size, 0xfe)
      events = ArrayList(outbox.subList(0, n)); outbox.subList(0, n).clear()
      index = nextSendBlock++ and 0x1f; resend = false
      unconfirmed[index] = events
    } else return
    val w = BitWriter(1024)
    w.writeUnsigned(STREAM.EVENTS, MASK_BITS)
    writeEventBlock(w, index, resend, events)
    val sseq = conn.sendData(w.bytes(), linkedMapOf<String, Any?>("block" to index.toDouble()) as Any?)
    emit("sent", linkedMapOf("seq" to sseq.toDouble(), "index" to index.toDouble(), "resend" to resend,
      "events" to events.map { (n, b) -> mutableListOf<Any?>(n, b) }))
  }

  private fun onStatus(st: Map<*, *>) {
    val tag = st["tag"] as? Map<*, *> ?: return
    if (!tag.containsKey("block") || tag["block"] === Undefined) return
    val block = (tag["block"] as Number).toInt()
    if (st["delivered"] == true) {
      if (unconfirmed.remove(block) == null) return
      confirmedAhead.add(block)
      var next = (lastConfirmedBlock + 1) and 0x1f
      while (confirmedAhead.remove(next)) { lastConfirmedBlock = next; next = (next + 1) and 0x1f }
      return
    }
    val events = unconfirmed[block]
    if (events != null) resendQueue.add(Resend(block, events))
  }

  // ---- receive ----
  private fun onData(payload: ByteArray, seq: Double) {
    val r = BitReader(payload)
    val mask: Int
    try { mask = r.readUnsigned(MASK_BITS).toInt() }
    catch (e: Exception) { emit("decode-error", linkedMapOf("where" to "mask", "seq" to seq, "message" to e.message, "hex" to payload.hex())); return }

    // streams in slot order: input, events, ghosts, download
    if (mask and STREAM.INPUT != 0) {
      // the server never sends input; if it appears we cannot find the next
      // boundary, so log and stop.
      emit("decode-error", linkedMapOf("where" to "server-input-stream", "seq" to seq, "message" to "unexpected input stream", "hex" to payload.hex()))
      return
    }
    if (mask and STREAM.EVENTS != 0) {
      if (!readEvents(r, seq)) return // desync: do not trust what follows
    }
    if (mask and STREAM.GHOSTS != 0) { work.addLast(Work(fn = { readGhosts(r, seq, payload) })); pump() }
    if (mask and STREAM.DOWNLOAD != 0) {
      emit("decode-error", linkedMapOf("where" to "download-stream", "seq" to seq, "message" to "download stream present (not decoded)", "hex" to payload.hex()))
    }
  }

  // Tolerant event-block read: keep events that parse, record the first that
  // does not, and stop (the rest of the stream is then untrustworthy).
  private fun readEvents(r: BitReader, seq: Double): Boolean {
    val count: Long; val index: Int; val resend: Boolean
    try {
      count = r.readUnsigned(BLOCK_COUNT_BITS)
      index = r.readUnsigned(BLOCK_INDEX_BITS).toInt()
      resend = r.readBool()
    } catch (e: Exception) { emit("decode-error", linkedMapOf("where" to "event-block-header", "seq" to seq, "message" to e.message)); return false }
    val events = ArrayList<EventBody>()
    var ok = true
    for (i in 0 until count) {
      val bitOffset = r.pos
      // peek the id so an unknown type can be reported with its bit offset
      val id: Long
      try { id = r.readUnsigned(EVENT_TYPE_BITS) } catch (_: Exception) { ok = false; break }
      if (EVENT_BY_ID[id.toInt()] == null) {
        emit("unknown-event", linkedMapOf("id" to id.toDouble(), "seq" to seq, "block" to index.toDouble(), "bitOffset" to bitOffset.toDouble(), "hex" to hexFrom(r, bitOffset)))
        ok = false; break
      }
      r.pos = bitOffset // rewind and let readEvent consume type+body
      try { events.add(readEvent(r)) }
      catch (e: Exception) {
        emit("decode-error", linkedMapOf("where" to "event#$i", "seq" to seq, "message" to e.message, "hex" to hexFrom(r, bitOffset)))
        ok = false; break
      }
    }
    deliver(index, resend, events, seq)
    return ok
  }

  // Deliver a block's events in block-index order, then handle each.
  private fun deliver(index: Int, resend: Boolean, events: List<EventBody>, seq: Double) {
    if (resend && pendingBlocks.containsKey(index)) return
    pendingBlocks[index] = events
    while (pendingBlocks.containsKey(nextRecvBlock)) {
      val evs = pendingBlocks.remove(nextRecvBlock)!!
      nextRecvBlock = (nextRecvBlock + 1) and 0x1f
      @Suppress("UNCHECKED_CAST")
      for (ev in evs) work.addLast(Work(ev = jsValue(ev) as MutableMap<String, Any?>, seq = seq))
    }
    pump()
  }

  // ---- the level load ------------------------------------------------------
  //
  // Everything the server sends is handled in arrival order through one queue
  // of work: each event, and each datagram's ghost stream after its events.
  // A SetLevel is the retail client's level load: it reads the level's tables
  // from its install, and only once the level has loaded does it answer the
  // world dump (the content Ack, CreatePlayerAck and DatabaseCompleteAck at
  // DataBaseComplete). `levelGate` is where the sidecar gets the tables a
  // machine without the install has to fetch (level-tables.mjs prepareLevel):
  // it returns false when nothing need wait, or true and calls `done` later.
  // While one is pending the queue holds, from the SetLevel itself on, so no
  // createObject is named and no ghost body decoded before the tables are
  // there, and the world dump's acks go only after; `levelHoldMs` bounds the
  // wait, after which the level loads with whatever fallback there is.
  private fun pump() {
    while (!held && work.isNotEmpty()) {
      val item = work.first()
      if (item.ev?.get("type") == "SetLevel" && !item.gated && levelGate != null) {
        item.gated = true
        val info = linkedMapOf<String, Any?>("mod" to me.contentMod, "mapId" to me.mapId,
          "levelPath" to item.ev.g("levelPath"), "modeFile" to item.ev.g("modeFile"))
        var hold = false
        val done = HoldDone()
        try { hold = levelGate.invoke(info, done) }
        catch (e: Exception) { emit("decode-error", linkedMapOf("where" to "level-gate", "message" to e.message)) }
        if (hold) { holdLevel(done, info); return }
      }
      work.removeFirst()
      if (item.ev != null) handle(item.ev, item.seq) else item.fn!!()
    }
  }

  /** The gate's answer, which may come before holdLevel arms it, or from another thread. */
  private inner class HoldDone : (Any?) -> Unit {
    var release: ((Boolean, Any?) -> Unit)? = null
    var early: Any? = null
    var earlyDone = false
    override fun invoke(result: Any?) {
      // `Promise.resolve(p).then(release)`: a gate that answers on the loop
      // (already resolved, or resolved by a loop callback) releases as a
      // microtask, when the current callback returns and ahead of any queued
      // datagram or timer; one that answers from another thread (a download)
      // releases in the loop task that answer posts, as Node's I/O completion
      // runs the then() straight after itself.
      scheduler.microtask {
        val r = release
        if (r != null) r(false, result) else { early = result; earlyDone = true }
      }
    }
  }

  private fun holdLevel(done: HoldDone, info: Map<String, Any?>) {
    held = true
    val t = scheduler.now()
    emit("level-hold", info)
    var timer: Cancellable? = null
    val release = { timedOut: Boolean, result: Any? ->
      if (held && !closed) {
        held = false
        timer?.cancel()
        emit("level-release", JsOps.spread(info, linkedMapOf("ms" to (scheduler.now() - t).toDouble(), "timedOut" to timedOut,
          "result" to (if (result === Undefined) null else result), "queued" to work.size.toDouble())))
        pump()
      }
    }
    timer = scheduler.schedule(levelHoldMs) { release(true, null) }
    holdTimer = timer
    done.release = release
    if (done.earlyDone) scheduler.microtask { release(false, done.early) }
  }

  // Frame the ghost stream into per-object records (GhostManager
  // processReceivedPacket 0x081435a0 / readData 0x08141ed0): u32 tick, u8
  // count, bool hasControl, the control-object state when the bool is set,
  // then per object a 2-bit action, a 16-bit netId, and for action 1 a 1-bit
  // flag + 11-bit body length + that many body bits (the class's setNetUpdate
  // output). The control-object state is self-describing: it opens with a
  // 12-bit length of the fields that follow it, so 12 + n sizes it whole.
  private fun readGhosts(r: BitReader, seq: Double, payload: ByteArray) {
    val start = r.pos
    val tick: Double; val count: Int; val hasControl: Boolean
    try {
      tick = r.readUnsigned(32).toDouble()
      count = r.readUnsigned(8).toInt()
      hasControl = r.readBool()
    } catch (e: Exception) { emit("ghost", linkedMapOf("seq" to seq, "raw" to hexFrom(r, start), "reason" to "header", "message" to e.message)); return }
    // GhostManager::readControlObjectState 0x081428a0 reads a 12-bit length
    // first; GhostManager::writeControlObjectState 0x081422b0 reserves those
    // 12 bits, writes the state (s32 control id, bool, compressed vector, u16
    // netId, a delta flag and the object's own update body), then stores the
    // bit count of everything after the reserved field. So the state is
    // exactly 12 + n bits and needs no field decode to step over.
    var controlBits = 0
    var controlRec: MutableMap<String, Any?>? = null
    var blockRef: Any? = null // the records' compression reference (pco.mjs readSimpleObject)
    if (hasControl) {
      val at = r.pos
      try {
        val n = r.readUnsigned(12).toInt()
        val fieldsAt = r.pos
        r.skip(n)
        controlBits = 12 + n
        // Decode it (ghost/control-state.mjs): this is the only place the
        // server says where it has the local player's own object.
        val controlHex = bitSliceHex(payload, fieldsAt, n)
        try {
          val c = decodeControl(controlHex, n, seq, tick)
          blockRef = JsOps.coalesce(c.g("rootPos")) { null }
          controlRec = controlRecord(c)
        } catch (e: Exception) {
          emit("control-state", linkedMapOf("seq" to seq, "tick" to tick, "ok" to false, "reason" to e.message, "hex" to controlHex, "bits" to n.toDouble()))
        }
      } catch (e: Exception) {
        emit("ghost", linkedMapOf("seq" to seq, "tick" to tick, "count" to count.toDouble(), "hasControl" to true, "raw" to hexFrom(r, at),
          "reason" to "control-object-state", "message" to e.message))
        return
      }
    }
    // The control object rides first, as an ordinary decoded record marked
    // `control`, so every consumer draws the local player like anyone else.
    val records = ArrayList<Any?>()
    if (controlRec != null) records.add(controlRec)
    fun ghost(vararg extra: Pair<String, Any?>) = linkedMapOf<String, Any?>("seq" to seq, "tick" to tick, "count" to count.toDouble(),
      "hasControl" to hasControl, "controlBits" to controlBits.toDouble(), "records" to records).also { it.putAll(extra) }
    try {
      for (i in 0 until count) {
        val action = r.readUnsigned(2).toInt()
        val netId = r.readUnsigned(16).toDouble()
        if (action == 1) {
          r.readBool()                       // flag
          val bodyBits = r.readUnsigned(11).toInt()
          val at = r.pos
          r.skip(bodyBits)
          val hex = bitSliceHex(payload, at, bodyBits)
          val rec = linkedMapOf<String, Any?>("netId" to netId, "action" to 1.0, "bodyBits" to bodyBits.toDouble(), "hex" to hex)
          if (JsOps.truthy(blockRef)) rec["ref"] = blockRef
          // Decode the body so the recording can move, face, take a stance and
          // fire. The object's class picks the reader, and the class comes from
          // the template id in its createObject (the level's template table,
          // template-table.mjs): the wire never names it. A vehicle's body is its hull plus its child networkables
          // (ghost/pco.mjs), a player's is its own (ghost/player.mjs), a
          // soldier's is one networkable.
          try { bodies.decode(rec) } catch (_: Exception) { /* stays raw; the review log keeps it */ }
          records.add(rec)
        } else if (action == 3 || action == 0) {
          records.add(linkedMapOf("netId" to netId, "action" to action.toDouble(), "bodyBits" to null, "hex" to null))
        } else {
          // action 2 is the engine's own desync marker; stop and keep the rest raw
          records.add(linkedMapOf("netId" to netId, "action" to action.toDouble(), "bodyBits" to null, "hex" to null, "note" to "unframed-action"))
          emit("ghost", ghost("raw" to hexFrom(r, r.pos), "reason" to "action-$action"))
          return
        }
      }
    } catch (e: Exception) {
      emit("ghost", ghost("raw" to hexFrom(r, r.pos), "reason" to "frame-underflow", "message" to e.message))
      return
    }
    emit("ghost", ghost())
  }

  // ---- the control-object state ------------------------------------------
  //
  // The local player's own soldier or vehicle (ghost/control-state.mjs). It is
  // emitted as 'control-state' and also as an ordinary decoded record, so the
  // recording and the page see their own object exactly as they see others.
  private fun decodeControl(hex: String, n: Int, seq: Double, tick: Double): MutableMap<String, Any?> {
    val baselines = controlBaselines ?: ControlBaselines().also { controlBaselines = it }
    val c = ControlState.decodeControlState(hex, n.toDouble(), ControlState.Ctx(
      classOf = { id -> bodies.classOf(id) },
      templateOf = { id -> JsOps.coalesce(bodies.info(id)?.g("tmpl")) { null } },
      seatOf = { id -> bodies.seatOf(id) },
      baselines = baselines,
      animStates = bodies.animStates, // the count the level's setLevel settled (body-decoder.mjs)
    ))
    c["seq"] = seq; c["tick"] = tick; c["hex"] = hex; c["bits"] = n.toDouble()
    emit("control-state", c)
    return c
  }

  // A decoded control state as a ghost record (pos/rot/body like
  // BodyDecoder.decode's), or null when it did not decode.
  private fun controlRecord(c: Map<String, Any?>): MutableMap<String, Any?>? {
    if (!JsOps.truthy(c["ok"]) || !JsOps.truthy(c["body"])) return null
    val rec = linkedMapOf<String, Any?>("netId" to c["netId"], "action" to 1.0, "bodyBits" to null, "hex" to null, "control" to true, "cls" to c["cls"], "body" to c["body"])
    if (c["cls"] == "FreeCameraNetworkable") return null // the spawn camera is not drawn
    val body = c["body"]
    if (JsOps.truthy(body.g("pos"))) { rec["pos"] = body.g("pos"); rec["rot"] = if (JsOps.truthy(body.g("rot"))) body.g("rot") else null }
    return rec
  }

  // ---- the client's own input (stream 0) --------------------------------
  //
  // The input path lives in `Input.kt` (InputSender), which owns the 30 Hz
  // schedule, the idle policy and the framing. It is deliberately the only
  // sender: a second implementation of the same block in here would be free to
  // drift from it, and the engine's record has exactly one shape.

  // ---- the join, and world state ----
  private fun handle(ev: MutableMap<String, Any?>, seq: Any?) {
    try { bodies.note(Record.recordFor(ev)) } catch (_: Exception) { /* an odd event never stops the stream */ }
    emit("event", ev)
    when (ev["type"]) {
      "Challenge" -> {
        val bytes = ev["challenge"] as ByteArray
        me.challengeA = (bytes.u32le(0) xor SERVER_EXE_CHECKSUM) and 0xffffffffL
        me.challenge0 = bytes.u32le(0)
        me.contentMod = (JsOps.coalesce(ev.g("mod")) { me.contentMod }) as String?
        me.challengeXpack = ev.g("xpack")
        queue("ConnectionType", linkedMapOf("connType" to 0.0))
        queue("CreatePlayer", linkedMapOf("team" to team.toDouble(), "name" to name))
        scheduler.schedule(60.0) {
          if (conn.state == "connected") {
            for (body in challengeResponses(ev, keyFor, checksumFor, randomInt)) queue("ChallengeResponse", body)
          }
        }
      }
      "CreatePlayer" -> {
        players[JsOps.key(ev["playerId"])] = ev
        if (!JsOps.truthy(ev.g("isRemote")) && me.playerId == null) {
          me.playerId = ev["playerId"]; me.team = ev["team"]
          me.netIds = linkedMapOf("player" to ev.g("playerNetId"), "vehicle" to ev.g("vehicleNetId"), "camera" to ev.g("cameraNetId"), "kit" to ev.g("kitNetId"))
        }
      }
      "DestroyPlayer" -> players.remove(JsOps.key(ev["playerId"]))
      "SetTeam" ->
        // Our side as the server now has it, so a rejoin asks for the same one.
        if (JsOps.eq(ev["playerId"], me.playerId) && (JsOps.eq(ev["team"], 1) || JsOps.eq(ev["team"], 2))) me.team = ev["team"]
      "GameStatus" -> {
        // Status 5: the level's last round is over and the server will restart
        // itself for the next level; its tail is the reconnect password and
        // the next mod (rejoin.mjs). Sent twice (gameStatusFirstEndGame, then
        // gameStatusEndGame just before the 0x19 disconnects); the first is
        // the one that reliably arrives.
        val rc = reconnectFromGameStatus(JsOps.num(ev["status"])?.toInt(), ev["extra"] as? ByteArray, ev["text"] as? String)
        if (rc != null) { levelChange = rc; emit("level-change", rc.toJs()) }
      }
      "ChatFragment" -> {
        // The server sends this connection one line at a time
        // (StringManager::updateSendStream 0x0815d3c0), so one assembler.
        // A piece the engine's receiver would refuse is reported and the line
        // dropped; a first piece then starts afresh rather than be lost too.
        val piece = chatPiece(ev)
        var line = chatIn.push(piece)
        if (line?.refused != null) {
          emit("decode-error", linkedMapOf("where" to "chat", "seq" to seq, "message" to line.refused))
          chatIn.reset()
          line = if (piece.first) chatIn.push(piece) else null
        }
        if (line != null && line.refused == null) emit("event", JsOps.spread(linkedMapOf("type" to "Chat"), jsValue(line.toJs()) as Map<String, Any?>))
      }
      "WelcomeMsg" -> {
        // bf42++ parses every welcome line for its settings
        // (gameevent.cpp:153-157 -> settings.cpp:306); a retail client
        // shows the line and nothing more.
        val before = plus.settings.seen.size
        parseServerSettings(ev["message"] as? String, plus.settings, templateExists)
        if (plus.settings.seen.size > before) emit("plus-settings", plus.settings)
      }
      "SpecialGame" ->
        // gameevent.cpp:225-236: action 2 before this connection's SetLevel
        // means "do not run the level's StaticObjects.con". After the
        // SetLevel it is passed on as an ordinary SpecialGame.
        if (JsOps.eq(ev["kind"], 2) && !plus.setLevelSeen && !plus.skipStaticObjects) {
          plus.skipStaticObjects = true
          emit("skip-static-objects")
        }
      "ServerInfo" -> { me.mapId = JsOps.coalesce(ev.g("mapId")) { null } as String?; me.contentMod = (JsOps.coalesce(ev.g("mod")) { me.contentMod }) as String? }
      "SetLevel" -> {
        plus.setLevelSeen = true
        me.level = linkedMapOf("levelPath" to ev.g("levelPath"), "modeFile" to ev.g("modeFile"))
      }
      "SetDefaultVehicle" -> if (!JsOps.nullish(ev.g("netId"))) soldiers.add(JsOps.key(ev["netId"])) // on-foot control object
      "CreateObject" -> objects[JsOps.key(ev["netId"])] = ev
      "DestroyObject" -> objects.remove(JsOps.key(ev["netId"]))
      "DataBaseComplete" -> if (!me.dbAcked) {
        me.dbAcked = true
        val lvl = me.level
        val crc = if (lvl != null) contentCrcFor(JsOps.spread(linkedMapOf("mod" to me.contentMod, "mapId" to me.mapId), lvl)) else null
        queue("Ack", linkedMapOf("value" to contentAck(me.challenge0, crc).toDouble()))
        if (me.playerId != null) queue("CreatePlayerAck", linkedMapOf("playerId" to me.playerId))
        queue("DatabaseCompleteAck")
        queue("ConnectionType", linkedMapOf("connType" to 5.0))
      }
      "Simulation" -> if (!joined) {
        joined = true
        emit("joined", linkedMapOf("playerId" to me.playerId, "team" to me.team, "players" to players.size.toDouble(),
          "objects" to objects.size.toDouble(), "worldTime" to ev.g("worldTime")))
      }
      else -> {}
    }
  }

  private fun chatPiece(ev: Map<String, Any?>): ChatPiece {
    val first = ev["first"] == true
    return if (!first) ChatPiece(false, (ev["text"] as? String) ?: "")
    else ChatPiece(true, (ev["text"] as? String) ?: "", team = ev["team"] as? Boolean, noSender = ev["noSender"] as? Boolean,
      serverFlag = ev["serverFlag"] as? Boolean, playerId = JsOps.num(ev["playerId"])?.toInt(), total = JsOps.num(ev["total"])?.toInt())
  }
}

private fun hexFrom(r: BitReader, bitOffset: Int): String {
  val startByte = bitOffset shr 3
  return r.buf.hex(minOf(startByte, r.buf.size), minOf(r.buf.size, startByte + 48))
}

private fun bitSliceHex(payload: ByteArray, atBit: Int, nBits: Int): String {
  val out = ByteArray((nBits + 7) shr 3)
  for (i in 0 until nBits) {
    val bit = atBit + i
    if ((payload[bit shr 3].toInt() shr (bit and 7)) and 1 != 0) out[i shr 3] = (out[i shr 3].toInt() or (1 shl (i and 7))).toByte()
  }
  return out.hex()
}
