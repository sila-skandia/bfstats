package io.bfstats.sidecar.tools

// join.mjs on the JVM (`./gradlew -q :core:join --args=...`): tools/JoinCli.kt.
// Ctrl-C is join.mjs's SIGINT: log the leave, leave, exit 0.

import sun.misc.Signal

fun main(args: Array<String>) = joinMain(args) { handler ->
  Signal.handle(Signal("INT")) { handler() }
}
