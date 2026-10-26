package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/free-camera.mjs; keep in step.
//
// Decode the free camera's ghost body (dice::ref2::world::FreeCameraNetworkable).
//
// The body is what FreeCameraNetworkable::setNetUpdate (lnxded 0x08229ba0)
// reads; getNetUpdate (0x08229a70) writes the same layout and updateStateMask
// (0x08229800) sets the mask bits.
//
//   4-bit presence mask (readBits 4)
//   0x2  position   readCompressedVector(0.001)  mode 0 -> three float32
//   0x1  rotation   readUnitQuaternion(32)       sign + 3 x signedFloat32
//   0x4  fov        readSigned(8)                camera field-of-view / zoom
//   0x8  enable     readBool                     FreeCamera::m_enableFreeCamera
//
// Position (0x2) is read BEFORE rotation (0x1), and the quaternion is full
// 32-bit precision.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.quat
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u
import io.bfstats.sidecar.vec

object FreeCamera {
  val MASK = mapOf("pos" to 0x2, "rot" to 0x1, "fov" to 0x4, "enable" to 0x8)
  private const val POS_SCALE = 1e-3 // 0x3a03126f
  private const val QUAT_BITS = 32

  fun decodeFreeCameraBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    val strict = JsOps.truthy(opts.g("strict"))
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to 0.0, "pos" to null, "rot" to null, "fov" to null, "enable" to null, "consumed" to 0.0)
    val mask: Double
    try { mask = r.u(4) } catch (e: RuntimeException) { if (strict) throw e; return null }
    out["mask"] = mask
    val m = mask.toInt()
    try {
      val base = (if (JsOps.truthy(opts.g("baselinePos"))) opts.g("baselinePos").dl() else null) ?: listOf(0.0, 0.0, 0.0)
      if (m and 0x2 != 0) out["pos"] = r.vec(base, POS_SCALE)
      if (m and 0x1 != 0) out["rot"] = r.quat(QUAT_BITS)
      if (m and 0x4 != 0) out["fov"] = r.sgn(8)
      if (m and 0x8 != 0) out["enable"] = r.readBool()
    } catch (e: RuntimeException) {
      if (strict) throw e
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
