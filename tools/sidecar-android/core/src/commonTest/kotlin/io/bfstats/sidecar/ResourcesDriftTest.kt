package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** core/resources/sidecar holds copies of the Node sidecar's bundled files
 *  (the hulls, the derived child specs, the saved level maps, the CRC tables,
 *  the monitor page), compiled in by embedResources: each must be the Node
 *  copy's bytes, and every one of those Node files must be here. */
class ResourcesDriftTest {
  @Test fun everyBundledFileIsTheNodeCopy() {
    val node = FsFile("$MODELS_DIR/sidecar")
    val bad = ArrayList<String>()
    for (p in EmbeddedResources.paths) {
      val rel = p.removePrefix("sidecar/")
      val src = FsFile(node, rel)
      if (!src.exists()) { bad += "$p: no Node copy"; continue }
      if (src.readText() != EmbeddedResources.text(p)) bad += "$p: differs from tools/bf1942-models/sidecar/$rel"
    }
    // The other way: what sidecar.mjs's modules read at run time.
    val wanted = listOf("hulls.json", "objects-crc.json", "content-crc.json", "ghost/derived-specs.json", "page/index.html") +
      (FsFile(node, "templates").list() ?: emptyList()).filter { it.endsWith(".json") }.map { "templates/$it" }
    for (w in wanted) if ("sidecar/$w" !in EmbeddedResources.paths) bad += "sidecar/$w: missing from core/resources"
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
