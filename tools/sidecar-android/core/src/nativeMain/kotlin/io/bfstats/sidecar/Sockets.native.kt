package io.bfstats.sidecar

// The sockets on Kotlin/Native: POSIX, blocking, as java.net's are on the JVM.
//
// They were ktor-network sockets behind runBlocking, sharing one
// SelectorManager. Under load that lost connections: in a run of short page
// connections each on a fresh listener (WsServerParityTest, TcpStressTest)
// one in a few dozen was never read, or read as closed, on linuxX64 only.
// Plain blocking calls have no selector to get wrong. A blocking call is
// woken by `close()` through poll() with a short tick and a closed flag,
// which works the same on Linux and Darwin (shutdown() does not wake a
// blocked accept on Darwin).

import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.MemScope
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.allocArray
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.pointed
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.sizeOf
import kotlinx.cinterop.toKString
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.posix.AF_INET
import platform.posix.EAGAIN
import platform.posix.EINTR
import platform.posix.INADDR_ANY
import platform.posix.IPPROTO_TCP
import platform.posix.POLLIN
import platform.posix.SIGPIPE
import platform.posix.SIG_IGN
import platform.posix.SOCK_DGRAM
import platform.posix.SOCK_STREAM
import platform.posix.SOL_SOCKET
import platform.posix.SO_REUSEADDR
import platform.posix.TCP_NODELAY
import platform.posix.accept
import platform.posix.addrinfo
import platform.posix.bind
import platform.posix.connect
import platform.posix.errno
import platform.posix.freeaddrinfo
import platform.posix.getaddrinfo
import platform.posix.getsockname
import platform.posix.in_addr
import platform.posix.listen
import platform.posix.poll
import platform.posix.pollfd
import platform.posix.recv
import platform.posix.recvfrom
import platform.posix.send
import platform.posix.sendto
import platform.posix.setsockopt
import platform.posix.signal
import platform.posix.sockaddr
import platform.posix.sockaddr_in
import platform.posix.socket
import platform.posix.socklen_tVar
import platform.posix.strerror
import platform.posix.close as posixClose
import kotlinx.cinterop.IntVar
import kotlinx.cinterop.CPointerVar
import kotlin.concurrent.AtomicInt

/** How often a blocked call looks at its socket's closed flag. */
private const val TICK_MS = 100

private val sigpipeIgnored = AtomicInt(0)
/** A write to a peer that has gone raises SIGPIPE, which ends the process;
 *  java.net throws instead, and so does this. */
private fun ignoreSigpipe() { if (sigpipeIgnored.compareAndSet(0, 1)) signal(SIGPIPE, SIG_IGN) }

private fun fail(what: String): Nothing = throw IoError("$what: ${strerror(errno)?.toKString() ?: "errno $errno"}")

/** Network byte order for a port (every target this builds for is little-endian). */
private fun hton16(p: Int): UShort = (((p and 0xff) shl 8) or ((p shr 8) and 0xff)).toUShort()
private fun ntoh16(p: UShort): Int = p.toInt().let { ((it and 0xff) shl 8) or ((it shr 8) and 0xff) }

/** An IPv4 address for `host`: a dotted quad, or the first A record. */
private fun MemScope.sockaddrFor(host: String, port: Int): sockaddr_in {
  val sa = alloc<sockaddr_in>()
  sa.sin_family = AF_INET.convert()
  sa.sin_port = hton16(port)
  val h = if (host.isEmpty() || host == "0.0.0.0") null else host
  if (h == null) { sa.sin_addr.s_addr = INADDR_ANY.convert(); return sa }
  quad(if (h == "localhost") "127.0.0.1" else h)?.let { sa.sin_addr.s_addr = it; return sa }
  val hints = alloc<addrinfo>()
  hints.ai_family = AF_INET
  val res = alloc<CPointerVar<addrinfo>>()
  if (getaddrinfo(h, null, hints.ptr, res.ptr) != 0 || res.value == null) throw IoError("getaddrinfo ENOTFOUND $h")
  try {
    val ai = res.value!!.pointed
    val sin = ai.ai_addr!!.reinterpret<sockaddr_in>().pointed
    sa.sin_addr.s_addr = sin.sin_addr.s_addr
  } finally { freeaddrinfo(res.value) }
  return sa
}

