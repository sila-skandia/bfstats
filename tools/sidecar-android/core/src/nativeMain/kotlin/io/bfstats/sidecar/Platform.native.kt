package io.bfstats.sidecar

// Platform.kt on Kotlin/Native (linuxX64 here; iosArm64 and
// iosSimulatorArm64 share this file on a Mac): ktor-network for the sockets,
// ktor-client for HTTP (the engine per OS: HttpEngine.*.kt), POSIX for the
// rest, a coroutine dispatcher on one thread for the loop. ktor's calls
// suspend; these wrap them in runBlocking so the common code keeps the
// blocking shape java.net gives it.

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.HttpTimeout as KtorHttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsBytes
import io.ktor.network.selector.SelectorManager
import io.ktor.network.sockets.BoundDatagramSocket
import io.ktor.network.sockets.Datagram
import io.ktor.network.sockets.InetSocketAddress
import io.ktor.network.sockets.ServerSocket
import io.ktor.network.sockets.Socket
import io.ktor.network.sockets.aSocket
import io.ktor.network.sockets.openReadChannel
import io.ktor.network.sockets.openWriteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.readAvailable
import io.ktor.utils.io.writeFully
import io.ktor.client.engine.HttpClientEngineFactory
import kotlinx.cinterop.UByteVar
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.toKString
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.newSingleThreadContext
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.io.Buffer
import kotlinx.io.readByteArray
import kotlin.concurrent.Volatile
import kotlin.native.concurrent.ObsoleteWorkersApi
import kotlin.native.concurrent.ThreadLocal
import kotlin.native.concurrent.Worker
import kotlin.time.TimeSource

actual fun wallMillis(): Long = kotlin.time.Clock.System.now().toEpochMilliseconds()

private val monoOrigin = TimeSource.Monotonic.markNow()
actual fun monoNanos(): Long = monoOrigin.elapsedNow().inWholeNanoseconds

/** The environment, read through getenv on each lookup (iteration is empty:
 *  nothing in the sidecar lists it). */
private object NativeEnv : AbstractMap<String, String>() {
  override fun get(key: String): String? = platform.posix.getenv(key)?.toKString()
  override fun containsKey(key: String): Boolean = get(key) != null
  override val entries: Set<Map.Entry<String, String>> get() = emptySet()
}

actual fun systemEnv(): Map<String, String> = NativeEnv
actual fun userHome(): String = platform.posix.getenv("HOME")?.toKString().orEmpty()
@OptIn(kotlin.experimental.ExperimentalNativeApi::class)
actual fun nodePlatform(): String = when (Platform.osFamily) {
  OsFamily.WINDOWS -> "win32"
  OsFamily.MACOSX, OsFamily.IOS -> "darwin"
  else -> "linux"
}

actual fun printErr(line: String) {
  platform.posix.fputs("$line\n", platform.posix.stderr)
  platform.posix.fflush(platform.posix.stderr)
}

actual fun printOut(line: String) {
  println(line)
  platform.posix.fflush(platform.posix.stdout)
}

actual fun readStdinLine(): String? = readlnOrNull()

actual fun exitProcess(code: Int): Nothing = kotlin.system.exitProcess(code)

actual fun sleepMs(ms: Long) = runBlocking { delay(ms) }

@OptIn(ObsoleteWorkersApi::class)
actual fun startThread(name: String, task: () -> Unit) {
  val w = Worker.start(name = name)
  w.executeAfter(0L) {
    try { task() } finally { w.requestTermination(processScheduledJobs = false) }
  }
}

actual fun secureRandomInt(max: Int): Int {
  require(max > 0)
  // Rejection sampling over 31 random bits from the OS, as SecureRandom.nextInt.
  val limit = (Int.MAX_VALUE / max) * max
  while (true) {
    val b = urandom(4)
    val v = ((b[0].toInt() and 0x7f) shl 24) or ((b[1].toInt() and 0xff) shl 16) or ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff)
    if (v < limit) return v % max
  }
}

private fun urandom(n: Int): ByteArray =
  kotlinx.io.files.SystemFileSystem.source(kotlinx.io.files.Path("/dev/urandom")).use { s ->
    val b = Buffer()
    while (b.size < n) s.readAtMostTo(b, (n - b.size))
    b.readByteArray()
  }

