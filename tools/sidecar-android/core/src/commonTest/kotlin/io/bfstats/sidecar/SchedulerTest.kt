package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import io.bfstats.sidecar.Assert.assertTrue
import kotlin.test.Test

/** The two schedulers: ManualScheduler's order is parity/lib/fake-time.mjs's; EventLoop runs for real. */
class SchedulerTest {
  @Test fun manualRunsDueTimersInOrderAtTheirTimes() {
    val s = ManualScheduler(0.0)
    val seen = ArrayList<String>()
    val every = s.every(10.0) { seen.add("i@${s.now}") }
    s.schedule(10.0) { seen.add("t@${s.now}") }
    s.schedule(25.0) { seen.add("u@${s.now}"); s.schedule(0.0) { seen.add("z@${s.now}") } }
    s.advanceTo(30.0)
    assertEquals(listOf("i@10.0", "t@10.0", "i@20.0", "u@25.0", "z@25.0", "i@30.0"), seen)
    assertEquals(1.8e12 + 30, s.clock.wallMs(), 0.0)
    every.cancel()
    s.advanceTo(100.0)
    assertEquals(6, seen.size)
    assertEquals(100.0, s.clock.monoMs(), 0.0)
  }

  @Test fun executorRunsTimersAndIntervals() {
    val s = EventLoop("test-loop")
    try {
      val once = Latch()
      val ticks = Latch()
      var n = 0
      s.schedule(5.0) { once.countDown() }
      val c = s.every(5.0) { if (++n == 3) ticks.countDown() }
      assertTrue(once.await(2000))
      assertTrue(ticks.await(2000))
      c.cancel()
      val t0 = s.clock.monoMs()
      sleepMs(20)
      assertTrue(s.clock.monoMs() - t0 >= 15)
    } finally { s.close() }
  }
}
