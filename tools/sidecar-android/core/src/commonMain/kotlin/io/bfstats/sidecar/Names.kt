package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/names.mjs; keep in step.
//
// Resolve a ghost object's template name from its numeric template id.
//
// The wire carries only `tid` (the server's template load order); the name
// that selects a model is not on the wire: the real client reads it from the
// template table its own level load built. namesForLevel takes that table from
// TemplateTable. The recorded sources below are the fallback and the test
// fixtures:
//   - a bf42plus recording (.ndjson): its createObject/`k:"o"` lines carry both
//     tid and the resolved tmpl, so a tid->name map falls straight out;
//   - a saved map (.json): { level, mod, tidNames: { "<tid>": "<name>" } }.
// The saved maps (sidecar/templates/<level>.json) are classpath resources here.

import kotlin.concurrent.Volatile

object Names {
  private val lock = Lock()
  /** tid -> name (and the anim and control point tables) lifted from a recording. */
  fun tidNamesFromRecording(text: String): MutableMap<String, Any?> {
    val tidNames = LinkedHashMap<String, Any?>()
    val cpNames = LinkedHashMap<String, Any?>()
    var level: Any? = ""
    var mod: Any? = ""
    var animStates: Any? = null
    for (line in text.trim().split("\n")) {
      val r = try { JsOps.parse(line) } catch (e: Exception) { continue }
      if (r.g("e") == "setLevel") level = r.g("level").let { if (JsOps.truthy(it)) it else level }
      if (r.g("e") == "serverInfo" && JsOps.truthy(r.g("mod"))) mod = r.g("mod")
      if ((r.g("e") == "createObject" || r.g("k") == "o") && !JsOps.nullish(r.g("tid")) && JsOps.truthy(r.g("tmpl"))) tidNames[JsOps.str(r.g("tid"))] = r.g("tmpl")
      if (r.g("k") == "anim" && r.g("states") is List<*> && !JsOps.truthy(animStates)) animStates = r.g("states")
      // A client names each control point as the game prints it; the wire
      // carries only the template.
      if (r.g("k") == "cp" && JsOps.truthy(r.g("tmpl")) && JsOps.truthy(r.g("name"))) cpNames[JsOps.str(r.g("tmpl"))] = r.g("name")
    }
    return linkedMapOf("level" to level, "mod" to mod, "tidNames" to JsOps.jsOrder(tidNames), "animStates" to animStates, "cpNames" to JsOps.jsOrder(cpNames))
  }

  /** Load a tid->name source from its text: a .json map or a .ndjson recording. */
  fun tidNamesFromText(text: String): MutableMap<String, Any?> {
    val first = text.take(200).trimStart()
    if (first.startsWith("{") && first.contains("\"tidNames\"")) {
      val j = JsOps.parse(text)
      fun or(k: String, d: Any?) = j.g(k).let { if (JsOps.truthy(it)) it else d }
      return linkedMapOf("level" to or("level", ""), "mod" to or("mod", ""), "tidNames" to or("tidNames", LinkedHashMap<String, Any?>()),
        "animStates" to or("animStates", null), "cpNames" to or("cpNames", LinkedHashMap<String, Any?>()))
    }
    return tidNamesFromRecording(text)
  }

  /** Load a tid->name source: a .json map or a .ndjson recording. */
  fun loadTidNames(path: FsFile): MutableMap<String, Any?> = tidNamesFromText(path.readText())

  private val fellBack = HashSet<String>()

  /** A level's tid -> template name table, and each tid's template class:
   *  the computed table first, else (loudly) the saved map for the level. */
  fun namesForLevel(level: Any?, mod: Any? = null, mode: Any? = null): MutableMap<String, Any?> {
    val base = JsOps.str(if (JsOps.truthy(level)) level else "").replace(Regex("/+\\z"), "").split("/").last().lowercase()
    val own = if (base.isNotEmpty()) savedMap(base) else null
    val computed = if (base.isNotEmpty()) TemplateTable.templateTable(mod, level, mode) else null
    if (computed != null) {
      return linkedMapOf("tidNames" to computed["tidNames"], "tidClasses" to computed["tidClasses"],
        "animStates" to (own?.get("animStates").let { if (JsOps.nullish(it)) null else it }),
        "cpNames" to (own?.get("cpNames").let { if (JsOps.nullish(it)) LinkedHashMap<String, Any?>() else it }), "computed" to true)
    }
    val fk = "${JsOps.str(mod)}|$base|${JsOps.str(mode)}"
    if (base.isNotEmpty() && lock.withLock { fellBack.add(fk) }) {
      JsOps.consoleError("[names] FALLBACK: the template ids for $base (mod=${if (JsOps.nullish(mod)) "?" else JsOps.str(mod)} mode=${if (JsOps.nullish(mode)) "?" else JsOps.str(mode)}) could not be computed from the install; naming objects from the recorded table templates/$base.json${if (own != null) " (${(own["tidNames"] as Map<*, *>).size} ids)" else " (none: only Wake's borrowed names)"}")
    }
    val wake = wakeNames()
    // A tid is the level's own load order, so Wake's names hold on another
    // level only when its own known tids agree with Wake's on every one they
    // share: Midway does, 25 of 25, El Alamein does not.
    var borrow = base == "wake" || base.isEmpty()
    if (!borrow && own != null) {
      val ownNames = own["tidNames"].asObj()!!
      val shared = ownNames.keys.filter { JsOps.truthy(wake[it]) }
      borrow = shared.size >= 10 && shared.all { JsOps.eq(wake[it], ownNames[it]) }
    }
    val lent = LinkedHashMap<String, Any?>()
    if (borrow) for ((tid, name) in wake) if (base == "wake" || base.isEmpty() || !WAKE_OWN.contains(name)) lent[tid] = name
    val tidNames = JsOps.spread(lent, own?.get("tidNames").asObj())
    val anim = own?.get("animStates").let { if (!JsOps.nullish(it)) it else if (borrow) wakeAnim() else null }
    return linkedMapOf("tidNames" to tidNames, "tidClasses" to null, "animStates" to anim,
      "cpNames" to (own?.get("cpNames").let { if (JsOps.nullish(it)) LinkedHashMap<String, Any?>() else it }), "computed" to false)
  }

  private val savedMaps = HashMap<String, MutableMap<String, Any?>?>()
  private fun savedMap(base: String): MutableMap<String, Any?>? = lock.withLock {
    savedMaps.getOrPut(base) {
      try {
        EmbeddedResources.text("sidecar/templates/$base.json")?.let { tidNamesFromText(it) }
      } catch (e: Exception) { null }
    }?.let { JsOps.deepCopy(it).asObj() }
  }

  @Volatile private var WAKE: Pair<Map<String, Any?>, Any?>? = null
  @Volatile private var WAKE_OWN: Set<Any?> = emptySet()
  private fun wakeNames(): Map<String, Any?> {
    WAKE?.let { return it.first }
    val w = savedMap("wake")
    val names = LinkedHashMap<String, Any?>(w?.get("tidNames").asObj() ?: emptyMap())
    // A level's own templates (its control points) load after the shared ones
    // and are never another level's: they are not lent.
    WAKE_OWN = (w?.get("cpNames").asObj()?.keys ?: emptySet<String>()).toHashSet()
    WAKE = names to w?.get("animStates").let { if (JsOps.nullish(it)) null else it }
    return names
  }
  private fun wakeAnim(): Any? { wakeNames(); return WAKE!!.second }

  /** Forget the once-only fallback lines (tests; a fresh Node process). */
  fun reset() { lock.withLock { fellBack.clear() } }
}
