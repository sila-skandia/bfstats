package io.bfstats.sidecar

import java.io.File
import java.nio.file.Files
import java.util.zip.GZIPInputStream

/** The parity fixtures' shared ground: resources, the scratch cache, and a
 *  line-by-line comparison that names the first difference. */
object Parity {
  fun text(path: String): String {
    val s = Parity::class.java.getResourceAsStream("/parity/$path") ?: error("no resource /parity/$path")
    return s.use { if (path.endsWith(".gz")) GZIPInputStream(it).readBytes().toString(Charsets.UTF_8) else it.readBytes().toString(Charsets.UTF_8) }
  }
  fun json(path: String): Any? = JsOps.parse(text(path))

  private val TABLES = listOf(Triple("bf1942", "wake", "coop"), Triple("bf1942", "el_alamein", "coop"), Triple("desertcombat", "el_alamein", "conquest"))

  /** A scratch cache, with the committed baked tables or empty, wired in as
   *  the sidecar's cache with no install and no downloads; every module's
   *  memo forgotten (a fresh Node process). */
  fun freshCache(withTables: Boolean = true): File {
    val dir = Files.createTempDirectory("parity-cache-").toFile()
    dir.deleteOnExit()
    if (withTables) for ((mod, level, mode) in TABLES) {
      val f = File(File(dir, mod), "$level-$mode.baked.json")
      f.parentFile.mkdirs()
      f.writeText(text("cache/$mod/$level-$mode.baked.json.gz"))
    }
    Paths.cacheDirOverride = dir
    Paths.lookForInstall = false
    LevelTables.tablesUrlOverride = "off"
    Rebuild.resetModuleState()
    return dir
  }

  /** "" when equal, else the first differing line of each. */
  fun diff(want: List<String>, got: List<String>, label: String): String {
    val n = minOf(want.size, got.size)
    for (i in 0 until n) if (want[i] != got[i]) return "$label: line ${i + 1} differs\n  node:   ${want[i].take(600)}\n  kotlin: ${got[i].take(600)}"
    if (want.size != got.size) return "$label: node has ${want.size} lines, kotlin ${got.size}"
    return ""
  }
}
