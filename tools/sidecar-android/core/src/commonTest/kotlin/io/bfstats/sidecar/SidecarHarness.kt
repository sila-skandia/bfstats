package io.bfstats.sidecar

import io.bfstats.sidecar.tools.parseSidecarArgs

/** The Kotlin half of parity/lib/sidecar-run.mjs: Sidecar.kt over one
 *  scenario ({args, seed, env, steps}) with fake sockets, a fake page hub and
 *  the fake clock, returning the transcript lines (every datagram out, every
 *  frame a page is sent, every console line, the exit, the recording and the
 *  review log), normalised as Node's are. `extraTables` is a folder of more
 *  baked tables (a capture's, parity/sidecar-captures.mjs). */
object SidecarHarness {
  private val savedLog = JsOps.consoleLog
  private val savedErr = JsOps.consoleError
  private val savedNow = LevelTables.now
  /** The console and the clock as they were (a run swaps them). */
  fun restore() { JsOps.consoleLog = savedLog; JsOps.consoleError = savedErr; LevelTables.now = savedNow }
  private const val DATA = 0xf
  private const val SERVER_INFO_REQUEST = 9

  /** sidecar-preload.mjs withAutoAck: the datagram's ack fields set to the
   *  newest Data sequence the socket sent, every earlier one delivered. */
  private fun autoAck(b: ByteArray, lastSent: Int) {
    b[1] = ((b[1].toInt() and 0x3f) or ((lastSent and 3) shl 6)).toByte()
    b[2] = ((b[2].toInt() and 0xf0) or ((lastSent shr 2) and 0xf)).toByte()
    b.putU32le(3, 0xffffffffL)
  }


