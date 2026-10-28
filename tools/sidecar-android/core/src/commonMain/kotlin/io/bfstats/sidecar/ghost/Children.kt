package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/children.mjs; keep in step.
//
// Per-template child networkable sequences for BF1942 composite (vehicle)
// ghosts, and the other template values a ghost body's layout depends on.
//
// A framed action-1 ghost record is a whole NetworkableDescriptor: the hull's
// SimpleObjectNetworkable body followed by the bodies of every child
// networkable in the template tree, concatenated and sharing one bit budget
// (NetworkManager::_analyseObject 0x0842d2f0 walks the object tree depth-first,
// pushes any object whose networkable component is set, and skips
// PlayerControlObject descendants). The sequence of child *types* is a property
// of the template and is NOT on the wire, so it comes from the template graph
// the level load builds: TemplateTable replays the load (from the install, or
// the published bake) and DeriveChildren applies the engine's rule to it, per
// level. The body decoder hands each SetLevel's result to useLevelTemplates.
//
// Letters: E engine, S spring, R rotational bundle, F firearms, O simple
// object. A spec's fields are listed in the Node copy (children, gearBits,
// hpBits, mags, objects, rof, guns, muzzles, seats, joints).
//
// Without a computed table (no install, no mod known, a level the install
// lacks) the vanilla specs and hulls derived once are the fallback, loudly:
// ghost/derived-specs.json and ../hulls.json (classpath resources here).

import io.bfstats.sidecar.EmbeddedResources
import io.bfstats.sidecar.Lock
import kotlin.concurrent.Volatile
import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.asList
import io.bfstats.sidecar.asObj
import io.bfstats.sidecar.g

object Children {
  private val lock = Lock()
  private fun lower(o: Any?): Map<String, Any?> {
    val m = LinkedHashMap<String, Any?>()
    o.asObj()?.forEach { (k, v) -> m[k.lowercase()] = v }
    return m
  }

  class Tables(val specs: Map<String, Any?>, val hulls: Map<String, Any?>, val soldiers: Map<String, Any?>)

  @Volatile private var LEVEL: Tables? = null
  @Volatile private var LEVEL_LABEL: String? = null
  @Volatile private var FALLBACK: Tables? = null
  private val warned = HashSet<String>()
  private fun warnOnce(key: String, msg: String) {
    lock.withLock { if (!warned.add(key)) return }
    JsOps.consoleError("[children] $msg")
  }

  /** A bundled resource ("/sidecar/hulls.json") as parsed JSON, or null. */
  fun readResource(path: String): Any? = try {
    EmbeddedResources.text(path.removePrefix("/"))?.let { JsOps.parse(it) }
  } catch (e: RuntimeException) { null }

  private fun fallback(): Tables {
    FALLBACK?.let { return it }
    val t = Tables(lower(readResource("/sidecar/ghost/derived-specs.json").g("specs")), lower(readResource("/sidecar/hulls.json")), emptyMap())
    FALLBACK = t
    return t
  }

  private fun current(): Tables {
    LEVEL?.let { return it }
    val label = LEVEL_LABEL
    warnOnce("fallback:${label ?: "null"}", "FALLBACK: no template table computed from the install${if (label != null) " for $label" else ""}; vehicle bodies use the vanilla specs derived once on this PC (ghost/derived-specs.json, hulls.json)")
    return fallback()
  }

  /** The level's layouts ({ specs, hulls, soldiers }), or null for the
   *  vanilla fallback. `label` names the level for that line. */
  fun useLevelTemplates(t: Map<String, Any?>?, label: String? = null) {
    LEVEL_LABEL = label
    LEVEL = if (t != null) Tables(lower(t["specs"]), lower(t["hulls"]), lower(t["soldiers"])) else null
  }

  /** Forget the level and the warnings (tests; a fresh Node process). */
  fun reset() { LEVEL = null; LEVEL_LABEL = null; lock.withLock { warned.clear() } }

  /** A name the vanilla fallback knows as a hull. */
  fun fallbackHull(template: String?): Boolean = !template.isNullOrEmpty() && fallback().specs.containsKey(template.lowercase())

  private fun key(template: Any?): String? = if (JsOps.truthy(template)) JsOps.str(template).lowercase() else null

  /** A template's hull spec, or null. */
  fun specFor(template: Any?): Map<String, Any?>? {
    val k = key(template) ?: return null
    return current().specs[k].asObj()
  }

  /** A hull's { maxHp, mobile, parts }, or null. */
  fun hullFor(template: Any?): Map<String, Any?>? {
    val k = key(template) ?: return null
    return current().hulls[k].asObj()
  }

  /** A soldier template's { maxHp, aimTwist, aimPitch }, or null. */
  fun soldierFor(template: Any?): Map<String, Any?>? {
    val k = key(template) ?: return null
    return current().soldiers[k].asObj()
  }

