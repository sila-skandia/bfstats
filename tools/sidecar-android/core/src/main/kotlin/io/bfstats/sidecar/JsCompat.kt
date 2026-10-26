package io.bfstats.sidecar

// JavaScript string and number behaviour the ported modules lean on, spelled
// out so the JVM (and Android's ICU regex engine) cannot drift from V8:
// what \s matches, what trim() strips, what Number(s) and `>>> 0` give.

/** The characters JS's \s and String#trim treat as white space
 *  (WhiteSpace + LineTerminator, ECMA-262 12.2 / 12.3), as a regex class body. */
const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

fun isJsWhitespace(c: Char): Boolean = when (c) {
  '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
  else -> c in ' '..' '
}

/** String#trim. */
fun jsTrim(s: String): String = s.trim { isJsWhitespace(it) }

/** ToUint32 (`x >>> 0`) of a double. */
fun toUint32(d: Double): Long {
  if (d.isNaN() || d.isInfinite()) return 0
  val t = if (d < 0) Math.ceil(d) else Math.floor(d)
  var m = t % 4294967296.0
  if (m < 0) m += 4294967296.0
  return m.toLong()
}

/** ToInt32 (`x | 0`) of a double. */
fun toInt32(d: Double): Int = toUint32(d).toInt()

/** Number(s) for a string (StringToNumber): trimmed, empty is 0, decimal or
 *  0x / 0o / 0b, Infinity; anything else NaN. Number(undefined) is NaN. */
fun jsNumber(s: String?): Double {
  if (s == null) return Double.NaN
  val t = jsTrim(s)
  if (t.isEmpty()) return 0.0
  val lower = t.lowercase()
  for ((p, radix) in listOf("0x" to 16, "0o" to 8, "0b" to 2)) {
    if (lower.startsWith(p)) {
      val digits = t.substring(2)
      if (digits.isEmpty() || !digits.all { "0123456789abcdef".indexOf(it.lowercaseChar()) in 0 until radix }) return Double.NaN
      return java.math.BigInteger(digits, radix).toDouble()
    }
  }
  return when (t) {
    "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
    "-Infinity" -> Double.NEGATIVE_INFINITY
    else -> if (Regex("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$").matches(t)) t.toDouble() else Double.NaN
  }
}

/** `Number(x) || 0`: NaN and 0 are 0. */
fun jsNumberOr0(s: String?): Double { val n = jsNumber(s); return if (n.isNaN()) 0.0 else n }

/** A JS object's own-key order: array-index keys ascending, then the rest in
 *  insertion order (OrdinaryOwnPropertyKeys). */
fun <V> jsKeyOrder(m: Map<String, V>): LinkedHashMap<String, V> {
  val idx = m.keys.filter { isArrayIndex(it) }.sortedBy { it.toLong() }
  val out = LinkedHashMap<String, V>()
  for (k in idx) out[k] = m.getValue(k)
  for ((k, v) in m) if (!isArrayIndex(k)) out[k] = v
  return out
}

private fun isArrayIndex(k: String): Boolean {
  if (k.isEmpty() || k.length > 10 || !k.all { it in '0'..'9' }) return false
  if (k.length > 1 && k[0] == '0') return false
  return k.toLong() < 4294967295L
}

/** n.toString(16) for an integer-valued number (a negative one keeps its sign). */
fun jsHex(n: Long): String = java.lang.Long.toString(n, 16)
