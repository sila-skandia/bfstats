package io.bfstats.sidecar

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Chat.kt against chat.mjs, from parity/chat.mjs. */
class ChatTest {
  private val fx = Parity.load("chat")

  private fun piece(e: JsonElement): ChatPiece {
    val o = e.jsonObject
    return ChatPiece(
      first = Parity.bool(o["first"]) == true, text = Parity.str(o["text"]) ?: "",
      team = Parity.bool(o["team"]), noSender = Parity.bool(o["noSender"]), serverFlag = Parity.bool(o["serverFlag"]),
      playerId = Parity.num(o["playerId"])?.toInt(), total = Parity.num(o["total"])?.toInt(),
    )
  }

  @Test fun fragmentsAndBytes() {
    for (row in fx["fragments"]!!.jsonArray) {
      val r = row.jsonObject
      val o = r["opts"]!!.jsonObject
      val got = chatFragments(
        Parity.str(r["text"]), team = Parity.bool(o["team"]) == true, playerId = Parity.num(o["playerId"])?.toInt() ?: -1,
        noSender = Parity.bool(o["noSender"]) == true, serverFlag = Parity.bool(o["serverFlag"]) == true,
      )
      assertEquals(Parity.js(r["text"]), Parity.js(r["out"]), Js.stringify(got.map { it.toJs() }))
    }
    for (row in fx["bytes"]!!.jsonArray) {
      val (t, h) = row.jsonArray
      assertEquals(Parity.str(h), chatBytes(Parity.str(t)).hex())
    }
    val c = fx["constants"]!!.jsonObject
    assertEquals(Js.stringify(linkedMapOf("CHAT_PIECE" to CHAT_PIECE, "CHAT_MAX" to CHAT_MAX, "CHAT_QUEUE" to CHAT_QUEUE,
      "CHAT_PIECE_MS" to CHAT_PIECE_MS, "CHAT_RECV_MAX" to CHAT_RECV_MAX)), Parity.js(c))
  }

  @Test fun assembler() {
    for ((who, rows) in fx["assemble"]!!.jsonObject) {
      val a = ChatAssembler()
      for ((i, row) in rows.jsonArray.withIndex()) {
        val got = a.push(piece(row.jsonObject["in"]!!))
        assertEquals("$who #$i", Parity.js(row.jsonObject["out"]), Js.stringify(got?.toJs()))
      }
    }
    val a = ChatAssembler()
    val r1 = a.push(ChatPiece(true, "abc", total = 10, playerId = 1))
    a.reset()
    val got = listOf(r1, a.push(ChatPiece(false, "x")), a.push(ChatPiece(true, "z", total = 1, playerId = 4)))
    assertEquals(Parity.js(fx["reset"]), Js.stringify(got.map { it?.toJs() }))
  }

  /** The generator's sender driver: its own timer list on a stepped clock. */
  private class StepTimers : Timers {
    class H(val fn: () -> Unit, val ms: Double, var at: Double) { var dead = false }
    var t = 0.0
    val list = mutableListOf<H>()
    override fun now() = t.toLong()
    override fun setTimeout(ms: Double, fn: () -> Unit): Any = error("not used")
    override fun setInterval(ms: Double, fn: () -> Unit): Any = H(fn, ms, t + ms).also { list += it }
    override fun clear(handle: Any?) { (handle as? H)?.dead = true }
  }

  @Test fun sender() {
    for ((n, row) in fx["sender"]!!.jsonArray.withIndex()) {
      val r = row.jsonObject
      val step = Parity.num(r["step"])!!; val until = Parity.num(r["until"])!!
      val own = Parity.bool(r["ownTimer"]) == true
      val timers = StepTimers()
      val queued = mutableListOf<Any?>()
      val s = ChatSender({ name, body -> queued += linkedMapOf("t" to timers.t, "name" to name, "body" to body.toJs()) }, timers,
        Parity.num(r["pieceMs"]) ?: CHAT_PIECE_MS.toDouble())
      val lines = r["lines"]!!.jsonArray.map { it.jsonArray }
      val said = mutableListOf<Any?>()
      while (timers.t <= until) {
        for (l in lines) if (Parity.num(l[2]) == timers.t) said += linkedMapOf("t" to timers.t, "ok" to s.say(Parity.str(l[0]), Parity.bool(l[1]) == true))
        if (own) {
          // for...of over the live array: a timer made during the loop is visited too.
          var i = 0
          while (i < timers.list.size) { val h = timers.list[i++]; if (!h.dead) while (h.at <= timers.t) { h.at += h.ms; h.fn() } }
        } else s.pump()
        timers.t += step
      }
      val got = linkedMapOf(
        "lines" to r["lines"], "step" to r["step"], "until" to r["until"], "ownTimer" to own, "pieceMs" to r["pieceMs"],
        "said" to said, "queued" to queued, "timers" to timers.list.map { linkedMapOf("ms" to it.ms, "dead" to it.dead) },
      )
      assertEquals("sender #$n", Parity.js(r), Js.stringify(got))
    }
  }
}
