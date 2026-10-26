package io.bfstats.sidecar

// The live server list bfstats.io shows (port of sidecar-desktop
// src/servers.js): fetch, keep the fields the list uses, sort.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

const val LIVE_URL = "https://bfstats.io/stats/LiveServers/bf1942/servers"

data class LiveServer(
  val name: String,
  val ip: String,
  val port: Int,
  val mapId: String?,
  val gameId: String?,
  val mapName: String?,
  val gameType: String?,
  val numPlayers: Int,
  val maxPlayers: Int,
  val anticheat: Boolean,
  val password: Boolean,
  val roundTimeRemain: Int?,
  val tickets1: Int?,
  val tickets2: Int?,
  val team1: String?,
  val team2: String?,
  val country: String?,
) {
  val address get() = "$ip:$port"
  val thumb get() = mapImageUrl(gameId, mapName)
}

// Server names arrive as cp1251 bytes read as cp1252 when the server is
// Cyrillic; decoded for display only, as the site does
// (ui/src/utils/playerName.ts, api/Utils/PlayerNameDecoder.cs; keep in sync).
private val CP1252_HIGH = mapOf(
  '€' to 0x80, '‚' to 0x82, 'ƒ' to 0x83, '„' to 0x84, '…' to 0x85, '†' to 0x86,
  '‡' to 0x87, 'ˆ' to 0x88, '‰' to 0x89, 'Š' to 0x8a, '‹' to 0x8b, 'Œ' to 0x8c,
  'Ž' to 0x8e, '‘' to 0x91, '’' to 0x92, '“' to 0x93, '”' to 0x94, '•' to 0x95,
  '–' to 0x96, '—' to 0x97, '˜' to 0x98, '™' to 0x99, 'š' to 0x9a, '›' to 0x9b,
  'œ' to 0x9c, 'ž' to 0x9e, 'Ÿ' to 0x9f,
)

fun decodeName(raw: String?): String {
  if (raw.isNullOrEmpty()) return raw ?: ""
  val bytes = ByteArray(raw.length) { i ->
    val c = raw[i]
    (CP1252_HIGH[c] ?: if (c.code <= 0xff) c.code else 0x3f).toByte()
  }
  var latin = 0; var nonLatin = 0
  for (b in bytes) {
    val u = b.toInt() and 0xff
    if (u in 65..90 || u in 97..122) latin++ else if (u >= 192) nonLatin++
  }
  val total = latin + nonLatin
  return if (total > 0 && nonLatin.toDouble() / total >= 0.8) cp1251String(bytes) else raw
}

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
private fun JsonObject.intOrNull(k: String): Int? = num(k)?.toInt()

private fun teamLabel(teams: JsonArray?, index: Int): String? {
  val t = teams?.firstOrNull { (it as? JsonObject)?.get("index")?.let { v -> (v as? JsonPrimitive)?.intOrNull } == index } as? JsonObject
  return t?.str("label")?.trim()?.takeIf { it.isNotEmpty() }?.take(24)
}

/** Keep only the fields the list uses, and only entries with an address. */
fun normaliseServers(body: String): List<LiveServer> {
  val root = Json.parseToJsonElement(body) as? JsonObject ?: return emptyList()
  val list = root["servers"] as? JsonArray ?: return emptyList()
  return list.mapNotNull { e ->
    val s = e as? JsonObject ?: return@mapNotNull null
    val ip = s.str("ip") ?: return@mapNotNull null
    val port = s.num("port")?.takeIf { it == Math.floor(it) }?.toInt() ?: return@mapNotNull null
    val mapId = (s["mapId"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    LiveServer(
      name = decodeName(s.str("name") ?: "$ip:$port"),
      ip = ip, port = port,
      mapId = mapId,
      gameId = s.str("gameId"),
      mapName = s.str("mapName"),
      gameType = s.str("gameType"),
      numPlayers = s.intOrNull("numPlayers") ?: 0,
      maxPlayers = s.intOrNull("maxPlayers") ?: 0,
      anticheat = (s["anticheat"] as? JsonPrimitive)?.booleanOrNull == true,
      password = (s["password"] as? JsonPrimitive)?.booleanOrNull == true,
      roundTimeRemain = s.intOrNull("roundTimeRemain"),
      tickets1 = s.intOrNull("tickets1"),
      tickets2 = s.intOrNull("tickets2"),
      team1 = teamLabel(s["teams"] as? JsonArray, 1),
      team2 = teamLabel(s["teams"] as? JsonArray, 2),
      country = s.str("country")?.takeIf { Regex("^[A-Z]{2}$").matches(it) },
    )
  }
}

/** Populated servers first (most players first), then the empty ones by name. */
fun sortServers(list: List<LiveServer>): List<LiveServer> =
  list.sortedWith(compareByDescending<LiveServer> { it.numPlayers }.thenBy { it.name })

/** Blocking fetch; call it off the main thread. */
fun fetchServers(url: String = LIVE_URL, timeoutMs: Int = 10_000): List<LiveServer> {
  val r = httpGet(url, mapOf("accept" to "application/json"), timeoutMs.toLong())
  if (r.status !in 200..299) throw RuntimeException("HTTP ${r.status}")
  return sortServers(normaliseServers(r.text))
}

const val ASSETS_BASE = "https://bfstats.io/stats/assets/maps/"

/** `Battle of the Bulge` and `battle_of_the_bulge` -> `battle_of_the_bulge`. */
fun mapSlug(mapName: String?): String = (mapName ?: "").trim().lowercase().replace(Regex("\\s+"), "_")

/** A map's preview image (sidecar-desktop src/map-image.js, ui/src/utils/mapImage.ts;
 *  keep in sync), or null when the list gives no mod or map. */
fun mapImageUrl(gameId: String?, mapName: String?, base: String = ASSETS_BASE): String? {
  val mod = (gameId ?: "").trim().lowercase()
  val map = mapSlug(mapName)
  if (mod.isEmpty() || map.isEmpty()) return null
  fun enc(v: String) = urlEncode(v)
  return "$base${enc(mod)}/${enc(map)}"
}

/** URLEncoder.encode(v, UTF-8) with a space as %20: letters, digits and
 *  `.-*_` stay, every other UTF-8 byte is %XX. */
fun urlEncode(v: String): String {
  val sb = StringBuilder()
  for (b in v.encodeToByteArray()) {
    val c = b.toInt() and 0xff
    val ch = c.toChar()
    if (ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9' || ch == '.' || ch == '-' || ch == '*' || ch == '_') sb.append(ch)
    else sb.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
  }
  return sb.toString()
}
