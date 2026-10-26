package io.bfstats.sidecar

// The Kotlin twin of parity/lib/fixture.mjs: loading a fixture, the value
// encoding both sides compare, the seeded PRNG and the fake clock. Keep the
// two in step.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals

object Parity {
  fun load(name: String): JsonObject {
    val text = Parity::class.java.getResource("/parity/$name.json")!!.readText()
    return Json.parseToJsonElement(text) as JsonObject
  }

  /** enc() of fixture.mjs: bytes as "hex:<hex>", maps and lists element-wise. */
  fun enc(v: Any?): Any? = when (v) {
    is ByteArray -> "hex:${v.hex()}"
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in v) m[k.toString()] = if (x === Undefined) Undefined else enc(x) }
    is List<*> -> v.map { enc(it) }
    is Array<*> -> v.map { enc(it) }
    else -> v
  }

  fun encs(v: Any?): String = Js.stringify(enc(v))
  fun encs(vararg v: Any?): String = Js.stringify(enc(v.toList()))

  /** The fixture's own JSON for a value, printed as V8 prints it. */
  fun js(e: JsonElement?): String = Js.stringify(e ?: JsonNull)

  /** A fixture value as a plain Kotlin value (string, double, boolean, map, list). */
  fun plain(e: JsonElement?): Any? = when (e) {
    null, JsonNull -> null
    is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
    is JsonObject -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in e) m[k] = plain(x) }
    is JsonArray -> e.map { plain(it) }
  }

  fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
  fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
  fun bool(e: JsonElement?): Boolean? = (e as? JsonPrimitive)?.booleanOrNull

  /** Two transcripts, line by line, with the first difference in the message. */
  fun assertLines(what: String, want: List<String>, got: List<String>) {
    val n = minOf(want.size, got.size)
    for (i in 0 until n) if (want[i] != got[i]) {
      assertEquals("$what: line $i (context: ${want.subList(maxOf(0, i - 3), i).joinToString(" | ")})", want[i], got[i])
    }
    assertEquals("$what: line count", want.size, got.size)
  }

  fun lines(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
}

/** FakeClock of fixture.mjs, as Timers. */
class FakeTimers(var t: Double = 1_000_000.0) : Timers {
  class H(var at: Double, val fn: () -> Unit, var id: Int, val every: Double?)
  private val q = mutableListOf<H>()
  private var seq = 0

  override fun now(): Long = Math.floor(t).toLong()
  override fun setTimeout(ms: Double, fn: () -> Unit): Any = H(t + ms, fn, seq++, null).also { q.add(it) }
  override fun setInterval(ms: Double, fn: () -> Unit): Any = H(t + ms, fn, seq++, ms).also { q.add(it) }
  override fun clear(handle: Any?) { if (handle != null) q.remove(handle) }
  override fun post(fn: () -> Unit) { fn() }

  fun advance(ms: Double) {
    val until = t + ms
    while (true) {
      q.sortWith(compareBy<H>({ it.at }, { it.id }))
      val h = q.firstOrNull() ?: break
      if (h.at > until) break
      t = h.at
      if (h.every != null) { h.at += h.every; h.id = seq++ } else q.removeAt(0)
      h.fn()
    }
    t = until
  }
}

/** prng() of fixture.mjs: xorshift32 in [0, 1). */
fun prng(seed: Long = 0x9e3779b9L): () -> Double {
  var s = seed.toInt()
  return {
    s = s xor (s shl 13); s = s xor (s ushr 17); s = s xor (s shl 5)
    (s.toLong() and 0xffffffffL) / 4294967296.0
  }
}
