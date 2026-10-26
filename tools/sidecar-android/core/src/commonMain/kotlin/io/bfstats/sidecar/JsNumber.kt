package io.bfstats.sidecar

// Number#toString, Number#toFixed and ToInt32 as V8 computes them, on exact
// integer arithmetic in plain Kotlin (they used java.math.BigDecimal).
//
// Number#toString: the shortest digits that read back as the same double,
// and of those the nearest to its exact value, the last digit to even on a
// tie: Steele & White / Burger & Dybvig's free-format algorithm, as V8's
// bignum-dtoa.cc runs it when its fast Grisu3 path gives up. It is what every
// correct shortest printer prints; JsTest checks it on 16.5k doubles V8 printed.

/** A non-negative integer as 32-bit limbs, least significant first. Mutable:
 *  the printers keep three or four and update them in place. */
internal class BigNat private constructor(private var mag: IntArray, private var len: Int) {
  constructor(v: Long) : this(IntArray(4), 0) { set(v) }

  fun copy() = BigNat(mag.copyOf(), len)

  fun set(v: Long): BigNat {
    require(v >= 0)
    len = 0
    var x = v
    while (x != 0L) { ensure(len + 1); mag[len++] = x.toInt(); x = x ushr 32 }
    return this
  }

  val isZero get() = len == 0

  private fun ensure(n: Int) { if (mag.size < n) mag = mag.copyOf(maxOf(n, mag.size * 2)) }
  private fun trim() { while (len > 0 && mag[len - 1] == 0) len-- }

  fun mulSmall(m: Int): BigNat {
    var carry = 0L
    val mm = m.toLong() and 0xffffffffL
    for (i in 0 until len) {
      val p = (mag[i].toLong() and 0xffffffffL) * mm + carry
      mag[i] = p.toInt()
      carry = p ushr 32
    }
    if (carry != 0L) { ensure(len + 1); mag[len++] = carry.toInt() }
    trim()
    return this
  }

  fun addSmall(a: Int): BigNat {
    var carry = a.toLong() and 0xffffffffL
    var i = 0
    while (carry != 0L) {
      ensure(i + 1)
      if (i >= len) { mag[i] = 0; len = i + 1 }
      val s = (mag[i].toLong() and 0xffffffffL) + carry
      mag[i] = s.toInt()
      carry = s ushr 32
      i++
    }
    return this
  }

  fun mulPow10(n: Int): BigNat {
    var k = n
    while (k >= 9) { mulSmall(1_000_000_000); k -= 9 }
    while (k > 0) { mulSmall(10); k-- }
    return this
  }

  fun shl(bits: Int): BigNat {
    if (len == 0 || bits == 0) return this
    val words = bits ushr 5
    val b = bits and 31
    ensure(len + words + 1)
    val out = IntArray(len + words + 1)
    for (i in 0 until len) {
      val v = mag[i]
      out[i + words] = out[i + words] or (v shl b)
      if (b != 0) out[i + words + 1] = v ushr (32 - b)
    }
    mag = out
    len += words + 1
    trim()
    return this
  }

  fun shr(bits: Int): BigNat {
    val words = bits ushr 5
    val b = bits and 31
    if (words >= len) { len = 0; return this }
    val n = len - words
    for (i in 0 until n) {
      val lo = mag[i + words] ushr b
      val hi = if (b != 0 && i + words + 1 < len) mag[i + words + 1] shl (32 - b) else 0
      mag[i] = lo or hi
    }
    len = n
    trim()
    return this
  }

  fun add(o: BigNat): BigNat {
    val n = maxOf(len, o.len)
    ensure(n + 1)
    var carry = 0L
    for (i in 0 until n) {
      val a = if (i < len) mag[i].toLong() and 0xffffffffL else 0L
      val c = if (i < o.len) o.mag[i].toLong() and 0xffffffffL else 0L
      val s = a + c + carry
      mag[i] = s.toInt()
      carry = s ushr 32
    }
    len = n
    if (carry != 0L) mag[len++] = carry.toInt()
    return this
  }

  /** this -= o, with o <= this. */
  fun sub(o: BigNat): BigNat {
    var borrow = 0L
    for (i in 0 until len) {
      val a = mag[i].toLong() and 0xffffffffL
      val c = if (i < o.len) o.mag[i].toLong() and 0xffffffffL else 0L
      var d = a - c - borrow
      borrow = if (d < 0) { d += 1L shl 32; 1L } else 0L
      mag[i] = d.toInt()
    }
    trim()
    return this
  }

