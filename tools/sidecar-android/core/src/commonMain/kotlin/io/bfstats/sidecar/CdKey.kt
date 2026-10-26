package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/cdkey.mjs; keep in step.
//
// The CD-key half of the ChallengeResponse (wire.md section 4).
//
// The retail client reads its key from the registry (`...\Battlefield
// 1942\ergc`, Setup::getStringFromRegistry 0x00443f10 at 0x00495103; an
// expansion's own key at 0x00459e20) and hands it, with the Challenge's
// string, to GameSpy's `gcd_compute_response` (BF1942.exe 0x0081fa20):
//
//   md5hex(key) . sprintf("%.8x", r) . md5hex(key . sprintf("%d", r % 0xffff) . challenge) . NUL
//
// 32 + 8 + 32 + 1 = the event's 73 bytes, r = rand() << 16 | rand() (srand
// seeded with time ^ 0x33333333). A LAN server accepts anything
// (GameSpyHost::authenticateUser 0x0810b630, "LanGame Accept"); an internet
// server passes the hash and its own challenge to `gcd_authenticate_user`
// (lnxded 0x0810d380), and the master recomputes the second digest.
//
// The challenge string is the Challenge event's 10 bytes read as a C string.
// The server writes ten letters then NULs the tenth
// (ClientConnection::initChallengeString 0x08116280 sets +0x151 = 0 over a
// buffer at +0x148), so it is nine letters, and that NUL travels in the
// event. The client keeps the mod name straight after the 10 bytes (event
// +0xc challenge, +0x16 mod, ChallengeEvent::deSerialize 0x0811f130), so a
// challenge without a NUL would run on into the mod; that is mirrored too.
//
// The key: bf42++ replaces a missing or published key with a generated
// 22-digit one (generic.cpp getStringFromRegistry_hook), and those join
// public servers. The sidecar does the same, one key per product, kept in
// ~/.config/bfstats-sidecar/cdkeys.json (%APPDATA%\bfstats-sidecar on
// Windows; on Android the app's files dir) so a server sees the same player
// across runs. It never borrows this PC's own key: a master that sees one key
// on two connections drops one, and the other would be the owner's game.
//
// crypto.randomInt is `randomInt` (bound exclusive), so a test can seed it.

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

const val KEY_HASH_BYTES = 73

private fun md5hex(b: ByteArray): String = Digest.md5(b).hex()

/** crypto.randomInt(max): uniform in 0 until max. */
val defaultRandomInt: (Int) -> Int = { max -> secureRandomInt(max) }

/** The C string the client hands gcd_compute_response, as latin1 bytes. */
fun challengeString(challenge: ByteArray, mod: String = ""): ByteArray {
  val nul = challenge.indexOf(0)
  if (nul >= 0) return challenge.copyOf(nul)
  val m = latin1(mod)
  val mnul = m.indexOf(0)
  return challenge + (if (mnul >= 0) m.copyOf(mnul) else m)
}

/** A retail-shaped r: two 15-bit MSVC rand() values, `rand() << 16 | rand()`. */
fun retailRand(randomInt: (Int) -> Int = defaultRandomInt): Long =
  ((randomInt(0x8000) shl 16) or randomInt(0x8000)).toLong() and 0xffffffffL

/** gcd_compute_response (BF1942.exe 0x0081fa20): the 73-byte key hash. */
fun keyHashResponse(cdkey: String, challenge: ByteArray, r: Long = retailRand()): ByteArray {
  val key = latin1(cdkey)
  val out = ByteArray(KEY_HASH_BYTES)
  // The client's own guard (key*2 + challenge + 8 > 0x1ff) writes an error
  // string instead; nothing the sidecar sends comes near it.
  if (key.size * 2 + challenge.size + 8 > 0x1ff) throw IllegalArgumentException("CD key or challenge too long")
  val u = r and 0xffffffffL
  val rand = u.toString(16).padStart(8, '0')
  val raw = key + latin1((u % 0xffff).toString()) + challenge
  latin1(md5hex(key) + rand + md5hex(raw)).copyInto(out, 0)
  return out // byte 72 stays NUL
}

