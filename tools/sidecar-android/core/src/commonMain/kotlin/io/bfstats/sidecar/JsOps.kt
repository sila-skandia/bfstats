package io.bfstats.sidecar

import kotlin.concurrent.Volatile

// JavaScript value semantics the decoder half of the port leans on, so a
// line-by-line port of a Node module reads (and computes) as its source does.
//
// The value model, everywhere a Node module keeps a plain object or array:
//   object   MutableMap<String, Any?> (a LinkedHashMap; keys in JS order)
//   array    MutableList<Any?>
//   number   Double, always (a JSON integer too, so `===` between a parsed
//            row's netId and a decoded one is Double == Double)
//   string   String;  boolean  Boolean;  null  null;  undefined  Undefined
//
// The maths that must match V8 to the bit: `toFixed` (exact decimal of the
// double, ties away from zero), `Math.round` (ties toward +inf, -0 kept),
// `Math.hypot` (V8's scaled Kahan sum, src/builtins/math.tq MathHypot), and
// sin, cos and ** through JsMath.kt (fdlibm's sin and cos, which V8 runs; a
// correctly rounded pow, which V8's ** agrees with).


/** The characters JS's \s matches (JsOps.isJsSpace), as a regex class body. */
const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

object JsOps {
  /** console.error and console.log of the ported modules (stderr / stdout by
   *  default; the app or a test swaps them). */
  @Volatile var consoleError: (String) -> Unit = { printErr(it) }
  @Volatile var consoleLog: (String) -> Unit = { printOut(it) }

  fun obj(vararg p: Pair<String, Any?>): MutableMap<String, Any?> = linkedMapOf(*p)
  fun arr(vararg v: Any?): MutableList<Any?> = mutableListOf(*v)

  /** `v == null` in JS: null or undefined. */
  fun nullish(v: Any?): Boolean = v == null || v === Undefined

  /** JS truthiness. */
  fun truthy(v: Any?): Boolean = when (v) {
    null, Undefined -> false
    is Boolean -> v
    is Double -> !(v == 0.0 || v.isNaN())
    is Number -> v.toDouble().let { !(it == 0.0 || it.isNaN()) }
    is String -> v.isNotEmpty()
    else -> true
  }

  /** The value if it is a JS number, else null. */
  fun num(v: Any?): Double? = when (v) {
    is Double -> v
    is Number -> v.toDouble()
    else -> null
  }

  /** `Number.isInteger(v)`. */
  fun isInt(v: Any?): Boolean = num(v)?.let { it.isFinite() && Math.floor(it) == it } ?: false

  /** `Number.isFinite(v)`. */
  fun isFiniteNum(v: Any?): Boolean = num(v)?.isFinite() ?: false

  /** `a === b`: numbers by value (NaN unequal, -0 equal to 0), else equals for
   *  strings and booleans, identity for objects. */
  fun eq(a: Any?, b: Any?): Boolean {
    if (a is Number && b is Number) return a.toDouble() == b.toDouble()
    if (a == null) return b == null
    if (a === Undefined) return b === Undefined
    if (a is String || a is Boolean) return a == b
    return a === b
  }

  /** `a == b` restricted to what the ported code compares: null == undefined. */
  fun looseEq(a: Any?, b: Any?): Boolean = if (nullish(a) || nullish(b)) nullish(a) && nullish(b) else eq(a, b)

  /** `String(v)`, as a template literal prints it. */
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

  /** The SameValueZero key a JS Map would use: -0 is 0. */
  fun key(v: Any?): Any? = if (v is Double && v == 0.0) 0.0 else if (v is Number && v !is Double) v.toDouble() else v

  /** `m[k]`, undefined when the key is absent or m is not an object. */
  fun get(m: Any?, k: String): Any? {
    if (m !is Map<*, *>) return Undefined
    return if (m.containsKey(k)) m[k] else Undefined
  }

  /** `v[k]` for an array or object and a number or string key; undefined
   *  for what is not there (and for v null or undefined, as `v?.[k]`). */
  fun at(v: Any?, k: Any?): Any? {
    when (v) {
      is List<*> -> {
        val i = when (k) {
          is Number -> k.toDouble()
          is String -> if (isIndexKey(k)) k.toDouble() else return Undefined
          else -> return Undefined
        }
        if (i < 0 || i != Math.floor(i) || i >= v.size) return Undefined
        return v[i.toInt()]
      }
      is Map<*, *> -> { val s = str(k); return if (v.containsKey(s)) v[s] else Undefined }
      else -> return Undefined
    }
  }

