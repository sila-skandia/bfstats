package io.bfstats.sidecar

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Js against V8, from parity/js-format.mjs. */
class JsTest {
  private val fixture: JsonObject by lazy {
    val text = Fixtures.text("js-format.json")
    Json.parseToJsonElement(text).jsonObject
  }

  @Test fun numbersPrintAsV8PrintsThem() {
    val bad = mutableListOf<String>()
    for (row in fixture["numbers"]!!.jsonArray) {
      val (hex, want) = row.jsonArray.map { it.jsonPrimitive.content }
      val d = Double.fromBits(hex.toULong(16).toLong())
      val got = Js.numberToString(d)
      if (got != want) bad += "$hex: want $want got $got"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  @Test fun stringsQuoteAsJsonStringify() {
    for (row in fixture["strings"]!!.jsonArray) {
      val units = row.jsonArray[0].jsonArray.map { it.jsonPrimitive.int.toChar() }.toCharArray()
      assertEquals(row.jsonArray[1].jsonPrimitive.content, Js.stringify(units.concatToString()))
    }
  }

  @Test fun objectsKeepKeyOrderAndDropUndefined() {
    val row = linkedMapOf(
      "k" to "s", "t" to 1.5, "a" to listOf(1, null, -0.0, 2.5e-7), "u" to Undefined,
      "n" to linkedMapOf("x" to 1e21),
    )
    val want = (fixture["objects"]!!.jsonArray[0] as JsonArray)[1].jsonPrimitive.content
    assertEquals(want, Js.stringify(row))
    assertEquals("[null,1]", Js.stringify(listOf(Undefined, 1)))
  }
}
