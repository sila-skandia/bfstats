package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/verify.mjs (its library half;
// the command line that imports a decoder module by path is Node's alone);
// keep in step.
//
// Strict verification of a ghost-body decoder against the framed corpus.
//
// A class decoder is correct when, for every record of the objects it claims,
// the read completes without running past the end AND stops on exactly the
// last bit. Two numbers, both required:
//
//   threw   the read ran past the body (BitReader underflow) or the decoder
//           raised. A decoder that catches its own underflow hides this.
//   over    the read completed but stopped short of the end, or past it.

import io.bfstats.sidecar.JsOps
import io.bfstats.sidecar.g

object Verify {
  class Rec(val netId: Any?, val bodyBits: Double, val hex: String?, val tick: Any?, val seq: Any?)

  /** The review log's action-1 ghost records. */
  fun loadCorpus(text: String): List<Rec> {
    val out = ArrayList<Rec>()
    for (line in text.split("\n")) {
      if (line.isEmpty()) continue
      val j = try { JsOps.parse(line) } catch (e: Exception) { continue }
      if (j.g("tag") != "ghost-record" || !JsOps.eq(j.g("action"), 1.0) || JsOps.nullish(j.g("bodyBits"))) continue
      out.add(Rec(j.g("netId"), JsOps.toNumber(j.g("bodyBits")), j.g("hex") as? String, j.g("tick"), j.g("seq")))
    }
    return out
  }

  /** netId -> template name, from a recording's k:"o" records and createObject events. */
  fun loadNames(text: String): MutableMap<Any?, Any?> {
    val tmpl = LinkedHashMap<Any?, Any?>()
    for (line in text.split("\n")) {
      if (line.isEmpty()) continue
      val j = try { JsOps.parse(line) } catch (e: Exception) { continue }
      if (j.g("k") == "o") tmpl[JsOps.key(j.g("id"))] = j.g("tmpl").let { if (JsOps.truthy(it)) it else "" }
      else if (j.g("k") == "e" && j.g("e") == "createObject" && JsOps.truthy(j.g("tmpl"))) tmpl[JsOps.key(j.g("netId"))] = j.g("tmpl")
    }
    return tmpl
  }

  private const val INSANE_ABS = 100000.0
  private val KEYS = listOf("records", "strict", "over", "under", "threw", "insane")

  /** Run a decoder over the corpus: { byNetId: netId -> counts, totals }. */
  fun verifyDecoder(decode: (String?, Double?, Map<String, Any?>) -> Map<String, Any?>?, corpus: List<Rec>, opts: Map<String, Any?> = emptyMap()): Pair<LinkedHashMap<Any?, MutableMap<String, Any?>>, MutableMap<String, Any?>> {
    val byNetId = LinkedHashMap<Any?, MutableMap<String, Any?>>()
    fun inc(e: MutableMap<String, Any?>, k: String, by: Double = 1.0) { e[k] = (e[k] as Double) + by }
    for (rec in corpus) {
      val k = JsOps.key(rec.netId)
      val e = byNetId[k] ?: linkedMapOf<String, Any?>("records" to 0.0, "strict" to 0.0, "over" to 0.0, "under" to 0.0, "threw" to 0.0, "insane" to 0.0, "bits" to 0.0)
      inc(e, "records"); inc(e, "bits", rec.bodyBits)
      val out: Map<String, Any?>?
      try {
        val o = LinkedHashMap(opts); o["strict"] = true
        out = decode(rec.hex, rec.bodyBits, o)
      } catch (x: RuntimeException) { inc(e, "threw"); byNetId[k] = e; continue }
      val consumed = JsOps.num(out?.get("consumed"))
      if (consumed == null) { inc(e, "threw"); byNetId[k] = e; continue }
      if (consumed == rec.bodyBits) inc(e, "strict") else if (consumed > rec.bodyBits) inc(e, "over") else inc(e, "under")
      val p = out?.get("pos") as? List<*>
      if (p != null && (!p.all { JsOps.isFiniteNum(it) } || p.any { Math.abs(JsOps.num(it) ?: 0.0) > INSANE_ABS })) inc(e, "insane")
      byNetId[k] = e
    }
    val totals = linkedMapOf<String, Any?>()
    for (key in KEYS) totals[key] = byNetId.values.sumOf { it[key] as Double }
    return byNetId to totals
  }

  /** netIds the decoder consumes cleanly on every record, with their template names. */
  fun claimedNetIds(byNetId: Map<Any?, Map<String, Any?>>, names: Map<Any?, Any?>?, minRecords: Int = 5): List<MutableMap<String, Any?>> {
    val out = ArrayList<MutableMap<String, Any?>>()
    for ((netId, e) in byNetId) {
      val n = e["records"] as Double
      if (n >= minRecords && e["strict"] == n) out.add(linkedMapOf("netId" to netId, "tmpl" to (names?.get(netId) ?: ""), "records" to n))
    }
    return out.sortedByDescending { it["records"] as Double }
  }
}
