package io.bfstats.sidecar

import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test

/** Events.kt against parity/events.mjs. */
class EventsTest {
  private val f = Fixtures.loadJs("events")

  private fun attempt(fn: () -> Any?): LinkedHashMap<String, Any?> =
    try { linkedMapOf("ok" to Fixtures.canon(fn())) } catch (e: Exception) { linkedMapOf("error" to e.message) }

  private fun readAll(bytes: ByteArray, bits: Int): LinkedHashMap<String, Any?> {
    val r = BitReader(bytes, bits)
    return attempt { readEvent(r) }.also { it["pos"] = r.pos }
  }

  @Test fun theTableIsNodes() {
    assertEquals(f["eventTypeBits"].d().toInt(), EVENT_TYPE_BITS)
    Fixtures.same("names", f["names"], EVENTS.values.map { listOf(it.name, it.id, it.addr) })
  }

  @Test fun everyReaderReadsAsNode() {
    for ((i, c) in f["decode"].l().withIndex()) {
      val m = c.m()
      val got = readAll(fromHex(m["hex"] as String), m["bits"].d().toInt())
      Fixtures.same("decode $i ${m["hex"]}", LinkedHashMap(m).also { it.remove("hex"); it.remove("bits") }, got)
    }
  }

  @Test fun liveWindowsReadAsNode() {
    for (w in f["windows"].l()) {
      val m = w.m()
      val r = BitReader(fromHex(m["hex"] as String))
      r.pos = m["start"].d().toInt()
      val events = ArrayList<Any?>()
      var error: String? = null
      while (r.remaining >= EVENT_TYPE_BITS) {
        try { events.add(readEvent(r)) } catch (e: Exception) { error = e.message; break }
      }
      Fixtures.same("window ${m["start"]}", m, linkedMapOf("hex" to m["hex"], "start" to m["start"], "events" to events, "error" to error, "pos" to r.pos))
    }
  }

  @Suppress("UNCHECKED_CAST")
  @Test fun everyWriterWritesAsNode() {
    for ((i, c) in f["encode"].l().withIndex()) {
      val m = c.m()
      val w = BitWriter(1472)
      val res = attempt { writeEvent(w, m["name"] as String, m["body"] as Map<String, Any?>) }
      val got = linkedMapOf<String, Any?>("name" to m["name"], "body" to m["body"], "hex" to w.bytes().hex(), "bits" to w.pos)
      if (res.containsKey("error")) got["error"] = res["error"] else got["back"] = readAll(w.bytes(), w.pos)
      Fixtures.same("encode $i ${m["name"]} ${Js.stringify(m["body"])}", m, got)
    }
  }

  @Suppress("UNCHECKED_CAST")
  @Test fun blocksAsNode() {
    for ((i, c) in f["blocks"].l().withIndex()) {
      val m = c.m()
      val got = LinkedHashMap<String, Any?>()
      val r: BitReader
      if (m.containsKey("read")) {
        got["read"] = m["read"]
        r = BitReader(fromHex(m["read"] as String))
      } else {
        val events = m["events"].l().map { val p = it.l(); p[0] as String to p[1] as Map<String, Any?> }
        val w = BitWriter(1472)
        val res = attempt { writeEventBlock(w, JsOps.toInt32(m["index"]), JsOps.truthy(m["resend"]), events) }
        got["index"] = m["index"]; got["resend"] = m["resend"]; got["events"] = m["events"]
        got["hex"] = w.bytes().hex(); got["bits"] = w.pos
        if (res.containsKey("error")) got["error"] = res["error"]
        r = BitReader(w.bytes(), w.pos)
      }
      got["back"] = attempt { readEventBlock(r) }
      got["pos"] = r.pos
      Fixtures.same("block $i", m, got)
    }
  }

  @Test fun actionBlocksAsNode() {
    for ((i, c) in f["actions"].l().withIndex()) {
      val m = c.m()
      val list = m["actions"].l().map { a ->
        Action(a.m()["axes"].l().map { it.d() }.toDoubleArray(), a.m()["buttons"].d().toLong())
      }
      val w = BitWriter(256)
      writeActionBlock(w, JsOps.toInt32(m["first"]), list)
      assertEquals("actions $i", m["hex"], w.bytes().hex())
      assertEquals("actions $i bits", m["bits"].d().toInt(), w.pos)
    }
  }

  @Test fun errorsAsNode() {
    for (c in f["errors"].l()) {
      val m = c.m()
      val name = m["name"] as String
      val w = BitWriter(4096)
      val res = when (name) {
        "block255" -> attempt { writeEventBlock(w, 0, false, List(0xff) { "Suicide" to emptyMap() }) }
        "block254" -> attempt { writeEventBlock(w, 0, false, List(0xfe) { "Suicide" to emptyMap() }) }
        "GameStatus" -> attempt { writeEvent(w, name, mapOf("status" to 5.0)) }
        else -> attempt { writeEvent(w, name, emptyMap()) }
      }
      assertEquals(name, m["error"], res["error"])
      assertEquals(name, m["hex"], w.bytes().hex())
      assertEquals(name, m["bits"].d().toInt(), w.pos)
    }
  }
}
