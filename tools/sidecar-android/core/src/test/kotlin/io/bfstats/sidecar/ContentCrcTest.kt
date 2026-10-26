package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ContentCrc.kt against content-crc.mjs, from parity/content-crc.mjs. */
class ContentCrcTest {
  private val fx = Parity.load("content-crc")

  @Test fun readers() {
    for (row in fx["gpm"]!!.jsonArray) { val (m, want) = row.jsonArray; assertEquals(Parity.str(want), gpmFor(Parity.str(m))) }
    for (row in fx["level"]!!.jsonArray) { val (l, want) = row.jsonArray; assertEquals(Parity.str(want), levelName(Parity.str(l))) }
    for (row in fx["parse"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.js(r["text"]), Parity.js(r["out"]), Js.stringify(parseContentCrc32(Parity.str(r["text"])!!)))
    }
  }

  @Test fun bundledTableMatchesNode() {
    assertEquals(Parity.js(fx["bundled"]), Js.stringify(bundledContentRows()))
  }

  @Test fun lookupsWithoutAnInstall() {
    for (row in fx["lookups"]!!.jsonArray) {
      val r = row.jsonObject
      val c = r["in"]!!.jsonObject
      val got = contentCrc(
        Parity.str(c["mod"]), Parity.str(c["mapId"]), Parity.str(c["levelPath"]), Parity.str(c["modeFile"]),
        dir = Parity.str(r["dir"]), bundled = Parity.bool(r["bundled"]) == true, warn = {},
      )
      assertEquals(Parity.js(r), Parity.js(r["out"]), Js.stringify(got))
    }
  }
}
