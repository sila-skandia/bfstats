package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import io.bfstats.sidecar.Assert.assertTrue
import kotlin.test.Test

/** Session.kt against parity/session.mjs: the same steps through a fake
 *  socket and the fake clock, the same transcript line for line. */
class SessionTest {
  companion object {
    private val fx: Map<String, Any?> by lazy {
      Fixtures.freshCache()
      Fixtures.json("session.json.gz").m()
    }

    const val KEY = "ABCDE-FGHJK-LMNPQ-RSTUV"
    val EVENT_NAMES = listOf("open", "connected", "joined", "event", "unknown-event", "ghost", "unknown-datagram", "decode-error",
      "denied", "disconnected", "pong", "stats", "left", "level-change", "plus-settings", "skip-static-objects",
      "level-hold", "level-release", "sent", "control-state")

    fun seeded(seed: Long): (Int) -> Int { val r = prng(seed); return { max -> Math.floor(r() * max).toInt() } }

    /** A payload as the Node transcript holds it. */
    fun payload(v: Any?): Any? = when (v) {
      is ServerSettings -> v.toJs()
      else -> v
    }
  }

  /** The socket: every datagram logged, its send callback a loop turn later. */
  class FakeTransport(val sched: ManualScheduler, val lines: MutableList<String>) : Transport {
    override var onMessage: (ByteArray, SockAddr) -> Unit = { _, _ -> }
    override fun bind() = SockAddr("127.0.0.1", 50000)
    override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
      lines += Fixtures.encs(listOf(sched.now, "out", b.copyOf()))
      sched.post { done(null) }
    }
    override fun close() { lines += Js.stringify(listOf(sched.now, "sockClose")) }
  }

  private fun run(name: String, sc: Map<String, Any?>): List<String> {
    Rebuild.resetModuleState()
    val sched = ManualScheduler(0.0)
    val lines = ArrayList<String>()
    val o = sc["opts"].m()
    val transport = FakeTransport(sched, lines)
    val gateSpec = o.o("gate")
    val gate: LevelGate? = when {
      gateSpec === Undefined -> null
      gateSpec == "throw" -> { _, _ -> throw RuntimeException("gate broke") }
      gateSpec == "never" -> { _, _ -> true }
      gateSpec == "none" -> { _, _ -> false }
      else -> { _, done -> sched.schedule(gateSpec.g("delay").d()) { done(gateSpec.g("result")) }; true }
    }
    val key = o.o("key")
    val s = Session("10.0.0.9", 14567, SessionOptions(
      name = (o.o("name") as? String) ?: "sidecar",
      team = (o.o("team") as? Double)?.toInt() ?: 0,
      plus = if (o.containsKey("plus") && o["plus"] == null) null else PlusIdentity(),
      keyFor = { if (key == null) null else (key as? String) ?: KEY },
      silenceMs = (o.o("silenceMs") as? Double) ?: 20000.0,
      levelHoldMs = (o.o("levelHoldMs") as? Double) ?: 30000.0,
      levelGate = gate,
      randomInt = seeded((sc["seed"] as Double).toLong()),
      transport = transport,
      faults = PathFaults(),
    ), sched)
    for (n in EVENT_NAMES) s.on(n) { a -> lines += Fixtures.encs(listOf(sched.now, "ev", n) + a.map { payload(it) }) }
    for (st0 in sc["steps"].l()) {
      val st = st0.m()
      sched.advanceTo(st["t"].d())
      when (st["op"]) {
        "start" -> s.start()
        "in" -> transport.onMessage(fromHex(st["hex"] as String), SockAddr("10.0.0.9", 14567))
        "queue" -> s.queue(st["name"] as String, (st.o("body") as? Map<String, Any?>) ?: emptyMap())
        "say" -> lines += Js.stringify(listOf(sched.now, "said", s.chatOut.say(st["text"] as String, JsOps.truthy(st.o("team")))))
        "leave" -> s.leave()
        "close" -> s.close()
        "end" -> {}
        else -> error("bad op ${st["op"]}")
      }
      sched.runDue()
    }
    lines += Fixtures.encs(listOf(sched.now, "end", linkedMapOf(
      "joined" to s.joined,
      "me" to linkedMapOf("playerId" to s.me.playerId, "team" to s.me.team, "dbAcked" to s.me.dbAcked, "challengeA" to s.me.challengeA,
        "contentMod" to s.me.contentMod, "mapId" to s.me.mapId),
      "players" to s.players.size, "objects" to s.objects.size, "soldiers" to s.soldiers.toList(), "nextSendBlock" to s.nextSendBlock,
      "lastConfirmedBlock" to s.lastConfirmedBlock, "unconfirmed" to s.unconfirmed.keys.toList(), "outbox" to s.outbox.size,
      "nextRecvBlock" to s.nextRecvBlock, "levelChange" to s.levelChange?.toJs(),
      "plus" to linkedMapOf("skipStaticObjects" to s.plus.skipStaticObjects, "setLevelSeen" to s.plus.setLevelSeen),
      "restart" to s.restartTiming().toJs(), "conn" to s.conn.state,
    )))
    s.close()
    return lines
  }

  private fun check(name: String) {
    val sc = fx[name].m()
    @Suppress("UNCHECKED_CAST")
    val want = sc["lines"] as List<String>
    val got = run(name, sc)
    val d = Fixtures.diff(want, got, name)
    assertTrue(d, d.isEmpty())
  }

  @Test fun capture() = check("capture")
  @Test fun xpackJoin() = check("xpackJoin")
  @Test fun window() = check("window")
  @Test fun chatQuiet() = check("chatQuiet")
  @Test fun malformed() = check("malformed")
  @Test fun gateTimeout() = check("gateTimeout")
  @Test fun gateThrows() = check("gateThrows")
  @Test fun gateNone() = check("gateNone")

  @Test fun helpers() {
    for (c in fx["challengeResponses"].l()) {
      val i = c.g("in").m()
      val ch = linkedMapOf<String, Any?>("challenge" to fromHex(i["challenge"] as String), "xpack" to i["xpack"], "mod" to i["mod"])
      val got = challengeResponses(ch, { x -> if (x == 713L) null else "$KEY$x" },
        { m -> when (m) { "XPack2" -> 0xdeadbeefL; "BF1942" -> 0x01020304L; else -> null } }, seeded(7))
      assertEquals(Js.stringify(c.g("out")), Fixtures.encs(got))
    }
    for (c in fx["contentAck"].l()) {
      val (a, b) = c.g("in").l()
      assertEquals(c.g("out").d(), contentAck((a as Double?)?.toLong(), (b as Double?)?.toLong()).toDouble(), 0.0)
    }
    for (c in fx["eventWindowFull"].l()) {
      val (a, b) = c.g("in").l()
      assertEquals(c.g("out"), eventWindowFull(a.d().toInt(), b.d().toInt()))
    }
  }
}
