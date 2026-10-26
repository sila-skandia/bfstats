package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.MessageDigest

/** Input.kt against parity/input.mjs: the pure functions, the team calls, and InputSender op by op. */
class InputTest {
  private val f = Fixtures.loadJs("input")
  private val pure = f["pure"].m()

  private fun attempt(fn: () -> Any?): LinkedHashMap<String, Any?> =
    try { linkedMapOf("ok" to Fixtures.canon(fn())) } catch (e: Exception) { linkedMapOf("error" to e.message) }

  private fun actionOf(a: Any?): Action =
    Action(a.m()["axes"].l().map { it.d() }.toDoubleArray(), a.m()["buttons"].d().toLong())

  @Test fun axesEncodeAndDecodeAsNode() {
    Fixtures.same("encodeAxis", pure["encodeAxis"], pure["encodeAxis"].l().map { listOf(it.l()[0], encodeAxis(it.l()[0])) })
    Fixtures.same("encodeAxisOdd", pure["encodeAxisOdd"], pure["encodeAxisOdd"].l().map { listOf(it.l()[0], encodeAxis(it.l()[0])) })
    Fixtures.same("decodeAxis", pure["decodeAxis"], (0 until 4096).map { decodeAxis(it.toDouble()) })
  }

  @Test fun buttonsAndShapesAsNode() {
    Fixtures.same("buttonMask", pure["buttonMask"], pure["buttonMask"].l().map { listOf(it.l()[0], attempt { buttonMask(it.l()[0]) }) })
    for ((i, s) in pure["shapes"].l().withIndex()) {
      val x = s.m()["input"]
      val got = linkedMapOf("input" to x, "encoded" to isEncodedShape(x), "encodeAction" to attempt { encodeAction(x) },
        "actionFor" to attempt { actionFor(x) }, "normaliseAction" to attempt { normaliseAction(x) })
      Fixtures.same("shape $i ${Js.stringify(x)}", s, got)
    }
    val c = pure["constants"].m()
    Fixtures.same("ONE_SHOT", c["ONE_SHOT_BUTTONS"], ONE_SHOT_BUTTONS)
    Fixtures.same("TOGGLE", c["TOGGLE_STATE_BUTTONS"], TOGGLE_STATE_BUTTONS)
    Fixtures.same("BUTTON", c["BUTTON"], BUTTON.byName)
    Fixtures.same("BUTTON_CHANNEL", c["BUTTON_CHANNEL"], BUTTON_CHANNEL)
    Fixtures.same("AXIS", c["AXIS"], linkedMapOf("YAW" to AXIS.YAW, "PITCH" to AXIS.PITCH, "ROLL" to AXIS.ROLL, "THROTTLE" to AXIS.THROTTLE,
      "MOUSELOOK_X" to AXIS.MOUSELOOK_X, "MOUSELOOK_Y" to AXIS.MOUSELOOK_Y))
    Fixtures.same("AXIS_NAMES", c["AXIS_NAMES"], AXIS_NAMES)
    Fixtures.same("TEAMS", c["TEAMS"], linkedMapOf("AXIS" to TEAMS.AXIS, "ALLIES" to TEAMS.ALLIES))
    for ((k, v) in listOf("SERIAL_MAX" to SERIAL_MAX, "DEFAULT_SERIAL" to DEFAULT_SERIAL, "TICK_RATE" to TICK_RATE, "AXIS_FULL" to AXIS_FULL,
      "ACTION_BITS" to ACTION_BITS, "MAX_ACTIONS_PER_PACKET" to MAX_ACTIONS_PER_PACKET, "SPAWN_GROUP_MAX" to SPAWN_GROUP_MAX)) Fixtures.same(k, c[k], v)
  }

