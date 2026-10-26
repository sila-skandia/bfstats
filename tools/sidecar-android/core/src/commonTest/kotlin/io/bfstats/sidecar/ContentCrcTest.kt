package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

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
