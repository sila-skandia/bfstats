package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/server-query.mjs; keep in step.
//
// Which mod, level and game type a server is playing, before joining it, so
// the level's tables can be fetched ahead of the connect (level-tables.mjs).
//
// Two sources, both best effort and quick:
//   - the bfstats.io live server list (`/stats/LiveServers/bf1942/servers`),
//     whose rows carry `mapId` (the mod: BF1942, XPack1, DC_Final ...),
//     `mapName` ("market garden") and `gameType` ("conquest", "coop" ...);
//   - the server's own GameSpy `\status\` answer on its query port (the lab's
//     gameSpyPort 23001 for 14568, 23000 for 14567: game port + 8433; the LAN
//     port, + 7433, answers the same), keys `gameId`, `mapname`, `gametype`.
//
// The in-session SetLevel is the authority either way (session.mjs holds the
// level load until its tables are ready); this only saves that wait.
//
//   SIDECAR_LIVE_LIST   the live list URL ("off" skips it)
//
// The Node copy's promises are blocking calls here; run them off the loop.
// `fetch` is injectable as (url, timeoutMs) -> body, or null for a non-2xx.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URI

const val DEFAULT_LIVE_LIST = "https://bfstats.io/stats/LiveServers/bf1942/servers"

/** `\gameId\bf1942\mapname\Wake\...` -> { gameid: 'bf1942', mapname: 'Wake', ... }. */
fun parseGamespy(text: String): Map<String, String> {
  val parts = text.split("\\")
  val out = LinkedHashMap<String, String>()
  var i = 1
  while (i + 1 < parts.size) { if (parts[i].isNotEmpty()) out[parts[i].lowercase()] = parts[i + 1]; i += 2 }
  return jsKeyOrder(out)
}

private fun orNull(s: String?) = s?.takeIf { it.isNotEmpty() }

/** A GameSpy status answer as { mod, level, mode, name, source }, or null. */
fun levelFromGamespy(kv: Map<String, String>): LinkedHashMap<String, Any?>? {
  val mod = orNull(kv["gameid"]) ?: orNull(kv["mapid"])
  val level = orNull(kv["mapname"])
  return if (mod != null && level != null) linkedMapOf("mod" to mod, "level" to level, "mode" to orNull(kv["gametype"]), "name" to orNull(kv["hostname"]), "source" to "gamespy") else null
}

/** JSON as the Node copy holds it: String, Double, Boolean, null, Map, List. */
fun jsonToJs(e: JsonElement?): Any? = when (e) {
  null, JsonNull -> null
  is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.doubleOrNull
  is JsonObject -> jsKeyOrder(e.mapValues { jsonToJs(it.value) })
  is JsonArray -> e.map { jsonToJs(it) }
}

private fun truthy(v: Any?): Boolean = when (v) {
  null, false, Undefined -> false
  is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
  is String -> v.isNotEmpty()
  else -> true
}

/** A live list row as { mod, level, mode, name, source, queryPort }, or null. */
fun levelFromLiveRow(row: Map<String, Any?>?): LinkedHashMap<String, Any?>? {
  val mod = row?.get("mapId")?.takeIf(::truthy) ?: row?.get("gameId")?.takeIf(::truthy)
  val level = row?.get("mapName")?.takeIf(::truthy)
  if (mod == null || level == null) return null
  return linkedMapOf(
    "mod" to mod, "level" to level, "mode" to row["gameType"]?.takeIf(::truthy), "name" to row["name"]?.takeIf(::truthy),
    "source" to "live list", "queryPort" to row["queryPort"],
  )
}

