package io.bfstats.sidecar

// Platform.kt on the JVM: java.net, java.util.concurrent, threads. What the
// Android app and the :core:sidecar / :core:probe commands run.

import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

actual fun wallMillis(): Long = System.currentTimeMillis()
actual fun monoNanos(): Long = System.nanoTime()
actual fun systemEnv(): Map<String, String> = System.getenv()
actual fun userHome(): String = System.getProperty("user.home").orEmpty()

actual fun nodePlatform(): String {
  val os = System.getProperty("os.name").orEmpty().lowercase()
  return when {
    os.startsWith("windows") -> "win32"
    os.startsWith("mac") -> "darwin"
    else -> "linux"
  }
}

actual fun printErr(line: String) = System.err.println(line)
actual fun printOut(line: String) { println(line); System.out.flush() }
private val stdin by lazy { System.`in`.bufferedReader() }
actual fun readStdinLine(): String? = stdin.readLine()
actual fun exitProcess(code: Int): Nothing = kotlin.system.exitProcess(code)
actual fun sleepMs(ms: Long) = Thread.sleep(ms)

actual fun startThread(name: String, task: () -> Unit) {
  Thread(task, name).apply { isDaemon = true }.start()
}

private val secure = SecureRandom()
actual fun secureRandomInt(max: Int): Int = secure.nextInt(max)

actual fun setOwnerOnly(path: String) {
  val f = java.io.File(path)
  f.setReadable(false, false); f.setReadable(true, true)
  f.setWritable(false, false); f.setWritable(true, true)
}

actual fun fileMtimeMs(path: String): Long? = java.io.File(path).takeIf { it.exists() }?.lastModified()

actual fun fileMtimeMsExact(path: String): Double? = try {
  val t = java.nio.file.Files.getLastModifiedTime(java.nio.file.Paths.get(path)).toInstant()
  mtimeMsOf(t.epochSecond, t.nano.toLong())
} catch (e: Exception) { null }

// ---- the loop ----

private class JvmLoop(name: String) : LoopExecutor {
  @Volatile private var thread: Thread? = null
  private val exec: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, name).apply { isDaemon = true; thread = this }
  }
  override fun schedule(delayUs: Long, task: () -> Unit): Cancellable {
    val f = exec.schedule(Runnable { task() }, delayUs, TimeUnit.MICROSECONDS)
    return Cancellable { f.cancel(false) }
  }
  override fun submit(task: () -> Unit): Cancellable {
    val f = exec.submit(Runnable { task() })
    return Cancellable { f.cancel(false) }
  }
  override fun <T> call(fn: () -> T): T = exec.submit<T> { fn() }.get()
  override val onLoop: Boolean get() = Thread.currentThread() === thread
  override val isShutdown: Boolean get() = exec.isShutdown
  override fun shutdown() = exec.shutdown()
  override fun shutdownNow() { exec.shutdownNow() }
}

actual fun loopExecutor(name: String): LoopExecutor = JvmLoop(name)

// ---- sockets ----

private class JvmUdp : UdpSocket {
  private val sock = DatagramSocket(null as java.net.SocketAddress?)
  override fun bind(port: Int): SockAddr {
    sock.bind(InetSocketAddress(port))
    // A dual-stack JVM binds the IPv6 wildcard and names it
    // 0:0:0:0:0:0:0:0; Node's udp4 socket says 0.0.0.0.
    val a = sock.localAddress
    return SockAddr(if (a.isAnyLocalAddress) "0.0.0.0" else a.hostAddress, sock.localPort)
  }
  override fun send(b: ByteArray, host: String, port: Int) {
    if (!sock.isBound) sock.bind(InetSocketAddress(0))
    sock.send(DatagramPacket(b, b.size, InetAddress.getByName(host), port))
  }
  override fun receive(buf: ByteArray, timeoutMs: Int): Pair<Int, SockAddr> {
    sock.soTimeout = timeoutMs.coerceAtLeast(0)
    val p = DatagramPacket(buf, buf.size)
    try { sock.receive(p) } catch (_: SocketTimeoutException) { throw SocketTimeout() }
    return p.length to SockAddr(p.address.hostAddress, p.port)
  }
  override fun close() = sock.close()
}

actual fun udpSocket(): UdpSocket = JvmUdp()

