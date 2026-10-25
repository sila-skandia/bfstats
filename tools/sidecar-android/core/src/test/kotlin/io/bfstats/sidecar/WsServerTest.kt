package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

class WsServerTest {
  @Test fun originRulesMatchTheNodeCopy() {
    assertTrue(originAllowed(null))
    assertTrue(originAllowed(""))
    assertTrue(originAllowed("https://play.bfstats.io"))
    assertTrue(originAllowed("HTTPS://BFSTATS.IO/"))
    assertTrue(originAllowed("http://localhost:5173"))
    assertTrue(originAllowed("http://127.0.0.1"))
    assertTrue(originAllowed("http://[::1]:8080"))
    assertFalse(originAllowed("https://evil.example"))
    assertFalse(originAllowed("https://bfstats.io.evil.example"))
    assertFalse(originAllowed("null"))
    assertTrue(originAllowed("https://a.test", listOf("https://a.test/")))
  }

  @Test fun acceptKeyIsTheRfcExample() {
    // RFC 6455 section 1.3.
    assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", acceptKey("dGhlIHNhbXBsZSBub25jZQ=="))
  }

  @Test fun framesRoundTripAtEveryLengthForm() {
    for (n in listOf(0, 125, 126, 65535, 65536)) {
      val p = ByteArray(n) { (it * 7).toByte() }
      val f = readFrame(ByteArrayInputStream(encodeFrame(p, 0x2)))!!
      assertEquals(0x2, f.opcode)
      assertTrue(p.contentEquals(f.payload))
    }
  }

  @Test fun echoesAMaskedTextFrame() {
    val server = WsServer(0)
    server.onConnection = { ws -> ws.onMessage = { text, _ -> if (text != null) ws.send("echo:$text") } }
    val port = server.listen()
    Socket("127.0.0.1", port).use { s ->
      s.getOutputStream().write(
        ("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Origin: https://play.bfstats.io\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n").toByteArray())
      val input = s.getInputStream()
      val head = StringBuilder()
      while (!head.endsWith("\r\n\r\n")) head.append(input.read().toChar())
      assertTrue(head.startsWith("HTTP/1.1 101"))
      val mask = byteArrayOf(1, 2, 3, 4)
      val body = "hi".toByteArray().mapIndexed { i, b -> (b.toInt() xor mask[i and 3].toInt()).toByte() }
      s.getOutputStream().write(byteArrayOf(0x81.toByte(), (0x80 or 2).toByte()) + mask + body.toByteArray())
      val got = ArrayBlockingQueue<String>(1)
      Thread { got.put(String(readFrame(input)!!.payload)) }.start()
      assertEquals("echo:hi", got.poll(5, TimeUnit.SECONDS))
    }
    server.close()
  }

  @Test fun refusesAStrayOrigin() {
    val server = WsServer(0)
    val port = server.listen()
    Socket("127.0.0.1", port).use { s ->
      s.getOutputStream().write(
        ("GET / HTTP/1.1\r\nUpgrade: websocket\r\nOrigin: https://evil.example\r\n" +
          "Sec-WebSocket-Key: x\r\n\r\n").toByteArray())
      val line = s.getInputStream().bufferedReader().readLine()
      assertTrue(line.startsWith("HTTP/1.1 403"))
    }
    server.close()
  }
}
