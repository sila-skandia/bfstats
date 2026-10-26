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
  private fun runAll(root: FsFile): List<String> {
    val bad = ArrayList<String>()
    for (name in (root.list() ?: emptyList()).sorted()) {
      val dir = FsFile(root, name)
      val tf = FsFile(dir, "transcript.json.gz")
      if (!tf.exists()) continue
      val sc = JsOps.parse(readSourceFile(tf.path).decodeToString()).m()
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
