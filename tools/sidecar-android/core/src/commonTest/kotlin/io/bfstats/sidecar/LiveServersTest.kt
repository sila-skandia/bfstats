package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** LiveServers.kt against the tray app's servers.js and map-image.js
 *  (parity/live-servers.mjs): the list normalised and sorted, the map image
 *  addresses, the slugs and the decoded names. */
class LiveServersTest {
  private val fx by lazy { Fixtures.loadJs("live-servers") }

  private fun js(s: LiveServer): Map<String, Any?> = linkedMapOf(
    "name" to s.name, "ip" to s.ip, "port" to s.port.toDouble(), "mapId" to s.mapId, "gameId" to s.gameId,
    "mapName" to s.mapName, "thumb" to s.thumb, "gameType" to s.gameType,
    "numPlayers" to s.numPlayers.toDouble(), "maxPlayers" to s.maxPlayers.toDouble(),
    "anticheat" to s.anticheat, "password" to s.password,
    "roundTimeRemain" to s.roundTimeRemain?.toDouble(), "tickets1" to s.tickets1?.toDouble(), "tickets2" to s.tickets2?.toDouble(),
    "team1" to s.team1, "team2" to s.team2, "country" to s.country,
  )

  @Test fun listsMatchTheTrayApp() {
    for ((name, c) in fx["cases"].m()) {
      val got = sortServers(normaliseServers(c.g("body") as String)).map { js(it) }
      assertEquals(name, Js.stringify(c.g("servers")), Js.stringify(got))
    }
  }

  @Test fun imagesSlugsAndNames() {
    for (x in fx["images"].l()) { val r = x.l(); assertEquals("image $r", r[2], mapImageUrl(r[0] as String?, r[1] as String?)) }
    for (x in fx["slugs"].l()) { val r = x.l(); assertEquals("slug $r", r[1], mapSlug(r[0] as String?)) }
    for (x in fx["names"].l()) { val r = x.l(); assertEquals("name $r", r[1] ?: "", decodeName(r[0] as String?)) }
  }
}
