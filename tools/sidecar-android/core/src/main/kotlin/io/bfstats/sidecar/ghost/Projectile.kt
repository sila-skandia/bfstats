package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/projectile.mjs; keep in step.
//
// Decode a ProjectileNetworkable ghost body (grenades, shells, rockets).
//
// ProjectileNetworkable::setNetUpdate (bf1942_lnxed.static 0x08232be0) is the
// reader; getNetUpdate (0x082329f0) is the writer. updateStateMask
// (0x08232630) sets the wire mask bits.
//
//   readBits(8) presence mask, then in this order:
//   0x02  readCompressedVector(0.01)   position      (readCompressedVector(float) 0x083dabe0)
//   0x01  readUnitQuaternion(12)       rotation      (0x083db4f0)
//   0x04  readBool                                     reset: Projectile+0x10d,
//         the round is out (set by detonate and resetProjectile 0x0831e720,
//         cleared by activate 0x0831e120)
//   0x08  readBool                                     detonate: the client
//         poses the round at this record and calls Projectile::detonate
//         0x0831e680 (0x08232f16 tests the mask bit, 0x08232f47 the bool)
//   0x10  readCompressedVector(0.01)   velocity
//   0x20  readUnsigned(4)              (Projectile +0x3c, a 4-bit field)
//   0x40  readUnsigned(8)              (+0x40)
//   0x80  readUnsigned(2)              (+0x44)

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.quat
import io.bfstats.sidecar.u
import io.bfstats.sidecar.vec

object Projectile {
  val MASK = mapOf("rot" to 0x1, "pos" to 0x2, "reset" to 0x4, "detonate" to 0x8, "vel" to 0x10, "u4" to 0x20, "u8" to 0x40, "u2" to 0x80)
  const val POS_SCALE = 0.01 // 0x3c23d70a
  const val QUAT_BITS = 12

  /** Returns { mask, pos, rot, reset, detonate, vel, u4, u8, u2, consumed }.
   *  A compressed vector takes `ref` (default origin). An underflow
   *  propagates when opts.strict. */
  fun decodeProjectileBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || (bodyBits != null && bodyBits < 8)) return null
    val r = hexReader(bodyHex, bodyBits)
    val ref = (if (JsOps.truthy(opts.g("ref"))) opts.g("ref").dl() else null) ?: listOf(0.0, 0.0, 0.0)
    val out = linkedMapOf<String, Any?>(
      "mask" to null, "pos" to null, "rot" to null, "reset" to null, "detonate" to null,
      "vel" to null, "u4" to null, "u8" to null, "u2" to null, "consumed" to 0.0,
    )
    try {
      val mask = r.u(8)
      out["mask"] = mask
      val m = mask.toInt()
      if (m and 0x02 != 0) out["pos"] = r.vec(ref, POS_SCALE)
      if (m and 0x01 != 0) out["rot"] = r.quat(QUAT_BITS)
      if (m and 0x04 != 0) out["reset"] = r.readBool()
      if (m and 0x08 != 0) out["detonate"] = r.readBool()
      if (m and 0x10 != 0) out["vel"] = r.vec(ref, POS_SCALE)
      if (m and 0x20 != 0) out["u4"] = r.u(4)
      if (m and 0x40 != 0) out["u8"] = r.u(8)
      if (m and 0x80 != 0) out["u2"] = r.u(2)
    } catch (e: RuntimeException) {
      if (JsOps.truthy(opts.g("strict"))) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
