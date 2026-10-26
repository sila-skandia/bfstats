package io.bfstats.sidecar

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/** Plus.kt against plus.mjs, from parity/plus.mjs. */
class PlusTest {
  private val fx = Fixtures.load("plus")

  private fun version(v: JsonObject?): PlusVersion = if (v == null) PLUS_VERSION else PlusVersion(
    Fixtures.num(v["major"])?.toInt() ?: 0, Fixtures.num(v["minor"])?.toInt() ?: 0,
    Fixtures.num(v["patch"])?.toInt() ?: 0, Fixtures.num(v["build"])?.toInt() ?: 0,
  )

  @Test fun acceptAcks() {
    for (row in fx["acks"]!!.jsonArray) {
      val r = row.jsonObject
      val b = buildPlusAcceptAck(Fixtures.num(r["id"])!!.toInt(), version(r["version"] as? JsonObject), Fixtures.num(r["protocol"])?.toInt() ?: PLUS_PROTOCOL_VERSION)
      assertEquals(Fixtures.js(r), Fixtures.str(r["hex"]), b.hex())
    }
    for (row in fx["parseAck"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.str(r["hex"]), Fixtures.js(r["out"]), Js.stringify(parsePlusAcceptAck(fromHex(Fixtures.str(r["hex"])!!))))
    }
    for (row in fx["crc8"]!!.jsonArray) {
      val (h, want) = row.jsonArray
      assertEquals(want.jsonPrimitive.content.toInt(), crc8(fromHex(h.jsonPrimitive.content)))
    }
  }

  @Test fun colors() {
    for (row in fx["colors"]!!.jsonArray) {
      val (c, want) = row.jsonArray
      assertEquals(c.jsonPrimitive.content, want.jsonPrimitive.content.toLong(), colorFromString(c.jsonPrimitive.content))
    }
    assertEquals(Fixtures.num(fx["colorsNull"])!!.toLong(), colorFromString(null))
  }

  @Test fun settings() {
    val c = fx["constants"]!!.jsonObject
    val templates = c["templates"]!!.jsonArray.map { it.jsonPrimitive.content }
    val exists = { n: String -> templates.any { it.lowercase() == n.lowercase() } }
    val cases = fx["settings"]!!.jsonArray
    val bare = fx["settingsNoTemplates"]!!.jsonArray
    for ((i, row) in cases.withIndex()) {
      val lines = row.jsonObject["lines"]!!.jsonArray.map { it.jsonPrimitive.content }
      val s = defaultServerSettings()
      for (l in lines) parseServerSettings(l, s, exists)
      assertEquals(lines.toString(), Fixtures.js(row.jsonObject["out"]), Js.stringify(s.toJs()))
      val t = defaultServerSettings()
      for (l in lines) parseServerSettings(l, t)
      assertEquals("$lines without templates", Fixtures.js(bare[i]), Js.stringify(t.toJs()))
    }
    assertEquals(Fixtures.js(fx["settingsNull"]), Js.stringify(parseServerSettings(null).toJs()))
    assertEquals(Fixtures.js(fx["defaults"]), Js.stringify(defaultServerSettings().toJs()))
  }

  @Test fun timingAndConstants() {
    val t = fx["timing"]!!.jsonObject
    assertEquals(Fixtures.js(t["plus"]), Js.stringify(restartTiming(plus = true).toJs()))
    assertEquals(Fixtures.js(t["plusNfr"]), Js.stringify(restartTiming(plus = true, settings = parseServerSettings("%UI&nfr~")).toJs()))
    assertEquals(Fixtures.js(t["plusOther"]), Js.stringify(restartTiming(plus = true, settings = parseServerSettings("%UI&hen~")).toJs()))
    assertEquals(Fixtures.js(t["retail"]), Js.stringify(restartTiming(plus = false).toJs()))
    assertEquals(Fixtures.js(t["retailNfr"]), Js.stringify(restartTiming(plus = false, settings = parseServerSettings("%UI&nfr~")).toJs()))
    assertEquals(Fixtures.js(t["RETAIL_RESTART"]), Js.stringify(RETAIL_RESTART.toJs()))
    assertEquals(Fixtures.js(t["PLUS_RESTART"]), Js.stringify(PLUS_RESTART.toJs()))
    val c = fx["constants"]!!.jsonObject
    assertEquals(Fixtures.num(c["PLUS_PROTOCOL_VERSION"])!!.toInt(), PLUS_PROTOCOL_VERSION)
    assertEquals(Fixtures.js(c["PLUS_VERSION"]), Js.stringify(PLUS_VERSION.toJs()))
    assertEquals(Fixtures.num(c["INVALID_COLOR"])!!.toLong(), INVALID_COLOR)
  }
}
