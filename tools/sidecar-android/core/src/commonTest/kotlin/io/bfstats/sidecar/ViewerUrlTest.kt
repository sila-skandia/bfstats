package io.bfstats.sidecar

import kotlin.test.Test
import kotlin.test.assertEquals

class ViewerUrlTest {
  @Test fun noServerNameIsTheBareJoin() {
    assertEquals("https://play.bfstats.io/map.html?sidecar=127.0.0.1:17942", viewerUrl(17942))
    assertEquals("https://play.bfstats.io/map.html?sidecar=127.0.0.1:17942", viewerUrl(17942, serverName = "  "))
  }

  @Test fun theServerNameRidesAsUtf8() {
    assertEquals(
      "https://play.bfstats.io/map.html?sidecar=127.0.0.1:1&server=%7CHvM%7C%20Br%C3%BCcke%20%26%20Co",
      viewerUrl(1, serverName = " |HvM| Brücke & Co "))
  }
}
