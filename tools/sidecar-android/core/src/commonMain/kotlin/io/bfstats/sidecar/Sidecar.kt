package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/sidecar.mjs; keep in step.
//
// The sidecar: join a real BF1942 server, decode its stream, and (a) write a
// bf42plus-v5 replay recording the existing replayer opens unchanged, and (b)
// send everything not yet decodable -- the framed per-object ghost (movement)
// deltas and any unknown event or datagram -- to a review log, the corpus to
// decode next. The recording streams live over a localhost WebSocket for the
// page (map.html?sidecar=127.0.0.1:<port>).
//
// One Sidecar is one join, as sidecar.mjs is one process per join: the
// Android app (SidecarService) and the JVM CLI (tools/SidecarMain) drive it.
// `JoinConfig` carries sidecar.mjs's options; `SidecarHost` what Node takes
// from its runtime (the event loop, the UDP sockets, the page socket, the
// files, the clock the header reads, the background work, process.exit), so
// a test drives all of it.
//
// Port notes. Everything runs on the host's loop (Node's one thread): the UDP
// receive thread and the page socket's threads post onto it. What Node awaits
// on I/O (the pre-join query, a level's tables) runs on `host.work` and posts
// its answer back. A page frame is bytes whatever the WebSocket frame type
// (Node turns a text frame into a Buffer too). The CLI's SIGINT and
// --leave-on-stdin are `leave()`; process.exit is `host.exit`.

import kotlin.concurrent.Volatile

/** One join: the server, who the player is, and sidecar.mjs's other options. */
data class JoinConfig(
  val host: String,
  val port: Int,
  /** --name: the player name in the CreatePlayer. */
  val name: String = "sidecar",
  /** --team: 0 = auto-assign; set to a human's team to receive their movement. */
  val team: Int = 0,
  /** --password: the server's join password. */
  val password: String = "",
  /** The level the live list says the server plays (the app's server row; informational). */
  val mapId: String? = null,
  val mapName: String? = null,
  val gameType: String? = null,
  /** --ws: the page socket's port, 0 for any free one, null for no page socket. */
  val wsPort: Int? = 0,
  /** --allow-origin, repeatable. */
  val allowOrigins: List<String> = emptyList(),
  /** --name-from-page: the page names the player; the connect waits --name-wait seconds for it. */
  val nameFromPage: Boolean = false,
  val nameWaitS: Double = 15.0,
  /** --stay: leave after this many seconds (0 = until stop()). */
  val stayS: Double = 0.0,
  /** --out, --review: the recording and the review log (null: none written). */
  val outPath: String? = null,
  val reviewPath: String? = null,
  /** --names: a tid->template map or recording that names objects. */
  val namesFile: String? = null,
  /** --rejoin-horizon: how long to keep getting back on after a drop. */
  val rejoinHorizonS: Double = 600.0,
  /** --connect-timeout: tell the page the server is unreachable after this long. */
  val connectTimeoutS: Double = 10.0,
  /** --retail: join as a retail client rather than bf42++. */
  val retail: Boolean = false,
  /** --plus-version a.b.c.d: the bf42++ version reported. */
  val plusVersion: PlusVersion? = null,
  /** --pace: the input pacing law (server | bucket | slot). */
  val pace: String = "server",
  /** --word-log: k:"iw" / k:"im" rows in the recording. */
  val wordLog: Boolean = false,
  /** --cdkey: the base game's CD key (else SIDECAR_CDKEY, else a generated one). */
  val cdkey: String? = null,
  /** --tables-url: where the level tables are published ("off" for none). */
  val tablesUrl: String? = null,
  /** --level-wait: how long a level load waits for its tables. */
  val levelWaitS: Double = 30.0,
  /** --query-port: the server's GameSpy query port for the pre-join look. */
  val queryPort: Int? = null,
  /** --no-prejoin: skip the pre-join look. */
  val noPrejoin: Boolean = false,
  /** The host's cache folder (the level tables) and config folder (the CD keys);
   *  null for the desktop defaults. Android passes its own. */
  val cacheDir: FsFile? = null,
  val configDir: FsFile? = null,
) {
  /** "host:port" as the CLI's first argument. */
  val target: String get() = "$host:$port"
}

/** The page's socket, as the sidecar uses it (wsserver.mjs WSServer). */
interface PageHub {
  var onConnection: (PageSocket) -> Unit
  var onRefused: (String?) -> Unit
  /** Bind and listen; the port. */
  fun listen(): Int
  fun broadcast(text: String)
  val clientCount: Int
  fun close()
}
interface PageSocket {
  fun send(text: String)
  /** A frame from the page, as bytes. */
  var onMessage: (ByteArray) -> Unit
  var onClose: () -> Unit
}

/** The real page socket: WsServer, its callbacks posted onto the loop, and
 *  each socket's writes on a thread of its own so a slow page never holds
 *  the loop. */
class WsPageHub(private val port: Int, allowOrigins: List<String>, private val loop: Scheduler) : PageHub {
  // The live monitor page at / (wsserver.mjs staticFile, sidecar/page/index.html).
  private val server = WsServer(port, allowOrigins = allowOrigins, staticPage = { EmbeddedResources.text("sidecar/page/index.html")?.encodeToByteArray() })
  private val lock = Lock()
  private var sockets: List<Sock> = emptyList() // copy on write
  override var onConnection: (PageSocket) -> Unit = {}
  override var onRefused: (String?) -> Unit = {}
  override val clientCount: Int get() = lock.withLock { sockets.size }

  private inner class Sock(val ws: WsSocket) : PageSocket {
    private val writer = loopExecutor("ws-send")
    override var onMessage: (ByteArray) -> Unit = {}
    override var onClose: () -> Unit = {}
    override fun send(text: String) { if (!writer.isShutdown) writer.submit { ws.send(text) } }
    fun closed() { lock.withLock { sockets = sockets - this }; writer.shutdown() }
  }

  override fun listen(): Int {
    server.onRefused = { o -> loop.post { onRefused(o) } }
    server.onConnection = { ws ->
      val s = Sock(ws)
      ws.onMessage = { text, bin -> val b = bin ?: text!!.encodeToByteArray(); loop.post { s.onMessage(b) } }
      ws.onClose = { s.closed(); loop.post { s.onClose() } }
      // The connection is handed over on the loop and its frames queue behind it.
      val ready = Latch()
      loop.post { lock.withLock { sockets = sockets + s }; try { onConnection(s) } finally { ready.countDown() } }
      ready.await(5000)
    }
    return server.listen()
  }

  override fun broadcast(text: String) { for (s in lock.withLock { sockets }) s.send(text) }
  override fun close() { server.close() }
}

/** What sidecar.mjs takes from Node's runtime, injectable. */
class SidecarHost(
  /** The event loop every callback runs on. */
  val loop: Scheduler = EventLoop("sidecar-loop"),
  /** A UDP socket (the session's, a rejoin probe's); null for the real one. */
  val transport: () -> Transport? = { null },
  /** The page socket. */
  val pageHub: (port: Int, allowOrigins: List<String>, loop: Scheduler) -> PageHub = { p, o, l -> WsPageHub(p, o, l) },
  /** Blocking work off the loop (the pre-join query, a level's tables); a test runs it inline. */
  // A failure here (an Error included) is logged and never takes the process
  // with it: in the Android app that process is the whole app.
  val work: (() -> Unit) -> Unit = { task ->
    startThread("sidecar-work") {
      try { task() } catch (t: Throwable) { printErr("[sidecar] background work failed: $t") }
    }
  },
  /** The recording and review files. */
  val openWriter: (String) -> TextSink = { p -> fileTextSink(p) },
  /** The recording header's start time in epoch ms (Node's new Date()). */
  val wallNow: () -> Long = { wallMillis() },
  /** The pre-join look: {mod, level, mode, name, source} or null. */
  val queryServerLevel: (host: String, port: Int, queryPort: Int?) -> Map<String, Any?>? = { h, p, q -> io.bfstats.sidecar.queryServerLevel(h, p, q) },
  /** LevelTables.prepareLevel (blocking). */
  val prepareLevel: (mod: Any?, level: Any?, mode: Any?, timeoutMs: Long) -> Map<String, Any?> = { m, l, md, t -> LevelTables.prepareLevel(m, l, md, timeoutMs = t) },
  /** process.exit: the run is over (after the 150 ms Node gives its writes). */
  val exit: (Int) -> Unit = {},
  /** For the key hash's r. */
  val randomInt: (Int) -> Int = defaultRandomInt,
  /** Close the session's socket and timers once the run has exited (Node's
   *  process.exit does). A parity replay keeps them, as Node's faked exit does. */
  val teardownOnExit: Boolean = true,
  /** The lab's path faults (SIDECAR_LAG_MS, ...). */
  val faults: PathFaults = PathFaults.fromEnv(),
  /** process.env, for SIDECAR_DEBUG and SIDECAR_LEVEL_WAIT_S. */
  val env: Map<String, String?> = systemEnv(),
  /** The CD key store (cdkey.mjs); null builds the default from the config. */
  val keyFor: ((Long?) -> String?)? = null,
)

