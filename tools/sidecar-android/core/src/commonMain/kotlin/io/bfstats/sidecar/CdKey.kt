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
 * read or written leaves the run on in-memory keys with a warning.
 *
 * The file's JSON is held as the Node copy holds it (JsOps.parse's values):
 * an object is the usual store; an array keeps a key under an index id as an
 * element and any other id in memory only, writing the array back; `null`, a
 * number, a string or a boolean throw where the Node copy's `k[id]` or
 * `k[id] = ...` throws a TypeError (an ES module is strict), and that throw
 * reaches the Challenge's timer as it does in Node (EventLoop.onUncaught).
 * A string's index ids read its characters, as `"abc"[0]` does.
 *
 * Node's `writeFileSync(..., { mode: 0o600 })` applies the mode only when it
 * creates the file; an existing file keeps its own. So does this: a new file
 * is created empty, made owner-only, then written, so the key never sits in a
 * file other users can read.
 */
fun cdKeyStore(
  override: String? = systemEnv()["SIDECAR_CDKEY"],
  file: FsFile = defaultKeyFile(),
  warn: (String) -> Unit = { printErr(it) },
  randomInt: (Int) -> Int = defaultRandomInt,
): (xpack: Long?) -> String {
  var keys: Any? = null
  // Properties an array cannot hold as elements: kept for the run, never written.
  val arrayProps = HashMap<String, Any?>()
  fun load(): Any? {
    if (JsOps.truthy(keys)) return keys
    keys = try {
      JsOps.parse(file.readText())
    } catch (e: Exception) {
      if (!isEnoent(file, e)) warn("cdkey: ${file.path} unreadable (${e.message}); using fresh keys")
      LinkedHashMap<String, Any?>()
    }
    return keys
  }
  fun describe(v: Any?): String = when (v) {
    is String -> "string '$v'"
    is Boolean -> "boolean '$v'"
    else -> "number '${Js.numberToString(JsOps.toNumber(v))}'"
  }
  fun read(k: Any?, id: String): Any? = when (k) {
    null -> throw IllegalStateException("Cannot read properties of null (reading '$id')")
    is Map<*, *> -> k[id]
    is List<*> -> if (JsOps.isIndexKey(id)) k.getOrNull(id.toInt()) else arrayProps[id]
    is String -> if (JsOps.isIndexKey(id) && id.toLong() < k.length) k[id.toInt()].toString() else null
    else -> null
  }
  @Suppress("UNCHECKED_CAST")
  fun put(k: Any?, id: String, v: String) {
    when (k) {
      is MutableMap<*, *> -> {
        val m = k as MutableMap<String, Any?>
        m[id] = v
        val ordered = LinkedHashMap(JsOps.jsOrder(m)) // a copy: jsOrder may hand back m itself
        m.clear(); m.putAll(ordered)
      }
      is MutableList<*> -> if (JsOps.isIndexKey(id)) {
        val l = k as MutableList<Any?>
        val i = id.toInt()
        while (l.size <= i) l.add(null) // a hole, which JSON.stringify writes as null
        l[i] = v
      } else arrayProps[id] = v
      else -> throw IllegalStateException("Cannot create property '$id' on ${describe(k)}")
    }
  }
  return { xpack ->
    val id = (xpack ?: -1L).toString()
    if (id == "-1" && !override.isNullOrEmpty()) override
    else {
      val k = load()
      val have = read(k, id) as? String
      if (!have.isNullOrEmpty()) have
      else {
        val key = generateCdKey(randomInt)
        put(k, id, key)
        try {
          file.absoluteFile.parentFile?.mkdirs()
          if (!file.exists()) { file.writeText(""); setOwnerOnly(file.path) } // { mode: 0o600 } on creation
          file.writeText("${prettyJson(k, "")}\n")
        } catch (e: Exception) { warn("cdkey: could not save ${file.path} (${e.message}); this run's key is not kept") }
        key
      }
    }
  }
}

/** Node's `e.code === 'ENOENT'`: a missing file, not one whose folder is a
 *  file (ENOTDIR), which the platform also reports as not found. */
private fun isEnoent(file: FsFile, e: Throwable): Boolean {
  if (!FsFile.isNotFound(e)) return false
  var up = file.absoluteFile.parentFile
  while (up != null && !up.exists()) up = up.parentFile
  return up == null || up.isDirectory
}

/** JSON.stringify(v, null, 2) of parsed JSON (JsOps.parse's values). */
private fun prettyJson(v: Any?, indent: String): String {
  val inner = "$indent  "
  return when (v) {
    is Map<*, *> -> if (v.isEmpty()) "{}" else v.entries.joinToString(",\n", "{\n", "\n$indent}") { (k, x) ->
      val sb = StringBuilder(); Js.quote(sb, k.toString()); "$inner$sb: ${prettyJson(x, inner)}"
    }
    is List<*> -> if (v.isEmpty()) "[]" else v.joinToString(",\n", "[\n", "\n$indent]") { "$inner${prettyJson(it, inner)}" }
    else -> Js.stringify(v)
  }
}
