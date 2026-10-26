package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** NetConn.kt over real sockets: probeServerInfo against the Node fixture,
 *  and a NetConnection on UdpTransport + EventLoop against a loopback server
 *  (the disconnect harness's three goodbyes, through a real socket). */
class NetConnSocketTest {
  private val fx = Parity.load("netconn")

  private fun loopback() = DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))

  @Test fun probeServerInfoMatchesNode() {
    val p = fx["probe"]!!.jsonObject
    val reply = fromHex(Parity.str(p["reply"])!!)
    val got = mutableListOf<String>()
    loopback().use { server ->
      thread(isDaemon = true) {
        val buf = ByteArray(2048)
        val pk = DatagramPacket(buf, buf.size)
        try { server.receive(pk); got += buf.copyOf(pk.length).hex(); server.send(DatagramPacket(reply, reply.size, pk.socketAddress)) } catch (_: Exception) {}
      }
      val up = probeServerInfo("127.0.0.1", server.localPort, timeoutMs = 1000)
      assertEquals(Parity.js(p["up"]), Js.stringify(up))
    }
    assertEquals(p["requests"]!!.jsonArray.map { Parity.str(it) }, got)
    val port = loopback().use { it.localPort }
    val t = System.nanoTime()
    assertNull(probeServerInfo("127.0.0.1", port, timeoutMs = 300))
    assertTrue((System.nanoTime() - t) / 1_000_000 < 1500)
  }

  @Test fun handshakeDataAndGoodbyeOverUdp() {
    val loop = EventLoop("test-loop")
    loopback().use { server ->
      server.soTimeout = 3000
      val c = NetConnection("127.0.0.1", server.localPort, loop, plus = PlusIdentity(), faults = PathFaults())
      val connected = CountDownLatch(1)
      val data = CountDownLatch(1)
      var payload: ByteArray? = null
      c.on("connected") { connected.countDown() }
      c.on("data") { a -> payload = a[0] as ByteArray; data.countDown() }
      loop.call { c.bind(); c.connect() }
      val buf = ByteArray(2048)
      fun recv(): ByteArray { val pk = DatagramPacket(buf, buf.size); server.receive(pk); return buf.copyOf(pk.length).also { last = pk.socketAddress } }
      val req = recv()
      assertEquals(buildConnectRequest().hex(), req.hex())
      val accept = ByteArray(13).also { it[2] = 0x20; it[8] = 7; it.putU32le(9, 4242) }
      server.send(DatagramPacket(accept, accept.size, last))
      // The ack may follow a resent request; skip to it.
      var ack = recv()
      while ((ack.u8(2) shr 4) == PT.ConnectRequest) ack = recv()
      assertEquals(buildPlusAcceptAck(7).hex(), ack.hex())
      assertTrue(connected.await(2, TimeUnit.SECONDS))
      val d = byteArrayOf(7, 1, 0xf0.toByte(), 0, 0, 0, 0, 2, 0, 0xab.toByte(), 0xcd.toByte())
      server.send(DatagramPacket(d, d.size, last))
      assertTrue(data.await(2, TimeUnit.SECONDS))
      assertEquals("abcd", payload!!.hex())
      loop.call { c.disconnect(0xd, "bye"); c.close() }
      val types = (0 until 3).map { recv().let { b -> (b.u8(2) shr 4) to b.u32le(8) } }
      assertEquals(List(3) { PT.Disconnect to 0xdL }, types)
    }
    loop.close()
  }

  private var last: java.net.SocketAddress? = null
}
