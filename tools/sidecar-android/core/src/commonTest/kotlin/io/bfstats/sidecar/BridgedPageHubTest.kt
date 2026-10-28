package io.bfstats.sidecar

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** BridgedPageHub: the iPhone app's page socket that is not a socket. */
class BridgedPageHubTest {
  private class Inner : PageHub {
    override var onConnection: (PageSocket) -> Unit = {}
    override var onRefused: (String?) -> Unit = {}
    override val clientCount = 0
    val sent = ArrayList<String>()
    var closed = false
    override fun listen() = 17942
    override fun broadcast(text: String) { sent += text }
    override fun close() { closed = true }
  }

  @Test fun framesEachWayInOrder() {
    val sched = ManualScheduler()
    val out = ArrayList<String>()
    val inner = Inner()
    val hub = BridgedPageHub(inner, sched, out = { id, t -> out += "$id:$t" })
    val log = ArrayList<String>()
    hub.onConnection = { sock ->
      log += "open"
      sock.send("hello")
      sock.onMessage = { b -> log += "msg ${b.decodeToString()}" }
      sock.onClose = { log += "close" }
    }
    assertEquals(17942, hub.listen())
    assertTrue(hub.open(7))
    assertFalse(hub.open(7), "an id is taken once")
    // Frames given before the loop ran queue behind the connection.
    hub.message(7, "a".encodeToByteArray())
    hub.message(7, "b".encodeToByteArray())
    assertEquals(emptyList<String>(), log)
    sched.runDue()
    assertEquals(listOf("open", "msg a", "msg b"), log)
    assertEquals(listOf("7:hello"), out)
    assertEquals(1, hub.clientCount)

    hub.broadcast("row")
    assertEquals(listOf("7:hello", "7:row"), out)
    assertEquals(listOf("row"), inner.sent, "the real socket's pages get it too")

    hub.close(7)
    hub.message(7, "late".encodeToByteArray())
    sched.runDue()
    assertEquals(listOf("open", "msg a", "msg b", "close"), log)
    hub.broadcast("after")
    assertEquals(listOf("7:hello", "7:row"), out, "nothing reaches a closed page")
    assertEquals(0, hub.clientCount)
  }

  @Test fun closingTheHubClosesEveryBridgedPage() {
    val sched = ManualScheduler()
    val gone = ArrayList<Int>()
    val inner = Inner()
    val hub = BridgedPageHub(inner, sched, out = { _, _ -> }, closed = { gone += it })
    hub.onConnection = {}
    hub.listen()
    hub.open(1); hub.open(2)
    sched.runDue()
    hub.close()
    assertEquals(listOf(1, 2), gone)
    assertTrue(inner.closed)
    assertFalse(hub.open(3), "no page opens on a closed hub")
  }

  @Test fun bridgedOnly() {
    val sched = ManualScheduler()
    val hub = BridgedPageHub(null, sched, out = { _, _ -> })
    assertEquals(0, hub.listen())
    var opened = 0
    hub.onConnection = { opened++ }
    hub.open(1)
    sched.runDue()
    assertEquals(1, opened)
    hub.closeAll()
    assertEquals(0, hub.clientCount)
  }
}