/** The `\status\` query: the answer's keys, or null when nothing answered. */
fun gamespyStatus(host: String, port: Int, timeoutMs: Int = 1200): Map<String, String>? {
  val start = System.nanoTime()
  val deadline = start + timeoutMs * 1_000_000L
  val chunks = StringBuilder()
  var got = false
  var settle = Long.MAX_VALUE
  return try {
    DatagramSocket().use { sock ->
      val q = latin1("\\status\\")
      sock.send(DatagramPacket(q, q.size, InetAddress.getByName(host), port))
      val buf = ByteArray(65536)
      while (true) {
        val until = minOf(deadline, settle)
        val left = (until - System.nanoTime()) / 1_000_000L
        if (left <= 0) {
          // The overall timeout, or 150 ms of quiet after the last piece.
          return if (got) parseGamespy(chunks.toString()) else null
        }
        sock.soTimeout = left.toInt().coerceAtLeast(1)
        val p = DatagramPacket(buf, buf.size)
        try { sock.receive(p) } catch (_: SocketTimeoutException) { continue }
        chunks.append(String(buf, 0, p.length, Charsets.ISO_8859_1))
        got = true
        // The answer can span datagrams; `\final\` closes it.
        if (chunks.contains("\\final\\")) return parseGamespy(chunks.toString())
        settle = System.nanoTime() + 150_000_000L
      }
      @Suppress("UNREACHABLE_CODE") null
    }
  } catch (_: Exception) { null }
}

/** fetch(url) with a timeout: the body of a 2xx, else null. */
val httpFetch: (String, Int) -> String? = { url, timeoutMs ->
  val c = URI(url).toURL().openConnection() as HttpURLConnection
  c.connectTimeout = timeoutMs
  c.readTimeout = timeoutMs
  try { if (c.responseCode in 200..299) c.inputStream.bufferedReader().readText() else null } finally { c.disconnect() }
}

private val OFF = Regex("^(off|none|0)$", RegexOption.IGNORE_CASE)

private fun liveListRow(host: String, port: Int, timeoutMs: Int, fetch: ((String, Int) -> String?)?, url: String?): Map<String, Any?>? {
  if (url.isNullOrEmpty() || OFF.matches(url) || fetch == null) return null
  return try {
    val body = fetch(url, timeoutMs) ?: return null
    val j = jsonToJs(Json.parseToJsonElement(body))
    @Suppress("UNCHECKED_CAST")
    val rows = (j as? List<Any?>) ?: (((j as? Map<String, Any?>)?.get("servers")) as? List<Any?>) ?: emptyList()
    @Suppress("UNCHECKED_CAST")
    rows.firstOrNull { r -> (r as? Map<String, Any?>)?.let { it["ip"] == host && jsNumberOf(it["port"]) == port.toDouble() } == true } as Map<String, Any?>?
  } catch (_: Exception) { null }
}

/** Number(v) of a JSON value. */
private fun jsNumberOf(v: Any?): Double = when (v) {
  null -> 0.0
  is Number -> v.toDouble()
  is Boolean -> if (v) 1.0 else 0.0
  is String -> jsNumber(v)
  else -> Double.NaN
}

/**
 * { mod, level, mode, name, source, queryPort } for the server at host:port
 * (`name` its GameSpy hostname or the live list's, raw bytes as latin1), or
 * null when neither source answers within about `timeoutMs`.
 */
fun queryServerLevel(
  host: String, port: Int, queryPort: Int? = null, timeoutMs: Int = 2500,
  fetch: ((String, Int) -> String?)? = httpFetch,
  url: String? = System.getenv("SIDECAR_LIVE_LIST") ?: DEFAULT_LIVE_LIST,
  gamespy: (String, Int, Int) -> Map<String, String>? = ::gamespyStatus,
): Map<String, Any?>? {
  val row = liveListRow(host, port, timeoutMs, fetch, url)
  val listed = levelFromLiveRow(row)
  // The server's own answer is current; the list can be a minute old.
  val guesses: List<Any?> = if (truthy(row?.get("queryPort"))) listOf(row!!["queryPort"]) else listOf(port + 8433, port + 7433)
  val ports = LinkedHashSet<Int>()
  for (p in listOf<Any?>(queryPort) + guesses) {
    val n = jsNumberOf(p)
    if (n == Math.rint(n) && !n.isInfinite() && n > 0) ports.add(n.toInt())
  }
  for (qp in ports) {
    val kv = gamespy(host, qp, minOf(1200, timeoutMs))
    val got = kv?.let { levelFromGamespy(it) }
    if (got != null) {
      got["name"] = got["name"] ?: listed?.get("name")
      got["queryPort"] = qp
      return got
    }
  }
  return listed
}
