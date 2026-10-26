package io.bfstats.sidecar

// JavaScript's JSON.stringify and Number#toString, exactly, so every row the
// Kotlin sidecar sends the page (and writes to a recording) is byte-identical
// to the Node sidecar's. The parity tests compare those bytes.
//
// Values: Map (keys in insertion order, as a JS object's string keys are),
// List / Array / DoubleArray / IntArray / LongArray, Number, String, Boolean,
// null, kotlinx JsonElement, and Undefined. Undefined is JS undefined: a key
// holding it is left out of an object, and it is written as null in an array.

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/** JS undefined, for rows that set a key only sometimes. */
object Undefined

object Js {
  /** JSON.stringify(v), no indent. Undefined at the top gives null. */
  fun stringify(v: Any?): String = StringBuilder().also { write(it, v) }.toString()

  /** Number#toString(10) for a double: the shortest digits that round-trip,
   *  in JS's fixed or exponent layout. */
  fun numberToString(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d == 0.0) return "0" // and -0
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    // Safe integers need every digit, so the shortest form is the exact one.
    if (d == Math.rint(d) && Math.abs(d) < 9.007199254740992E15) return d.toLong().toString()
    val neg = d < 0
    val (digits, n) = shortest(Math.abs(d))
    val k = digits.length
    val sb = StringBuilder()
    if (neg) sb.append('-')
    when {
      n in k..21 -> { sb.append(digits); repeat(n - k) { sb.append('0') } }
      n in 1..21 -> { sb.append(digits, 0, n).append('.').append(digits, n, k) }
      n in -5..0 -> { sb.append("0."); repeat(-n) { sb.append('0') }; sb.append(digits) }
      else -> {
        sb.append(digits[0])
        if (k > 1) sb.append('.').append(digits, 1, k)
        sb.append('e').append(if (n - 1 >= 0) "+" else "-").append(Math.abs(n - 1))
      }
    }
    return sb.toString()
  }

  /** The shortest decimal digits s and exponent n with s x 10^(n - len(s)) == d
   *  (ECMA-262 Number::toString step 5). d > 0, finite. */
  private fun shortest(d: Double): Pair<String, Int> {
    val exact = BigDecimal(d)
    for (p in 1..17) {
      val r = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
      if (r.toDouble() == d) {
        val u = r.unscaledValue().toString().trimEnd('0').ifEmpty { "0" }
        // value = unscaled x 10^-scale; n is the position of the decimal point
        // after the first digit run.
        val n = r.precision() - r.scale()
        return u to n
      }
    }
    error("no round-trip digits for $d")
  }

  private fun write(sb: StringBuilder, v: Any?) {
    when (v) {
      null, Undefined -> sb.append("null")
      is String -> quote(sb, v)
      is Boolean -> sb.append(if (v) "true" else "false")
      is Double -> number(sb, v)
      is Float -> number(sb, v.toDouble())
      is Int, is Long, is Short, is Byte -> sb.append(v.toString())
      is Number -> number(sb, v.toDouble())
      is Map<*, *> -> {
        sb.append('{')
        var first = true
        for ((k, x) in v) {
          if (x === Undefined) continue
          if (!first) sb.append(',')
          first = false
          quote(sb, k.toString()); sb.append(':'); write(sb, x)
        }
        sb.append('}')
      }
      is List<*> -> array(sb, v.size) { write(sb, v[it]) }
      is Array<*> -> array(sb, v.size) { write(sb, v[it]) }
      is DoubleArray -> array(sb, v.size) { number(sb, v[it]) }
      is IntArray -> array(sb, v.size) { sb.append(v[it]) }
      is LongArray -> array(sb, v.size) { sb.append(v[it]) }
      is JsonElement -> element(sb, v)
      else -> throw IllegalArgumentException("not a JSON value: ${v::class}")
    }
  }

  private inline fun array(sb: StringBuilder, n: Int, each: (Int) -> Unit) {
    sb.append('[')
    for (i in 0 until n) { if (i > 0) sb.append(','); each(i) }
    sb.append(']')
  }

  private fun number(sb: StringBuilder, d: Double) {
    if (d.isNaN() || d.isInfinite()) sb.append("null") else sb.append(numberToString(d))
  }

  private fun element(sb: StringBuilder, e: JsonElement) {
    when (e) {
      is JsonNull -> sb.append("null")
      is JsonPrimitive -> when {
        e.isString -> quote(sb, e.content)
        e.content == "true" || e.content == "false" -> sb.append(e.content)
        else -> number(sb, e.content.toDouble())
      }
      is JsonObject -> write(sb, e as Map<String, JsonElement>)
      is JsonArray -> array(sb, e.size) { element(sb, e[it]) }
    }
  }

  /** JSON.stringify's string quoting (well-formed: lone surrogates escaped). */
  fun quote(sb: StringBuilder, s: String) {
    sb.append('"')
    var i = 0
    while (i < s.length) {
      val c = s[i]
      when {
        c == '"' -> sb.append("\\\"")
        c == '\\' -> sb.append("\\\\")
        c == '\b' -> sb.append("\\b")
        c == '\u000c' -> sb.append("\\f")
        c == '\n' -> sb.append("\\n")
        c == '\r' -> sb.append("\\r")
        c == '\t' -> sb.append("\\t")
        c < ' ' -> hex(sb, c)
        Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { sb.append(c).append(s[i + 1]); i++ }
        Character.isSurrogate(c) -> hex(sb, c)
        else -> sb.append(c)
      }
      i++
    }
    sb.append('"')
  }

  private fun hex(sb: StringBuilder, c: Char) {
    sb.append("\\u")
    val h = Integer.toHexString(c.code)
    repeat(4 - h.length) { sb.append('0') }
    sb.append(h)
  }
}
