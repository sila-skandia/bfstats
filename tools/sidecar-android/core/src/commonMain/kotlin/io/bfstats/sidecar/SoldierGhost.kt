package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/soldier-ghost.mjs; keep in step.
//
// Decode a soldier's ghost body: transform, aim, animation states and flags.
//
// The body is what BFSoldierNetworkable::setNetUpdate (lnxded 0x08224e40) reads;
// the field map is P-4 (features/udp-sidecar/wire.md §13).
//
//   readBits(14) mask + readBool (a 15th flag bit), then in this order:
//   0x1     position   readCompressedVector(0.001)   mode 0 = three float32
//   0x4     rotation   readUnitQuaternion(16)        sign + 3 x signedFloat16
//   0x2     velocity   readCompressedVector(ref)     (consumed)
//   0x200   vector     readCompressedVector(ref)     (consumed)
//   0x400   vector     readCompressedVector(ref)     (consumed)
//   0x8     aim B      readSignedFloat(16) * limit   (+0x6c, torso twist)
//   0x10    aim A      readSignedFloat(16) * limit   (+0x68, aim pitch)
//   0x20    lower      readUnsigned(0, nStates-1)    animation state index
//   0x40    upper      readUnsigned(0, nStates-1)    animation state index
//   0x1000  bytes      readBits(16)                  soldier+0x58c/+0x58d
//   0x80    hp         readUnsigned(0, round(maxHp)) the Armor's max hit points
//   0x100   held       readBits(32)                  held item
//   0x800   stateBits  readUnsigned(15)              getStateBits (0x10 chute, 0x20 zoom)
//   0x2000  kitPart    readBool
//
// Rotation comes BEFORE velocity on the wire.
//
// The animation state width is rangedBits(0, count-1) of the engine's state
// table; vanilla's has 1395 states, so 11 bits.
//
// The hp width is rangedBits(0, round(getMaxHitPoints())): the Armor's MAXIMUM
// (Armor::getMaxHitPoints 0x08173f20, Armor+0x3c); a vanilla soldier's 30 is 5
// bits, NOT the 7 of an assumed 100.
//
// The aim limits are four floats on the soldier template (setTurnLeftRightAngle
// 20/14, setPointUpDownAngle 38/38 in CommonSoldierData.inc), taken as
// max(|x|, |y|) of each pair; BitStream::readSignedFloat(int, float)
// (0x083da200) is readSignedFloat(bits) * scale, so the decoded aim is in
// DEGREES, as bf42plus records and the replayer's `st` rows carry it.

import kotlin.concurrent.Volatile
import io.bfstats.sidecar.JsOps.truthy

object SoldierGhost {
  private const val POS_SCALE = 1e-3 // 0x3a83126f; only matters in a delta mode, soldiers send mode 0
  private const val VEL_SCALE = 1e-3 // 0x3a83126f
  private const val VEC_SCALE = 1e-4 // 0x38d1b717, the 0x200 / 0x400 vectors
  private const val QUAT_BITS = 16
  private const val AIM_BITS = 16
  /** The last resort only: the count comes from the engine's animation state table. */
  const val VANILLA_ANIM_STATES = 1395
  @Volatile private var warnedAnim = false
  /** A vanilla soldier's Armor max hit points (5 bits). */
  const val VANILLA_SOLDIER_HP = 30
  const val VANILLA_AIM_TWIST_DEG = 20
  const val VANILLA_AIM_PITCH_DEG = 38

  val MASK = mapOf(
    "pos" to 0x1, "vel" to 0x2, "rot" to 0x4, "aimB" to 0x8, "aimA" to 0x10, "lower" to 0x20, "upper" to 0x40,
    "hp" to 0x80, "held" to 0x100, "vecA" to 0x200, "vecB" to 0x400, "stateBits" to 0x800, "bytes" to 0x1000, "kitPart" to 0x2000,
  )

  private val ZERO = listOf(0.0, 0.0, 0.0)
  private fun refOf(v: Any?): List<Double>? = if (truthy(v)) v.dl() else null

