package io.bfstats.sidecar

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/** Js against V8, from parity/js-format.mjs. */
class JsTest {
  private val fixture: JsonObject by lazy {
    val text = javaClass.getResource("/parity/js-format.json")!!.readText()
    Json.parseToJsonElement(text).jsonObject
  }

  @Test fun numbersPrintAsV8PrintsThem() {
    val bad = mutableListOf<String>()
    for (row in fixture["numbers"]!!.jsonArray) {
      val (hex, want) = row.jsonArray.map { it.jsonPrimitive.content }
      val d = java.lang.Double.longBitsToDouble(java.lang.Long.parseUnsignedLong(hex, 16))
      val got = Js.numberToString(d)
      if (got != want) bad += "$hex: want $want got $got"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  @Test fun stringsQuoteAsJsonStringify() {
    for (row in fixture["strings"]!!.jsonArray) {
      val units = row.jsonArray[0].jsonArray.map { it.jsonPrimitive.int.toChar() }.toCharArray()
      assertEquals(row.jsonArray[1].jsonPrimitive.content, Js.stringify(String(units)))
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
