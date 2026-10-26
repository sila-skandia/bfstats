package io.bfstats.sidecar

import org.junit.Assert.assertEquals

/** The parity fixtures (parity/<module>.mjs) and the Kotlin values written as Node writes them. */
object NodeFixtures {
  @Suppress("UNCHECKED_CAST")
  fun load(name: String): Map<String, Any?> {
    val text = NodeFixtures::class.java.getResource("/parity/$name.json")!!.readText()
    return JsParse.parse(text) as Map<String, Any?>
  }

  /** A Kotlin value in the fixtures' JSON form: ByteArray as {$hex}, Action as its JS object. */
  fun canon(v: Any?): Any? = when (v) {
    is ByteArray -> linkedMapOf("\$hex" to v.hex())
    is Action -> v.toJs()
    is AckPath -> v.toJs()
    is EventBlock -> linkedMapOf("count" to v.count, "index" to v.index, "resend" to v.resend, "events" to canon(v.events))
    is Throwable -> linkedMapOf("error" to v.message)
    is Map<*, *> -> LinkedHashMap<String, Any?>().also { m -> for ((k, x) in v) m[k.toString()] = canon(x) }
    is List<*> -> v.map { canon(it) }
    else -> v
  }

  fun js(v: Any?): String = Js.stringify(canon(v))

  /** Equal as JSON text, with a message naming where. */
  fun same(where: String, want: Any?, got: Any?) = assertEquals(where, Js.stringify(want), js(got))

  @Suppress("UNCHECKED_CAST")
  fun Any?.m(): Map<String, Any?> = this as Map<String, Any?>
  fun Any?.l(): List<Any?> = this as List<Any?>
  fun Any?.d(): Double = (this as Number).toDouble()
  fun Map<String, Any?>.o(k: String): Any? = if (containsKey(k)) get(k) else Undefined
}
