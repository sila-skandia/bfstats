package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/plus.mjs; keep in step.
//
// What BF42++ (bf42plus, the community client most servers expect) adds to
// the wire, from the client's side. features/udp-sidecar/wire.md section 30 is
// the inventory with the source lines; this module is the part the sidecar
// needs to join a bf42++-aware server as a bf42++ client does:
//
//   * the marker a bf42++ client writes into its ConnectAcceptAck, by which a
//     server tells it from a retail client (bfhook.cpp
//     patch_add_plus_version_to_accept_ack, lines 338-366);
//   * the server settings a bf42++ server hides in its welcome lines
//     (settings.cpp ServerSettings::parseFromText, lines 306-395, and
//     parseNextParameter, 272-304), parsed exactly as the client parses them;
//   * the map-change restart timing those settings switch (bfhook.cpp
//     patch_quicker_server_pinging_on_restart, lines 114-148).
//
// The three game events bf42++ adds (HUDText 0x01, CreateStaticObject 0x1c,
// UpdateStaticObject 0x1d) are in events.mjs with the rest of the table.

// bfhook.cpp:30. "Increment this on breaking network protocol change": 1 was
// the marker (7d57ff2), 2 added HUDTextEvent (f924835).
const val PLUS_PROTOCOL_VERSION = 2

/** A bf42++ build's version (get_build_version_components). */
data class PlusVersion(val major: Int = 0, val minor: Int = 0, val patch: Int = 0, val build: Int = 0) {
  fun toJs(): Map<String, Any?> = linkedMapOf("major" to major, "minor" to minor, "patch" to patch, "build" to build)
}

// The version this PC's bf42++ build reports: src/version.h build_version_full
// "2.0.0-0-0", read by get_build_version_components (bfhook.cpp:323) as
// major 2, minor 0, patch 0, build 0.
val PLUS_VERSION = PlusVersion(major = 2, minor = 0, patch = 0, build = 0)

/** NetConnection's `plus` option: the identity the ConnectAcceptAck claims
 *  (the Node copy's `{ version, protocol }`, either left out for the default). */
data class PlusIdentity(val version: PlusVersion = PLUS_VERSION, val protocol: Int = PLUS_PROTOCOL_VERSION)

// util.cpp:195 crc8: init 0xff, polynomial 0x97, MSB first, no final xor.
fun crc8(bytes: ByteArray, from: Int = 0, to: Int = bytes.size): Int {
  var crc = 0xff
  for (i in from until to) {
    crc = crc xor (bytes[i].toInt() and 0xff)
    for (n in 0 until 8) crc = if ((crc and 0x80) != 0) (((crc shl 1) xor 0x97) and 0xff) else ((crc shl 1) and 0xff)
  }
  return crc
}

// The 8-byte ConnectAcceptAck with the bf42++ marker. The retail builder
// (BF1942.exe 0x0060f390) sends an uninitialised 8-byte stack buffer with
// [0] = the connection id and the u16 at [1] masked `& 0x0fff | 0x4000`, so
// byte 1 and the low nibble of byte 2 survive and bytes 3..7 are whatever was
// on the stack: the server reads only the id and the type. bf42++ fills the
// buffer first (hooked at 0x0060f393, before the original code runs):
//   [1] '+'  [2] 0x40 | min(build, 15)  [3] major  [4] minor  [5] patch
//   [6] PLUS_PROTOCOL_VERSION  [7] crc8 of [1..6]
// and the retail code then writes [0] and re-applies the mask, which keeps all
// of it (the type nibble is already 4).
fun buildPlusAcceptAck(id: Int, version: PlusVersion = PLUS_VERSION, protocol: Int = PLUS_PROTOCOL_VERSION): ByteArray {
  val b = ByteArray(8)
  b[0] = (id and 0xff).toByte()
  b[1] = 0x2b // '+'
  b[2] = (0x40 or (minOf(version.build, 15) and 0x0f)).toByte()
  b[3] = (version.major and 0xff).toByte()
  b[4] = (version.minor and 0xff).toByte()
  b[5] = (version.patch and 0xff).toByte()
  b[6] = (protocol and 0xff).toByte()
  b[7] = crc8(b, 1, 7).toByte()
  return b
}

