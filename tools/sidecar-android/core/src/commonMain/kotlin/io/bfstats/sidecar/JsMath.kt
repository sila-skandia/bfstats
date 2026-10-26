package io.bfstats.sidecar

// JavaScript's Math, as the ported modules call it, computing what V8 computes
// to the bit on every target. Pure Kotlin: java.lang.Math, StrictMath and the
// native libm all differ somewhere.
//
//   sin, cos   fdlibm 5.3 (s_sin.c, s_cos.c, k_sin.c, k_cos.c, e_rem_pio2.c,
//              k_rem_pio2.c), which V8 runs (src/base/ieee754.cc) and which
//              StrictMath is: 300,000 arguments from -1e300 to 1e300 agreed
//              with Node to the bit.
//   pow, **    correctly rounded, through double-double arithmetic. V8 hands
//              ** and Math.pow to the C library's pow, so Node's answer is
//              the OS's: glibc's on Linux (300,000 arguments agreed with
//              Python's math.pow to the bit), which is within 0.52 ulp and
//              misses the nearest double on a near tie, about 1 argument in
//              800 (the fixture's powLibm; each checked against 80-digit
//              arithmetic: the port had the nearest). Every exact power
//              agrees, the sidecar's only use among them (0.5 ** a whole
//              number of ticks, ghost-writer.mjs). fdlibm's e_pow, which
//              StrictMath.pow is, disagreed with V8 on 1 argument in 10.
//   max, min   NaN wins, +0 above -0.
//   round      Java's Math.round (floor(x + 1/2) without the rounding of the
//              addition), what JsOps.round builds Math.round on.
//
// The parity fixture js-ops.json.gz holds V8's answers for each of these.

import kotlin.math.floor as kfloor

object Math {
  const val PI = kotlin.math.PI

  fun abs(x: Double): Double = kotlin.math.abs(x)
  fun abs(x: Int): Int = kotlin.math.abs(x)
  fun abs(x: Long): Long = kotlin.math.abs(x)
  fun floor(x: Double): Double = kfloor(x)
  fun ceil(x: Double): Double = kotlin.math.ceil(x)
  /** Round half to even (Java's Math.rint). */
  fun rint(x: Double): Double = kotlin.math.round(x)
  /** IEEE 754 square root: exact on every platform. */
  fun sqrt(x: Double): Double = kotlin.math.sqrt(x)
  fun random(): Double = kotlin.random.Random.nextDouble()

  fun max(a: Int, b: Int): Int = if (a >= b) a else b
  fun min(a: Int, b: Int): Int = if (a <= b) a else b
  fun max(a: Long, b: Long): Long = if (a >= b) a else b
  fun min(a: Long, b: Long): Long = if (a <= b) a else b
  fun max(a: Double, b: Double): Double = when {
    a.isNaN() || b.isNaN() -> Double.NaN
    a == 0.0 && b == 0.0 -> if (a.toRawBits() == 0L) a else b
    a > b -> a
    else -> b
  }
  fun min(a: Double, b: Double): Double = when {
    a.isNaN() || b.isNaN() -> Double.NaN
    a == 0.0 && b == 0.0 -> if (a.toRawBits() != 0L) a else b
    a < b -> a
    else -> b
  }

  /** java.lang.Math.round(double): the closest Long, ties toward +infinity. */
  fun round(x: Double): Long {
    if (x.isNaN()) return 0
    if (kotlin.math.abs(x) >= 4503599627370496.0) return x.toLong() // already whole
    val f = kfloor(x)
    return (if (x - f >= 0.5) f + 1 else f).toLong()
  }

  fun sin(x: Double): Double = Fdlibm.sin(x)
  fun cos(x: Double): Double = Fdlibm.cos(x)
  fun pow(x: Double, y: Double): Double = CrPow.pow(x, y)
}

// ---- fdlibm 5.3 sin and cos ---------------------------------------------------------