  /** `a ?? b`. */
  inline fun <T> coalesce(a: Any?, b: () -> T): Any? = if (nullish(a)) b() else a

  // ---- numbers ------------------------------------------------------------

  /** `x.toFixed(f)`: the exact decimal value of the double, rounded half away
   *  from zero (ECMA-262 Number.prototype.toFixed picks the larger n on a tie,
   *  of |x|); String(x) from 1e21 up. */
  fun toFixedStr(x: Double, f: Int): String {
    if (x.isNaN()) return "NaN"
    if (Math.abs(x) >= 1e21 || x.isInfinite()) return Js.numberToString(x)
    var s = JsNumber.fixed(x, f)
    // ECMA-262: "If x < 0, then set s to "-""; -0 is not below 0.
    if (x < 0 && !s.startsWith("-")) s = "-$s"
    return s
  }

  /** `+x.toFixed(f)`. */
  fun toFixed(x: Double, f: Int): Double {
    if (x.isNaN()) return Double.NaN
    if (Math.abs(x) >= 1e21 || x.isInfinite()) return x
    return JsNumber.parseDecimal(toFixedStr(x, f))
  }

  /** `Math.round(x)`: the nearest integer, ties toward +infinity; -0 for
   *  x in [-0.5, -0]. */
  fun round(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    if (Math.abs(x) >= 4503599627370496.0) return x
    val r = Math.round(x).toDouble()
    return if (r == 0.0 && (x < 0 || (x == 0.0 && 1.0 / x < 0))) -0.0 else r
  }

  /** `Math.hypot(...v)`, V8's: normalise by the largest, Kahan-sum the squares. */
  fun hypot(vararg v: Double): Double {
    if (v.isEmpty()) return 0.0
    var max = 0.0
    var nan = false
    for (x in v) {
      if (x.isNaN()) nan = true
      else { val a = Math.abs(x); if (a > max) max = a }
    }
    if (max == Double.POSITIVE_INFINITY) return Double.POSITIVE_INFINITY
    if (nan) return Double.NaN
    if (max == 0.0) return 0.0
    var sum = 0.0
    var compensation = 0.0
    for (x in v) {
      val n = Math.abs(x) / max
      val summand = n * n - compensation
      val preliminary = sum + summand
      compensation = (preliminary - sum) - summand
      sum = preliminary
    }
    return Math.sqrt(sum) * max
  }

  fun sin(x: Double) = Math.sin(x)
  fun cos(x: Double) = Math.cos(x)
  /** `a ** b`, Math.pow. */
  fun pow(a: Double, b: Double) = Math.pow(a, b)

  /** bitstream.mjs `rangedBits(min, max)` over JS numbers (a NaN or
   *  fractional bound included), where BitStream.kt's takes Longs. */
  fun rangedBits(min: Double, max: Double): Int {
    val range = max - min + 1
    if (range == 4294967296.0) return 0
    if (range > 2147483647.0) return 32
    var n = 0
    if (max - min != -1.0) {
      do { n++ } while ((((1 shl (n and 31)) - 1).toLong() and 0xffffffffL).toDouble() < (max - min) + 1)
    }
    return n
  }

  /** `Number(v)` (ECMA-262 ToNumber) for the values JSON and the tables hold. */
  fun toNumber(v: Any?): Double = when (v) {
    null -> 0.0
    Undefined -> Double.NaN
    is Boolean -> if (v) 1.0 else 0.0
    is Number -> v.toDouble()
    is String -> stringToNumber(v)
    is List<*> -> stringToNumber(str(v))
    else -> Double.NaN
  }

  private val DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