// A server's reading of an ack: the marker, or null for a retail client.
fun parsePlusAcceptAck(buf: ByteArray?): Map<String, Any?>? {
  if (buf == null || buf.size < 8 || buf.u8(1) != 0x2b || (buf.u8(2) shr 4) != 4) return null
  if (crc8(buf, 1, 7) != buf.u8(7)) return null
  return linkedMapOf("build" to (buf.u8(2) and 0x0f), "major" to buf.u8(3), "minor" to buf.u8(4), "patch" to buf.u8(5), "protocol" to buf.u8(6))
}

// --- server settings ---------------------------------------------------------

// util.h:40
const val INVALID_COLOR = 0xffffffffL

// util.cpp:108 webcolors, sorted, looked up case-blind (_stricmp).
private val WEBCOLORS: Map<String, Long> = mapOf(
  "aliceblue" to 0xf0f8ff, "antiquewhite" to 0xfaebd7, "aqua" to 0x00ffff, "aquamarine" to 0x7fffd4,
  "azure" to 0xf0ffff, "beige" to 0xf5f5dc, "bisque" to 0xffe4c4, "black" to 0x000000, "blanchedalmond" to 0xffebcd,
  "blue" to 0x0000ff, "blueviolet" to 0x8a2be2, "brown" to 0xa52a2a, "burlywood" to 0xdeb887, "cadetblue" to 0x5f9ea0,
  "chartreuse" to 0x7fff00, "chocolate" to 0xd2691e, "coral" to 0xff7f50, "cornflowerblue" to 0x6495ed,
  "cornsilk" to 0xfff8dc, "crimson" to 0xdc143c, "cyan" to 0x00ffff, "darkblue" to 0x00008b, "darkcyan" to 0x008b8b,
  "darkgoldenrod" to 0xb8860b, "darkgray" to 0xa9a9a9, "darkgreen" to 0x006400, "darkgrey" to 0xa9a9a9,
  "darkkhaki" to 0xbdb76b, "darkmagenta" to 0x8b008b, "darkolivegreen" to 0x556b2f, "darkorange" to 0xff8c00,
  "darkorchid" to 0x9932cc, "darkred" to 0x8b0000, "darksalmon" to 0xe9967a, "darkseagreen" to 0x8fbc8f,
  "darkslateblue" to 0x483d8b, "darkslategray" to 0x2f4f4f, "darkslategrey" to 0x2f4f4f, "darkturquoise" to 0x00ced1,
  "darkviolet" to 0x9400d3, "deeppink" to 0xff1493, "deepskyblue" to 0x00bfff, "dimgray" to 0x696969,
  "dimgrey" to 0x696969, "dodgerblue" to 0x1e90ff, "firebrick" to 0xb22222, "floralwhite" to 0xfffaf0,
  "forestgreen" to 0x228b22, "fuchsia" to 0xff00ff, "gainsboro" to 0xdcdcdc, "ghostwhite" to 0xf8f8ff,
  "gold" to 0xffd700, "goldenrod" to 0xdaa520, "gray" to 0x808080, "green" to 0x008000, "greenyellow" to 0xadff2f,
  "grey" to 0x808080, "honeydew" to 0xf0fff0, "hotpink" to 0xff69b4, "indianred" to 0xcd5c5c, "indigo" to 0x4b0082,
  "ivory" to 0xfffff0, "khaki" to 0xf0e68c, "lavender" to 0xe6e6fa, "lavenderblush" to 0xfff0f5, "lawngreen" to 0x7cfc00,
  "lemonchiffon" to 0xfffacd, "lightblue" to 0xadd8e6, "lightcoral" to 0xf08080, "lightcyan" to 0xe0ffff,
  "lightgoldenrodyellow" to 0xfafad2, "lightgray" to 0xd3d3d3, "lightgreen" to 0x90ee90, "lightgrey" to 0xd3d3d3,
  "lightpink" to 0xffb6c1, "lightsalmon" to 0xffa07a, "lightseagreen" to 0x20b2aa, "lightskyblue" to 0x87cefa,
  "lightslategray" to 0x778899, "lightslategrey" to 0x778899, "lightsteelblue" to 0xb0c4de,
  "lightyellow" to 0xffffe0, "lime" to 0x00ff00, "limegreen" to 0x32cd32, "linen" to 0xfaf0e6, "magenta" to 0xff00ff,
  "maroon" to 0x800000, "mediumaquamarine" to 0x66cdaa, "mediumblue" to 0x0000cd, "mediumorchid" to 0xba55d3,
  "mediumpurple" to 0x9370db, "mediumseagreen" to 0x3cb371, "mediumslateblue" to 0x7b68ee,
  "mediumspringgreen" to 0x00fa9a, "mediumturquoise" to 0x48d1cc, "mediumvioletred" to 0xc71585,
  "midnightblue" to 0x191970, "mintcream" to 0xf5fffa, "mistyrose" to 0xffe4e1, "moccasin" to 0xffe4b5,
  "navajowhite" to 0xffdead, "navy" to 0x000080, "oldlace" to 0xfdf5e6, "olive" to 0x808000, "olivedrab" to 0x6b8e23,
  "orange" to 0xffa500, "orangered" to 0xff4500, "orchid" to 0xda70d6, "palegoldenrod" to 0xeee8aa,
  "palegreen" to 0x98fb98, "paleturquoise" to 0xafeeee, "palevioletred" to 0xdb7093, "papayawhip" to 0xffefd5,
  "peachpuff" to 0xffdab9, "peru" to 0xcd853f, "pink" to 0xffc0cb, "plum" to 0xdda0dd, "powderblue" to 0xb0e0e6,
  "purple" to 0x800080, "rebeccapurple" to 0x663399, "red" to 0xff0000, "rosybrown" to 0xbc8f8f, "royalblue" to 0x4169e1,
  "saddlebrown" to 0x8b4513, "salmon" to 0xfa8072, "sandybrown" to 0xf4a460, "seagreen" to 0x2e8b57,
  "seashell" to 0xfff5ee, "sienna" to 0xa0522d, "silver" to 0xc0c0c0, "skyblue" to 0x87ceeb, "slateblue" to 0x6a5acd,
  "slategray" to 0x708090, "slategrey" to 0x708090, "snow" to 0xfffafa, "springgreen" to 0x00ff7f,
  "steelblue" to 0x4682b4, "tan" to 0xd2b48c, "teal" to 0x008080, "thistle" to 0xd8bfd8, "tomato" to 0xff6347,
  "turquoise" to 0x40e0d0, "violet" to 0xee82ee, "wheat" to 0xf5deb3, "white" to 0xffffff, "whitesmoke" to 0xf5f5f5,
  "yellow" to 0xffff00, "yellowgreen" to 0x9acd32,
)