  /** Decode a soldier body. opts: { baselinePos, animStates (count), maxHp,
   *  aimPitchLimit, aimTwistLimit, baseline, quatBits, strict }. Returns
   *  { mask, flag, pos, rot, vel, aimA, aimB, lower, upper, bytes, hp, held,
   *  stateBits, kitPart, consumed } (+ vecA / vecB when read), null for absent. */
  fun decodeSoldierBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?>? {
    if (bodyHex.isNullOrEmpty() || (bodyBits != null && bodyBits < 15)) return null
    val strict = truthy(opts.g("strict"))
    if (!truthy(opts.g("animStates")) && !warnedAnim) {
      warnedAnim = true
      JsOps.consoleError("[soldier-ghost] FALLBACK: no animation state table (none computed from the install, none recorded); sizing soldier state fields as vanilla's $VANILLA_ANIM_STATES states")
    }
    val nStates = opts.g("animStates").let { if (truthy(it)) JsOps.num(it)!! else VANILLA_ANIM_STATES.toDouble() }
    val stateBitsWidth = rangedBits(0, (nStates - 1).toLong())
    val hpWidth = rangedBits(0, JsOps.round(opts.n("maxHp") ?: VANILLA_SOLDIER_HP.toDouble()).toLong())
    val pitchLimit = opts.n("aimPitchLimit") ?: VANILLA_AIM_PITCH_DEG.toDouble()
    val twistLimit = opts.n("aimTwistLimit") ?: VANILLA_AIM_TWIST_DEG.toDouble()
    val r = hexReader(bodyHex, bodyBits)
    val mask: Double
    try { mask = r.u(14) } catch (e: RuntimeException) { if (strict) throw e; return null }
    val m = mask.toInt()
    val out = linkedMapOf<String, Any?>(
      "mask" to mask, "flag" to null, "pos" to null, "rot" to null, "vel" to null, "aimA" to null, "aimB" to null,
      "lower" to null, "upper" to null, "bytes" to null, "hp" to null, "held" to null, "stateBits" to null,
      "kitPart" to null, "consumed" to 0.0,
    )
    try {
      out["flag"] = r.readBool()
      // A delta against a baseline (the control-object state) reads each
      // vector relative to the baseline's copy of it (getNetUpdate
      // 0x082246e0, the BaseLineData branch).
      val base = opts.g("baseline").let { if (truthy(it)) it else null }
      if (m and 0x1 != 0) out["pos"] = r.vec(refOf(base.g("pos")) ?: refOf(opts.g("baselinePos")) ?: ZERO, POS_SCALE)
      if (m and 0x4 != 0) {
        val qb = opts.n("quatBits").let { if (it != null && truthy(it)) it.toInt() else QUAT_BITS }
        val q = r.quat(qb)
        // The conjugate, as for a hull (ghost/pco): a soldier's is pure yaw,
        // so only y moves, but any tilt follows the same law.
        q[0] = -(q[0] as Double); q[1] = -(q[1] as Double); q[2] = -(q[2] as Double)
        out["rot"] = q
      }
      if (m and 0x2 != 0) out["vel"] = r.vec(refOf(base.g("vel")) ?: ZERO, VEL_SCALE)
      if (m and 0x200 != 0) out["vecA"] = r.vec(refOf(base.g("vecA")) ?: ZERO, VEC_SCALE)
      if (m and 0x400 != 0) out["vecB"] = r.vec(refOf(base.g("vecB")) ?: ZERO, VEC_SCALE)
      if (m and 0x8 != 0) out["aimB"] = r.readSignedFloat(AIM_BITS) * twistLimit // torso twist, degrees
      if (m and 0x10 != 0) out["aimA"] = r.readSignedFloat(AIM_BITS) * pitchLimit // aim pitch, degrees
      if (m and 0x20 != 0) out["lower"] = r.u(stateBitsWidth)
      if (m and 0x40 != 0) out["upper"] = r.u(stateBitsWidth)
      if (m and 0x1000 != 0) out["bytes"] = r.u(16)
      if (m and 0x80 != 0) out["hp"] = r.u(hpWidth)
      if (m and 0x100 != 0) out["held"] = r.u(32)
      if (m and 0x800 != 0) out["stateBits"] = r.u(15)
      if (m and 0x2000 != 0) out["kitPart"] = r.readBool()
    } catch (e: RuntimeException) {
      // Ran past the body: keep whatever decoded before the gap. In strict mode
      // the underflow propagates, which is what verify needs to see.
      if (strict) throw e
    }
    out["consumed"] = r.pos.toDouble()
    val p = out["pos"]
    if (p is List<*> && !(JsOps.num(p[0])?.isFinite() ?: false)) out["pos"] = null
    return out
  }

  /** Transform only: { mask, pos, rot }. */
  fun decodeSoldierTransform(bodyHex: String?, bodyBits: Double?, baselinePos: Any?): MutableMap<String, Any?>? {
    val b = decodeSoldierBody(bodyHex, bodyBits, linkedMapOf("baselinePos" to baselinePos)) ?: return null
    return linkedMapOf("mask" to b["mask"], "pos" to b["pos"], "rot" to b["rot"])
  }

