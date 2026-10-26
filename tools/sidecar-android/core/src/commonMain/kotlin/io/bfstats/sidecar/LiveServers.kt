package io.bfstats.sidecar

// The live server list bfstats.io shows (port of sidecar-desktop
// src/servers.js): fetch, keep the fields the list uses, sort.


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

// servers.js `intOrNull`: a finite number (or numeric string) truncated, else null.
private fun intOrNull(v: Any?): Int? {
  if (v == null || v === Undefined || v == "") return null
  val n = JsOps.toNumber(v)
  return if (n.isFinite()) n.toLong().toInt() else null
}

private fun teamLabel(teams: Any?, index: Int): String? {
  val t = (teams as? List<*>)?.firstOrNull { JsOps.eq(it.g("index"), index.toDouble()) }
  val label = t.g("label") as? String ?: return null
  return JsOps.trim(label).takeIf { it.isNotEmpty() }?.take(24)
}

private val COUNTRY = Regex("^[A-Z]{2}$")

/** Keep only the fields the list uses, and only entries with an address
 *  (servers.js `normalise`, over the body as JSON.parse reads it). The counts
 *  are whole numbers here (the app draws them as such; Node keeps what
 *  Number() makes of them, which for the live list's integers is the same). */
fun normaliseServers(body: String): List<LiveServer> {
  val root = try { JsOps.parse(body) } catch (_: Exception) { return emptyList() }
  val list = root.g("servers") as? List<*> ?: return emptyList()
  return list.mapNotNull { s ->
    val ip = s.g("ip") as? String ?: return@mapNotNull null
    if (!JsOps.isInt(s.g("port"))) return@mapNotNull null
    val port = JsOps.toNumber(s.g("port")).toInt()
    fun count(v: Any?) = JsOps.toNumber(if (JsOps.nullish(v)) 0.0 else v).let { if (it.isNaN()) 0 else it.toLong().toInt() }
    LiveServer(
      name = decodeName(JsOps.str(JsOps.coalesce(s.g("name")) { "$ip:$port" })),
      ip = ip, port = port,
      mapId = JsOps.coalesce(s.g("mapId")) { null }?.let { JsOps.str(it) },
      gameId = s.g("gameId") as? String,
      mapName = JsOps.coalesce(s.g("mapName")) { null }?.let { JsOps.str(it) },
      gameType = JsOps.coalesce(s.g("gameType")) { null }?.let { JsOps.str(it) },
      numPlayers = count(s.g("numPlayers")),
      maxPlayers = count(s.g("maxPlayers")),
      anticheat = s.g("anticheat") == true,
      password = s.g("password") == true,
      roundTimeRemain = intOrNull(s.g("roundTimeRemain")),
      tickets1 = intOrNull(s.g("tickets1")),
      tickets2 = intOrNull(s.g("tickets2")),
      team1 = teamLabel(s.g("teams"), 1),
      team2 = teamLabel(s.g("teams"), 2),
      country = (s.g("country") as? String)?.takeIf { COUNTRY.matches(it) },
    )
  }
}

/** Populated servers first (most players first), then by name as
 *  `localeCompare` orders them (jsLocaleCompare). */
fun sortServers(list: List<LiveServer>): List<LiveServer> =
  list.sortedWith { a, b -> (b.numPlayers - a.numPlayers).takeIf { it != 0 } ?: jsLocaleCompare(a.name, b.name) }

