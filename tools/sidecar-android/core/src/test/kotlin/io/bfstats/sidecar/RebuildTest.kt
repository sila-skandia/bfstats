package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test

/** The end-to-end gate: Kotlin Rebuild against Node rebuild.mjs, line for
 *  line, over the cases parity/rebuild.mjs wrote. */
class RebuildTest {
  @Test fun everyCaseMatchesNodeLineForLine() {
    val bad = ArrayList<String>()
    for (c in DecoderFixtures.json("rebuild/cases.json") as List<*>) {
      val name = c.g("name") as String
      val input = c.g("input") as String
      val args = (c.g("args") as List<*>).map { it as String }
      DecoderFixtures.freshCache(c.g("tables") == true)
      val ref = args.indexOf("--ref").let { if (it >= 0) args[it + 1].split(",").map { s -> JsOps.toNumber(s) } else null }
      val res = Rebuild.rebuild(DecoderFixtures.text("rebuild/$input.rec.ndjson.gz"), DecoderFixtures.text("rebuild/$input.review.ndjson.gz"), ref)
      val want = DecoderFixtures.text("rebuild/$name.out.ndjson.gz")
      val d = DecoderFixtures.diff(want.split("\n"), res.text().split("\n"), name)
      if (d.isNotEmpty()) bad += d
      if (res.summary() != c.g("summary")) bad += "$name summary: node ${c.g("summary")} kotlin ${res.summary()}"
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
