package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertTrue
import io.bfstats.sidecar.tools.JoinHost
import io.bfstats.sidecar.tools.JoinRun
import kotlin.test.Test

/** tools/JoinCli.kt against join.mjs (parity/join.mjs): the same command
 *  line and server datagrams, the same datagrams out, console lines, exit
 *  and --log file, line for line. */
class JoinTest {
  private val fx: Map<String, Any?> by lazy { Fixtures.json("join.json.gz").m() }

  private fun run(sc: Map<String, Any?>): List<String> {
    Fixtures.freshCache()
    val sched = ManualScheduler(0.0, floorWall = true)
    val lines = ArrayList<String>()
    val line = { a: List<Any?> -> lines += Fixtures.encs(a) }
    val socks = ArrayList<SidecarHarness.FakeTransport>()
    val writers = LinkedHashMap<String, StringSink>()
    val r = prng((sc["seed"] as Double).toLong())
    val key = (sc["args"].l().let { a -> a[a.indexOf("--cdkey") + 1] }) as String
    val store = cdKeyStore(override = key, file = FsFile(tempDir("join-keys"), "cdkeys.json"), randomInt = { max -> Math.floor(r() * max).toInt() })
    val savedLog = JsOps.consoleLog; val savedErr = JsOps.consoleError
    JsOps.consoleLog = { line(listOf(sched.now, "log", it)) }
    JsOps.consoleError = { line(listOf(sched.now, "log", it)) }
    try {
      val host = JoinHost(
        loop = sched,
        transport = { SidecarHarness.FakeTransport(socks.size, sched, line).also { socks += it } },
        openWriter = { p -> StringSink().also { writers[p] = it } },
        exit = { code -> line(listOf(sched.now, "exit", code)) },
        randomInt = { max -> Math.floor(r() * max).toInt() },
        faults = PathFaults(),
        keyFor = { x -> store(x) },
      )
      val run = JoinRun(sc["args"].l().map { it as String }, host) { line(listOf(sched.now, "log", it)) }
      run.start()
      sched.runDue()
      for (st0 in sc["steps"].l()) {
        val st = st0.m()
        sched.advanceTo(st["t"].d())
        when (st["op"]) {
          "in" -> {
            val s = socks.lastOrNull { !it.closed } ?: socks.lastOrNull()
            if (s == null) line(listOf(sched.now, "noSocket", "in"))
            else {
              val b = fromHex(st["hex"] as String)
              if (st.o("ack") == "auto") {
                b[1] = ((b[1].toInt() and 0x3f) or ((s.lastSent and 3) shl 6)).toByte()
                b[2] = ((b[2].toInt() and 0xf0) or ((s.lastSent shr 2) and 0xf)).toByte()
                b.putU32le(3, 0xffffffffL)
              }
              s.onMessage(b, SockAddr("10.0.0.9", 14567))
            }
          }
          "sigint" -> run.interrupt()
          "end" -> {}
          else -> error("bad op ${st["op"]}")
        }
        sched.runDue()
      }
    } finally { JsOps.consoleLog = savedLog; JsOps.consoleError = savedErr }
    for (l in writers["OUT"]?.toString()?.split("\n")?.filter { it.isNotEmpty() } ?: emptyList()) lines += Js.stringify(listOf("rec", l))
    return lines
  }

  private fun check(name: String) {
    @Suppress("UNCHECKED_CAST")
    val want = fx[name].m()["lines"] as List<String>
    val d = Fixtures.diff(want, run(fx[name].m()), name)
    assertTrue(d, d.isEmpty())
  }

  @Test fun stay() = check("stay")
  @Test fun verbose() = check("verbose")
  @Test fun denied() = check("denied")
  @Test fun dropped() = check("dropped")
}