class Sidecar(
  val config: JoinConfig,
  private val log: (String) -> Unit = {},
  val host: SidecarHost = SidecarHost(),
  /** Node's console.error (two fallback warnings at a level load); the CLI
   *  sends it to stderr, as Node does. */
  private val logErr: (String) -> Unit = log,
) {
  private val loop = host.loop
  private val target = config.target
  private val srvHost = config.host
  private val srvPort = config.port
  // The player name in the CreatePlayer. With nameFromPage the page names
  // it: the socket comes up first, the page sends `{type:'identity', name}`
  // (its account profile's player name, or null for none) and the connect
  // waits for it, nameWaitS at most (15), then joins as `name`
  // (features/game-profiles). A rejoin keeps the name the session joined with.
  private var name = config.name
  private val nameFromPage = config.nameFromPage
  private val nameWaitS = config.nameWaitS
  private val team = config.team
  private val stay = config.stayS
  private val outPath = config.outPath
  private val reviewPath = config.reviewPath
  private val wsPort = config.wsPort
  private val allowOrigins = config.allowOrigins
  private val namesFile = config.namesFile
  private val rejoinHorizonS = config.rejoinHorizonS
  private val connectTimeoutS = config.connectTimeoutS
  private val retail = config.retail
  private val inputPace = config.pace
  private val wordLog = config.wordLog
  private val serverPassword = config.password
  private val levelWaitMs = (config.levelWaitS * 1000).toLong()
  private val queryPortOpt = config.queryPort
  private val keyFor: (Long?) -> String? = host.keyFor ?: run {
    val file = if (config.configDir != null) FsFile(config.configDir, "cdkeys.json") else defaultKeyFile()
    val store = cdKeyStore(override = config.cdkey?.takeIf { it.isNotEmpty() } ?: host.env["SIDECAR_CDKEY"], file = file, randomInt = host.randomInt)
    ({ x: Long? -> store(x) })
  }
  private val plusIdentity: PlusIdentity? = if (retail) null else (config.plusVersion?.let { PlusIdentity(version = it) } ?: PlusIdentity())
  private val names: MutableMap<String, Any?> =
    if (namesFile != null) Names.loadTidNames(FsFile(namesFile)) else linkedMapOf("tidNames" to LinkedHashMap<String, Any?>(), "animStates" to null)
  // Without namesFile, the level's saved map (templates/<level>.json) and the
  // class map name the objects once setLevel says which level this is.
  @Suppress("UNCHECKED_CAST")
  private val tidNames: MutableMap<String, Any?> = names["tidNames"] as MutableMap<String, Any?>
  init { names["fileTidNames"] = LinkedHashMap(tidNames) }
  // The engine's animation state table (from the same source) names the lower
  // and upper state indices in a soldier's body: the replayer reads a stance
  // (prone, crouch) and a fire from them through the v4 `anim` record.
  private var animStates: Any? = names["animStates"]
  private val namesAnim: Any? = names["animStates"] // a namesFile table's: fixed for the run
  private var serverMod: Any? = null // the server's mod, from its ServerInfo event: picks the install's mod for the tables

  private val outFile: TextSink? = outPath?.let { host.openWriter(it) }
  // The recording. A row after the run ended (a datagram in the moment before
  // the exit) is dropped: Node's stream would raise write-after-end there.
  private var outEnded = false
  private val out = object {
    fun write(s: String) { if (!outEnded) outFile?.write(s) }
    fun close() { outEnded = true; outFile?.close() }
  }
  private val review = ReviewLog(reviewPath, loop.clock, reviewPath?.let { host.openWriter(it) })
  private fun wall() = loop.clock.wallMs()
  private var t0 = wall()
  private fun now(): Double = JsOps.toFixed((wall() - t0) / 1000, 3)

  // The page socket as the feed: null until the feed starts, as Node's `ws`
  // is null until startFeed (nothing is broadcast before then); `pageHub` is
  // the socket listening from start().
  private var ws: PageHub? = null
  private var pageHub: PageHub? = null
  @Volatile var wsBoundPort: Int = -1; private set

  // What a page needs to JOIN a session that is already running: the live
  // snapshot (live-snapshot.mjs).
  private val liveState = createLiveState()

  private fun writeRec(obj: Map<String, Any?>) {
    val line = Js.stringify(obj)
    out.write(line + "\n")
    liveState.remember(obj)
    ws?.broadcast(line)
  }

  private val stats = linkedMapOf<String, Any?>("events" to 0.0, "records" to 0.0, "raws" to 0.0, "ghostBlocks" to 0.0, "ghostRecords" to 0.0,
    "samples" to 0.0, "stances" to 0.0, "objects" to 0.0, "unknownEvents" to 0.0)
  private fun bump(k: String, by: Int = 1) { stats[k] = (stats[k] as Double) + by }
  // Per-object identity, to name each object when it comes into scope (k:"o").
  private val objInfo = LinkedHashMap<Any?, MutableMap<String, Any?>>() // netId -> {tid, tmpl, team}
  private val pidTeam = LinkedHashMap<Any?, Any?>()
  // The writer's control point names ARE a --names file's (`names.cpNames ??
  // {}` in Node, by reference): the first level fills them, and a later level
  // then keeps them (the refresh below is skipped once they are not empty).
  @Suppress("UNCHECKED_CAST")
  private val ghosts = GhostWriter(write = { row -> writeRec(row) }, objInfo = objInfo,
    cpNames = (names["cpNames"] as? MutableMap<String, Any?>) ?: LinkedHashMap<String, Any?>(),
    animName = GhostRows.animNamer { animStates })
  @Suppress("UNCHECKED_CAST")
  private val ghostCpNames get() = ghosts.cpNames as MutableMap<String, Any?>

  // The session is replaced when the server drops the connection (a level
  // change restarts the server; a retail client rejoins then too, rejoin.mjs),
  // so it is a `var` and every handler is attached by wire() below.
  // The level's tables on a machine without the install come from the
  // published bake (level-tables.mjs): fetched before the connect when the
  // server says what it is playing, and on every SetLevel, which the session
  // holds as the retail client's level load until they are in the cache.
  private val levelGate: LevelGate = { info, done ->
    val m = info["mod"].takeIf { JsOps.truthy(it) } ?: info["mapId"]
    if (JsOps.truthy(m) && JsOps.truthy(info["levelPath"])) {
      host.work {
        // Node's prepareLevel never rejects; a JVM error here still releases the hold.
        val r = try { host.prepareLevel(m, info["levelPath"], info["modeFile"], levelWaitMs) } catch (t: Throwable) { log("[sidecar] level tables failed: $t"); null }
        done(r)
      }
      true
    } else false
  }
  private fun newSession(reconnectPassword: String = "", team: Int = this.team): Session = Session(srvHost, srvPort, SessionOptions(
    name = name, team = team, password = serverPassword, reconnectPassword = reconnectPassword,
    levelGate = levelGate, levelHoldMs = levelWaitMs.toDouble(),
    animStates = (namesAnim as? List<*>)?.size?.toDouble() ?: 0.0,
    plus = plusIdentity,
    keyFor = keyFor,
    // A 3DO setting names a template; the level's table says whether it exists.
    templateExists = { n -> tidNames.values.any { JsOps.str(it).lowercase() == n.lowercase() } },
    randomInt = host.randomInt, transport = host.transport(), faults = host.faults,
  ), loop)
  private var s: Session = newSession()

  // ---- the page's own messages -----------------------------------------------
  //
  // The page sends the room protocol's frames (viewer/netcode.js), so the browser
  // game's input path is unchanged: 0x02 input, 0x05 action JSON, 0x04 leave. The
  // sidecar is the client, so these become the engine's own messages to the
  // server. Nothing here is sent before the join: an input datagram and a
  // SpawnRequest both null-deref with no BFPlayer bound (the crash class J-8
  // belongs to), and the InputSender and spawnSequence refuse before it.
  private object PAGE { const val INPUT = 0x02; const val PING = 0x03; const val LEAVE = 0x04; const val ACTION = 0x05 }
  private var inputSender: InputSender? = null

  // The page's input sequence against the engine's serials (see sidecar.mjs):
  // each serial sent remembers the newest page word it carried, and an echoed
  // serial becomes the page's ack.
  private var lastPageSeq = 0.0

  // Where the sidecar stands with the server, for the page: `connecting` (no
  // answer yet), `joined`, `rejoining` (dropped, getting back on),
  // `unreachable` (no answer within connectTimeoutS; still trying), `denied`
  // (the server refused the join) or `lost` (the rejoin gave up). Sent to every
  // page on connect and on each change. Not a recording row: it describes this
  // process, not the round.
  private var serverState: Map<String, Any?> = linkedMapOf("k" to "server", "state" to "connecting", "server" to target)
  /** The server state as the page last heard it. */
  val state: String get() = serverState["state"] as String
  private fun setServerState(state: String, extra: Map<String, Any?> = emptyMap()) {
    serverState = JsOps.spread(linkedMapOf("k" to "server", "state" to state, "server" to target), extra)
    ws?.broadcast(Js.stringify(serverState))
  }
  private var lastSpawn: SpawnOptions? = null // the page's last deploy, replayed after a reconnect
  // True once this player has deployed at all. A page join may choose a side
  // before that and must not after it: see the join handler.
  private var everSpawned = false
  // The page's side choice: held while the server has no player for it (a page
  // that connects during the first connect or a rejoin) and sent at the join
  // (page-team.mjs).
  private val pageTeam = createPageTeam(
    send = { t -> try { sendTeam(s, t) } catch (e: Exception) { log("[sidecar] page team failed: ${e.message}") } },
    log = { line -> log("[sidecar] $line") },
  )
  private fun teamState() = TeamState(joined = s.joined && !rejoiner.active, team = s.me.team, everSpawned = everSpawned)
  // A button the page asked for by message rather than in its input word, held
  // for PULSE_MS so the server's tick sees it down.
  private val PULSE_MS = 200.0
  private var pulseMask = 0L
  private var pulseUntil = 0.0
  // A non-repetitive trigger (Reload, a MenuSelect) is a one-tick press: it
  // rides the next page word only. Use is push-and-hold, so it is held.
  private var oneShot = 0L
  private fun press(mask: Long) {
    if ((mask and ONE_SHOT_BUTTONS) == mask) { oneShot = (oneShot or mask) and 0xffffffffL; return }
    pulseMask = mask and 0xffffffffL
    pulseUntil = wall() + PULSE_MS
  }
  // The page's word speaks levels; the engine's record wants the retail shape
  // (input.mjs PageButtonEdges: one tick per press for every non-repetitive
  // trigger). A message-borne press (Reload, a MenuSelect) rides the next word.
  private val pageEdges = PageButtonEdges()
  private fun edgesOf(action: Action): Action {
    val b = pageEdges.apply(action.buttons.toDouble(), oneShot.toDouble())
    if (!host.env["SIDECAR_DEBUG"].isNullOrEmpty() && (b and ONE_SHOT_BUTTONS) != 0L) log("[sidecar] one-shot ${(b and ONE_SHOT_BUTTONS).toString(16)}")
    oneShot = 0
    return Action(action.axes, b)
  }
  private val pageSeqBySerial = LinkedHashMap<Long, Double>()

  // A page leaving idles the input, it does not stop the sender: the server
  // keeps only a serial newer than the last it ran (D-4), so a fresh sender
  // starting again at serial 1 for the next page was silently ignored.
  private fun pageGone() {
    inputSender?.let { it.pending.clear(); it.setInput(null) }
    lastPageSeq = 0.0
    pageEdges.reset(); oneShot = 0
    pageSeqBySerial.clear()
  }

  // A sender belongs to one session (see sidecar.mjs ensureSender).
  private fun ensureSender() {
    val cur = inputSender
    if (cur != null && cur.session === s) return
    if (rejoiner.active || !s.joined) return
    val rtts = cur?._rtts?.toList() ?: emptyList()
    if (cur != null) { cur.stop(); log("[sidecar] input sender moved to the new session") }
    pageSeqBySerial.clear()
    stalledSeen = 0
    val sender = InputSender(s, InputSenderOptions(rate = 30.0, idle = "zero", pace = inputPace,
      mergeAbove = when (inputPace) { "slot" -> Double.POSITIVE_INFINITY; "bucket" -> 3.0; else -> null },
      idleButtons = {
        // The page's message-borne presses ride the idle records too when the
        // page sends no words (its deploy screen).
        var b = if (wall() < pulseUntil) pulseMask else 0L
        if (oneShot != 0L) { b = b or oneShot; oneShot = 0 }
        b.toDouble()
      }), loop)
    inputSender = sender
    // The same server's round trip, so a rejoin's first acks are not read whole.
    for (ms in rtts) sender.noteRtt(ms)
    sender.on("sent") { p ->
      // Only a page word acknowledges a page tick; an idle record is a tick the
      // page never ran.
      val tag = p.g("tag")
      if (!JsOps.isInt(tag)) return@on
      pageSeqBySerial[(p.g("serial") as Number).toLong()] = JsOps.num(tag)!!
      if (pageSeqBySerial.size > 600) pageSeqBySerial.remove(pageSeqBySerial.keys.first())
    }
    if (wordLog) {
      fun wallOf(perfAt: Any?): Any? = if (JsOps.nullish(perfAt)) null else JsOps.toFixed(now() - (sender.clock() - JsOps.toNumber(perfAt)) / 1000, 4)
      sender.on("sent") { p ->
        val tag = p.g("tag")
        out.write(Js.stringify(linkedMapOf("k" to "iw", "s" to p.g("serial"), "q" to (if (JsOps.isInt(tag)) tag else null), "idle" to JsOps.truthy(p.g("idle")),
          "r" to wallOf(p.g("recvAt")), "l" to wallOf(p.g("relAt")))) + "\n")
      }
      sender.on("merged") { p -> out.write(Js.stringify(linkedMapOf("k" to "im", "t" to now(), "s" to p.g("serial"), "n" to p.g("words"))) + "\n") }
    }
    sender.start()
    log("[sidecar] input path live: 30 Hz, idle = zero input")
  }

  // The page's 17-byte action carries the engine's own 104-bit record in its
  // first 13 bytes: six 12-bit channels little-endian from bit 0, then the u32
  // button mask at bit 72 (viewer/netcode.js encodeInput).
  private fun actionFromPageBytes(bytes: ByteArray, from: Int): Action {
    fun bit(b: Int): Boolean { val i = from + (b shr 3); return i < bytes.size && (bytes[i].toInt() and (1 shl (b and 7))) != 0 }
    val axes = DoubleArray(6)
    for (ch in 0 until 6) {
      var v = 0
      for (i in 0 until 12) if (bit(ch * 12 + i)) v = v or (1 shl i)
      axes[ch] = v.toDouble()
    }
    var buttons = 0L
    for (i in 0 until 32) if (bit(72 + i)) buttons = buttons or (1L shl i)
    // Two of the page's bits are the room protocol's own (netcode.js): bit 22 is
    // its jump, which the page binds to c_PIAction, the engine's bit 1; bit 23
    // is the touch pad's flag, which the engine reads as nothing.
    if ((buttons and (1L shl 22)) != 0L) buttons = buttons or BUTTON.ACTION
    buttons = buttons and ((1L shl 22) or (1L shl 23)).inv() and 0xffffffffL
    return Action(axes, buttons)
  }

  // Who the page says the player is (nameFromPage): the first identity
  // settles the name the session connects with; anything after it is too late.
  private inner class Identity {
    var settled: Pair<String, String>? = null
    var onSettle: ((Pair<String, String>) -> Unit)? = null
    private fun done(v: Pair<String, String>) {
      if (settled != null) return
      settled = v
      onSettle?.invoke(v)
    }
    fun offer(raw: String?) {
      if (!nameFromPage) return
      if (settled != null) {
        if (raw != null && validPlayerName(raw) != name) log("[sidecar] page identity ignored: already ${if (s.joined) "joined" else "joining"} as \"$name\"")
        return
      }
      if (raw == null) { log("[sidecar] the page has no profile name"); done(name to "fallback"); return }
      val clean = validPlayerName(raw)
      if (clean == null) {
        log("[sidecar] the page's name ${Js.stringify(raw).take(80)} cannot be sent (control characters, quotes or characters beyond Latin-1)")
        done(name to "fallback")
        return
      }
      done(clean to "from the page")
    }
    fun timeout() {
      if (settled != null) return
      log("[sidecar] no identity from a page within ${JsOps.str(nameWaitS)} s")
      done(name to "fallback")
    }
  }
  private val identity = Identity()

  private fun onPageAction(row: Any?) {
    if (row !is Map<*, *>) return
    val type = row.g("type")
    if (type == "identity") { identity.offer(row.g("name") as? String); return }
    if (type == "join") {
      // Joining is not spawning: the page's deploy screen sends the spawn
      // ('spawn' below). A side named here is chosen (SetTeam) so the deploy
      // screen opens on the right tab (page-team.mjs holds it until the join).
      val t = JsOps.toNumber(row.g("team"))
      val did = pageTeam.offer(t, teamState())
      if (did == "held") ws?.broadcast(Js.stringify(serverState))
      log("[sidecar] page joined${if (JsOps.truthy(t)) " (team ${JsOps.str(t)})" else ""}")
      return
    }
    if (type == "spawn") {
      // The deploy screen's commit: the side, the kit and the spawn group, as a
      // retail client sends them (SetTeam 0x39, ChangeKit 0x3e, SpawnRequest 0x2f).
      if (!s.joined) return
      val group = JsOps.toNumber(row.g("spawnGroup"))
      val kit = if (JsOps.isInt(row.g("kitIndex"))) row.g("kitIndex") else 0.0
      if (!JsOps.isInt(group) || group <= 0) { log("[sidecar] page spawn with no spawn group: ${Js.stringify(row)}"); return }
      try {
        val rt = row.g("team")
        lastSpawn = SpawnOptions(team = if (JsOps.eq(rt, 1) || JsOps.eq(rt, 2)) rt else null, kit = kit, spawnGroup = group)
        everSpawned = true
        spawnSequence(s, lastSpawn!!, loop) { r -> r.exceptionOrNull()?.let { log("[sidecar] page spawn failed: ${it.message}") } }
        log("[sidecar] page spawn: team ${JsOps.str(JsOps.coalesce(rt) { s.me.team })} kit ${JsOps.str(kit)} group ${JsOps.str(group)}")
      } catch (e: Exception) { log("[sidecar] page spawn failed: ${e.message}") }
      return
    }
    // The page's seat rows and its reload are buttons on the engine's input
    // word, not messages (SEAT-1, SEAT-2, SEAT-11, c_PIReload).
    if (type == "seat") {
      val seat = row.g("seat")
      if (row.g("action") == "switch" && JsOps.isInt(seat) && JsOps.toNumber(seat) >= 0 && JsOps.toNumber(seat) < 9) {
        press(BUTTON.byName.getValue("MENU${JsOps.toNumber(seat).toInt() + 1}"))
      } else {
        press(BUTTON.USE)
      }
      return
    }
    if (type == "reload") { press(BUTTON.RELOAD); return }
    // The spawn screen's SUICIDE: SuicideEvent (0x33, no fields).
    if (type == "suicide") {
      if (!s.joined) return
      s.queue("Suicide", emptyMap())
      log("[sidecar] page suicide")
      return
    }
    if (type == "radio") {
      s.queue("RadioMessage", linkedMapOf("message" to row.g("msg"), "broadcast" to JsOps.truthy(row.g("team")), "playerId" to s.me.playerId))
      return
    }
    if (type == "chat") {
      // The page's typed line, all or team (input.mjs sendChat, chat.mjs).
      if (!s.joined) return
      try {
        if (!sendChat(s, JsOps.str(JsOps.coalesce(row.g("text")) { "" }), JsOps.truthy(row.g("team")))) log("[sidecar] page chat dropped (empty, or four lines waiting)")
      } catch (e: Exception) { log("[sidecar] page chat failed: ${e.message}") }
      return
    }
    // Anything else the page sends has no counterpart on this wire yet.
  }

  // Page words that never reach the wire are a soldier the server never moves:
  // say so, at most every five seconds.
  private var stalledWarnAt = 0.0
  private var stalledSeen = 0
  private fun warnIfStalled() {
    val sender = inputSender ?: return
    val dropped = sender.stats.dropped ?: 0
    if (dropped == stalledSeen || wall() < stalledWarnAt) return
    log("[sidecar] page input is not reaching the server: ${dropped - stalledSeen} words dropped (connection ${sender.session?.conn?.state}, joined ${sender.session?.joined})")
    stalledSeen = dropped
    stalledWarnAt = wall() + 5000
  }

  private fun onPageFrame(buf: ByteArray) {
    if (buf.isEmpty()) return
    val type = buf[0].toInt() and 0xff
    if (type == PAGE.INPUT) {
      ensureSender()
      val sender = inputSender ?: return
      try {
        var action = edgesOf(actionFromPageBytes(buf, 5))
        if (wall() < pulseUntil) action = Action(action.axes, (action.buttons or pulseMask) and 0xffffffffL)
        if (buf.size < 5) throw IndexOutOfBoundsException("short frame")
        val pageSeq = buf.u32le(1).toDouble()
        lastPageSeq = pageSeq
        sender.enqueue(action, pageSeq)
        warnIfStalled()
      } catch (_: Exception) { /* a malformed frame is not worth a crash */ }
      return
    }
    if (type == PAGE.ACTION) {
      val row = try { JsOps.parse(buf.decodeToString(1, 1 + buf.size - 1)) } catch (_: Exception) { return }
      onPageAction(row)
      return
    }
    if (type == PAGE.LEAVE) {
      // The page is done, not the sidecar: a page leaving (or reloading) stops
      // the input and leaves the player standing.
      pageGone()
      log("[sidecar] the page left; input idle, still on the server")
    }
  }

  // The page's socket: listening from start(), so the app has its port; the
  // feed is announced where Node starts it (the session's open, or before the
  // connect with nameFromPage).
  private var feedAnnounced = false
  // Node listens only from the session's open (or before the connect with
  // nameFromPage), so a page cannot connect before that: here the socket is
  // up from start() (the app needs its port first), and a page that connects
  // early is taken in at that moment, in order, its frames with it. One that
  // leaves before then was never there.
  private var feedLive = false
  private val earlyPages = ArrayList<Pair<PageSocket, ArrayList<ByteArray>>>()
  private fun takeEarlyPages() {
    feedLive = true
    val early = earlyPages.toList()
    earlyPages.clear()
    early.forEachIndexed { i, (sock, frames) ->
      // As each would have counted itself connecting: those after it not yet.
      onPageConnection(sock, later = early.size - 1 - i)
      for (f in frames) sock.onMessage(f)
    }
  }
  private fun listenFeed(): Int {
    val p = wsPort ?: return -1
    val hub = host.pageHub(p, allowOrigins, loop)
    hub.onRefused = { o -> log("[sidecar] page refused: origin $o is not allowed (--allow-origin adds one)") }
    hub.onConnection = { sock ->
      if (feedLive) onPageConnection(sock)
      else {
        val held = sock to ArrayList<ByteArray>()
        earlyPages += held
        sock.onMessage = { f -> held.second += f }
        sock.onClose = { earlyPages.remove(held) }
      }
    }
    val bound = hub.listen()
    pageHub = hub
    wsBoundPort = bound
    return bound
  }
  private fun onPageConnection(sock: PageSocket, later: Int = 0) {
    val hub = ws!!
    run {
      // The world as it stands, not the round's history.
      val snap = liveState.liveSnapshot()
      for (l in snap) sock.send(l)
      log("[sidecar] page connected (${hub.clientCount - later} open): snapshot of ${snap.size} rows, ${liveState.live.events.keys.count { it.startsWith("createPlayer|") }} players, ${liveState.live.objects.size} objects (${serverState["state"]})")
      // What follows is happening now.
      sock.send(Js.stringify(linkedMapOf("k" to "live")))
      // Whether there is a server behind this feed at all.
      sock.send(Js.stringify(serverState))
      // Who this client is, by the server's own player id.
      if (s.joined && s.me.playerId != null) sock.send(Js.stringify(linkedMapOf("k" to "me", "pid" to s.me.playerId)))
      sock.onMessage = { data -> onPageFrame(data) }
      sock.onClose = {
        // Same as an explicit leave: the player stands still.
        pageGone()
        log("[sidecar] page socket closed (${hub.clientCount} open)")
      }
      ensureSender()
    }
  }
  private fun announceFeed() {
    if (feedAnnounced || pageHub == null) return
    feedAnnounced = true
    ws = pageHub
    log("[sidecar] live feed: http://127.0.0.1:$wsBoundPort/  (ws on the same port)")
    takeEarlyPages()
  }

  private var opened = false
  // What each wire() keeps (a `let` or `const` inside it in Node): a
  // rejoin's session starts afresh, its carried control state included (a
  // netId the new level reuses must not inherit the old level's aim, hull
  // registers or magazines).
  private class WireState {
    var lastServerName: Any? = null
    val selfAim = LinkedHashMap<Any?, MutableMap<String, Any?>>() // soldier netId -> { aim, twist, q } as of the newest control state
    val selfHullState = HashMap<Any?, MutableMap<String, Any?>>() // hull netId -> { pos, rot, vecA } as of the newest control state
    val selfMags = HashMap<Any?, Any?>()      // controlled netId -> controlMagazines' last answer
  }

  private fun wire(s: Session) {
    val ws0 = WireState()
    s.on("open") { _ ->
      if (opened) return@on            // a reconnect keeps the recording and the page's socket
      opened = true
      t0 = wall()
      writeRec(Record.header(10.0, linkedMapOf("host" to srvHost, "port" to srvPort.toDouble(), "name" to name), host.wallNow()))
      if (animStates != null) writeRec(linkedMapOf("k" to "anim", "t" to 0.0, "states" to animStates))
      log("[sidecar] $srvHost:$srvPort as \"$name\"  recording=${outPath?.let { FsFile(it).absolutePath }}  review=${reviewPath?.let { FsFile(it).absolutePath }}")
      // Node awaits the socket here, so the line comes after the connect goes out.
      loop.post { announceFeed() }
    }

    s.on("connected") { a ->
      log("[sidecar] connected id=${JsOps.str(a[0].g("id"))}")
      // Answered: the join is under way, however long the world dump takes.
      if (serverState["state"] == "unreachable") setServerState("connecting")
    }
    s.on("joined") { a ->
      val i = a[0]
      log("[sidecar] joined as player ${JsOps.str(i.g("playerId"))} team ${JsOps.str(i.g("team"))}: ${JsOps.str(i.g("players"))} players, ${JsOps.str(i.g("objects"))} objects")
      ensureSender()   // safe only now: the server has a BFPlayer bound
      setServerState("joined")
      // A side a page asked for while the server had no player for it.
      if (pageTeam.held != 0) log("[sidecar] page team at the join: ${pageTeam.joined(TeamState(joined = true, team = s.me.team, everSpawned = everSpawned))}")
      ws?.broadcast(Js.stringify(linkedMapOf("k" to "me", "pid" to i.g("playerId"))))
      // Back after the server dropped us: the new session's world dump opens
      // with SetLevel, which the page reads as a level load and answers by
      // going back to its deploy screen; the player deploys from there.
    }

    s.on("event") { a -> onEvent(s, ws0, a[0].asObj()!!) }

    s.on("unknown-event") { a ->             // 7-bit type with no decoder
      val u = a[0]
      bump("unknownEvents")
      review.unknownEvent(u.g("id"), u.g("seq"), u.g("block"), u.g("bitOffset"), u.g("hex"))
      writeRec(linkedMapOf("k" to "e", "t" to now(), "e" to "raw", "type" to u.g("id")))
    }

    s.on("ghost") { a ->
      val g = a[0]
      bump("ghostBlocks")
      @Suppress("UNCHECKED_CAST")
      val records = (g.g("records") as? List<MutableMap<String, Any?>>) ?: emptyList()
      bump("ghostRecords", records.size)
      for (r in records) review.ghostRecord(g.g("seq"), g.g("tick"), r.g("netId"), r.g("action"), r.g("bodyBits"), r.g("hex"), r.g("ref"))
      // Scope, transforms, soldier state, hull damage and vehicle rounds
      // (ghost-writer.mjs, shared with the offline rebuild).
      ghosts.block(now(), records, g.g("tick").let { if (it === Undefined) null else it })
      if (JsOps.truthy(g.g("raw"))) review.ghostBlockRaw(g.g("seq"), g.g("reason"), g.g("raw"))
    }

    s.on("control-state") { a -> onControlState(s, ws0, a[0].asObj()!!) }

    // The round trip comes out of each ack's wait (input.mjs `atAck`).
    s.on("pong") { a -> inputSender?.noteRtt(JsOps.toNumber(a[0])) }
    s.on("unknown-datagram") { a -> review.unknownDatagram(a[0].g("type"), a[0].g("hex")) }
    s.on("decode-error") { a -> val e = a[0]; review.decodeError(e.g("where"), e.g("seq"), e.g("message"), e.g("hex")) }
    s.on("plus-settings") { a ->
      val st = a[0] as ServerSettings
      val js = st.toJs()
      writeRec(linkedMapOf("k" to "e", "t" to now(), "e" to "plusSettings", "ui" to js["UI"], "mine3DMap" to js["mine3DMap"],
        "supplyDepot3DMap" to js["supplyDepot3DMap"], "controlPoint3DMap" to js["controlPoint3DMap"], "custom3DMaps" to js["custom3DMaps"]))
      log("[sidecar] bf42++ server settings: ${st.seen.joinToString(", ")}${if (st.UI.allowFasterRestart) "" else " (no faster restart)"}")
    }
    s.on("level-hold") { a -> val i = a[0]; log("[sidecar] loading ${JsOps.str(i.g("levelPath"))} ${JsOps.str(i.g("modeFile"))} (mod ${JsOps.str(JsOps.coalesce(i.g("mod")) { i.g("mapId") })}): the world dump waits for the level's tables") }
    s.on("level-release") { a ->
      val i = a[0]
      val from = if (JsOps.truthy(i.g("timedOut"))) "nowhere in time (${JsOps.str(levelWaitMs / 1000.0)} s; fallbacks stand in)" else JsOps.str(JsOps.coalesce(i.g("result").g("source")) { "?" })
      log("[sidecar] level loaded after ${JsOps.str(i.g("ms"))} ms: tables from $from, ${JsOps.str(i.g("queued"))} queued items resume")
    }
    s.on("skip-static-objects") { _ -> log("[sidecar] bf42++: the server says this level loads without its StaticObjects.con") }
    s.on("level-change") { a -> val i = a[0]; log("[sidecar] level over: the server will restart for mod \"${JsOps.str(i.g("mod"))}\"; reconnect password ${if (JsOps.truthy(i.g("password"))) JsOps.str(i.g("password")) else "(none)"}") }
    // The first join's refusal ends the run; a rejoin's refusals are the
    // rejoiner's to weigh (a full server during the reconnect window is retried).
    s.on("denied") { a ->
      if (rejoiner.active) return@on
      val i = a[0]
      log("[sidecar] denied: ${JsOps.str(i.g("name"))}")
      setServerState("denied", linkedMapOf("reason" to JsOps.coalesce(i.g("name")) { null }, "text" to (DENIAL_TEXT[JsOps.str(i.g("reason"))])))
      finish(1)
    }
    s.on("disconnected") { a -> onDisconnected(s, a[0]) }
  }

  private fun onEvent(s: Session, w: WireState, ev: Map<String, Any?>) {
    bump("events")
    val rec0 = Record.recordFor(ev)
    if (rec0 === Undefined) return             // client->server echo; nothing to record
    if (rec0 == null) {                        // parsed but no v5 mapping yet
      bump("raws")
      writeRec(linkedMapOf("k" to "e", "t" to now(), "e" to "raw", "type" to JsOps.coalesce(ev.g("id")) { null }, "name" to ev.g("type")))
      return
    }
    @Suppress("UNCHECKED_CAST")
    val rec = rec0 as MutableMap<String, Any?>
    bump("records")
    if (rec.g("e") == "serverInfo" && JsOps.truthy(rec.g("mod"))) serverMod = rec["mod"]
    if (rec.g("e") == "serverName" && JsOps.truthy(rec.g("name")) && !JsOps.eq(rec["name"], w.lastServerName)) {
      w.lastServerName = rec["name"]
      log("[sidecar] server name: ${JsOps.str(rec["name"]).replace(Regex("[\\r\\n]+"), " ")}")
    }
    if (rec.g("e") == "chat") noteKickNotice(s, rec)
    if (rec.g("e") == "setLevel") {
      // The level's template ids for the server's mod and this round's game
      // type (names.mjs, template-table.mjs). A namesFile only fills the ids
      // the install could not name.
      val auto = Names.namesForLevel(rec.g("level"), serverMod, rec.g("mode"))
      if (namesFile == null || JsOps.truthy(auto.g("computed"))) {
        tidNames.clear()
        @Suppress("UNCHECKED_CAST")
        val autoNames = (auto.g("tidNames") as? Map<String, Any?>) ?: emptyMap()
        @Suppress("UNCHECKED_CAST")
        if (namesFile != null) tidNames.putAll(JsOps.spread(names["fileTidNames"] as Map<String, Any?>, autoNames)) else tidNames.putAll(autoNames)
      }
      // The animation table and the control point names come from the tables,
      // as the retail client builds them (game-tables.mjs); the recorded copies
      // stand in only when that fails. A namesFile's own tables win.
      val g = GameTables.gameTables(serverMod, rec.g("level"), rec.g("mode"))
      if (!JsOps.truthy((names["cpNames"] as? Map<*, *>)?.isNotEmpty())) {
        if (!JsOps.truthy(g.g("cpNames"))) logErr("[sidecar] control point names for ${JsOps.str(rec.g("level"))} fall back to the recorded table (${(auto.g("cpNames") as? Map<*, *>)?.size ?: 0} names)")
        ghostCpNames.clear()
        @Suppress("UNCHECKED_CAST")
        ghostCpNames.putAll(((if (!JsOps.nullish(g.g("cpNames"))) g.g("cpNames") else auto.g("cpNames")) as? Map<String, Any?>) ?: emptyMap())
      }
      // Rebuilt at every level load (Game::load): a new table is a new `anim` row.
      if (namesAnim == null) {
        if (!JsOps.truthy(g.g("animStates")) && JsOps.truthy(auto.g("animStates"))) logErr("[sidecar] the animation state table falls back to the recorded one (${(auto.g("animStates") as List<*>).size} states)")
        val table = if (!JsOps.nullish(g.g("animStates"))) g.g("animStates") else auto.g("animStates").let { if (it === Undefined) null else it }
        if (table != null && Js.stringify(table) != Js.stringify(animStates)) {
          animStates = table
          writeRec(linkedMapOf("k" to "anim", "t" to 0.0, "states" to animStates))
        }
      }
    }
    val tidKey = { v: Any? -> if (JsOps.nullish(v)) null else JsOps.str(v) }
    if ((rec.g("e") == "createObject" || rec.g("e") == "projPool" || rec.g("e") == "createStatic") && !JsOps.nullish(rec.g("tid")) && JsOps.truthy(tidNames[tidKey(rec["tid"])])) rec["tmpl"] = tidNames[tidKey(rec["tid"])]
    // A kill's weapon is a template id too (ScoreMsgEvent +0x12): named here.
    if (rec.g("e") == "score" && !JsOps.nullish(rec.g("weapon")) && JsOps.truthy(tidNames[tidKey(rec["weapon"])])) rec["weaponName"] = tidNames[tidKey(rec["weapon"])]
    // bf42++: a SpecialGame 2 ahead of this connection's SetLevel means the
    // level loads without its StaticObjects.con.
    if (rec.g("e") == "setLevel" && s.plus.skipStaticObjects) rec["statics"] = 0.0
    if (rec.g("e") == "createPlayer") pidTeam[JsOps.key(rec.g("pid"))] = rec.g("team")
    if (rec.g("e") == "createObject" && !JsOps.nullish(rec.g("netId"))) objInfo[JsOps.key(rec["netId"])] = linkedMapOf("tid" to rec.g("tid"), "tmpl" to (if (JsOps.truthy(rec.g("tmpl"))) rec["tmpl"] else ""), "team" to 0.0)
    // The networkable class the template makes (body-decoder.mjs), so the page
    // knows what an object is before it comes into scope (ledger J-5).
    if (rec.g("e") == "createObject" && !JsOps.nullish(rec.g("netId"))) {
      try { val cls = s.bodies.classOf(rec["netId"]); if (JsOps.truthy(cls)) rec["cls"] = cls } catch (_: Exception) { /* the page waits for the ghost's class */ }
    }
    if (rec.g("e") == "control" && !JsOps.nullish(rec.g("netId")) && objInfo.containsKey(JsOps.key(rec["netId"]))) {
      objInfo[JsOps.key(rec["netId"])]!!["team"] = JsOps.coalesce(pidTeam[JsOps.key(rec.g("pid"))]) { 0.0 }
    }
    val t = now()
    val extra = ghosts.note(rec, t)
    writeRec(JsOps.spread(linkedMapOf("k" to "e", "t" to t), rec))
    for (x in extra) { ghosts.note(x, t); writeRec(JsOps.spread(linkedMapOf("k" to "e", "t" to t), x)) }
  }

  private fun r4(x: Double) = JsOps.toFixed(x, 4)
  private fun r6(x: Double) = JsOps.toFixed(x, 6)
  private fun carryHullState(w: WireState, netId: Any?, body: Any?): MutableMap<String, Any?>? {
    val selfHullState = w.selfHullState
    val k = JsOps.key(netId)
    val prev = selfHullState[k] ?: linkedMapOf("pos" to null, "rot" to null, "vecA" to null)
    fun or(v: Any?, d: Any?) = if (JsOps.nullish(v)) d else v
    val cur = linkedMapOf<String, Any?>(
      "pos" to or(body.g("pos"), prev["pos"]),
      "rot" to or(body.g("rot"), prev["rot"]),
      "vecA" to or(body.g("vecA"), prev["vecA"]),
    )
    // The rest of the root's body, and its Engine's registers, each carried
    // forward the same way: what the page's ground drive adopts at the acked
    // tick (`TrackedVehicle.rewind`, features/tank-ground-law).
    for (key in listOf("vecB", "vecC", "vecD", "vecE", "vecF", "flag")) cur[key] = or(body.g(key), or(prev[key], null))
    val kids = (body.g("children") as? List<*>) ?: emptyList<Any?>()
    val engine = kids.firstOrNull { it.g("type") == "E" }
    val pe = prev["engine"] ?: emptyMap<String, Any?>()
    cur["engine"] = if (engine != null)
      linkedMapOf("revs" to or(engine.g("revs"), pe.g("revs")), "load" to or(engine.g("load"), pe.g("load")), "roll" to or(engine.g("roll"), pe.g("roll")),
        "yaw" to or(engine.g("yaw"), pe.g("yaw")), "gear" to or(engine.g("gear"), pe.g("gear")))
    else or(prev["engine"], null)
    selfHullState[k] = cur
    return if (JsOps.truthy(cur["pos"]) && JsOps.truthy(cur["rot"]) && JsOps.truthy(cur["vecA"])) cur else null
  }

  private fun onControlState(s: Session, w: WireState, c: MutableMap<String, Any?>) {
    // The crosshair's hit marks (ledger XHIT-4, XHIT-6): one of this player's
    // rounds hit, and the control state's bool after the serial says so once.
    if (JsOps.truthy(c.g("hit"))) writeRec(linkedMapOf("k" to "e", "t" to now(), "e" to "hitMark", "pid" to s.me.playerId))
    if (!JsOps.truthy(c.g("ok")) && c.g("reason") == "no-baseline") return // a delta before its first full state, joined mid-stream
    // The serial echo is read ahead of the body, so a body this reader cannot
    // parse still acknowledges the page's words.
    if (!JsOps.truthy(c.g("ok"))) review.decodeError("control-state", c.g("seq"), JsOps.coalesce(c.g("reason")) { "short read" }, JsOps.coalesce(c.g("hex")) { null })
    val body = c.g("body")
    // The hit points of the hull he drives (ghost-writer.mjs `controlHp`).
    if (JsOps.truthy(c.g("ok")) && c.g("cls") == "SimpleObjectNetworkable" && JsOps.isFiniteNum(body.g("hp"))) ghosts.controlHp(now(), c.g("netId"), body.g("hp"))
    // The input path at this acknowledgement.
    val sender = inputSender
    val controlId = c.g("controlId")
    val pathAt = if (sender != null && sender.session === s && !JsOps.nullish(controlId))
      sender.atAck(JsOps.toNumber(controlId).toLong(), JsOps.num(JsOps.coalesce(c.g("tick")) { null })) else null
    // Where this player's OWN gun points and how fast it is turning, per
    // rotational bundle in the template's declared order.
    val bundles = if (JsOps.truthy(c.g("ok")) && c.g("cls") != "BFSoldierNetworkable" && body.g("children") is List<*>)
      (body.g("children") as List<*>).filter { it != null && it.g("type") == "R" } else null
    fun v(x: Any?, i: Int) = JsOps.at(x.g("values"), i.toDouble()).let { if (JsOps.nullish(it)) null else JsOps.toNumber(it) }
    val aim = bundles?.map { x -> mutableListOf<Any?>(v(x, 0)?.let { r4(it * 180) }, v(x, 1)?.let { r4(it * 180) }) }
    val aimSpeed = bundles?.map { x -> mutableListOf<Any?>(v(x, 3)?.let { JsOps.toFixed(it, 6) }, v(x, 4)?.let { JsOps.toFixed(it, 6) }) }
    if (pathAt != null) {
      val row = linkedMapOf<String, Any?>("k" to "iq", "t" to now(), "tick" to JsOps.coalesce(c.g("tick")) { null }, "serial" to controlId,
        "iq" to pathAt.iq.toDouble(), "sq" to pathAt.sq.toDouble(), "st" to pathAt.starved)
      // The seat's own gun at this tick (lab/seat_swing_check.py).
      if (!aim.isNullOrEmpty()) { row["ha"] = aim; row["hs"] = aimSpeed }
      if (pathAt.trimmed != 0.0) row["tr"] = pathAt.trimmed
      // The words merged so far (input.mjs `_mergePending`, cumulative).
      if (sender!!.path.merged != 0) row["mg"] = sender.path.merged.toDouble()
      if (pathAt.lead != null) { row["ld"] = JsOps.toFixed(pathAt.lead, 1); row["hd"] = JsOps.toFixed(pathAt.hold ?: Double.NaN, 1) }
      if (pathAt.rtt != 0.0 && !pathAt.rtt.isNaN()) row["rt"] = pathAt.rtt
      out.write(Js.stringify(row) + "\n")
    }
    if (ws == null || JsOps.nullish(controlId)) return
    val seq = pageSeqBySerial[JsOps.toNumber(controlId).toLong()]
    // The soldier's hit points ride along: the page's own Armor takes the
    // server's drops (net-room.js onsnapshot).
    val hp = if (JsOps.truthy(c.g("ok")) && c.g("cls") == "BFSoldierNetworkable" && JsOps.isFiniteNum(body.g("hp"))) body.g("hp") else Undefined
    // So does his aim, carried forward per soldier (ledger VIEW-14).
    @Suppress("UNCHECKED_CAST")
    val aimState = if (JsOps.truthy(c.g("ok")) && c.g("cls") == "BFSoldierNetworkable") carrySelfAim(w.selfAim as MutableMap<Any?, MutableMap<String, Any?>>, c.g("netId"), body as? Map<String, Any?>) else null
    // A driven hull's own state at the acked tick, whole (BF1942.exe
    // readControlObjectState 0x004968a0), each field carried forward per hull.
    val hullState = if (JsOps.truthy(c.g("ok")) && c.g("cls") != "BFSoldierNetworkable") carryHullState(w, c.g("netId"), body) else null
    // The guns of what he controls, as the server has them (net-room.js `correctSeatAmmo`).
    var mags: Any? = null
    if (JsOps.truthy(c.g("ok")) && c.g("cls") != "BFSoldierNetworkable" && body.g("children") is List<*>) {
      val seat = if (c.g("cls") == "Seat") s.bodies.seatOf(JsOps.toNumber(c.g("netId"))) else null
      val tmpl = if (seat != null) seat.g("tmpl") else (s.bodies.info(c.g("netId"))?.g("tmpl").let { if (JsOps.nullish(it)) null else it })
      mags = GhostRows.controlMagazines(body.g("children"), tmpl, if (seat != null) JsOps.toNumber(seat.g("seat")) else 0.0, w.selfMags[JsOps.key(c.g("netId"))])
      if (mags != null) w.selfMags[JsOps.key(c.g("netId"))] = mags
    }
    fun r6v(x: Any?): Any? = if (x is List<*>) x.map { r6(JsOps.toNumber(it)) } else Undefined
    val hull: Map<String, Any?>? = if (hullState != null) linkedMapOf<String, Any?>(
      "hp3" to (hullState["pos"] as List<*>).map { r4(JsOps.toNumber(it)) },
      "hq" to (hullState["rot"] as List<*>).map { r6(JsOps.toNumber(it)) },
      "hv" to (hullState["vecA"] as List<*>).map { r4(JsOps.toNumber(it)) },
      // The rest of the state, engine frame, as `carryHullState` keeps it.
      "hw" to r6v(hullState["vecB"]), "hacc" to r6v(hullState["vecC"]), "hracc" to r6v(hullState["vecD"]),
      "hfr" to r6v(hullState["vecE"]), "hrfr" to r6v(hullState["vecF"]),
    ).also { m ->
      if (hullState["flag"] != null) m["hsl"] = JsOps.truthy(hullState["flag"])
      if (JsOps.truthy(hullState["engine"])) m["heng"] = hullState["engine"]
    } else null
    // `iq`: the page's words still waiting in this sidecar's pacing queue.
    val iq = (sender?.pending?.size ?: 0).toDouble()
    // `ai`: the input index the server ran the acked word at (ledger DEV-14).
    if (seq != null && seq != 0.0) {
      val row = linkedMapOf<String, Any?>("k" to "ack", "t" to now(), "seq" to seq, "tick" to JsOps.coalesce(c.g("tick")) { null }, "serial" to controlId,
        "ai" to actionIndexOf(controlId), "id" to c.g("netId"), "iq" to iq)
      if (pathAt != null) { row["sq"] = pathAt.sq.toDouble(); row["st"] = pathAt.starved; if (pathAt.lead != null) row["ld"] = JsOps.toFixed(pathAt.lead, 1) }
      if (hp !== Undefined) row["hp"] = hp
      if (aimState != null) row.putAll(aimState)
      if (hull != null) row.putAll(hull)
      if (!aim.isNullOrEmpty()) { row["haim"] = aim; row["hspd"] = aimSpeed }
      if (mags != null) row["hmag"] = mags
      ws?.broadcast(Js.stringify(row))
    }
  }

  private fun onDisconnected(sess: Session, i: Any?) {
    // A disconnect datagram can arrive more than once, and a replaced session
    // can still hear its own: only the live session's first one rejoins.
    // A rejoin attempt's own drops belong to the rejoiner.
    if (sess !== s || rejoiner.active) return
    // A kick the server's chat announced just before (rejoin.mjs kickNoticeFor).
    val notice = kickNotice?.takeIf { wall() - kickNoticeAt < KICK_NOTICE_MS }
    val reason = (i.g("reason") as? Number)?.toLong()
    val kind = classifyDisconnect(reason, s.levelChange, notice)
    val why = describeDisconnect(kind, reason, JsOps.str(JsOps.coalesce(i.g("name")) { "" }), JsOps.str(JsOps.coalesce(i.g("message")) { "" }), notice)
    val msg = i.g("message")
    log("[sidecar] server disconnected us: ${JsOps.str(i.g("name"))}${if (JsOps.truthy(msg)) " \"${JsOps.str(msg)}\"" else ""}${if (notice != null) " (chat: \"${notice.text}\")" else ""} ($kind)")
    // Tell the page, and keep it in the recording; `final` is everything the
    // sidecar will not rejoin from.
    if (!finished) writeRec(JsOps.spread(linkedMapOf("k" to "e", "t" to now(), "e" to "serverLeft"), why.mapValues { (_, v) -> if (v is Long) v.toDouble() else v }))
    if (why["final"] == true) {
      // A kick, a ban or a close the server chose: the sidecar stops here, as
      // the retail client goes back to its menu.
      s.close()
      if (finished) return
      log("[sidecar] not rejoining: ${why["title"]}${if (JsOps.truthy(why["text"])) " -- ${why["text"]}" else ""}")
      setServerState(kind, linkedMapOf("reason" to JsOps.coalesce(i.g("name")) { null }, "title" to why["title"], "text" to why["text"]))
      finish(1)
      return
    }
    s.close()
    if (finished) return
    inputSender?.stop(); inputSender = null
    pageSeqBySerial.clear()
    setServerState("rejoining", linkedMapOf("reason" to JsOps.coalesce(i.g("name")) { null }))
    val t = JsOps.toNumber(s.me.team)
    rejoiner.start(kind = kind, reason = reason,
      password = s.levelChange?.password ?: "",
      // The side we were on; the retail client asks for auto (0) after its relaunch.
      team = if (t == 1.0 || t == 2.0) t.toInt() else team,
      // The client's pinger: bf42++'s, or the retail first delay if this
      // server's welcome lines said UI&nfr (plus.mjs restartTiming).
      timing = s.restartTiming())
    if (rejoiner.active) log("[sidecar] probing the server after ${JsOps.str(rejoiner.timing!!.firstProbeMs / 1000.0)} s, then every ${JsOps.str(rejoiner.timing!!.probeMs / 1000.0)} s")
  }

  // The newest server chat line that named this player as kicked or banned
  // (rejoin.mjs kickNoticeFor), kept briefly.
  private val KICK_NOTICE_MS = 10000.0
  private var kickNotice: KickNotice? = null
  private var kickNoticeAt = 0.0
  private fun noteKickNotice(sess: Session, rec: Map<String, Any?>) {
    val mine = sess.players[JsOps.key(sess.me.playerId)]?.g("name") as? String
    val hit = kickNoticeFor(rec.g("text") as? String, listOf(mine, name)) ?: return
    kickNotice = hit
    kickNoticeAt = wall()
    log("[sidecar] the server says: \"${hit.text}\"")
  }

  // Getting back on after a drop (rejoin.mjs): probe the server the way the
  // retail client does while it waits for a restart, join with the reconnect
  // password, keep the recording and the page socket.
  private val restart = if (retail) RETAIL_RESTART else PLUS_RESTART
  private val rejoiner: Rejoiner = Rejoiner(
    connect = { reconnectPassword, t ->
      s = newSession(reconnectPassword, t)
      wire(s)
      try { s.start() } catch (e: Exception) { log("[sidecar] rejoin socket failed: ${e.message}") }
      s
    },
    probe = { done ->
      val sock = host.transport() ?: UdpTransport(loop)
      // A promise settles after the code that resolved it.
      probeServerInfoAsync(sock, loop, srvHost, srvPort) { v -> loop.post { done(v) } }
    },
    timers = loop,
    // A horizon that is not a number never runs out (Node compares against NaN).
    horizonMs = if (rejoinHorizonS.isNaN()) Long.MAX_VALUE else (rejoinHorizonS * 1000).toLong(),
    firstProbeMs = restart.firstProbeMs, probeMs = restart.probeMs,
  ).also { r ->
    r.on("probe") { a -> val p = a[0]; if (JsOps.truthy(p.g("up")) || !host.env["SIDECAR_DEBUG"].isNullOrEmpty()) log("[sidecar] rejoin probe ${JsOps.str(p.g("n"))}: ${if (JsOps.truthy(p.g("up"))) "the server answers" else "no answer"}") }
    r.on("attempt") { a -> val p = a[0]
      log("[sidecar] rejoining (attempt ${JsOps.str(p.g("n"))}${if (JsOps.truthy(p.g("reconnectPassword"))) ", reconnect password ${JsOps.str(p.g("reconnectPassword"))}" else ""}${if (JsOps.truthy(p.g("team"))) ", team ${JsOps.str(p.g("team"))}" else ""})") }
    r.on("retry") { a -> val p = a[0]; log("[sidecar] rejoin: ${JsOps.str(p.g("why"))}; next try in ${JsOps.toFixedStr(JsOps.toNumber(p.g("delayMs")) / 1000, 1)} s") }
    r.on("rejoined") { a -> val p = a[0]
      log("[sidecar] back on after ${JsOps.toFixedStr(JsOps.toNumber(p.g("elapsedMs")) / 1000, 1)} s, ${JsOps.str(p.g("attempts"))} attempt(s)${if (JsOps.truthy(p.g("usedKey"))) ", through a reconnect slot" else ""}")
      ensureSender()
    }
    r.on("give-up") { a ->
      val g = a[0]
      // A refusal names itself in the lexicon's words; the horizon is a server
      // that never came back.
      val why = g.g("why") as? String
      val reason = g.g("reason").let { if (JsOps.nullish(it)) null else it }
      val text = when (why) { "denied" -> DENIAL_TEXT[JsOps.str(reason)] ?: ""; "horizon" -> "The server did not come back within ${JsOps.str(rejoinHorizonS)} s."; else -> "" }
      val title = DISCONNECT_TITLE[why] ?: DISCONNECT_TITLE.getValue("closed")
      setServerState("lost", linkedMapOf("reason" to why, "title" to title, "text" to text))
      log("[sidecar] not rejoining: $why${if (reason != null) " (reason 0x${JsOps.hex(reason)})" else ""} after ${JsOps.toFixedStr(JsOps.toNumber(g.g("elapsedMs")) / 1000, 0)} s")
      writeRec(linkedMapOf("k" to "e", "t" to now(), "e" to "serverLeft", "kind" to why, "reason" to (reason?.let { JsOps.toNumber(it) }),
        "name" to (why ?: ""), "title" to title, "text" to text, "final" to true))
      finish(1)
    }
  }
  init { wire(s) }

  private var finished = false
  /** True once the run is over (left, refused, kicked, gave up). */
  val done: Boolean get() = finished
  private var stayTimer: Cancellable? = null
  private var connectTimer: Cancellable? = null
  private var nameTimer: Cancellable? = null
  private fun finish(code: Int) {
    if (finished) return
    finished = true
    stayTimer?.cancel()
    connectTimer?.cancel()
    rejoiner.stop()
    inputSender?.stop(); inputSender = null
    writeRec(linkedMapOf("k" to "end", "t" to now()))
    try { out.close() } catch (_: Exception) {}
    val sum = review.summary()
    review.close()
    log("[sidecar] stats: ${Js.stringify(JsOps.spread(stats, ghosts.stats))}")
    log("[sidecar] review: ${Js.stringify(sum)}")
    (ws ?: pageHub)?.close()
    loop.schedule(150.0) {
      host.exit(code)
      // process.exit takes the session's socket and timers with it, without a
      // word to the server; in a host that lives on (the Android app) they
      // would otherwise go on pinging the server.
      if (host.teardownOnExit) { nameTimer?.cancel(); try { s.close() } catch (_: Exception) {} }
    }
  }

  // Leaving: stop(), the CLI's Ctrl-C, or `leave` on stdin. Usable from the
  // start, so a leave while the connect still waits for the page's name exits
  // cleanly.
  private var started = false
  private var leaving = false
  private fun leaveNow(why: String? = null) {
    if (leaving) return
    leaving = true
    log("\n[sidecar] leaving${if (why != null) " ($why)" else ""}")
    if (started) s.leave()
    finish(0)
  }

  // ---- the run ---------------------------------------------------------------

  private var booted = false

  /** Bring the page socket up and start the join (on the loop); returns the
   *  socket's port, or -1 with no page socket. The join itself goes on in the
   *  background: the pre-join look, the page's name, the connect. */
  fun start(): Int {
    val port = onLoop {
      check(!booted) { "already started" }
      booted = true
      config.cacheDir?.let { Paths.cacheDirOverride = it }
      config.tablesUrl?.let { LevelTables.tablesUrlOverride = it }
      val p = listenFeed()
      boot()
      p
    }
    return port
  }

  private fun boot() {
    // nameFromPage: the page's socket first, so the page can say who the
    // player is before the ConnectRequest.
    if (nameFromPage) {
      if (pageHub != null) announceFeed()
      else { log("[sidecar] --name-from-page needs --ws: no page can name the player"); identity.timeout() }
    }
    if (nameFromPage && identity.settled == null) nameTimer = loop.schedule(nameWaitS * 1000) { identity.timeout() }
    var waiting = 2
    fun next() { if (--waiting == 0) connect() }
    // The level the server is playing, asked before the ConnectRequest, so its
    // tables are in the cache before the world dump's SetLevel needs them. Best
    // effort: the SetLevel's own hold (levelGate) covers a miss or a map change.
    val prejoin = namesFile == null && !config.noPrejoin
    var prejoinDone = !prejoin
    var identityDone = false
    if (prejoin) {
      val t = wall()
      host.work {
        val lv = try { host.queryServerLevel(srvHost, srvPort, queryPortOpt) } catch (_: Exception) { null }
        val r = if (lv != null) try { host.prepareLevel(lv["mod"], lv["level"], lv["mode"], levelWaitMs) } catch (t: Throwable) { log("[sidecar] level tables failed: $t"); null } else null
        loop.post {
          if (lv != null) {
            log("[sidecar] the server plays ${JsOps.str(lv["level"])} ${JsOps.str(JsOps.coalesce(lv["mode"]) { "" })} (mod ${JsOps.str(lv["mod"])}, from its ${JsOps.str(lv["source"])}): tables from ${JsOps.str(r?.get("source"))} in ${JsOps.str(wall() - t)} ms")
            // The desktop app's status line reads this (tools/sidecar-desktop, sidecar-status.js).
            if (JsOps.truthy(lv["name"])) log("[sidecar] server name: ${JsOps.str(lv["name"]).replace(Regex("[\\r\\n]+"), " ")}")
          } else log("[sidecar] the server did not say what it plays (no live list row, no GameSpy answer); its tables wait for the SetLevel")
          prejoinDone = true
          if (identityDone) next()
        }
      }
    }
    val onName = { who: Pair<String, String> ->
      nameTimer?.cancel()
      name = who.first
      s.name = name
      // The desktop app's session header reads this (sidecar-status.js).
      log("[sidecar] player name: $name (${who.second})")
      identityDone = true
      // Node awaits the identity, then the pre-join look.
      next()
      if (prejoinDone) next()
    }
    if (nameFromPage) {
      val settled = identity.settled
      if (settled != null) onName(settled) else identity.onSettle = { v -> onName(v) }
    } else {
      log("[sidecar] player name: $name (given)")
      identityDone = true
      next()
      if (prejoinDone) next()
    }
  }

  private fun connect() {
    if (leaving) return
    started = true
    try { s.start() } catch (e: Exception) { log("[sidecar] socket failed: ${e.message}"); finish(1); return }
    // No answer in time: say so, on the console and to the page, and keep trying.
    connectTimer = if (connectTimeoutS > 0) loop.schedule(connectTimeoutS * 1000) {
      if (s.conn.state != "connecting" || s.joined) return@schedule
      log("[sidecar] no answer from $target after ${JsOps.str(connectTimeoutS)} s: is the server running? (still trying)")
      setServerState("unreachable", linkedMapOf("waitedS" to connectTimeoutS))
    } else null
    stayTimer = if (stay > 0) loop.schedule(stay * 1000) { s.leave(); finish(0) } else null
  }

  /** Leave the server cleanly (three Disconnects, as retail) and end the run.
   *  The CLI's Ctrl-C and --leave-on-stdin. */
  fun leave(why: String? = null) { onLoop { leaveNow(why) } }

  /** The facade's stop: leave, and once the goodbye has gone, stop the loop
   *  this Sidecar made. */
  fun stop() {
    leave()
    val l = loop
    if (l is EventLoop) l.schedule(400.0) { l.close() }
  }

  private fun <T> onLoop(fn: () -> T): T = if (loop is EventLoop) loop.call(fn) else fn()
}

/** The page URL a join opens (sidecar-desktop main.js viewerUrl). */
fun viewerUrl(wsPort: Int, base: String = "https://play.bfstats.io/"): String =
  "${base}map.html?sidecar=127.0.0.1:$wsPort"
