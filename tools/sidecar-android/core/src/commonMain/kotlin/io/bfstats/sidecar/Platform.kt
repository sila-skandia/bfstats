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

// ---- the event loop's thread -------------------------------------------------

/** One thread that runs timers and posted tasks in order, as Node's loop
 *  does (EventLoop is built on it). Delays are in microseconds. */
interface LoopExecutor {
  fun schedule(delayUs: Long, task: () -> Unit): Cancellable
  /** At a fixed rate: first run one period from now; a late run is caught up. */
  fun fixedRate(periodUs: Long, task: () -> Unit): Cancellable
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

/** One HTTP answer; header names lower case. */
class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
  val text: String get() = body.decodeToString()
}

class HttpTimeout : RuntimeException("timeout")

/** GET with redirects followed and no content coding; throws HttpTimeout past
 *  `timeoutMs`, anything else when there is no answer. */
expect fun httpGet(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = 10_000): HttpResponse
