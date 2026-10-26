package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** WsServer.kt against wsserver.mjs over real TCP (parity/wsserver.mjs): the
 *  same request bytes and frames, the same status line and body, the same
 *  frames back, and the same connection, message, close and refused events
 *  in the same order. */
class WsServerParityTest {
  private val fx: Map<String, Any?> by lazy { Fixtures.json("wsserver.json").m() }

  private class Answer(val bytes: ByteArray)

  private fun runCase(c: Map<String, Any?>, page: String): Pair<Map<String, Any?>, List<List<Any?>>> {
    val events = ArrayList<List<Any?>>()
    val lock = Lock()
    fun ev(vararg a: Any?) = lock.withLock { events.add(a.toList()) }
    val server = WsServer(0, allowOrigins = listOf("https://extra.example"), staticPage = { page.encodeToByteArray() })
    server.onRefused = { o -> ev("refused", o) }
    server.onConnection = { ws ->
      ev("connection", server.clients.size.toDouble())
      ws.onMessage = { text, bin ->
        if (bin != null) { ev("binary", bin.hex()); ws.send(bin.copyOfRange(0, minOf(4, bin.size))) }
        else { ev("text", text); ws.send("echo:${text!!.take(8)}") }
      }
      ws.onClose = { ev("close", server.clients.size.toDouble()) }
    }
    val port = server.listen()
    val conn = tcpConnect("127.0.0.1", port)
    val got = ByteSink()
    val done = Latch()
    startThread("parity-read") {
      val b = ByteArray(65536)
      try { while (true) { val n = conn.read(b, 0, b.size); if (n < 0) break; lock.withLock { got.write(b, 0, n) } } } catch (_: Exception) {}
      done.countDown()
    }
    for (h in c["send"].l()) { conn.write(fromHex(h as String)); sleepMs(60) }
    sleepMs(250)
    conn.close()
    done.await(2000)
    sleepMs(80)
    server.close()
    return parseAnswer(lock.withLock { got.toByteArray() }) to lock.withLock { events.toList() }
  }

  /** parity/wsserver.mjs parseAnswer. */
  private fun parseAnswer(buf: ByteArray): Map<String, Any?> {
    val s = latin1String(buf)
    val end = s.indexOf("\r\n\r\n")
    if (end < 0) return linkedMapOf("status" to (s.split("\r\n")[0].ifEmpty { null }))
    val head = s.substring(0, end).split("\r\n")
    val status = head[0]
    val hdr = head.drop(1).associate { l -> l.substring(0, l.indexOf(':')).lowercase() to l.substring(l.indexOf(':') + 1).trim() }
    var rest = buf.copyOfRange(end + 4, buf.size)
    if (!status.contains(" 101 ")) {
      val n = hdr["content-length"]?.toInt() ?: rest.size
      return linkedMapOf("status" to status, "contentType" to hdr["content-type"], "body" to rest.copyOfRange(0, minOf(n, rest.size)).decodeToString())
    }
    val frames = ArrayList<Any?>()
    while (rest.size >= 2) {
      val op = rest[0].toInt() and 0x0f
      var len = (rest[1].toInt() and 0x7f).toLong()
      var off = 2
      if (len == 126L) { len = (((rest[2].toInt() and 0xff) shl 8) or (rest[3].toInt() and 0xff)).toLong(); off = 4 }
      else if (len == 127L) { len = 0; for (i in 2 until 10) len = (len shl 8) or (rest[i].toLong() and 0xff); off = 10 }
      if (rest.size < off + len) break
      frames.add(listOf(op.toDouble(), rest.copyOfRange(off, off + len.toInt()).hex()))
      rest = rest.copyOfRange(off + len.toInt(), rest.size)
    }
    return linkedMapOf("status" to status, "accept" to hdr["sec-websocket-accept"], "frames" to frames)
  }

  @Test fun originRulesAsNodeHasThem() {
    for (x in fx["origins"].l()) {
      val r = x.l()
      val o = r[0] as String?
      assertEquals("normalise $o", r[1], normaliseOrigin(o))
      assertEquals("allowed $o", r[2], originAllowed(o))
      assertEquals("allowed+extra $o", r[3], originAllowed(o, listOf("https://extra.example/", " HTTPS://Other.example ")))
    }
  }

  @Test fun everyCaseAnswersAsNodeDoes() {
    val page = fx["page"] as String
    val bad = ArrayList<String>()
    for ((name, c0) in fx["cases"].m()) {
      val c = c0.m()
      val (answer, events) = runCase(c, page)
      val want = Js.stringify(linkedMapOf("answer" to c["answer"], "events" to c["events"]))
      val got = Js.stringify(linkedMapOf("answer" to answer, "events" to events))
      if (want != got) bad += "$name\n  node:   ${want.take(500)}\n  kotlin: ${got.take(500)}"
    }
    assertEquals(bad.joinToString("\n"), 0, bad.size)
  }
}
