package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/level-tables.mjs; keep in step.
//
// The level's tables without a game install: the baked copies on
// mesh.bfstats.io, fetched into the sidecar's cache before they are needed.
//
// What the sidecar reads per level (TemplateTable: the template ids, their
// classes and the ghost body layouts; GameTables: the animation states and the
// control point names) is a pure function of the mod, the level and the game
// type. `bake-tables.mjs` computes it from an install and the mesh publisher
// sends it to the assets volume, so mesh.bfstats.io serves it at
// `<base>maps[/mods/<mod>]/<level>/sidecar/<mode>.json`.
//
// The consumers are synchronous (a SetLevel is handled in the turn that read
// it), so the download is the other half: `prepareLevel` runs before a connect
// and on a SetLevel, and the session holds the level's load until it returns.
// The sync lookups then resolve in this order (TemplateTable, GameTables):
//
//   memo -> local cache (the install's computed tables, or a downloaded bake)
//        -> the install (never, here: no Python) -> [the download, put in the
//        cache by prepareLevel] -> the recorded templates/<level>.json fallback.
//
// A downloaded copy is revalidated at each prepareLevel with a conditional GET
// (its ETag and Last-Modified): 304 keeps it, 200 replaces it, and no answer
// within `revalidateMs` keeps it as it is, so a machine offline still plays.
//
// Every failure is logged once and answered with a 'none' result; nothing here
// throws. prepareLevel blocks (Node's returns a Promise): call it off the main
// thread. A second call for a level whose first is still downloading waits for
// that one and gets its answer, as a second await of Node's stored promise
// does. The HTTP client is the platform's (`Fetch`, httpGet: a whole-request
// timeout, gzip, redirects, the BOM dropped, as fetch and res.text() do),
// injectable for tests. Error texts from the platform's client are its own
// (a refused connection names itself where undici says "fetch failed"); they
// reach only the log and the result's `error`.

import kotlin.concurrent.Volatile

object LevelTables {
  private val lock = Lock()
  const val DEFAULT_TABLES_URL = "https://mesh.bfstats.io/"
  const val FORMAT = 1

  fun cacheDir(): FsFile = Paths.cacheDir()
  fun gameDir(): FsFile? = Paths.gameDir()

  private val warned = HashSet<String>()
  private fun warnOnce(key: String, msg: String) {
    lock.withLock { if (!warned.add(key)) return }
    JsOps.consoleError("[level-tables] $msg")
  }

  // JS semantics: `$` is the end of the input (\z), `\s` and trim() are JS's
  // white space (JS_WS: NBSP, the U+2000 run, U+3000, the BOM and the rest).
  private val TRAIL = Regex("[\\\\/]+\\z")
  private val SEP = Regex("[\\\\/]")
  private val SPACES = Regex("[$JS_WS]+")
  private val CON = Regex("\\.con\\z")
  private val NOT_KEY = Regex("[^a-z0-9_.-]+")
  private val OFF = Regex("^(off|none|0)$", RegexOption.IGNORE_CASE)
  /** `bf1942/levels/Market_Garden/`, `market garden` (the live list) -> `market_garden`. */
  fun levelKey(level: Any?): String =
    JsOps.trim(JsOps.str(if (JsOps.truthy(level)) level else "")).replace(TRAIL, "").split(SEP).last().lowercase().replace(SPACES, "_")

  private val MODE_ALIASES = mapOf(
    "gpm_cq" to "conquest", "gpm_coop" to "coop", "gpm_ctf" to "ctf", "gpm_tdm" to "tdm", "gpm_objectivemode" to "objectivemode",
    "objective" to "objectivemode", "co-op" to "coop", "teamdeathmatch" to "tdm",
  )
  /** `CoOp.con`, `coop`, `GPM_COOP` -> `coop`; nothing -> `conquest`. */
  fun modeKey(mode: Any?): String {
    val m = JsOps.trim(JsOps.str(if (JsOps.truthy(mode)) mode else "conquest")).lowercase().replace(CON, "")
    return MODE_ALIASES[m] ?: m
  }

  /** The server's mod as a tree key: `XPack1` -> `xpack1`. */
  fun modKey(mod: Any?): String = JsOps.trim(JsOps.str(if (JsOps.truthy(mod)) mod else "")).lowercase().replace(NOT_KEY, "_")

  /** The tree a mod's levels are exported in, relative to the viewer root. */
  fun treeFor(mod: Any?): String { val m = modKey(mod); return if (m.isEmpty() || m == "bf1942") "maps" else "maps/mods/$m" }