  @Test fun payloadsEdgesAndHoldsAsNode() {
    for ((i, p) in pure["payload"].l().withIndex()) {
      val m = p.m()
      val actions = m["actions"].l().map(::actionOf)
      val res = attempt { inputPayload(actions, m["first"].d().toLong(), m["mask"].d().toInt()).hex() }
      val got = LinkedHashMap<String, Any?>()
      got["actions"] = m["actions"]; got["first"] = m["first"]; got["mask"] = m["mask"]; got.putAll(res)
      got["decoded"] = if (res.containsKey("ok")) decodeInputBlock(fromHex(res["ok"] as String)) else null
      Fixtures.same("payload $i", m, got)
    }
    for ((i, h) in pure["holdOf"].l().withIndex()) Fixtures.same("holdOf $i", h.m()["held"], holdOf(actionOf(h.m()["action"])))
    val edges = PageButtonEdges()
    for ((i, e) in pure["edges"].l().withIndex()) {
      val out = edges.apply(e.l()[0], e.l()[1])
      if (i == 40) edges.reset()
      Fixtures.same("edge $i", e.l()[2], out)
    }
    for (a in pure["actionIndexOf"].l()) Fixtures.same("actionIndexOf ${a.l()[0]}", a.l()[1], actionIndexOf(a.l()[0]))
  }

  @Test fun selfTestPassesAsNodes() {
    Fixtures.same("selfTest", pure["selfTest"], selfTest(verbose = false).map { linkedMapOf("name" to it.name, "ok" to it.ok, "detail" to it.detail) })
  }

  // --- the team calls --------------------------------------------------------

  private class Me(override val playerId: Any?, override var team: Any?) : InputPlayer
  private class TeamSession(override val me: InputPlayer?, val log: MutableList<Any?>, val sched: ManualScheduler) : InputSession {
    override val conn: InputConn? = null
    override val joined = true
    override fun queue(name: String, body: Map<String, Any?>) { log.add(listOf("queue", sched.now, name, body)) }
    override val chatOut = object : ChatOut {
      override fun say(text: String, team: Boolean): Boolean { log.add(listOf("say", sched.now, text, team)); return text.isNotEmpty() && text.length < 20 }
    }
  }
  private fun meOf(v: Any?): Me? = if (v == null) null else Me(v.m()["playerId"], v.m()["team"])

  @Test fun teamKitSpawnAndChatAsNode() {
    val sched = ManualScheduler(0.0)
    val t = f["teams"].l()
    for ((n, c) in t.withIndex()) {
      val m = c.m()
      if (m.containsKey("spawnSequence")) {
        for ((i, sq) in m["spawnSequence"].l().withIndex()) {
          val s = sq.m()
          val log = ArrayList<Any?>()
          val sess = TeamSession(meOf(s["me"]), log, sched)
          val start = sched.now
          var settled: Any? = null
          val o = s["opts"].m()
          val opts = SpawnOptions(team = if (o.containsKey("team")) o["team"] else null, kit = if (o.containsKey("kit")) o["kit"] else null,
            spawnGroup = if (o.containsKey("spawnGroup")) o["spawnGroup"] else 0, spawnPoint = if (o.containsKey("spawnPoint")) o["spawnPoint"] else 0,
            stepMs = if (o.containsKey("stepMs")) o["stepMs"].d() else 100.0)
          spawnSequence(sess, opts, sched) { r ->
            settled = r.fold({ linkedMapOf("ok" to it.toList(), "at" to sched.now - start) }, { linkedMapOf("error" to it.message, "at" to sched.now - start) })
          }
          var tt = 0
          while (tt <= 500) { sched.advanceTo(start + tt); tt += 10 }
          val rel = log.map { e -> val l = e.l(); listOf(l[0], (l[1] as Double) - start) + l.drop(2) }
          Fixtures.same("spawnSequence $i", s, linkedMapOf("me" to s["me"], "opts" to s["opts"], "log" to rel, "settled" to settled))
        }
        continue
      }
      val log = ArrayList<Any?>()
      val sess = TeamSession(meOf(m["me"]), log, sched)
      for (call in m["calls"].l()) {
        val a = call.l()
        val r = attempt {
          when (a[0]) {
            "team" -> if (a.size > 2) sendTeam(sess, a[1], a[2]) else sendTeam(sess, a[1])
            "kit" -> sendKit(sess, a[1])
            "spawn" -> sendSpawnRequest(sess, a[1], a[2])
            else -> sendChat(sess, a[1] as String, a[2])
          }
        }
        log.add(listOf("ret", call, r))
      }
      Fixtures.same("teams $n", m, linkedMapOf("me" to m["me"], "calls" to m["calls"], "log" to log))
    }
  }

