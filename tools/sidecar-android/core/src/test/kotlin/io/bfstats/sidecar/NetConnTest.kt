package io.bfstats.sidecar

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetSocketAddress

/** NetConn.kt against netconn.mjs, from parity/netconn.mjs. */
class NetConnTest {
  private val fx = Parity.load("netconn")

  @Test fun connectRequestBytes() {
    for (row in fx["connectRequest"]!!.jsonArray) {
      val o = row.jsonObject["in"]!!.jsonObject
      val b = buildConnectRequest(Parity.str(o["password"]) ?: "", Parity.str(o["reconnectPassword"]) ?: "")
      assertEquals(Parity.js(o), Parity.str(row.jsonObject["hex"]), b.hex())
    }
    assertEquals(Parity.str(fx["serverInfoRequest"]), buildServerInfoRequest().hex())
  }

  @Test fun serverInfoParse() {
    for (row in fx["parseServerInfo"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.js(r["out"]), Js.stringify(parseServerInfo(fromHex(Parity.str(r["hex"])!!))))
    }
  }

  @Test fun presultNamesAndConstants() {
    for ((k, v) in fx["presult"]!!.jsonObject) assertEquals(v.jsonPrimitive.content, presultName(k.toLong()))
    val c = fx["constants"]!!.jsonObject
    assertEquals(Parity.num(c["PROTOCOL_MAJOR"])!!.toLong(), PROTOCOL_MAJOR)
    assertEquals(Parity.num(c["PROTOCOL_MINOR"])!!.toLong(), PROTOCOL_MINOR)
    assertEquals(Parity.num(c["MAX_DATAGRAM"])!!.toInt(), MAX_DATAGRAM)
    assertEquals(Parity.num(c["MAX_PAYLOAD"])!!.toInt(), MAX_PAYLOAD)
  }

  @Test fun labKnobsFromEnv() {
    for (row in fx["env"]!!.jsonArray) {
      val r = row.jsonObject
      val env = r["env"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
      val f = PathFaults.fromEnv(env)
      val got = Js.stringify(linkedMapOf("lagMs" to f.lagMs, "jitterMs" to f.jitterMs, "loss" to f.loss))
      val want = Js.stringify(linkedMapOf("lagMs" to r["lagMs"], "jitterMs" to r["jitterMs"], "loss" to r["loss"]))
      assertEquals(env.toString(), want, got)
    }
  }

  private class FakeTransport(val log: MutableList<String>) : Transport {
    override var onMessage: (ByteArray, InetSocketAddress) -> Unit = { _, _ -> }
    val callbacks = ArrayDeque<(Throwable?) -> Unit>()
    override fun bind() = InetSocketAddress(0)
    override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
      log += Parity.encs("out", b, port, host); callbacks.addLast(done)
    }
    override fun close() { log += Parity.encs(listOf("sockClose")) }
  }

  private fun plusOf(opts: JsonObject): PlusIdentity? {
    if (!opts.containsKey("plus")) return PlusIdentity()
    val p = opts["plus"] as? JsonObject ?: return null
    val v = p["version"] as? JsonObject
    val version = if (v == null) PLUS_VERSION else PlusVersion(
      Parity.num(v["major"])?.toInt() ?: 0, Parity.num(v["minor"])?.toInt() ?: 0,
      Parity.num(v["patch"])?.toInt() ?: 0, Parity.num(v["build"])?.toInt() ?: 0,
    )
    return PlusIdentity(version, Parity.num(p["protocol"])?.toInt() ?: PLUS_PROTOCOL_VERSION)
  }

  private fun run(name: String, s: JsonObject) {
    val opts = s["opts"]!!.jsonObject
    val env = s["env"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
    val random = s["random"]!!.jsonArray.map { it.jsonPrimitive.content.toDouble() }
    var ri = 0
    val timers = FakeTimers()
    val log = mutableListOf<String>()
    val fake = FakeTransport(log)
    val c = NetConnection(
      "10.0.0.9", 14567, timers,
      password = Parity.str(opts["password"]) ?: "",
      reconnectPassword = Parity.str(opts["reconnectPassword"]) ?: "",
      plus = plusOf(opts), faults = PathFaults.fromEnv(env),
      random = { random[ri++ % random.size] }, transport = fake,
    )
    for (ev in listOf("connected", "denied", "disconnected", "pong", "data", "server-info", "unknown", "status", "raw-out")) {
      c.on(ev) { a -> log += Parity.encs(listOf("ev", ev) + a) }
    }
    c.on("raw-in") { a -> log += Parity.encs("ev", "raw-in", a[0]) }
    for (step in s["script"]!!.jsonArray) {
      val st = step.jsonObject
      log += Js.stringify(listOf("step", st))
      try {
        when (Parity.str(st["op"])) {
          "connect" -> c.connect()
          "in" -> fake.onMessage(fromHex(Parity.str(st["hex"])!!), InetSocketAddress("10.0.0.9", 14567))
          "advance" -> timers.advance(Parity.num(st["ms"])!!)
          "flush" -> while (fake.callbacks.isNotEmpty()) fake.callbacks.removeFirst()(null)
          "send" -> log += Parity.encs("seq", c.sendData(fromHex(Parity.str(st["hex"])!!), Parity.plain(st["tag"])))
          "sendBig" -> c.sendData(ByteArray(Parity.num(st["n"])!!.toInt()))
          "ping" -> c.pingRequest()
          "disconnect" -> {
            val r = Parity.num(st["reason"])?.toLong()
            val m = Parity.str(st["message"])
            if (r != null && m != null) c.disconnect(r, m) else if (r != null) c.disconnect(r) else c.disconnect()
          }
          "close" -> c.close()
          "state" -> { c.state = Parity.str(st["state"])!!; Parity.num(st["id"])?.let { c.id = it.toInt() } }
          else -> error("bad op $st")
        }
      } catch (e: IllegalStateException) { log += Parity.encs("err", e.message) }
    }
    val end = linkedMapOf(
      "state" to c.state, "id" to c.id, "sendSeq" to c.sendSeq, "lastRecv" to c.lastRecv, "lastConfirmed" to c.lastConfirmed,
      "recvMask" to (c.recvMask.toLong() and 0xffffffffL), "lastSentSeq" to c.lastSentSeq, "stats" to c.stats.toJs(),
      "sentPackets" to c.sentPackets.entries.map { listOf(it.key, it.value) }, "lastHeardAt" to c.lastHeardAt, "now" to c.now(),
      "pending" to c.pending,
    )
    Parity.assertLines(name, Parity.lines(s["log"]), log)
    assertEquals("$name end", Parity.str(s["end"]), Parity.encs(end))
  }

  @Test fun transcripts() {
    val scripts = fx["scripts"]!!.jsonObject
    for ((name, s) in scripts) run(name, s.jsonObject)
  }
}