// `String#localeCompare` as Node's ICU root collation orders the names a
// server list holds: three levels (base character; accent; case, lower
// first), with whitespace, then punctuation, then symbols, then currency,
// then digits, then letters, the ASCII marks in CLDR root's order. Kotlin/Native
// has no ICU, so this is a table of what the live list carries (Latin
// letters with their accents); anything else orders by code point after the
// letters. Held to Node by live-servers.json.
private const val ROOT_MARKS = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~\$"
private val ACCENTED = mapOf(
  'à' to "a1", 'á' to "a2", 'â' to "a3", 'ã' to "a4", 'ä' to "a5", 'å' to "a6", 'æ' to "ae",
  'ç' to "c1", 'è' to "e1", 'é' to "e2", 'ê' to "e3", 'ë' to "e4", 'ì' to "i1", 'í' to "i2", 'î' to "i3", 'ï' to "i4",
  'ñ' to "n1", 'ò' to "o1", 'ó' to "o2", 'ô' to "o3", 'õ' to "o4", 'ö' to "o5", 'ø' to "o6", 'ù' to "u1", 'ú' to "u2",
  'û' to "u3", 'ü' to "u4", 'ý' to "y1", 'ÿ' to "y2", 'ß' to "ss",
)
private class Coll(val primary: List<Int>, val secondary: List<Int>, val tertiary: List<Int>)
private fun collationOf(s: String): Coll {
  val p = ArrayList<Int>(); val sec = ArrayList<Int>(); val ter = ArrayList<Int>()
  for (c in s) {
    val lower = c.lowercaseChar()
    val upper = c != lower
    val acc = ACCENTED[lower]
    when {
      JsOps.isJsSpace(c) -> { p += 1; sec += 0; ter += 0 }
      ROOT_MARKS.indexOf(c) >= 0 -> { p += 100 + ROOT_MARKS.indexOf(c); sec += 0; ter += 0 }
      c in '0'..'9' -> { p += 1000 + (c - '0'); sec += 0; ter += 0 }
      lower in 'a'..'z' -> { p += 2000 + (lower - 'a'); sec += 0; ter += if (upper) 1 else 0 }
      acc != null && acc[1] in 'a'..'z' -> for (x in acc) { p += 2000 + (x - 'a'); sec += 0; ter += if (upper) 1 else 0 }
      acc != null -> { p += 2000 + (acc[0] - 'a'); sec += acc[1] - '0'; ter += if (upper) 1 else 0 }
      else -> { p += 10000 + c.code; sec += 0; ter += 0 }
    }
  }
  return Coll(p, sec, ter)
}
private fun cmpLists(a: List<Int>, b: List<Int>): Int {
  for (i in 0 until minOf(a.size, b.size)) if (a[i] != b[i]) return a[i].compareTo(b[i])
  return a.size.compareTo(b.size)
}
fun jsLocaleCompare(a: String, b: String): Int {
  val x = collationOf(a); val y = collationOf(b)
  return cmpLists(x.primary, y.primary).takeIf { it != 0 } ?: cmpLists(x.secondary, y.secondary).takeIf { it != 0 }
    ?: cmpLists(x.tertiary, y.tertiary)
}

/** Blocking fetch; call it off the main thread. */
fun fetchServers(url: String = LIVE_URL, timeoutMs: Int = 10_000): List<LiveServer> {
  val r = httpGet(url, mapOf("accept" to "application/json"), timeoutMs.toLong())
  if (r.status !in 200..299) throw RuntimeException("HTTP ${r.status}")
  return sortServers(normaliseServers(r.text))
}

const val ASSETS_BASE = "https://bfstats.io/stats/assets/maps/"

/** `Battle of the Bulge` and `battle_of_the_bulge` -> `battle_of_the_bulge`
 *  (JS trim and `\s`, so a non-breaking space is a space). */
fun mapSlug(mapName: String?): String = JsOps.trim(mapName ?: "").lowercase().replace(Regex("[$JS_WS]+"), "_")

/** A map's preview image (sidecar-desktop src/map-image.js, ui/src/utils/mapImage.ts;
 *  keep in sync), or null when the list gives no mod or map. */
fun mapImageUrl(gameId: String?, mapName: String?, base: String = ASSETS_BASE): String? {
  val mod = JsOps.trim(gameId ?: "").lowercase()
  val map = mapSlug(mapName)
  if (mod.isEmpty() || map.isEmpty()) return null
  fun enc(v: String) = encodeURIComponent(v)
  return "$base${enc(mod)}/${enc(map)}"
}

/** JS encodeURIComponent: letters, digits and `-_.!~*'()` stay, every other
 *  UTF-8 byte is %XX (map-image.js). */
fun encodeURIComponent(v: String): String {
  val sb = StringBuilder()
  for (b in v.encodeToByteArray()) {
    val c = b.toInt() and 0xff
    val ch = c.toChar()
    if (ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9' || ch in "-_.!~*'()") sb.append(ch)
    else sb.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
  }
  return sb.toString()
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
