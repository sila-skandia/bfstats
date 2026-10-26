package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/pco.mjs; keep in step.
//
// Decode a vehicle's ghost body.
//
// A vehicle's framed ghost record is a whole NetworkableDescriptor, not one
// networkable: the hull's SimpleObjectNetworkable body followed by the bodies
// of every child networkable in the object's template tree, concatenated and
// sharing one bit budget (NetworkManager::setNetUpdate 0x084315f0 loops the
// descriptor's networkable list; NetworkManager::_analyseObject 0x0842d2f0
// fills it depth-first over the object tree, skipping PlayerControlObject
// descendants). See features/udp-sidecar/decodes/player-control-object.md and
// vehicle-children.md.
//
// The class named PlayerControlObjectNetworkable is a decoy on the dedicated
// server: its setNetUpdate (0x08232350) is an empty `ret`, so every vehicle
// takes the SimpleObject branch and its hull is read by
// SimpleObjectNetworkable::setNetUpdate 0x08236d00.
//
// THE HULL (SimpleObjectNetworkable, 0x08236d00): 11-bit presence mask, then
// position (0x2, readCompressedVector), rotation (0x1, readUnitQuaternion),
// the 0x4/0x20/0x8/0x40/0x100/0x200 controller vectors, the 0x80 flag, hit
// points (0x10, readUnsigned(rangedBits(0, maxHp))) and the 2-bit sub-state
// (0x400).
//
// THE CHILD TAIL, from the binary:
//   E  EngineNetworkable::setNetUpdate 0x08227da0
//        readUnsigned(10) mask, 0x1/0x2/0x4 bool, 0x8 readUnsigned(0,gears),
//        0x10/0x20/0x40 readSignedFloat(16), 0x80/0x100/0x200 readSignedFloat(12),
//        then readUnsigned(32) UNCONDITIONALLY (a zero-mask engine is 42 bits)
//   S  SpringNetworkable::setNetUpdate 0x08239270
//        readUnsigned(1) mask; if set, two readHighCompressedVector(0.002)
//        (high-compressed table [32,12,10,8], NOT the normal [32,20,16,12])
//   R  RotationalBundleNetworkable::setNetUpdate 0x082347f0
//        readUnsigned(7) mask, then a 16-bit signed float per set bit
//   O  a SimpleObjectNetworkable child: the same body shape as the hull
//   F  FireArmsNetworkable::setNetUpdate 0x08228f70
//        readUnsigned(2) mask; 0x1 readUnsigned(0, tmpl+0x228 + 1) (magazine A),
//        0x2 readUnsigned(0, tmpl+0x234 + 1) (magazine B)
//
// An underflow propagates (no try/catch around the reads) so verify sees a
// short or long read. The one exception is the auto-detection path, used only
// when the caller names no template and no children.

import io.bfstats.sidecar.BitReader
import io.bfstats.sidecar.COMPRESSION_BITS
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.Undefined
import io.bfstats.sidecar.JsOps.nullish
import io.bfstats.sidecar.JsOps.truthy
import io.bfstats.sidecar.asList
import io.bfstats.sidecar.asObj
import io.bfstats.sidecar.dl
import io.bfstats.sidecar.fullVec
import io.bfstats.sidecar.g
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.n
import io.bfstats.sidecar.quat
import io.bfstats.sidecar.rangedBits
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u

object Pco {
  // readCompressedVector's table (BitStream::m_compressionVectorBitTable).
  private val CV = COMPRESSION_BITS
  // readHighCompressedVector's table (BitStream::m_highCompressionVectorBitTable).
  private val HV = intArrayOf(32, 12, 10, 8)

  val MASK = mapOf(
    "rot" to 0x1, "pos" to 0x2, "vecA" to 0x4, "vecB" to 0x8, "hp" to 0x10, "vecC" to 0x20,
    "vecD" to 0x40, "flag" to 0x80, "vecE" to 0x100, "vecF" to 0x200, "subState" to 0x400,
  )

