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
// core/resources/sidecar, checked against the Node copy's by the
// parity fixture) answers. An optional layer: a mod in neither answers null
// (the caller sends 0) and warns once; nothing here throws.
//
// The install comes first, as in the Node copy (installChecksum: resolveCi
// and a CRC per file cached by size and mtime), so a PC with the game
// answers from its own archives; `dir` defaults to Paths.gameDir(), which is
// null on Android and iOS (no install: the bundled table answers). Paths are
// joined as path.posix.join joins them. Not ported: installChecksums and the
// --build entry point, which only rebuild objects-crc.json from the install.

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
private val lock = Lock()
private fun warnOnce(key: String, msg: String, warn: (String) -> Unit) {
  lock.withLock { if (!warnedObjects.add(key)) return }
  warn(msg)
}

/** The bundled table's raw values (a JSON number each), keyed by mod in lower case. */
private val bundledRaw: Map<String, Double?> by lazy {
  try {
    val text = EmbeddedResources.text("sidecar/objects-crc.json")!!
    val mods = (Json.parseToJsonElement(text) as JsonObject)["mods"] as? JsonObject ?: JsonObject(emptyMap())
    mods.mapValues { (_, v) -> (v as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull }
  } catch (e: Exception) {
    printErr("[sidecar] objects-crc.json unreadable (${e.message}); objects.rfa CRCs from the install only")
    emptyMap()
  }
}
/** Every mod's CRC from a retail 1.61 install (objects-crc.json's `mods`). */
fun bundledChecksums(): Map<String, Long> =
  bundledRaw.filterValues { it != null && it == Math.rint(it) }.mapValues { JsOps.toUint32(it.value!!) }

/** The default install folder (Paths.gameDir), or null when there is none to look in. */
fun defaultGameDirPath(): String? = Paths.gameDir()?.path

// The install is Windows-cased ("Mods/bf1942/Archives/Objects.rfa"); match
// each component case-insensitively, as the client's filesystem does.
private fun resolveCi(root: String, rel: String): String? {
  var cur = root
  for (part in rel.split('/')) {
    val exact = NodeFs.join(cur, part)
    if (NodeFs.exists(exact)) { cur = exact; continue }
    val hit = NodeFs.readdir(cur).firstOrNull { it.lowercase() == part.lowercase() } ?: return null
    cur = NodeFs.join(cur, hit)
  }
  return cur
}

private class Crc(val size: Long, val mtimeMs: Double, val crc: Long)
private val crcCache = HashMap<String, Crc>() // resolved path -> {size, mtimeMs, crc}

/** The CRC of the install's `Mods/<mod>/Archives/objects.rfa`, or null.
 *  Cached per file by size and mtime. Throws what the file system throws. */
fun installChecksum(mod: String? = "BF1942", dir: String? = defaultGameDirPath()): Long? {
  val file = if (!dir.isNullOrEmpty()) resolveCi(dir, "Mods/${if (mod.isNullOrEmpty()) "BF1942" else mod}/Archives/objects.rfa") else null
  if (file == null) return null
  val mtime = NodeFs.mtimeMs(file)
  val size = FsFile(file).length()
  lock.withLock { crcCache[file] }?.let { if (it.size == size && it.mtimeMs == mtime) return it.crc }
  val crc = crc32Bzip2(NodeFs.readFile(file))
  lock.withLock { crcCache[file] = Crc(size, mtime, crc) }
  return crc
}

/**
 * The CRC of `Mods/<mod>/Archives/objects.rfa`: the install's when the
 * archive is there, else the bundled table's (objects-crc.json), else null.
 * A null `mod` is the Node copy's default argument, "BF1942".
 */
fun objectsChecksum(mod: String? = "BF1942", dir: String? = defaultGameDirPath(), bundled: Boolean = true, warn: (String) -> Unit = { printErr(it) }): Long? {
  val mod0 = mod ?: "BF1942"
  val m = mod0.ifEmpty { "BF1942" }
  val rel = "Mods/$m/Archives/objects.rfa"
  val where = NodeFs.join(dir ?: "", rel)
  var why = "not found"
  try {
    installChecksum(mod0, dir)?.let { return it }
  } catch (e: Exception) { why = e.message ?: "" }
  // Number.isInteger(crc), then crc >>> 0.
  val raw = if (bundled) bundledRaw[m.lowercase()] else null
  if (raw != null && raw == Math.rint(raw) && !raw.isInfinite()) {
    warnOnce("b:$mod0", "[sidecar] no $where; ChallengeResponse b from the bundled objects-crc.json ($mod0)", warn)
    return JsOps.toUint32(raw)
  }
  warnOnce(where, "[sidecar] no $where ($why) and no bundled CRC for $mod0; ChallengeResponse b = 0", warn)
  return null
}

/** Forget the CRC cache and the warnings (tests; a fresh Node process). */
fun resetObjectsChecksum() { lock.withLock { crcCache.clear(); warnedObjects.clear() } }
