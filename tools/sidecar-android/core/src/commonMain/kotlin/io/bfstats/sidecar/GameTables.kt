package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/game-tables.mjs; keep in step.
//
// The two tables a retail client builds from its own install, built the same
// way for the sidecar: the engine's animation state table (which sizes and
// names a soldier body's lower/upper state fields, SoldierGhost) and the
// level's control point names (template -> its setControlPointName word, the
// lexicon key the game prints).
//
// The Node copy runs bf42/game_tables.py (sidecar_tables.py) on the install
// and caches the answer under <cache>/<mod>/<level>-<mode>.json. The port reads
// that cache when one is there but never runs the Python (STUB: `run` is not
// ported; LevelTables.installCanCompute is always false), so on Android the
// tables are the published bake LevelTables.prepareLevel downloaded (memo ->
// the install's cache -> the download). A failure says so loudly and returns
// nulls; the callers then fall back to the recorded templates/<level>.json.


object GameTables {
  private val lock = Lock()
  private fun cacheDir(): FsFile = Paths.cacheDir()

  private val memo = HashMap<String, MutableMap<String, Any?>>()
  private val warned = HashSet<String>()
  private fun warnOnce(key: String, msg: String) {
    lock.withLock { if (!warned.add(key)) return }
    JsOps.consoleError("[game-tables] $msg")
  }

  private fun genEq(v: Map<String, Any?>): Boolean = v.containsKey("gen") && JsOps.eq(v["gen"], LevelTables.bakedGeneration().toDouble())

  /** { animStates: [[index, name, flags], ...] | null, cpNames: { template: word } | null }
   *  (plus the memo's own `downloaded` and `gen`, as the Node copy returns them). */
  fun gameTables(mod: Any?, level: Any? = null, mode: Any? = null, baked: Boolean = true): MutableMap<String, Any?> {
    if (!JsOps.truthy(mod)) {
      warnOnce("nomod", "no mod known (no ServerInfo seen): the animation and control point tables cannot be built")
      return linkedMapOf("animStates" to null, "cpNames" to null)
    }
    val m = JsOps.str(mod).lowercase()
    // The Node copy's `lv` is tested for truthiness: a level whose base is
    // empty ("/") is no level, as null is (anim.json, no download).
    val lv = if (JsOps.truthy(level)) TemplateTable.levelBase(level).ifEmpty { null } else null
    val md = TemplateTable.modeBase(mode)
    val key = "$m|${lv ?: ""}|$md"
    lock.withLock {
      // A miss looks again only at a download landed since.
      val hit = memo[key]
      // A downloaded table is read again when a newer copy has landed since.
      if (hit != null && JsOps.truthy(hit["downloaded"]) && !genEq(hit)) {
        val b = fromBaked(m, lv, md, key)
        if (b != null) { memo[key] = b; return b }
        hit["gen"] = LevelTables.bakedGeneration().toDouble()
      }
      if (hit != null && (JsOps.truthy(hit["animStates"]) || !baked || lv == null || genEq(hit))) return hit
      if (hit != null) {
        val b = fromBaked(m, lv, md, key)
        if (b != null) { memo[key] = b; return b }
        hit["gen"] = LevelTables.bakedGeneration().toDouble()
        return hit
      }

      val file = FsFile(FsFile(cacheDir(), TemplateTable.safe(m)), if (lv != null) "${TemplateTable.safe(lv)}-${TemplateTable.safe(md)}.json" else "anim.json")
      // memo -> the install's cache -> a downloaded bake -> the install itself.
      var value: MutableMap<String, Any?>? = TemplateTable.readCache(file)
      if (value == null && baked && lv != null) value = fromBaked(m, lv, md, key)
      if (value == null && !LevelTables.installCanCompute(m)) {
        warnOnce("none:$key", "no install can compute mod=$m${if (lv != null && baked) ", and no downloaded tables for $lv $md are in the cache (level-tables.mjs prepareLevel)" else ""}")
        value = linkedMapOf("animStates" to null, "cpNames" to null, "gen" to LevelTables.bakedGeneration().toDouble())
      }
      if (value == null) {
        // STUB: the Node copy runs sidecar_tables.py on the install here.
        value = linkedMapOf("animStates" to null, "cpNames" to null)
        warnOnce("run:$key", "could not build the tables for mod=$m${if (lv != null) " level=$lv mode=$md" else ""} from the install: the Kotlin sidecar does not run Python")
      }
      // Memoised either way.
      if (!JsOps.truthy(value["animStates"])) value["gen"] = LevelTables.bakedGeneration().toDouble()
      memo[key] = value
      return value
    }
  }

  private fun fromBaked(m: String, lv: String?, md: String, key: String): MutableMap<String, Any?>? {
    val j = LevelTables.readBaked(m, lv, md) ?: return null
    val anim = j["animStates"] as? List<*>
    if (anim.isNullOrEmpty()) return null
    JsOps.consoleLog("[game-tables] $m ${lv ?: "null"} $md: ${anim.size} animation states, ${(j["cpNames"] as? Map<*, *>)?.size ?: 0} control point names, from the downloaded tables")
    return linkedMapOf("animStates" to j["animStates"], "cpNames" to (if (JsOps.nullish(j["cpNames"])) null else j["cpNames"]),
      "downloaded" to true, "gen" to LevelTables.bakedGeneration().toDouble())
  }

  /** A control point's name under a template, whatever case the tid table spells it in. */
  fun cpNameOf(cpNames: Any?, tmpl: Any?): Any? {
    if (!JsOps.truthy(tmpl) || !JsOps.truthy(cpNames)) return Undefined
    val m = cpNames.asObj() ?: return Undefined
    val t = JsOps.str(tmpl)
    if (!JsOps.nullish(JsOps.get(m, t))) return m[t]
    val want = t.lowercase()
    for ((k, v) in m) if (k.lowercase() == want) return v
    return Undefined
  }

  /** Forget the memo and the warnings (tests; a fresh Node process). */
  fun reset() { lock.withLock { memo.clear() }; lock.withLock { warned.clear() } }
}
