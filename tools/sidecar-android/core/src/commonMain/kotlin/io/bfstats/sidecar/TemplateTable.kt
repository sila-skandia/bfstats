package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/template-table.mjs; keep in step.
//
// The level's object template table, as the retail client and server build it:
// each template id's name and class, for naming and classing the tid every
// CreateObject carries (wire.md, "Template ids", "Template classes"), and what
// the level's ghost bodies take from its templates (every hull's child
// networkables and widths, its hit points, mobility and turning parts, and
// every soldier's hit points and aim limits).
//
// A tid is the template's place in the order the level load first created
// each name (ObjectTemplateManager::createTemplate, lnxded 0x081d5a30, client
// 0x0056db00), so the table is a function of mod, level and game type.
//
// The Node copy computes it from the install (bf42/template_table.py through
// sidecar_tid_table.py --graph, then ghost/derive-children deriveLevel) and
// caches it under <cache>/<mod>/<level>-<mode>.tids.json. The port reads that
// cache when a desktop install wrote it, but never runs the Python (STUB:
// `fromInstall` reads the cache only; Paths.pythonAvailable says no), so on
// Android the value is the published bake that LevelTables.prepareLevel
// downloads into the cache. A lookup resolves memo -> the install's cached
// table -> the downloaded one.
//
// A failure says so loudly and returns null; Names then falls back to the
// recorded tables in templates/<level>.json and Children to the vanilla
// hulls.json / ghost/derived-specs.json.


object TemplateTable {
  private val lock = Lock()
  private fun cacheDir(): FsFile = Paths.cacheDir()

  private class Memo(val value: MutableMap<String, Any?>?, val baked: Boolean, val gen: Int)
  private val memo = HashMap<String, Memo>()
  private val warned = HashSet<String>()
  private fun warnOnce(key: String, msg: String) {
    lock.withLock { if (!warned.add(key)) return }
    JsOps.consoleError("[template-table] $msg")
  }

  private val TRAIL = Regex("[\\\\/]+$")
  private val SEP = Regex("[\\\\/]")
  fun levelBase(level: Any?): String = JsOps.str(if (JsOps.truthy(level)) level else "").replace(TRAIL, "").split(SEP).last().lowercase()
  fun modeBase(mode: Any?): String = JsOps.str(if (JsOps.truthy(mode)) mode else "conquest.con").lowercase().replace(Regex("\\.con$"), "")
  fun safe(s: String): String = s.replace(Regex("[^a-z0-9_.-]+", RegexOption.IGNORE_CASE), "_")

  /** [path, size, round(mtimeMs)] per input, as fs.statSync gives them. */
  fun fingerprint(inputs: List<String>): MutableList<Any?> = inputs.mapTo(ArrayList()) { p ->
    val f = FsFile(p)
    if (!f.exists()) throw kotlinx.io.files.FileNotFoundException(p)
    mutableListOf<Any?>(p, f.length().toDouble(), f.lastModified().toDouble())
  }

  /** A cache file's value while its inputs are unchanged, else null. */
  fun readCache(file: FsFile): MutableMap<String, Any?>? = try {
    val j = JsOps.parse(file.readText())
    val inputs = j.g("inputs").asList()!!
    if (Js.stringify(fingerprint(inputs.map { it.asList()!![0] as String })) != Js.stringify(inputs)) null else j.g("value").asObj()
  } catch (e: Exception) { null }

  /** The table version: in Node a hash of the files that compute the table
   *  (sidecar_tid_table.py, bf42/template_table.py, ghost/derive-children.mjs,
   *  CRLF read as LF), which the desktop build writes to table-version.txt.
   *  Here the Gradle build computes the same hash from the repo into the
   *  `sidecar/table-version.txt` resource (core/build.gradle.kts). */
  val TEMPLATE_TABLE_VERSION: String by lazy {
    TABLE_VERSION
  }
  private val VERSION get() = TEMPLATE_TABLE_VERSION

  // The install's own answer: its computed cache. STUB for the Python run the
  // Node copy falls to (installCanCompute is always false here, see Paths).
  private fun fromInstall(m: String, lv: String, md: String, key: String): MutableMap<String, Any?>? {
    val file = FsFile(FsFile(cacheDir(), safe(m)), "${safe(lv)}-${safe(md)}.tids.json")
    var value = readCache(file)
    if (value != null && !JsOps.eq(value["v"], VERSION)) value = null
    if (value == null && LevelTables.installCanCompute(m)) {
      warnOnce("run:$key", "could not compute the template table for mod=$m level=$lv mode=$md from the install: the Kotlin sidecar does not run Python")
    }
    return value
  }

  private val fromDownload = IdentitySet()

  // The downloaded bake, which LevelTables.prepareLevel put in the cache.
  private fun fromBaked(m: String, lv: String, md: String, key: String): MutableMap<String, Any?>? {
    val j = LevelTables.readBaked(m, lv, md) ?: return null
    val tids = j["tids"].asObj()!!
    if (!JsOps.eq(tids["v"], VERSION)) warnOnce("ver:$key", "$m $lv $md: the downloaded table was baked by other code (${JsOps.str(tids["v"])}; this is $VERSION); rebake with sidecar/bake-tables.mjs if objects come out misnamed")
    JsOps.consoleLog("[template-table] $m $lv $md: ${(tids["names"] as List<*>).size} template ids, ${(tids["specs"] as? Map<*, *>)?.size ?: 0} hull specs, ${(tids["soldiers"] as? Map<*, *>)?.size ?: 0} soldiers, from the downloaded tables")
    lock.withLock { fromDownload.add(tids) }
    return tids
  }