  private fun readVec(r: BitReader, table: IntArray): MutableList<Any?> {
    val mode = r.u(2).toInt()
    if (mode == 0) return r.fullVec()
    val bits = table[mode]
    return mutableListOf(r.sgn(bits), r.sgn(bits), r.sgn(bits))
  }

  // readCompressedVector(ref, scale): mode 0 is three floats, any other mode a
  // delta from `ref` in units of `scale` (BitStream::readCompressedVector).
  private fun readVecFrom(r: BitReader, ref: Any?, scale: Double): MutableList<Any?> {
    val mode = r.u(2).toInt()
    if (mode == 0) return r.fullVec()
    val bits = CV[mode]
    val d0 = r.sgn(bits); val d1 = r.sgn(bits); val d2 = r.sgn(bits)
    val o = (if (truthy(ref)) ref.dl() else null) ?: listOf(0.0, 0.0, 0.0)
    return mutableListOf(o[0] + d0 * scale, o[1] + d1 * scale, o[2] + d2 * scale)
  }

  // SimpleObjectNetworkable::getNetUpdate 0x08236770's scales: the position at
  // 0x3a03126f (0.0005), vecA/vecB at 0.001, the other four at 0.0001.
  private const val POS_SCALE = 0.0005
  private const val VEL_SCALE = 0.001
  private const val SMALL_SCALE = 0.0001

  /** The control-object state's context for one SimpleObject networkable. */
  class Cx(val ref: Any?, val base: Any?, val physics: Boolean)

  // SimpleObjectNetworkable body: the hull and every 'O' child share this
  // shape. Reads into `out` (mask + fields) and returns the mask.
  //
  // `cx` is the control-object state's context (ghost/control-state): the
  // position is relative to the block's reference (the root position) or, in
  // a delta, to the baseline's copy, and vecA/vecB to the baseline's; and the
  // six controller vectors and the flag are written only while the object's
  // physics says so (getNetUpdate's vt+0xe0 test). Outside a control state the
  // vt+0xe0 answer is the template's hasMobilePhysics (`mobile`): a fixed gun
  // skips the vectors and the flag even with their mask bits set.
  private fun readSimpleObject(r: BitReader, out: MutableMap<String, Any?>?, quatBits: Int, hpWidth: Int, cx: Cx?, blockRef: Any?, mobile: Boolean): Double {
    val mask = r.u(11)
    if (out != null) out["mask"] = mask
    val m = mask.toInt()
    fun put(k: String, v: Any?) { if (out != null) out[k] = v }
    val base = cx?.base.let { if (nullish(it)) null else it }
    // The position is relative to the stream's compression reference, which is
    // zero unless the block opened with a control-object state, whose root
    // position it then is for every record in the block.
    if (m and 0x2 != 0) {
      val ref = listOf(base.g("pos"), cx?.ref, blockRef).firstOrNull { !nullish(it) } ?: listOf(0.0, 0.0, 0.0)
      put("pos", readVecFrom(r, ref, POS_SCALE))
    }
    if (m and 0x1 != 0) {
      // The wire's quaternion is the conjugate of the one the client draws
      // with (the inverse rotation): negate x, y and z (Wake, 2026-10-16).
      val q = r.quat(quatBits)
      q[0] = -(q[0] as Double); q[1] = -(q[1] as Double); q[2] = -(q[2] as Double)
      put("rot", q)
    }
    if (if (cx != null) cx.physics else mobile) {
      fun v(ref: Any?, scale: Double) = if (cx != null) readVecFrom(r, ref, scale) else readVec(r, CV)
      if (m and 0x4 != 0) put("vecA", v(base.g("vecA"), VEL_SCALE))
      if (m and 0x20 != 0) put("vecC", v(null, SMALL_SCALE))
      if (m and 0x8 != 0) put("vecB", v(base.g("vecB"), VEL_SCALE))
      if (m and 0x40 != 0) put("vecD", v(null, SMALL_SCALE))
      if (m and 0x100 != 0) put("vecE", v(null, SMALL_SCALE))
      if (m and 0x200 != 0) put("vecF", v(null, SMALL_SCALE))
      if (m and 0x80 != 0) put("flag", r.readBool())
    }
    if (m and 0x10 != 0) put("hp", r.u(hpWidth))
    if (m and 0x400 != 0) put("subState", r.u(2))
    return mask
  }

