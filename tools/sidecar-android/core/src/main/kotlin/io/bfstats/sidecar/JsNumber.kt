package io.bfstats.sidecar

// JavaScript's number conversions and value tests, for ports that handle
// values as the Node copy does (rows parsed from JSON, page words): ToInt32,
// ToUint32, Math.round, truthiness, `??`, `===`, template-string text and
// Map keys. Values are those JsParse.parse and Js.stringify use: Double (any
// Number is taken as its double), String, Boolean, null, Undefined, Map, List.

object JsNumber {
  /** ToNumber for the values a row can hold. */
  fun num(v: Any?): Double = when (v) {
    null -> 0.0
    Undefined -> Double.NaN
    is Number -> v.toDouble()
    is Boolean -> if (v) 1.0 else 0.0
    is String -> stringToNumber(v)
    is List<*> -> stringToNumber(str(v)) // ToPrimitive: the array's join
    else -> Double.NaN
  }

  private val DECIMAL = Regex("[+-]?(Infinity|(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)")
  private val RADIX = Regex("0([xXoObB])([0-9a-fA-F]+)")

  /** ToNumber(string). */
  fun stringToNumber(raw: String): Double {
    val s = trim(raw)
    if (s.isEmpty()) return 0.0
    RADIX.matchEntire(s)?.let { m ->
      val radix = when (m.groupValues[1].lowercase()) { "x" -> 16; "o" -> 8; else -> 2 }
      return m.groupValues[2].toBigIntegerOrNull(radix)?.toDouble() ?: Double.NaN
    }
    if (!DECIMAL.matches(s)) return Double.NaN
    return when (s) {
      "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
      "-Infinity" -> Double.NEGATIVE_INFINITY
      else -> s.toDouble()
    }
  }

  /** ToInt32 (`x | 0`). */
  fun toInt32(d: Double): Int {
    if (d.isNaN() || d.isInfinite()) return 0
    val t = if (d < 0) Math.ceil(d) else Math.floor(d)
    // mod 2^32, exact for any double magnitude.
    val m = java.math.BigDecimal(t).toBigInteger().toLong()
    return m.toInt()
  }
  fun toInt32(v: Any?): Int = when (v) { is Int -> v; is Long -> v.toInt(); else -> toInt32(num(v)) }

  /** ToUint32 (`x >>> 0`), as a Long in 0..2^32-1. */
  fun toUint32(d: Double): Long = toInt32(d).toLong() and 0xffffffffL
  fun toUint32(v: Any?): Long = toInt32(v).toLong() and 0xffffffffL

  /** Math.round: nearest, ties toward +Infinity. */
  fun round(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    val f = Math.floor(x)
    return if (x - f >= 0.5) f + 1 else f
  }

  /** Number.isInteger. */
  fun isInteger(v: Any?): Boolean = when (v) {
    is Int, is Long, is Short, is Byte -> true
    is Number -> v.toDouble().let { !it.isNaN() && !it.isInfinite() && Math.floor(it) == it }
    else -> false
  }
  /** Number.isFinite. */
  fun isFinite(v: Any?): Boolean = v is Number && v.toDouble().let { !it.isNaN() && !it.isInfinite() }

  /** `v == null` in JS: null or undefined. */
  fun nullish(v: Any?): Boolean = v == null || v === Undefined

  /** `a ?? b`. */
  inline fun <T> coalesce(a: Any?, b: () -> T): Any? = if (nullish(a)) b() else a

  /** JS truthiness. */
  fun truthy(v: Any?): Boolean = when (v) {
    null, Undefined -> false
    is Boolean -> v
    is String -> v.isNotEmpty()
    is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
    else -> true
  }

  /** `a === b` for row values: numbers by value (so 0 === -0, NaN !== NaN),
   *  strings by content, objects by identity. */
  fun strictEq(a: Any?, b: Any?): Boolean = when {
    a is Number && b is Number -> a.toDouble() == b.toDouble()
    a is Number || b is Number -> false
    a is String && b is String -> a == b
    a is Boolean && b is Boolean -> a == b
    a == null && b == null -> true
    a === Undefined && b === Undefined -> true
    else -> a === b
  }

  /** String(v), as a template string writes it. */
  fun str(v: Any?): String = when (v) {
    null -> "null"
    Undefined -> "undefined"
    is String -> v
    is Boolean -> v.toString()
    is Number -> Js.numberToString(v.toDouble())
    is List<*> -> v.joinToString(",") { if (nullish(it)) "" else str(it) }
    is Map<*, *> -> "[object Object]"
    else -> v.toString()
  }

  /** Number#toFixed(digits): the exact value rounded half away from zero. */
  fun toFixed(x: Double, digits: Int): String {
    if (x.isNaN()) return "NaN"
    if (Math.abs(x) >= 1e21 || x.isInfinite()) return Js.numberToString(x)
    val s = java.math.BigDecimal(x).setScale(digits, java.math.RoundingMode.HALF_UP).toPlainString()
    // (-0.0001).toFixed(3) is "-0.000" in JS: the sign of x, not of the rounding.
    return if (x < 0 && !s.startsWith("-")) "-$s" else s
  }

  /** Number#toString(16) for an integer value; other doubles as Number#toString(10). */
  fun hex(v: Any?): String {
    val d = num(v)
    return if (isInteger(d) && Math.abs(d) < 9.007199254740992E15) d.toLong().toString(16) else Js.numberToString(d)
  }

  /** JS WhiteSpace or LineTerminator, what String#trim removes. */
  fun isJsSpace(c: Char): Boolean = when (c) {
    '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', ' ', ' ', ' ', ' ', ' ',
    ' ', ' ', '　', '﻿' -> true
    else -> c in ' '..' '
  }
  fun trim(s: String): String = s.trim(::isJsSpace)
  fun trimEnd(s: String): String = s.trimEnd(::isJsSpace)

  /** A value as a JS Map / Set key (SameValueZero): numbers as their double, -0 as 0. */
  fun key(v: Any?): Any? = when (v) {
    is Number -> v.toDouble().let { if (it == 0.0) 0.0 else it }
    else -> v
  }
}
