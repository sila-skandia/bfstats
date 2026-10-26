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

  /** setInterval after a stall: Node fires once and re-arms a period on, it
   *  does not run the missed ticks back to back (fixed rate would run ~7). */
  @Test fun intervalAfterAStallFiresOnceNotEveryMissedTick() {
    val s = EventLoop("test-stall")
    try {
      val times = ArrayList<Double>()
      val c = s.every(20.0) { times.add(s.clock.monoMs()) }
      s.post { sleepMs(150) }
      sleepMs(185)
      c.cancel()
      val ran = s.call { times.toList() }
      // One run at the stall's end (~150 ms), maybe one more a period on.
      assertTrue("ticks $ran", ran.size in 1..2)
      if (ran.size == 2) assertTrue("ticks $ran", ran[1] - ran[0] >= 15)
    } finally { s.close() }
  }

  /** A microtask queued inside a callback runs when it returns, ahead of a
   *  task posted earlier (a resolved promise's then before the next datagram). */
  @Test fun microtaskRunsBeforeQueuedTasks() {
    val s = EventLoop("test-micro")
    try {
      val seen = ArrayList<String>()
      val done = Latch()
      s.post {
        s.post { seen.add("posted"); done.countDown() }
        s.microtask { seen.add("micro1"); s.microtask { seen.add("micro2") } }
        seen.add("task")
      }
      assertTrue(done.await(2000))
      assertEquals(listOf("task", "micro1", "micro2", "posted"), s.call { seen.toList() })
      // Off the loop it is a post.
      val off = Latch()
      s.microtask { off.countDown() }
      assertTrue(off.await(2000))
    } finally { s.close() }
  }

  /** A throw in a loop task is printed, handed to onUncaught, and the loop
   *  carries on (Node's process would end: Sidecar uses the hook for that). */
  @Test fun aThrowReachesOnUncaughtAndTheLoopCarriesOn() {
    val s = EventLoop("test-throw")
    try {
      val seen = ArrayList<String>()
      s.onError = { seen.add("printed ${it.message}") }
      s.onUncaught = { seen.add("uncaught ${it.message}") }
      val done = Latch()
      s.post { throw IllegalStateException("boom") }
      s.post { seen.add("after"); done.countDown() }
      assertTrue(done.await(2000))
      assertEquals(listOf("printed boom", "uncaught boom", "after"), s.call { seen.toList() })
    } finally { s.close() }
  }
}
