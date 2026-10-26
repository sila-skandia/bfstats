package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** The level tables against Node (parity/tables.mjs). */
class TablesTest {
  private val fx by lazy { Fixtures.json("tables.json.gz").asObj()!! }
  private fun o(vararg p: Pair<String, Any?>) = linkedMapOf(*p)
  private fun noMs(r: Map<String, Any?>) = LinkedHashMap(r).also { it.remove("ms") }

  private fun compare(name: String, got: List<Pair<String, Any?>>) {
    val want = (fx[name] as List<*>).map { (it as List<*>).let { p -> "${p[0]} ${p[1]}" } }
    val d = Fixtures.diff(want, got.map { "${it.first} ${Js.stringify(it.second)}" }, name)
    assertEquals(d, "", d)
  }

  @Test fun prepareLevelAgainstAStandIn() {
    val cache = Fixtures.freshCache(false)
    val BASE = "http://mesh.test/"
    LevelTables.tablesUrlOverride = BASE
    val out = ArrayList<Pair<String, Any?>>()
    fun put(label: String, v: Any?) { out += label to v }
    val version = TemplateTable.TEMPLATE_TABLE_VERSION

    // ---- the stand-in server, as tables.mjs scripts it ----
    class State(var rev: Int, var v: String)
    val served = HashMap<String, State>()
    fun state(level: String) = served.getOrPut(level) { State(1, version) }
    fun baked(level: String, mode: String): Any? {
      val s = state(level)
      val names = mutableListOf<Any?>("ObjectManagerCamera", "BlueFlag", "RedFlag", "Sherman", "Tiger", if (s.rev == 1) "TestTank" else "TestTank${s.rev}")
      return o("format" to 1.0, "mod" to "bf1942", "level" to level, "mode" to mode,
        "tids" to o("v" to s.v, "mod" to "bf1942", "level" to level, "mode" to mode, "names" to names,
          "classes" to mutableListOf<Any?>("Camera", "Flag", "Flag", "PlayerControlObject", "PlayerControlObject", "PlayerControlObject"),
          "specs" to o(), "hulls" to o(), "soldiers" to o()),
        "animStates" to mutableListOf<Any?>(mutableListOf(0.0, "Idle", 0.0), mutableListOf(1.0, "Run", 0.0), mutableListOf(2.0, "Prone", 0.0)).take(if (s.rev == 1) 3 else 2),
        "cpNames" to o("ALLIES_base" to "Airfield"))
    }
    val requests = ArrayList<Any?>()
    val conditional = ArrayList<Any?>()
    var down = false; var refused = false
    val http = DateTimeFormatter.ofPattern("EEE, dd MMM yyyy HH:mm:ss 'GMT'", java.util.Locale.US)
    val re = Regex("^/maps(?:/mods/([^/]+))?/([^/]+)/sidecar/([^/]+)\\.json$")
    val fetch = LevelTables.Fetch { url, headers, _ ->
      val p = if (url.startsWith(BASE)) url.substring(BASE.length - 1) else url
      requests.add(p)
      if (refused) throw RuntimeException("fetch failed")
      if (down) throw LevelTables.FetchTimeout()
      val m = re.find(p)
      if (m != null && m.groupValues[2] == "slow") throw LevelTables.FetchTimeout()
      if (m != null && m.groupValues[2] == "garbled") return@Fetch LevelTables.Response(200, null, null, "{\"format\":99}")
      if (m != null && m.groupValues[2] in setOf("wake", "el_alamein", "anzio", "berlin", "oldcode")) {
        val lv = m.groupValues[2]
        val s = state(lv)
        val etag = "W/\"$lv-${s.rev}-${s.v}\""
        val lastModified = http.format(ZonedDateTime.of(2026, 10, 25, 3, s.rev, 0, 0, ZoneOffset.UTC))
        val inm = headers["If-None-Match"]; val ims = headers["If-Modified-Since"]
        val fresh = if (inm != null) inm == etag else if (ims != null) ims == lastModified else false
        conditional.add(mutableListOf<Any?>(p, inm, ims, if (fresh) 304.0 else 200.0))
        if (fresh) return@Fetch LevelTables.Response(304, etag, lastModified, "")
        return@Fetch LevelTables.Response(200, etag, lastModified, Js.stringify(baked(lv, m.groupValues[3])))
      }
      LevelTables.Response(404, null, null, "not found")
    }
    fun prep(mod: Any?, level: Any?, mode: Any?, timeoutMs: Long = 20000, revalidateMs: Long = 3000, f: LevelTables.Fetch? = fetch) =
      noMs(LevelTables.prepareLevel(mod, level, mode, timeoutMs = timeoutMs, revalidateMs = revalidateMs, fetch = f, base = LevelTables.tablesBase()))

    val W = Triple("bf1942", "bf1942/levels/wake/", "coop.con")
    fun tt() = TemplateTable.templateTable(W.first, W.second, W.third)
    put("version", version)
    put("before", o("table" to tt(), "anim" to GameTables.gameTables(W.first, W.second, W.third)["animStates"]))
    put("first", prep(W.first, W.second, W.third))
    put("cacheFile", LevelTables.bakedCacheFile(W.first, W.second, W.third).relativeTo(cache).path)
    val t = tt()
    val n = Names.namesForLevel(W.second, W.first, W.third)
    put("after", o("count" to (t?.get("count") ?: 0.0), "tid5" to t?.get("tidNames").g("5"), "cls3" to t?.get("tidClasses").g("3"),
      "layouts" to (TemplateTable.levelTemplates(W.first, W.second, W.third) != null),
      "anim" to ((GameTables.gameTables(W.first, W.second, W.third)["animStates"] as? List<*>)?.size?.toDouble() ?: 0.0),
      "cp" to GameTables.gameTables(W.first, W.second, W.third)["cpNames"].g("ALLIES_base"),
      "named" to o("computed" to n["computed"], "tid4" to n["tidNames"].g("4"))))
    val n1 = requests.size
    put("again", prep(W.first, W.second, W.third))
    put("requestsForAgain", (requests.size - n1).toDouble())
    LevelTables.resetLevelTables()
    put("revalidate304", o("r" to prep(W.first, W.second, W.third), "c" to conditional.last(), "tid5" to tt()?.get("tidNames").g("5")))
    state("wake").rev = 2
    LevelTables.resetLevelTables()
    put("revalidate200", o("r" to prep(W.first, W.second, W.third), "c" to conditional.last(), "tid5" to tt()?.get("tidNames").g("5"),
      "anim" to ((GameTables.gameTables(W.first, W.second, W.third)["animStates"] as? List<*>)?.size?.toDouble() ?: 0.0)))
    LevelTables.resetLevelTables()
    down = true
    put("offlineHung", o("r" to prep(W.first, W.second, W.third, revalidateMs = 300), "tid5" to tt()?.get("tidNames").g("5")))
    down = false
    LevelTables.resetLevelTables()
    refused = true
    put("offlineRefused", prep(W.first, W.second, W.third, revalidateMs = 300))
    refused = false
    run {
      state("oldcode").v = "other-code"
      put("oldFirst", prep("bf1942", "oldcode", "coop"))
      put("oldBefore", LevelTables.readBaked("bf1942", "oldcode", "coop")?.get("tids").g("v"))
      state("oldcode").v = version
      LevelTables.resetLevelTables()
      put("otherCode", o("r" to prep("bf1942", "oldcode", "coop"), "c" to conditional.last(),
        "after" to (LevelTables.readBaked("bf1942", "oldcode", "coop")?.get("tids").g("v") == version)))
    }
    state("wake").rev = 1
    LevelTables.resetLevelTables()
    put("back", prep(W.first, W.second, W.third))
    put("xpack", prep("XPack1", "bf1942/levels/Anzio/", "CoOp.con"))
    put("missing", prep("bf1942", "bf1942/levels/no_such_level/", "conquest.con"))
    put("missingTable", TemplateTable.templateTable("bf1942", "bf1942/levels/no_such_level/", "conquest.con"))
    put("missingNamed", Names.namesForLevel("bf1942/levels/no_such_level/", "bf1942", "conquest.con")["computed"])
    put("slow", prep("bf1942", "slow", "coop", timeoutMs = 300))
    put("garbled", prep("bf1942", "garbled", "coop"))
    put("noFetch", prep("bf1942", "berlin", "conquest", f = null))
    LevelTables.tablesUrlOverride = "off"
    put("off", prep("bf1942", "berlin", "ctf"))
    put("noArgs", noMs(LevelTables.prepareLevel(null, "wake", null, fetch = fetch)))
    put("requests", requests)
    put("conditional", conditional)
    put("cache", cache.walkTopDown().filter { it.isFile && it.name.endsWith(".json") }.map { it.relativeTo(cache).path }.sorted().toList())
    put("wakeDoc", JsOps.parse(LevelTables.bakedCacheFile(W.first, W.second, W.third).readText()))
    compare("prepare", out)
  }