  fun compareTo(o: BigNat): Int {
    if (len != o.len) return if (len < o.len) -1 else 1
    for (i in len - 1 downTo 0) {
      val a = mag[i].toLong() and 0xffffffffL
      val c = o.mag[i].toLong() and 0xffffffffL
      if (a != c) return if (a < c) -1 else 1
    }
    return 0
  }

  /** compare(this + o, x) without allocating. */
  fun plusCompare(o: BigNat, x: BigNat): Int = copy().add(o).compareTo(x)

  /** this /= d (d < 2^31); returns the remainder. */
  fun divSmall(d: Int): Int {
    var rem = 0L
    for (i in len - 1 downTo 0) {
      val cur = (rem shl 32) or (mag[i].toLong() and 0xffffffffL)
      mag[i] = (cur / d).toInt()
      rem = cur % d
    }
    trim()
    return rem.toInt()
  }

  /** The low 32 bits. */
  fun low32(): Int = if (len == 0) 0 else mag[0]

  fun bitLength(): Int = if (len == 0) 0 else (len - 1) * 32 + (32 - mag[len - 1].countLeadingZeroBits())

  /** Bit i (0 = least significant). */
  fun testBit(i: Int): Boolean { val w = i ushr 5; return w < len && ((mag[w] ushr (i and 31)) and 1) != 0 }

  /** Whether any bit below i is set. */
  fun anyBelow(i: Int): Boolean {
    val w = i ushr 5
    for (k in 0 until minOf(w, len)) if (mag[k] != 0) return true
    return w < len && (mag[w] and ((1 shl (i and 31)) - 1)) != 0
  }

  /** The nearest double, ties to even. */
  fun toDouble(): Double {
    val bl = bitLength()
    if (bl == 0) return 0.0
    if (bl <= 63) {
      var v = 0L
      for (i in len - 1 downTo 0) v = (v shl 32) or (mag[i].toLong() and 0xffffffffL)
      if (bl <= 53) return v.toDouble()
    }
    if (bl > 1024) return Double.POSITIVE_INFINITY
    // The top 53 bits, then the rounding bit and the sticky bits below it.
    val shift = bl - 53
    var top = 0L
    for (i in 0 until 53) if (testBit(shift + i)) top = top or (1L shl i)
    val half = testBit(shift - 1)
    val sticky = anyBelow(shift - 1)
    if (half && (sticky || (top and 1L) == 1L)) top += 1
    var e = shift
    if (top == 1L shl 53) { top = top ushr 1; e++ }
    if (e + 52 > 1023) return Double.POSITIVE_INFINITY
    return Double.fromBits(((e + 52 + 1023).toLong() shl 52) or (top and 0x000fffffffffffffL))
  }

  /** Decimal digits. */
  override fun toString(): String {
    if (len == 0) return "0"
    val t = copy()
    val parts = ArrayList<Int>()
    while (!t.isZero) parts.add(t.divSmall(1_000_000_000))
    val sb = StringBuilder(parts.last().toString())
    for (i in parts.size - 2 downTo 0) sb.append(parts[i].toString().padStart(9, '0'))
    return sb.toString()
  }

  companion object {
    /** Digits in radix 2..36 (lower or upper case), or null if one is not. */
    fun parse(digits: String, radix: Int): BigNat? {
      val b = BigNat(0)
      for (c in digits) {
        val v = when (c) { in '0'..'9' -> c - '0'; in 'a'..'z' -> c - 'a' + 10; in 'A'..'Z' -> c - 'A' + 10; else -> return null }
        if (v >= radix) return null
        b.mulSmall(radix).addSmall(v)
      }
      return b
    }
  }
}

internal object JsNumber {
  /** The significand and binary exponent of a finite positive double:
   *  d = f * 2^e. */
  private fun decompose(d: Double): Pair<Long, Int> {
    val bits = d.toRawBits()
    val be = ((bits ushr 52) and 0x7ff).toInt()
    val frac = bits and 0x000fffffffffffffL
    return if (be == 0) frac to -1074 else (frac or (1L shl 52)) to (be - 1075)
  }

