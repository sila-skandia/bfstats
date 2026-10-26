package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** LiveState against parity/live-snapshot.mjs: recorded sessions and the join-state cases. */
class LiveSnapshotTest {
  private val f = Fixtures.loadJs("live-snapshot")
  private val fixtures = "$MODELS_DIR/tests/fixtures"

  private fun sha(lines: List<String>): String =
    Digest.sha256(lines.joinToString("\n").encodeToByteArray()).hex()

  @Suppress("UNCHECKED_CAST")
  @Test fun recordedSessionsSnapshotAsNode() {
    for (rec in f["recordings"].l()) {
      val name = rec.m()["file"] as String
      val text = readSourceFile("$fixtures/$name").decodeToString()
      val rows = text.split("\n").filter { it.isNotEmpty() }.map { JsOps.parse(it) as Map<String, Any?> }
      val want = rec.m()["snaps"].l()
      val L = createLiveState()
      var si = 0; var n = 0
      fun check() {
        val w = want[si++].m()
        val s = L.liveSnapshot()
        assertEquals("$name cut ${w["cut"]} rows", w["rows"].d().toInt(), n)
        (w["full"] as List<*>?)?.let { full -> for (i in full.indices) assertEquals("$name cut ${w["cut"]} line $i", full[i], s.getOrNull(i)) }
        assertEquals("$name cut ${w["cut"]} lines", w["lines"].d().toInt(), s.size)
        assertEquals("$name cut ${w["cut"]} sha", w["sha"], sha(s))
      }
      val cuts = want.map { it.m()["cut"] }.filterIsInstance<Number>().map { it.toDouble() }
      for (r in rows) {
        val t = JsOps.toNumber(JsOps.coalesce(if (r.containsKey("t")) r["t"] else Undefined) { 0 })
        while (si < cuts.size && t > cuts[si]) check()
        L.remember(r)
        n++
      }
      while (si < cuts.size) check()
      check() // 'end'
    }
  }

  @Suppress("UNCHECKED_CAST")
  @Test fun joinStateCasesSnapshotAsNode() {
    val L = createLiveState()
    for ((i, c) in f["cases"].l().withIndex()) {
      for (r in c.m()["rows"].l()) L.remember(r as Map<String, Any?>)
      val want = c.m()["snapshot"].l()
      val got = L.liveSnapshot()
      for (j in want.indices) assertEquals("stage $i line $j", want[j], got.getOrNull(j))
      assertEquals("stage $i lines", want.size, got.size)
    }
  }
}