  /** JS WhiteSpace or LineTerminator (ECMA-262 12.2, 12.3): what \s matches
   *  and String#trim strips. */
  fun isJsSpace(c: Char): Boolean = when (c) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> c in ' '..' '
  }
  /** String#trim, trimEnd. */
  fun trim(s: String): String = s.trim(::isJsSpace)
  fun trimEnd(s: String): String = s.trimEnd(::isJsSpace)
  fun trimStart(s: String): String = s.trimStart(::isJsSpace)

  /** ToNumber(string): trimmed, empty is 0, decimal or 0x / 0o / 0b, Infinity;
   *  anything else NaN. */
  fun stringToNumber(s0: String): Double {
    val s = trim(s0)
    if (s.isEmpty()) return 0.0
    when (s) { "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY; "-Infinity" -> return Double.NEGATIVE_INFINITY }
    if (s.length > 2 && s[0] == '0' && s[1] in "xXoObB") {
      val radix = when (s[1]) { 'x', 'X' -> 16; 'o', 'O' -> 8; else -> 2 }
      val digits = s.substring(2)
      if (!digits.all { "0123456789abcdef".indexOf(it.lowercaseChar()) in 0 until radix }) return Double.NaN
      return BigNat.parse(digits, radix)?.toDouble() ?: Double.NaN
    }
    if (!DECIMAL.matches(s)) return Double.NaN
    return JsNumber.parseDecimal(s)
  }

  /** `Number(s) || 0` for a string that may be absent (an env variable). */
  fun numberOr0(s: String?): Double { val n = if (s == null) Double.NaN else stringToNumber(s); return if (n.isNaN()) 0.0 else n }

  /** `Math.fround(x)`. */
  fun fround(x: Double): Double = x.toFloat().toDouble()

  /** JS `x | 0`. */
  fun toInt32(x: Double): Int {
    if (x.isNaN() || x.isInfinite()) return 0
    val t = if (x < 0) Math.ceil(x) else Math.floor(x)
    return JsNumber.int32OfIntegral(t)
  }
  fun toInt32(v: Any?): Int = when (v) { is Int -> v; is Long -> v.toInt(); else -> toInt32(toNumber(v)) }

  /** JS `x >>> 0` (ToUint32), as a Long in 0..2^32-1. */
  fun toUint32(x: Double): Long = toInt32(x).toLong() and 0xffffffffL
  fun toUint32(v: Any?): Long = toInt32(v).toLong() and 0xffffffffL

  /** `n.toString(16)` for an integer value (a negative one keeps its sign);
   *  another number as Number#toString(10). */
  fun hex(n: Long): String = n.toString(16)
  fun hex(v: Any?): String {
    val d = toNumber(v)
    return if (isInt(d) && Math.abs(d) < 9.007199254740992E15) hex(d.toLong()) else Js.numberToString(d)
  }

  // ---- objects ------------------------------------------------------------

  /** A canonical numeric index key ("0", "17"; not "01" or "-1"): JS lists
   *  these first, ascending, whatever order they were set in. */
  fun isIndexKey(k: String): Boolean {
    if (k.isEmpty() || k.length > 10) return false
    if (k.length > 1 && k[0] == '0') return false
    for (c in k) if (c !in '0'..'9') return false
    return k.toLong() < 4294967295L
  }

  /** The map with its keys in JS property order. */
  fun <V> jsOrder(m: Map<String, V>): LinkedHashMap<String, V> {
    if (m.keys.none { isIndexKey(it) }) return if (m is LinkedHashMap<String, V>) m else LinkedHashMap(m)
    val out = LinkedHashMap<String, V>(m.size * 2)
    for (k in m.keys.filter { isIndexKey(it) }.sortedBy { it.toLong() }) out[k] = m[k] as V
    for ((k, v) in m) if (!isIndexKey(k)) out[k] = v
    return out
  }

  /** `{ ...a, ...b }` of plain objects. */
  fun spread(vararg parts: Map<String, Any?>?): MutableMap<String, Any?> {
    val out = LinkedHashMap<String, Any?>()
    for (p in parts) if (p != null) for ((k, v) in p) out[k] = v
    return jsOrder(out)
  }

  /** `structuredClone`-free deep copy of a JSON value (lists and maps). */
  fun deepCopy(v: Any?): Any? = when (v) {
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { o -> for ((k, x) in v) o[k as String] = deepCopy(x) }
    is List<*> -> v.mapTo(ArrayList()) { deepCopy(it) }
    else -> v
  }

  // ---- JSON.parse ---------------------------------------------------------

  /** `JSON.parse(text)` into the value model above. Throws on what JSON.parse
   *  rejects. */
  fun parse(text: String): Any? = Parser(text).run()

  private class Parser(val s: String) {
    var i = 0
    fun run(): Any? { ws(); val v = value(); ws(); if (i != s.length) fail(); return v }
    fun fail(): Nothing = throw IllegalArgumentException("JSON.parse: bad input at $i")
    fun ws() { while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++ }
    fun value(): Any? {
      if (i >= s.length) fail()
      return when (s[i]) {
        '{' -> objectV()
        '[' -> arrayV()
        '"' -> string()
        't' -> lit("true", true)
        'f' -> lit("false", false)
        'n' -> lit("null", null)
        else -> number()
      }
    }
    fun lit(w: String, v: Any?): Any? { if (!s.startsWith(w, i)) fail(); i += w.length; return v }
    fun objectV(): Any? {
      i++
      val m = LinkedHashMap<String, Any?>()
      ws()
      if (i < s.length && s[i] == '}') { i++; return m }
      while (true) {
        ws()
        if (i >= s.length || s[i] != '"') fail()
        val k = string()
        ws()
        if (i >= s.length || s[i] != ':') fail()
        i++
        ws()
        m[k] = value()
        ws()
        if (i >= s.length) fail()
        if (s[i] == ',') { i++; continue }
        if (s[i] == '}') { i++; break }
        fail()
      }
      return jsOrder(m)
    }
    fun arrayV(): Any? {
      i++
      val a = ArrayList<Any?>()
      ws()
      if (i < s.length && s[i] == ']') { i++; return a }
      while (true) {
        ws()
        a.add(value())
        ws()
        if (i >= s.length) fail()
        if (s[i] == ',') { i++; continue }
        if (s[i] == ']') { i++; break }
        fail()
      }
      return a
    }
    fun string(): String {
      i++
      val sb = StringBuilder()
      while (true) {
        if (i >= s.length) fail()
        val c = s[i++]
        when {
          c == '"' -> return sb.toString()
          c == '\\' -> {
            if (i >= s.length) fail()
            when (val e = s[i++]) {
              '"' -> sb.append('"'); '\\' -> sb.append('\\'); '/' -> sb.append('/')
              'b' -> sb.append('\b'); 'f' -> sb.append('\u000c'); 'n' -> sb.append('\n')
              'r' -> sb.append('\r'); 't' -> sb.append('\t')
              'u' -> {
                if (i + 4 > s.length) fail()
                val h = s.substring(i, i + 4)
                if (!h.all { hexDigit(it) >= 0 }) fail()
                sb.append(h.toInt(16).toChar()); i += 4
              }
              else -> { if (e == 'x') fail(); fail() }
            }
          }
          c < ' ' -> fail()
          else -> sb.append(c)
        }
      }
    }
    fun number(): Double {
      val st = i
      if (i < s.length && s[i] == '-') i++
      if (i >= s.length) fail()
      if (s[i] == '0') i++
      else if (s[i] in '1'..'9') { while (i < s.length && s[i] in '0'..'9') i++ }
      else fail()
      if (i < s.length && s[i] == '.') {
        i++
        if (i >= s.length || s[i] !in '0'..'9') fail()
        while (i < s.length && s[i] in '0'..'9') i++
      }
      if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
        i++
        if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
        if (i >= s.length || s[i] !in '0'..'9') fail()
        while (i < s.length && s[i] in '0'..'9') i++
      }
      return JsNumber.parseDecimal(s.substring(st, i))
    }
  }
}

