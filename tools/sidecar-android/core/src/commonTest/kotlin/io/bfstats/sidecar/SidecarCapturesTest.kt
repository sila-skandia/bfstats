package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Sidecar.kt against sidecar.mjs over real sessions (parity/live/page-relay.mjs
 *  captures, replayed by parity/sidecar-captures.mjs): every datagram out,
 *  every page frame, every console line, the recording and the review log,
 *  line for line. The committed slices (resources/parity/captures/) always
 *  run; whole captures too big to commit run when SIDECAR_PARITY_CAPTURES
 *  names their folder (~/.cache/bfstats-parity), one sub-folder each with
 *  its transcript.json.gz and cache/. */
class SidecarCapturesTest {
  /** parity/sidecar-captures.mjs scenarioOf: a capture's server datagrams
   *  per client socket (a Data or ping datagram acking what the replay sent),
   *  its pages and its SIGINT, on the clock of the first datagram out. */
  private fun stepsOf(rows: List<Map<String, Any?>>): List<Map<String, Any?>> {
    val t0 = rows.first { it["dir"] == "out" }["t"].d()
    fun at(t: Any?) = maxOf(0.0, JsOps.toFixed(t.d() - t0, 3))
    val acked = setOf(7, 8, 0xf)
    val steps = ArrayList<Map<String, Any?>>()
    for (r in rows) {
      val op = r["op"]
      when {
        r["dir"] == "in" -> {
          val hex = r["hex"] as String
          val m = linkedMapOf<String, Any?>("t" to at(r["t"]), "op" to "udp", "c" to r["c"], "hex" to hex)
          if (hex.substring(4, 5).toInt(16) in acked) m["ack"] = "auto"
          steps += m
        }
        op == "pageOpen" || op == "pageClose" -> steps += linkedMapOf("t" to at(r["t"]), "op" to op, "sock" to r["sock"])
        op == "pageText" -> steps += linkedMapOf("t" to at(r["t"]), "op" to op, "sock" to r["sock"], "text" to r["text"])
        op == "pageBin" -> steps += linkedMapOf("t" to at(r["t"]), "op" to op, "sock" to r["sock"], "hex" to r["hex"])
        op == "sigint" -> steps += linkedMapOf("t" to at(r["t"]), "op" to op)
      }
    }
    val last = steps.lastOrNull()?.get("t")?.d() ?: 0.0
    steps += linkedMapOf("t" to JsOps.toFixed(last + 1000, 3), "op" to "end")
    return steps
  }

  private fun runAll(root: FsFile): List<String> {
    val bad = ArrayList<String>()
    for (name in (root.list() ?: emptyList()).sorted()) {
      val dir = FsFile(root, name)
      val tf = FsFile(dir, "transcript.json.gz")
      if (!tf.exists()) continue
      val capFile = listOf("capture.ndjson", "capture.ndjson.gz").map { FsFile(dir, it) }.first { it.exists() }
      val rows = readSourceFile(capFile.path).decodeToString().trim().split("\n").filter { it.isNotEmpty() }.map { JsOps.parse(it).m() }
      val sc = LinkedHashMap(JsOps.parse(readSourceFile(tf.path).decodeToString()).m())
      sc["steps"] = stepsOf(rows)
      @Suppress("UNCHECKED_CAST")
      val want = sc["lines"] as List<String>
      val tables = FsFile(dir, "cache").takeIf { it.isDirectory }
      val got = SidecarHarness.run(sc, tables)
      val d = Fixtures.diff(want, got, name)
      if (d.isNotEmpty()) {
        bad += d
        // Both sides whole, for a diff by hand.
        val dump = tempDir("capture-diff-")
        FsFile(dump, "$name.node.ndjson").writeText(want.joinToString("\n", postfix = "\n"))
        FsFile(dump, "$name.kotlin.ndjson").writeText(got.joinToString("\n", postfix = "\n"))
        printOut("$name: both transcripts in ${dump.path}")
      }
      printOut("$name: ${want.size} lines ${if (d.isEmpty()) "identical" else "DIFFER"}")
    }
    return bad
  }

  @Test fun committedSlices() {
    val bad = runAll(FsFile("$PARITY_DIR/captures"))
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }

  @Test fun wholeCaptures() {
    val dir = systemEnv()["SIDECAR_PARITY_CAPTURES"]?.let { FsFile(it) }
    if (dir == null || !dir.isDirectory) return
    val bad = runAll(dir)
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
