package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ObjectsChecksum.kt against objects-checksum.mjs, from parity/objects-checksum.mjs. */
class ObjectsChecksumTest {
  private val fx = Parity.load("objects-checksum")

  @Test fun crc() {
    for (row in fx["crc"]!!.jsonArray) {
      val (h, want) = row.jsonArray
      assertEquals(Parity.num(want)!!.toLong(), crc32Bzip2(fromHex(Parity.str(h)!!)))
    }
  }

  @Test fun bundledTableMatchesNode() {
    assertEquals(Parity.js(fx["bundled"]), Js.stringify(bundledChecksums()))
  }

  @Test fun lookupsWithoutAnInstall() {
    for (row in fx["lookups"]!!.jsonArray) {
      val r = row.jsonObject
      val got = objectsChecksum(Parity.str(r["mod"]), dir = "/no-such-bf1942-install", bundled = Parity.bool(r["bundled"]) == true, warn = {})
      assertEquals(Parity.js(r), Parity.js(r["out"]), Js.stringify(got))
    }
  }
}
