package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import io.bfstats.sidecar.Assert.assertTrue
import kotlin.test.Test

/** JsOps against V8 (parity/js-ops.mjs). */
class JsOpsTest {
  private val fx by lazy { Fixtures.json("js-ops.json.gz").asObj()!! }
  private fun d(hex: Any?) = Double.fromBits((hex as String).toULong(16).toLong())
  private fun hex(v: Double) = v.toRawBits().toULong().toString(16).padStart(16, '0')

  /** Node's mtimeMs from a stat's seconds and nanoseconds, and its Math.round. */
  @Test fun mtimeMsAsNode() {
    for (row in fx["mtimes"].asList()!!) {
      val r = row.asList()!!
      val ms = mtimeMsOf((r[0] as String).toLong(), (r[1] as String).toLong())
      assertEquals(r.toString(), r[2] as String, ms.toRawBits().toULong().toString(16).padStart(16, '0'))
      assertTrue(r.toString(), JsOps.toNumber(r[3]) == JsOps.round(ms))
    }
    // A file's exact mtime agrees with the whole-ms one.
    val f = FsFile(tempDir("mtime-"), "f")
    f.writeText("x")
    val exact = fileMtimeMsExact(f.path)
    if (exact != null) assertEquals(fileMtimeMs(f.path), Math.floor(exact).toLong())
  }

  @Test fun posixJoinAsNode() {
    for (row in fx["joins"].asList()!!) {
      val r = row.asList()!!
      val parts = r[0].asList()!!.map { it as String }
      assertEquals(parts.toString(), r[1] as String, NodeFs.join(*parts.toTypedArray()))
    }
  }

  @Test fun toFixedAndRound() {
    val bad = ArrayList<String>()
    for (row in fx["toFixed"] as List<*>) {
      val (h, fixed, round, negZero) = row as List<*>
      val v = d(h)
      listOf(0, 1, 2, 3, 4, 6).forEachIndexed { i, f ->
        val got = JsOps.toFixedStr(v, f)
        if (got != (fixed as List<*>)[i]) bad += "$v toFixed($f): want ${fixed[i]} got $got"
      }
      val r = JsOps.round(v)
      if (Js.numberToString(r) != round || ((r == 0.0 && 1 / r < 0) != negZero)) bad += "$v round: want $round got ${Js.numberToString(r)}"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  @Test fun hypotAsV8() {
    for (row in fx["hyp"] as List<*>) {
      val (args, want) = row as List<*>
      val a = (args as List<*>).map { d(it) }.toDoubleArray()
      assertEquals("hypot(${a.toList()})", want, hex(JsOps.hypot(*a)))
    }
  }

  @Test fun numberOfStrings() {
    for (row in fx["toNumber"] as List<*>) {
      val (s, want) = row as List<*>
      val v = JsOps.toNumber(s)
      assertEquals("Number($s)", want, if (v.isNaN()) "NaN" else hex(v))
    }
  }

  @Test fun jsonParse() {
    for (row in fx["parse"] as List<*>) { val (t, want) = row as List<*>; assertEquals(t as String, want, Js.stringify(JsOps.parse(t))) }
    for (row in fx["reject"] as List<*>) {
      val (t, rejects) = row as List<*>
      val threw = try { JsOps.parse(t as String); false } catch (e: IllegalArgumentException) { true }
      assertEquals("parse($t)", rejects, threw)
    }
  }

  /** The same double to the bit, any NaN counting as NaN: a NaN's sign and
   *  payload are the CPU's (x86 makes sin(Infinity) a negative NaN, ARM the
   *  positive default one), and nothing in JS or the sidecar can see them. */
  private fun sameBits(a: Double, b: Double) = if (a.isNaN() || b.isNaN()) a.isNaN() && b.isNaN() else hex(a) == hex(b)

  @Test fun sinAndCosAsV8() {
    val bad = ArrayList<String>()
    for (row in fx["trig"] as List<*>) {
      val (x, s, c) = (row as List<*>).map { d(it) }
      if (!sameBits(JsOps.sin(x), s)) bad += "sin($x): want $s got ${JsOps.sin(x)}"
      if (!sameBits(JsOps.cos(x), c)) bad += "cos($x): want $c got ${JsOps.cos(x)}"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  @Test fun powAsV8() {
    val bad = ArrayList<String>()
    for (row in fx["pow"] as List<*>) {
      val (x, y, want) = (row as List<*>).map { d(it) }
      val got = JsOps.pow(x, y)
      if (hex(got) != hex(want) && !(got.isNaN() && want.isNaN())) bad += "$x ** $y: want $want got $got"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  /** Arbitrary arguments, where V8 runs glibc's pow (within 0.52 ulp, not
   *  always the nearest double) and the port rounds correctly: never more than
   *  an ulp apart, and apart only on the rare near tie. */
  @Test fun powElsewhereWithinAnUlpOfV8() {
    var differ = 0
    val bad = ArrayList<String>()
    val rows = fx["powLibm"] as List<*>
    for (row in rows) {
      val (x, y, want) = (row as List<*>).map { d(it) }
      val got = JsOps.pow(x, y)
      if (got.toRawBits() == want.toRawBits() || (got.isNaN() && want.isNaN())) continue
      differ++
      if (kotlin.math.abs(got.toRawBits() - want.toRawBits()) > 1) bad += "$x ** $y: want $want got $got"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
    assertTrue("$differ of ${rows.size} differ by an ulp", differ * 200 < rows.size)
  }

  @Test fun decimalStringsAsV8() {
    val bad = ArrayList<String>()
    for (row in fx["decimals"] as List<*>) {
      val (s, want) = row as List<*>
      val got = JsOps.toNumber(s)
      if (hex(got) != want) bad += "Number($s): want $want got ${hex(got)}"
      // JSON.parse reads a number the same way.
      if (!(s as String).startsWith(".") && hex(JsOps.parse(s) as Double) != want) bad += "JSON.parse($s): want $want"
    }
    assertEquals(bad.take(20).joinToString("\n"), 0, bad.size)
  }

  @Test fun rangedBitsOverNumbers() {
    for (row in fx["ranged"] as List<*>) {
      val (a, b, want) = row as List<*>
      val bb = if (b == "NaN") Double.NaN else JsOps.num(b)!!
      assertEquals("rangedBits($a, $b)", JsOps.num(want)!!.toInt(), JsOps.rangedBits(JsOps.num(a)!!, bb))
    }
  }
}
