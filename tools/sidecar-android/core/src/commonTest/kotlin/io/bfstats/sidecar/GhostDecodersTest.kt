package io.bfstats.sidecar

import io.bfstats.sidecar.ghost.Children
import io.bfstats.sidecar.ghost.ControlPoint
import io.bfstats.sidecar.ghost.Engine
import io.bfstats.sidecar.ghost.Firearms
import io.bfstats.sidecar.ghost.FreeCamera
import io.bfstats.sidecar.ghost.Item
import io.bfstats.sidecar.ghost.Kit
import io.bfstats.sidecar.ghost.Objective
import io.bfstats.sidecar.ghost.Pco
import io.bfstats.sidecar.ghost.Player
import io.bfstats.sidecar.ghost.Projectile
import io.bfstats.sidecar.ghost.RotationalBundle
import io.bfstats.sidecar.ghost.ScoreManager
import io.bfstats.sidecar.ghost.SimpleObject
import io.bfstats.sidecar.ghost.SpawnManager
import io.bfstats.sidecar.ghost.Spring
import io.bfstats.sidecar.ghost.Verify
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Every ghost body decoder against the Node copy (parity/ghost-decoders.mjs). */
class GhostDecodersTest {
  private val fx by lazy { Fixtures.json("ghost-decoders.json.gz").asObj()!! }
  private val REF = listOf<Any?>(870.0, 97.0, 873.0)
  private fun o(vararg p: Pair<String, Any?>) = linkedMapOf(*p)
  private fun l(vararg v: Any?) = mutableListOf(*v)

  private val SETS: Map<String, (String?, Double?) -> Any?> = linkedMapOf(
    "soldier" to { h, b -> SoldierGhost.decodeSoldierBody(h, b, o()) },
    "soldier_anim" to { h, b -> SoldierGhost.decodeSoldierBody(h, b, o("animStates" to 1395.0)) },
    "soldier_wide" to { h, b -> SoldierGhost.decodeSoldierBody(h, b, o("animStates" to 2000.0, "maxHp" to 100.0, "aimPitchLimit" to 30.0, "aimTwistLimit" to 10.0, "baselinePos" to REF)) },
    "soldier_base" to { h, b -> SoldierGhost.decodeSoldierBody(h, b, o("animStates" to 1395.0, "quatBits" to 32.0, "baseline" to o("pos" to l(1.0, 2.0, 3.0), "vel" to l(0.1, 0.2, 0.3), "vecA" to null))) },
    "soldier_strict" to { h, b -> SoldierGhost.decodeSoldierBody(h, b, o("animStates" to 1395.0, "strict" to true)) },
    "player" to { h, b -> Player.decodePlayerBody(h, b, o("strict" to false)) },
    "cp" to { h, b -> ControlPoint.decodeControlPointBody(h, b, o()) },
    "kit" to { h, b -> Kit.decodeKitBody(h, b, o("strict" to false)) },
    "kit_strict" to { h, b -> Kit.decodeKitBody(h, b, o("strict" to true)) },
    "projectile" to { h, b -> Projectile.decodeProjectileBody(h, b, o("ref" to REF, "strict" to false)) },
    "projectile_strict" to { h, b -> Projectile.decodeProjectileBody(h, b, o("strict" to true)) },
    "engine" to { h, b -> Engine.decodeEngineBody(h, b, o()) },
    "engine_gears" to { h, b -> Engine.decodeEngineBody(h, b, o("numGears" to 2.0, "strict" to true)) },
    "firearms" to { h, b -> Firearms.decodeFireArmsBody(h, b, o("magA" to 30.0, "magB" to 4.0)) },
    "firearms_strict" to { h, b -> Firearms.decodeFireArmsBody(h, b, o("strict" to true)) },
    "freecam" to { h, b -> FreeCamera.decodeFreeCameraBody(h, b, o("baselinePos" to REF)) },
    "item" to { h, b -> Item.decodeItemBody(h, b, o("strict" to false)) },
    "objective" to { h, b -> Objective.decodeObjectiveBody(h, b, o()) },
    "rotational" to { h, b -> RotationalBundle.decodeRotationalBundleBody(h, b, o("rateLimits" to l(2.0, 3.0, 4.0))) },
    "simple" to { h, b -> SimpleObject.decodeSimpleObjectBody(h, b, o("maxHp" to 50.0, "quatBits" to 16.0)) },
    "simple_full" to { h, b -> SimpleObject.decodeSimpleObjectBody(h, b, o("fullQuat" to false, "baselinePos" to REF, "strict" to true)) },
    "spring" to { h, b -> Spring.decodeSpringBody(h, b, o("refA" to REF)) },
    "score" to { h, b -> o("looks" to ScoreManager.looksLikeScoreBody(h, b), "body" to ScoreManager.decodeScoreBody(h, b)) },
    "spawn" to { h, b -> val n = SpawnManager.looksLikeSpawnManagerBody(h, b); o("n" to n.toDouble(), "body" to SpawnManager.decodeSpawnManagerBody(h, b, if (n != 0) n.toDouble() else 24.0)) },
    "pco_m3a1" to { h, b -> Pco.decodePcoBody(h, b, o("template" to "M3A1", "strict" to false)) },
    "pco_sherman_ref" to { h, b -> Pco.decodePcoBody(h, b, o("template" to "Sherman", "strict" to false, "ref" to REF, "maxHp" to 120.0, "mobile" to true)) },
    "pco_auto" to { h, b -> Pco.decodePcoBody(h, b, o("strict" to false)) },
    "pco_children" to { h, b -> Pco.decodePcoBody(h, b, o("children" to l("E", "S", "R", "O", "F"), "mags" to l(l(5.0, 3.0)), "objects" to l(o("hpBits" to 4.0, "mobile" to false)), "strict" to false)) },
    "pco_strict" to { h, b -> Pco.decodePcoBody(h, b, o("template" to "Zero", "strict" to true, "quatBits" to 32.0)) },
    "pco_control_bases" to { h, b -> Pco.decodePcoBody(h, b, o("children" to l("O", "O"), "objects" to l(o("hpBits" to 4.0), o("hpBits" to 4.0)), "strict" to false,
      "control" to o("ref" to REF, "bases" to l(o("pos" to l(1.0, 2.0, 3.0)), o("pos" to l(100.0, 200.0, 300.0)), o("pos" to l(-5.0, -6.0, -7.0)))))) },
    "seat_m3a1" to { h, b -> Pco.decodeSeatBody(h, b, Children.seatSpecFor("M3A1", 1.0)!!, o("strict" to false)) },
  )