  /** Where a level's baked tables live under a tree (and on the volume). */
  fun bakedRel(mod: Any?, level: Any?, mode: Any?): String = "${treeFor(mod)}/${levelKey(level)}/sidecar/${modeKey(mode)}.json"

  /** SIDECAR_TABLES_URL as Node reads it; a host may set `tablesUrlOverride`
   *  ("off" never downloads). */
  @Volatile var tablesUrlOverride: String? = null
  fun tablesBase(): String? {
    val b = tablesUrlOverride ?: Paths.env["SIDECAR_TABLES_URL"] ?: DEFAULT_TABLES_URL
    if (b.isEmpty() || OFF.matches(b)) return null
    return if (b.endsWith("/")) b else "$b/"
  }

  /** The published URL of a level's tables, or null when downloads are off. */
  fun tablesUrl(mod: Any?, level: Any?, mode: Any?, base: String? = tablesBase()): String? =
    if (base != null) "${if (base.endsWith("/")) base else "$base/"}${bakedRel(mod, level, mode)}" else null

  /** The downloaded copy's place in the cache, beside the install's computed ones. */
  fun bakedCacheFile(mod: Any?, level: Any?, mode: Any?): FsFile =
    FsFile(FsFile(cacheDir(), modKey(mod).ifEmpty { "bf1942" }), "${levelKey(level)}-${modeKey(mode)}.baked.json")

  // Bumped whenever a download lands, so a lookup that found nothing before it
  // (and memoised that) looks again.
  @Volatile private var generation = 0 // moved under `lock`
  fun bakedGeneration(): Int = generation

  /** Whether a baked document is one this code reads. */
  fun validBaked(j: Any?): Boolean {
    if (j !is Map<*, *>) return false
    val tids = j["tids"]
    val names = tids.g("names")
    return JsOps.eq(j["format"], FORMAT.toDouble()) && names is List<*> && names.size >= 2 &&
      tids.g("classes") is List<*> && JsOps.truthy(tids.g("specs")) && JsOps.truthy(tids.g("hulls")) && JsOps.truthy(tids.g("soldiers"))
  }

  /** The downloaded tables in the cache, or null. */
  fun readBaked(mod: Any?, level: Any?, mode: Any?): MutableMap<String, Any?>? {
    val file = bakedCacheFile(mod, level, mode)
    val j = try { JsOps.parse(file.readText()) } catch (e: Exception) { return null }
    if (validBaked(j)) return j.asObj()
    warnOnce("bad:$file", "ignoring $file: not a format $FORMAT table")
    return null
  }

  private var tmpSeq = 0
  private fun writeBaked(mod: Any?, level: Any?, mode: Any?, j: Any?): FsFile {
    val file = bakedCacheFile(mod, level, mode)
    file.parentFile?.mkdirs()
    // Node writes <file>.<pid>.tmp; ProcessHandle is not on Android, and a
    // per-write suffix is as good for keeping two writers apart.
    val tmp = FsFile(file.path + ".${lock.withLock { ++tmpSeq }}-${monoNanos()}.tmp")
    tmp.writeText(Js.stringify(j))
    // renameSync replaces the file in one step. atomicMove does the same where
    // the platform can; where it cannot (a file system without an atomic
    // replace), the old copy is deleted first and a readBaked in that moment
    // finds no file, so that lookup answers "none" and the next finds the new
    // copy (generation moves only after).
    if (!tmp.renameTo(file)) { file.delete(); if (!tmp.renameTo(file)) throw RuntimeException("cannot rename $tmp") }
    lock.withLock { generation++ }
    return file
  }

  /** The install is Windows-cased; a mod is there when Mods/<mod> is, any case. */
  fun installHasMod(mod: Any?, dir: FsFile? = gameDir()): Boolean {
    if (dir == null) return false
    return try {
      val want = modKey(mod).ifEmpty { "bf1942" }
      FsFile(dir, "Mods").list()?.any { it.lowercase() == want } ?: false
    } catch (e: Exception) { false }
  }

  /** Whether this process can compute `mod`'s tables from the install: never,
   *  in the port (no Python, Paths.pythonAvailable). As in Node, a no when the
   *  install has the mod is said once, with why. The Node copy's check for its
   *  Python helpers beside the module is folded into the same answer. */
  fun installCanCompute(mod: Any?, dir: FsFile? = gameDir()): Boolean {
    if (!installHasMod(mod, dir)) return false
    val py = Paths.pythonAvailable()
    if (!py.ok) {
      warnOnce("python", "the install at $dir has mod=${modKey(mod).ifEmpty { "bf1942" }}, but ${py.python} is not a working Python 3 (${py.why}): using the published tables")
      return false
    }
    return true
  }

