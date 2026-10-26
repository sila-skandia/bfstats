package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/review.mjs; keep in step.
//
// The review log: everything the sidecar receives but cannot yet turn into a
// clean record goes here, as NDJSON, with a running tally. This is how the
// replayer's understanding was built — bf42plus and the replayer dumped the
// events they had no case for and grew the decoders over time. The sidecar
// does the same one level lower, at the raw wire: unknown server events, the
// framed per-object ghost (movement) deltas that still need a class decoder,
// any ghost block that would not frame, unknown datagram types, and decode
// errors. Review the file, decode the next thing, shrink the file.
//
// Port notes: fs.createWriteStream is a UTF-8 java.io writer on `path` (or
// the `out` a test passes), flushed every line; Date.now() is `clock.wallMs()`.
// A record field left out is Undefined, and is left out of the line as
// JSON.stringify leaves an undefined one out.

import java.io.File
import java.io.Writer

class ReviewLog(val path: String?, private val clock: Clock = SystemClock, out: Writer? = null) {
  private val stream: Writer? = out ?: path?.let { File(it).bufferedWriter(Charsets.UTF_8) }
  val counts = LinkedHashMap<String, Int>()      // tag -> count
  val eventIds = LinkedHashMap<Any?, Int>()      // unknown event id -> count
  val ghostNetIds = LinkedHashMap<Any?, Int>()   // netId -> count of ghost updates
  val ghostLens = LinkedHashMap<Any?, Int>()     // body bit-length -> count (per-class delta sizes)
  val started = clock.wallMs()

  private fun <K> bump(map: MutableMap<K, Int>, key: K) { map[key] = (map[key] ?: 0) + 1 }

  private fun write(tag: String, rec: List<Pair<String, Any?>>) {
    bump(counts, tag)
    val s = stream ?: return
    val row = LinkedHashMap<String, Any?>()
    row["tag"] = tag
    row["dt"] = JsNumber.toFixed((clock.wallMs() - started) / 1000, 3).toDouble()
    for ((k, v) in rec) row[k] = v
    s.write(Js.stringify(row) + "\n")
    s.flush()
  }

  // A server event whose 7-bit type has no decoder. Keep the id, the bit
  // offset in the block, and a window of the following bytes to decode from.
  fun unknownEvent(id: Any?, seq: Any? = Undefined, block: Any? = Undefined, bitOffset: Any? = Undefined, hex: Any? = Undefined) {
    bump(eventIds, JsNumber.key(id))
    write("unknown-event", listOf("id" to id, "idHex" to "0x" + JsNumber.hex(id), "seq" to seq, "block" to block,
      "bitOffset" to bitOffset, "hex" to hex))
  }

  // One framed ghost (object-update) record: which object, what action, and
  // the raw body bits that a per-class setNetUpdate decoder will consume.
  // action 1 = create/update (has a body), 3 = remove, 0 = none.
  // `ref` is the block's compression reference (the control state's root
  // position), without which a record's compressed position cannot be read.
  fun ghostRecord(seq: Any? = Undefined, tick: Any? = Undefined, netId: Any? = Undefined, action: Any? = Undefined,
                  bodyBits: Any? = Undefined, hex: Any? = Undefined, ref: Any? = Undefined) {
    bump(ghostNetIds, JsNumber.key(netId))
    if (!JsNumber.nullish(bodyBits)) bump(ghostLens, JsNumber.key(bodyBits))
    val rec = mutableListOf("seq" to seq, "tick" to tick, "netId" to netId, "action" to action, "bodyBits" to bodyBits, "hex" to hex)
    if (JsNumber.truthy(ref)) rec.add("ref" to ref)
    write("ghost-record", rec)
  }

  // A ghost block that would not frame (e.g. it carried a control-object
  // state the sidecar does not size): keep the whole thing raw.
  fun ghostBlockRaw(seq: Any? = Undefined, reason: Any? = Undefined, hex: Any? = Undefined) {
    write("ghost-block-raw", listOf("seq" to seq, "reason" to reason, "hex" to hex))
  }

  fun unknownDatagram(type: Any?, hex: Any? = Undefined) {
    write("unknown-datagram", listOf("type" to type, "typeHex" to "0x" + JsNumber.hex(type), "hex" to hex))
  }

  fun decodeError(where: Any? = Undefined, seq: Any? = Undefined, message: Any? = Undefined, hex: Any? = Undefined) {
    write("decode-error", listOf("where" to where, "seq" to seq, "message" to message, "hex" to hex))
  }

  // A compact tally for the end of a run (and for a periodic print).
  fun summary(): LinkedHashMap<String, Any?> {
    fun top(m: Map<Any?, Int>, n: Int = 12) = m.entries.sortedByDescending { it.value }.take(n).map { (k, v) ->
      val name = if (k is Number && k.toDouble() > 9) "0x" + JsNumber.hex(k) else JsNumber.str(k)
      "$name:$v"
    }
    return linkedMapOf(
      "tags" to LinkedHashMap<String, Any?>(counts),
      "unknownEventIds" to top(eventIds),
      "ghostUpdatesByNetId" to top(ghostNetIds),
      "ghostBodyBitLengths" to top(ghostLens),
      "path" to path,
    )
  }

  fun close() { stream?.close() }
}
