package io.bfstats.sidecar

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.StringWriter

/** PageTeam, validPlayerName and ReviewLog against parity/{page-team,player-name,review}.mjs. */
class SmallModulesTest {
  @Test fun pageTeamAnswersAsNode() {
    for ((n, c) in Fixtures.loadJs("page-team")["cases"].l().withIndex()) {
      val sent = ArrayList<Int>(); val logs = ArrayList<String>()
      val pt = createPageTeam({ sent.add(it) }, { logs.add(it) })
      val outs = c.m()["out"].l()
      for ((i, op) in c.m()["ops"].l().withIndex()) {
        val o = op.m()
        val st = o["state"].m()
        val state = TeamState(st["joined"] == true, st.o("team"), st["everSpawned"] == true)
        val s0 = sent.size; val l0 = logs.size
        val ret = if (o["op"] == "offer") pt.offer(o.o("team"), state) else pt.joined(state)
        val got = linkedMapOf("ret" to ret, "sent" to sent.subList(s0, sent.size).toList(), "logs" to logs.subList(l0, logs.size).toList(), "held" to pt.held)
        Fixtures.same("case $n op $i", outs[i], got)
      }
    }
  }

  @Test fun playerNamesAsNode() {
    val f = Fixtures.loadJs("player-name")
    assertEquals(f["serverNameBytes"].d().toInt(), SERVER_NAME_BYTES)
    for (row in f["strings"].l()) {
      val units = row.l()[0].l().map { it.d().toInt().toChar() }.toCharArray()
      val s = String(units)
      Fixtures.same("name ${row.l()[0]}", row.l()[1], validPlayerName(s))
    }
    for (row in f["nonStrings"].l()) Fixtures.same("non-string ${row.l()[0]}", row.l()[1], validPlayerName(row.l()[0]))
  }

  @Test fun reviewLogWritesAsNode() {
    val f = Fixtures.loadJs("review")
    val sched = ManualScheduler(0.0)
    val w = StringWriter()
    val log = ReviewLog("unused", sched.clock, w)
    val summaries = ArrayList<Any?>()
    val ops = f["ops"].l()
    for ((i, op) in ops.withIndex()) {
      val o = op.m()
      sched.advanceTo(o["t"].d())
      val a = o["args"].m()
      when (o["op"]) {
        "unknownEvent" -> log.unknownEvent(a.o("id"), a.o("seq"), a.o("block"), a.o("bitOffset"), a.o("hex"))
        "ghostRecord" -> log.ghostRecord(a.o("seq"), a.o("tick"), a.o("netId"), a.o("action"), a.o("bodyBits"), a.o("hex"), a.o("ref"))
        "ghostBlockRaw" -> log.ghostBlockRaw(a.o("seq"), a.o("reason"), a.o("hex"))
        "unknownDatagram" -> log.unknownDatagram(a.o("type"), a.o("hex"))
        "decodeError" -> log.decodeError(a.o("where"), a.o("seq"), a.o("message"), a.o("hex"))
        else -> error("op ${o["op"]}")
      }
      if (i % 40 == 0) summaries.add(log.summary())
    }
    summaries.add(log.summary())
    log.close()
    assertEquals(f["started"].d(), log.started, 0.0)
    val lines = w.toString().split("\n").filter { it.isNotEmpty() }
    val want = f["lines"].l()
    assertEquals(want.size, lines.size)
    for (i in want.indices) assertEquals("line $i", want[i], lines[i])
    for ((i, s) in summaries.withIndex()) {
      val m = (s as LinkedHashMap<String, Any?>).also { it["path"] = null }
      Fixtures.same("summary $i", f["summaries"].l()[i], m)
    }
  }
}