  // ---- the download -------------------------------------------------------

  /** One HTTP answer: the status, the two validators, the body. */
  class Response(val status: Int, val etag: String?, val lastModified: String?, val body: String)
  /** `fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })`;
   *  throws TimeoutException-like `FetchTimeout` past the deadline. */
  fun interface Fetch { fun get(url: String, headers: Map<String, String>, timeoutMs: Long): Response }
  class FetchTimeout : RuntimeException("timeout")

  /** The platform's GET (Platform.kt httpGet). */
  val httpFetch = Fetch { url, headers, timeoutMs ->
    val r = try { httpGet(url, headers, timeoutMs) } catch (e: HttpTimeout) { throw FetchTimeout() }
    Response(r.status, r.headers["etag"], r.headers["last-modified"], if (r.status == 304) "" else r.text)
  }

  /** The clock (ms) prepareLevel times and reuses answers by. */
  @Volatile var now: () -> Long = { wallMillis() }

  // What prepareLevel last answered per level, and when; stored when the
  // call starts (Node stores the promise), so an overlapping call waits for it.
  private class Prepared(val at: Long) {
    @Volatile var r: MutableMap<String, Any?>? = null
    val done = Latch()
  }
  private val prepared = HashMap<String, Prepared>()

  private class Fetched(val status: Int, val doc: MutableMap<String, Any?>? = null)

  private fun fetchTables(url: String, timeoutMs: Long, fetch: Fetch, etag: String? = null, lastModified: String? = null): Fetched {
    val headers = LinkedHashMap<String, String>()
    // Sent only when truthy, as the Node copy's `if (etag)`: an empty validator is none.
    if (!etag.isNullOrEmpty()) headers["If-None-Match"] = etag
    if (!lastModified.isNullOrEmpty()) headers["If-Modified-Since"] = lastModified
    val res = fetch.get(url, headers, timeoutMs)
    if (res.status == 304) return Fetched(304)
    if (res.status !in 200..299) throw RuntimeException("HTTP ${res.status}")
    val j = JsOps.parse(res.body)
    if (!validBaked(j)) throw RuntimeException("not a format $FORMAT table")
    // Kept with the copy, for the next join's conditional GET.
    j.asObj()!!["_http"] = linkedMapOf("url" to url, "etag" to res.etag, "lastModified" to res.lastModified)
    return Fetched(200, j.asObj())
  }

  private fun describe(j: Map<String, Any?>): String =
    "${(j["tids"].g("names") as List<*>).size} template ids, ${(j["animStates"] as? List<*>)?.size ?: 0} animation states, ${(j["cpNames"] as? Map<*, *>)?.size ?: 0} control point names"

  private fun msg(e: Exception, ms: Long) = if (e is FetchTimeout) "no answer in $ms ms" else (e.message ?: e.toString())

  /** Make the level's tables available to the sync lookups. Returns
   *  `{ source, url?, ms, revalidated?, stale?, replaced?, why?, error? }`,
   *  never throws; `source` is 'cache', 'download', 'install' or 'none' (see
   *  the Node copy). `fetch` and `base` are for tests. */
  fun prepareLevel(
    mod: Any?, level: Any?, mode: Any?,
    timeoutMs: Long = 20000, revalidateMs: Long = 3000, reuseMs: Long = 60000,
    fetch: Fetch? = httpFetch, base: String? = tablesBase(), install: Boolean = true,
  ): MutableMap<String, Any?> {
    if (!JsOps.truthy(mod) || levelKey(level).isEmpty()) return linkedMapOf("source" to "none", "why" to "no mod or level")
    val m = modKey(mod); val lv = levelKey(level); val md = modeKey(mode)
    val key = "$m|$lv|$md"
    var hit: Prepared? = null
    val mine = Prepared(now())
    lock.withLock {
      val h = prepared[key]
      if (h != null && now() - h.at < reuseMs) hit = h else prepared[key] = mine
    }
    hit?.let { h -> h.done.await(Long.MAX_VALUE / 2_000_000); return h.r!! }
    var r: MutableMap<String, Any?> = linkedMapOf("source" to "none", "why" to "failed")
    try {
      r = run(m, lv, md, key, timeoutMs, revalidateMs, fetch, base, install)
    } finally {
      // A waiter is let go whatever happened (Node's promise never rejects).
      mine.r = r
      // `p.then(r => r.source === 'none' && prepared.delete(key))`
      if (r["source"] == "none") lock.withLock { prepared.remove(key) }
      mine.done.countDown()
    }
    return r
  }