  // --- the sender, op by op ---------------------------------------------------

  /** The Kotlin half of input.mjs's makeDriver: the same ops, the same log. */
  class Driver(val sched: ManualScheduler = ManualScheduler(0.0)) {
    val log = ArrayList<Any?>()
    var sender: InputSender? = null
    private var sess: Sess? = null
    private var customClock = 0.0
    private var failNext = 0
    private var failEvery = 0
    private var calls = 0
    private var idleCalls = 0

    inner class Conn(override var state: String) : InputConn {
      override fun sendData(payload: ByteArray, meta: Map<String, Any?>): Any? {
        calls++
        if (failNext > 0 || (failEvery != 0 && calls % failEvery == 0)) { if (failNext > 0) failNext--; throw RuntimeException("send window full") }
        log.add(listOf("send", sched.now, payload.hex(), meta["input"], calls))
        return calls
      }
    }
    inner class Sess(override var joined: Boolean, state: String) : InputSession {
      override val conn = Conn(state)
      override val me: InputPlayer? = null
      override fun queue(name: String, body: Map<String, Any?>) {}
      override val chatOut: ChatOut? = null
    }

    fun apply(op: List<Any?>) {
      val name = op[0] as String
      val a = op.drop(1)
      fun ret(v: Any?) { log.add(listOf("ret", name, Fixtures.canon(v))) }
      try {
        when (name) {
          "at" -> sched.advanceTo(a[0].d())
          "new" -> {
            val o = a[0].m()
            sess = Sess(if (o.containsKey("joined")) o["joined"] == true else true, (o["state"] as String?) ?: "connected")
            failEvery = (o["failEvery"] as Number?)?.toInt() ?: 0
            val mergeAbove = o["mergeAbove"]
            val idleEvery = (o["idleEvery"] as Number?)?.toInt() ?: 0
            val opts = InputSenderOptions(
              rate = o["rate"], idle = o["idle"] as String?, pace = o["pace"] as String?,
              firstSerial = (o["firstSerial"] as Number?)?.toLong(), maxQueue = (o["maxQueue"] as Number?)?.toInt(),
              idleAfterMs = (o["idleAfterMs"] as Number?)?.toDouble(),
              mergeAbove = if (mergeAbove == "Infinity") Double.POSITIVE_INFINITY else (mergeAbove as Number?)?.toDouble(),
              clock = if (o["clock"] == "custom") ({ customClock }) else null,
              idleButtons = if (idleEvery != 0) ({ if (idleCalls++ % idleEvery == 1) BUTTON.ACTION or BUTTON.FIRE else 0L }) else null,
            )
            val s = InputSender(sess, opts, sched)
            sender = s
            for (ev in listOf("sent", "merged", "started", "stopped", "error")) s.on(ev) { p -> log.add(listOf("emit", sched.now, ev, Fixtures.canon(p))) }
          }
          "enq" -> ret(sender!!.enqueue(a[0], a[1]))
          "enqz" -> ret(sender!!.enqueue(linkedMapOf("axes" to List(6) { AXIS_CENTRE.toDouble() }, "buttons" to 0.0), a[0]))
          "ack" -> ret(sender!!.atAck(a[0].d().toLong(), (a[1] as Number?)?.toDouble()))
          "rtt" -> sender!!.noteRtt((a[0] as Number?)?.toDouble() ?: Double.NaN)
          "start" -> sender!!.start()
          "stop" -> sender!!.stop()
          "set" -> ret(sender!!.setInput(a[0]))
          "press" -> ret(sender!!.press(a[0]))
          "release" -> ret(sender!!.release(a[0]))
          "tick" -> if (a[0] == null) sender!!._tick() else sender!!._tick(a[0].d())
          "pump" -> sender!!._pump()
          "poke" -> when (a[0]) {
            "_tokens" -> sender!!._tokens = a[1].d()
            "_lastInputAt" -> sender!!._lastInputAt = a[1].d()
            "_nextAt" -> sender!!._nextAt = a[1].d()
            "_releasedAt" -> sender!!._releasedAt = a[1].d()
            else -> error("poke ${a[0]}")
          }
          "sess" -> { sess!!.joined = a[0] == true; sess!!.conn.state = a[1] as String }
          "fail" -> failNext = a[0].d().toInt()
          "clock" -> customClock = a[0].d()
          "state" -> log.add(listOf("state", snapshot(sender!!)))
          else -> error("op $name")
        }
      } catch (e: InputError) { log.add(listOf("throw", name, e.message)) }
    }

