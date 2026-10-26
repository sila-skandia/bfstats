package io.bfstats.sidecar

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** NetConn.kt against netconn.mjs, from parity/netconn.mjs. */
class NetConnTest {
  private val fx = Fixtures.load("netconn")

  @Test fun connectRequestBytes() {
    for (row in fx["connectRequest"]!!.jsonArray) {
      val o = row.jsonObject["in"]!!.jsonObject
      val b = buildConnectRequest(Fixtures.str(o["password"]) ?: "", Fixtures.str(o["reconnectPassword"]) ?: "")
      assertEquals(Fixtures.js(o), Fixtures.str(row.jsonObject["hex"]), b.hex())
    }
    assertEquals(Fixtures.str(fx["serverInfoRequest"]), buildServerInfoRequest().hex())
  }

  @Test fun serverInfoParse() {
    for (row in fx["parseServerInfo"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.js(r["out"]), Js.stringify(parseServerInfo(fromHex(Fixtures.str(r["hex"])!!))))
    }
  }

  @Test fun presultNamesAndConstants() {
    for ((k, v) in fx["presult"]!!.jsonObject) assertEquals(v.jsonPrimitive.content, presultName(k.toLong()))
    val c = fx["constants"]!!.jsonObject
    assertEquals(Fixtures.num(c["PROTOCOL_MAJOR"])!!.toLong(), PROTOCOL_MAJOR)
    assertEquals(Fixtures.num(c["PROTOCOL_MINOR"])!!.toLong(), PROTOCOL_MINOR)
    assertEquals(Fixtures.num(c["MAX_DATAGRAM"])!!.toInt(), MAX_DATAGRAM)
    assertEquals(Fixtures.num(c["MAX_PAYLOAD"])!!.toInt(), MAX_PAYLOAD)
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
    override var onMessage: (ByteArray, SockAddr) -> Unit = { _, _ -> }
    val callbacks = ArrayDeque<(Throwable?) -> Unit>()
    override fun bind() = SockAddr("0.0.0.0", 0)
    override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
      log += Fixtures.encs("out", b, port, host); callbacks.addLast(done)
    }
    override fun close() { log += Fixtures.encs(listOf("sockClose")) }
  }

  private fun plusOf(opts: JsonObject): PlusIdentity? {
    if (!opts.containsKey("plus")) return PlusIdentity()
    val p = opts["plus"] as? JsonObject ?: return null
    val v = p["version"] as? JsonObject
    val version = if (v == null) PLUS_VERSION else PlusVersion(
      Fixtures.num(v["major"])?.toInt() ?: 0, Fixtures.num(v["minor"])?.toInt() ?: 0,
      Fixtures.num(v["patch"])?.toInt() ?: 0, Fixtures.num(v["build"])?.toInt() ?: 0,
    )
    return PlusIdentity(version, Fixtures.num(p["protocol"])?.toInt() ?: PLUS_PROTOCOL_VERSION)
  }

  private fun run(name: String, s: JsonObject) {
    val opts = s["opts"]!!.jsonObject
    val env = s["env"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
    val random = s["random"]!!.jsonArray.map { it.jsonPrimitive.content.toDouble() }
    var ri = 0
    val timers = ManualScheduler(1_000_000.0, 0.0)
    val log = mutableListOf<String>()
    val fake = FakeTransport(log)
    val c = NetConnection(
      "10.0.0.9", 14567, timers,
      password = Fixtures.str(opts["password"]) ?: "",
      reconnectPassword = Fixtures.str(opts["reconnectPassword"]) ?: "",
      plus = plusOf(opts), faults = PathFaults.fromEnv(env),
      random = { random[ri++ % random.size] }, transport = fake,
    )
    for (ev in listOf("connected", "denied", "disconnected", "pong", "data", "server-info", "unknown", "status", "raw-out")) {
      c.on(ev) { a -> log += Fixtures.encs(listOf("ev", ev) + a) }
    }
    c.on("raw-in") { a -> log += Fixtures.encs("ev", "raw-in", a[0]) }
    for (step in s["script"]!!.jsonArray) {
      val st = step.jsonObject
      log += Js.stringify(listOf("step", st))
      try {
        when (Fixtures.str(st["op"])) {
          "connect" -> c.connect()
          "in" -> fake.onMessage(fromHex(Fixtures.str(st["hex"])!!), SockAddr("10.0.0.9", 14567))
          "advance" -> timers.advance(Fixtures.num(st["ms"])!!)
          "flush" -> while (fake.callbacks.isNotEmpty()) fake.callbacks.removeFirst()(null)
          "send" -> log += Fixtures.encs("seq", c.sendData(fromHex(Fixtures.str(st["hex"])!!), Fixtures.plain(st["tag"])))
          "sendBig" -> c.sendData(ByteArray(Fixtures.num(st["n"])!!.toInt()))
          "ping" -> c.pingRequest()
          "disconnect" -> {
            val r = Fixtures.num(st["reason"])?.toLong()
            val m = Fixtures.str(st["message"])
            if (r != null && m != null) c.disconnect(r, m) else if (r != null) c.disconnect(r) else c.disconnect()
          }
          "close" -> c.close()
          "state" -> { c.state = Fixtures.str(st["state"])!!; Fixtures.num(st["id"])?.let { c.id = it.toInt() } }
          else -> error("bad op $st")
        }
      } catch (e: IllegalStateException) { log += Fixtures.encs("err", e.message) }
    }
    val end = linkedMapOf(
      "state" to c.state, "id" to c.id, "sendSeq" to c.sendSeq, "lastRecv" to c.lastRecv, "lastConfirmed" to c.lastConfirmed,
      "recvMask" to (c.recvMask.toLong() and 0xffffffffL), "lastSentSeq" to c.lastSentSeq, "stats" to c.stats.toJs(),
      "sentPackets" to c.sentPackets.entries.map { listOf(it.key, it.value) }, "lastHeardAt" to c.lastHeardAt, "now" to c.now(),
      "pending" to c.pending,
    )
    Fixtures.assertLines(name, Fixtures.lines(s["log"]), log)
    assertEquals("$name end", Fixtures.str(s["end"]), Fixtures.encs(end))
  }

  @Test fun transcripts() {
    val scripts = fx["scripts"]!!.jsonObject
    for ((name, s) in scripts) run(name, s.jsonObject)
  }
}
