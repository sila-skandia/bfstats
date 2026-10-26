package io.bfstats.sidecar

// The clock and timers the Node copies take from the global scope (Date.now,
// setTimeout, setInterval, clearTimeout / clearInterval), passed in so a test
// drives them. Everything a module schedules runs on one thread, as Node runs
// it on one event loop: the real implementation is EventLoop below, and a
// datagram socket posts what it receives onto the same loop.

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

interface Timers {
  /** Date.now(): milliseconds. */
  fun now(): Long
  /** setTimeout(fn, ms). */
  fun setTimeout(ms: Double, fn: () -> Unit): Any
  /** setInterval(fn, ms). */
  fun setInterval(ms: Double, fn: () -> Unit): Any
  /** clearTimeout / clearInterval; null is ignored, as Node ignores it. */
  fun clear(handle: Any?)
  /** Run fn on the loop soon (a socket's 'message', setImmediate). */
  fun post(fn: () -> Unit) { setTimeout(0.0, fn) }
}

/** Node's delay coercion (lib/internal/timers.js Timeout): anything not in
 *  1..2^31-1, NaN included, is 1 ms. */
fun nodeDelay(ms: Double): Double = if (ms >= 1 && ms <= 2147483647.0) ms else 1.0

/** The real loop: one thread runs every timer and every posted callback. */
class EventLoop(name: String = "sidecar-loop") : Timers, AutoCloseable {
  private val exec: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, name).apply { isDaemon = true }
  }

  override fun now(): Long = System.currentTimeMillis()

  private fun guard(fn: () -> Unit): Runnable = Runnable {
    try { fn() } catch (e: Throwable) { Thread.currentThread().uncaughtExceptionHandler?.uncaughtException(Thread.currentThread(), e) }
  }

  override fun setTimeout(ms: Double, fn: () -> Unit): Any =
    exec.schedule(guard(fn), (nodeDelay(ms) * 1000).toLong(), TimeUnit.MICROSECONDS)

  override fun setInterval(ms: Double, fn: () -> Unit): Any {
    val us = (nodeDelay(ms) * 1000).toLong()
    return exec.scheduleAtFixedRate(guard(fn), us, us, TimeUnit.MICROSECONDS)
  }

  override fun clear(handle: Any?) { (handle as? ScheduledFuture<*>)?.cancel(false) }

  override fun post(fn: () -> Unit) { if (!exec.isShutdown) exec.execute(guard(fn)) }

  /** Run fn on the loop and wait for its answer (for callers off the loop). */
  fun <T> call(fn: () -> T): T = exec.submit<T> { fn() }.get()

  override fun close() { exec.shutdown() }
}