  private class Ran(val json: String?, val threw: String?)
  private fun run(f: (String?, Double?) -> Any?, h: String?, b: Double?): Ran = try {
    Ran(Js.stringify(linkedMapOf("ok" to f(h, b))), null)
  } catch (e: RuntimeException) { Ran(null, e.message ?: e.toString()) }

  /** A throw matches a throw; the underflow's message must match too. */
  private fun same(want: String, got: Ran): Boolean {
    val w = JsOps.parse(want).asObj()!!
    if (w.containsKey("threw")) return got.threw != null && (w["threw"] != "BitReader underflow" || got.threw == "BitReader underflow")
    return got.json == want
  }

  @Test fun everyDecoderReadsAsNodeDoes() {
    Fixtures.freshCache(false)
    val records = (fx["records"] as List<*>).map { it as List<*> }
    val decoded = fx["decoded"].asObj()!!
    val bad = ArrayList<String>()
    assertEquals(SETS.keys.toList(), decoded.keys.toList())
    for ((name, f) in SETS) {
      val want = decoded[name] as List<*>
      records.forEachIndexed { i, r ->
        val got = run(f, r[0] as String, JsOps.num(r[1]))
        if (!same(want[i] as String, got) && bad.size < 20) bad += "$name #$i (${r[0]}, ${r[1]}):\n  node:   ${(want[i] as String).take(400)}\n  kotlin: ${(got.json ?: "threw ${got.threw}").take(400)}"
      }
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }

  @Test fun verifyCensusMatchesOverTheWholeCorpus() {
    Fixtures.freshCache(false)
    val corpus = (fx["logs"] as List<*>).flatMap { Verify.loadCorpus(Fixtures.text("rebuild/$it.review.ndjson.gz")) }
    assertEquals(fx["corpusSize"], corpus.size.toDouble())
    val census = fx["census"].asObj()!!
    val bad = ArrayList<String>()
    for ((name, want) in census) {
      val f = SETS[name]!!
      val (byNetId, totals) = Verify.verifyDecoder({ h, b, _ -> f(h, b).asObj() }, corpus)
      val got = linkedMapOf("totals" to totals, "byNetId" to byNetId.entries.map { listOf(it.key, it.value) },
        "claimed" to Verify.claimedNetIds(byNetId, emptyMap()))
      if (Js.stringify(got) != Js.stringify(want)) bad += "$name: node ${Js.stringify(want.g("totals"))} kotlin ${Js.stringify(totals)}"
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }

  @Test fun rotationalBundleLengths() {
    val want = Js.stringify(fx["misc"].g("rotationalBits"))
    assertEquals(want, Js.stringify((0 until 130).map { RotationalBundle.rotationalBundleBodyBits(it).toDouble() }))
  }
}
