package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/item.mjs; keep in step.
//
// Decode an item's ghost body (dice::ref2::world::ItemNetworkable).
//
// The body is what ItemNetworkable::setNetUpdate (lnxded 0x0822ad90) reads;
// getNetUpdate (0x0822ac30) writes the same layout and updateStateMask
// (0x0822aa30) sets the mask bits.
//
//   5-bit presence mask (readUnsigned 5)
//   0x1  position    readFullVector    three float32 (absolute)
//   0x2  value2      readBits 32       opaque 32-bit field (+0x20)
//   0x4  value4      readBits 32       opaque 32-bit field (+0x24)
//   0x8  active      readBool          flag (+0x28)
//   0x10 value10     readBits 32       opaque 32-bit field (+0x2c)

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.fullVec
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.u

object Item {
  val MASK = mapOf("pos" to 0x1, "value2" to 0x2, "value4" to 0x4, "active" to 0x8, "value10" to 0x10)

  fun decodeItemBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    val strict = JsOps.truthy(opts.g("strict"))
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to 0.0, "pos" to null, "value2" to null, "value4" to null, "active" to null, "value10" to null, "consumed" to 0.0)
    val mask: Double
    try { mask = r.u(5) } catch (e: RuntimeException) { if (strict) throw e; return null }
    out["mask"] = mask
    val m = mask.toInt()
    try {
      if (m and 0x1 != 0) out["pos"] = r.fullVec()
      if (m and 0x2 != 0) out["value2"] = r.u(32)
      if (m and 0x4 != 0) out["value4"] = r.u(32)
      if (m and 0x8 != 0) out["active"] = r.readBool()
      if (m and 0x10 != 0) out["value10"] = r.u(32)
    } catch (e: RuntimeException) {
      if (strict) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
