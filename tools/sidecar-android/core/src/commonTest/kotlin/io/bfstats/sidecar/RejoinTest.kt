package io.bfstats.sidecar

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Rejoin.kt against rejoin.mjs, from parity/rejoin.mjs. */
class RejoinTest {
  private val fx = Fixtures.load("rejoin")
  private fun reason(e: JsonElement?): Long? = Fixtures.num(e)?.toLong()
  private fun notice(e: JsonElement?): KickNotice? = (e as? JsonObject)?.let { KickNotice(Fixtures.bool(it["banned"]) == true, Fixtures.str(it["text"]) ?: "") }

  @Test fun classification() {
    for (row in fx["classify"]!!.jsonArray) {
      val r = row.jsonObject
      val got = classifyDisconnect(reason(r["reason"]), if (Fixtures.bool(r["levelChange"]) == true) "4711" else null, notice(r["kickNotice"]))
      assertEquals(Fixtures.js(r), Fixtures.str(r["out"]), got)
    }
    for (row in fx["classifyTruthy"]!!.jsonArray) {
      val r = row.jsonObject
      val lc = r["levelChange"]!!
      val v: Any? = when {
        Fixtures.str(lc) == "NaN" -> Double.NaN
        lc is JsonObject -> linkedMapOf<String, Any?>()
        else -> Fixtures.str(lc) ?: Fixtures.num(lc) ?: Fixtures.bool(lc)
      }
      assertEquals(Fixtures.js(r), Fixtures.str(r["out"]), classifyDisconnect(0x0a, v))
    }
    for (row in fx["rejoinable"]!!.jsonArray) {
      val (k, v) = row.jsonArray
      assertEquals(Fixtures.bool(v), rejoinable(k.jsonPrimitive.content))
    }
    for (row in fx["final"]!!.jsonArray) {
      val (r, v) = row.jsonArray
      assertEquals(Fixtures.bool(v), denialIsFinal(reason(r)))
    }
    assertEquals(Fixtures.js(fx["constants"]), Js.stringify(DISCONNECT.toJs()))
  }

  @Test fun kickNotices() {
    for (row in fx["notice"]!!.jsonArray) {
      val r = row.jsonObject
      val names = r["names"]!!.jsonArray.map { Fixtures.str(it) }
      val got = kickNoticeFor(Fixtures.str(r["text"]), names)
      assertEquals(Fixtures.js(r["text"]), Fixtures.js(r["out"]), Js.stringify(got?.toJs()))
    }
    assertEquals(Fixtures.js(fx["noticeNotString"]), Js.stringify(kickNoticeFor(null, listOf("x"))?.toJs()))
  }

  @Test fun boxesAndDenials() {
    for (row in fx["describe"]!!.jsonArray) {
      val a = row.jsonObject["in"]!!.jsonObject
      val got = describeDisconnect(
        Fixtures.str(a["kind"])!!, reason(a["reason"]), Fixtures.str(a["name"]) ?: "", Fixtures.str(a["message"]) ?: "", notice(a["notice"]),
      )
      assertEquals(Fixtures.js(a), Fixtures.js(row.jsonObject["out"]), Js.stringify(got))
    }
    for (row in fx["box"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(retailDisconnectBox(reason(r["reason"]), Fixtures.str(r["message"]))))
    }
    for (row in fx["denial"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(retailDenial(reason(r["reason"]), Fixtures.bool(r["retry"]) == true)))
    }
    assertEquals(Fixtures.js(fx["denialText"]), Js.stringify(DENIAL_TEXT))
    assertEquals(Fixtures.js(fx["titles"]), Js.stringify(DISCONNECT_TITLE))
  }

  @Test fun gameStatusFive() {
    for (row in fx["fromEvent"]!!.jsonArray) {
      val e = row.jsonObject["in"]!!.jsonObject
      val got = reconnectFromGameStatus(Fixtures.num(e["status"])?.toInt(), Fixtures.str(e["extra"])?.let { latin1(it) }, Fixtures.str(e["text"]))
      assertEquals(Fixtures.js(e), Fixtures.js(row.jsonObject["out"]), Js.stringify(got?.toJs()))
    }
  }

  private class FakeSession(val key: String, val team: Int, val closeThrows: Boolean) : Emitter(), RejoinTarget {
    var closed = false
    override fun close() { closed = true; if (closeThrows) throw IllegalStateException("closed twice") }
  }

