package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/objective.mjs; keep in step.
//
// Decode an objective's ghost body.
//
// The body is what dice::ref2::world::ObjectiveNetworkable::setNetUpdate
// (lnxded 0x08231b20) reads and getNetUpdate (0x08231a60) writes.
//
//   0x1     position  readFullVector()          member: ring entry +8  (3 x float32)
//   0x2     value     readSignedFloat(5, 1.0)   member: ring entry +4  (float, [-1, 1])
//
// NOTE: no corpus has ObjectiveNetworkable objects, so this decoder is
// implemented from the binary only and is NOT verified against a capture.

import io.bfstats.sidecar.fullVec
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.u

object Objective {
  val MASK = mapOf("pos" to 0x1, "value" to 0x2)
  const val MASK_BITS = 2
  const val VALUE_BITS = 5 // readSignedFloat(5, 1.0f) -> [-1, 1]

  /** Returns { mask, pos, value, consumed }. Underflow propagates. */
  fun decodeObjectiveBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?> {
    val r = hexReader(bodyHex, bodyBits)
    val mask = r.u(MASK_BITS)
    val m = mask.toInt()
    val out = linkedMapOf<String, Any?>("mask" to mask, "pos" to null, "value" to null, "consumed" to 0.0)
    if (m and 0x1 != 0) out["pos"] = r.fullVec()
    if (m and 0x2 != 0) out["value"] = r.readSignedFloat(VALUE_BITS)
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
