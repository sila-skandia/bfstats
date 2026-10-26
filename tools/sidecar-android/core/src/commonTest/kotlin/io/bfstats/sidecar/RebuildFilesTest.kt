package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** The rebuild gate over whole recordings too big to commit: set
 *  SIDECAR_PARITY_REBUILD to a directory of `<name>.rec.ndjson`,
 *  `<name>.review.ndjson` and Node's `<name>.out.ndjson` (rebuild.mjs run
 *  against the committed tables, as parity/lib/tables.mjs scratchCache sets them up).
 *  Passes without looking when unset. */
class RebuildFilesTest {
  @Test fun wholeRecordingsMatchNode() {
    val dir = systemEnv()["SIDECAR_PARITY_REBUILD"]?.let { FsFile(it) }
    if (dir == null || !dir.isDirectory) return
    val bad = ArrayList<String>()
    for (outName in dir.list()!!.filter { it.endsWith(".out.ndjson") }.sorted()) {
      val out = FsFile(dir, outName)
      val name = out.name.removeSuffix(".out.ndjson")
      Fixtures.freshCache(true)
      val res = Rebuild.rebuild(FsFile(dir, "$name.rec.ndjson").readText(), FsFile(dir, "$name.review.ndjson").readText())
      val d = Fixtures.diff(out.readText().split("\n"), res.text().split("\n"), name)
      if (d.isNotEmpty()) bad += d
      printOut("$name: ${res.rows.size} rows ${if (d.isEmpty()) "identical" else "DIFFER"}")
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