internal object Fdlibm {
  private fun hi(x: Double): Int = (x.toRawBits() ushr 32).toInt()
  private fun lo(x: Double): Int = x.toRawBits().toInt()
  private fun words(hi: Int, lo: Int): Double = Double.fromBits((hi.toLong() shl 32) or (lo.toLong() and 0xffffffffL))
  private fun d(bits: Long) = Double.fromBits(bits)

  /** x * 2^n, exactly (no overflow or underflow in the uses here). */
  private fun scalbn(x: Double, n: Int): Double {
    var r = x
    var k = n
    while (k > 1000) { r *= d(0x7e70000000000000); k -= 1000 } // 2^1000
    while (k < -1000) { r *= d(0x0170000000000000); k += 1000 } // 2^-1000
    return r * d((k + 1023).toLong() shl 52)
  }

  private val S1 = d(0xBFC5555555555549uL.toLong())
  private val S2 = d(0x3F8111111110F8A6)
  private val S3 = d(0xBF2A01A019C161D5uL.toLong())
  private val S4 = d(0x3EC71DE357B1FE7D)
  private val S5 = d(0xBE5AE5E68A2B9CEBuL.toLong())
  private val S6 = d(0x3DE5D93A5ACFD57C)

  private val C1 = d(0x3FA555555555554C)
  private val C2 = d(0xBF56C16C16C15177uL.toLong())
  private val C3 = d(0x3EFA01A019CB1590)
  private val C4 = d(0xBE927E4F809C52ADuL.toLong())
  private val C5 = d(0x3E21EE9EBDB4B1C4)
  private val C6 = d(0xBDA8FAE9BE8838D4uL.toLong())

  /** __kernel_sin(x, y, iy): sin on [-pi/4, pi/4], y the tail of x. */
  private fun kernelSin(x: Double, y: Double, iy: Int): Double {
    val ix = hi(x) and 0x7fffffff
    if (ix < 0x3e400000) { if (x.toInt() == 0) return x } // |x| < 2^-27
    val z = x * x
    val v = z * x
    val r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
    return if (iy == 0) x + v * (S1 + z * r) else x - ((z * (0.5 * y - v * r) - y) - v * S1)
  }