  // Each mask bit is one member, read off the Engine or its PhysicsEngine by
  // EngineNetworkable::updateStateMask (0x08227620) and written back by
  // setNetUpdate (0x08227da0): 0x001 RUNNING (+0x142), 0x002 DISABLED,
  // 0x004 physEngine+0xb4, 0x008 gear, 0x010/0x020/0x040 the engine angles,
  // 0x080 REVS (physEngine+0xa0), 0x100 +0xb0, 0x200 +0xa4. Revs arrives at
  // 0.8 of the server's (writeSignedFloat(revs, 12, 1.25), read back without
  // the 1.25), as retail draws it.
  private fun readEngine(r: BitReader, gearBits: Int, into: MutableMap<String, Any?>?): Double {
    val mask = r.u(10)
    val m = mask.toInt()
    if (m and 0x1 != 0) { val v = r.readBool(); into?.set("running", v) }
    if (m and 0x2 != 0) { val v = r.readBool(); into?.set("disabled", v) }
    if (m and 0x4 != 0) r.readBool()
    if (m and 0x8 != 0) { val v = r.u(gearBits); into?.set("gear", v) }
    if (m and 0x10 != 0) { val v = r.readSignedFloat(16); into?.set("roll", v) }
    if (m and 0x20 != 0) { val v = r.readSignedFloat(16); into?.set("yaw", v) }
    if (m and 0x40 != 0) r.readSignedFloat(16)
    if (m and 0x80 != 0) { val v = r.readSignedFloat(12); into?.set("revs", v) }
    if (m and 0x100 != 0) { val v = r.readSignedFloat(12); into?.set("steer", v) }
    if (m and 0x200 != 0) { val v = r.readSignedFloat(12); into?.set("load", v) }
    r.readUnsigned(32) // the trailing counter is unconditional
    return mask
  }

  // A Spring's position relative to its parent and its `PhysicsSpring` Dprev:
  // three floats, or three integers of 2 mm.
  private fun readSpringVec(r: BitReader): MutableList<Any?> {
    val mode = r.u(2).toInt()
    if (mode == 0) return r.fullVec()
    val bits = HV[mode]
    val a = r.sgn(bits) * 0.002; val b = r.sgn(bits) * 0.002; val c = r.sgn(bits) * 0.002
    return mutableListOf(a, b, c)
  }

  private fun readSpring(r: BitReader, into: MutableMap<String, Any?>?): Double {
    val mask = r.u(1)
    if (mask != 0.0) {
      val rel = readSpringVec(r); val dprev = readSpringVec(r)
      if (into != null) { into["rel"] = rel; into["dprev"] = dprev }
    }
    return mask
  }

  private fun readRotationalBundle(r: BitReader, into: MutableMap<String, Any?>?): Double {
    val mask = r.u(7)
    val m = mask.toInt()
    val values = ArrayList<Any?>()
    for (b in 0 until 7) values.add(if (m and (1 shl b) != 0) r.readSignedFloat(16) else null)
    into?.set("values", values)
    return mask
  }

  private fun readFireArms(r: BitReader, wA: Int, wB: Int, into: MutableMap<String, Any?>?): Double {
    val mask = r.u(2)
    val m = mask.toInt()
    if (m and 0x1 != 0) { val v = r.u(wA); into?.set("magA", v) }
    if (m and 0x2 != 0) { val v = r.u(wB); into?.set("magB", v) }
    return mask
  }

