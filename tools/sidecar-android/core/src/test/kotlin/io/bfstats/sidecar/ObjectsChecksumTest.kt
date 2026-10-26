package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ObjectsChecksum.kt against objects-checksum.mjs, from parity/objects-checksum.mjs. */
class ObjectsChecksumTest {
  private val fx = Fixtures.load("objects-checksum")

  @Test fun crc() {
    for (row in fx["crc"]!!.jsonArray) {
      val (h, want) = row.jsonArray
      assertEquals(Fixtures.num(want)!!.toLong(), crc32Bzip2(fromHex(Fixtures.str(h)!!)))
    }
  }

  @Test fun bundledTableMatchesNode() {
    assertEquals(Fixtures.js(fx["bundled"]), Js.stringify(bundledChecksums()))
  }

  @Test fun lookupsWithoutAnInstall() {
    for (row in fx["lookups"]!!.jsonArray) {
      val r = row.jsonObject
      val got = objectsChecksum(Fixtures.str(r["mod"]), dir = "/no-such-bf1942-install", bundled = Fixtures.bool(r["bundled"]) == true, warn = {})
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(got))
    }
  }
}
