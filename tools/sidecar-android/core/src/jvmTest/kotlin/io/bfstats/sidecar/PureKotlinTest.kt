package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import java.math.BigDecimal
import java.nio.charset.Charset
import java.security.MessageDigest
import kotlin.random.Random
import kotlin.test.Test

/** The pure-Kotlin stand-ins for JVM classes (JsMath, JsNumber, Digest,
 *  Common.kt) checked against those classes over many more inputs than the
 *  V8 fixtures carry. The fixtures (JsOpsTest, JsTest) hold V8's answers and
 *  run on every target; this runs where the JVM's reference is. */
class PureKotlinTest {
  private val rnd = Random(0x5eed)

  private fun arg(i: Int): Double = when (i % 5) {
    0 -> (rnd.nextDouble() * 2 - 1) * 7
    1 -> (rnd.nextDouble() * 2 - 1) * 1e4
    2 -> (rnd.nextDouble() * 2 - 1) * Math.pow(10.0, rnd.nextDouble() * 308)
    3 -> (rnd.nextDouble() * 2 - 1) * Math.pow(10.0, rnd.nextDouble() * 40 - 20)
    else -> Double.fromBits(rnd.nextLong()) // any bit pattern
  }

  @Test fun fdlibmSinCosAreStrictMath() {
    var bad = 0
    val first = ArrayList<String>()
    repeat(1_000_000) { i ->
      val x = arg(i)
      val s = Fdlibm.sin(x); val c = Fdlibm.cos(x)
      if (s.toRawBits() != StrictMath.sin(x).toRawBits() && !(s.isNaN() && StrictMath.sin(x).isNaN())) { bad++; if (first.size < 5) first += "sin($x)" }
      if (c.toRawBits() != StrictMath.cos(x).toRawBits() && !(c.isNaN() && StrictMath.cos(x).isNaN())) { bad++; if (first.size < 5) first += "cos($x)" }
    }
    assertEquals(first.joinToString(), 0, bad)
  }

  /** pow against the exact value: never more than half an ulp off, so the
   *  nearest double (BigDecimal for integer exponents, where it is exact). */
  @Test fun powIsCorrectlyRoundedOnIntegerExponents() {
    var bad = 0
    val first = ArrayList<String>()
    repeat(20_000) {
      val x = (rnd.nextDouble() * 2 - 1) * 8
      val y = rnd.nextInt(-40, 41)
      if (x == 0.0) return@repeat
      val exact = if (y >= 0) BigDecimal(x).pow(y) else BigDecimal.ONE.divide(BigDecimal(x).pow(-y), java.math.MathContext(80))
      val want = exact.toDouble()
      val got = Math.pow(x, y.toDouble())
      if (got.toRawBits() != want.toRawBits()) { bad++; if (first.size < 5) first += "$x ** $y: want $want got $got" }
    }
    assertEquals(first.joinToString(), 0, bad)
  }

  @Test fun shortestDigitsRoundTripAndToFixedIsExact() {
    var bad = 0
    val first = ArrayList<String>()
    repeat(200_000) { i ->
      val d = arg(i).let { if (it.isNaN() || it.isInfinite()) 1.5 else it }
      val s = Js.numberToString(d)
      if (java.lang.Double.parseDouble(s).toRawBits() != d.toRawBits() && d != 0.0) { bad++; if (first.size < 5) first += "$d printed $s" }
      // BigDecimal's exact decimal, half up, is toFixed below 1e21.
      if (Math.abs(d) < 1e21) for (f in intArrayOf(0, 3, 7)) {
        val want = BigDecimal(d).setScale(f, java.math.RoundingMode.HALF_UP).toPlainString().let { if (d < 0 && !it.startsWith("-")) "-$it" else it }
        val got = JsOps.toFixedStr(d, f)
        if (got != want) { bad++; if (first.size < 5) first += "$d toFixed($f): want $want got $got" }
      }
    }
    assertEquals(first.joinToString(), 0, bad)
  }

  @Test fun decimalsParseAsTheJdk() {
    var bad = 0
    val first = ArrayList<String>()
    repeat(200_000) { i ->
      val d = Math.abs(arg(i)).let { if (it.isNaN() || it.isInfinite()) 2.5 else it }
      // The exact decimal, cut to a random length: every kind of near-tie.
      val exact = BigDecimal(d).toString()
      val s = if (exact.length > 3) exact.substring(0, 2 + rnd.nextInt(exact.length - 2)) else exact
      if (s.contains('E') && !s.substringAfter('E').any { it.isDigit() }) return@repeat
      val want = java.lang.Double.parseDouble(s)
      val got = JsNumber.parseDecimal(s)
      if (got.toRawBits() != want.toRawBits()) { bad++; if (first.size < 5) first += "$s: want $want got $got" }
    }
    assertEquals(first.joinToString(), 0, bad)
  }

  @Test fun digestsAreMessageDigest() {
    for (n in listOf(0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4097)) {
      val b = ByteArray(n) { rnd.nextInt().toByte() }
      assertEquals("md5 $n", MessageDigest.getInstance("MD5").digest(b).hex(), Digest.md5(b).hex())
      assertEquals("sha1 $n", MessageDigest.getInstance("SHA-1").digest(b).hex(), Digest.sha1(b).hex())
      assertEquals("sha256 $n", MessageDigest.getInstance("SHA-256").digest(b).hex(), Digest.sha256(b).hex())
    }
  }

  @Test fun windows1251IsTheJdkCharset() {
    val all = ByteArray(256) { it.toByte() }
    assertEquals(String(all, Charset.forName("windows-1251")), cp1251String(all))
  }

  @Test fun urlEncodeIsUrlEncoder() {
    for (s in listOf("bf1942", "battle of the bulge", "Désert*_.-~!", "ру", "a+b&c=d/e")) {
      assertEquals(s, java.net.URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20"), urlEncode(s))
    }
  }

  @Test fun isoStringIsInstant() {
    repeat(2000) {
      val ms = rnd.nextLong(-62_000_000_000_000L, 253_000_000_000_000L)
      assertEquals("$ms", java.time.Instant.ofEpochMilli(ms).toString().let { if (it.length == 20) it.dropLast(1) + ".000Z" else it }, isoString(ms))
    }
  }
}
