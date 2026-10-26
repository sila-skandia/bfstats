package io.bfstats.sidecar

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/** Rejoin.kt against rejoin.mjs, from parity/rejoin.mjs. */
class RejoinTest {
  private val fx = Parity.load("rejoin")
  private fun reason(e: JsonElement?): Long? = Parity.num(e)?.toLong()
  private fun notice(e: JsonElement?): KickNotice? = (e as? JsonObject)?.let { KickNotice(Parity.bool(it["banned"]) == true, Parity.str(it["text"]) ?: "") }

  @Test fun classification() {
    for (row in fx["classify"]!!.jsonArray) {
      val r = row.jsonObject
      val got = classifyDisconnect(reason(r["reason"]), if (Parity.bool(r["levelChange"]) == true) "4711" else null, notice(r["kickNotice"]))
      assertEquals(Parity.js(r), Parity.str(r["out"]), got)
    }
    for (row in fx["rejoinable"]!!.jsonArray) {
      val (k, v) = row.jsonArray
      assertEquals(Parity.bool(v), rejoinable(k.jsonPrimitive.content))
    }
    for (row in fx["final"]!!.jsonArray) {
      val (r, v) = row.jsonArray
      assertEquals(Parity.bool(v), denialIsFinal(reason(r)))
    }
    assertEquals(Parity.js(fx["constants"]), Js.stringify(DISCONNECT.toJs()))
  }

  @Test fun kickNotices() {
    for (row in fx["notice"]!!.jsonArray) {
      val r = row.jsonObject
      val names = r["names"]!!.jsonArray.map { Parity.str(it) }
      val got = kickNoticeFor(Parity.str(r["text"]), names)
      assertEquals(Parity.js(r["text"]), Parity.js(r["out"]), Js.stringify(got?.toJs()))
    }
    assertEquals(Parity.js(fx["noticeNotString"]), Js.stringify(kickNoticeFor(null, listOf("x"))?.toJs()))
  }

  @Test fun boxesAndDenials() {
    for (row in fx["describe"]!!.jsonArray) {
      val a = row.jsonObject["in"]!!.jsonObject
      val got = describeDisconnect(
        Parity.str(a["kind"])!!, reason(a["reason"]), Parity.str(a["name"]) ?: "", Parity.str(a["message"]) ?: "", notice(a["notice"]),
      )
      assertEquals(Parity.js(a), Parity.js(row.jsonObject["out"]), Js.stringify(got))
    }
    for (row in fx["box"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.js(r), Parity.js(r["out"]), Js.stringify(retailDisconnectBox(reason(r["reason"]), Parity.str(r["message"]))))
    }
    for (row in fx["denial"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.js(r), Parity.js(r["out"]), Js.stringify(retailDenial(reason(r["reason"]), Parity.bool(r["retry"]) == true)))
    }
    assertEquals(Parity.js(fx["denialText"]), Js.stringify(DENIAL_TEXT))
    assertEquals(Parity.js(fx["titles"]), Js.stringify(DISCONNECT_TITLE))
  }

  @Test fun gameStatusFive() {
    for (row in fx["fromEvent"]!!.jsonArray) {
      val e = row.jsonObject["in"]!!.jsonObject
      val got = reconnectFromGameStatus(Parity.num(e["status"])?.toInt(), Parity.str(e["extra"])?.let { latin1(it) }, Parity.str(e["text"]))
      assertEquals(Parity.js(e), Parity.js(row.jsonObject["out"]), Js.stringify(got?.toJs()))
    }
  }

  private class FakeSession(val key: String, val team: Int) : Emitter(), RejoinTarget {
    var closed = false
    override fun close() { closed = true }
  }

