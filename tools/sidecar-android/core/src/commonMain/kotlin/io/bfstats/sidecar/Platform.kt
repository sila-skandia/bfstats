package io.bfstats.sidecar

// What the sidecar takes from the platform it runs on, and nothing else: the
// clocks, the environment, threads, UDP and TCP sockets, an HTTP GET. Every
// other line of the port is common Kotlin. jvmMain implements this with
// java.* (the Android app, the :core:sidecar and :core:probe commands);
// nativeMain with ktor-network, ktor-client and POSIX (linuxX64 here, iOS on
// a Mac). The calls block, as java.net's do: the ported modules were written
// for threads, and EventLoop.post is how a result reaches the loop.

// ---- the process ------------------------------------------------------------

/** Date.now(): wall-clock ms since the epoch. */
expect fun wallMillis(): Long

/** A monotonic clock in ns from an arbitrary origin (System.nanoTime). */
expect fun monoNanos(): Long

/** The process environment (only ever read by key). */
expect fun systemEnv(): Map<String, String>

/** The user's home folder (user.home, $HOME). */
expect fun userHome(): String

/** process.platform: "win32", "darwin" or "linux" (Android and every other
 *  Unix included). */
expect fun nodePlatform(): String

/** console.error: one line to stderr. */
expect fun printErr(line: String)

/** One line to stdout, flushed (console.log). */
expect fun printOut(line: String)

/** Lines from stdin until it closes (null at the end). Blocking. */
expect fun readStdinLine(): String?

expect fun exitProcess(code: Int): Nothing

expect fun sleepMs(ms: Long)

/** A daemon thread running `task` (the JVM's Thread, a native worker). */
expect fun startThread(name: String, task: () -> Unit)

/** crypto.randomInt(max): uniform in 0 until max, from the OS's CSPRNG. */
expect fun secureRandomInt(max: Int): Int

/** chmod 600, where the platform has modes ({ mode: 0o600 }). */
expect fun setOwnerOnly(path: String)

/** fs.statSync(path).mtimeMs, rounded down to the ms; null when unknown. */
expect fun fileMtimeMs(path: String): Long?

/** fs.statSync(path).mtimeMs exactly as Node computes it from the stat's
 *  seconds and nanoseconds (`mtimeMsOf`), fraction and all; null when
 *  unknown (and always on iOS, which has no game install to fingerprint). */
expect fun fileMtimeMsExact(path: String): Double?

/** Node's msFromTimeSpec (lib/internal/fs/utils.js): `sec * 1e3 + nsec / 1e6`
 *  in doubles. */
fun mtimeMsOf(sec: Long, nsec: Long): Double = sec.toDouble() * 1e3 + nsec.toDouble() / 1e6

// ---- the event loop's thread -------------------------------------------------

/** One thread that runs timers and posted tasks in order, as Node's loop
 *  does (EventLoop is built on it). Delays are in microseconds. There is no
 *  repeating timer here: EventLoop.every re-arms a `schedule` from each run,
 *  as Node's setInterval does, rather than catching missed ticks up. */
interface LoopExecutor {
  fun schedule(delayUs: Long, task: () -> Unit): Cancellable
  fun submit(task: () -> Unit): Cancellable
  /** Run fn on the thread and wait for its answer. Not on the thread itself. */
  fun <T> call(fn: () -> T): T
  /** True on the executor's own thread. */
  val onLoop: Boolean
  val isShutdown: Boolean
  /** Stop taking work; what is queued is dropped once the thread gets to it. */
  fun shutdown()
  fun shutdownNow()
}

expect fun loopExecutor(name: String): LoopExecutor

// ---- sockets --------------------------------------------------------------------

/** A socket address as the sidecar uses one: a literal host and a port. */
data class SockAddr(val host: String, val port: Int) {
  override fun toString() = "$host:$port"
}

class SocketTimeout : Exception("timed out")

/** A UDP socket (java.net.DatagramSocket's shape). Not bound until `bind` or
 *  the first send, which binds an ephemeral port on every interface. */
interface UdpSocket : AutoCloseable {
  /** Bind `port` (0: any) on every interface; returns the local address. */
  fun bind(port: Int = 0): SockAddr
  fun send(b: ByteArray, host: String, port: Int)
  /** The next datagram into `buf`: its length and sender. Throws SocketTimeout
   *  after `timeoutMs` (0: wait for ever), anything else once closed. */
  fun receive(buf: ByteArray, timeoutMs: Int = 0): Pair<Int, SockAddr>
  override fun close()
}

expect fun udpSocket(): UdpSocket

/** One TCP connection, blocking. */
interface TcpConn : AutoCloseable {
  /** Up to len bytes into b at off; -1 at the end of the stream. */
  fun read(b: ByteArray, off: Int, len: Int): Int
  fun write(b: ByteArray)
  override fun close()
}

interface TcpListener : AutoCloseable {
  val port: Int
  /** The next connection; throws once closed. */
  fun accept(): TcpConn
  override fun close()
}

/** A listening socket on host:port (0: any), address reuse on. */
expect fun tcpListen(host: String, port: Int): TcpListener

expect fun tcpConnect(host: String, port: Int): TcpConn

/** One byte, or -1 at the end of the stream. */
fun TcpConn.read(): Int {
  val b = ByteArray(1)
  while (true) {
    val n = read(b, 0, 1)
    if (n < 0) return -1
    if (n == 1) return b[0].toInt() and 0xff
  }
}

// ---- HTTP -------------------------------------------------------------------------

/** One HTTP answer; header names lower case; the body decoded from any gzip. */
class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
  /** res.text(): UTF-8, a leading BOM dropped, a bad sequence U+FFFD. */
  val text: String get() = body.decodeToString().removePrefix("\uFEFF")
}

class HttpTimeout : RuntimeException("timeout")

/** fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }) as the
 *  sidecar uses it: a GET that follows redirects (http to https included),
 *  asks for gzip and hands back the decoded body, and throws HttpTimeout once
 *  `timeoutMs` has passed since the call, whatever it was doing (resolving
 *  the name, connecting, waiting, reading); anything else when there is no
 *  answer. */
expect fun httpGet(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = 10_000): HttpResponse
