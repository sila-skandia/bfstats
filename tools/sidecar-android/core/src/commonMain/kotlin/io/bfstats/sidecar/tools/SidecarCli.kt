package io.bfstats.sidecar.tools

// The Kotlin sidecar as a command, in place of `node sidecar/sidecar.mjs` in a
// lab run: the same main arguments, the same console lines, the same page
// socket and recording.
//
//   ./gradlew -q :core:sidecar --args="127.0.0.1:14568 --name kt --team 2 --ws 17942 --out run.ndjson"
//   core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe 127.0.0.1:14568 --name kt ...  (native)
//
// Arguments (sidecar.mjs's): HOST:PORT, --name, --team, --ws, --out, --review,
// --name-from-page, --name-wait, --password, --tables-url, --level-wait,
// --query-port, --no-prejoin, --retail, --plus-version, --pace, --word-log,
// --stay, --names, --rejoin-horizon, --connect-timeout, --cdkey,
// --allow-origin (repeatable), --leave-on-stdin. Ctrl-C leaves cleanly.

import io.bfstats.sidecar.EventLoop
import io.bfstats.sidecar.JoinConfig
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.Lock
import io.bfstats.sidecar.PlusVersion
import io.bfstats.sidecar.Sidecar
import io.bfstats.sidecar.SidecarHost
import io.bfstats.sidecar.exitProcess
import io.bfstats.sidecar.fileStamp
import io.bfstats.sidecar.printOut
import io.bfstats.sidecar.readStdinLine
import io.bfstats.sidecar.sleepMs
import io.bfstats.sidecar.startThread
import io.bfstats.sidecar.systemEnv
import io.bfstats.sidecar.wallMillis

/** sidecar.mjs's argument reading, as it reads them (a flag's value is the
 *  next argument; the target is the first argument that is not a flag). */
fun parseSidecarArgs(args: List<String>, env: Map<String, String?> = systemEnv(), stamp: String = defaultStamp()): JoinConfig {
  val target = args.firstOrNull { !it.startsWith("--") } ?: "127.0.0.1:14567"
  fun opt(k: String): String? { val i = args.indexOf("--$k"); return if (i >= 0) args.getOrNull(i + 1) else null }
  fun has(k: String) = args.contains("--$k")
  fun num(v: String?, d: Double): Double = if (v == null) d else JsOps.stringToNumber(v)
  val parts = target.split(":")
  val host = parts[0]
  val port = num(parts.getOrNull(1), 14567.0).toInt()
  val plusVersion = opt("plus-version")?.takeIf { it.isNotEmpty() }?.let { v ->
    val n = v.split(".").map { JsOps.stringToNumber(it).let { d -> if (d.isNaN()) 0 else d.toInt() } }
    PlusVersion(n.getOrElse(0) { 0 }, n.getOrElse(1) { 0 }, n.getOrElse(2) { 0 }, n.getOrElse(3) { 0 })
  }
  val allow = args.indices.filter { args[it] == "--allow-origin" && it + 1 < args.size }.map { args[it + 1] }
  return JoinConfig(
    host = host, port = port,
    name = opt("name") ?: "sidecar",
    team = num(opt("team"), 0.0).toInt(),
    password = opt("password") ?: "",
    wsPort = opt("ws")?.let { JsOps.stringToNumber(it).toInt() },
    allowOrigins = allow,
    nameFromPage = has("name-from-page"),
    nameWaitS = num(opt("name-wait"), 15.0),
    stayS = num(opt("stay"), 0.0),
    outPath = opt("out") ?: "sidecar-$stamp.ndjson",
    reviewPath = opt("review") ?: "sidecar-$stamp.review.ndjson",
    namesFile = opt("names"),
    rejoinHorizonS = num(opt("rejoin-horizon"), 600.0),
    connectTimeoutS = num(opt("connect-timeout"), 10.0),
    retail = has("retail"),
    plusVersion = plusVersion,
    pace = opt("pace") ?: "server",
    wordLog = has("word-log"),
    cdkey = opt("cdkey"),
    tablesUrl = opt("tables-url"),
    levelWaitS = num(opt("level-wait") ?: env["SIDECAR_LEVEL_WAIT_S"], 30.0),
    queryPort = opt("query-port")?.let { JsOps.stringToNumber(it).toInt() },
    noPrejoin = has("no-prejoin"),
  )
}

fun defaultStamp(): String = fileStamp(wallMillis())

/**
 * The command, for every target's `main` (jvmMain SidecarMain.kt,
 * nativeMain SidecarMain.native.kt). `onInterrupt` arms Ctrl-C (SIGINT,
 * SIGTERM) to run the handler it is given before the process ends: leave as
 * Node's SIGINT does, and give the goodbye time to go.
 */
fun sidecarMain(args: Array<String>, onInterrupt: (handler: () -> Unit) -> Unit) {
  val list = args.toList()
  val config = parseSidecarArgs(list)
  if (config.port == 14567 && "--force" !in list) {
    printOut("port 14567 is server1 on this PC; refusing to join without --force")
    exitProcess(3)
  }
  val lock = Lock()
  var exiting = false
  fun markExiting(): Boolean = lock.withLock { if (exiting) false else { exiting = true; true } }
  val loop = EventLoop("sidecar-loop")
  val host = SidecarHost(loop = loop, exit = { code ->
    markExiting()
    // Not on the loop: exiting runs the interrupt handler's hook, which must not wait on it.
    startThread("sidecar-exit") { exitProcess(code) }
  })
  val sidecar = Sidecar(config, log = { printOut(it) }, host = host)
  onInterrupt {
    if (markExiting()) {
      try { sidecar.leave() } catch (_: Exception) {}
      sleepMs(300)
    }
  }
  // --leave-on-stdin: a parent that cannot signal its child writes `leave`
  // on stdin; stdin closing (the parent gone) leaves too.
  if ("--leave-on-stdin" in list) {
    startThread("sidecar-stdin") {
      while (true) {
        val line = readStdinLine() ?: break
        if (line.trim() == "leave") sidecar.leave("asked on stdin")
      }
      sidecar.leave("stdin closed")
    }
  }
  sidecar.start()
  // The loop's thread is a daemon: hold the process until the run exits.
  while (true) sleepMs(60_000)
}
