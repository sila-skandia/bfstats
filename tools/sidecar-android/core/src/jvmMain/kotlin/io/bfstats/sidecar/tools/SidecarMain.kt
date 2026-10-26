package io.bfstats.sidecar.tools

// The sidecar command on the JVM (`./gradlew -q :core:sidecar --args=...`):
// tools/SidecarCli.kt. Ctrl-C and SIGTERM are caught (not a shutdown hook,
// which cannot choose the exit code), so the leave runs and the run exits 0
// as Node's SIGINT handler does.

import sun.misc.Signal

fun main(args: Array<String>) = sidecarMain(args) { handler ->
  for (sig in listOf("INT", "TERM")) Signal.handle(Signal(sig)) { handler() }
}
