package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test

/** JsOps against V8 (parity/js-ops.mjs). */
class JsOpsTest {
  private val fx by lazy { DecoderFixtures.json("js-ops.json.gz").asObj()!! }
  private fun d(hex: Any?) = java.lang.Double.longBitsToDouble(java.lang.Long.parseUnsignedLong(hex as String, 16))
  private fun hex(v: Double) = java.lang.Long.toHexString(java.lang.Double.doubleToRawLongBits(v)).padStart(16, '0')

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

  @Test fun rangedBitsOverNumbers() {
    for (row in fx["ranged"] as List<*>) {
      val (a, b, want) = row as List<*>
      val bb = if (b == "NaN") Double.NaN else JsOps.num(b)!!
      assertEquals("rangedBits($a, $b)", JsOps.num(want)!!.toInt(), JsOps.rangedBits(JsOps.num(a)!!, bb))
    }
  }
}
