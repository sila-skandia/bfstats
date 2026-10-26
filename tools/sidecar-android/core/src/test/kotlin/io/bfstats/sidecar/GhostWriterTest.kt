package io.bfstats.sidecar

import io.bfstats.sidecar.ghost.Children
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** GhostWriter, its helpers, the soldier trackers and Record against Node
 *  (parity/ghost-writer.mjs). */
class GhostWriterTest {
  private fun o(vararg p: Pair<String, Any?>) = linkedMapOf(*p)

  @Test fun everyCaseAsNode() {
    DecoderFixtures.freshCache(true)
    val script = DecoderFixtures.json("ghost-writer.script.json").asObj()!!
    val out = ArrayList<String>()
    fun put(label: String, v: Any?) { out += "$label ${Js.stringify(if (v === Undefined) "undefined" else v)}" }
    fun writer(rows: MutableList<Any?>, objInfo: MutableMap<Any?, MutableMap<String, Any?>> = HashMap(), cp: Any? = LinkedHashMap<String, Any?>(), anim: ((Any?) -> Any?)? = null) =
      GhostWriter({ rows.add(it) }, objInfo, cp, anim)

    run {
      val rows = ArrayList<Any?>()
      val w = writer(rows)
      val said = listOf(w.controlHp(1.0, 555.0, 100.0), w.controlHp(1.03, 555.0, 100.0), w.controlHp(2.0, 555.0, 62.5), w.controlHp(2.03, 555.0, Double.NaN),
        w.controlHp(3.0, 555.0, 70.0), w.controlHp(3.0, 5.5, 70.0))
      put("controlHp", o("said" to said, "rows" to rows))
    }
    run {
      val rows = ArrayList<Any?>()
      val w = writer(rows, hashMapOf<Any?, MutableMap<String, Any?>>(555.0 to o("tid" to 1.0, "tmpl" to "M3A1", "team" to 1.0)))
      w.block(1.0, listOf(o("action" to 1.0, "netId" to 555.0, "cls" to "SimpleObjectNetworkable", "body" to o("hp" to 100.0))))
      w.block(1.05, listOf(o("action" to 3.0, "netId" to 555.0)))
      put("scopeOutHp", o("again" to w.controlHp(1.06, 555.0, 100.0), "rows" to rows))
    }
    run {
      fun f(vararg kv: Pair<String, Any?>) = o(*kv)
      val first = GhostRows.controlMagazines(listOf(f("type" to "R"), f("type" to "R"), f("type" to "F", "magA" to 501.0, "magB" to 2.0)), null, 1.0, null)
      val next = GhostRows.controlMagazines(listOf(f("type" to "R"), f("type" to "F", "magA" to 497.0)), null, 1.0, first)
      put("controlMagazines", o("first" to first, "next" to next, "none" to GhostRows.controlMagazines(listOf(f("type" to "S"), f("type" to "E")), "M3A1", 0.0, null),
        "notList" to GhostRows.controlMagazines(null, "M3A1"),
        "named" to GhostRows.controlMagazines(listOf(f("type" to "F", "magA" to 31.0), f("type" to "F")), "Sherman", 0.0, listOf(listOf("x", 5.0, 6.0), listOf("y", 7.0, 8.0)))))
    }
    for (control in listOf(true, false)) {
      val rows = ArrayList<Any?>()
      val gw = writer(rows, hashMapOf<Any?, MutableMap<String, Any?>>(100.0 to o("tid" to 1.0, "tmpl" to "Sherman", "team" to 1.0)))
      gw.seated[100.0] = arrayListOf(GhostWriter.Seated(0.0, 5.0))
      fun rec(magA: Double) = o("netId" to 100.0, "action" to 1.0, "cls" to "SimpleObjectNetworkable",
        "body" to o("children" to listOf(o("type" to "F", "magA" to magA)))).also { if (control) it["control"] = true }
      gw.block(0.0, listOf(rec(30.0)), 0.0)
      gw.block(0.1, listOf(rec(29.0)), 1.0)
      gw.block(0.2, listOf(rec(27.0)), 3.0)
      put("ownFire $control", o("rows" to rows, "stats" to gw.stats))
    }
    run {
      val ago = ArrayList<Any?>()
      for (c in 0..21) for (t in 0..22) for (g in listOf(null, true, false)) {
        val fit = GhostRows.recoilAgo(c.toDouble(), t.toDouble(), g)
        ago += fit?.let { o("k" to it.k, "goBack" to it.goBack) }
      }
      put("recoilAgo", ago)
    }
    run {
      var table: Any? = listOf(listOf(0.0, "Lb_Stand"), listOf(5.0, "Ub_Fire"), listOf(5.0, "Ub_Twice"))
      val name = GhostRows.animNamer { table }
      val a = listOf(name(0.0), name(5.0), name(9.0), name(null))
      table = listOf(listOf(0.0, "Lb_LieStill"))
      val b = listOf(name(0.0), name(5.0))
      table = null
      put("animNamer", listOf(a, b, name(0.0)))
    }
    run {
      val tr = SoldierStateTracker()
      val map = HashMap<Any?, MutableMap<String, Any?>>()
      val rowsT = ArrayList<Any?>(); val rowsA = ArrayList<Any?>()
      for (e in script["bodies"] as List<*>) {
        val (nid, b) = e as List<*>
        rowsT += tr.update(nid, b.asObj())
        rowsA += carrySelfAim(map, nid, b.asObj())
      }
      put("tracker", rowsT)
      put("selfAim", rowsA)
    }
    for (level in listOf<String?>(null, "wake")) {
      Children.useLevelTemplates(if (level != null) TemplateTable.levelTemplates("bf1942", level, "coop") else null, level)
      val rows = ArrayList<Any?>()
      val objInfo = HashMap<Any?, MutableMap<String, Any?>>()
      for (e in script["objInfo"] as List<*>) { val (k, v) = e as List<*>; objInfo[k] = LinkedHashMap(v.asObj()!!) }
      val anim = listOf(listOf(0.0, "Lb_Stand"), listOf(1.0, "Lb_Crouch"), listOf(2.0, "Lb_LieStill"), listOf(3.0, "Ub_Fire"), listOf(4.0, "Ub_Idle"))
      val w = writer(rows, objInfo, o("ALLIES_base" to "Airfield"), GhostRows.animNamer { anim })
      for (step in (script["steps"] as List<*>).map { it.asObj()!! }) {
        if (step.containsKey("note")) for (e in w.note(step["note"], step["t"])) rows.add(o("derivedNote" to e))
        else w.block(JsOps.num(step["t"])!!, (step["records"] as List<*>).map { it.asObj()!! }, step.g("tick").let { if (it === Undefined) null else it })
      }
      put("script $level", o("rows" to rows, "stats" to w.stats))
    }
    put("recordFor", (script["events"] as List<*>).map { Record.recordFor(it.asObj()!!).let { r -> if (r === Undefined) "undefined" else r } })
    val at = Instant.parse("2026-10-26T01:02:03.456Z")
    put("header", listOf(Record.header(10.0, now = at), Record.header(20.0, o("host" to "1.2.3.4", "port" to 14567.0, "hz" to 30.0), now = at)))

    val want = (DecoderFixtures.json("ghost-writer.json") as List<*>).map { (it as List<*>).let { p -> "${p[0]} ${p[1]}" } }
    val d = DecoderFixtures.diff(want, out, "ghost-writer")
    assertEquals(d, "", d)
  }
}