  /** __kernel_cos(x, y): cos on [-pi/4, pi/4]. */
  private fun kernelCos(x: Double, y: Double): Double {
    val ix = hi(x) and 0x7fffffff
    if (ix < 0x3e400000) { if (x.toInt() == 0) return 1.0 } // |x| < 2^-27
    val z = x * x
    val r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
    if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y)) // |x| < 0.3
    val qx = if (ix > 0x3fe90000) 0.28125 else words(ix - 0x00200000, 0) // x/4
    val hz = 0.5 * z - qx
    val a = 1.0 - qx
    return a - (hz - (z * r - x * y))
  }

  private val TWO_OVER_PI = intArrayOf(
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
    0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
    0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
    0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
    0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
    0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
    0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
    0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
  )

  private val NPIO2_HW = intArrayOf(
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
    0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
    0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
    0x404858EB, 0x404921FB,
  )

  private const val TWO24 = 16777216.0
  private const val TWON24 = 5.9604644775390625E-8
  private val INVPIO2 = d(0x3FE45F306DC9C883)
  private val PIO2_1 = d(0x3FF921FB54400000)
  private val PIO2_1T = d(0x3DD0B4611A626331)
  private val PIO2_2 = d(0x3DD0B4611A600000)
  private val PIO2_2T = d(0x3BA3198A2E037073)
  private val PIO2_3 = d(0x3BA3198A2E000000)
  private val PIO2_3T = d(0x397B839A252049C1)

  private val PIO2 = doubleArrayOf(
    d(0x3FF921FB40000000), d(0x3E74442D00000000), d(0x3CF8469880000000), d(0x3B78CC5160000000),
    d(0x39F01B8380000000), d(0x387A252040000000), d(0x36E3822280000000), d(0x3569F31D00000000),
  )

  /** __ieee754_rem_pio2: x - n*pi/2 as y[0] + y[1]; returns n. */
  private fun remPio2(x: Double, y: DoubleArray): Int {
    val hx = hi(x)
    val ix = hx and 0x7fffffff
    if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0.0; return 0 }
    if (ix < 0x4002d97c) { // |x| < 3pi/4: n = +-1
      if (hx > 0) {
        var z = x - PIO2_1
        if (ix != 0x3ff921fb) { y[0] = z - PIO2_1T; y[1] = (z - y[0]) - PIO2_1T }
        else { z -= PIO2_2; y[0] = z - PIO2_2T; y[1] = (z - y[0]) - PIO2_2T }
        return 1
      } else {
        var z = x + PIO2_1
        if (ix != 0x3ff921fb) { y[0] = z + PIO2_1T; y[1] = (z - y[0]) + PIO2_1T }
        else { z += PIO2_2; y[0] = z + PIO2_2T; y[1] = (z - y[0]) + PIO2_2T }
        return -1
      }
    }
    if (ix <= 0x413921fb) { // |x| <~ 2^19 (pi/2): medium
      var t = kotlin.math.abs(x)
      val n = (t * INVPIO2 + 0.5).toInt()
      val fn = n.toDouble()
      var r = t - fn * PIO2_1
      var w = fn * PIO2_1T
      if (n < 32 && ix != NPIO2_HW[n - 1]) {
        y[0] = r - w
      } else {
        val j = ix shr 20
        y[0] = r - w
        var i = j - ((hi(y[0]) shr 20) and 0x7ff)
        if (i > 16) { // a second iteration, good to 118 bits
          t = r
          w = fn * PIO2_2
          r = t - w
          w = fn * PIO2_2T - ((t - r) - w)
          y[0] = r - w
          i = j - ((hi(y[0]) shr 20) and 0x7ff)
          if (i > 49) { // a third, 151 bits
            t = r
            w = fn * PIO2_3
            r = t - w
            w = fn * PIO2_3T - ((t - r) - w)
            y[0] = r - w
          }
        }
      }
      y[1] = (r - y[0]) - w
      if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n }
      return n
    }
    if (ix >= 0x7ff00000) { y[0] = x - x; y[1] = y[0]; return 0 }
    // Large: z = scalbn(|x|, ilogb(x) - 23), cut into 24-bit pieces.
    val e0 = (ix shr 20) - 1046
    var z = words(ix - (e0 shl 20), lo(x))
    val tx = DoubleArray(3)
    for (i in 0 until 2) {
      tx[i] = z.toInt().toDouble()
      z = (z - tx[i]) * TWO24
    }
    tx[2] = z
    var nx = 3
    while (tx[nx - 1] == 0.0) nx--
    val n = kernelRemPio2(tx, y, e0, nx)
    if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n }
    return n
  }

  /** __kernel_rem_pio2 with prec 2 (53-bit result as two doubles). */
  private fun kernelRemPio2(x: DoubleArray, y: DoubleArray, e0: Int, nx: Int): Int {
    val jk = 4 // init_jk[2]
    val jp = jk
    val iq = IntArray(20)
    val f = DoubleArray(20)
    val fq = DoubleArray(20)
    val q = DoubleArray(20)

    val jx = nx - 1
    var jv = (e0 - 3) / 24
    if (jv < 0) jv = 0
    var q0 = e0 - 24 * (jv + 1)

    var j = jv - jx
    val m = jx + jk
    for (i in 0..m) { f[i] = if (j < 0) 0.0 else TWO_OVER_PI[j].toDouble(); j++ }

    for (i in 0..jk) {
      var fw = 0.0
      for (jj in 0..jx) fw += x[jj] * f[jx + i - jj]
      q[i] = fw
    }

    var jz = jk
    var z: Double
    var n: Int
    var ih: Int
    while (true) { // recompute
      // Distill q[] into iq[], reversed.
      var i = 0
      j = jz
      z = q[jz]
      while (j > 0) {
        val fw = (TWON24 * z).toInt().toDouble()
        iq[i] = (z - TWO24 * fw).toInt()
        z = q[j - 1] + fw
        i++; j--
      }
      z = scalbn(z, q0)
      z -= 8.0 * kfloor(z * 0.125)
      n = z.toInt()
      z -= n.toDouble()
      ih = 0
      if (q0 > 0) {
        val k = iq[jz - 1] shr (24 - q0)
        n += k
        iq[jz - 1] -= k shl (24 - q0)
        ih = iq[jz - 1] shr (23 - q0)
      } else if (q0 == 0) ih = iq[jz - 1] shr 23
      else if (z >= 0.5) ih = 2

      if (ih > 0) { // q > 0.5
        n += 1
        var carry = 0
        for (k in 0 until jz) {
          val v = iq[k]
          if (carry == 0) {
            if (v != 0) { carry = 1; iq[k] = 0x1000000 - v }
          } else iq[k] = 0xffffff - v
        }
        if (q0 > 0) {
          when (q0) {
            1 -> iq[jz - 1] = iq[jz - 1] and 0x7fffff
            2 -> iq[jz - 1] = iq[jz - 1] and 0x3fffff
          }
        }
        if (ih == 2) {
          z = 1.0 - z
          if (carry != 0) z -= scalbn(1.0, q0)
        }
      }

      if (z == 0.0) {
        var t = 0
        for (k in jz - 1 downTo jk) t = t or iq[k]
        if (t == 0) { // recomputation needed
          var k = 1
          while (iq[jk - k] == 0) k++
          for (ii in jz + 1..jz + k) {
            f[jx + ii] = TWO_OVER_PI[jv + ii].toDouble()
            var fw = 0.0
            for (jj in 0..jx) fw += x[jj] * f[jx + ii - jj]
            q[ii] = fw
          }
          jz += k
          continue
        }
      }
      break
    }

    // Chop off zero terms.
    if (z == 0.0) {
      jz -= 1; q0 -= 24
      while (iq[jz] == 0) { jz--; q0 -= 24 }
    } else {
      z = scalbn(z, -q0)
      if (z >= TWO24) {
        val fw = (TWON24 * z).toInt().toDouble()
        iq[jz] = (z - TWO24 * fw).toInt()
        jz += 1; q0 += 24
        iq[jz] = fw.toInt()
      } else iq[jz] = z.toInt()
    }

    var fw = scalbn(1.0, q0)
    for (i in jz downTo 0) { q[i] = fw * iq[i].toDouble(); fw *= TWON24 }

    for (i in jz downTo 0) {
      var s = 0.0
      var k = 0
      while (k <= jp && k <= jz - i) { s += PIO2[k] * q[i + k]; k++ }
      fq[jz - i] = s
    }

    var s = 0.0
    for (i in jz downTo 0) s += fq[i]
    y[0] = if (ih == 0) s else -s
    s = fq[0] - s
    for (i in 1..jz) s += fq[i]
    y[1] = if (ih == 0) s else -s
    return n and 7
  }

  fun sin(x: Double): Double {
    val ix = hi(x) and 0x7fffffff
    if (ix <= 0x3fe921fb) return kernelSin(x, 0.0, 0)
    if (ix >= 0x7ff00000) return x - x
    val y = DoubleArray(2)
    return when (remPio2(x, y) and 3) {
      0 -> kernelSin(y[0], y[1], 1)
      1 -> kernelCos(y[0], y[1])
      2 -> -kernelSin(y[0], y[1], 1)
      else -> -kernelCos(y[0], y[1])
    }
  }

  fun cos(x: Double): Double {
    val ix = hi(x) and 0x7fffffff
    if (ix <= 0x3fe921fb) return kernelCos(x, 0.0)
    if (ix >= 0x7ff00000) return x - x
    val y = DoubleArray(2)
    return when (remPio2(x, y) and 3) {
      0 -> kernelCos(y[0], y[1])
      1 -> -kernelSin(y[0], y[1], 1)
      2 -> -kernelCos(y[0], y[1])
      else -> kernelSin(y[0], y[1], 1)
    }
  }
}

