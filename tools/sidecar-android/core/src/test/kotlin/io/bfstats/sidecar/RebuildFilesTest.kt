package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** The rebuild gate over whole recordings too big to commit: set
 *  SIDECAR_PARITY_REBUILD to a directory of `<name>.rec.ndjson`,
 *  `<name>.review.ndjson` and Node's `<name>.out.ndjson` (rebuild.mjs run
 *  against the committed tables, as parity/lib/tables.mjs scratchCache sets them up).
 *  Skipped when unset. */
class RebuildFilesTest {
  @Test fun wholeRecordingsMatchNode() {
    val dir = System.getenv("SIDECAR_PARITY_REBUILD")?.let { File(it) }
    assumeTrue(dir != null && dir.isDirectory)
    val bad = ArrayList<String>()
    for (out in dir!!.listFiles { f -> f.name.endsWith(".out.ndjson") }!!.sorted()) {
      val name = out.name.removeSuffix(".out.ndjson")
      Fixtures.freshCache(true)
      val res = Rebuild.rebuild(File(dir, "$name.rec.ndjson").readText(), File(dir, "$name.review.ndjson").readText())
      val d = Fixtures.diff(out.readText().split("\n"), res.text().split("\n"), name)
      if (d.isNotEmpty()) bad += d
      println("$name: ${res.rows.size} rows ${if (d.isEmpty()) "identical" else "DIFFER"}")
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
