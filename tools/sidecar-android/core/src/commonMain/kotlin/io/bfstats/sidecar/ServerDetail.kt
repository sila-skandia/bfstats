package io.bfstats.sidecar

// The bfstats.io companion app's server screen: one live server with its
// teams and the players on them. Not a port of the Node sidecar (the tray app
// shows no players), so it has no parity fixture; ServerDetailTest holds it.
//
// GET /stats/LiveServers/bf1942/{ip}/{port} (api LiveServersController
// GetServer, edge-cached 10 s) answers with one ServerSummary: the same object
// as an entry of the live list (LIVE_URL), players and teams included, and 404
// once BFList no longer has the server. The live list carries the players too,
// so a server opened from the list draws at once and the single fetch only
// refreshes it.

const val LIVE_SERVER_BASE = "https://bfstats.io/stats/LiveServers/bf1942/"

/** The single-server endpoint for an address (raw ip and port: an identifier,
 *  never a decoded name). */
fun liveServerUrl(ip: String, port: Int, base: String = LIVE_SERVER_BASE): String =
  "$base${encodeURIComponent(ip)}/$port"

/** A player as the live list reports them. [name] is the stored name (the
 *  identifier a profile link uses); [displayName] is it decoded for the eye. */
data class LivePlayer(
  val name: String,
  val score: Int,
  val kills: Int,
  val deaths: Int,
  val ping: Int,
  val team: Int,
  val bot: Boolean,
) {
  val displayName get() = decodeName(name)
}

/** A side: its label ("Team N" when the server gives none), tickets, and its
 *  players best first ([sortPlayers]). */
data class LiveTeam(val index: Int, val label: String, val tickets: Int?, val players: List<LivePlayer>)

data class ServerDetail(
  val server: LiveServer,
  val teams: List<LiveTeam>,
  /** The body's `isOnline`; a missing field counts as online. */
  val online: Boolean,
) {
  val players: List<LivePlayer> get() = teams.flatMap { it.players }
  val bots: Int get() = players.count { it.bot }
}

private fun whole(v: Any?): Int = intOrNull(v) ?: 0

/** Score first, then kills, then fewer deaths, then the name as the list
 *  orders names (the site's roster sorts by score). */
fun sortPlayers(list: List<LivePlayer>): List<LivePlayer> = list.sortedWith { a, b ->
  (b.score - a.score).takeIf { it != 0 } ?: (b.kills - a.kills).takeIf { it != 0 }
    ?: (a.deaths - b.deaths).takeIf { it != 0 } ?: jsLocaleCompare(a.displayName, b.displayName)
}

/** One server object (a live list entry or the single endpoint's body) with
 *  its players split by team; null without an address. Teams are the body's
 *  `teams` in index order, plus any side a player is on that `teams` lacks;
 *  with neither, the two default sides. */
fun parseServerDetail(s: Any?): ServerDetail? {
  val server = normaliseServer(s) ?: return null
  val players = (s.g("players") as? List<*>).orEmpty().mapNotNull { p ->
    val name = p.g("name") as? String ?: return@mapNotNull null
    LivePlayer(
      name = name,
      score = whole(p.g("score")), kills = whole(p.g("kills")), deaths = whole(p.g("deaths")),
      ping = whole(p.g("ping")), team = whole(p.g("team")), bot = p.g("aiBot") == true,
    )
  }
  val declared = (s.g("teams") as? List<*>).orEmpty().mapNotNull { t -> intOrNull(t.g("index"))?.let { it to t } }.toMap()
  val indices = (declared.keys + players.map { it.team }).distinct().sorted().ifEmpty { listOf(1, 2) }
  val teams = indices.map { i ->
    val t = declared[i]
    val fromPlayer = (s.g("players") as? List<*>).orEmpty()
      .firstOrNull { whole(it.g("team")) == i }?.g("teamLabel") as? String
    val label = teamLabel(s.g("teams"), i)
      ?: fromPlayer?.let { JsOps.trim(it).takeIf { l -> l.isNotEmpty() }?.take(24) }
      ?: "Team $i"
    val tickets = intOrNull(t.g("tickets")) ?: when (i) { 1 -> server.tickets1; 2 -> server.tickets2; else -> null }
    LiveTeam(i, label, tickets, sortPlayers(players.filter { it.team == i }))
  }
  return ServerDetail(server, teams, online = s.g("isOnline") != false)
}

/** The single-server endpoint's body; null when it is not a server. */
fun parseServerDetailBody(body: String): ServerDetail? =
  try { parseServerDetail(JsOps.parse(body)) } catch (_: Exception) { null }

/** The live list with its players, busiest first ([sortServers]'s order). */
fun parseLiveList(body: String): List<ServerDetail> {
  val root = try { JsOps.parse(body) } catch (_: Exception) { return emptyList() }
  val all = (root.g("servers") as? List<*>).orEmpty().mapNotNull(::parseServerDetail)
  val byAddress = all.associateBy { it.server.address }
  return sortServers(all.map { it.server }).mapNotNull { byAddress[it.address] }
}

