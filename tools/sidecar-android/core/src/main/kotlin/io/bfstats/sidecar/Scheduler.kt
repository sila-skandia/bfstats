package io.bfstats.sidecar

// The clock and timers the Node sidecar takes from its runtime (Date.now,
// performance.now, setTimeout, setInterval), passed in so a test drives time.
// Not a port of one module: every ported module that reads the time or sets a
// timer takes a Scheduler (or a Clock) instead.
//
// Node runs every callback on one thread, and the ported modules assume it:
// a caller using ExecutorScheduler calls into them only from its thread
// (`post`), as Node's event loop would.

import java.util.PriorityQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** The two clocks Node gives the sidecar, in ms as doubles. */
interface Clock {
  /** Date.now(): wall-clock ms since the epoch. */
  fun wallMs(): Double
  /** performance.now(): monotonic ms since an arbitrary origin. */
  fun monoMs(): Double
}

fun interface Cancellable { fun cancel() }

interface Scheduler {
  val clock: Clock
  /** setTimeout(task, delayMs). */
  fun schedule(delayMs: Double, task: () -> Unit): Cancellable
  /** setInterval(task, periodMs): first run one period from now. */
  fun every(periodMs: Double, task: () -> Unit): Cancellable
  /** Run `task` on the scheduler's thread as soon as it can. */
  fun post(task: () -> Unit): Cancellable = schedule(0.0, task)
}

object SystemClock : Clock {
  private val origin = System.nanoTime()
  override fun wallMs(): Double = System.currentTimeMillis().toDouble()
  override fun monoMs(): Double = (System.nanoTime() - origin) / 1e6
}

/** The real scheduler: one daemon thread, as Node's event loop. */
class ExecutorScheduler(
  override val clock: Clock = SystemClock,
  private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "sidecar-loop").apply { isDaemon = true }
  },
) : Scheduler {
  private fun us(ms: Double) = maxOf(0L, Math.round(ms * 1000))
  private fun guard(task: () -> Unit) = Runnable {
    // A throwing callback must not kill a repeating task (Node logs and goes on).
    try { task() } catch (e: Throwable) { e.printStackTrace() }
  }
  override fun schedule(delayMs: Double, task: () -> Unit): Cancellable {
    val f: ScheduledFuture<*> = executor.schedule(guard(task), us(delayMs), TimeUnit.MICROSECONDS)
    return Cancellable { f.cancel(false) }
  }
  override fun every(periodMs: Double, task: () -> Unit): Cancellable {
    val p = maxOf(1L, us(periodMs))
    val f = executor.scheduleAtFixedRate(guard(task), p, p, TimeUnit.MICROSECONDS)
    return Cancellable { f.cancel(false) }
  }
  fun shutdown() { executor.shutdownNow() }
}

/**
 * A scheduler a test moves by hand. Time stands still until `advanceTo`,
 * which runs every timer due by then in order of due time (ties in the order
 * they were armed; an interval re-arms after it runs), with the clock set to
 * each one's due time while it runs. `wallMs` is `wall0` + the mono clock.
 */
class ManualScheduler(var now: Double = 0.0, private val wall0: Double = 1.8e12) : Scheduler {
  private class Timer(var due: Double, val period: Double?, val task: () -> Unit, var seq: Long) {
    var cancelled = false
  }
  private var seq = 0L
  private val queue = PriorityQueue<Timer>(compareBy<Timer>({ it.due }, { it.seq }))

  override val clock: Clock = object : Clock {
    override fun wallMs() = wall0 + now
    override fun monoMs() = now
  }

  override fun schedule(delayMs: Double, task: () -> Unit): Cancellable = arm(now + maxOf(0.0, delayMs), null, task)
  override fun every(periodMs: Double, task: () -> Unit): Cancellable = arm(now + periodMs, periodMs, task)

  private fun arm(due: Double, period: Double?, task: () -> Unit): Cancellable {
    val t = Timer(due, period, task, seq++)
    queue.add(t)
    return Cancellable { t.cancelled = true; queue.remove(t) }
  }

  fun advanceTo(t: Double) {
    while (true) {
      val next = queue.peek() ?: break
      if (next.due > t) break
      queue.poll()
      if (next.cancelled) continue
      if (next.due > now) now = next.due
      if (next.period != null) { next.due += next.period; next.seq = seq++; queue.add(next) }
      next.task()
    }
    if (t > now) now = t
  }

  fun advanceBy(ms: Double) = advanceTo(now + ms)
  val pending: Int get() = queue.size
}
