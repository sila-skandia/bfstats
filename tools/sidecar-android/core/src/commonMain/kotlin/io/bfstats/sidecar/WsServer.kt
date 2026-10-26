package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/wsserver.mjs: a minimal dependency-free
// WebSocket server (RFC 6455), enough for the sidecar to stream the live record
// feed to the page on 127.0.0.1 and to receive its commands back. Text and
// binary frames, ping/pong, close; server->client frames are unmasked,
// client->server frames are unmasked on read. Keep the origin rules in step
// with the Node copy.

import kotlin.concurrent.Volatile
import kotlin.io.encoding.Base64

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

class WsSocket internal constructor(private val raw: TcpConn) {
  @Volatile var open = true; private set
  private val lock = Lock()
  var onMessage: (text: String?, binary: ByteArray?) -> Unit = { _, _ -> }
  var onClose: () -> Unit = {}
  internal var detach: () -> Unit = {}

  fun send(text: String) = write(encodeFrame(text.encodeToByteArray(), 0x1))
  fun send(data: ByteArray) = write(encodeFrame(data, 0x2))

  private fun write(frame: ByteArray) {
    if (!open) return
    try { lock.withLock { raw.write(frame) } } catch (_: Exception) { close() }
  }

  fun close() {
    if (!open) return
    open = false
    try { raw.close() } catch (_: Exception) {}
    detach()
    onClose()
  }

  internal fun readLoop(input: TcpConn) {
    try {
      while (open) {
        val f = readFrame(input) ?: break
        when (f.opcode) {
          0x8 -> break
          0x9 -> write(encodeFrame(f.payload, 0xa))
          0x1 -> onMessage(f.payload.decodeToString(), null)
          0x2 -> onMessage(null, f.payload)
        }
      }
    } catch (_: Exception) {}
    close()
  }
}

