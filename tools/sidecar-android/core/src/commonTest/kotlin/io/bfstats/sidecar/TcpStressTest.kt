package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** The platform's TCP under the page socket: a listener whose accept loop
 *  hands each connection to a thread of its own (as WsServer does), and many
 *  short connections in a row, each answered. A connection the server never
 *  reads is a page that never joins. */
class TcpStressTest {
  @Test fun everyConnectionIsAnswered() {
    val l = tcpListen("127.0.0.1", 0)
    val stages = ArrayList<String>()
    val lock = Lock()
    val run = BooleanArray(1) { true }
    startThread("stress-accept") {
      while (run[0]) {
        val c = try { l.accept() } catch (_: Exception) { break }
        startThread("stress-conn") {
          try {
            val b = c.read()
            if (b >= 0) c.write(byteArrayOf((b + 1).toByte()))
          } catch (_: Exception) {}
          try { c.close() } catch (_: Exception) {}
        }
      }
    }
    var missed = 0
    for (i in 0 until 60) {
      val conn = tcpConnect("127.0.0.1", l.port)
      conn.write(byteArrayOf(i.toByte()))
      val got = Handoff<Int>()
      startThread("stress-read") { got.put(try { conn.read() } catch (_: Exception) { -2 }) }
      val v = got.poll(3000)
      if (v != ((i + 1) and 0xff)) { missed++; lock.withLock { stages += "#$i got $v" } }
      conn.close()
    }
    run[0] = false
    l.close()
    assertEquals(stages.joinToString(", "), 0, missed)
  }

  /** The same with a fresh listener per connection, each closed while its
   *  accept loop waits (a page socket stopped and another started), and the
   *  client sending its bytes in pieces. */
  @Test fun freshListenersAnswerEveryConnection() {
    val stages = ArrayList<String>()
    for (i in 0 until 40) {
      val l = tcpListen("127.0.0.1", 0)
      startThread("stress-accept") {
        while (true) {
          val c = try { l.accept() } catch (_: Exception) { break }
          startThread("stress-conn") {
            try {
              val a = c.read(); val b = c.read()
              if (a >= 0 && b >= 0) c.write(byteArrayOf((a + b).toByte()))
            } catch (_: Exception) {}
            try { c.close() } catch (_: Exception) {}
          }
        }
      }
      val conn = tcpConnect("127.0.0.1", l.port)
      val got = Handoff<Int>()
      startThread("stress-read") { got.put(try { conn.read() } catch (_: Exception) { -2 }) }
      conn.write(byteArrayOf(i.toByte()))
      sleepMs(20)
      conn.write(byteArrayOf(1))
      val v = got.poll(3000)
      if (v != ((i + 1) and 0xff)) stages += "#$i got $v"
      conn.close()
      l.close()
    }
    assertEquals(stages.joinToString(", "), 0, stages.size)
  }

  /** UDP the way a rejoin uses it: a socket closed while its receive thread
   *  waits, then a fresh one that must hear what is sent to it. */
  @Test fun freshUdpSocketsHearAfterAClosedOne() {
    val stages = ArrayList<String>()
    val sender = udpSocket().also { it.bind(0) }
    for (i in 0 until 40) {
      val old = udpSocket()
      old.bind(0)
      startThread("udp-old") { try { old.receive(ByteArray(64)) } catch (_: Exception) {} }
      sleepMs(10)
      old.close()
      val s = udpSocket()
      val port = s.bind(0).port
      val got = Handoff<Int>()
      startThread("udp-new") { got.put(try { s.receive(ByteArray(64), 3000).first } catch (_: Exception) { -1 }) }
      sleepMs(10)
      sender.send(byteArrayOf(1, 2, 3), "127.0.0.1", port)
      val n = got.poll(4000)
      if (n != 3) stages += "udp #$i got $n"
      s.close()
    }
    sender.close()
    assertEquals(stages.joinToString(", "), 0, stages.size)
  }
}