  /** The shortest round-trip digits and the decimal point position n for a
   *  finite d > 0: d is about 0.digits x 10^n. */
  fun shortest(d: Double): Pair<String, Int> {
    val (f, e) = decompose(d)
    val even = (f and 1L) == 0L
    // The value is r/s; the gap to the next double up is mPlus/s, down mMinus/s.
    // A significand of exactly 2^52 (and not the smallest exponent) has a
    // gap below half the gap above.
    val lowerCloser = f == (1L shl 52) && e > -1074
    val r: BigNat; val s: BigNat; val mPlus: BigNat; val mMinus: BigNat
    if (e >= 0) {
      if (!lowerCloser) {
        r = BigNat(f).shl(e + 1); s = BigNat(2); mPlus = BigNat(1).shl(e); mMinus = BigNat(1).shl(e)
      } else {
        r = BigNat(f).shl(e + 2); s = BigNat(4); mPlus = BigNat(1).shl(e + 1); mMinus = BigNat(1).shl(e)
      }
    } else {
      if (!lowerCloser) {
        r = BigNat(f).shl(1); s = BigNat(1).shl(1 - e); mPlus = BigNat(1); mMinus = BigNat(1)
      } else {
        r = BigNat(f).shl(2); s = BigNat(1).shl(2 - e); mPlus = BigNat(2); mMinus = BigNat(1)
      }
    }
    // k = ceil(log10(d)), estimated and then fixed up.
    var k = kotlin.math.ceil(kotlin.math.log10(d) - 1e-10).toInt()
    if (k >= 0) s.mulPow10(k) else { r.mulPow10(-k); mPlus.mulPow10(-k); mMinus.mulPow10(-k) }
    // Fix up: the digits start at 10^(k-1) <= (r + mPlus)/s < 10^k (or <= for even).
    while (true) {
      val c = r.plusCompare(mPlus, s)
      if (if (even) c >= 0 else c > 0) { s.mulSmall(10); k++ } else break
    }
    while (true) {
      // (r + mPlus) * 10 below s: one digit too many.
      val t = r.copy().add(mPlus).mulSmall(10)
      val c = t.compareTo(s)
      if (if (even) c < 0 else c <= 0) { r.mulSmall(10); mPlus.mulSmall(10); mMinus.mulSmall(10); k-- } else break
    }
    val sb = StringBuilder(17)
    while (true) {
      r.mulSmall(10); mPlus.mulSmall(10); mMinus.mulSmall(10)
      var digit = 0
      while (r.compareTo(s) >= 0) { r.sub(s); digit++ }
      val low = if (even) r.compareTo(mMinus) <= 0 else r.compareTo(mMinus) < 0
      val pc = r.plusCompare(mPlus, s)
      val high = if (even) pc >= 0 else pc > 0
      if (!low && !high) { sb.append(('0' + digit)); continue }
      if (low && !high) sb.append('0' + digit)
      else if (high && !low) sb.append('0' + digit + 1)
      else {
        // Both ends in reach: the nearer, the even digit on a tie.
        val c = r.copy().shl(1).compareTo(s)
        sb.append(if (c < 0 || (c == 0 && digit % 2 == 0)) '0' + digit else '0' + digit + 1)
      }
      break
    }
    return sb.toString() to k
  }

  /** The exact value of finite d rounded to `f` decimals, ties away from zero,
   *  as plain digits (no sign): Number#toFixed below 1e21. */
  fun fixed(d: Double, f: Int): String {
    val ad = kotlin.math.abs(d)
    if (ad == 0.0) return if (f == 0) "0" else "0." + "0".repeat(f)
    val (m, e) = decompose(ad)
    // n = round(m * 2^e * 10^f), half up.
    val n = BigNat(m).mulPow10(f)
    val q: BigNat
    if (e >= 0) q = n.shl(e)
    else {
      val sh = -e
      val half = n.testBit(sh - 1)
      q = n.shr(sh)
      if (half) q.addSmall(1)
    }
    val digits = q.toString()
    if (f == 0) return digits
    val padded = digits.padStart(f + 1, '0')
    return padded.substring(0, padded.length - f) + "." + padded.substring(padded.length - f)
  }

  private val POW10 = DoubleArray(23) { i -> var p = 1.0; repeat(i) { p *= 10.0 }; p } // exact to 1e22

