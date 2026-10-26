package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/control-state.mjs; keep in step.
//
// The control-object state: the local player's own object, which the server
// never sends as an ordinary ghost record. A ghost block whose hasControl bit
// is set carries it ahead of the records.
//
// GhostManager::writeControlObjectState 0x081422b0 (writer) and
// readControlObjectState 0x081428a0 (reader):
//
//   u12   n            bit count of everything below (the writer back-fills it)
//   s32   controlId    GhostManager+0xe0, the server's input serial echo
//   bool  hit          the hit-indicator flag (XHIT-6), cleared once sent
//         resetCompressionVector, then
//   cvec  rootPos      readCompressedVector(scale 1.0): the root parent's
//                      position, whole metres; the stream's compression
//                      reference is SET to it for the body below
//   u16   netId        the control object
//   bool  isDelta
//   u3    baseline     the baseline slot (0..7)
//   body  every networkable of the netId's descriptor, each written with
//         mask 0xffffffff and the 32-bit-quaternion flag
//         (NetworkManager::getNetUpdate 0x08431400 / getNetUpdateDelta
//         0x084317b0 pass `0xffffffff, 3, 1`). A full body (isDelta 0) reads
//         a position relative to the stream reference (rootPos) and stores
//         itself as baseline slot `baseline`; a delta reads each vector
//         relative to that slot's copy (BFSoldierNetworkable::getNetUpdate
//         0x082246e0, the BaseLineData branch).
//
// The writer fills the baseline from the object's exact state before it
// writes the full body, so a client's baseline differs from the server's by
// the full body's quantisation (1 mm at the 0.001 scale), which a delta then
// carries forward. That is the engine's own error, not ours.

import io.bfstats.sidecar.Math
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.JsOps.nullish
import io.bfstats.sidecar.SoldierGhost
import io.bfstats.sidecar.Undefined
import io.bfstats.sidecar.asList
import io.bfstats.sidecar.asObj
import io.bfstats.sidecar.fromHex
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hex
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u
import io.bfstats.sidecar.vec

object ControlState {
  const val BASELINE_SLOTS = 8

  /** classOf(netId), templateOf(netId), seatOf(netId) -> { root, seat, tmpl },
   *  baselines, animStates: the decoder's view of the session. */
  class Ctx(
    val classOf: ((Double) -> String?)? = null,
    val templateOf: ((Double) -> Any?)? = null,
    val seatOf: ((Double) -> Map<String, Any?>?)? = null,
    val baselines: ControlBaselines? = null,
    val animStates: Any? = Undefined,
  )

  /** Decode a control-object state from its n field bits (hex of exactly the
   *  bits after the 12-bit length). Returns { controlId, hit, rootPos, netId,
   *  isDelta, slot, cls, body, consumed, ok } (+ reason, physics, seat). */
  fun decodeControlState(hex: String, nBits: Double, ctx: Ctx = Ctx()): MutableMap<String, Any?> {
    val r = hexReader(hex, nBits)
    val out = linkedMapOf<String, Any?>("controlId" to null, "hit" to null, "rootPos" to null, "netId" to null, "isDelta" to null,
      "slot" to null, "cls" to null, "body" to null, "consumed" to 0.0, "ok" to false)
    out["controlId"] = r.sgn(32)
    out["hit"] = r.readBool()
    // Everything after the bool is the object's own state, which a reader can
    // fail on. The serial and the hit bool must survive that: the bool is the
    // server's only word that this player's round hit (XHIT-6) and it is sent
    // once.
    return try {
      decodeControlBody(r, hex, nBits, ctx, out)
    } catch (e: RuntimeException) {
      out["ok"] = false
      out["reason"] = e.message ?: e.toString()
      out
    }
  }

  private val ZERO = listOf(0.0, 0.0, 0.0)