  private fun specFromOpts(opts: Map<String, Any?>): Map<String, Any?>? {
    val ch = opts["children"]
    if (ch is List<*>) {
      val s = linkedMapOf<String, Any?>(
        "children" to ch,
        "gearBits" to (JsOps.coalesce(opts.g("gearBits")) { JsOps.coalesce(Children.anchorSpec(Children.DEFAULT_TEMPLATE).g("gearBits")) { 2.0 } }),
        "hpBits" to (JsOps.coalesce(opts.g("hpBits")) { Children.anchorSpec(Children.DEFAULT_TEMPLATE).g("hpBits") }),
        "mags" to (if (truthy(opts["mags"])) opts["mags"] else ArrayList<Any?>()),
      )
      if (truthy(opts["objects"])) s["objects"] = opts["objects"]
      return s
    }
    // A named template takes the level's spec; one the level does not know is
    // auto-detected among the anchors, as an unnamed one is.
    if (truthy(opts["template"])) return Children.childrenFor(opts["template"])
    return null // signal auto-detection
  }

  /** A seat's descriptor: no hull, just its child tail. */
  fun decodeSeatBody(bodyHex: String?, bodyBits: Double?, spec: Map<String, Any?>, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?> {
    val o = LinkedHashMap(opts); o["noHull"] = true
    return decodeWithSpec(bodyHex, bodyBits, spec, o, opts["strict"] != false)
  }

  private fun intOf(v: Any?): Int = (JsOps.num(v) ?: 0.0).let { if (it.isNaN()) 0 else it.toInt() }

  private fun decodeWithSpec(bodyHex: String?, bodyBits: Double?, spec: Map<String, Any?>, opts: Map<String, Any?>, strict: Boolean): MutableMap<String, Any?> {
    val gearBits = intOf(JsOps.coalesce(spec.g("gearBits")) { 2.0 }) // EngineTemplate's default numberOfGears 1
    val qb = opts.n("quatBits")
    val quatBits = if (qb != null && truthy(qb)) qb.toInt() else 16
    // The hit points are readUnsigned(0, round(armor max)): the template's
    // maxHitPoints sizes them, so a Hatsuzuki's 300 is 9 bits.
    val hpWidth = when {
      !nullish(opts.g("hpBits")) -> intOf(opts["hpBits"])
      !nullish(opts.g("maxHp")) -> rangedBits(0, JsOps.round(JsOps.num(opts["maxHp"]) ?: Double.NaN).toLong())
      !nullish(spec.g("hpBits")) -> intOf(spec["hpBits"])
      else -> rangedBits(0, 100)
    }
    val mobile = opts["mobile"] != false
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>(
      "mask" to 0.0, "pos" to null, "rot" to null, "vecA" to null, "vecB" to null, "vecC" to null, "vecD" to null,
      "vecE" to null, "vecF" to null, "flag" to null, "hp" to null, "subState" to null,
      "children" to ArrayList<Any?>(), "consumed" to 0.0,
    )
    try {
      // In a control-object state every SimpleObject networkable (the hull and
      // each 'O' child) reads against its own baseline entry, in order
      // (getNetUpdate advances BaseLineData+0x400 per networkable).
      val cx = opts.g("control").let { if (nullish(it)) null else it }
      var oi = 0
      fun cxFor(): Cx? {
        if (cx == null) return null
        val base = JsOps.at(cx.g("bases"), oi.toDouble()).let { if (nullish(it)) null else it }
        // `cx.physics?.[oi++]`: the index moves only when there is a list.
        val phl = cx.g("physics")
        val ph = if (nullish(phl)) Undefined else JsOps.at(phl, (oi++).toDouble())
        return Cx(cx.g("ref"), base, if (nullish(ph)) false else truthy(ph))
      }
      val objects = ArrayList<Any?>()
      out["objects"] = objects
      val blockRef = opts.g("ref").let { if (nullish(it)) null else it }
      if (!truthy(opts["noHull"])) {
        readSimpleObject(r, out, quatBits, hpWidth, cxFor(), blockRef, mobile)
        objects.add(linkedMapOf("pos" to out["pos"], "vecA" to out["vecA"], "vecB" to out["vecB"]))
      }
      var fi = 0
      var ci = 0 // the 'O' children, in order: their own template widths (spec.objects)
      val mags = spec["mags"].asList()
      val sobj = spec["objects"].asList()
      val kids = spec["children"].asList() ?: throw IllegalStateException("spec.children is not iterable")
      for (t in kids) {
        val child = linkedMapOf<String, Any?>("type" to t, "mask" to 0.0)
        val mask = when (t) {
          "E" -> readEngine(r, gearBits, child)
          "S" -> readSpring(r, child)
          "R" -> readRotationalBundle(r, child)
          "O" -> {
            // An 'O' child is a SimpleObjectNetworkable of its own template:
            // its hit points sized by its own armour, its controller vectors
            // gated by its own physics (spec.objects[k] = { hpBits, mobile }).
            val ob = sobj?.getOrNull(ci++).let { if (nullish(it)) null else it }
            val o = LinkedHashMap<String, Any?>()
            val obHp = ob.g("hpBits")
            val obMobile = ob.g("mobile")
            val mk = readSimpleObject(r, o, quatBits, if (nullish(obHp)) hpWidth else intOf(obHp), cxFor(), blockRef,
              if (nullish(obMobile)) true else truthy(obMobile))
            objects.add(linkedMapOf("pos" to (o["pos"] ?: null), "vecA" to (o["vecA"] ?: null), "vecB" to (o["vecB"] ?: null)))
            mk
          }
          "F" -> {
            val w = mags?.getOrNull(fi++).let { if (truthy(it)) it.asList()!! else listOf<Any?>(0.0, 0.0) }
            readFireArms(r, intOf(w.getOrNull(0)), intOf(w.getOrNull(1)), child)
          }
          else -> throw IllegalStateException("unknown child type ${JsOps.str(t)}")
        }
        child["mask"] = mask
        (out["children"] as MutableList<Any?>).add(child)
      }
    } catch (e: RuntimeException) {
      if (strict) throw e // verify MUST see the underflow
      out["consumed"] = r.pos.toDouble()
      return out
    }
    out["consumed"] = r.pos.toDouble()
    return out
  }

  /** Decode a vehicle body. opts: { template } to pick a child sequence by
   *  name, or { children, gearBits, hpBits, mags } to give one explicitly;
   *  quatBits / maxHp override the hull widths. With neither, each known
   *  template's sequence is tried and the first that lands on exactly the last
   *  bit is used; if none lands, the default template's decode is re-run and
   *  its underflow propagates. */
  fun decodePcoBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?> {
    val strict = opts["strict"] != false
    val spec = specFromOpts(opts)
    if (spec != null) return decodeWithSpec(bodyHex, bodyBits, spec, opts, strict)

    // Auto-detect: no template named. The default template first.
    val names = listOf(Children.DEFAULT_TEMPLATE) + Children.templateNames().filter { it != Children.DEFAULT_TEMPLATE }
    for (name in names) {
      val res: MutableMap<String, Any?>
      try {
        val a = Children.anchorSpec(name) ?: throw IllegalStateException("no spec")
        res = decodeWithSpec(bodyHex, bodyBits, a, opts, true)
      } catch (e: RuntimeException) { continue }
      if (bodyBits != null && res["consumed"] == bodyBits) { res["template"] = name; return res }
    }
    // Nothing lands exactly: re-run the default so the underflow propagates.
    val a = Children.anchorSpec(Children.DEFAULT_TEMPLATE) ?: throw IllegalStateException("Cannot read properties of null (reading 'gearBits')")
    return decodeWithSpec(bodyHex, bodyBits, a, opts, strict)
  }
}