/** Shorthands for reading the value model. */
@Suppress("UNCHECKED_CAST")
fun Any?.asObj(): MutableMap<String, Any?>? = this as? MutableMap<String, Any?>
@Suppress("UNCHECKED_CAST")
fun Any?.asList(): MutableList<Any?>? = this as? MutableList<Any?>
/** `o.k` (undefined when absent). */
fun Any?.g(k: String): Any? = JsOps.get(this, k)
/** `o.k` as a number, or null when it is not one. */
fun Any?.n(k: String): Double? = JsOps.num(JsOps.get(this, k))
/** `o.k` as a string, or null when it is not one. */
fun Any?.s(k: String): String? = JsOps.get(this, k) as? String

/** `new BitReader(Buffer.from(hex, 'hex'), bodyBits)`: `bodyBits` null is
 *  undefined (the buffer's length). A bit past the buffer but inside
 *  `bodyBits` reads 0, as a JS typed array's out-of-range byte does
 *  (BitReader.readBit). The end is compared as Node compares `pos >= end`:
 *  a NaN or +Infinity end is never reached (zeros for ever), a fractional
 *  one lets the bit below it be read (10.5 reads 11 bits). */
fun hexReader(hex: String?, bodyBits: Double?): BitReader {
  val b = fromHex(hex ?: "")
  if (bodyBits == null) return BitReader(b, b.size * 8)
  val end = when {
    bodyBits.isNaN() || bodyBits >= Int.MAX_VALUE -> Int.MAX_VALUE
    bodyBits <= Int.MIN_VALUE -> Int.MIN_VALUE
    else -> Math.ceil(bodyBits).toInt()
  }
  return BitReader(b, end)
}

/** The BitReader's reads as the Node copy returns them: JS numbers. A signed
 *  read with the sign set and a zero magnitude is -0, as `neg ? -m : m` is. */
