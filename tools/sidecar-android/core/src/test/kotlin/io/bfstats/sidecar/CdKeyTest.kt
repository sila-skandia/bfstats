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
  private val fx = Fixtures.load("cdkey")
  private fun seeded(seed: Long): (Int) -> Int { val r = prng(seed); return { max -> Math.floor(r() * max).toInt() } }

  @Test fun challengeAndHash() {
    for (row in fx["challengeString"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.str(r["out"]), challengeString(fromHex(Fixtures.str(r["challenge"])!!), Fixtures.str(r["mod"])!!).hex())
    }
    for (row in fx["keyHash"]!!.jsonArray) {
      val r = row.jsonObject
      val got = keyHashResponse(Fixtures.str(r["key"])!!, fromHex(Fixtures.str(r["challenge"])!!), Fixtures.num(r["r"])!!.toLong())
      assertEquals(Fixtures.js(r), Fixtures.str(r["out"]), got.hex())
    }
    for (row in fx["keyHashString"]!!.jsonArray) {
      val r = row.jsonObject
      assertEquals(Fixtures.str(r["out"]), keyHashResponse(Fixtures.str(r["key"])!!, Fixtures.str(r["challenge"])!!, Fixtures.num(r["r"])!!.toLong()).hex())
    }
    val tooLong = runCatching { keyHashResponse("x".repeat(250), ByteArray(4), 1) }.exceptionOrNull()?.message
    assertEquals(Fixtures.str(fx["tooLong"]), tooLong)
    assertEquals(Fixtures.str(fx["justFits"]), runCatching { keyHashResponse("x".repeat(249), ByteArray(5), 1); "ok" }.getOrElse { it.message })
  }

  @Test fun seededKeysAndRand() {
    val ri = seeded(4242)
    assertEquals(Fixtures.js(fx["rand"]), Js.stringify((0 until 20).map { retailRand(ri) }))
    assertEquals(Fixtures.js(fx["keys"]), Js.stringify((0 until 40).map { generateCdKey(ri) }))
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
          "new" -> store = cdKeyStore(override = Fixtures.str(s[1]), file = file, warn = { warns++ }, randomInt = ri)
          "get" -> assertEquals(Fixtures.js(row), Fixtures.str(s[2]), store!!(Fixtures.num(s[1])?.toLong()))
          "file" -> assertEquals(Fixtures.str(s[1]), if (file.exists()) file.readText() else null)
          "write" -> file.writeText(Fixtures.str(s[1])!!)
          "warns" -> assertEquals(Fixtures.num(s[1])!!.toInt(), warns)
        }
      }
    } finally { dir.deleteRecursively() }
  }

  @Test fun dirs() {
    for (row in fx["paths"]!!.jsonArray) {
      val r = row.jsonObject
      val env = r["env"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
      val platform = Fixtures.str(r["platform"])!!; val home = Fixtures.str(r["home"])!!
      assertEquals(Fixtures.str(r["configDir"]), configDir(env, platform, home))
      assertEquals(Fixtures.str(r["cacheDir"]), cacheDir(env, platform, home))
    }
  }
}
