package io.bfstats.sidecar.tools

// The sidecar command, natively (the linuxX64 executable `sidecar.kexe`):
// tools/SidecarCli.kt. Ctrl-C (SIGINT) and SIGTERM set a flag in the signal
// handler, which may do nothing else; a watcher thread sees it and runs the
// leave. The leave ends the process with 0 (finish(0), as Node's SIGINT
// does); the exit here is the backstop for a run that was already ending.

import io.bfstats.sidecar.exitProcess
import io.bfstats.sidecar.sleepMs
import io.bfstats.sidecar.startThread
import kotlinx.cinterop.staticCFunction
import kotlin.concurrent.AtomicInt
import platform.posix.SIGINT
import platform.posix.SIGTERM
import platform.posix.signal

private val interrupted = AtomicInt(0)

fun main(args: Array<String>) = sidecarMain(args) { handler ->
  val onSignal = staticCFunction<Int, Unit> { _ -> interrupted.value = 1 }
  signal(SIGINT, onSignal)
  signal(SIGTERM, onSignal)
  startThread("sidecar-signal") {
    while (interrupted.value == 0) sleepMs(50)
    handler()
    sleepMs(2000)
    exitProcess(0)
  }
}
