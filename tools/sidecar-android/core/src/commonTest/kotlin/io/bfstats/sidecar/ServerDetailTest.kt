package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** ServerDetail.kt: the companion app's server screen model, over the
 *  single-server endpoint's shape (parity/companion/server-detail.json). */
class ServerDetailTest {
  private val fx by lazy { Fixtures.json("companion/server-detail.json") }

  @Test fun teamsAndPlayersBestFirst() {
    val d = parseServerDetail(fx.g("one"))!!
    assertEquals("decoded server name", "Привет сервер", d.server.name)
    assertEquals("address stays raw", "203.0.113.7:14567", d.server.address)
    assertEquals(listOf(1, 2), d.teams.map { it.index })
    assertEquals(listOf("Axis", "Allied"), d.teams.map { it.label })
    assertEquals(listOf(657, 788), d.teams.map { it.tickets })
    // Score, then kills, then fewer deaths, then name; a nameless entry is dropped.
    assertEquals(listOf("Ïðèâåò", "delta", "Echo"), d.teams[0].players.map { it.name })
    assertEquals(listOf("Charlie", "Bravo", "Alpha"), d.teams[1].players.map { it.name })
    assertEquals("display only", "Привет", d.teams[0].players[0].displayName)
    assertEquals(listOf(true, false, false), d.teams[1].players.map { it.bot })
    assertEquals(2, d.bots)
    assertEquals(6, d.players.size)
    assertTrue(d.online)
    assertTrue(d.server.anticheat)
  }

  @Test fun sidesFromThePlayersWhenTeamsAreMissing() {
    val d = parseServerDetail(fx.g("sparse"))!!
    assertEquals(listOf(3), d.teams.map { it.index })
    assertEquals("Spectator", d.teams[0].label)
    assertNull(d.teams[0].tickets)
    assertEquals(12, d.teams[0].players[0].score)
    assertEquals(false, d.online)
    val e = parseServerDetail(fx.g("empty"))!!
    assertEquals(listOf("Team 1", "Team 2"), e.teams.map { it.label })
    assertTrue(e.online)
    assertNull(parseServerDetailBody("Server 1.2.3.4:14567 not found"))
  }

  @Test fun theListKeepsPlayersInTheTrayOrder() {
    val list = parseLiveList(Js.stringify(fx.g("list")))
    assertEquals(listOf("Bulge", "Alpha", "Zulu"), list.map { it.server.name })
    assertEquals(listOf("A", "B"), list[0].players.map { it.name })
    assertEquals(sortServers(normaliseServers(Js.stringify(fx.g("list")))).map { it.address }, list.map { it.server.address })
  }

  @Test fun urlsClocksAndWords() {
    assertEquals("https://bfstats.io/stats/LiveServers/bf1942/203.0.113.7/14567", liveServerUrl("203.0.113.7", 14567))
    assertEquals(140, roundLeft(140, 0))
    assertEquals(130, roundLeft(140, 9_600))
    assertEquals(0, roundLeft(5, 60_000))
    assertNull(roundLeft(null, 0)); assertNull(roundLeft(-1, 0))
    assertEquals("2:20", clockText(140)); assertEquals("0:05", clockText(5)); assertEquals("30:00", clockText(1800))
    assertEquals("Battle Of The Bulge", titleCase("battle_of_the_bulge"))
    assertEquals("Co-op", gameTypeTitle("coop")); assertEquals("Conquest", gameTypeTitle("Conquest")); assertEquals("Capture", gameTypeTitle("capture"))
    assertEquals(Load.IDLE, loadOf(0, 64)); assertEquals(Load.OK, loadOf(10, 64))
    assertEquals(Load.BUSY, loadOf(43, 64)); assertEquals(Load.FULL, loadOf(64, 64))
  }

  @Test fun namesAndAddressesAsTheTrayAppChecksThem() {
    assertNull(sidecarNameError("skandia-sc")); assertNull(sidecarNameError("  "))
    assertEquals("No quotes", sidecarNameError("a\"b"))
    assertEquals("No control characters", sidecarNameError("a\u0001b"))
    assertEquals("Western European (Latin-1) letters only", sidecarNameError("Привет"))
    assertNull(sidecarNameError("Jörg"))
    assertEquals("At most 23 characters", sidecarNameError("a".repeat(24)))
    assertEquals("192.168.1.226" to 14568, parseAddress(" 192.168.1.226:14568 "))
    assertEquals("lab.example" to 14567, parseAddress("Lab.Example"))
    assertNull(parseAddress("999.1.1.1")); assertNull(parseAddress("host:0")); assertNull(parseAddress("-bad-:1"))
    assertNull(parseAddress("a b:1")); assertNull(parseAddress(""))
  }
}
