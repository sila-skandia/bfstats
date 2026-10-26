package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/objects-checksum.mjs; keep in step.
//
// The second checksum (`b`) of a ChallengeResponse: a CRC of the mod's
// objects.rfa, which the retail client computes from its own install
// (features/udp-sidecar/wire.md section 4).
//
// BF1942.exe 0x005c1280 opens the path relative to the game directory, takes
// the file's length and runs a byte-at-a-time CRC over the whole file with a
// table built at 0x005c1220: polynomial 0x04c11db7 MSB-first (not reflected),
// init 0xffffffff, final NOT. That is CRC-32/BZIP2, not zlib's CRC32. The
// builder (0x0049507b) checksums "Mods/BF1942/Archives/objects.rfa" for the
// base response and "Mods/<Challenge mod>/Archives/objects.rfa" (0x004951ac)
// for an expansion's, then XORs the result with the challenge's first u32.
//
// Without the install, the bundled objects-crc.json (every mod of a retail
// 1.61 install, `node sidecar/objects-checksum.mjs --build`; a copy is in
// core/src/main/resources/sidecar, checked against the Node copy's by the
// parity fixture) answers. An optional layer: a mod in neither answers null
// (the caller sends 0) and warns once; nothing here throws.
//
// STUB: the install path (installChecksum, installChecksums, resolveCi and the
// --build entry point) is not ported. Android has no game install, so the
// Kotlin core always answers from the bundled table; `dir` is accepted and
// ignored, which is the Node copy's answer for a directory without the mod.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

private val CRC_TABLE: IntArray = IntArray(256).also { t ->
  for (i in 0 until 256) {
    var c = i shl 24
    for (k in 0 until 8) c = if ((c.toLong() and 0x80000000L) != 0L) (c shl 1) xor 0x04c11db7 else c shl 1
    t[i] = c
  }
}

/** CRC-32/BZIP2 of a buffer, as BF1942.exe 0x005c1280 computes it. */
fun crc32Bzip2(buf: ByteArray): Long {
  var c = -1 // 0xffffffff
  for (b in buf) c = (c shl 8) xor CRC_TABLE[((c ushr 24) xor (b.toInt() and 0xff)) and 0xff]
  return c.inv().toLong() and 0xffffffffL
}

private val warnedObjects = mutableSetOf<String>()
private fun warnOnce(key: String, msg: String, warn: (String) -> Unit) {
  synchronized(warnedObjects) { if (!warnedObjects.add(key)) return }
  warn(msg)
}

/** The bundled table's raw values (a JSON number each), keyed by mod in lower case. */
private val bundledRaw: Map<String, Double?> by lazy {
  try {
    val text = ObjectsChecksumRes::class.java.getResource("/sidecar/objects-crc.json")!!.readText()
    val mods = (Json.parseToJsonElement(text) as JsonObject)["mods"] as? JsonObject ?: JsonObject(emptyMap())
    mods.mapValues { (_, v) -> (v as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull }
  } catch (e: Exception) {
    System.err.println("[sidecar] objects-crc.json unreadable (${e.message}); objects.rfa CRCs from the install only")
    emptyMap()
  }
}
private object ObjectsChecksumRes

/** Every mod's CRC from a retail 1.61 install (objects-crc.json's `mods`). */
fun bundledChecksums(): Map<String, Long> =
  bundledRaw.filterValues { it != null && it == Math.rint(it) }.mapValues { toUint32(it.value!!) }

/** STUB (see the header): the install's CRC, never available on Android. */
@Suppress("UNUSED_PARAMETER")
fun installChecksum(mod: String? = "BF1942", dir: String? = null): Long? = null

/**
 * The CRC of `Mods/<mod>/Archives/objects.rfa`: the install's when the
 * archive is there (never, here: see the header), else the bundled table's
 * (objects-crc.json), else null.
 */
fun objectsChecksum(mod: String? = "BF1942", dir: String? = null, bundled: Boolean = true, warn: (String) -> Unit = { System.err.println(it) }): Long? {
  val m = if (mod.isNullOrEmpty()) "BF1942" else mod
  val rel = "Mods/$m/Archives/objects.rfa"
  val where = if (dir.isNullOrEmpty()) rel else "$dir/$rel"
  installChecksum(mod, dir)?.let { return it }
  // Number.isInteger(crc), then crc >>> 0.
  val raw = if (bundled) bundledRaw[m.lowercase()] else null
  if (raw != null && raw == Math.rint(raw) && !raw.isInfinite()) {
    warnOnce("b:$mod", "[sidecar] no $where; ChallengeResponse b from the bundled objects-crc.json ($mod)", warn)
    return toUint32(raw)
  }
  warnOnce(where, "[sidecar] no $where (not found) and no bundled CRC for $mod; ChallengeResponse b = 0", warn)
  return null
}
