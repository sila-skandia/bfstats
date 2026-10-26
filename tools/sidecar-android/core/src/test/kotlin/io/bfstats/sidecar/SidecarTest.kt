package io.bfstats.sidecar

import io.bfstats.sidecar.tools.parseSidecarArgs
import org.junit.AfterClass
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.StringWriter
import java.net.InetSocketAddress
import java.nio.file.Files
import java.time.Instant

/** Sidecar.kt against sidecar.mjs (parity/sidecar.mjs runs the real script
 *  under lib/sidecar-preload.mjs): the same command line and the same script
 *  of server datagrams and page frames, the same transcript line for line:
 *  every datagram out, every frame a page is sent, every console line, the
 *  exit, and the recording and review log. */
class SidecarTest {
  companion object {
    private lateinit var fx: Map<String, Any?>
    private val savedLog = JsOps.consoleLog
    private val savedErr = JsOps.consoleError
    private val savedNow = LevelTables.now

    @BeforeClass @JvmStatic fun load() {
      fx = Fixtures.json("sidecar.json.gz").m()
    }
    @AfterClass @JvmStatic fun restore() {
      JsOps.consoleLog = savedLog; JsOps.consoleError = savedErr; LevelTables.now = savedNow
    }
    private const val DATA = 0xf
    private const val SERVER_INFO_REQUEST = 9
  }

  /** A UDP socket: every datagram logged, its send callback a loop turn later. */
  class FakeTransport(val idx: Int, val sched: ManualScheduler, val line: (List<Any?>) -> Unit) : Transport {
    override var onMessage: (ByteArray, InetSocketAddress) -> Unit = { _, _ -> }
    var kind: String? = null
    var closed = false
    var lastSent = 0
    override fun bind() = InetSocketAddress("0.0.0.0", 40000 + idx)
    override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
      val type = (b[2].toInt() and 0xff) shr 4
      if (kind == null) kind = if (type == SERVER_INFO_REQUEST) "probe" else "session"
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

  private fun run(name: String): List<String> {
    val sc = fx[name].m()
    Fixtures.freshCache()
    val sched = ManualScheduler(0.0)
    val lines = ArrayList<String>()
    val line = { a: List<Any?> -> lines += Fixtures.encs(a) }
    JsOps.consoleLog = { line(listOf(sched.now, "log", it)) }
    JsOps.consoleError = { line(listOf(sched.now, "log", it)) }
    LevelTables.now = { sched.now() }
    val socks = ArrayList<FakeTransport>()
    var hub: FakeHub? = null
    val writers = LinkedHashMap<String, StringWriter>()
    val r = prng((sc["seed"] as Double).toLong())
    val config = parseSidecarArgs(sc["args"].l().map { it as String }, env = emptyMap(), stamp = "STAMP")
      .copy(configDir = Files.createTempDirectory("sidecar-parity-keys").toFile())
    val host = SidecarHost(
      loop = sched,
      transport = { FakeTransport(socks.size, sched, line).also { socks += it } },
      pageHub = { p, _, _ -> FakeHub(p, sched, line).also { hub = it } },
      work = { it() },
      openWriter = { p -> StringWriter().also { writers[p] = it } },
      wallNow = { Instant.parse("2026-10-26T00:00:00Z") },
      queryServerLevel = { _, _, _ -> null },
      exit = { code -> line(listOf(sched.now, "exit", code)) },
      randomInt = { max -> Math.floor(r() * max).toInt() },
      faults = PathFaults(),
      env = emptyMap(),
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
            if (st.o("ack") == "auto") {
              b[1] = ((b[1].toInt() and 0x3f) or ((s.lastSent and 3) shl 6)).toByte()
              b[2] = ((b[2].toInt() and 0xf0) or ((s.lastSent shr 2) and 0xf)).toByte()
              b.putU32le(3, 0xffffffffL)
            }
            s.onMessage(b, InetSocketAddress("10.0.0.9", 14567))
          }
        }
        "pageOpen" -> { val i = st["sock"].d().toInt(); pages[i] = hub!!.connectPage(i) }
        "pageText" -> pages[st["sock"].d().toInt()]!!.onMessage((st["text"] as String).toByteArray(Charsets.UTF_8))
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
    val outAbs = java.io.File("OUT").absolutePath
    val revAbs = java.io.File("REVIEW").absolutePath
    return lines.map { it.replace(outAbs, "OUT").replace(revAbs, "REVIEW").replace(Regex("""\\"start\\":\\"[^"\\]*\\""""), """\\"start\\":\\"START\\"""") }
  }

  private fun check(name: String) {
    @Suppress("UNCHECKED_CAST")
    val want = fx[name].m()["lines"] as List<String>
    val got = run(name)
    val d = Fixtures.diff(want, got, name)
    assertTrue(d, d.isEmpty())
  }

  @Test fun capture() = check("capture")
  @Test fun rejoin() = check("rejoin")
  @Test fun namedDenied() = check("namedDenied")
}
