package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertTrue
import kotlin.test.Test

/** Sidecar.kt against sidecar.mjs (parity/sidecar.mjs runs the real script
 *  under lib/sidecar-preload.mjs): the same command line and the same script
 *  of server datagrams and page frames, the same transcript line for line:
 *  every datagram out, every frame a page is sent, every console line, the
 *  exit, and the recording and review log. */
class SidecarTest {
  companion object {
    private val fx: Map<String, Any?> by lazy { Fixtures.json("sidecar.json.gz").m() }
  }

  private fun check(name: String) {
    @Suppress("UNCHECKED_CAST")
    val want = fx[name].m()["lines"] as List<String>
    val got = SidecarHarness.run(fx[name].m())
    val d = Fixtures.diff(want, got, name)
    assertTrue(d, d.isEmpty())
  }

  @Test fun capture() = check("capture")
  @Test fun rejoin() = check("rejoin")
  @Test fun namedDenied() = check("namedDenied")
}
