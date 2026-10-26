package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/content-crc.mjs; keep in step.
//
// The content check's answer: the u32 the client puts in the Ack (0x02) it
// sends once its level has loaded (features/udp-sidecar/wire.md section 4).
//
// The retail client computes a CRC while the level loads (BF1942.exe
// 0x00410980): the bytes of every .con the console runs, outside ai/, chained
// with the smallest mip of every DDS texture it uploads (0x00596650 ->
// 0x005c1360), merged into one u32 (0x005c13c0) and sent as
// `challenge[0..3] ^ crc`. The server does not compute it. It reads
// `Mods/<mod>/contentCrc32.con` (Setup::readContentCrc32File), lines of
// `game.addContentCrc32 <mapId> <level> <GPM_mode> <crc>`, and with
// serverContentCheck on, GameServer::handleGameEventManagerEvent case 2
// (lnxded 0x08136308) sets the connection's content flag only when
// `Ack ^ challenge[0..3]` is one of the level's listed values. A connection
// without the flag is closed with reason 0x1b when it acks the database
// (0x08136cc3). The install ships the same file the server reads, so the
// sidecar answers from it. Vanilla Market Garden Conquest lists 2545831109
// (0x97be4cc5), the value a retail client sent TheGreatEscape (2026-10-24).
//
// The sidecar must also run without the game installed, so every row of the
// install's files (bf1942, XPack1, XPack2, GCMOD) is bundled in
// content-crc.json (a copy in core/src/main/resources/sidecar, checked
// against the Node copy's by the parity fixture).
//
// An optional layer: a level with no row anywhere answers null (the caller
// sends 0, which only a server with the check off accepts) and warns once;
// nothing here throws.
//
// STUB: reading an install's own Mods/*/contentCrc32.con (installRows,
// rowsFor, the --build entry point) is not ported: Android has no install, so
// the bundled table always answers; `dir` is accepted and ignored, which is
// the Node copy's answer for a directory without the file.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

// SetLevel's mode file -> the GamePlayMode name the file keys on.
private val GPM = mapOf("conquest" to "GPM_CQ", "coop" to "GPM_COOP", "ctf" to "GPM_CTF", "tdm" to "GPM_TDM", "objectivemode" to "GPM_OBJECTIVEMODE")

/** `conquest.con` -> `GPM_CQ`; null for a mode the file never names. */
fun gpmFor(modeFile: String?): String? = GPM[JsOps.trim((modeFile ?: "").lowercase().replace(Regex("\\.con$"), ""))]

private val PATH_SEP = Regex("[\\\\/]+")

/** The level's directory name from SetLevel's path (`bf1942/levels/market_garden/`). */
fun levelName(levelPath: String?): String {
  val parts = (levelPath ?: "").split(PATH_SEP).filter { it.isNotEmpty() }
  return if (parts.isNotEmpty()) parts.last() else ""
}

private val CRC_LINE = Regex("^game\\.addContentCrc32[$JS_WS]+([^$JS_WS]+)[$JS_WS]+([^$JS_WS]+)[$JS_WS]+([^$JS_WS]+)[$JS_WS]+([0-9]+)", RegexOption.IGNORE_CASE)

/** Parse a contentCrc32.con: Map `mapid/level/gpm` (lower case) -> [crc, ...]. */
fun parseContentCrc32(text: String): LinkedHashMap<String, MutableList<Long>> {
  val rows = LinkedHashMap<String, MutableList<Long>>()
  for (line in text.split(Regex("\r?\n"))) {
    val m = CRC_LINE.find(JsOps.trim(line)) ?: continue
    val key = "${m.groupValues[1]}/${m.groupValues[2]}/${m.groupValues[3]}".lowercase()
    // Number(m[4]) >>> 0
    rows.getOrPut(key) { mutableListOf() }.add(JsOps.toUint32(m.groupValues[4].toDouble()))
  }
  return rows
}

private object ContentCrcRes

private val bundledRows: Map<String, List<Double?>> by lazy {
  try {
    val text = ContentCrcRes::class.java.getResource("/sidecar/content-crc.json")!!.readText()
    val rows = (Json.parseToJsonElement(text) as JsonObject)["rows"] as? JsonObject ?: JsonObject(emptyMap())
    rows.mapValues { (_, v) -> (v as? JsonArray)?.map { (it as? JsonPrimitive)?.doubleOrNull } ?: emptyList() }
  } catch (e: Exception) {
    System.err.println("[sidecar] content-crc.json unreadable (${e.message}); content CRCs from the install only")
    emptyMap()
  }
}

/** The bundled table (content-crc.json's `rows`), for the parity check. */
fun bundledContentRows(): Map<String, List<Long>> = bundledRows.mapValues { (_, v) -> v.map { JsOps.toUint32(it ?: 0.0) } }

private val warnedContent = mutableSetOf<String>()

/**
 * The content CRC for a level, or null. `mod` is the server's mod (its
 * Mods/ directory, any case), `mapId` ServerInfo's (BF1942, XPack1, ...),
 * `levelPath` and `modeFile` the SetLevel's. The Node copy looks the
 * server's mod up first, then every other mod's file, in the install (not
 * here: see the header), then the bundled table.
 */
@Suppress("UNUSED_PARAMETER")
fun contentCrc(
  mod: String?, mapId: String?, levelPath: String?, modeFile: String?,
  dir: String? = null, bundled: Boolean = true, warn: (String) -> Unit = { System.err.println(it) },
): Long? {
  val gpm = gpmFor(modeFile)
  val level = levelName(levelPath)
  // `${mapId || mod || 'BF1942'}/${level}/${gpm}`: a null gpm prints "null".
  val key = "${mapId.takeUnless { it.isNullOrEmpty() } ?: mod.takeUnless { it.isNullOrEmpty() } ?: "BF1942"}/$level/$gpm".lowercase()
  val crc = if (gpm != null && level.isNotEmpty() && bundled) bundledRows[key]?.firstOrNull() else null
  if (crc != null) return crc.toLong()
  if (synchronized(warnedContent) { warnedContent.add(key) }) {
    warn("[sidecar] no contentCrc32.con row for $key; content Ack = 0 (a server with serverContentCheck on will close us with 0x1b)")
  }
  return null
}