actual fun setOwnerOnly(path: String) {
  platform.posix.chmod(path, 384.convert()) // 0o600
}

// ---- the loop ----

/** The loop this thread runs, if any: a thread-local, so `onLoop` is a read. */
@ThreadLocal private var currentLoop: Any? = null

private class NativeLoop(name: String) : LoopExecutor {
  private val dispatcher = newSingleThreadContext(name)
  private val scope = CoroutineScope(dispatcher + SupervisorJob())
  @Volatile private var shut = false

  init { scope.launch { currentLoop = this@NativeLoop } }

  private fun job(j: Job) = Cancellable { j.cancel() }

  override fun schedule(delayUs: Long, task: () -> Unit): Cancellable {
    if (shut) return Cancellable {}
    val due = monoNanos() + delayUs * 1000
    return job(scope.launch { waitUntil(due); if (!shut) task() })
  }

  /** delay() counts whole ms: wait to the ms, then yield to the due ns. */
  private suspend fun waitUntil(dueNs: Long) {
    val left = dueNs - monoNanos()
    if (left > 0) delay((left + 999_999) / 1_000_000)
  }

  override fun submit(task: () -> Unit): Cancellable {
    if (shut) return Cancellable {}
    return job(scope.launch { if (!shut) task() })
  }

  override fun <T> call(fn: () -> T): T = runBlocking { withContext(scope.coroutineContext) { fn() } }

  override val onLoop: Boolean get() = currentLoop === this
  override val isShutdown: Boolean get() = shut

  override fun shutdown() {
    if (shut) return
    shut = true
    scope.cancel()
    dispatcher.close()
  }

  override fun shutdownNow() = shutdown()
}

actual fun loopExecutor(name: String): LoopExecutor = NativeLoop(name)

// ---- sockets ----

private val selector: SelectorManager by lazy { SelectorManager(Dispatchers.IO) }

private class NativeUdp : UdpSocket {
  @Volatile private var sock: BoundDatagramSocket? = null

  override fun bind(port: Int): SockAddr {
    val s = runBlocking { aSocket(selector).udp().bind(InetSocketAddress("0.0.0.0", port)) }
    sock = s
    val a = s.localAddress as InetSocketAddress
    return SockAddr(a.hostname, a.port)
  }

  private fun bound(): BoundDatagramSocket = sock ?: run { bind(0); sock!! }

  override fun send(b: ByteArray, host: String, port: Int) {
    val s = bound()
    runBlocking { s.send(Datagram(Buffer().apply { write(b) }, InetSocketAddress(host, port))) }
  }

  override fun receive(buf: ByteArray, timeoutMs: Int): Pair<Int, SockAddr> {
    val s = bound()
    val d = runBlocking {
      if (timeoutMs > 0) {
        try { withTimeout(timeoutMs.toLong()) { s.receive() } } catch (_: TimeoutCancellationException) { null }
      } else s.receive()
    } ?: throw SocketTimeout()
    val bytes = d.packet.readByteArray()
    val n = minOf(bytes.size, buf.size)
    bytes.copyInto(buf, 0, 0, n)
    val from = d.address as InetSocketAddress
    return n to SockAddr(from.hostname, from.port)
  }

  override fun close() { sock?.close() }
}

actual fun udpSocket(): UdpSocket = NativeUdp()

private class NativeTcp(private val s: Socket) : TcpConn {
  private val input: ByteReadChannel = s.openReadChannel()
  private val out: ByteWriteChannel = s.openWriteChannel(autoFlush = true)

  override fun read(b: ByteArray, off: Int, len: Int): Int = runBlocking { input.readAvailable(b, off, len) }

  override fun write(b: ByteArray) = runBlocking { out.writeFully(b); out.flush() }

  override fun close() {
    try { runBlocking { out.flushAndClose() } } catch (_: Throwable) {}
    s.close()
  }
}

actual fun tcpListen(host: String, port: Int): TcpListener {
  val s: ServerSocket = runBlocking { aSocket(selector).tcp().bind(host, port) { reuseAddress = true } }
  return object : TcpListener {
    override val port: Int = (s.localAddress as InetSocketAddress).port
    override fun accept(): TcpConn = NativeTcp(runBlocking { s.accept() })
    override fun close() = s.close()
  }
}