  private fun scenario(name: String, sc: JsonObject, want: JsonObject) {
    val start = sc["start"]!!.jsonObject
    val script = sc["script"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
    val up = Fixtures.num(sc["probeUpAfterMs"]) ?: if (sc["probeUpAfterMs"] is JsonNull) Double.POSITIVE_INFINITY else 0.0
    val options = sc["options"] as? JsonObject ?: JsonObject(emptyMap())
    val throwOn = sc["throwOn"]?.jsonArray?.map { it.jsonPrimitive.content.toInt() } ?: emptyList()
    val probeThrows = Fixtures.bool(sc["probeThrows"]) == true
    val probeDelayMs = Fixtures.num(sc["probeDelayMs"]) ?: 0.0
    val stopAtMs = sc["stopAtMs"]?.jsonArray?.map { Fixtures.num(it)!! } ?: emptyList()
    val closeThrows = Fixtures.bool(sc["closeThrows"]) == true
    val clock = ManualScheduler(0.0, 0.0)
    val log = mutableListOf<String>()
    val sessions = mutableListOf<FakeSession>()
    var attempt = 0
    val r = Rejoiner(
      timers = clock,
      horizonMs = Fixtures.num(sc["horizonMs"])?.toLong() ?: 600000,
      probe = { done ->
        val answer = { if (probeThrows) throw IllegalStateException("probe failed"); done(clock.now() >= up) }
        if (probeDelayMs > 0) clock.schedule(probeDelayMs) { try { answer() } catch (_: IllegalStateException) { done(null) } } else answer()
      },
      connect = { key, team ->
        if (attempt in throwOn) { attempt++; throw IllegalStateException("no socket") }
        val s = FakeSession(key, team, closeThrows)
        sessions += s
        val what = script.getOrNull(attempt++) ?: "join"
        clock.schedule(50.0) {
          when (what) {
            "join" -> { s.emit("connected", mapOf("id" to 1)); clock.schedule(500.0) { s.emit("joined", mapOf("playerId" to 3)) } }
            "full" -> s.emit("denied", mapOf("reason" to 2, "name" to "PRServerIsFull"))
            "badpw" -> s.emit("denied", mapOf("reason" to 0x11, "name" to "PRInvalidPassword"))
            "version" -> s.emit("denied", mapOf("reason" to 0x18, "name" to "VersionTooNew"))
            "banned-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x16, "name" to "Banned")) }
            "closed-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x0d, "name" to "PRDisconnect")) }
            "timeout-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x0a, "name" to "PRTimeOut")) }
            "stall" -> s.emit("connected", mapOf("id" to 1))
            "full-noname" -> s.emit("denied", mapOf("reason" to 2))
            "denied-empty" -> s.emit("denied", mapOf<String, Any?>())
            "denied-null" -> s.emit("denied", mapOf("name" to null, "reason" to null))
            "denied-none" -> s.emit("denied")
            "drop-noname" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x0a)) }
            "drop-empty" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected") }
            "drop-null" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to null)) }
            "late" -> clock.schedule(10500.0) {
              s.emit("connected", mapOf("id" to 1)); s.emit("denied", mapOf("reason" to 0x11, "name" to "PRInvalidPassword"))
              s.emit("disconnected", mapOf("reason" to 0x16, "name" to "Banned")); s.emit("joined", mapOf("playerId" to 9))
            }
          }
        }
        s
      },
    )
    Fixtures.num(options["joinTimeoutMs"])?.let { r.joinTimeoutMs = it.toLong() }
    Fixtures.num(options["connectTimeoutMs"])?.let { r.connectTimeoutMs = it.toLong() }
    Fixtures.num(options["probeMaxMs"])?.let { r.probeMaxMs = it.toLong() }
    Fixtures.num(options["backoff"])?.let { r.backoff = it }
    for (ev in listOf("probe", "attempt", "retry", "rejoined", "give-up")) {
      r.on(ev) { a ->
        val row = linkedMapOf<String, Any?>("ev" to ev, "t" to clock.now())
        for ((k, v) in a[0] as Map<*, *>) if (k != "info") row[k as String] = v
        log += Js.stringify(row)
      }
    }
    val timing = (start["timing"] as? JsonObject)?.let { RestartTiming(Fixtures.num(it["firstProbeMs"])!!.toLong(), Fixtures.num(it["probeMs"])!!.toLong()) }
    val args: () -> Boolean = {
      r.start(
        kind = Fixtures.str(start["kind"]) ?: "drop", reason = reason(start["reason"]),
        password = if (start.containsKey("password")) Fixtures.str(start["password"]) else "",
        team = if (start.containsKey("team")) Fixtures.num(start["team"])?.toInt() else 0,
        timing = timing,
      )
    }
    for (at in stopAtMs) clock.schedule(at) { r.stop(); log += Js.stringify(linkedMapOf("ev" to "stopped", "t" to clock.now(), "state" to r.state)) }
    val started = args()
    val again = args()
    clock.advance((Fixtures.num(sc["runMs"]) ?: 700000.0) - clock.now)
    val out = linkedMapOf(
      "started" to started, "again" to again, "state" to r.state,
      "log" to log.map { kotlinx.serialization.json.Json.parseToJsonElement(it) },
      "sessions" to sessions.map { linkedMapOf("key" to it.key, "team" to it.team, "closed" to it.closed) },
    )
    assertEquals(name, Fixtures.js(want), Js.stringify(out))
  }

  @Test fun stateMachine() {
    for ((name, row) in fx["machine"]!!.jsonObject) scenario(name, row.jsonObject["in"]!!.jsonObject, row.jsonObject["out"]!!.jsonObject)
  }
}
