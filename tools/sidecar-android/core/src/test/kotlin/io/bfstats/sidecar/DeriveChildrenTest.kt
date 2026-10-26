package io.bfstats.sidecar

import io.bfstats.sidecar.ghost.DeriveChildren
import org.junit.Assert.assertEquals
import org.junit.Test

/** deriveLevel and the walk against derive-children.mjs (parity/derive-children.mjs). */
class DeriveChildrenTest {
  @Test fun everyLevelDerivesAsNodeDoes() {
    val fx = Parity.json("derive-children.json.gz").asObj()!!
    for ((key, want) in fx) {
      val graph = Parity.json("graphs/$key.graph.json.gz")
      assertEquals(key, want.g("derived"), Js.stringify(DeriveChildren.deriveLevel(graph)))
      val g = DeriveChildren.graphFromJson(graph)
      val walks = LinkedHashMap<String, Any?>()
      for (t in g.templates.values) {
        if (t.cls != "playercontrolobject") continue
        val w = DeriveChildren.walk(g, t.name)!!
        walks[t.name] = linkedMapOf(
          "nodes" to w.nodes.map { listOf(it.letter, it.name, it.members, it.groupedWith) },
          "seats" to w.seats.map { s -> listOf(s.name, s.nodes.map { it.name }) },
          "missing" to w.missing, "armor" to DeriveChildren.armorMax(w.root),
        )
      }
      assertEquals("$key walks", want.g("walks"), Js.stringify(JsOps.jsOrder(walks)))
    }
  }
}