  /** A hull's nested PlayerControlObject (gunner seat) spec, by its offset. */
  fun seatSpecFor(template: Any?, seat: Any?): Map<String, Any?>? {
    val v = JsOps.at(specFor(template)?.get("seats"), seat)
    return if (JsOps.nullish(v)) null else v.asObj()
  }

  // The placements from the hull's root to where gun `index` of `seat`
  // launches (derive-children.mjs `launchChains`), or null when the table
  // predates them (a published bake older than 2026-10-28).
  // Whether a gunner's rounds leave from the hull's pose of the tick before
  // the round (an aircraft), not of the round's own tick (a land or sea hull;
  // DeriveChildren `air`, GhostWriter `fires`).
  fun launchesBeforeMove(template: Any?): Boolean = JsOps.truthy(specFor(template)?.get("air"))

  fun launchFor(template: Any?, seat: Any?, index: Any?): Any? {
    val v = JsOps.at(JsOps.at(specFor(template)?.get("launch"), seat), index)
    return if (JsOps.nullish(v)) null else v
  }

  // Not derivable by the rule: the Daihatsu hull's two R children are its bow
  // ramp's leaves, which carry no gun. The client's own rows lower
  // DaihatsuLanding1 to 65 deg and DaihatsuLanding2 to -115 deg as the ramp
  // drops (Wake, 2026-10-16). Applied only where the level's Daihatsu has
  // those two R's.
  val HAND_JOINT_PARTS: Map<String, Map<String, List<List<Any?>>>> = linkedMapOf(
    "Daihatsu" to linkedMapOf("0" to listOf(listOf("DaihatsuLanding1", "pitch"), listOf("DaihatsuLanding2", "pitch"))),
  )

  /** The turning parts a hull's or seat's R children drive: [part name,
   *  role, rest yaw in degrees], or null. */
  fun jointPartsFor(template: Any?, seat: Double = 0.0): Any? {
    val spec = specFor(template)
    val tk = key(template)
    val hand = HAND_JOINT_PARTS.entries.find { it.key.lowercase() == tk }?.value?.get(JsOps.str(seat))
    if (hand != null && spec != null) {
      val d = (if (seat != 0.0) JsOps.at(spec["seats"], seat) else spec).asObj()
      val children = d?.get("children").asList()
      val rs = (d?.get("nodes").asList() ?: emptyList<Any?>()).filterIndexed { i, _ -> JsOps.at(children, i.toDouble()) == "R" }
        .map { JsOps.str(it).lowercase() }
      if (rs.size == hand.size && hand.withIndex().all { (i, h) -> rs[i] == (h[0] as String).lowercase() }) return hand
    }
    val j = JsOps.at(spec?.get("joints"), seat)
    return if (JsOps.nullish(j)) null else j
  }

  /** A gun's template name and how many rounds one firing takes off its counter. */
  class Gun(val name: Any?, val muzzles: Double)
  fun gunFor(template: Any?, seat: Double, index: Double): Gun {
    val spec = if (seat != 0.0 && !seat.isNaN()) seatSpecFor(template, seat) else specFor(template)
    val name = JsOps.at(spec?.get("guns"), index)
    val muzzles = JsOps.at(spec?.get("muzzles"), index)
    return Gun(if (JsOps.nullish(name)) null else name, if (JsOps.nullish(muzzles)) 1.0 else (JsOps.num(muzzles) ?: Double.NaN))
  }

  // The counter drops in `fireFinished`, on the tick the round's timer runs
  // out, and that timer counts whole 1/30 s ticks in float32
  // (viewer/fire-timer.js `fireCycle`, ledger GUN-13).
  private val TICK_F32 = JsOps.fround(1.0 / 30)
  fun fireLagFor(template: Any?, seat: Double, index: Double): Double {
    val spec = if (seat != 0.0 && !seat.isNaN()) seatSpecFor(template, seat) else specFor(template)
    val rof = JsOps.num(JsOps.at(spec?.get("rof"), index))
    if (rof == null || !(rof > 0)) return 0.0
    var timer = JsOps.fround(1 / JsOps.fround(rof))
    var ticks = 0
    while (timer > 0 && ticks < 86400 * 30) {
      timer = JsOps.fround(timer - TICK_F32)
      ticks++
    }
    return ticks / 30.0
  }

  /** A template's child spec; null when the level does not know it. */
  fun childrenFor(template: Any?): Map<String, Any?>? = specFor(template)

  // The templates pco tries, in order, for a body whose template is not known:
  // the six Wake hulls the specs were first proven on, M3A1 last.
  private val ANCHORS = listOf("Daihatsu", "Sherman", "Zero", "Corsair", "Chi-ha", "M3A1")
  const val DEFAULT_TEMPLATE = "M3A1"
  fun templateNames(): List<String> = ANCHORS.filter { anchorSpec(it) != null }

  /** An anchor's spec: the level's, else the vanilla one. */
  fun anchorSpec(template: Any?): Map<String, Any?>? = specFor(template) ?: key(template)?.let { fallback().specs[it].asObj() }
}
