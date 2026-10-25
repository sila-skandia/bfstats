package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/wsserver.mjs: a minimal dependency-free
// WebSocket server (RFC 6455), enough for the sidecar to stream the live record
// feed to the page on 127.0.0.1 and to receive its commands back. Text and
// binary frames, ping/pong, close; server->client frames are unmasked,
// client->server frames are unmasked on read. Keep the origin rules in step
// with the Node copy.

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.concurrent.thread

private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

/** The pages allowed to open the sidecar's socket (wsserver.mjs ALLOWED_ORIGINS). */
val ALLOWED_ORIGINS: List<String> = listOf(
  "https://bfstats.io",
  "https://www.bfstats.io",
  "https://mesh.bfstats.io",
  // mesh.bfstats.io/map.html redirects here (301), so the page that opens
  // the socket has this origin.
  "https://play.bfstats.io",
)
private val LOCAL_ORIGIN = Regex("""^https?://(localhost|127\.0\.0\.1|\[::1])(:\d{1,5})?$""", RegexOption.IGNORE_CASE)
private val ORIGIN_SHAPE = Regex("""^[a-z][a-z0-9+.-]*://[^/?#\s]+$""")

/** An origin as a browser sends it: scheme://host[:port], lower case, no
 *  trailing slash. Anything that does not parse as one is null. */
fun normaliseOrigin(o: String?): String? {
  if (o == null) return null
  val t = o.trim().trimEnd('/').lowercase()
  return if (ORIGIN_SHAPE.matches(t)) t else null
}

/** Whether a WebSocket upgrade with this Origin header may connect. `extra`
 *  holds origins allowed on top of the built-in list. A request with no
 *  Origin is allowed: browsers always send one, the lab probes send none. */
fun originAllowed(origin: String?, extra: List<String> = emptyList()): Boolean {
  if (origin.isNullOrEmpty()) return true
  val o = normaliseOrigin(origin) ?: return false
  if (LOCAL_ORIGIN.matches(o)) return true
  if (o in ALLOWED_ORIGINS) return true
  return extra.any { normaliseOrigin(it) == o }
}

class WsSocket internal constructor(private val raw: Socket) {
  @Volatile var open = true; private set
  private val out: OutputStream = raw.getOutputStream()
  var onMessage: (text: String?, binary: ByteArray?) -> Unit = { _, _ -> }
  var onClose: () -> Unit = {}
  internal var detach: () -> Unit = {}

  fun send(text: String) = write(encodeFrame(text.toByteArray(Charsets.UTF_8), 0x1))
  fun send(data: ByteArray) = write(encodeFrame(data, 0x2))

  private fun write(frame: ByteArray) {
    if (!open) return
    try { synchronized(out) { out.write(frame); out.flush() } } catch (_: IOException) { close() }
  }

  fun close() {
    if (!open) return
    open = false
    try { raw.close() } catch (_: IOException) {}
    detach()
    onClose()
  }

  internal fun readLoop(input: InputStream) {
    try {
      while (open) {
        val f = readFrame(input) ?: break
        when (f.opcode) {
          0x8 -> break
          0x9 -> write(encodeFrame(f.payload, 0xa))
          0x1 -> onMessage(String(f.payload, Charsets.UTF_8), null)
          0x2 -> onMessage(null, f.payload)
        }
      }
    } catch (_: IOException) {}
    close()
  }
}

