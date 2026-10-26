package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/kit.mjs; keep in step.
//
// Decode a kit's ghost body (dice::ref2::world::KitNetworkable).
//
// The body is what KitNetworkable::setNetUpdate (lnxded 0x0822ba10) reads;
// getNetUpdate (0x0822b8e0) writes the same layout and updateStateMask
// (0x0822b710) sets the mask bits. A kit is the bag a soldier drops on death,
// so it moves only when it is a fresh drop: position is a full vector.
//
//   4-bit presence mask (readBits 4)
//   0x1  position        readFullVector              three float32 (absolute)
//   0x2  partIndex       readUnsigned(0, 0x100) - 1  ranged, 9 bits
//   0x4  active          readBool                    flag
//   0x8  weaponIndex     readUnsigned(0, 8) - 1      ranged, 4 bits
//
// An underflow propagates in strict mode; in lenient mode whatever decoded
// before a gap is kept and `consumed` says how far the read got.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.fullVec
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.ranged
import io.bfstats.sidecar.u

object Kit {
  val MASK = mapOf("pos" to 0x1, "partIndex" to 0x2, "active" to 0x4, "weaponIndex" to 0x8)

  fun decodeKitBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    val strict = JsOps.truthy(opts.g("strict"))
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to 0.0, "pos" to null, "partIndex" to null, "active" to null, "weaponIndex" to null, "consumed" to 0.0)
    val mask: Double
    try { mask = r.u(4) } catch (e: RuntimeException) { if (strict) throw e; return null }
    out["mask"] = mask
    val m = mask.toInt()
    try {
      if (m and 0x1 != 0) out["pos"] = r.fullVec()
      if (m and 0x2 != 0) out["partIndex"] = r.ranged(0, 0x100) - 1
      if (m and 0x4 != 0) out["active"] = r.readBool()
      if (m and 0x8 != 0) out["weaponIndex"] = r.ranged(0, 8) - 1
    } catch (e: RuntimeException) {
      if (strict) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