  // Local cache (the install's computed table, else a downloaded bake), then
  // the install itself. `baked: false` asks the install alone.
  private fun compute(m: String, lv: String, md: String, key: String, baked: Boolean): MutableMap<String, Any?>? {
    val file = FsFile(FsFile(cacheDir(), safe(m)), "${safe(lv)}-${safe(md)}.tids.json")
    val own = readCache(file)
    if (own != null && JsOps.eq(own["v"], VERSION)) return own
    val b = if (baked) fromBaked(m, lv, md, key) else null
    if (b != null) return b
    if (LevelTables.installCanCompute(m)) return fromInstall(m, lv, md, key)
    warnOnce("none:$key", "no install can compute mod=$m${if (baked) ", and no downloaded tables for $lv $md are in the cache (level-tables.mjs prepareLevel)" else ""}")
    return null
  }

  private fun load(mod: Any?, level: Any?, mode: Any?, baked: Boolean): MutableMap<String, Any?>? {
    if (!JsOps.truthy(mod) || !JsOps.truthy(level)) {
      warnOnce("args:${JsOps.str(mod)}|${JsOps.str(level)}", "no ${if (JsOps.truthy(mod)) "level" else "mod (no ServerInfo seen)"}: the template table cannot be computed")
      return null
    }
    val m = JsOps.str(mod).lowercase()
    val lv = levelBase(level)
    val md = modeBase(mode)
    val key = "$m|$lv|$md"
    lock.withLock {
      // Memoised either way; a miss looks again only at a download landed since.
      val hit = memo[key]
      val gen = LevelTables.bakedGeneration()
      if (hit?.value != null && (!lock.withLock { fromDownload.contains(hit.value) } || hit.gen == gen)) return hit.value
      if (hit?.value != null) {
        val value = fromBaked(m, lv, md, key) ?: hit.value
        memo[key] = Memo(value, baked, LevelTables.bakedGeneration())
        return value
      }
      if (hit != null && (!baked || (hit.baked && hit.gen == gen))) return null
      val value = if (hit != null) fromBaked(m, lv, md, key) else compute(m, lv, md, key, baked)
      memo[key] = Memo(value, baked, LevelTables.bakedGeneration())
      return value
    }
  }

  /** { tidNames: { "<tid>": name }, tidClasses: { "<tid>": class }, count,
   *  mod, level, mode }, or null when it could not be computed. */
  fun templateTable(mod: Any?, level: Any?, mode: Any? = null, baked: Boolean = true): MutableMap<String, Any?>? {
    val value = load(mod, level, mode, baked) ?: return null
    val names = value["names"].asList()!!
    val classes = value["classes"].asList() ?: emptyList<Any?>()
    val tidNames = LinkedHashMap<String, Any?>(); names.forEachIndexed { i, n -> tidNames[i.toString()] = n }
    val tidClasses = LinkedHashMap<String, Any?>(); classes.forEachIndexed { i, c -> tidClasses[i.toString()] = c }
    return linkedMapOf("tidNames" to tidNames, "tidClasses" to tidClasses, "count" to names.size.toDouble(),
      "mod" to JsOps.get(value, "mod"), "level" to JsOps.get(value, "level"), "mode" to JsOps.get(value, "mode"))
  }

  /** The level's ghost body layouts, { specs, hulls, soldiers, mod, level, mode }, or null. */
  fun levelTemplates(mod: Any?, level: Any?, mode: Any? = null, baked: Boolean = true): MutableMap<String, Any?>? {
    val value = load(mod, level, mode, baked) ?: return null
    return linkedMapOf("specs" to JsOps.get(value, "specs"), "hulls" to JsOps.get(value, "hulls"), "soldiers" to JsOps.get(value, "soldiers"),
      "mod" to JsOps.get(value, "mod"), "level" to JsOps.get(value, "level"), "mode" to JsOps.get(value, "mode"))
  }

  /** The whole cached value, for a bake. */
  fun templateValue(mod: Any?, level: Any?, mode: Any? = null, baked: Boolean = true): MutableMap<String, Any?>? = load(mod, level, mode, baked)

  /** Forget the memo and the warnings (tests; a fresh Node process). */
  fun reset() {
    lock.withLock { memo.clear() }
    lock.withLock { warned.clear() }
    lock.withLock { fromDownload.clear() }
  }
}

/** A set by identity (Collections.newSetFromMap(IdentityHashMap())): the few
 *  downloaded tables. */
internal class IdentitySet {
  private val items = ArrayList<Any>()
  fun add(x: Any): Boolean { if (contains(x)) return false; items.add(x); return true }
  fun contains(x: Any?): Boolean = items.any { it === x }
  fun clear() = items.clear()
}