// ---- pow, correctly rounded ----------------------------------------------------------

/**
 * x^y as Number::exponentiate (ECMA-262 6.1.6.1.3) specifies its special
 * cases, and otherwise the double nearest the exact value: exp(y ln x) in
 * double-double (about 106 bits), rounded once. The exact value is never
 * within 2^-90 or so of a rounding boundary unless it is a double (or a tie)
 * itself, so this rounds as a correctly rounded libm does.
 */
internal object CrPow {
  // ---- double-double ----
  private class DD(val hi: Double, val lo: Double)

  private fun twoSum(a: Double, b: Double): DD {
    val s = a + b
    val bb = s - a
    return DD(s, (a - (s - bb)) + (b - bb))
  }
  private fun quickTwoSum(a: Double, b: Double): DD { val s = a + b; return DD(s, b - (s - a)) }
  private const val SPLIT = 134217729.0 // 2^27 + 1
  private fun twoProd(a: Double, b: Double): DD {
    val p = a * b
    val ca = SPLIT * a; val ahi = ca - (ca - a); val alo = a - ahi
    val cb = SPLIT * b; val bhi = cb - (cb - b); val blo = b - bhi
    return DD(p, ((ahi * bhi - p) + ahi * blo + alo * bhi) + alo * blo)
  }
  private fun add(a: DD, b: DD): DD {
    val s = twoSum(a.hi, b.hi)
    val t = twoSum(a.lo, b.lo)
    var r = quickTwoSum(s.hi, s.lo + t.hi)
    r = quickTwoSum(r.hi, r.lo + t.lo)
    return r
  }
  private fun mul(a: DD, b: DD): DD {
    val p = twoProd(a.hi, b.hi)
    return quickTwoSum(p.hi, p.lo + (a.hi * b.lo + a.lo * b.hi))
  }
  private fun mul(a: DD, b: Double): DD {
    val p = twoProd(a.hi, b)
    return quickTwoSum(p.hi, p.lo + a.lo * b)
  }
  private fun div(a: DD, b: DD): DD {
    val q1 = a.hi / b.hi
    var r = add(a, neg(mul(b, q1)))
    val q2 = r.hi / b.hi
    r = add(r, neg(mul(b, q2)))
    val q3 = r.hi / b.hi
    return add(quickTwoSum(q1, q2), DD(q3, 0.0))
  }
  private fun neg(a: DD) = DD(-a.hi, -a.lo)