  private fun lookups(): List<Pair<String, Any?>> {
    val out = ArrayList<Pair<String, Any?>>()
    fun put(label: String, v: Any?) { out += label to v }
    val LV = listOf("bf1942/levels/Market_Garden/", "bf1942\\levels\\Market_Garden\\", "market garden", "  Wake  ", "", null, "a/b/c//", "El Alamein")
    val MD = listOf("CoOp.con", "GPM_CQ", "", null, "objective", "co-op", "TeamDeathMatch", "gpm_objectivemode", "CTF")
    val MOD = listOf("bf1942", "BF1942", "XPack1", "DC_Final", "Desert Combat!", "", null, "FHSW")
    put("levelKey", LV.map { LevelTables.levelKey(it) })
    put("modeKey", MD.map { LevelTables.modeKey(it) })
    put("modKey", MOD.map { LevelTables.modKey(it) })
    put("treeFor", MOD.map { LevelTables.treeFor(it) })
    put("urls", MOD.flatMap { mod -> LV.take(4).mapIndexed { i, level -> LevelTables.tablesUrl(mod, level, MD[i], if (i % 2 == 1) "https://mesh.example" else "https://mesh.example/") } })
    fun tids(names: List<Any?>) = o("names" to names.toMutableList(), "classes" to mutableListOf<Any?>(), "specs" to o(), "hulls" to o(), "soldiers" to o())
    put("validBaked", listOf(null, o(), o("format" to 1.0), o("format" to 1.0, "tids" to tids(listOf("a", "b"))), o("format" to 2.0, "tids" to tids(listOf("a", "b"))),
      o("format" to 1.0, "tids" to tids(listOf("a")))).map { LevelTables.validBaked(it) })
    val ASK = listOf(listOf("bf1942", "bf1942/levels/wake/", "coop.con"), listOf("BF1942", "Wake", "CoOp"), listOf("bf1942", "el_alamein", "coop"),
      listOf("desertcombat", "bf1942/levels/el_alamein/", "conquest.con"), listOf("bf1942", "bf1942/levels/wake/", "conquest.con"), listOf("bf1942", "tobruk", "coop"),
      listOf(null, "wake", "coop"), listOf("bf1942", null, "coop"))
    for ((mod, level, mode) in ASK) {
      val t = TemplateTable.templateTable(mod, level, mode)
      val lt = TemplateTable.levelTemplates(mod, level, mode)
      val g = GameTables.gameTables(mod, level, mode)
      put("table $mod $level $mode", t?.let { o("count" to it["count"], "mod" to it["mod"], "level" to it["level"], "mode" to it["mode"],
        "tids" to listOf("0", "1", "5", "100", "1571", "2914", "2916", "3601").map { k -> listOf(it["tidNames"].g(k).let { v -> if (JsOps.nullish(v)) null else v }, it["tidClasses"].g(k).let { v -> if (JsOps.nullish(v)) null else v }) }) })
      put("layouts $mod $level $mode", lt?.let { o("specs" to (it["specs"] as Map<*, *>).size.toDouble(), "sherman" to it["specs"].g("Sherman").let { v -> if (JsOps.nullish(v)) null else v },
        "hulls" to (it["hulls"] as Map<*, *>).size.toDouble(), "m3a1" to it["hulls"].g("M3A1").let { v -> if (JsOps.nullish(v)) null else v }, "soldiers" to it["soldiers"]) })
      val anim = g["animStates"] as? List<*>
      put("game $mod $level $mode", o("anim" to anim?.size?.toDouble(), "first" to anim?.firstOrNull(), "last" to anim?.lastOrNull(), "cpNames" to g["cpNames"],
        "downloaded" to (g["downloaded"])))
    }
    put("gameNoLevel", GameTables.gameTables("bf1942"))
    val levels = (Children::class.java.getResource("/sidecar/templates")?.let { File(it.toURI()).list()?.toList() } ?: emptyList())
      .map { it.removeSuffix(".json") }.sorted()
    for (lv in levels + listOf("no_such_level", "")) {
      for ((mod, mode) in listOf("bf1942" to "coop.con", null to null)) {
        val nn = Names.namesForLevel("bf1942/levels/$lv/", mod, mode)
        put("names $lv $mod", o("computed" to nn["computed"], "tidNames" to nn["tidNames"], "tidClasses" to (nn["tidClasses"] as? Map<*, *>)?.size?.toDouble(),
          "anim" to (nn["animStates"] as? List<*>)?.size?.toDouble(), "cpNames" to nn["cpNames"]))
      }
    }
    put("fromRecording", Names.tidNamesFromRecording(listOf(
      Js.stringify(o("e" to "setLevel", "level" to "bf1942/levels/wake/")), Js.stringify(o("e" to "serverInfo", "mod" to "bf1942")), "garbage",
      Js.stringify(o("k" to "e", "e" to "createObject", "tid" to 12.0, "tmpl" to "Sherman")), Js.stringify(o("k" to "o", "tid" to 3.0, "tmpl" to "Zero")),
      Js.stringify(o("k" to "anim", "states" to listOf(listOf(0.0, "a", 0.0)))), Js.stringify(o("k" to "cp", "tmpl" to "X", "name" to "Village"))).joinToString("\n")))
    val NAMES = listOf("Sherman", "sherman", "M3A1", "GermanSoldier", "GrenadeAlliesProjectile", "MultiPlayerFreeCamera", "Jap_AT", "US_Assault_Desert",
      "ALLIES_north_village", "allies_north_village", "Flag", null, "", "NothingAtAll", "Medic", "xMedic", "Scout_Winter")
    val cps = TemplateClass.controlPointTemplates("wake", o("ALLIES_north_village" to "Village", "AXIS_base" to "Base"))
    put("cpTemplates", cps.toList())
    put("classes", NAMES.map { n -> listOf(TemplateClass.classForTemplate(n, cps), TemplateClass.classForTemplate(n, null),
      TemplateClass.classForTemplate(n, cps, "Bundle"), TemplateClass.classForTemplate(n, null, "lodobject"), TemplateClass.classForTemplate(n, null, "NoSuchClass")) })
    put("fromClass", listOf("Wing", "wing", "HANDFIREARMS", "Particle", "", null, "x").map { TemplateClass.classFromTemplateClass(it) })
    put("cpNameOf", listOf(o("ALLIES_base" to "Airfield") to "ALLIES_base", o("ALLIES_base" to "Airfield") to "allies_BASE", o("ALLIES_base" to "Airfield") to "x",
      null to "x", o("a" to "b") to "", o("a" to null, "A" to "z") to "a").map { (m, t) -> GameTables.cpNameOf(m, t).let { if (JsOps.nullish(it)) "undefined" else it } })
    return out
  }

  @Test fun lookupsWithTables() { Fixtures.freshCache(true); compare("lookupsTables", lookups()) }
  @Test fun lookupsWithoutTables() { Fixtures.freshCache(false); compare("lookupsBare", lookups()) }
}

private val Children = io.bfstats.sidecar.ghost.Children
