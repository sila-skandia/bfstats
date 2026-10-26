package io.bfstats.sidecar.tools

// Port of tools/bf1942-models/sidecar/join.mjs; keep in step.
//
// Join a BF1942 server as a bare client and log everything -- the POC tester
// for features/udp-sidecar. Thin CLI over Session (Session.kt); Sidecar is
// the browser bridge over the same session.
//
//   ./gradlew -q :core:join --args="192.168.1.226:14568 --name sidecar --stay 60 --log run.ndjson"
//
// The log is a raw NDJSON trace of the session (one line per milestone, event,
// ghost block, unknown and stat) for inspection; it is NOT the replay format
// (that is Sidecar's). Use it to see what the server sends.
//
// Port notes: `JoinHost` is what join.mjs takes from Node (the loop, the
// socket, the log file, process.exit), so parity/join.mjs's transcripts can
// be replayed (JoinTest).

import io.bfstats.sidecar.EventLoop
import io.bfstats.sidecar.Js
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.PathFaults
import io.bfstats.sidecar.Scheduler
import io.bfstats.sidecar.Session
import io.bfstats.sidecar.SessionOptions
import io.bfstats.sidecar.TextSink
import io.bfstats.sidecar.Transport
import io.bfstats.sidecar.defaultRandomInt
import io.bfstats.sidecar.fileTextSink
import io.bfstats.sidecar.g
import io.bfstats.sidecar.printOut

/** What join.mjs takes from Node's runtime, injectable. */
class JoinHost(
  val loop: Scheduler = EventLoop("join-loop"),
  val transport: () -> Transport? = { null },
  val openWriter: (String) -> TextSink = { p -> fileTextSink(p) },
  val exit: (Int) -> Unit = {},
  val randomInt: (Int) -> Int = defaultRandomInt,
  val faults: PathFaults = PathFaults.fromEnv(),
  val keyFor: ((Long?) -> String?)? = null,
)

/** One join.mjs run: `start()` it, `interrupt()` is its SIGINT. */
class JoinRun(private val args: List<String>, private val host: JoinHost, private val out: (String) -> Unit = { printOut(it) }) {
  private val loop = host.loop
  private val target = args.firstOrNull { !it.startsWith("--") } ?: "127.0.0.1:14567"
  // A flag's value is the next argument; one given last has its default.
  private fun opt(k: String): String? { val i = args.indexOf("--$k"); return if (i >= 0) args.getOrNull(i + 1) else null }
  private val srvHost = target.split(":")[0]
  private val portNum = JsOps.stringToNumber(target.split(":").getOrNull(1) ?: "14567")
  private val name = opt("name") ?: "sidecar"
  private val team = JsOps.stringToNumber(opt("team") ?: "0")
  private val stay = JsOps.stringToNumber(opt("stay") ?: "30")
  private val logPath = opt("log")
  private val verbose = args.contains("--verbose")

  private val logFile: TextSink? = logPath?.let { host.openWriter(it) }
  // A line after finish() goes to the console only (join.mjs logEnded).
  private var logEnded = false
  private fun log(kind: String, rec: Map<String, Any?> = emptyMap()) {
    val line = Js.stringify(JsOps.spread(linkedMapOf("kind" to kind, "t" to kotlin.math.floor(loop.clock.wallMs())), rec))
    if (!logEnded) logFile?.write(line + "\n")
    if (verbose || kind !in setOf("event", "ghost", "pong")) out(line)
  }

  private val s = Session(srvHost, if (portNum.isNaN()) 0 else portNum.toInt(), SessionOptions(
    name = name, team = if (team.isNaN()) 0 else team.toInt(), password = opt("password") ?: "",
    cdkey = opt("cdkey"), keyFor = host.keyFor,
    randomInt = host.randomInt, transport = host.transport(), faults = host.faults,
  ), loop)
  private var ghostBlocks = 0.0
  private var ghostRecords = 0.0
  private var unknownEvents = 0.0
  private var finished = false
  private var stayTimer: io.bfstats.sidecar.Cancellable? = null

  init {
    s.on("open") { a -> log("open", JsOps.spread(linkedMapOf("host" to srvHost, "port" to portNum, "name" to name, "stay" to stay), a[0].asMap())) }
    s.on("connected") { a -> log("connected", a[0].asMap()) }
    s.on("joined") { a -> log("joined", a[0].asMap()) }
    s.on("event") { a -> val ev = a[0]; log("event", linkedMapOf("type" to ev.g("type"), "playerId" to ev.g("playerId"), "netId" to ev.g("netId"), "name" to ev.g("name"))) }
    s.on("unknown-event") { a -> unknownEvents++; log("unknown-event", a[0].asMap()) }
    s.on("unknown-datagram") { a -> log("unknown-datagram", a[0].asMap()) }
    s.on("decode-error") { a -> log("decode-error", a[0].asMap()) }
    s.on("ghost") { a -> val g = a[0]; ghostBlocks++; ghostRecords += ((g.g("records") as? List<*>)?.size ?: 0); if (verbose) log("ghost", g.asMap()) }
    s.on("denied") { a -> log("denied", a[0].asMap()); finish(1) }
    s.on("disconnected") { a -> log("disconnected-by-server", a[0].asMap()); finish(1) }
    s.on("stats") { a -> log("stats", JsOps.spread(a[0].asMap(), linkedMapOf("ghostBlocks" to ghostBlocks, "ghostRecords" to ghostRecords, "unknownEvents" to unknownEvents))) }
  }

  @Suppress("UNCHECKED_CAST")
  private fun Any?.asMap(): Map<String, Any?> = (this as? Map<String, Any?>) ?: emptyMap()

  private fun finish(code: Int) {
    if (finished) return
    finished = true
    stayTimer?.cancel()
    logEnded = true
    logFile?.close()
    loop.schedule(120.0) { host.exit(code) }
  }

  fun start() {
    onLoop {
      s.start()
      stayTimer = loop.schedule(stay * 1000) { log("leave"); s.leave(); finish(0) }
    }
  }

  /** SIGINT. */
  fun interrupt() = onLoop { log("leave"); s.leave(); finish(0) }

  private fun <T> onLoop(fn: () -> T): T = if (loop is EventLoop) loop.call(fn) else fn()
}

/** The command, for the JVM `main` (tools/JoinMain.kt). */
fun joinMain(args: Array<String>, onInterrupt: (handler: () -> Unit) -> Unit) {
  val loop = EventLoop("join-loop")
  val run = JoinRun(args.toList(), JoinHost(loop = loop, exit = { code -> io.bfstats.sidecar.startThread("join-exit") { io.bfstats.sidecar.exitProcess(code) } },
    keyFor = null))
  onInterrupt { run.interrupt() }
  run.start()
  while (true) io.bfstats.sidecar.sleepMs(60_000)
}

