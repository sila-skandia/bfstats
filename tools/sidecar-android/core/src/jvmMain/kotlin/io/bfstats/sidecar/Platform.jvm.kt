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
    return SockAddr(sock.localAddress.hostAddress, sock.localPort)
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

actual fun httpGet(url: String, headers: Map<String, String>, timeoutMs: Long): HttpResponse {
  val c = URI(url).toURL().openConnection() as HttpURLConnection
  try {
    c.connectTimeout = timeoutMs.toInt().coerceAtLeast(1)
    c.readTimeout = timeoutMs.toInt().coerceAtLeast(1)
    c.instanceFollowRedirects = true
    c.setRequestProperty("Accept-Encoding", "identity")
    for ((k, v) in headers) c.setRequestProperty(k, v)
    val status = try { c.responseCode } catch (e: SocketTimeoutException) { throw HttpTimeout() }
    val body = if (status == 304) ByteArray(0) else try {
      (if (status in 200..399) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
    } catch (e: SocketTimeoutException) { throw HttpTimeout() }
    val h = LinkedHashMap<String, String>()
    for ((k, v) in c.headerFields) if (k != null && v.isNotEmpty()) h[k.lowercase()] = v.last()
    return HttpResponse(status, h, body)
  } finally { c.disconnect() }
}
