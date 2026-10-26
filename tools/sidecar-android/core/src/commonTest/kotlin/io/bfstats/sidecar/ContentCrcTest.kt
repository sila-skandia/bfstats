package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem

/** ContentCrc.kt against content-crc.mjs, from parity/content-crc.mjs. */
class ContentCrcTest {
  private val fx = Fixtures.load("content-crc")

  @Test fun readers() {
    for (row in fx["gpm"]!!.jsonArray) { val (m, want) = row.jsonArray; assertEquals(Fixtures.str(want), gpmFor(Fixtures.str(m))) }
    for (row in fx["level"]!!.jsonArray) { val (l, want) = row.jsonArray; assertEquals(Fixtures.str(want), levelName(Fixtures.str(l))) }
    for (row in fx["parse"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.js(r["text"]), Fixtures.js(r["out"]), Js.stringify(parseContentCrc32(Fixtures.str(r["text"])!!)))
    }
  }

  @Test fun bundledTableMatchesNode() {
    assertEquals(Fixtures.js(fx["bundled"]), Js.stringify(bundledContentRows()))
  }

  @Test fun gpmAtTheEndOfInput() {
    for (row in fx["gpmNewline"]!!.jsonArray) { val (m, want) = row.jsonArray; assertEquals(Fixtures.str(m), Fixtures.str(want), gpmFor(Fixtures.str(m))) }
  }

  @Test fun lookupsInAnInstall() {
    resetContentCrc()
    val root = tempDir("content-install-")
    for (e in fx["installTree"]!!.jsonArray) {
      val a = e.jsonArray
      val f = FsFile(root, Fixtures.str(a[0])!!)
      val text = if (a.size > 1) Fixtures.str(a[1]) else null
      if (text == null) f.mkdirs() else { f.parentFile!!.mkdirs(); writeBytes(f, latin1(text)) }
    }
    fun lookup(r: kotlinx.serialization.json.JsonObject, bundled: Boolean, warns: MutableList<String>): Long? {
      val c = r["in"]!!.jsonObject
      return contentCrc(Fixtures.str(c["mod"]), Fixtures.str(c["mapId"]), Fixtures.str(c["levelPath"]), Fixtures.str(c["modeFile"]),
        dir = root.path, bundled = bundled, warn = { warns += it.split(root.path).joinToString("<dir>") })
    }
    for (row in fx["install"]!!.jsonArray) {
      val r = row.jsonObject
      val warns = ArrayList<String>()
      val got = lookup(r, Fixtures.bool(r["bundled"]) == true, warns)
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(got))
      assertEquals(Fixtures.js(r), Fixtures.js(r["warns"]), Js.stringify(warns))
    }
    val w = fx["installRewrite"]!!.jsonObject
    sleepMs(20) // the rewrite must move the mtime
    writeBytes(FsFile(root, Fixtures.str(w["file"])!!), latin1(Fixtures.str(w["text"])!!))
    val first = fx["install"]!!.jsonArray[0].jsonObject
    assertEquals(Fixtures.js(w["out"]), Js.stringify(lookup(first, true, ArrayList())))
  }

  @Test fun lookupsWithoutAnInstall() {
    for (row in fx["lookups"]!!.jsonArray) {
      val r = row.jsonObject
      val c = r["in"]!!.jsonObject
      val got = contentCrc(
        Fixtures.str(c["mod"]), Fixtures.str(c["mapId"]), Fixtures.str(c["levelPath"]), Fixtures.str(c["modeFile"]),
        dir = Fixtures.str(r["dir"]), bundled = Fixtures.bool(r["bundled"]) == true, warn = {},
      )
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(got))
    }
  }
}

/** fs.writeFileSync of bytes (the fake installs the fixtures describe). */
private fun writeBytes(f: FsFile, b: ByteArray) =
  SystemFileSystem.sink(Path(f.path)).buffered().use { it.write(b) }
