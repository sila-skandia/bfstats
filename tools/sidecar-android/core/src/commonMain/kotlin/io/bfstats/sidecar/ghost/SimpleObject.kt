package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/simple-object.mjs; keep in step.
//
// Decode a simple object's ghost body (dice::ref2::world::SimpleObjectNetworkable).
//
// The body is what SimpleObjectNetworkable::setNetUpdate (lnxded 0x08236d00)
// reads; getNetUpdate (0x08236770) writes the same layout and updateStateMask
// (0x08235ee0) sets the mask bits.
//
//   readBits(11) mask
//   0x2   position   readCompressedVector(0.001)
//   0x1   rotation   readUnitQuaternion(16 | 32)
//   0x4   vector     readCompressedVector(nullVec, 0.001)
//   0x20  vector     readCompressedVector(nullVec, 0.0001)
//   0x8   vector     readCompressedVector(nullVec, 0.001)
//   0x40  vector     readCompressedVector(nullVec, 0.0001)
//   0x100 vector     readCompressedVector(nullVec, 0.0001)
//   0x200 vector     readCompressedVector(nullVec, 0.0001)
//   0x80  flag       readBool
//   0x10  hitPoints  readUnsigned(0, round(maxHp))   template Armor hp
//   0x400 subState   readUnsigned(2)                 object +0x102
//
// Quaternion width: setNetUpdate passes ((flag) - 1 & ~0xf) + 0x20 to
// readUnitQuaternion, i.e. 32 bits when its last bool argument is set and 16
// otherwise. opts.quatBits selects the width and defaults to 32.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.n
import io.bfstats.sidecar.quat
import io.bfstats.sidecar.rangedBits
import io.bfstats.sidecar.u
import io.bfstats.sidecar.vec

object SimpleObject {
  val MASK = mapOf(
    "rot" to 0x1, "pos" to 0x2, "vecA" to 0x4, "vecB" to 0x8, "hitPoints" to 0x10, "vecC" to 0x20,
    "vecD" to 0x40, "flag" to 0x80, "vecE" to 0x100, "vecF" to 0x200, "subState" to 0x400,
  )
  private const val S3 = 1e-3 // 0x3a83126f / 0x3a03126f
  private const val S4 = 1e-4 // 0x38d1b717
  private val ZERO = listOf(0.0, 0.0, 0.0)

  fun decodeSimpleObjectBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    val strict = JsOps.truthy(opts.g("strict"))
    val r = hexReader(bodyHex, bodyBits)
    val qb = opts.n("quatBits")
    val quatBits = if (qb != null && JsOps.truthy(qb)) qb.toInt() else if (opts.g("fullQuat") == false) 16 else 32
    val maxHp = opts.n("maxHp").let { if (it != null && JsOps.truthy(it)) it else 100.0 }
    val hpWidth = JsOps.rangedBits(0.0, JsOps.round(maxHp))
    val out = linkedMapOf<String, Any?>(
      "mask" to 0.0, "pos" to null, "rot" to null, "vecA" to null, "vecB" to null, "vecC" to null, "vecD" to null,
      "vecE" to null, "vecF" to null, "flag" to null, "hitPoints" to null, "subState" to null, "consumed" to 0.0,
    )
    val mask: Double
    try { mask = r.u(11) } catch (e: RuntimeException) { if (strict) throw e; return null }
    out["mask"] = mask
    val m = mask.toInt()
    try {
      val base = (if (JsOps.truthy(opts.g("baselinePos"))) opts.g("baselinePos").dl() else null) ?: ZERO
      if (m and 0x2 != 0) out["pos"] = r.vec(base, S3)
      if (m and 0x1 != 0) {
        val q = r.quat(quatBits)
        q[0] = -(q[0] as Double); q[1] = -(q[1] as Double); q[2] = -(q[2] as Double) // the conjugate, as pco
        out["rot"] = q
      }
      if (m and 0x4 != 0) out["vecA"] = r.vec(ZERO, S3)
      if (m and 0x20 != 0) out["vecC"] = r.vec(ZERO, S4)
      if (m and 0x8 != 0) out["vecB"] = r.vec(ZERO, S3)
      if (m and 0x40 != 0) out["vecD"] = r.vec(ZERO, S4)
      if (m and 0x100 != 0) out["vecE"] = r.vec(ZERO, S4)
      if (m and 0x200 != 0) out["vecF"] = r.vec(ZERO, S4)
      if (m and 0x80 != 0) out["flag"] = r.readBool()
      if (m and 0x10 != 0) out["hitPoints"] = r.u(hpWidth)
      if (m and 0x400 != 0) out["subState"] = r.u(2)
    } catch (e: RuntimeException) {
      if (strict) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