class WsServer(
  private val port: Int,
  private val host: String = "127.0.0.1",
  private val allowOrigins: List<String> = emptyList(),
  /** The live monitor page served at `/` and `/index.html` (wsserver.mjs
   *  `staticFile`, sidecar/page/index.html); null serves nothing. */
  private val staticPage: (() -> ByteArray?)? = null,
) {
  private val lock = Lock()
  private var clientSet: List<WsSocket> = emptyList() // copy on write
  /** The open page sockets (a snapshot). */
  val clients: List<WsSocket> get() = lock.withLock { clientSet }
  var onConnection: (WsSocket) -> Unit = {}
  var onRefused: (String?) -> Unit = {}
  private var server: TcpListener? = null
  @Volatile private var closed = false

  /** Binds and starts accepting; returns the bound port (0 asks for any). */
  fun listen(): Int {
    val s = tcpListen(host, port)
    server = s
    startThread("ws-accept") {
      while (!closed) {
        val c = try { s.accept() } catch (_: Exception) { break }
        startThread("ws-client") { handle(c) }
      }
    }
    return s.port
  }

  private fun handle(c: TcpConn) {
    try {
      val input = c
      val req = readHttpHead(input) ?: run { c.close(); return }
      val out = c
      // A head past Node's 16 KiB limit (--max-http-header-size) is answered 431.
      if (req.tooLarge) { out.write("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n".encodeToByteArray()); c.close(); return }
      // Node's http server refuses an HTTP/1.1 request with no Host (requireHostHeader).
      if (req.version == "HTTP/1.1" && !req.headers.containsKey("host")) { out.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n".encodeToByteArray()); c.close(); return }
      if (!req.upgrade) {
        // Not an upgrade: wsserver.mjs `_onHttp` serves the monitor page at
        // `/` and `/index.html`, and 404s the rest.
        val page = if (staticPage != null && (req.url == "/" || req.url == "/index.html")) staticPage.invoke() else null
        if (staticPage != null && (req.url == "/" || req.url == "/index.html") && page == null) {
          out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 7\r\nConnection: close\r\n\r\nno page".encodeToByteArray()); c.close(); return
        }
        if (page != null) {
          out.write(("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\n" +
            "Content-Length: ${page.size}\r\nConnection: close\r\n\r\n").encodeToByteArray() + page)
          c.close(); return
        }
        out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found".encodeToByteArray()); c.close(); return
      }
      // Guard: the allowed origins only (DNS-rebinding / stray-site protection).
      if (!originAllowed(req.headers["origin"], allowOrigins)) {
        onRefused(req.headers["origin"])
        out.write("HTTP/1.1 403 Forbidden\r\n\r\n".encodeToByteArray()); c.close(); return
      }
      val key = req.headers["sec-websocket-key"]
      // `!key` in Node: an empty header is no key.
      if (key.isNullOrEmpty()) { out.write("HTTP/1.1 400 Bad Request\r\n\r\n".encodeToByteArray()); c.close(); return }
      out.write(
        ("HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n").encodeToByteArray())
      val ws = WsSocket(c)
      lock.withLock { clientSet = clientSet + ws }
      ws.detach = { lock.withLock { clientSet = clientSet - ws } }
      onConnection(ws)
      ws.readLoop(input)
    } catch (_: Exception) {
      try { c.close() } catch (_: Exception) {}
    }
  }

  fun broadcast(text: String) { for (ws in clients) ws.send(text) }
  fun broadcast(data: ByteArray) { for (ws in clients) ws.send(data) }

  fun close() {
    closed = true
    for (ws in clients) ws.close()
    try { server?.close() } catch (_: Exception) {}
  }
}

internal fun acceptKey(key: String): String = Base64.encode(Digest.sha1((key + GUID).encodeToByteArray()))

private class HttpHead(val url: String, val headers: Map<String, String>, val upgrade: Boolean, val tooLarge: Boolean = false, val version: String = "")

/** Node's default --max-http-header-size: a longer head is answered 431. */
private const val MAX_HEAD = 16 * 1024

/** Reads the request line and headers up to the blank line. `upgrade` is
 *  when Node's http parser raises 'upgrade': a `Connection` header naming
 *  the `upgrade` token and an `Upgrade` header of any value (wsserver.mjs
 *  takes the WebSocket path for any upgrade). */
private fun readHttpHead(input: TcpConn): HttpHead? {
  val buf = ByteSink()
  var last4 = 0
  while (true) {
    val b = input.read()
    if (b < 0) return null
    buf.write(b)
    last4 = (last4 shl 8) or b
    if (last4 == 0x0d0a0d0a) break
    if (buf.size > MAX_HEAD) return HttpHead("", emptyMap(), upgrade = false, tooLarge = true)
  }
  val lines = latin1String(buf.toByteArray()).split("\r\n")
  val first = lines.first().split(" ")
  val url = first.getOrNull(1) ?: ""
  val headers = HashMap<String, String>()
  for (line in lines.drop(1)) {
    val i = line.indexOf(':')
    if (i > 0) {
      val k = line.substring(0, i).trim().lowercase()
      val v = line.substring(i + 1).trim()
      // Repeated headers: Node joins most with ", " (Connection among them).
      headers[k] = headers[k]?.let { "$it, $v" } ?: v
    }
  }
  val connUpgrade = headers["connection"]?.split(",")?.any { it.trim().equals("upgrade", ignoreCase = true) } == true
  val upgrade = connUpgrade && headers.containsKey("upgrade")
  return HttpHead(url, headers, upgrade, version = first.getOrNull(2) ?: "")
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

private fun TcpConn.readFully(n: Int): ByteArray? {
  val b = ByteArray(n)
  var off = 0
  while (off < n) {
    val r = read(b, off, n - off)
    if (r < 0) return null
    off += r
  }
  return b
}

internal fun readFrame(input: TcpConn): Frame? {
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
  if (len > 16L * 1024 * 1024) throw RuntimeException("frame too large")
  val mask = if (masked) input.readFully(4) ?: return null else null
  val payload = input.readFully(len.toInt()) ?: return null
  if (mask != null) for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i and 3].toInt()).toByte()
  return Frame(opcode, payload)
}
