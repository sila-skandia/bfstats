package io.bfstats.sidecar

// The parity fixtures' Kotlin half (tools/sidecar-android/parity/lib/ is the
// Node half; keep the two in step): loading a fixture as kotlinx JSON or as JS
// values, the two value encodings the generators write (enc: bytes as
// "hex:<hex>", parity/lib/fixture.mjs; canon: bytes as {$hex},
// parity/lib/fake-time.mjs plain), the scratch level-table cache
// (parity/lib/tables.mjs), line-by-line comparison, and the seeded PRNG.
// The fake clock is core's own ManualScheduler (Scheduler.kt).

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import io.bfstats.sidecar.Assert.assertEquals

object Fixtures {
  // ---- loading ----------------------------------------------------------

  /** A fixture under core/src/commonTest/resources/parity, gunzipped when it
   *  ends in .gz (read from the source tree on every target). */
  fun text(path: String): String = readSourceFile("$PARITY_DIR/$path").decodeToString()

  /** A resource as JS values (JsOps.parse). */
  fun json(path: String): Any? = JsOps.parse(text(path))

  /** parity/<name>.json as kotlinx JSON. */
  fun load(name: String): JsonObject = Json.parseToJsonElement(text("$name.json")) as JsonObject

  /** parity/<name>.json as JS values. */
  @Suppress("UNCHECKED_CAST")
  fun loadJs(name: String): Map<String, Any?> = json("$name.json") as Map<String, Any?>

  // ---- kotlinx JSON values ------------------------------------------------

  /** The fixture's own JSON for a value, printed as V8 prints it. */
  fun js(e: JsonElement?): String = Js.stringify(e ?: JsonNull)

  /** A fixture value as a plain Kotlin value (string, double, boolean, map, list). */
  fun plain(e: JsonElement?): Any? = when (e) {
    null, JsonNull -> null
    is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
    is JsonObject -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in e) m[k] = plain(x) }
    is JsonArray -> e.map { plain(it) }
  }

  fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
  fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
  fun bool(e: JsonElement?): Boolean? = (e as? JsonPrimitive)?.booleanOrNull
  fun lines(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }

  // ---- the encodings ------------------------------------------------------

  /** enc() of parity/lib/fixture.mjs: bytes as "hex:<hex>", maps and lists element-wise. */
  fun enc(v: Any?): Any? = when (v) {
    is ByteArray -> "hex:${v.hex()}"
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in v) m[k.toString()] = if (x === Undefined) Undefined else enc(x) }
    is List<*> -> v.map { enc(it) }
    is Array<*> -> v.map { enc(it) }
    else -> v
  }

  fun encs(v: Any?): String = Js.stringify(enc(v))
  fun encs(vararg v: Any?): String = Js.stringify(enc(v.toList()))

  /** plain() of parity/lib/fake-time.mjs: ByteArray as {$hex}, Action and the
   *  other ported classes as their JS object. */
  fun canon(v: Any?): Any? = when (v) {
    is ByteArray -> linkedMapOf("\$hex" to v.hex())
    is Action -> v.toJs()
    is AckPath -> v.toJs()
    is EventBlock -> linkedMapOf("count" to v.count, "index" to v.index, "resend" to v.resend, "events" to canon(v.events))
    is Throwable -> linkedMapOf("error" to v.message)
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in v) m[k.toString()] = canon(x) }
    is List<*> -> v.map { canon(it) }
    else -> v
  }

  fun canonJs(v: Any?): String = Js.stringify(canon(v))

  /** Equal as JSON text (a JS value from loadJs against a canon'd Kotlin value). */
  fun same(where: String, want: Any?, got: Any?) = assertEquals(where, Js.stringify(want), canonJs(got))

  // ---- comparing transcripts ----------------------------------------------

  /** Two transcripts, line by line, with the first difference in the message. */
  fun assertLines(what: String, want: List<String>, got: List<String>) {
    val n = minOf(want.size, got.size)
    for (i in 0 until n) if (want[i] != got[i]) {
      assertEquals("$what: line $i (context: ${want.subList(maxOf(0, i - 3), i).joinToString(" | ")})", want[i], got[i])
    }
    assertEquals("$what: line count", want.size, got.size)
  }

  /** "" when equal, else the first differing line of each. */
  fun diff(want: List<String>, got: List<String>, label: String): String {
    val n = minOf(want.size, got.size)
    for (i in 0 until n) if (want[i] != got[i]) return "$label: line ${i + 1} differs\n  node:   ${want[i].take(600)}\n  kotlin: ${got[i].take(600)}"
    if (want.size != got.size) return "$label: node has ${want.size} lines, kotlin ${got.size}"
    return ""
  }

  // ---- the level tables (parity/lib/tables.mjs) ---------------------------

  private val TABLES = listOf(Triple("bf1942", "wake", "coop"), Triple("bf1942", "el_alamein", "coop"), Triple("desertcombat", "el_alamein", "conquest"))

  /** A scratch cache, with the committed baked tables or empty, wired in as
   *  the sidecar's cache with no install and no downloads; every module's
   *  memo forgotten (a fresh Node process). */
  fun freshCache(withTables: Boolean = true, extra: FsFile? = null): FsFile {
    val dir = tempDir("parity-cache-")
    // A capture's own tables (`<mod>/<level>-<mode>.baked.json.gz`), then the
    // committed ones over them, as lib/tables.mjs scratchCache does.
    if (extra != null) for (rel in walkFiles(extra)) {
      val f = FsFile(dir, rel.removeSuffix(".gz"))
      f.parentFile!!.mkdirs()
      f.writeText(readSourceFile(FsFile(extra, rel).path).decodeToString())
    }
    if (withTables) for ((mod, level, mode) in TABLES) {
      val f = FsFile(FsFile(dir, mod), "$level-$mode.baked.json")
      f.parentFile!!.mkdirs()
      f.writeText(text("cache/$mod/$level-$mode.baked.json.gz"))
    }
    Paths.cacheDirOverride = dir
    Paths.lookForInstall = false
    LevelTables.tablesUrlOverride = "off"
    Rebuild.resetModuleState()
    return dir
  }
}

@Suppress("UNCHECKED_CAST")
fun Any?.m(): Map<String, Any?> = this as Map<String, Any?>
fun Any?.l(): List<Any?> = this as List<Any?>
fun Any?.d(): Double = (this as Number).toDouble()
/** `o[k]` on a JS object: Undefined when absent. */
fun Map<String, Any?>.o(k: String): Any? = if (containsKey(k)) get(k) else Undefined

/** prng() of parity/lib/fixture.mjs: xorshift32 in [0, 1). */
fun prng(seed: Long = 0x9e3779b9L): () -> Double {
  var s = seed.toInt()
  return {
    s = s xor (s shl 13); s = s xor (s ushr 17); s = s xor (s shl 5)
    (s.toLong() and 0xffffffffL) / 4294967296.0
  }
}
