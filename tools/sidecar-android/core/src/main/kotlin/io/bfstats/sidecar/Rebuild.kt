package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/rebuild.mjs; keep in step.
//
// Rebuild a sidecar recording from its own event rows and its review log,
// with today's decoders: the same body decoding (BodyDecoder) and the same
// ghost rows (GhostWriter) the live sidecar writes.
//
//   Rebuild.main(run.ndjson, run.review.ndjson, run.rebuilt.ndjson [--ref x,y,z])
//
// --ref: the compression reference for records whose review row carries none
// (logs written before 2026-10-16). Every ghost block opened with the
// sidecar's control state, whose root position is that reference; a sidecar
// that never spawned sat on its free camera, Wake's at 870,97,873.
//
// The event rows (k:"h", k:"anim", k:"e") are kept as they were; every ghost
// row (k:"o", k:"d", k:"s", k:"st", k:"a", k:"f") is written again from the
// review log's framed records. The review log's clock (`dt`) is the
// recording's own within a few milliseconds.
//
// The level tables are read from the cache (Paths.cacheDir): a desktop
// install's computed tables or a downloaded bake, as in Node. A line JSON.parse
// would make a non-object (a bare number, null) is skipped here, where Node
// keeps a number as a row and stops on null.

import io.bfstats.sidecar.JsOps.nullish
import io.bfstats.sidecar.JsOps.truthy
import io.bfstats.sidecar.ghost.Children
import java.io.File
import kotlin.system.exitProcess

object Rebuild {
  private val GHOST_KINDS = setOf("o", "d", "s", "st", "a", "f", "j", "jn", "tk", "win", "ps")
  // Event rows the ghost writer derives (an exit's hand-back of the soldier)
  // are written again too, so a recording already rebuilt does not carry two.
  private fun derived(r: Map<String, Any?>) = r.g("k") == "e" &&
    (truthy(r.g("derived")) || r.g("e") == "cp" || r.g("e") == "detonate" || r.g("e") == "spawnGroups")

  class Result(val rows: List<Any?>, val stats: MutableMap<String, Any?>) {
    /** The file Node writes: one JSON line a row, and a final newline. */
    fun text(): String = rows.joinToString("\n") { Js.stringify(it) } + "\n"
    /** What Node prints when done. */
    fun summary(): String = Js.stringify(stats)
  }

  private class Entry(val t: Any?, val order: Int, val kind: String, val payload: Any?)
  private class Block(val t: Any?, val tick: Any?, val records: MutableList<MutableMap<String, Any?>>)

  private fun parseLine(l: String): MutableMap<String, Any?>? = try { JsOps.parse(l).asObj() } catch (e: Exception) { null }

