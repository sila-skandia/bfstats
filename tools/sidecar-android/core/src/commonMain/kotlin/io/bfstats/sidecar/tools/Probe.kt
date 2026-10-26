package io.bfstats.sidecar.tools

// A live check of the ported wire layer against a real server (the BF1942
// lab, by default): a ServerInfoRequest, then, if the server answered, the
// connect handshake as a bf42++ client and a clean disconnect (three
// Disconnects, socket closed after they have gone). It never stays joined.
//
//   ./gradlew -q :core:probe                       # 127.0.0.1:14568, the lab
//   ./gradlew -q :core:probe --args="HOST PORT [--info-only] [--password PW]"
//
// Port 14567 on this PC is server1 (the LAN server the lab copies; leave it
// alone), so the tool refuses to connect there unless --force is given; the
// ServerInfo probe alone is harmless.

import io.bfstats.sidecar.EventLoop
import io.bfstats.sidecar.Js
import io.bfstats.sidecar.NetConnection
import io.bfstats.sidecar.PathFaults
import io.bfstats.sidecar.PlusIdentity
import io.bfstats.sidecar.hex
import io.bfstats.sidecar.probeServerInfo
import io.bfstats.sidecar.Latch
import io.bfstats.sidecar.exitProcess
import io.bfstats.sidecar.monoNanos
import io.bfstats.sidecar.printOut
import io.bfstats.sidecar.sleepMs

/** The probe command (jvmMain ProbeMain.kt is its JVM main). */
fun probeMain(args: Array<String>) {
  val pos = args.filter { !it.startsWith("--") && args.getOrNull(args.indexOf(it) - 1) != "--password" }
  val host = pos.getOrNull(0) ?: "127.0.0.1"
  val port = pos.getOrNull(1)?.toInt() ?: 14568
  val infoOnly = "--info-only" in args
  val force = "--force" in args
  val password = args.indexOf("--password").takeIf { it >= 0 }?.let { args.getOrNull(it + 1) } ?: ""
  val t0 = monoNanos()
  fun ms() = (monoNanos() - t0) / 1_000_000

  printOut("[${ms()} ms] ServerInfoRequest -> $host:$port")
  val info = probeServerInfo(host, port, timeoutMs = 1500)
  if (info == null) {
    printOut("[${ms()} ms] no ServerInfo within 1.5 s: the server is not up; not connecting")
    exitProcess(2)
  }
  printOut("[${ms()} ms] ServerInfo ${Js.stringify(info)}")
  if (infoOnly) return
  if (port == 14567 && !force) {
    printOut("port 14567 is server1 on this PC; refusing to connect without --force")
    exitProcess(3)
  }

  val loop = EventLoop("probe-loop")
  val c = NetConnection(host, port, loop, password = password, plus = PlusIdentity(), faults = PathFaults())
  val done = Latch()
  var outcome = "timeout"
  c.on("raw-out") { a -> val b = a[0] as ByteArray; printOut("[${ms()} ms] out type ${b[2].toInt() shr 4 and 0xf} (${b.size} bytes) ${b.hex(0, minOf(16, b.size))}") }
  c.on("raw-in") { a -> val b = a[0] as ByteArray; printOut("[${ms()} ms] in  type ${b[2].toInt() shr 4 and 0xf} (${b.size} bytes) ${b.hex(0, minOf(16, b.size))}") }
  c.on("connected") { a -> outcome = "connected ${Js.stringify(a[0])}"; done.countDown() }
  c.on("denied") { a -> outcome = "denied ${Js.stringify(a[0])}"; done.countDown() }
  c.on("disconnected") { a -> outcome = "disconnected ${Js.stringify(a[0])}"; done.countDown() }
  loop.call { c.bind(); c.connect() }
  done.await(5000)
  printOut("[${ms()} ms] handshake: $outcome")
  // Leave cleanly whatever happened: a Disconnect x3 if connected, then close.
  loop.call { c.disconnect(0xd, ""); c.close() }
  // Give the queued sends their time to go before the process ends.
  val until = monoNanos() + 2_000_000_000L
  while (loop.call { c.pending } > 0 && monoNanos() < until) sleepMs(20)
  printOut("[${ms()} ms] disconnected and closed (state ${loop.call { c.state }}, unsent ${loop.call { c.pending }})")
  loop.close()
  exitProcess(if (outcome.startsWith("connected")) 0 else 1)
}