  private fun decodeControlBody(r: io.bfstats.sidecar.BitReader, hex: String, nBits: Double, ctx: Ctx, out: MutableMap<String, Any?>): MutableMap<String, Any?> {
    out["rootPos"] = r.vec(ZERO, 1.0)
    val netId = r.u(16)
    out["netId"] = netId
    val isDelta = r.readBool()
    out["isDelta"] = isDelta
    val slot = r.u(3)
    out["slot"] = slot
    val headBits = r.pos
    val bodyBits = nBits - headBits
    val bodyHex = bitsToHex(fromHex(hex), headBits, bodyBits.toInt())
    val cls = ctx.classOf?.invoke(netId)
    out["cls"] = cls
    val baselines = ctx.baselines
    val base = if (isDelta) baselines?.get(netId, slot) else null
    // A seat's children (its gun's bundles and FireArms) carry no vector read
    // against a baseline, so a seat's delta reads without one.
    if (isDelta && base == null && cls != "Seat") { out["reason"] = "no-baseline"; return out }
    when (cls) {
      "BFSoldierNetworkable" -> {
        // The soldier template's hit points and aim limits (children).
        val s = Children.soldierFor(ctx.templateOf?.invoke(netId))
        val o = linkedMapOf<String, Any?>("strict" to true, "quatBits" to 32.0, "animStates" to ctx.animStates)
        if (s != null) o["maxHp"] = s["maxHp"]
        if (s != null && !nullish(s.g("aimTwist"))) o["aimTwistLimit"] = s["aimTwist"]
        if (s != null && !nullish(s.g("aimPitch"))) o["aimPitchLimit"] = s["aimPitch"]
        if (isDelta) o["baseline"] = base else o["baselinePos"] = out["rootPos"]
        val b = SoldierGhost.decodeSoldierBody(bodyHex, bodyBits, o)
        out["body"] = b
        out["consumed"] = headBits + (JsOps.num(b?.get("consumed")) ?: 0.0)
        out["ok"] = b != null && JsOps.num(b["consumed"]) == bodyBits
        if (out["ok"] == true && !isDelta && baselines != null) {
          baselines.set(netId, slot, linkedMapOf("pos" to b!!["pos"], "vel" to orZero(b["vel"]), "vecA" to orZero(b["vecA"]), "vecB" to orZero(b["vecB"])))
        }
      }
      "SimpleObjectNetworkable" -> {
        // A vehicle driven by this player: the hull and its child
        // networkables, each SimpleObject one against its own baseline entry.
        // Whether a SimpleObject wrote its controller vectors depends on its
        // physics state, so each combination is tried, hull moving first, and
        // the one that reads to the last bit is kept.
        val template = ctx.templateOf?.invoke(netId)
        val nObjects = 1 + (if (JsOps.truthy(template)) countObjects(template) else 0)
        val bases = if (isDelta) base.g("objects") else null
        val tries = ArrayList<List<Boolean>>()
        for (m in 0 until (1 shl minOf(nObjects, 4))) {
          tries.add(List(nObjects) { i -> if (i == 0) (m and 1) == 0 else (m and (1 shl i)) != 0 })
        }
        for (physics in tries) {
          try {
            val o = LinkedHashMap<String, Any?>()
            if (JsOps.truthy(template)) o["template"] = template
            o["quatBits"] = 32.0
            o["strict"] = true
            val h = Children.hullFor(template)
            if (h != null) o["maxHp"] = h["maxHp"]
            o["control"] = linkedMapOf("ref" to out["rootPos"], "bases" to bases, "physics" to physics)
            val b = Pco.decodePcoBody(bodyHex, bodyBits, o)
            if (JsOps.num(b["consumed"]) != bodyBits) continue
            out["body"] = b
            out["consumed"] = headBits + JsOps.num(b["consumed"])!!
            out["ok"] = true
            out["physics"] = physics.toMutableList<Any?>()
            break
          } catch (e: RuntimeException) { /* the next combination */ }
        }
        if (out["ok"] != true) out["reason"] = "no exact read"
        else if (!isDelta && baselines != null) {
          val objs = (out["body"].g("objects").asList() ?: emptyList<Any?>()).mapTo(ArrayList<Any?>()) { ob ->
            linkedMapOf("pos" to ob.g("pos").let { if (it === Undefined) null else it }, "vecA" to orZero(ob.g("vecA")), "vecB" to orZero(ob.g("vecB")))
          }
          baselines.set(netId, slot, linkedMapOf("objects" to objs))
        }
      }
      "Seat" -> {
        // A gunner's control object is his seat, a nested PlayerControlObject:
        // its descriptor is the seat's child tail alone, as its ghost record is.
        val seat = ctx.seatOf?.invoke(netId)
        val spec = if (seat != null) Children.seatSpecFor(seat["tmpl"], seat["seat"]) else null
        // Which hull the seat is in does not depend on reading its body: a
        // passenger's seat has no gun and so no spec (live, El Alamein, 2026-10-17).
        if (seat != null) out["seat"] = linkedMapOf("root" to seat["root"], "seat" to seat["seat"])
        if (spec == null) out["reason"] = "no seat spec"
        else {
          try {
            val b = Pco.decodeSeatBody(bodyHex, bodyBits, spec, linkedMapOf("strict" to true))
            out["body"] = b
            out["seat"] = linkedMapOf("root" to seat!!["root"], "seat" to seat["seat"])
            out["consumed"] = headBits + JsOps.num(b["consumed"])!!
            out["ok"] = JsOps.num(b["consumed"]) == bodyBits
            if (out["ok"] != true) out["reason"] = "no exact read"
          } catch (e: RuntimeException) { out["reason"] = e.message }
        }
      }
      "FreeCameraNetworkable" -> {
        // The spawn screen's camera: what the player looks at before spawning.
        try {
          val bp = base.g("pos").let { if (JsOps.truthy(it)) it else out["rootPos"] }
          val b = FreeCamera.decodeFreeCameraBody(bodyHex, bodyBits, linkedMapOf("strict" to true, "baselinePos" to bp))!!
          out["body"] = b
          out["consumed"] = headBits + JsOps.num(b["consumed"])!!
          out["ok"] = JsOps.num(b["consumed"]) == bodyBits
          if (out["ok"] == true && !isDelta && baselines != null && JsOps.truthy(b["pos"])) baselines.set(netId, slot, linkedMapOf("pos" to b["pos"]))
        } catch (e: RuntimeException) { out["reason"] = e.message }
      }
      else -> out["reason"] = "no reader for ${JsOps.str(cls)}"
    }
    return out
  }

