package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import io.bfstats.sidecar.Assert.assertNull
import io.bfstats.sidecar.Assert.assertTrue
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test

/** NetConn.kt over real sockets: probeServerInfo against the Node fixture,
 *  and a NetConnection on UdpTransport + EventLoop against a loopback server
 *  (the disconnect harness's three goodbyes, through a real socket). */
class NetConnSocketTest {
  private val fx = Fixtures.load("netconn")

  private fun loopback(): Pair<UdpSocket, Int> { val s = udpSocket(); return s to s.bind(0).port }

  @Test fun probeServerInfoMatchesNode() {
    val p = fx["probe"]!!.jsonObject
    val reply = fromHex(Fixtures.str(p["reply"])!!)
    val got = mutableListOf<String>()
    val (server, sport) = loopback()
    server.use {
      val done = Latch()
      startThread("test-server") {
        val buf = ByteArray(2048)
        try {
          val (n, from) = server.receive(buf, 3000)
          got += buf.copyOf(n).hex()
          server.send(reply, from.host, from.port)
        } catch (_: Exception) {}
        done.countDown()
      }
      val up = probeServerInfo("127.0.0.1", sport, timeoutMs = 1000)
      assertEquals(Fixtures.js(p["up"]), Js.stringify(up))
      done.await(3000)
    }
    assertEquals(p["requests"]!!.jsonArray.map { Fixtures.str(it) }, got)
    val port = loopback().let { (s, n) -> s.close(); n }
    val t = monoNanos()
    assertNull(probeServerInfo("127.0.0.1", port, timeoutMs = 300))
    assertTrue((monoNanos() - t) / 1_000_000 < 1500)
  }

  @Test fun handshakeDataAndGoodbyeOverUdp() {
    val loop = EventLoop("test-loop")
    val (server, sport) = loopback()
    server.use {
      val c = NetConnection("127.0.0.1", sport, loop, plus = PlusIdentity(), faults = PathFaults())
      val connected = Latch()
      val data = Latch()
      var payload: ByteArray? = null
      c.on("connected") { connected.countDown() }
      c.on("data") { a -> payload = a[0] as ByteArray; data.countDown() }
      loop.call { c.bind(); c.connect() }
      val buf = ByteArray(2048)
      var last: SockAddr? = null
      fun recv(): ByteArray { val (n, from) = server.receive(buf, 3000); last = from; return buf.copyOf(n) }
      fun send(b: ByteArray) = server.send(b, "127.0.0.1", last!!.port)
      val req = recv()
      assertEquals(buildConnectRequest().hex(), req.hex())
      val accept = ByteArray(13).also { it[2] = 0x20; it[8] = 7; it.putU32le(9, 4242) }
      send(accept)
      // The ack may follow a resent request; skip to it.
      var ack = recv()
      while ((ack.u8(2) shr 4) == PT.ConnectRequest) ack = recv()
      assertEquals(buildPlusAcceptAck(7).hex(), ack.hex())
      assertTrue(connected.await(2000))
      val d = byteArrayOf(7, 1, 0xf0.toByte(), 0, 0, 0, 0, 2, 0, 0xab.toByte(), 0xcd.toByte())
      send(d)
      assertTrue(data.await(2000))
      assertEquals("abcd", payload!!.hex())
      loop.call { c.disconnect(0xd, "bye"); c.close() }
      val types = (0 until 3).map { recv().let { b -> (b.u8(2) shr 4) to b.u32le(8) } }
      assertEquals(List(3) { PT.Disconnect to 0xdL }, types)
    }
    loop.close()
  }
}