  /** Back-compat: position only. */
  fun decodeSoldierPosition(bodyHex: String?, bodyBits: Double?, baseline: Any?): Any? =
    decodeSoldierTransform(bodyHex, bodyBits, baseline)?.get("pos")

  /** Forget the once-only warning (tests; a fresh Node process). */
  fun reset() { warnedAnim = false }
}

/** The body fields the replayer's `st` record carries, with the last known
 *  values carried forward per soldier: `[nid, lower, upper, pitch, twist,
 *  item, bits]` (replay-recording.js, v4 `st`). Returns the row when something
 *  the replayer reads changed (or on first sight), else null. */
class SoldierStateTracker {
  class State(val lower: Any?, val upper: Any?, val pitch: Double, val twist: Double, val item: Any?, val bits: Any?)
  val last = HashMap<Any?, State>()

  fun update(netId: Any?, b: Map<String, Any?>?): MutableList<Any?>? {
    if (b == null) return null
    val k = JsOps.key(netId)
    val prev = last[k] ?: State(null, null, 0.0, 0.0, 0.0, 0.0)
    val cur = State(
      lower = cz(b["lower"], prev.lower),
      upper = cz(b["upper"], prev.upper),
      // A non-number (a malformed body) carries the last value forward, as
      // a missing one does.
      pitch = JsOps.num(b["aimA"]) ?: prev.pitch,
      twist = JsOps.num(b["aimB"]) ?: prev.twist,
      item = cz(b["held"], prev.item),
      bits = cz(b["stateBits"], prev.bits),
    )
    val first = !last.containsKey(k)
    last[k] = cur
    if (JsOps.nullish(cur.lower) && JsOps.nullish(cur.upper)) return null
    val changed = first || !JsOps.eq(cur.lower, prev.lower) || !JsOps.eq(cur.upper, prev.upper) || !JsOps.eq(cur.bits, prev.bits) ||
      !JsOps.eq(cur.item, prev.item) || Math.abs(cur.pitch - prev.pitch) > 0.01 || Math.abs(cur.twist - prev.twist) > 0.01
    if (!changed) return null
    return mutableListOf(netId, cz(cur.lower, 0.0), cz(cur.upper, 0.0), JsOps.toFixed(cur.pitch, 3), JsOps.toFixed(cur.twist, 3), cur.item, cur.bits)
  }

  private fun cz(a: Any?, b: Any?): Any? = if (JsOps.nullish(a)) b else a
}

/** The local player's aim as of his newest control state, for the ack the
 *  sidecar sends the page: `{ aim, twist, q, zoom }`, each carried forward per
 *  soldier in `map` (ledger VIEW-14). `zoom` is the state bits' 0x20. Returns
 *  null until the soldier's aim register has been seen. */
fun carrySelfAim(map: MutableMap<Any?, MutableMap<String, Any?>>, netId: Any?, body: Map<String, Any?>?): MutableMap<String, Any?>? {
  val k = JsOps.key(netId)
  val prev = map[k] ?: linkedMapOf("aim" to null, "twist" to null, "q" to null, "zoom" to null)
  val aimA = body?.get("aimA"); val aimB = body?.get("aimB"); val rot = body?.get("rot"); val sb = body?.get("stateBits")
  val cur = linkedMapOf<String, Any?>(
    "aim" to (if (JsOps.isFiniteNum(aimA)) JsOps.toFixed(JsOps.num(aimA)!!, 3) else prev["aim"]),
    "twist" to (if (JsOps.isFiniteNum(aimB)) JsOps.toFixed(JsOps.num(aimB)!!, 3) else prev["twist"]),
    "q" to (if (rot is List<*> && rot.size == 4) rot.mapTo(ArrayList<Any?>()) { JsOps.toFixed(JsOps.num(it) ?: Double.NaN, 6) } else prev["q"]),
    "zoom" to (if (JsOps.isInt(sb)) (if (JsOps.toInt32(JsOps.num(sb)!!) and 0x20 != 0) 1.0 else 0.0) else prev["zoom"]),
  )
  map[k] = cur
  if (JsOps.nullish(cur["aim"])) return null
  val out = linkedMapOf<String, Any?>("aim" to cur["aim"])
  if (!JsOps.nullish(cur["twist"])) out["twist"] = cur["twist"]
  if (JsOps.truthy(cur["q"])) out["q"] = cur["q"]
  if (!JsOps.nullish(cur["zoom"])) out["zoom"] = cur["zoom"]
  return out
}