private class JvmTcp(private val s: Socket) : TcpConn {
  private val input = s.getInputStream()
  private val out = s.getOutputStream()
  override fun read(b: ByteArray, off: Int, len: Int): Int = input.read(b, off, len)
  override fun write(b: ByteArray) { out.write(b); out.flush() }
  override fun close() { try { s.close() } catch (_: IOException) {} }
}

actual fun tcpListen(host: String, port: Int): TcpListener {
  val s = ServerSocket()
  s.reuseAddress = true
  s.bind(InetSocketAddress(InetAddress.getByName(host), port))
  return object : TcpListener {
    override val port: Int = s.localPort
    override fun accept(): TcpConn = JvmTcp(s.accept().apply { tcpNoDelay = true })
    override fun close() { try { s.close() } catch (_: IOException) {} }
  }
}

actual fun tcpConnect(host: String, port: Int): TcpConn = JvmTcp(Socket(host, port).apply { tcpNoDelay = true })

// ---- HTTP ----

// HttpURLConnection's own timeouts are per connect and per read, and the name
// lookup has none; AbortSignal.timeout bounds the whole exchange. So the
// request runs on a thread of its own and the caller waits out the deadline
// alone; past it the connection is dropped (a lookup still running finishes
// on that thread, which is a daemon, and its answer goes nowhere).
actual fun httpGet(url: String, headers: Map<String, String>, timeoutMs: Long): HttpResponse {
  val deadline = System.nanoTime() + timeoutMs * 1_000_000L
  val current = java.util.concurrent.atomic.AtomicReference<HttpURLConnection?>(null)
  val task = java.util.concurrent.FutureTask { fetchFollowing(url, headers, deadline, current) }
  Thread(task, "sidecar-http").apply { isDaemon = true }.start()
  try {
    return task.get(timeoutMs.coerceAtLeast(1), TimeUnit.MILLISECONDS)
  } catch (e: java.util.concurrent.TimeoutException) {
    current.get()?.disconnect()
    task.cancel(true)
    throw HttpTimeout()
  } catch (e: java.util.concurrent.ExecutionException) {
    throw e.cause ?: e
  }
}

private val REDIRECTS = setOf(301, 302, 303, 307, 308)

/** fetch's redirect: 'follow' (at most 20), across http and https, which
 *  HttpURLConnection will not do by itself. */
private fun fetchFollowing(url: String, headers: Map<String, String>, deadline: Long,
                           current: java.util.concurrent.atomic.AtomicReference<HttpURLConnection?>): HttpResponse {
  var at = URI(url)
  var hops = 0
  while (true) {
    val left = ((deadline - System.nanoTime()) / 1_000_000L).coerceAtLeast(1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    val c = at.toURL().openConnection() as HttpURLConnection
    current.set(c)
    try {
      c.connectTimeout = left
      c.readTimeout = left
      c.instanceFollowRedirects = false
      c.setRequestProperty("Accept-Encoding", "gzip")
      for ((k, v) in headers) c.setRequestProperty(k, v)
      val status = try { c.responseCode } catch (e: SocketTimeoutException) { throw HttpTimeout() }
      val location = c.getHeaderField("Location")
      if (status in REDIRECTS && location != null) {
        if (++hops > 20) throw IOException("redirect count exceeded")
        at = at.resolve(location)
        continue
      }
      val raw = if (status == 304) ByteArray(0) else try {
        (if (status in 200..399) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
      } catch (e: SocketTimeoutException) { throw HttpTimeout() }
      val h = LinkedHashMap<String, String>()
      for ((k, v) in c.headerFields) if (k != null && v.isNotEmpty()) h[k.lowercase()] = v.last()
      return HttpResponse(status, h, gunzipIfGzip(raw, h["content-encoding"]))
    } finally { c.disconnect() }
  }
}

/** The body as fetch hands it on: decoded when the server gzipped it. */
private fun gunzipIfGzip(b: ByteArray, encoding: String?): ByteArray {
  val gz = b.size >= 2 && (b[0].toInt() and 0xff) == 0x1f && (b[1].toInt() and 0xff) == 0x8b
  if (!gz || encoding?.lowercase()?.contains("gzip") != true) return b
  return java.util.zip.GZIPInputStream(b.inputStream()).use { it.readBytes() }
}