  /**
   * A decimal literal (`[+-]digits[.digits][e[+-]digits]`, any of the parts
   * JSON or ToNumber allow) as the nearest double, ties to even: what V8's
   * strtod gives. The platform's parser makes the first guess; exact integer
   * arithmetic checks it against the two midpoints around it and steps until
   * it is the nearest, so a parser that misrounds (or one that does not
   * promise to round correctly) cannot change a value.
   */
  fun parseDecimal(s: String): Double {
    var i = 0
    var neg = false
    if (i < s.length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++ }
    val digits = StringBuilder()
    var exp10 = 0
    var seenDigit = false
    while (i < s.length && s[i] in '0'..'9') { if (digits.isNotEmpty() || s[i] != '0') digits.append(s[i]); seenDigit = true; i++ }
    if (i < s.length && s[i] == '.') {
      i++
      while (i < s.length && s[i] in '0'..'9') {
        if (digits.isNotEmpty() || s[i] != '0') digits.append(s[i])
        exp10--; seenDigit = true; i++
      }
    }
    if (!seenDigit) return Double.NaN
    if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
      i++
      var eneg = false
      if (i < s.length && (s[i] == '+' || s[i] == '-')) { eneg = s[i] == '-'; i++ }
      var e = 0L
      var any = false
      while (i < s.length && s[i] in '0'..'9') { if (e < 100_000) e = e * 10 + (s[i] - '0'); any = true; i++ }
      if (!any) return Double.NaN
      exp10 += (if (eneg) -e else e).toInt()
    }
    if (i != s.length) return Double.NaN
    val v = unsignedDecimal(digits.toString(), exp10)
    return if (neg) -v else v
  }

  /** digits (no leading zeros) x 10^exp10, nearest double. */
  private fun unsignedDecimal(digits: String, exp10: Int): Double {
    if (digits.isEmpty()) return 0.0
    // Past these the value is 0 or infinity whatever the digits.
    if (exp10 + digits.length > 310) return Double.POSITIVE_INFINITY
    if (exp10 + digits.length < -325) return 0.0
    // Clinger's fast path: both operands exact, one correctly rounded op.
    if (digits.length <= 15 && exp10 in -22..22) {
      val d = digits.toLong().toDouble()
      return if (exp10 >= 0) d * POW10[exp10] else d / POW10[-exp10]
    }
    var x = "${digits}e$exp10".toDouble()
    if (x.isInfinite()) x = Double.MAX_VALUE
    val big = BigNat.parse(digits, 10)!!
    repeat(4) {
      val bits = x.toRawBits()
      val be = ((bits ushr 52) and 0x7ff).toInt()
      val frac = bits and 0x000fffffffffffffL
      val m = if (be == 0) frac else frac or (1L shl 52)
      val e = if (be == 0) -1074 else be - 1075
      val odd = (m and 1L) == 1L
      // The midpoint up: (2m + 1) 2^(e-1).
      val up = compare(big, exp10, 2 * m + 1, e - 1)
      if (up > 0 || (up == 0 && odd)) {
        if (x == Double.MAX_VALUE) return Double.POSITIVE_INFINITY
        x = Double.fromBits(bits + 1); return@repeat
      }
      if (x == 0.0) return 0.0
      // The midpoint down: (4m - 1) 2^(e-2) at a power of two (the gap below
      // is half the gap above), else (2m - 1) 2^(e-1).
      val down = if (frac == 0L && be > 1) compare(big, exp10, 4 * m - 1, e - 2) else compare(big, exp10, 2 * m - 1, e - 1)
      if (down < 0 || (down == 0 && odd)) { x = Double.fromBits(bits - 1); return@repeat }
      return x
    }
    return x
  }

  /** sign(d x 10^e10 - m x 2^e2) for m >= 0. */
  private fun compare(d: BigNat, e10: Int, m: Long, e2: Int): Int {
    val l = d.copy()
    val r = BigNat(m)
    if (e10 >= 0) l.mulPow10(e10) else r.mulPow10(-e10)
    if (e2 >= 0) r.shl(e2) else l.shl(-e2)
    return l.compareTo(r)
  }

  /** ToInt32 of an integral double (any magnitude). */
  fun int32OfIntegral(t: Double): Int {
    if (kotlin.math.abs(t) < 9.2e18) return t.toLong().toInt()
    val (m, e) = decompose(kotlin.math.abs(t))
    // |t| = m * 2^e with e >= 10 here; the low 32 bits of m << e.
    val low = if (e >= 32) 0 else (m shl e).toInt()
    return if (t < 0) -low else low
  }
}