  private val LN2 = DD(Double.fromBits(0x3FE62E42FEFA39EF), Double.fromBits(0x3C7ABC9E3B39803F))

  /** ln(m) for m in [sqrt(1/2), sqrt(2)]: 2 atanh((m-1)/(m+1)). */
  private fun lnReduced(m: Double): DD {
    val s = div(DD(m - 1.0, 0.0), twoSum(m, 1.0))
    val s2 = mul(s, s)
    // atanh(s)/s = sum s^(2k) / (2k+1), Horner from k = 30 (s^2 < 0.03).
    var acc = DD(1.0 / 61.0, 0.0)
    for (k in 29 downTo 0) acc = add(mul(acc, s2), recip(2 * k + 1))
    return mul(mul(acc, s), 2.0)
  }

  private val RECIPS = Array(64) { i -> if (i == 0) DD(0.0, 0.0) else div(DD(1.0, 0.0), DD(i.toDouble(), 0.0)) }
  private fun recip(n: Int) = RECIPS[n]

  /** ln|x| for finite x > 0, as double-double. */
  private fun ln(x: Double): DD {
    var bits = x.toRawBits()
    var e = ((bits ushr 52) and 0x7ff).toInt()
    var adj = 0
    if (e == 0) { // subnormal: scale up by 2^64
      val y = x * Double.fromBits(0x43F0000000000000)
      bits = y.toRawBits(); e = ((bits ushr 52) and 0x7ff).toInt(); adj = -64
    }
    var m = Double.fromBits((bits and 0x000fffffffffffffL) or 0x3ff0000000000000L) // [1, 2)
    var k = e - 1023 + adj
    if (m > 1.4142135623730951) { m *= 0.5; k += 1 }
    return add(mul(LN2, k.toDouble()), lnReduced(m))
  }

