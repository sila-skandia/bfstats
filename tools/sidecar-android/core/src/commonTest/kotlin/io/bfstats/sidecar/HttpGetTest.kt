package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import io.bfstats.sidecar.Assert.assertTrue
import kotlin.test.Test

/** The platform's httpGet against a loopback HTTP server: a gzipped body
 *  decoded, a BOM dropped as res.text() drops it, redirects followed, and a
 *  server that never answers cut off at the deadline (AbortSignal.timeout). */
class HttpGetTest {
  private val fx by lazy { Fixtures.json("js-ops.json.gz").asObj()!! }

  private class Route(val status: Int, val headers: List<Pair<String, String>>, val body: ByteArray, val hang: Boolean = false)

  /** A one-request-per-connection HTTP/1.1 server on 127.0.0.1. */
  private fun serve(routes: (String) -> Route): TcpListener {
    val l = tcpListen("127.0.0.1", 0)
    startThread("test-http") {
      while (true) {
        val c = try { l.accept() } catch (_: Exception) { break }
        startThread("test-http-conn") {
          try {
            val line = StringBuilder()
            var path = ""
            var first = true
            while (true) {
              val b = c.read()
              if (b < 0) break
              if (b == '\n'.code) {
                val s = line.toString().trimEnd('\r')
                if (first) { path = s.split(' ').getOrElse(1) { "" }; first = false }
                if (s.isEmpty()) break
                line.clear()
              } else line.append(b.toChar())
            }
            val r = routes(path)
            if (r.hang) { sleepMs(3000); c.close(); return@startThread }
            val head = StringBuilder("HTTP/1.1 ${r.status} X\r\nContent-Length: ${r.body.size}\r\nConnection: close\r\n")
            for ((k, v) in r.headers) head.append("$k: $v\r\n")
            head.append("\r\n")
            c.write(latin1(head.toString()) + r.body)
          } catch (_: Exception) {}
          c.close()
        }
      }
    }
    return l
  }

  @Test fun gzipBomRedirectAndDeadline() {
    val gz = fx["gzipped"].asList()!!
    val bom = fx["bom"].asList()!!
    var port = 0
    val l = serve { p ->
      when (p) {
        "/gz" -> Route(200, listOf("Content-Encoding" to "gzip", "ETag" to "W/\"1\""), fromHex(gz[0] as String))
        "/bom" -> Route(200, emptyList(), fromHex(bom[0] as String))
        "/hop" -> Route(301, listOf("Location" to "/hop2"), ByteArray(0))
        "/hop2" -> Route(302, listOf("Location" to "http://127.0.0.1:$port/gz"), ByteArray(0))
        "/hang" -> Route(200, emptyList(), ByteArray(0), hang = true)
        else -> Route(404, emptyList(), latin1("not found"))
      }
    }
    port = l.port
    try {
      val a = httpGet("http://127.0.0.1:$port/gz", emptyMap(), 5000)
      assertEquals(200, a.status)
      assertEquals(gz[1], a.text)
      assertEquals("W/\"1\"", a.headers["etag"])
      assertEquals(bom[1], httpGet("http://127.0.0.1:$port/bom", emptyMap(), 5000).text)
      val r = httpGet("http://127.0.0.1:$port/hop", emptyMap(), 5000)
      assertEquals(200, r.status)
      assertEquals(gz[1], r.text)
      assertEquals(404, httpGet("http://127.0.0.1:$port/nope", emptyMap(), 5000).status)
      val t0 = monoNanos()
      val timedOut = try { httpGet("http://127.0.0.1:$port/hang", emptyMap(), 400); false } catch (_: HttpTimeout) { true }
      val ms = (monoNanos() - t0) / 1_000_000
      assertTrue("timed out", timedOut)
      assertTrue("took $ms ms", ms in 350..1500)
    } finally { l.close() }
  }
}