  /** Rebuild from the two files' text. `defaultRef` is --ref. */
  fun rebuild(recText: String, reviewText: String, defaultRef: List<Double>? = null): Result {
    val head = ArrayList<MutableMap<String, Any?>>()
    val timeline = ArrayList<Entry>()
    var animStates = 0.0
    for (l in recText.split("\n")) {
      if (l.isEmpty()) continue
      val r = parseLine(l) ?: continue
      if (r.g("k") == "h") { head.add(r); continue }
      if (r.g("k") == "anim") { head.add(r); animStates = (r.g("states") as? List<*>)?.size?.toDouble() ?: 0.0; continue }
      if (r.g("k").let { it is String && it in GHOST_KINDS } || derived(r)) continue
      timeline.add(Entry(JsOps.coalesce(r.g("t")) { 0.0 }, 0, "row", r))
    }
    // Group the review log's framed records back into their ghost blocks: a
    // block is a run of one seq:tick (the tick restarts at 0 with a level
    // load or a round restart; Wake co-op, 2026-10-16, 65 pairs).
    var block: Block? = null
    var blockKey: String? = null
    for (l in reviewText.split("\n")) {
      if (l.isEmpty()) continue
      val d = parseLine(l) ?: continue
      if (d.g("tag") != "ghost-record") continue
      val key = "${JsOps.str(d.g("seq"))}:${JsOps.str(d.g("tick"))}"
      if (key != blockKey) { blockKey = key; block = Block(d.g("dt"), d.g("tick"), ArrayList()); timeline.add(Entry(d.g("dt"), 1, "block", block)) }
      val rec = linkedMapOf("netId" to d.g("netId"), "action" to d.g("action"), "bodyBits" to d.g("bodyBits"), "hex" to d.g("hex"))
      if (truthy(d.g("ref"))) rec["ref"] = d.g("ref") else if (defaultRef != null) rec["ref"] = defaultRef.toMutableList<Any?>()
      block!!.records.add(rec)
    }
    timeline.sortWith { a, b ->
      val d0 = JsOps.toNumber(a.t) - JsOps.toNumber(b.t)
      if (d0 != 0.0 && !d0.isNaN()) (if (d0 < 0) -1 else 1) else a.order.compareTo(b.order)
    }

    // A recording made without --names has blank templates: fill them from
    // the level's tables, and add the animation table if the run had none.
    val rowsOf = timeline.asSequence().filter { it.kind == "row" }.map { it.payload as MutableMap<String, Any?> }
    val setLevel = rowsOf.find { it.g("e") == "setLevel" }
    val level = setLevel.g("level").let { if (setLevel == null) Undefined else it }
    val mod = rowsOf.find { it.g("e") == "serverInfo" && truthy(it.g("mod")) }?.g("mod")
    val mode = if (setLevel == null) Undefined else setLevel.g("mode")
    val auto = Names.namesForLevel(level, mod, mode)
    val g = GameTables.gameTables(mod, level, mode)
    if (truthy(g["cpNames"])) auto["cpNames"] = g["cpNames"]
    if (truthy(g["animStates"])) auto["animStates"] = g["animStates"]
    for (r in rowsOf) {
      if (r.g("k") != "e" || truthy(r.g("tmpl")) || nullish(r.g("tid"))) continue
      if (r.g("e") == "createObject" || r.g("e") == "projPool") {
        val name = JsOps.at(auto["tidNames"], r.g("tid"))
        if (truthy(name)) r["tmpl"] = name
      }
    }
    if (animStates == 0.0 && truthy(auto["animStates"])) {
      animStates = (auto["animStates"] as List<*>).size.toDouble()
      head.add(linkedMapOf("k" to "anim", "t" to 0.0, "states" to auto["animStates"]))
    }

    val out = ArrayList<Any?>(head)
    val objInfo = HashMap<Any?, MutableMap<String, Any?>>()
    val pidTeam = HashMap<Any?, Any?>()
    val bodies = BodyDecoder(linkedMapOf("animStates" to animStates))
    val animTable = head.lastOrNull { it.g("k") == "anim" }?.g("states").let { if (nullish(it)) null else it }
    val ghosts = GhostWriter({ out.add(it) }, objInfo, auto["cpNames"], GhostRows.animNamer { animTable })
    for (en in timeline) {
      val t = en.t
      if (en.kind == "row") {
        val x = en.payload as MutableMap<String, Any?>
        out.add(x)
        if (x.g("k") != "e") continue
        bodies.note(x)
        for (e in ghosts.note(x, t)) {
          val row = linkedMapOf<String, Any?>("k" to "e", "t" to x.g("t"))
          row.putAll(e)
          out.add(row)
          bodies.note(row)
          ghosts.note(row, t)
        }
        val e = x.g("e")
        if (e == "createPlayer") pidTeam[JsOps.key(x.g("pid"))] = x.g("team")
        if (e == "createObject" && !nullish(x.g("netId"))) objInfo[JsOps.key(x.g("netId"))] =
          linkedMapOf("tid" to x.g("tid"), "tmpl" to (if (truthy(x.g("tmpl"))) x.g("tmpl") else ""), "team" to 0.0)
        if (e == "control" && objInfo.containsKey(JsOps.key(x.g("netId")))) objInfo[JsOps.key(x.g("netId"))]!!["team"] = pidTeam[JsOps.key(x.g("pid"))].let { if (nullish(it)) 0.0 else it }
        continue
      }
      val b = en.payload as Block
      for (r in b.records) if (r.g("action").let { it is Double && it == 1.0 } && truthy(r.g("hex"))) {
        try { bodies.decode(r) } catch (e: RuntimeException) { /* stays raw */ }
      }
      ghosts.block(JsOps.toFixed(JsOps.toNumber(t), 3), b.records, b.tick)
    }
    val stats = linkedMapOf<String, Any?>("rows" to out.size.toDouble())
    stats.putAll(ghosts.stats)
    return Result(out, stats)
  }

  /** Forget every module's level and memo, as a fresh Node process starts. */
  fun resetModuleState() {
    Children.reset(); TemplateTable.reset(); GameTables.reset(); Names.reset(); SoldierGhost.reset(); LevelTables.resetProcessState()
  }

  @JvmStatic fun main(args: Array<String>) {
    val argv = args.toMutableList()
    val refAt = argv.indexOf("--ref")
    val defaultRef = if (refAt >= 0) { val v = argv[refAt + 1]; argv.removeAt(refAt); argv.removeAt(refAt); v.split(",").map { JsOps.toNumber(it) } } else null
    if (argv.size < 3) {
      System.err.println("usage: Rebuild run.ndjson run.review.ndjson out.ndjson")
      exitProcess(2)
    }
    val res = rebuild(File(argv[0]).readText(), File(argv[1]).readText(), defaultRef)
    File(argv[2]).writeText(res.text())
    println(res.summary())
  }
}