/** The String-challenge form (Buffer.from(String(challenge), 'latin1')). */
fun keyHashResponse(cdkey: String, challenge: String, r: Long = retailRand()): ByteArray = keyHashResponse(cdkey, latin1(challenge), r)

/** A fresh 22-digit key, the shape bf42++ generates. */
fun generateCdKey(randomInt: (Int) -> Int = defaultRandomInt): String {
  val s = StringBuilder()
  while (s.length < 22) s.append(randomInt(10))
  // A leading zero is legal, but keep the first digit non-zero like a printed key.
  return if (s[0] == '0') "1${s.substring(1)}" else s.toString()
}

/** SIDECAR_CDKEY_FILE, else <configDir>/cdkeys.json. */
fun defaultKeyFile(env: Map<String, String?> = systemEnv(), config: String = configDir(env)): FsFile =
  env["SIDECAR_CDKEY_FILE"]?.takeIf { it.isNotEmpty() }?.let { FsFile(it) } ?: FsFile(config, "cdkeys.json")

/**
 * The sidecar's keys, by the Challenge's xpack (-1 base game, 713 Road to
 * Rome, 783 Secret Weapons). `override` (a --cdkey, or SIDECAR_CDKEY) is the
 * base game's key; an expansion still gets its own. A key file that cannot be
 * read or written leaves the run on in-memory keys with a warning. A file
 * whose JSON is not an object is taken as empty (the Node copy would carry an
 * array or a number on and write odd JSON back).
 */
fun cdKeyStore(
  override: String? = systemEnv()["SIDECAR_CDKEY"],
  file: FsFile = defaultKeyFile(),
  warn: (String) -> Unit = { printErr(it) },
  randomInt: (Int) -> Int = defaultRandomInt,
): (xpack: Long?) -> String {
  var keys: LinkedHashMap<String, JsonElement>? = null
  fun load(): LinkedHashMap<String, JsonElement> {
    keys?.let { return it }
    val k = try {
      val o = Json.parseToJsonElement(file.readText())
      JsOps.jsOrder((o as? JsonObject)?.toMap() ?: emptyMap())
    } catch (e: Exception) {
      if (!FsFile.isNotFound(e)) warn("cdkey: ${file.path} unreadable (${e.message}); using fresh keys")
      LinkedHashMap()
    }
    keys = k
    return k
  }
  return { xpack ->
    val id = (xpack ?: -1L).toString()
    if (id == "-1" && !override.isNullOrEmpty()) override
    else {
      val k = load()
      val have = (k[id] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (!have.isNullOrEmpty()) have
      else {
        val key = generateCdKey(randomInt)
        k[id] = JsonPrimitive(key)
        val ordered = LinkedHashMap(JsOps.jsOrder(k)) // a copy: jsOrder may hand back k itself
        k.clear(); k.putAll(ordered)
        try {
          file.absoluteFile.parentFile?.mkdirs()
          file.writeText("${prettyJson(k, "")}\n")
          setOwnerOnly(file.path) // { mode: 0o600 }
        } catch (e: Exception) { warn("cdkey: could not save ${file.path} (${e.message}); this run's key is not kept") }
        key
      }
    }
  }
}

/** JSON.stringify(v, null, 2) of parsed JSON. */
private fun prettyJson(v: Any?, indent: String): String {
  val inner = "$indent  "
  return when (v) {
    is Map<*, *> -> if (v.isEmpty()) "{}" else v.entries.joinToString(",\n", "{\n", "\n$indent}") { (k, x) ->
      val sb = StringBuilder(); Js.quote(sb, k.toString()); "$inner$sb: ${prettyJson(x, inner)}"
    }
    is JsonObject -> prettyJson(JsOps.jsOrder(v.toMap()), indent)
    is JsonArray -> if (v.isEmpty()) "[]" else v.joinToString(",\n", "[\n", "\n$indent]") { "$inner${prettyJson(it, inner)}" }
    else -> Js.stringify(v)
  }
}
