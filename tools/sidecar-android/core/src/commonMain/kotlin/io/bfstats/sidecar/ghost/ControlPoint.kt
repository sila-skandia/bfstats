package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/control-point.mjs; keep in step.
//
// Decode a control point's ghost body.
//
// The body is what dice::ref2::world::ControlPointNetworkable::setNetUpdate
// (lnxded 0x08226de0) reads and getNetUpdate (0x08226d20) writes; the field
// map is in features/udp-sidecar/decodes/control-point.md.
//
// Layout, in this order (mask is 2 bits, read first):
//   0x1     team   readSigned(4)    member: ring entry +0 (4-byte team)
//   0x2     flag   readBool()       member: ring entry +4 (1-byte bool)
//
// A full body (after the class's own mask) is 3 bits minimum (mask only) up to
// 7 bits (mask + team + flag); the corpus records are all 7 bits with mask 3.

import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u

object ControlPoint {
  val MASK = mapOf("team" to 0x1, "flag" to 0x2)
  const val MASK_BITS = 2
  const val TEAM_BITS = 4 // readSigned(4): 1 sign bit + 3 magnitude bits, range [-7, 7]

  /** Returns { mask, team, flag, consumed }; a field absent from the mask
   *  stays null. Underflow propagates (verify relies on it). */
  fun decodeControlPointBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?> {
    val r = hexReader(bodyHex, bodyBits)
    val mask = r.u(MASK_BITS)
    val m = mask.toInt()
    val out = linkedMapOf<String, Any?>("mask" to mask, "team" to null, "flag" to null, "consumed" to 0.0)
    if (m and 0x1 != 0) out["team"] = r.sgn(TEAM_BITS)
    if (m and 0x2 != 0) out["flag"] = r.readBool()
    out["consumed"] = r.pos.toDouble()
    return out
  }

  /** Back-compat alias: the team only. */
  fun decodeControlPointTeam(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): Any? =
    decodeControlPointBody(bodyHex, bodyBits, opts)["team"]
}
