package io.bfstats.sidecar

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/** Plus.kt against plus.mjs, from parity/plus.mjs. */
class PlusTest {
  private val fx = Parity.load("plus")

  private fun version(v: JsonObject?): PlusVersion = if (v == null) PLUS_VERSION else PlusVersion(
    Parity.num(v["major"])?.toInt() ?: 0, Parity.num(v["minor"])?.toInt() ?: 0,
    Parity.num(v["patch"])?.toInt() ?: 0, Parity.num(v["build"])?.toInt() ?: 0,
  )

  @Test fun acceptAcks() {
    for (row in fx["acks"]!!.jsonArray) {
      val r = row.jsonObject
      val b = buildPlusAcceptAck(Parity.num(r["id"])!!.toInt(), version(r["version"] as? JsonObject), Parity.num(r["protocol"])?.toInt() ?: PLUS_PROTOCOL_VERSION)
      assertEquals(Parity.js(r), Parity.str(r["hex"]), b.hex())
    }
    for (row in fx["parseAck"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.str(r["hex"]), Parity.js(r["out"]), Js.stringify(parsePlusAcceptAck(fromHex(Parity.str(r["hex"])!!))))
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
    assertEquals(Parity.num(fx["colorsNull"])!!.toLong(), colorFromString(null))
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
      assertEquals(lines.toString(), Parity.js(row.jsonObject["out"]), Js.stringify(s.toJs()))
      val t = defaultServerSettings()
      for (l in lines) parseServerSettings(l, t)
      assertEquals("$lines without templates", Parity.js(bare[i]), Js.stringify(t.toJs()))
    }
    assertEquals(Parity.js(fx["settingsNull"]), Js.stringify(parseServerSettings(null).toJs()))
    assertEquals(Parity.js(fx["defaults"]), Js.stringify(defaultServerSettings().toJs()))
  }

  @Test fun timingAndConstants() {
    val t = fx["timing"]!!.jsonObject
    assertEquals(Parity.js(t["plus"]), Js.stringify(restartTiming(plus = true).toJs()))
    assertEquals(Parity.js(t["plusNfr"]), Js.stringify(restartTiming(plus = true, settings = parseServerSettings("%UI&nfr~")).toJs()))
    assertEquals(Parity.js(t["plusOther"]), Js.stringify(restartTiming(plus = true, settings = parseServerSettings("%UI&hen~")).toJs()))
    assertEquals(Parity.js(t["retail"]), Js.stringify(restartTiming(plus = false).toJs()))
    assertEquals(Parity.js(t["retailNfr"]), Js.stringify(restartTiming(plus = false, settings = parseServerSettings("%UI&nfr~")).toJs()))
    assertEquals(Parity.js(t["RETAIL_RESTART"]), Js.stringify(RETAIL_RESTART.toJs()))
    assertEquals(Parity.js(t["PLUS_RESTART"]), Js.stringify(PLUS_RESTART.toJs()))
    val c = fx["constants"]!!.jsonObject
    assertEquals(Parity.num(c["PLUS_PROTOCOL_VERSION"])!!.toInt(), PLUS_PROTOCOL_VERSION)
    assertEquals(Parity.js(c["PLUS_VERSION"]), Js.stringify(PLUS_VERSION.toJs()))
    assertEquals(Parity.num(c["INVALID_COLOR"])!!.toLong(), INVALID_COLOR)
  }
}
