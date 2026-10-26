package io.bfstats.sidecar

// JSON.parse into the values the ports handle as JS objects: LinkedHashMap
// (keys in source order), ArrayList, Double, String, Boolean, null. What
// Js.stringify writes back is what V8 would. One difference: V8 orders an
// object's integer-like keys ("0", "17") first, which no sidecar row uses.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

object JsParse {
  fun parse(text: String): Any? = of(Json.parseToJsonElement(text))

  @Suppress("UNCHECKED_CAST")
  fun obj(text: String): LinkedHashMap<String, Any?> = parse(text) as LinkedHashMap<String, Any?>

  fun of(e: JsonElement): Any? = when (e) {
    is JsonNull -> null
    is JsonPrimitive -> when {
      e.isString -> e.content
      e.content == "true" -> true
      e.content == "false" -> false
      else -> e.content.toDouble()
    }
    is JsonObject -> LinkedHashMap<String, Any?>(e.size * 2).also { m -> for ((k, v) in e) m[k] = of(v) }
    is JsonArray -> ArrayList<Any?>(e.size).also { l -> for (v in e) l.add(of(v)) }
  }
}

/** `o[k]` on a parsed row: Undefined when the key is absent. */
fun Map<String, Any?>.js(k: String): Any? = if (containsKey(k)) get(k) else Undefined