/** Blocking; call it off the main thread. */
fun fetchLiveList(url: String = LIVE_URL, timeoutMs: Int = 10_000): List<ServerDetail> {
  val r = httpGet(url, mapOf("accept" to "application/json"), timeoutMs.toLong())
  if (r.status !in 200..299) throw RuntimeException("HTTP ${r.status}")
  return parseLiveList(r.text)
}

/** One server, blocking. Null when the site no longer lists it (404: the
 *  server went offline); any other failure throws. */
fun fetchServerDetail(ip: String, port: Int, base: String = LIVE_SERVER_BASE, timeoutMs: Int = 10_000): ServerDetail? {
  val r = httpGet(liveServerUrl(ip, port, base), mapOf("accept" to "application/json"), timeoutMs.toLong())
  if (r.status == 404) return null
  if (r.status !in 200..299) throw RuntimeException("HTTP ${r.status}")
  return parseServerDetailBody(r.text) ?: throw RuntimeException("Not a server")
}

// ---- what the screens print (the tray panel's panel.js, kept in step) -------

/** Seconds of the round left, counting down from the value fetched
 *  [elapsedMs] ago (panel.js roundLeft); null when the server gives none. */
fun roundLeft(roundTimeRemain: Int?, elapsedMs: Long): Int? {
  if (roundTimeRemain == null || roundTimeRemain < 0) return null
  return maxOf(0, JsOps.round(roundTimeRemain - elapsedMs / 1000.0).toInt())
}

/** `m:ss` (panel.js clockText). */
fun clockText(seconds: Int): String = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"

private val GAME_TYPES = mapOf(
  "conquest" to "Conquest", "ctf" to "CTF", "tdm" to "TDM", "coop" to "Co-op",
  "objectivemode" to "Objective", "objective" to "Objective",
)

/** `kharkov` and `battle_of_the_bulge` -> `Kharkov`, `Battle Of The Bulge`
 *  (panel.js title). */
fun titleCase(s: String?): String =
  (s ?: "").replace('_', ' ').replace(Regex("\\b([a-z])")) { it.value.uppercase() }

/** `conquest` -> `Conquest`, `coop` -> `Co-op` (panel.js gameType). */
fun gameTypeTitle(t: String?): String = if (t.isNullOrEmpty()) "" else GAME_TYPES[t.lowercase()] ?: titleCase(t)

/** How full a server is, as the panel tints its bar (panel.js loadOf). */
enum class Load { IDLE, OK, BUSY, FULL }

fun loadOf(numPlayers: Int, maxPlayers: Int): Load {
  if (numPlayers <= 0) return Load.IDLE
  val r = if (maxPlayers > 0) numPlayers.toDouble() / maxPlayers else 0.0
  return when { r >= 1 -> Load.FULL; r >= 0.66 -> Load.BUSY; else -> Load.OK }
}

/** Why a name cannot be joined with, or null when it can (the tray app's
 *  address.js sidecarNameError). Blank is not an error here; the caller asks
 *  for a name. */
fun sidecarNameError(name: String?): String? {
  val t = JsOps.trim(name ?: "")
  if (t.isEmpty()) return null
  if ('"' in t) return "No quotes"
  if (t.any { it.code <= 0x1f || it.code in 0x7f..0x9f }) return "No control characters"
  if (t.any { it.code > 0xff }) return "Western European (Latin-1) letters only"
  if (t.length > 23) return "At most 23 characters"
  return null
}

private val IPV4 = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
private val LABEL = Regex("^(?!-)[a-z0-9-]{1,63}(?<!-)$", RegexOption.IGNORE_CASE)
private val HOST_PORT = Regex("^([^:\\s/]+)(?::(\\d{1,5}))?$")

/** `host[:port]` -> host and port, or null (address.js parseAddress; the
 *  port defaults to 14567). */
fun parseAddress(text: String?, defaultPort: Int = 14567): Pair<String, Int>? {
  val t = JsOps.trim(text ?: "")
  if (t.isEmpty() || t.length > 260) return null
  val m = HOST_PORT.matchEntire(t) ?: return null
  val host = m.groupValues[1].lowercase()
  val port = m.groups[2]?.value?.toInt() ?: defaultPort
  if (port !in 1..65535) return null
  fun isHostname(h: String): Boolean {
    if (h.length > 253 || h.endsWith('.')) return false
    val labels = h.split('.')
    if (labels.all { l -> l.isNotEmpty() && l.all { it in '0'..'9' } }) return false
    return labels.all { LABEL.matches(it) }
  }
  if (!IPV4.matches(host) && !isHostname(host)) return null
  return host to port
}
