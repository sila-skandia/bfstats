package io.bfstats.sidecar

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import kotlin.concurrent.thread

/** ServerQuery.kt against server-query.mjs, from parity/server-query.mjs. */
class ServerQueryTest {
  companion object {
    private val fx = Fixtures.load("server-query")
    private val sockets = mutableListOf<DatagramSocket>()
    private val ports = linkedMapOf<String, Int>()

    /** The generator's GameSpy stand-ins: A, B and C answer `\status\`; D is a closed port. */
    @BeforeClass @JvmStatic fun standIns() {
      for ((k, chunks) in fx["answers"]!!.jsonObject) {
        val s = DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        sockets += s
        ports[k] = s.localPort
        val replies = chunks.jsonArray.map { latin1(it.jsonPrimitive.content) }
        thread(isDaemon = true) {
          val buf = ByteArray(2048)
          while (!s.isClosed) {
            val p = DatagramPacket(buf, buf.size)
            try { s.receive(p) } catch (_: Exception) { break }
            if (String(buf, 0, p.length, Charsets.ISO_8859_1) == "\\status\\") for (r in replies) s.send(DatagramPacket(r, r.size, p.socketAddress))
          }
        }
      }
      DatagramSocket(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0)).use { ports["D"] = it.localPort }
    }

    @AfterClass @JvmStatic fun close() { sockets.forEach { it.close() } }
  }

  private fun sub(s: String) = Regex("\"\\$([A-D])\"").replace(s) { ports.getValue(it.groupValues[1]).toString() }
  private fun unsub(v: Any?): Any? = when (v) {
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in v) m[k as String] = unsub(x) }
    is Number -> ports.entries.firstOrNull { it.value.toDouble() == v.toDouble() }?.let { "$${it.key}" } ?: v
    else -> v
  }

  @Test fun parsers() {
    for (row in fx["parse"]!!.jsonArray) {
      val (t, want) = row.jsonArray
      assertEquals(Fixtures.js(t), Fixtures.js(want), Js.stringify(parseGamespy(t.jsonPrimitive.content)))
    }
    for (row in fx["fromGamespy"]!!.jsonArray) {
      val (kv, want) = row.jsonArray
      assertEquals(Fixtures.js(want), Js.stringify(levelFromGamespy(kv.jsonObject.mapValues { it.value.jsonPrimitive.content })))
    }
    for (row in fx["fromRow"]!!.jsonArray) {
      val (r, want) = row.jsonArray
      @Suppress("UNCHECKED_CAST")
      assertEquals(Fixtures.js(r), Fixtures.js(want), Js.stringify(levelFromLiveRow(jsonToJs(r) as Map<String, Any?>?)))
    }
  }

  @Test fun gamespyStatusOverUdp() {
    for ((k, want) in fx["status"]!!.jsonObject) {
      assertEquals(k, Fixtures.js(want), Js.stringify(gamespyStatus("127.0.0.1", ports.getValue(k), timeoutMs = 400)))
    }
  }

  @Test fun queryServerLevelAgainstStandIns() {
    for (row in fx["query"]!!.jsonArray) {
      val c = row.jsonObject
      val port = when (val p = c["port"]) {
        is JsonArray -> ports.getValue(p[0].jsonPrimitive.content) + p[1].jsonPrimitive.content.toInt()
        else -> Fixtures.num(p)!!.toInt()
      }
      val body = c["body"]
      val fetch: (String, Int) -> String? = { _, _ ->
        when {
          body == null || body is JsonNull -> null
          Fixtures.str(body) == "throw" -> throw java.io.IOException("offline")
          else -> sub(Fixtures.str(body)!!)
        }
      }
      val qp = Fixtures.str(c["queryPort"])?.let { ports.getValue(it.substring(1)) }
      val got = queryServerLevel("127.0.0.1", port, queryPort = qp, timeoutMs = 300, fetch = fetch, url = Fixtures.str(c["url"]) ?: DEFAULT_LIVE_LIST)
      assertEquals(Fixtures.str(c["name"]), Fixtures.js(c["out"]), Js.stringify(unsub(got)))
    }
  }
}