  /** A UDP socket: every datagram logged, its send callback a loop turn later. */
  class FakeTransport(val idx: Int, val sched: ManualScheduler, val line: (List<Any?>) -> Unit, val onFirstSend: (FakeTransport) -> Unit = {}) : Transport {
    override var onMessage: (ByteArray, SockAddr) -> Unit = { _, _ -> }
    var kind: String? = null
    var closed = false
    var lastSent = 0
    override fun bind() = SockAddr("0.0.0.0", 40000 + idx)
    override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
      val type = (b[2].toInt() and 0xff) shr 4
      if (kind == null) { kind = if (type == SERVER_INFO_REQUEST) "probe" else "session"; onFirstSend(this) }
      if (type == DATA) lastSent = b[1].toInt() and 0x3f
      line(listOf(sched.now, "out", idx, b.copyOf()))
      sched.post { done(null) }
    }
    override fun close() { if (closed) return; closed = true; line(listOf(sched.now, "sockClose", idx)) }
  }

  /** The page socket (parity/lib/fake-wsserver.mjs). */
  class FakeHub(val port: Int, val sched: ManualScheduler, val line: (List<Any?>) -> Unit) : PageHub {
    override var onConnection: (PageSocket) -> Unit = {}
    override var onRefused: (String?) -> Unit = {}
    val clients = LinkedHashSet<Sock>()
    override val clientCount get() = clients.size
    inner class Sock(val idx: Int) : PageSocket {
      var open = true
      override var onMessage: (ByteArray) -> Unit = {}
      override var onClose: () -> Unit = {}
      override fun send(text: String) { if (open) line(listOf(sched.now, "page", idx, text)) }
      fun close() { if (!open) return; open = false; clients.remove(this); onClose() }
    }
    fun connectPage(idx: Int): Sock = Sock(idx).also { clients.add(it); onConnection(it) }
    override fun listen() = port
    override fun broadcast(text: String) { for (s in clients.toList()) s.send(text) }
    override fun close() { for (s in clients.toList()) s.close() }
  }

  fun run(sc: Map<String, Any?>, extraTables: FsFile? = null): List<String> = try { run0(sc, extraTables) } finally { restore() }

  private fun run0(sc: Map<String, Any?>, extraTables: FsFile?): List<String> {
    Fixtures.freshCache(extra = extraTables)
    @Suppress("UNCHECKED_CAST")
    val env = (sc["env"] as? Map<String, Any?>)?.mapValues { it.value.toString() } ?: emptyMap()
    val sched = ManualScheduler(0.0, floorWall = true)
    val lines = ArrayList<String>()
    val line = { a: List<Any?> -> lines += Fixtures.encs(a) }
    JsOps.consoleLog = { line(listOf(sched.now, "log", it)) }
    JsOps.consoleError = { line(listOf(sched.now, "log", it)) }
    LevelTables.now = { sched.now() }
    val socks = ArrayList<FakeTransport>()
    var firstWork = true
    val prejoinDelay = (sc["prejoinDelayMs"] as? Number)?.toDouble() ?: 0.0
    val sendOrder = ArrayList<FakeTransport>()
    var hub: FakeHub? = null
    val writers = LinkedHashMap<String, StringSink>()
    val r = prng((sc["seed"] as Double).toLong())
    // @PARITY/ names a committed fixture file (lib/sidecar-run.mjs does the same).
    val config = parseSidecarArgs(sc["args"].l().map { (it as String).replace("@PARITY/", "$PARITY_DIR/") }, env = env, stamp = "STAMP")
      .copy(configDir = tempDir("sidecar-parity-keys"))
    val host = SidecarHost(
      loop = sched,
      transport = { FakeTransport(socks.size, sched, line) { sendOrder += it }.also { socks += it } },
      pageHub = { p, _, _ -> FakeHub(p, sched, line).also { hub = it } },
      // Inline, as Node's awaits settle; the first task (the pre-join look)
      // after `prejoinDelayMs` of the fake clock when the scenario asks.
      work = { task -> if (firstWork && prejoinDelay > 0) { firstWork = false; sched.schedule(prejoinDelay) { task() } } else { firstWork = false; task() } },
      openWriter = { p -> StringSink().also { writers[p] = it } },
      wallNow = { 1792972800000L }, // 2026-10-26T00:00:00Z
      // parity/lib/fake-server-query.mjs: the script's answer.
      queryServerLevel = { _, _, _ -> sc["prejoin"].let { if (it == "throw") throw RuntimeException("no answer") else it?.m() } },
      exit = { code -> line(listOf(sched.now, "exit", code)) },
      randomInt = { max -> Math.floor(r() * max).toInt() },
      faults = PathFaults(),
      env = env,
      // Node's exit is faked in the replay and tears nothing down.
      teardownOnExit = false,
    )
    val sidecar = Sidecar(config, log = { line(listOf(sched.now, "log", it)) }, host = host)
    sidecar.start()
    sched.runDue()
    val pages = HashMap<Int, FakeHub.Sock>()
    fun newest(kind: String, open: Boolean) = socks.lastOrNull { it.kind == kind && (!open || !it.closed) }
    for (st0 in sc["steps"].l()) {
      val st = st0.m()
      sched.advanceTo(st["t"].d())
      when (st["op"]) {
        "in", "probeReply" -> {
          val s = if (st["op"] == "in") (newest("session", true) ?: newest("session", false)) else newest("probe", true)
          if (s == null) line(listOf(sched.now, "noSocket", st["op"]))
          else {
            val b = fromHex(st["hex"] as String)
            if (st.o("ack") == "auto") autoAck(b, s.lastSent)
            s.onMessage(b, SockAddr("10.0.0.9", 14567))
          }
        }
        "udp" -> {
          // A captured datagram for the capture's client socket `c` (the
          // sockets in first-send order); nothing when that socket is not
          // there yet or has closed.
          val s = sendOrder.getOrNull(st["c"].d().toInt())
          if (s != null && !s.closed) {
            val b = fromHex(st["hex"] as String)
            if (st.o("ack") == "auto") autoAck(b, s.lastSent)
            s.onMessage(b, SockAddr("10.0.0.9", 14567))
          }
        }
        "pageOpen" -> { val i = st["sock"].d().toInt(); pages[i] = hub!!.connectPage(i) }
        "pageText" -> pages[st["sock"].d().toInt()]!!.onMessage((st["text"] as String).encodeToByteArray())
        "pageBin" -> pages[st["sock"].d().toInt()]!!.onMessage(fromHex(st["hex"] as String))
        "pageClose" -> pages[st["sock"].d().toInt()]!!.close()
        "sigint" -> sidecar.leave()
        "end" -> {}
        else -> error("bad op ${st["op"]}")
      }
      sched.runDue()
    }
    for (l in writers["OUT"]?.toString()?.split("\n")?.filter { it.isNotEmpty() } ?: emptyList()) lines += Js.stringify(listOf("rec", l))
    for (l in writers["REVIEW"]?.toString()?.split("\n")?.filter { it.isNotEmpty() } ?: emptyList()) lines += Js.stringify(listOf("review", l))
    val outAbs = FsFile("OUT").absolutePath
    val revAbs = FsFile("REVIEW").absolutePath
    return lines.map { it.replace(outAbs, "OUT").replace(revAbs, "REVIEW").replace(Regex("""\\"start\\":\\"[^"\\]*\\""""), """\\"start\\":\\"START\\"""") }
  }
}