private val HEX_DIGITS = Regex("^[0-9a-fA-F]+$")

// util.cpp:143 GetColorFromString: "#rgb" / "#rrggbb" (std::from_chars base 16
// over the whole rest, so no sign and no "0x"), else a web colour name.
fun colorFromString(name: String?): Long {
  if (name.isNullOrEmpty()) return INVALID_COLOR
  if (name[0] == '#') {
    val hex = name.substring(1)
    if ((name.length != 4 && name.length != 7) || !HEX_DIGITS.matches(hex)) return INVALID_COLOR
    val c = hex.toInt(16)
    if (name.length == 4) {
      // JS int32 shifts; every term is masked into 24 bits.
      return (((0xf00000 and (c shl 12)) or (0x0f0000 and (c shl 8)) or (0x00f000 and (c shl 8))
        or (0x000f00 and (c shl 4)) or (0x0000f0 and (c shl 4)) or (0x00000f and c)).toLong() and 0xffffffffL)
    }
    return c.toLong() and 0xffffffffL
  }
  return WEBCOLORS[name.lowercase()] ?: INVALID_COLOR
}

private val STRTOL = Regex("^[$JS_WS]*([+-]?[0-9]+)")

// strtol(value.data(), 0, 10). The value is a view into the line, so strtol
// reads on past it; but a value always ends at '&' or the setting's '~', which
// stop it, so the value alone decides. A key with no '=' hands strtol a null
// pointer (undefined behaviour in the client); taken as 0 here.
private fun strtol10(s: String?): Double {
  val m = STRTOL.find(s ?: "") ?: return 0.0
  // parseInt(m[1], 10): the digits as a double (a leading '+' is allowed).
  return m.groupValues[1].toDouble()
}

