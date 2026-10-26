package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test

/** BodyDecoder against body-decoder.mjs (parity/body-decoder.mjs). */
class BodyDecoderTest {
  private val fx by lazy { Parity.json("body-decoder.json.gz").asObj()!! }
  private fun o(vararg p: Pair<String, Any?>) = linkedMapOf(*p)

  private fun check(name: String, got: List<String>) {
    val want = (fx[name] as List<*>).map { it as String }
    val d = Parity.diff(want, got, name)
    assertEquals(d, "", d)
  }

  @Test fun harnessBodies() {
    Parity.freshCache(false)
    val out = ArrayList<String>()
    val d = BodyDecoder()
    d.note(o("e" to "createObject", "netId" to 622.0, "tid" to 1754.0))
    d.note(o("e" to "control", "pid" to 1.0, "netId" to 622.0))
    val recs = listOf(
      o("netId" to 622.0, "hex" to "fd39d1852c002492fcfffdfffdfffdfffdff05800800007e000000001000", "bodyBits" to 237.0,
        "ref" to mutableListOf<Any?>(1004.2355346679688, 105.24522399902344, 843.558349609375)),
      o("netId" to 622.0, "hex" to "0400ff7f54acff7f", "bodyBits" to 64.0),
    )
    for (r in recs) { d.decode(r); out += Js.stringify(r) }
    d.note(o("e" to "control", "pid" to 2.0, "netId" to 1111.0))
    val ref = mutableListOf<Any?>(870.0, 97.0, 873.0)
    for (r in listOf(o("netId" to 1111.0, "hex" to "0500d26b4989ac26b2856ad42689feff75fcffff01", "bodyBits" to 162.0, "ref" to ref),
      o("netId" to 1111.0, "hex" to "05004c6e4989bc26b2850aca2689feff75fcffff01", "bodyBits" to 162.0, "ref" to ref),
      o("netId" to 1111.0, "hex" to "6080ef8407", "bodyBits" to 37.0, "ref" to ref))) { d.decode(r); out += Js.stringify(r) }
    check("harness", out)
  }

  @Test fun levelTableLookups() {
    Parity.freshCache(true)
    val out = ArrayList<String>()
    val dc = BodyDecoder()
    dc.note(o("e" to "serverInfo", "mapId" to "BF1942", "mod" to "bf1942", "gameId" to "BF1942"))
    dc.note(o("e" to "setLevel", "level" to "bf1942/levels/el_alamein/", "mode" to "coop.con"))
    dc.note(o("e" to "createObject", "netId" to 700.0, "tid" to 2914.0))
    out += Js.stringify(o("info700" to dc.info(700.0), "cls700" to dc.classOf(700.0), "animStates" to dc.animStates, "level" to dc.level))
    val d2 = BodyDecoder()
    d2.note(o("e" to "serverInfo", "mapId" to "BF1942", "mod" to "desertcombat", "gameId" to "DC"))
    d2.note(o("e" to "setLevel", "level" to "bf1942/levels/el_alamein/", "mode" to "conquest.con"))
    out += Js.stringify(o("animStates" to d2.animStates, "cpTemplates" to d2.cpTemplates!!.sorted(),
      "cpClass" to TemplateClass.classForTemplate("SouthOpenBase", d2.cpTemplates)?.get("objectClass")))
    val fixed = BodyDecoder(o("animStates" to 1395.0))
    fixed.note(o("e" to "serverInfo", "mod" to "desertcombat"))
    fixed.note(o("e" to "setLevel", "level" to "bf1942/levels/el_alamein/", "mode" to "conquest.con"))
    out += Js.stringify(o("fixed" to fixed.animStates))
    val d3 = BodyDecoder()
    d3.note(o("e" to "serverInfo", "mod" to "bf1942"))
    d3.note(o("e" to "setLevel", "level" to "bf1942/levels/tobruk/", "mode" to "coop.con"))
    for (tid in listOf(1571.0, 2916.0, 1754.0, 1325.0)) {
      d3.note(o("e" to "createObject", "netId" to 5000 + tid, "tid" to tid))
      out += Js.stringify(o("tid" to tid, "info" to d3.info(5000 + tid), "cls" to d3.classOf(5000 + tid)))
    }
    check("tables", out)
  }

  @Test fun sessionsRecordByRecord() {
    for (which in listOf("run", "m3a1", "zero_sherman", "player_stats", "fire_line", "detonate")) {
      Parity.freshCache(true)
      val rec = Parity.text("rebuild/$which.rec.ndjson.gz").split("\n").filter { it.isNotEmpty() }.mapNotNull { try { JsOps.parse(it).asObj() } catch (e: Exception) { null } }
      val review = Parity.text("rebuild/$which.review.ndjson.gz").split("\n").filter { it.isNotEmpty() }.mapNotNull { try { JsOps.parse(it).asObj() } catch (e: Exception) { null } }
      class E(val t: Double, val kind: Int, val x: MutableMap<String, Any?>)
      val tl = ArrayList<E>()
      for (r in rec) if (r.g("k") == "e") tl += E(JsOps.toNumber(JsOps.coalesce(r.g("t")) { 0.0 }), 0, r)
      for (d in review) if (d.g("tag") == "ghost-record") {
        val x = linkedMapOf("netId" to d.g("netId"), "action" to d.g("action"), "bodyBits" to d.g("bodyBits"), "hex" to d.g("hex"))
        if (JsOps.truthy(d.g("ref"))) x["ref"] = d.g("ref")
        tl += E(JsOps.toNumber(d.g("dt")), 1, x)
      }
      tl.sortWith { a, b -> val dd = a.t - b.t; if (dd != 0.0 && !dd.isNaN()) (if (dd < 0) -1 else 1) else a.kind.compareTo(b.kind) }
      val anim = (rec.find { it.g("k") == "anim" }?.g("states") as? List<*>)?.size?.toDouble() ?: 0.0
      val d = BodyDecoder(o("animStates" to anim))
      var n = 0
      val out = ArrayList<String>()
      for (e in tl) {
        if (e.kind == 0) { d.note(e.x); continue }
        if (!JsOps.eq(e.x.g("action"), 1.0) || !JsOps.truthy(e.x.g("hex"))) continue
        var threw: String? = null
        try { d.decode(e.x) } catch (x: RuntimeException) { threw = x.message }
        if (n++ % 8 == 0) out += Js.stringify(if (threw != null) o("threw" to threw) else e.x)
      }
      check(which, out)
    }
  }
}