  private fun run(mod: String, level: String, mode: String, key: String, timeoutMs: Long, revalidateMs: Long, fetch: Fetch?,
                  base: String?, install: Boolean): MutableMap<String, Any?> {
    val t = now()
    val url = tablesUrl(mod, level, mode, base)
    val canFetch = url != null && fetch != null
    val cached = readBaked(mod, level, mode)
    if (cached != null) {
      if (!canFetch) return linkedMapOf("source" to "cache", "ms" to (now() - t).toDouble(), "revalidated" to false)
      val version = TemplateTable.TEMPLATE_TABLE_VERSION
      val otherCode = !JsOps.eq(cached["tids"].g("v"), version)
      if (otherCode) warnOnce("ver:$key", "$key: the cached table was baked by other code (${JsOps.str(cached["tids"].g("v"))}; this is $version); fetching a fresh copy")
      return try {
        // Other code's copy: no validators, so the server sends its copy whole.
        val http = cached["_http"]
        val r = fetchTables(url!!, if (otherCode) timeoutMs else revalidateMs, fetch!!,
          if (otherCode) null else http.g("etag") as? String, if (otherCode) null else http.g("lastModified") as? String)
        if (r.status == 304) return linkedMapOf("source" to "cache", "url" to url, "ms" to (now() - t).toDouble(), "revalidated" to true)
        writeBaked(mod, level, mode, r.doc)
        JsOps.consoleLog("[level-tables] $key: ${describe(r.doc!!)}, a newer copy downloaded from $url in ${now() - t} ms")
        linkedMapOf("source" to "download", "url" to url, "ms" to (now() - t).toDouble(), "replaced" to true)
      } catch (e: Exception) {
        warnOnce("reval:$key", "could not check the cached tables for $key against $url (${msg(e, if (otherCode) timeoutMs else revalidateMs)}); using the cached copy")
        linkedMapOf("source" to "cache", "url" to url, "ms" to (now() - t).toDouble(), "revalidated" to false, "stale" to true)
      }
    }
    if (install && installCanCompute(mod)) {
      // Built (and cached) now rather than at the SetLevel, from the install.
      val tt = TemplateTable.templateTable(mod, level, mode, baked = false)
      val g = GameTables.gameTables(mod, level, mode, baked = false)
      if (tt != null && JsOps.truthy(g["animStates"]) && JsOps.truthy(g["cpNames"])) return linkedMapOf("source" to "install", "ms" to (now() - t).toDouble())
    }
    if (url == null) { warnOnce("off:$key", "no tables for $key and downloads are off (SIDECAR_TABLES_URL)"); return linkedMapOf("source" to "none", "ms" to (now() - t).toDouble()) }
    if (!canFetch) { warnOnce("nofetch", "this Node has no fetch(); cannot download the level tables"); return linkedMapOf("source" to "none", "url" to url, "ms" to (now() - t).toDouble()) }
    return try {
      val r = fetchTables(url, timeoutMs, fetch!!)
      if (r.status == 304) throw RuntimeException("HTTP 304 to an unconditional GET")
      val file = writeBaked(mod, level, mode, r.doc)
      JsOps.consoleLog("[level-tables] $key: ${describe(r.doc!!)}, downloaded from $url in ${now() - t} ms -> $file")
      linkedMapOf("source" to "download", "url" to url, "ms" to (now() - t).toDouble())
    } catch (e: Exception) {
      warnOnce("dl:$key", "could not download the tables for $key from $url: ${msg(e, timeoutMs)}; the recorded fallback stands in")
      linkedMapOf("source" to "none", "url" to url, "ms" to (now() - t).toDouble(), "error" to (if (e is FetchTimeout) "The operation was aborted due to timeout" else e.message))
    }
  }

  /** Back to a fresh process's state: nothing learnt, no download counted (tests). */
  fun resetProcessState() { resetLevelTables(); generation = 0 }

  /** Forget what prepareLevel learnt (tests). */
  fun resetLevelTables() { lock.withLock { prepared.clear() }; lock.withLock { warned.clear() } }
}