class Mine3DMap(var allow: Boolean = false, var distance: Double = 30.0, var color: Long = 0xff1493, var text: String = "*MINE*") {
  fun toJs(): Map<String, Any?> = linkedMapOf("allow" to allow, "distance" to distance, "color" to color, "text" to text)
}
class SupplyDepot3DMap(var allow: Boolean = false, var distance: Double = 65.0) {
  fun toJs(): Map<String, Any?> = linkedMapOf("allow" to allow, "distance" to distance)
}
class ControlPoint3DMap(var allow: Boolean = false, var distanceRadiusFactor: Double = 4.0) {
  fun toJs(): Map<String, Any?> = linkedMapOf("allow" to allow, "distanceRadiusFactor" to distanceRadiusFactor)
}
class Custom3DMap(
  var templateName: String = "", var text: String = "", var distance: Double = 30.0, var color: Long = 0xffff00,
  var onlySameTeam: Boolean = true, var showDistance: Boolean = false,
) {
  fun toJs(): Map<String, Any?> = linkedMapOf(
    "templateName" to templateName, "text" to text, "distance" to distance, "color" to color,
    "onlySameTeam" to onlySameTeam, "showDistance" to showDistance,
  )
}
class UiSettings(
  var openSpawnScreenOnDeath: Boolean = true,
  var openSpawnScreenOnJoin: Boolean = true,
  var allowFasterRestart: Boolean = true,
  var skipBriefingWindow: Boolean = false,
  var showEnemyNametags: Boolean = true,
) {
  fun toJs(): Map<String, Any?> = linkedMapOf(
    "openSpawnScreenOnDeath" to openSpawnScreenOnDeath, "openSpawnScreenOnJoin" to openSpawnScreenOnJoin,
    "allowFasterRestart" to allowFasterRestart, "skipBriefingWindow" to skipBriefingWindow,
    "showEnemyNametags" to showEnemyNametags,
  )
}

// ServerSettings (settings.h:273-311), with the client's defaults. The 3D map
// switches decide nothing on the wire or in the simulation (the client draws
// markers); they are parsed so the record is complete.
class ServerSettings {
  val mine3DMap = Mine3DMap()
  val supplyDepot3DMap = SupplyDepot3DMap()
  val controlPoint3DMap = ControlPoint3DMap()
  val custom3DMaps = mutableListOf<Custom3DMap>()
  val UI = UiSettings()
  /** Every setting name read, in order (the record's, not the client's). */
  val seen = mutableListOf<String>()

  fun toJs(): Map<String, Any?> = linkedMapOf(
    "mine3DMap" to mine3DMap.toJs(), "supplyDepot3DMap" to supplyDepot3DMap.toJs(),
    "controlPoint3DMap" to controlPoint3DMap.toJs(), "custom3DMaps" to custom3DMaps.map { it.toJs() },
    "UI" to UI.toJs(), "seen" to seen.toList(),
  )
}

fun defaultServerSettings() = ServerSettings()

private class View(var s: String)
private class Param(val key: String, val value: String?)
private val PARAM_END = Regex("[=&~]")

// parseNextParameter (settings.cpp:274): one "&key[=value]" off the front.
private fun nextParameter(view: View): Param? {
  if (!view.s.startsWith("&")) return null
  view.s = view.s.substring(1)
  val m = PARAM_END.find(view.s)
  val end = m?.range?.first ?: view.s.length
  val key = view.s.substring(0, end)
  view.s = view.s.substring(end)
  var value: String? = null // no '=': an empty view whose data() is null
  if (view.s.startsWith("=")) {
    view.s = view.s.substring(1)
    val amp = view.s.indexOf('&')
    value = if (amp < 0) view.s else view.s.substring(0, amp)
    view.s = view.s.substring(value.length)
  }
  return Param(key, value)
}

private val SETTING_NAME = Regex("^[A-Z0-9]*")