actual fun tcpConnect(host: String, port: Int): TcpConn =
  NativeTcp(runBlocking { aSocket(selector).tcp().connect(host, port) { noDelay = true } })

// ---- HTTP ----

/** Curl on Linux, Darwin (NSURLSession) on iOS. */
internal expect val httpEngine: HttpClientEngineFactory<*>

// The whole exchange is bounded (withTimeout over the request, the name lookup
// included, as AbortSignal.timeout bounds fetch); ktor follows redirects, http
// to https included; gzip is asked for and decoded here (inflateGzip), since
// the engines differ in whether they decode it themselves.
actual fun httpGet(url: String, headers: Map<String, String>, timeoutMs: Long): HttpResponse = try {
  runBlocking { withTimeout(timeoutMs.coerceAtLeast(1)) { httpGetOnce(url, headers, timeoutMs) } }
} catch (e: TimeoutCancellationException) { throw HttpTimeout() }

private suspend fun httpGetOnce(url: String, headers: Map<String, String>, timeoutMs: Long): HttpResponse {
  val client = HttpClient(httpEngine) {
    followRedirects = true
    expectSuccess = false
    install(KtorHttpTimeout) {
      requestTimeoutMillis = timeoutMs
      connectTimeoutMillis = timeoutMs
      socketTimeoutMillis = timeoutMs
    }
  }
  return try {
    val r = client.get(url) {
      header("Accept-Encoding", "gzip")
      for ((k, v) in headers) header(k, v)
    }
    val h = LinkedHashMap<String, String>()
    for (name in r.headers.names()) r.headers.getAll(name)?.lastOrNull()?.let { h[name.lowercase()] = it }
    val raw = if (r.status.value == 304) ByteArray(0) else r.bodyAsBytes()
    HttpResponse(r.status.value, h, gunzipIfGzip(raw, h["content-encoding"]))
  } catch (e: HttpRequestTimeoutException) {
    throw HttpTimeout()
  } catch (e: io.ktor.client.network.sockets.ConnectTimeoutException) {
    throw HttpTimeout()
  } catch (e: io.ktor.client.network.sockets.SocketTimeoutException) {
    throw HttpTimeout()
  } finally {
    client.close()
  }
}

/** The body as fetch hands it on: decoded when the server gzipped it (and
 *  the engine has not already). */
private fun gunzipIfGzip(b: ByteArray, encoding: String?): ByteArray {
  val gz = b.size >= 2 && (b[0].toInt() and 0xff) == 0x1f && (b[1].toInt() and 0xff) == 0x8b
  if (!gz || encoding?.lowercase()?.contains("gzip") != true) return b
  return inflateGzip(b)
}

/** gunzip through the platform's zlib (Linux and Apple both ship it). */
@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
private fun inflateGzip(b: ByteArray): ByteArray = kotlinx.cinterop.memScoped {
  val z = alloc<platform.zlib.z_stream>()
  // 16 + 15: a gzip wrapper.
  check(platform.zlib.inflateInit2_(z.ptr, 16 + 15, platform.zlib.ZLIB_VERSION, kotlinx.cinterop.sizeOf<platform.zlib.z_stream>().convert()) == platform.zlib.Z_OK) { "inflateInit2 failed" }
  val out = ByteSink(b.size * 4)
  val chunk = ByteArray(1 shl 16)
  try {
    b.usePinned { src ->
      z.next_in = src.addressOf(0).reinterpret<UByteVar>()
      z.avail_in = b.size.convert()
      while (true) {
        val r = chunk.usePinned { dst ->
          z.next_out = dst.addressOf(0).reinterpret<UByteVar>()
          z.avail_out = chunk.size.convert()
          platform.zlib.inflate(z.ptr, platform.zlib.Z_NO_FLUSH)
        }
        val produced = chunk.size - z.avail_out.toInt()
        out.write(chunk, 0, produced)
        if (r == platform.zlib.Z_STREAM_END) break
        check(r == platform.zlib.Z_OK) { "inflate failed ($r)" }
        if (produced == 0 && z.avail_in.toInt() == 0) break
      }
    }
  } finally {
    platform.zlib.inflateEnd(z.ptr)
  }
  out.toByteArray()
}
