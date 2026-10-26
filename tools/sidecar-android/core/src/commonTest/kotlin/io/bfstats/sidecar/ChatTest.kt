package io.bfstats.sidecar

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Chat.kt against chat.mjs, from parity/chat.mjs. */
class ChatTest {
  private val fx = Fixtures.load("chat")

  private fun piece(e: JsonElement): ChatPiece {
    val o = e.jsonObject
    return ChatPiece(
      first = Fixtures.bool(o["first"]) == true, text = Fixtures.str(o["text"]) ?: "",
      team = Fixtures.bool(o["team"]), noSender = Fixtures.bool(o["noSender"]), serverFlag = Fixtures.bool(o["serverFlag"]),
      playerId = Fixtures.num(o["playerId"])?.toInt(), total = Fixtures.num(o["total"])?.toInt(),
    )
  }

  @Test fun fragmentsAndBytes() {
    for (row in fx["fragments"]!!.jsonArray) {
      val r = row.jsonObject
      val o = r["opts"]!!.jsonObject
      val got = chatFragments(
        Fixtures.str(r["text"]), team = Fixtures.bool(o["team"]) == true, playerId = Fixtures.num(o["playerId"])?.toInt() ?: -1,
        noSender = Fixtures.bool(o["noSender"]) == true, serverFlag = Fixtures.bool(o["serverFlag"]) == true,
      )
      assertEquals(Fixtures.js(r["text"]), Fixtures.js(r["out"]), Js.stringify(got.map { it.toJs() }))
    }
    for (row in fx["bytes"]!!.jsonArray) {
      val (t, h) = row.jsonArray
      assertEquals(Fixtures.str(h), chatBytes(Fixtures.str(t)).hex())
    }
    val c = fx["constants"]!!.jsonObject
    assertEquals(Js.stringify(linkedMapOf("CHAT_PIECE" to CHAT_PIECE, "CHAT_MAX" to CHAT_MAX, "CHAT_QUEUE" to CHAT_QUEUE,
      "CHAT_PIECE_MS" to CHAT_PIECE_MS, "CHAT_RECV_MAX" to CHAT_RECV_MAX)), Fixtures.js(c))
  }

  @Test fun assembler() {
    for ((who, rows) in fx["assemble"]!!.jsonObject) {
      val a = ChatAssembler()
      for ((i, row) in rows.jsonArray.withIndex()) {
        val got = a.push(piece(row.jsonObject["in"]!!))
        assertEquals("$who #$i", Fixtures.js(row.jsonObject["out"]), Js.stringify(got?.toJs()))
      }
    }
    val a = ChatAssembler()
    val r1 = a.push(ChatPiece(true, "abc", total = 10, playerId = 1))
    a.reset()
    val got = listOf(r1, a.push(ChatPiece(false, "x")), a.push(ChatPiece(true, "z", total = 1, playerId = 4)))
    assertEquals(Fixtures.js(fx["reset"]), Js.stringify(got.map { it?.toJs() }))
  }

  /** The generator's sender driver: its own timer list on a stepped clock. */
  private class StepTimers : Scheduler {
    class H(val fn: () -> Unit, val ms: Double, var at: Double) { var dead = false }
    var t = 0.0
    val list = mutableListOf<H>()
    override val clock = object : Clock { override fun wallMs() = t; override fun monoMs() = t }
    override fun schedule(delayMs: Double, task: () -> Unit): Cancellable = error("not used")
    override fun every(periodMs: Double, task: () -> Unit): Cancellable = H(task, periodMs, t + periodMs).also { list += it }.let { h -> Cancellable { h.dead = true } }
  }

  @Test fun sender() {
    for ((n, row) in fx["sender"]!!.jsonArray.withIndex()) {
      val r = row.jsonObject
      val step = Fixtures.num(r["step"])!!; val until = Fixtures.num(r["until"])!!
      val own = Fixtures.bool(r["ownTimer"]) == true
      val timers = StepTimers()
      val queued = mutableListOf<Any?>()
      val s = ChatSender({ name, body -> queued += linkedMapOf("t" to timers.t, "name" to name, "body" to body.toJs()) }, timers,
        Fixtures.num(r["pieceMs"]) ?: CHAT_PIECE_MS.toDouble())
      val lines = r["lines"]!!.jsonArray.map { it.jsonArray }
      val said = mutableListOf<Any?>()
      while (timers.t <= until) {
        for (l in lines) if (Fixtures.num(l[2]) == timers.t) said += linkedMapOf("t" to timers.t, "ok" to s.say(Fixtures.str(l[0]), Fixtures.bool(l[1]) == true))
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
      assertEquals("sender #$n", Fixtures.js(r), Js.stringify(got))
    }
  }
}