// ServerSettings::parseFromText (settings.cpp:306), run by the client on the
// text of every WelcomeMsgEvent it receives (gameevent.cpp:153-157), one line
// at a time: a setting must sit inside one welcome line. `into` accumulates as
// the client's global does (nothing resets it but a new process).
// `templateExists(name)` stands in for ObjectTemplate::getTemplateByName; a
// 3DO whose template is unknown is dropped, as the client drops it.
fun parseServerSettings(text: String?, into: ServerSettings = defaultServerSettings(), templateExists: ((String) -> Boolean)? = null): ServerSettings {
  var str = text ?: ""
  // The line is a C string: the client stops at the first NUL.
  val nul = str.indexOf('\u0000')
  if (nul >= 0) str = str.substring(0, nul)
  while (true) {
    val pos = str.indexOf('%')
    if (pos < 0) break
    str = str.substring(pos + 1)
    val end = str.indexOf('~')
    if (end < 0) break                                     // no closing character: stop
    val setting = str.substring(0, end)
    val nm = SETTING_NAME.find(setting)!!.value
    // Anything but '&' after the name ends the whole line's parse (a break,
    // not a continue, in the client).
    if (nm.length < setting.length && setting[nm.length] != '&') break
    val params = View(setting.substring(nm.length))
    if (nm.length > 1 && nm.length <= 4) {
      into.seen.add(nm)
      when (nm) {
        "3DM" -> {
          into.mine3DMap.allow = true
          while (true) {
            val p = nextParameter(params) ?: break
            when (p.key) {
              "D" -> into.mine3DMap.distance = strtol10(p.value)
              "C" -> into.mine3DMap.color = colorFromString(p.value ?: "")
              "T" -> into.mine3DMap.text = p.value ?: ""
            }
          }
        }
        "3DS" -> {
          into.supplyDepot3DMap.allow = true
          // settings.cpp:347: the client writes the MINE map's distance here,
          // so a supply map's D moves the mine markers' range. Kept.
          while (true) { val p = nextParameter(params) ?: break; if (p.key == "D") into.mine3DMap.distance = strtol10(p.value) }
        }
        "3DCP" -> {
          into.controlPoint3DMap.allow = true
          // settings.cpp:353: the same slip as 3DS.
          while (true) { val p = nextParameter(params) ?: break; if (p.key == "D") into.mine3DMap.distance = strtol10(p.value) }
        }
        "3DO" -> {
          val c = Custom3DMap()
          var ok = false
          while (true) {
            val p = nextParameter(params) ?: break
            if (p.key == "t") {
              c.templateName = p.value ?: ""
              ok = templateExists?.invoke(c.templateName) ?: true
              if (!ok) break
            } else if (p.key == "T") c.text = p.value ?: ""
            else if (p.key == "D") c.distance = strtol10(p.value)
            else if (p.key == "C") c.color = colorFromString(p.value ?: "")
            else if (p.key == "A") c.onlySameTeam = false
            else if (p.key == "sD") c.showDistance = true
          }
          if (ok) {
            if (c.text.isEmpty()) c.text = c.templateName
            // std::map::emplace: a template already present keeps its first entry.
            val key = c.templateName.lowercase()
            if (into.custom3DMaps.none { it.templateName.lowercase() == key }) into.custom3DMaps.add(c)
          }
        }
        "UI" -> {
          while (true) {
            val p = nextParameter(params) ?: break
            when (p.key) {
              "hssdeath" -> into.UI.openSpawnScreenOnDeath = false
              "hssjoin" -> into.UI.openSpawnScreenOnJoin = false
              "nfr" -> into.UI.allowFasterRestart = false
              "sbw" -> into.UI.skipBriefingWindow = true
              "hen" -> into.UI.showEnemyNametags = false
            }
          }
        }
      }
    }
    // Advance past the setting, leaving the '~' (the next search starts on it).
    str = str.substring(setting.length)
  }
  return into
}

// --- the map-change restart --------------------------------------------------

data class RestartTiming(val firstProbeMs: Long, val probeMs: Long) {
  fun toJs(): Map<String, Any?> = linkedMapOf("firstProbeMs" to firstProbeMs, "probeMs" to probeMs)
}

// The retail client's restart pinger (BF1942.exe): first ServerInfoRequest
// 16 s after the wait starts (0x004b6ffd writes 16.0 at +0xc), then every 3 s
// (0x004b6f69 writes 3.0 at +8). wire.md section 29, RECON-6.
val RETAIL_RESTART = RestartTiming(firstProbeMs = 16000, probeMs = 3000)
// bf42++ with its `fasterMapchange` option (default on, settings.h:202):
// 1.0 at +0xc and 2.0 patched over the 3.0 (bfhook.cpp:114-135), unless the
// server's welcome lines carried UI&nfr (allowFasterRestart false), which
// writes the retail 16.0 back.
val PLUS_RESTART = RestartTiming(firstProbeMs = 1000, probeMs = 2000)

fun restartTiming(plus: Boolean = true, settings: ServerSettings? = null): RestartTiming {
  if (!plus) return RETAIL_RESTART
  // nfr restores only the first delay: the 2.0 interval is patched at start-up
  // regardless (bfhook.cpp:134-135), so a bf42++ client then probes at 16 s,
  // 18 s, 20 s ...
  if (settings != null && !settings.UI.allowFasterRestart) {
    return RestartTiming(firstProbeMs = RETAIL_RESTART.firstProbeMs, probeMs = PLUS_RESTART.probeMs)
  }
  return PLUS_RESTART
}