/** A dotted quad as s_addr (network order in memory, so on a little-endian
 *  host the first octet is the low byte), or null. */
private fun quad(h: String): UInt? {
  val p = h.split('.')
  if (p.size != 4) return null
  var v = 0u
  for ((i, x) in p.withIndex()) {
    val n = x.toIntOrNull()?.takeIf { it in 0..255 && x.isNotEmpty() && x.all { c -> c in '0'..'9' } } ?: return null
    v = v or (n.toUInt() shl (8 * i))
  }
  return v
}

private fun addrString(a: in_addr): String {
  val v = a.s_addr
  return (0 until 4).joinToString(".") { ((v shr (8 * it)) and 0xffu).toString() }
}

private fun localAddr(fd: Int): SockAddr = memScoped {
  val sa = alloc<sockaddr_in>()
  val len = alloc<socklen_tVar>().apply { value = sizeOf<sockaddr_in>().convert() }
  if (getsockname(fd, sa.ptr.reinterpret(), len.ptr) != 0) fail("getsockname")
  SockAddr(addrString(sa.sin_addr), ntoh16(sa.sin_port))
}

/** Waits until fd is readable, the deadline passes (false) or closed() says so (false). */
private fun waitReadable(fd: Int, timeoutMs: Int, closed: () -> Boolean): Boolean {
  val start = monoNanos()
  memScoped {
    val p = alloc<pollfd>()
    while (true) {
      if (closed()) return false
      val left = if (timeoutMs > 0) timeoutMs - ((monoNanos() - start) / 1_000_000).toInt() else TICK_MS
      if (timeoutMs > 0 && left <= 0) return false
      p.fd = fd; p.events = POLLIN.convert(); p.revents = 0
      val r = poll(p.ptr, 1.convert(), minOf(left, TICK_MS))
      if (r > 0) return true
      if (r < 0 && errno != EINTR) fail("poll")
    }
  }
}

class IoError(message: String) : Exception(message)

private class PosixUdp : UdpSocket {
  @kotlin.concurrent.Volatile private var fd = -1
  @kotlin.concurrent.Volatile private var closed = false

  override fun bind(port: Int): SockAddr {
    val s = socket(AF_INET, SOCK_DGRAM, 0)
    if (s < 0) fail("socket")
    memScoped {
      val sa = sockaddrFor("0.0.0.0", port)
      if (bind(s, sa.ptr.reinterpret<sockaddr>(), sizeOf<sockaddr_in>().convert()) != 0) { posixClose(s); fail("bind") }
    }
    fd = s
    return localAddr(s)
  }

  private fun bound(): Int { if (closed) throw IoError("socket closed"); if (fd < 0) bind(0); return fd }

  override fun send(b: ByteArray, host: String, port: Int) {
    val s = bound()
    memScoped {
      val sa = sockaddrFor(host, port)
      val n = if (b.isEmpty()) sendto(s, null, 0.convert(), 0, sa.ptr.reinterpret(), sizeOf<sockaddr_in>().convert())
        else b.usePinned { sendto(s, it.addressOf(0), b.size.convert(), 0, sa.ptr.reinterpret(), sizeOf<sockaddr_in>().convert()) }
      if (n < 0) fail("send")
    }
  }

  override fun receive(buf: ByteArray, timeoutMs: Int): Pair<Int, SockAddr> {
    val s = bound()
    while (true) {
      if (!waitReadable(s, timeoutMs) { closed }) {
        if (closed) throw IoError("socket closed")
        throw SocketTimeout()
      }
      memScoped {
        val from = alloc<sockaddr_in>()
        val len = alloc<socklen_tVar>().apply { value = sizeOf<sockaddr_in>().convert() }
        val n = buf.usePinned { recvfrom(s, it.addressOf(0), buf.size.convert(), 0, from.ptr.reinterpret(), len.ptr) }
        if (n < 0) { if (errno == EINTR || errno == EAGAIN) return@memScoped; fail("recvfrom") }
        return n.toInt() to SockAddr(addrString(from.sin_addr), ntoh16(from.sin_port))
      }
    }
  }