  private fun scenario(name: String, sc: JsonObject, want: JsonObject) {
    val start = sc["start"]!!.jsonObject
    val script = sc["script"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
    val up = Parity.num(sc["probeUpAfterMs"]) ?: if (sc["probeUpAfterMs"] is JsonNull) Double.POSITIVE_INFINITY else 0.0
    val options = sc["options"] as? JsonObject ?: JsonObject(emptyMap())
    val throwOn = sc["throwOn"]?.jsonArray?.map { it.jsonPrimitive.content.toInt() } ?: emptyList()
    val clock = FakeTimers(0.0)
    val log = mutableListOf<String>()
    val sessions = mutableListOf<FakeSession>()
    var attempt = 0
    val r = Rejoiner(
      timers = clock,
      horizonMs = Parity.num(sc["horizonMs"])?.toLong() ?: 600000,
      probe = { done -> done(clock.now() >= up) },
      connect = { key, team ->
        if (attempt in throwOn) { attempt++; throw IllegalStateException("no socket") }
        val s = FakeSession(key, team)
        sessions += s
        val what = script.getOrNull(attempt++) ?: "join"
        clock.setTimeout(50.0) {
          when (what) {
            "join" -> { s.emit("connected", mapOf("id" to 1)); clock.setTimeout(500.0) { s.emit("joined", mapOf("playerId" to 3)) } }
            "full" -> s.emit("denied", mapOf("reason" to 2, "name" to "PRServerIsFull"))
            "badpw" -> s.emit("denied", mapOf("reason" to 0x11, "name" to "PRInvalidPassword"))
            "version" -> s.emit("denied", mapOf("reason" to 0x18, "name" to "VersionTooNew"))
            "banned-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x16, "name" to "Banned")) }
            "closed-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x0d, "name" to "PRDisconnect")) }
            "timeout-drop" -> { s.emit("connected", mapOf("id" to 1)); s.emit("disconnected", mapOf("reason" to 0x0a, "name" to "PRTimeOut")) }
            "stall" -> s.emit("connected", mapOf("id" to 1))
          }
        }
        s
      },
    )
    Parity.num(options["joinTimeoutMs"])?.let { r.joinTimeoutMs = it.toLong() }
    Parity.num(options["connectTimeoutMs"])?.let { r.connectTimeoutMs = it.toLong() }
    Parity.num(options["probeMaxMs"])?.let { r.probeMaxMs = it.toLong() }
    Parity.num(options["backoff"])?.let { r.backoff = it }
    for (ev in listOf("probe", "attempt", "retry", "rejoined", "give-up")) {
      r.on(ev) { a ->
        val row = linkedMapOf<String, Any?>("ev" to ev, "t" to clock.now())
        for ((k, v) in a[0] as Map<*, *>) if (k != "info") row[k as String] = v
        log += Js.stringify(row)
      }
    }
    val timing = (start["timing"] as? JsonObject)?.let { RestartTiming(Parity.num(it["firstProbeMs"])!!.toLong(), Parity.num(it["probeMs"])!!.toLong()) }
    val args: () -> Boolean = {
      r.start(
        kind = Parity.str(start["kind"]) ?: "drop", reason = reason(start["reason"]),
        password = if (start.containsKey("password")) Parity.str(start["password"]) else "",
        team = if (start.containsKey("team")) Parity.num(start["team"])?.toInt() else 0,
        timing = timing,
      )
    }
    val started = args()
    val again = args()
    clock.advance((Parity.num(sc["runMs"]) ?: 700000.0) - clock.t)
    val out = linkedMapOf(
      "started" to started, "again" to again, "state" to r.state,
      "log" to log.map { kotlinx.serialization.json.Json.parseToJsonElement(it) },
      "sessions" to sessions.map { linkedMapOf("key" to it.key, "team" to it.team, "closed" to it.closed) },
    )
    assertEquals(name, Parity.js(want), Js.stringify(out))
  }

  @Test fun stateMachine() {
    for ((name, row) in fx["machine"]!!.jsonObject) scenario(name, row.jsonObject["in"]!!.jsonObject, row.jsonObject["out"]!!.jsonObject)
  }
}
