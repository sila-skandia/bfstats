package io.bfstats.sidecar

import io.bfstats.sidecar.ghost.Children
import io.bfstats.sidecar.ghost.ControlBaselines
import io.bfstats.sidecar.ghost.ControlState
import io.bfstats.sidecar.ghost.ControlState.Ctx
import io.bfstats.sidecar.ghost.Pco
import org.junit.Assert.assertEquals
import org.junit.Test

/** The control-object state and the hull/seat decoders against Node
 *  (parity/control-state.mjs). */
class ControlStateTest {
  private val inp by lazy { Parity.json("control-state.inputs.json.gz").asObj()!! }
  private val fx by lazy { Parity.json("control-state.json.gz").asObj()!! }
  private fun o(vararg p: Pair<String, Any?>) = linkedMapOf(*p)
  private fun S(v: Any?) = Js.stringify(v)
  private fun tryS(f: () -> Any?): String = try { S(f()) } catch (e: RuntimeException) { S(o("threw" to e.message)) }
  private fun rows(v: Any?) = (v as List<*>).map { it.asObj()!! }
  private fun hex(r: Map<String, Any?>) = r["hex"] as String
  private fun bits(r: Map<String, Any?>) = JsOps.num(r["bits"])!!
  private fun soldierCtx(b: ControlBaselines) = Ctx(classOf = { "BFSoldierNetworkable" }, baselines = b, animStates = 1395.0)

  private val bad = ArrayList<String>()
  private fun check(label: String, want: Any?, got: List<String>) {
    val d = Parity.diff((want as List<*>).map { it as String }, got, label)
    if (d.isNotEmpty()) bad += d
  }

  @Test fun controlStatesAndBodies() {
    Parity.freshCache(true)
    for (level in listOf<String?>(null, "wake")) {
      Children.useLevelTemplates(if (level != null) TemplateTable.levelTemplates("bf1942", level, "coop") else null, level)
      val want = fx[level ?: "fallback"].asObj()!!
      val cs = rows(inp["sidecar_control_state"])
      run { val b = ControlBaselines(); check("$level soldier", want["soldier"], cs.map { S(ControlState.decodeControlState(hex(it), bits(it), soldierCtx(b))) }) }
      run {
        val b = ControlBaselines(); val v = inp["sidecar_control_state_vehicle"].asObj()!!
        check("$level vehicle", want["vehicle"], rows(v["rows"]).map { S(ControlState.decodeControlState(hex(it), bits(it), Ctx(classOf = { "SimpleObjectNetworkable" }, templateOf = { v["template"] }, baselines = b))) })
      }
      run { val b = ControlBaselines(); check("$level camera", want["camera"], rows(inp["sidecar_control_state_camera"]).map { S(ControlState.decodeControlState(hex(it), bits(it), Ctx(classOf = { "FreeCameraNetworkable" }, baselines = b))) }) }
      run {
        val seat = inp["sidecar_control_state_seat"].asObj()!!
        val root = seat["root"].asObj()!!
        val rootId = JsOps.num(root["netId"])!!
        val b = ControlBaselines()
        val got = rows(seat["rows"]).flatMap { r ->
          val n = hex(r).length * 4
          (0 until 8).map { i -> (n - i).toDouble() }.map { k -> S(ControlState.decodeControlState(hex(r), k, Ctx(
            classOf = { id -> if (id == rootId + 1) "Seat" else null },
            seatOf = { id -> if (id == rootId + 1) o("root" to rootId, "seat" to 1.0, "tmpl" to root["tmpl"]) else null }, baselines = b))) }
        }
        check("$level seat", want["seat"], got)
      }
      run {
        val r = cs.first { ControlState.decodeControlState(hex(it), bits(it), soldierCtx(ControlBaselines()))["isDelta"] == false }
        val buf = fromHex(hex(r)); buf[4] = (buf[4].toInt() or 1).toByte()
        val h = buf.hex()
        check("$level hit", want["hit"], listOf(bits(r), bits(r) - 40, 60.0, 33.0, 20.0).map { k -> tryS { ControlState.decodeControlState(h, k, soldierCtx(ControlBaselines())) } })
        check("$level liveHits", want["liveHits"], rows(inp["sidecar_control_state_hit"].g("shooterStates")).map { S(ControlState.decodeControlState(hex(it), bits(it), soldierCtx(ControlBaselines()))) })
      }
      run {
        val got = rows(inp["sidecar_block_reference"]).flatMap { x ->
          val rec = x["rec"].asObj()!!
          listOf(tryS { Pco.decodePcoBody(rec["hex"] as String, JsOps.num(rec["bodyBits"]), o("template" to x["t"], "strict" to false, "ref" to rec["ref"])) },
            tryS { Pco.decodePcoBody(rec["hex"] as String, JsOps.num(rec["bodyBits"]), o("template" to x["t"], "strict" to false)) })
        }
        check("$level blockRef", want["blockRef"], got)
      }
      check("$level other", want["other"], listOf(tryS { ControlState.decodeControlState(hex(cs[0]), bits(cs[0]), Ctx()) },
        tryS { ControlState.decodeControlState(hex(cs[1]), bits(cs[1]), Ctx(classOf = { "KitNetworkable" })) }))
    }
    val fix = inp["sidecar_derived_children"].asObj()!!
    val wake = TemplateTable.levelTemplates("bf1942", "wake", "coop")
    val alamein = TemplateTable.levelTemplates("bf1942", "el_alamein", "coop")
    fun levelOf(k: String) = if ((fix["source"].g(k) as? String ?: "").startsWith("el_alamein")) alamein else wake
    for ((t, rs) in fix["hulls"].asObj()!!) {
      Children.useLevelTemplates(levelOf(t), t)
      val h = Children.hullFor(t)!!
      check("hull $t", fx["hulls"].g(t), rows(rs).map { r ->
        tryS {
          val opts = o("template" to t)
          if (JsOps.truthy(r["ref"])) opts["ref"] = r["ref"]
          opts["maxHp"] = h["maxHp"]; opts["mobile"] = h["mobile"] != false; opts["strict"] = true
          Pco.decodePcoBody(hex(r), bits(r), opts)
        }
      })
    }
    for ((k, rs) in fix["seats"].asObj()!!) {
      val (t, i) = k.split("+")
      Children.useLevelTemplates(levelOf(k), k)
      val spec = Children.seatSpecFor(t, i.toDouble())
      check("seat $k", fx["seats"].g(k), rows(rs).map { r -> if (spec != null) tryS { Pco.decodeSeatBody(hex(r), bits(r), spec, o("strict" to true)) } else "null" })
    }
    Children.useLevelTemplates(alamein, "el_alamein")
    run {
      val c = fix["control"].asObj()!!
      val b = ControlBaselines()
      check("alameinControl", fx["alameinControl"], rows(c["rows"]).map { S(ControlState.decodeControlState(hex(it), bits(it), Ctx(classOf = { "SimpleObjectNetworkable" }, templateOf = { c["template"] }, baselines = b))) })
    }
    assertEquals(bad.take(10).joinToString("\n"), 0, bad.size)
  }
}