class WsServer(
  private val port: Int,
  private val host: String = "127.0.0.1",
  private val allowOrigins: List<String> = emptyList(),
) {
  val clients = CopyOnWriteArraySet<WsSocket>()
  var onConnection: (WsSocket) -> Unit = {}
  var onRefused: (String?) -> Unit = {}
  private var server: ServerSocket? = null

  /** Binds and starts accepting; returns the bound port (0 asks for any). */
  fun listen(): Int {
    val s = ServerSocket()
    s.reuseAddress = true
    s.bind(InetSocketAddress(InetAddress.getByName(host), port))
    server = s
    thread(name = "ws-accept", isDaemon = true) {
      while (!s.isClosed) {
        val c = try { s.accept() } catch (_: IOException) { break }
        thread(name = "ws-client", isDaemon = true) { handle(c) }
      }
    }
    return s.localPort
  }

  private fun handle(c: Socket) {
    try {
      c.tcpNoDelay = true
      val input = c.getInputStream()
      val req = readHttpHead(input) ?: run { c.close(); return }
      val out = c.getOutputStream()
      if (!req.upgrade) {
        out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nnot found".toByteArray()); c.close(); return
      }
      // Guard: the allowed origins only (DNS-rebinding / stray-site protection).
      if (!originAllowed(req.headers["origin"], allowOrigins)) {
        onRefused(req.headers["origin"])
        out.write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray()); c.close(); return
      }
      val key = req.headers["sec-websocket-key"]
      if (key == null) { out.write("HTTP/1.1 400 Bad Request\r\n\r\n".toByteArray()); c.close(); return }
      out.write(
        ("HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n").toByteArray())
      out.flush()
      val ws = WsSocket(c)
      clients.add(ws)
      ws.detach = { clients.remove(ws) }
      onConnection(ws)
      ws.readLoop(input)
    } catch (_: IOException) {
      try { c.close() } catch (_: IOException) {}
    }
  }

  fun broadcast(text: String) { for (ws in clients) ws.send(text) }
  fun broadcast(data: ByteArray) { for (ws in clients) ws.send(data) }

  fun close() {
    for (ws in clients) ws.close()
    try { server?.close() } catch (_: IOException) {}
  }
}

internal fun acceptKey(key: String): String =
  Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + GUID).toByteArray()))

private class HttpHead(val headers: Map<String, String>, val upgrade: Boolean)

/** Reads the request line and headers up to the blank line (8 KiB at most). */
private fun readHttpHead(input: InputStream): HttpHead? {
  val buf = ByteArrayOutputStream()
  var last4 = 0
  while (true) {
    val b = input.read()
    if (b < 0) return null
    buf.write(b)
    last4 = (last4 shl 8) or b
    if (last4 == 0x0d0a0d0a) break
    if (buf.size() > 8192) return null
  }
  val lines = buf.toString(Charsets.ISO_8859_1).split("\r\n")
  val headers = HashMap<String, String>()
  for (line in lines.drop(1)) {
    val i = line.indexOf(':')
    if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
  }
  val upgrade = headers["upgrade"]?.equals("websocket", ignoreCase = true) == true
  return HttpHead(headers, upgrade)
}

internal fun encodeFrame(payload: ByteArray, opcode: Int): ByteArray {
  val len = payload.size
  val header = when {
    len < 126 -> byteArrayOf((0x80 or opcode).toByte(), len.toByte())
    len < 65536 -> byteArrayOf((0x80 or opcode).toByte(), 126, (len shr 8).toByte(), len.toByte())
    else -> ByteArray(10).also {
      it[0] = (0x80 or opcode).toByte(); it[1] = 127
      val l = len.toLong()
      for (i in 0 until 8) it[2 + i] = (l shr (56 - 8 * i)).toByte()
    }
  }
  return header + payload
}

internal class Frame(val opcode: Int, val payload: ByteArray)

private fun InputStream.readFully(n: Int): ByteArray? {
  val b = ByteArray(n)
  var off = 0
  while (off < n) {
    val r = read(b, off, n - off)
    if (r < 0) return null
    off += r
  }
  return b
}

internal fun readFrame(input: InputStream): Frame? {
  val h = input.readFully(2) ?: return null
  val opcode = h[0].toInt() and 0x0f
  val masked = (h[1].toInt() and 0x80) != 0
  var len = (h[1].toInt() and 0x7f).toLong()
  if (len == 126L) {
    val e = input.readFully(2) ?: return null
    len = (((e[0].toInt() and 0xff) shl 8) or (e[1].toInt() and 0xff)).toLong()
  } else if (len == 127L) {
    val e = input.readFully(8) ?: return null
    len = 0
    for (b in e) len = (len shl 8) or (b.toLong() and 0xff)
  }
  if (len > 16L * 1024 * 1024) throw IOException("frame too large")
  val mask = if (masked) input.readFully(4) ?: return null else null
  val payload = input.readFully(len.toInt()) ?: return null
  if (mask != null) for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i and 3].toInt()).toByte()
  return Frame(opcode, payload)
}