    private fun snapshot(s: InputSender): Map<String, Any?> = linkedMapOf(
      "serial" to s.serial, "stats" to s.stats.toJs(), "path" to s.path.toJs(), "running" to s.running, "rtt" to s.rttMs(), "action" to s.action,
      "pending" to s.pending.map { w -> linkedMapOf("serial" to w.serial, "tag" to w.tag, "merged" to w.merged, "recvAt" to w.recvAt, "action" to w.action) },
      "recent" to s.recent.map { it.serial },
      "released" to s.released.takeLast(6).map { linkedMapOf("serial" to it.serial, "recvAt" to it.recvAt, "relAt" to it.relAt) },
      "tokens" to s._tokens, "tokensAt" to s._tokensAt, "releasedAt" to s._releasedAt, "nextAt" to s._nextAt, "lastInputAt" to s._lastInputAt,
    )
  }

  @Test fun senderScriptsAsNode() {
    for (sc in f["scripts"].l()) {
      val m = sc.m()
      val d = Driver()
      for (op in m["ops"].l()) d.apply(op.l())
      val want = m["log"].l()
      for (i in want.indices) Fixtures.same("${m["name"]} entry $i", want[i], d.log.getOrNull(i))
      assertEquals("${m["name"]} entries", want.size, d.log.size)
    }
  }

  private fun sha(x: Any?): String = MessageDigest.getInstance("SHA-256").digest(Fixtures.canonJs(x).toByteArray(Charsets.UTF_8)).hex()

  @Test fun senderAgainstThePagesClockAsNode() {
    val chunk = f["chunk"].d().toInt()
    for (sim in f["sims"].l()) {
      val m = sim.m()
      val name = m["name"]
      val d = Driver()
      for (op in m["ops"].l()) d.apply(op.l())
      val head = m["head"].l()
      for (i in head.indices) Fixtures.same("$name entry $i", head[i], d.log.getOrNull(i))
      val chunks = m["chunks"].l()
      for ((k, want) in chunks.withIndex()) {
        val part = d.log.subList(minOf(k * chunk, d.log.size), minOf((k + 1) * chunk, d.log.size))
        if (sha(part) != want) {
          // Name the first entry that differs from the run's own neighbours: print the chunk.
          throw AssertionError("$name: log entries ${k * chunk}..${(k + 1) * chunk} differ from Node's\n" +
            part.take(12).joinToString("\n") { Fixtures.canonJs(it) })
        }
      }
      assertEquals("$name entries", m["entries"].d().toInt(), d.log.size)
    }
  }
}