fun BitReader.u(n: Int): Double = readUnsigned(n).toDouble()
fun BitReader.sgn(n: Int): Double {
  val neg = readBit()
  val m = readUnsigned(n - 1).toDouble()
  return if (neg != 0) -m else m
}
fun BitReader.ranged(min: Long, max: Long): Double = readRanged(min, max).toDouble()
fun BitReader.vec(ref: List<Double>, scale: Double): MutableList<Any?> {
  val mode = readUnsigned(2).toInt()
  if (mode == 0) return mutableListOf(readFloat(), readFloat(), readFloat())
  val bits = COMPRESSION_BITS[mode]
  val dx = sgn(bits); val dy = sgn(bits); val dz = sgn(bits)
  return mutableListOf(ref[0] + scale * dx, ref[1] + scale * dy, ref[2] + scale * dz)
}
fun BitReader.fullVec(): MutableList<Any?> = mutableListOf(readFloat(), readFloat(), readFloat())
fun BitReader.quat(bits: Int): MutableList<Any?> = readUnitQuaternion(bits).mapTo(ArrayList<Any?>()) { it }

/** A JS number array (list of Doubles) as doubles; nulls read as NaN. */
fun Any?.dl(): List<Double>? = (this as? List<*>)?.map { JsOps.num(it) ?: Double.NaN }

/** The part of Node's `path` (posix) and `fs` the install readers use. */
object NodeFs {
  /** path.posix.join: the parts joined with '/', then normalised ('.' and
   *  '..' resolved, runs of '/' collapsed, a trailing '/' kept); "" is ".". */
  fun join(vararg parts: String): String {
    val joined = parts.filter { it.isNotEmpty() }.joinToString("/")
    return if (joined.isEmpty()) "." else normalize(joined)
  }

  /** path.posix.normalize. */
  fun normalize(p: String): String {
    if (p.isEmpty()) return "."
    val abs = p.startsWith("/")
    val trailing = p.endsWith("/")
    val out = ArrayList<String>()
    for (seg in p.split('/')) {
      when {
        seg.isEmpty() || seg == "." -> {}
        seg == ".." -> if (out.isNotEmpty() && out.last() != "..") out.removeAt(out.size - 1) else if (!abs) out.add("..")
        else -> out.add(seg)
      }
    }
    var s = out.joinToString("/")
    if (s.isEmpty() && !abs) s = "."
    if (s.isNotEmpty() && trailing) s += "/"
    return if (abs) "/$s" else s
  }

  /** A Node fs error: `code` and the message Node prints for it. */
  class Error(val code: String, message: String) : RuntimeException(message)

  /** The reason a path cannot be opened as Node names it: ENOENT, or
   *  ENOTDIR when a folder on the way is a file. */
  private fun missing(path: String): String {
    var up = FsFile(path).parentFile
    while (up != null && !up.exists()) up = up.parentFile
    return if (up != null && !up.isDirectory) "ENOTDIR" else "ENOENT"
  }

  /** fs.readdirSync(dir): the names in strcmp order (libuv's scandir sorts
   *  them), or Node's error. */
  fun readdir(dir: String): List<String> {
    val f = FsFile(dir)
    if (!f.exists()) {
      val code = missing(dir)
      throw Error(code, if (code == "ENOENT") "ENOENT: no such file or directory, scandir '$dir'" else "ENOTDIR: not a directory, scandir '$dir'")
    }
    if (!f.isDirectory) throw Error("ENOTDIR", "ENOTDIR: not a directory, scandir '$dir'")
    return (f.list() ?: throw Error("EACCES", "EACCES: permission denied, scandir '$dir'")).sorted()
  }

  /** fs.existsSync. */
  fun exists(path: String): Boolean = try { FsFile(path).exists() } catch (e: Exception) { false }

  /** fs.readFileSync(path) as bytes, with Node's error for a folder or a missing file. */
  fun readFile(path: String): ByteArray {
    val f = FsFile(path)
    if (!f.exists()) throw Error(missing(path), "${missing(path)}: no such file or directory, open '$path'")
    if (f.isDirectory) throw Error("EISDIR", "EISDIR: illegal operation on a directory, read")
    return f.readBytes()
  }

  /** fs.statSync(path).mtimeMs (with its fraction), or Node's error. */
  fun mtimeMs(path: String): Double =
    fileMtimeMsExact(path) ?: throw Error(missing(path), "${missing(path)}: no such file or directory, stat '$path'")
}