  /** e^r for |r| <= 0.35, as double-double: Taylor to 2^-110. */
  private fun expReduced(r: DD): DD {
    var acc = DD(1.0, 0.0)
    for (n in 30 downTo 1) acc = add(mul(mul(acc, r), recip(n)), DD(1.0, 0.0))
    return acc
  }

  private fun isOddInt(y: Double): Boolean {
    if (kotlin.math.abs(y) >= 9007199254740992.0 || y != kotlin.math.floor(y)) return false
    return (y.toLong() and 1L) == 1L
  }

  fun pow(x: Double, y: Double): Double {
    if (y.isNaN()) return Double.NaN
    if (y == 0.0) return 1.0
    if (x.isNaN()) return Double.NaN
    val ax = kotlin.math.abs(x)
    if (y.isInfinite()) {
      return when {
        ax == 1.0 -> Double.NaN
        (ax > 1.0) == (y > 0) -> Double.POSITIVE_INFINITY
        else -> 0.0
      }
    }
    if (x.isInfinite()) {
      return if (x > 0) { if (y > 0) Double.POSITIVE_INFINITY else 0.0 }
      else if (y > 0) { if (isOddInt(y)) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY }
      else { if (isOddInt(y)) -0.0 else 0.0 }
    }
    if (x == 0.0) {
      val negZero = x.toRawBits() != 0L
      return if (y > 0) { if (negZero && isOddInt(y)) -0.0 else 0.0 }
      else { if (negZero && isOddInt(y)) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY }
    }
    var sign = 1.0
    if (x < 0) {
      if (y != kotlin.math.floor(y)) return Double.NaN
      if (isOddInt(y)) sign = -1.0
    }
    if (ax == 1.0) return sign
    if (y == 1.0) return x
    // |y ln x| is past 745 well before |y| reaches 2^64 (|ln x| >= 2^-53).
    if (kotlin.math.abs(y) > 1.8e19) return if ((ax > 1.0) == (y > 0)) sign * Double.POSITIVE_INFINITY else sign * 0.0
    val l = ln(ax)
    val p = add(twoProd(y, l.hi), DD(y * l.lo, 0.0))
    if (p.hi > 710.0) return sign * Double.POSITIVE_INFINITY
    if (p.hi < -746.0) return sign * 0.0
    // p = k ln2 + r, |r| <= ln2 / 2.
    val k = kotlin.math.round(p.hi / LN2.hi)
    val r = add(p, neg(mul(LN2, k)))
    val m = expReduced(r) // in [0.7, 1.42]
    return sign * scale(m, k.toInt())
  }

  /** m * 2^k rounded once to a double, subnormals included. */
  private fun scale(m: DD, k: Int): Double {
    if (k > 1023) return m.hi * pow2(1023) * pow2(k - 1023) // exact, or infinity
    if (k > -1022 || (k == -1022 && m.hi >= 1.0)) return m.hi * pow2(k) // normal: exact
    // Subnormal: round m * 2^(k + 1074) to an integer, ties to even, then
    // scale by 2^-1074 (exact).
    val sh = k + 1074
    if (sh < -2) return 0.0
    val th = m.hi * pow2(sh) // exact: a power of two in range
    val tl = m.lo * pow2(sh)
    val n0 = kotlin.math.floor(th)
    val frac = (th - n0) + tl
    val n = when {
      frac > 0.5 -> n0 + 1
      frac == 0.5 -> if (n0 % 2.0 == 0.0) n0 else n0 + 1
      frac > -0.5 -> n0
      frac == -0.5 -> if (n0 % 2.0 == 0.0) n0 else n0 - 1
      else -> n0 - 1
    }
    return n * Double.fromBits(1L) // n * 2^-1074
  }

  private fun pow2(e: Int): Double = Double.fromBits((e + 1023).toLong() shl 52)
}
