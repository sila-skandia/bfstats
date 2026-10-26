package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/engine.mjs; keep in step.
//
// Decode an EngineNetworkable ghost body (vehicle engine state).
//
// EngineNetworkable::setNetUpdate (bf1942_lnxed.static 0x08227da0) is the
// reader; getNetUpdate (0x082279d0) is the writer. updateStateMask
// (0x08227620) sets the wire mask bits.
//
//   readBits(10) presence mask, then in this order:
//   0x001  readBool                                   (Engine +0x142, RUNNING)
//   0x002  readBool                                   (Engine +0xee -> +0x143, disabled)
//   0x004  readBool                                   (physEngine +0xb4)
//   0x008  readUnsigned(0, numberOfGears)             (physEngine +0xbc, gear)
//   0x010  readSignedFloat(16)                        (Engine +0x10c)
//   0x020  readSignedFloat(16)                        (Engine +0x104)
//   0x040  readSignedFloat(16)                        (Engine +0x118)
//   0x080  readSignedFloat(12)                        (physEngine +0xa0, REVS)
//   0x100  readSignedFloat(12)                        (physEngine +0xb0)
//   0x200  readSignedFloat(12)                        (physEngine +0xa4)
//   ALWAYS readUnsigned(32)                           a per-update counter
//
// Revs arrives at 80% of the server's value and retail keeps it that way: the
// writer is writeSignedFloat(revs, 12, 1.25) (0x083da220), which divides by
// max, while the reader readSignedFloat(int, float) (0x083da200) forwards to
// readSignedFloat(int) (0x083da280) and DROPS max, returning 2u-1 in [-1, 1].

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.n
import io.bfstats.sidecar.rangedBits
import io.bfstats.sidecar.u

object Engine {
  val MASK = mapOf(
    "running" to 0x1, "disabled" to 0x2, "flag2" to 0x4, "gears" to 0x8,
    "angleA" to 0x10, "angleB" to 0x20, "angleC" to 0x40,
    "revs" to 0x80, "f12B" to 0x100, "f12C" to 0x200,
  )
  const val DEFAULT_GEARS = 6
  const val SEQ_BITS = 32

  /** opts: { numGears }. Returns { mask, running, disabled, flags, gears,
   *  angleA, angleB, angleC, revs, f12B, f12C, seq, consumed }. */
  fun decodeEngineBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || (bodyBits != null && bodyBits < 10)) return null
    val gears = opts.n("numGears") ?: DEFAULT_GEARS.toDouble()
    val r = hexReader(bodyHex, bodyBits)
    val flags = mutableListOf<Any?>(null)
    val out = linkedMapOf<String, Any?>(
      "mask" to null, "running" to null, "disabled" to null, "flags" to flags, "gears" to null,
      "angleA" to null, "angleB" to null, "angleC" to null, "revs" to null, "f12B" to null, "f12C" to null,
      "seq" to null, "consumed" to 0.0,
    )
    try {
      val mask = r.u(10)
      out["mask"] = mask
      val m = mask.toInt()
      if (m and 0x1 != 0) out["running"] = r.readBool()
      if (m and 0x2 != 0) out["disabled"] = r.readBool()
      if (m and 0x4 != 0) flags[0] = r.readBool()
      if (m and 0x8 != 0) out["gears"] = r.u(JsOps.rangedBits(0.0, gears)) // a fractional count sized as JS sizes it
      if (m and 0x10 != 0) out["angleA"] = r.readSignedFloat(16)
      if (m and 0x20 != 0) out["angleB"] = r.readSignedFloat(16)
      if (m and 0x40 != 0) out["angleC"] = r.readSignedFloat(16)
      if (m and 0x80 != 0) out["revs"] = r.readSignedFloat(12)
      if (m and 0x100 != 0) out["f12B"] = r.readSignedFloat(12)
      if (m and 0x200 != 0) out["f12C"] = r.readSignedFloat(12)
      out["seq"] = r.u(SEQ_BITS)
    } catch (e: RuntimeException) {
      if (JsOps.truthy(opts.g("strict"))) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