  override fun close() {
    if (closed) return
    closed = true
    // The receive thread sees the flag within a tick; the fd goes when no
    // call can still be using it, a tick later.
    val s = fd
    if (s >= 0) startThread("udp-close") { sleepMs((TICK_MS * 2).toLong()); posixClose(s) }
  }
}

actual fun udpSocket(): UdpSocket = PosixUdp()

private class PosixTcp(private val fd: Int) : TcpConn {
  @kotlin.concurrent.Volatile private var closed = false

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (len == 0) return 0
    while (true) {
      if (!waitReadable(fd, 0) { closed }) return -1
      val n = b.usePinned { recv(fd, it.addressOf(off), len.convert(), 0) }
      if (n > 0) return n.toInt()
      if (n == 0L) return -1
      if (errno == EINTR || errno == EAGAIN) continue
      if (closed) return -1
      fail("recv")
    }
  }

  override fun write(b: ByteArray) {
    ignoreSigpipe()
    var at = 0
    while (at < b.size) {
      if (closed) throw IoError("socket closed")
      val n = b.usePinned { send(fd, it.addressOf(at), (b.size - at).convert(), 0) }
      if (n < 0) { if (errno == EINTR || errno == EAGAIN) continue; fail("send") }
      at += n.toInt()
    }
  }

  override fun close() {
    if (closed) return
    closed = true
    platform.posix.shutdown(fd, platform.posix.SHUT_RDWR)
    startThread("tcp-close") { sleepMs((TICK_MS * 2).toLong()); posixClose(fd) }
  }
}

actual fun tcpListen(host: String, port: Int): TcpListener {
  ignoreSigpipe()
  val s = socket(AF_INET, SOCK_STREAM, 0)
  if (s < 0) fail("socket")
  memScoped {
    val one = alloc<IntVar>().apply { value = 1 }
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, one.ptr, sizeOf<IntVar>().convert())
    val sa = sockaddrFor(host, port)
    if (bind(s, sa.ptr.reinterpret<sockaddr>(), sizeOf<sockaddr_in>().convert()) != 0) { posixClose(s); fail("bind $host:$port") }
  }
  if (listen(s, 64) != 0) { posixClose(s); fail("listen") }
  val bound = localAddr(s).port
  return object : TcpListener {
    @kotlin.concurrent.Volatile private var closed = false
    override val port: Int = bound
    override fun accept(): TcpConn {
      while (true) {
        if (!waitReadable(s, 0) { closed }) throw IoError("listener closed")
        val c = accept(s, null, null)
        if (c >= 0) return PosixTcp(c).also { noDelay(c) }
        if (errno == EINTR || errno == EAGAIN) continue
        if (closed) throw IoError("listener closed")
        fail("accept")
      }
    }
    override fun close() {
      if (closed) return
      closed = true
      startThread("listen-close") { sleepMs((TICK_MS * 2).toLong()); posixClose(s) }
    }
  }
}

private fun noDelay(fd: Int) = memScoped {
  val one = alloc<IntVar>().apply { value = 1 }
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, one.ptr, sizeOf<IntVar>().convert())
}

actual fun tcpConnect(host: String, port: Int): TcpConn {
  ignoreSigpipe()
  val s = socket(AF_INET, SOCK_STREAM, 0)
  if (s < 0) fail("socket")
  memScoped {
    val sa = sockaddrFor(host, port)
    while (connect(s, sa.ptr.reinterpret<sockaddr>(), sizeOf<sockaddr_in>().convert()) != 0) {
      if (errno == EINTR) continue
      posixClose(s); fail("connect $host:$port")
    }
  }
  noDelay(s)
  return PosixTcp(s)
}
