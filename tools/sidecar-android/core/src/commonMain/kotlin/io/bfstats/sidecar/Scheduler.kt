package io.bfstats.sidecar

// The clock and timers the Node sidecar takes from its runtime (Date.now,
// performance.now, setTimeout, setInterval, setImmediate), passed in so a test
// drives time. Not a port of one module: every ported module that reads the
// time or sets a timer takes a Scheduler (or a Clock) instead.
//
// Node runs every callback for one join on one thread, and the ported modules
// assume it. EventLoop is that thread: its timers run on it, and anything
// arriving from elsewhere (the UDP receive thread, the page socket's threads)
// is handed to it with `post`, as Node's event loop queues an I/O callback.
// ManualScheduler is the same contract on a virtual clock for tests, and is
// parity/lib/fake-time.mjs's twin.

import kotlin.concurrent.Volatile

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
  /** Run `task` on the scheduler's thread as soon as it can (setImmediate, an
   *  I/O callback). */
  fun post(task: () -> Unit): Cancellable = schedule(0.0, task)
  /** Date.now() as Node returns it: a whole millisecond. */
  fun now(): Long = Math.floor(clock.wallMs()).toLong()
}

object SystemClock : Clock {
  private val origin = monoNanos()
  override fun wallMs(): Double = wallMillis().toDouble()
  override fun monoMs(): Double = (monoNanos() - origin) / 1e6
}

/** Node's delay coercion (lib/internal/timers.js Timeout): anything not in
 *  1..2^31-1, NaN included, is 1 ms. */
fun nodeDelay(ms: Double): Double = if (ms >= 1 && ms <= 2147483647.0) ms else 1.0

/**
 * The real loop: one daemon thread runs every timer and every posted
 * callback, so the modules see Node's single-threaded order. Callers off the
 * loop use `post` (fire and forget) or `call` (wait for the answer).
 */
class EventLoop(
  name: String = "sidecar-loop",
  override val clock: Clock = SystemClock,
) : Scheduler, AutoCloseable {
  private val exec: LoopExecutor = loopExecutor(name)

  /** Whatever a callback throws: Node would print it and carry on. */
  @Volatile var onError: (Throwable) -> Unit = { printErr(it.stackTraceToString()) }

  private fun guard(task: () -> Unit): () -> Unit = {
    // A throwing callback must not kill a repeating task or the loop.
    try { task() } catch (e: Throwable) { onError(e) }
  }

  private fun us(ms: Double) = Math.round(nodeDelay(ms) * 1000)

  override fun schedule(delayMs: Double, task: () -> Unit): Cancellable {
    if (exec.isShutdown) return Cancellable {}
    return exec.schedule(us(delayMs), guard(task))
  }

  override fun every(periodMs: Double, task: () -> Unit): Cancellable {
    if (exec.isShutdown) return Cancellable {}
    return exec.fixedRate(us(periodMs), guard(task))
  }

  override fun post(task: () -> Unit): Cancellable {
    if (exec.isShutdown) return Cancellable {}
    return exec.submit(guard(task))
  }

  /** True on the loop's own thread. */
  val onLoop: Boolean get() = exec.onLoop

  /** Run fn on the loop and wait for its answer (for callers off the loop;
   *  on the loop it runs at once). */
  fun <T> call(fn: () -> T): T = if (onLoop) fn() else exec.call(fn)

  val closed: Boolean get() = exec.isShutdown

  override fun close() { exec.shutdown() }

  /** Stop at once, dropping what is queued. */
  fun shutdownNow() { exec.shutdownNow() }
}

/**
 * A scheduler a test moves by hand. Time stands still until `advanceTo`,
 * which runs every timer due by then in order of due time (ties in the order
 * they were armed; an interval re-arms before it runs), with the clock set to
 * each one's due time while it runs. `wallMs` is `wall0` + the virtual ms,
 * `monoMs` the virtual ms. parity/lib/fake-time.mjs is the Node half, and
 * both its flavours map here: `installFakeTime(0)` is ManualScheduler(0.0),
 * `fakeClock()` (Date.now from 1,000,000) is ManualScheduler(1e6, 0.0).
 * A posted task runs at the current instant, after what is already due.
 */
class ManualScheduler(var now: Double = 0.0, private val wall0: Double = 1.8e12) : Scheduler {
  private class Timer(var due: Double, val period: Double?, val task: () -> Unit, var seq: Long) {
    var cancelled = false
  }
  private var seq = 0L
  private val queue = Heap<Timer>(compareBy<Timer>({ it.due }, { it.seq }))

  override val clock: Clock = object : Clock {
    override fun wallMs() = wall0 + now
    override fun monoMs() = now
  }

  override fun schedule(delayMs: Double, task: () -> Unit): Cancellable =
    arm(now + (if (delayMs.isNaN()) 0.0 else maxOf(0.0, delayMs)), null, task)
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
  /** fake-time.mjs advance: the same as advanceBy. */
  fun advance(ms: Double) = advanceBy(ms)
  /** Run what is due now (posted tasks included) without moving the clock. */
  fun runDue() = advanceTo(now)
  val pending: Int get() = queue.size
}

/** A binary min-heap (java.util.PriorityQueue's part ManualScheduler uses). */
internal class Heap<T>(private val cmp: Comparator<T>) {
  private val a = ArrayList<T>()
  val size: Int get() = a.size
  fun peek(): T? = a.firstOrNull()
  fun add(x: T) { a.add(x); up(a.size - 1) }
  fun poll(): T? {
    if (a.isEmpty()) return null
    val top = a[0]
    val last = a.removeAt(a.size - 1)
    if (a.isNotEmpty()) { a[0] = last; down(0) }
    return top
  }
  fun remove(x: T): Boolean {
    val i = a.indexOfFirst { it === x }
    if (i < 0) return false
    val last = a.removeAt(a.size - 1)
    if (i < a.size) { a[i] = last; down(i); up(i) }
    return true
  }
  private fun up(i0: Int) {
    var i = i0
    while (i > 0) {
      val p = (i - 1) / 2
      if (cmp.compare(a[i], a[p]) >= 0) break
      val t = a[i]; a[i] = a[p]; a[p] = t; i = p
    }
  }
  private fun down(i0: Int) {
    var i = i0
    while (true) {
      val l = 2 * i + 1; val r = l + 1
      var m = i
      if (l < a.size && cmp.compare(a[l], a[m]) < 0) m = l
      if (r < a.size && cmp.compare(a[r], a[m]) < 0) m = r
      if (m == i) break
      val t = a[i]; a[i] = a[m]; a[m] = t; i = m
    }
  }
}