  private fun orZero(v: Any?): Any? = if (JsOps.truthy(v)) v else mutableListOf<Any?>(0.0, 0.0, 0.0)

  fun bitsToHex(buf: ByteArray, start: Int, n: Int): String {
    val o = ByteArray(if (n <= 0) 0 else (n + 7) / 8)
    for (i in 0 until n) {
      val s = start + i
      val byte = if ((s shr 3) < buf.size) buf[s shr 3].toInt() else 0
      if (byte and (1 shl (s and 7)) != 0) o[i shr 3] = (o[i shr 3].toInt() or (1 shl (i and 7))).toByte()
    }
    return o.hex()
  }

  // How many 'O' (SimpleObject) children a template's descriptor carries.
  private fun countObjects(template: Any?): Int = try {
    (Children.childrenFor(template)?.get("children").asList() ?: emptyList<Any?>()).count { it == "O" }
  } catch (e: RuntimeException) { 0 }
}

/** Per-session baseline store: netId -> [slot] -> { pos, vel, vecA, vecB }. */
class ControlBaselines {
  val byNet = HashMap<Any?, Array<Any?>>()
  fun get(netId: Double, slot: Double): Any? {
    val a = byNet[JsOps.key(netId)] ?: return null
    val v = if (slot >= 0 && slot < a.size && slot == Math.floor(slot)) a[slot.toInt()] else null
    return if (JsOps.nullish(v)) null else v
  }
  fun set(netId: Double, slot: Double, b: Any?) {
    val a = byNet.getOrPut(JsOps.key(netId)) { arrayOfNulls(ControlState.BASELINE_SLOTS) }
    a[slot.toInt()] = b
  }
  fun clear() = byNet.clear()
}
