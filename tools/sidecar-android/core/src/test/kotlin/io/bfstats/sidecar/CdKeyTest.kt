package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** CdKey.kt and Paths.kt against cdkey.mjs and paths.mjs, from parity/cdkey.mjs. */
class CdKeyTest {
  private val fx = Parity.load("cdkey")
  private fun seeded(seed: Long): (Int) -> Int { val r = prng(seed); return { max -> Math.floor(r() * max).toInt() } }

  @Test fun challengeAndHash() {
    for (row in fx["challengeString"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.str(r["out"]), challengeString(fromHex(Parity.str(r["challenge"])!!), Parity.str(r["mod"])!!).hex())
    }
    for (row in fx["keyHash"]!!.jsonArray) {
      val r = row.jsonObject
      val got = keyHashResponse(Parity.str(r["key"])!!, fromHex(Parity.str(r["challenge"])!!), Parity.num(r["r"])!!.toLong())
      assertEquals(Parity.js(r), Parity.str(r["out"]), got.hex())
    }
    for (row in fx["keyHashString"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Parity.str(r["out"]), keyHashResponse(Parity.str(r["key"])!!, Parity.str(r["challenge"])!!, Parity.num(r["r"])!!.toLong()).hex())
    }
    val tooLong = runCatching { keyHashResponse("x".repeat(250), ByteArray(4), 1) }.exceptionOrNull()?.message
    assertEquals(Parity.str(fx["tooLong"]), tooLong)
    assertEquals(Parity.str(fx["justFits"]), runCatching { keyHashResponse("x".repeat(249), ByteArray(5), 1); "ok" }.getOrElse { it.message })
  }

  @Test fun seededKeysAndRand() {
    val ri = seeded(4242)
    assertEquals(Parity.js(fx["rand"]), Js.stringify((0 until 20).map { retailRand(ri) }))
    assertEquals(Parity.js(fx["keys"]), Js.stringify((0 until 40).map { generateCdKey(ri) }))
  }

  @Test fun keyStoreFile() {
    val dir = Files.createTempDirectory("cdkey-parity-").toFile()
    try {
      val file = File(dir, "k/cdkeys.json")
      var warns = 0
      val ri = seeded(99)
      var store: ((Long?) -> String)? = null
      for (row in fx["store"]!!.jsonArray) {
        val s = row.jsonArray
        when (s[0].jsonPrimitive.content) {
          "new" -> store = cdKeyStore(override = Parity.str(s[1]), file = file, warn = { warns++ }, randomInt = ri)
          "get" -> assertEquals(Parity.js(row), Parity.str(s[2]), store!!(Parity.num(s[1])?.toLong()))
          "file" -> assertEquals(Parity.str(s[1]), if (file.exists()) file.readText() else null)
          "write" -> file.writeText(Parity.str(s[1])!!)
          "warns" -> assertEquals(Parity.num(s[1])!!.toInt(), warns)
        }
      }
    } finally { dir.deleteRecursively() }
  }

  @Test fun dirs() {
    for (row in fx["paths"]!!.jsonArray) {
      val r = row.jsonObject
      val env = r["env"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
      val platform = Parity.str(r["platform"])!!; val home = Parity.str(r["home"])!!
      assertEquals(Parity.str(r["configDir"]), configDir(env, platform, home))
      assertEquals(Parity.str(r["cacheDir"]), cacheDir(env, platform, home))
    }
  }
}
