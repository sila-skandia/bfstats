package io.bfstats.sidecar.tools

// The sidecar command on the JVM (`./gradlew -q :core:sidecar --args=...`):
// tools/SidecarCli.kt, with Ctrl-C as a shutdown hook.

fun main(args: Array<String>) = sidecarMain(args) { handler ->
  Runtime.getRuntime().addShutdownHook(Thread { handler() })
}
