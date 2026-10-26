package io.bfstats.sidecar

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import io.bfstats.sidecar.Assert.assertEquals
import kotlin.test.Test
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem

/** ObjectsChecksum.kt against objects-checksum.mjs, from parity/objects-checksum.mjs. */
class ObjectsChecksumTest {
  private val fx = Fixtures.load("objects-checksum")

  @Test fun crc() {
    for (row in fx["crc"]!!.jsonArray) {
      val (h, want) = row.jsonArray
      assertEquals(Fixtures.num(want)!!.toLong(), crc32Bzip2(fromHex(Fixtures.str(h)!!)))
    }
  }

  @Test fun bundledTableMatchesNode() {
    assertEquals(Fixtures.js(fx["bundled"]), Js.stringify(bundledChecksums()))
  }

  /** The fake install the generator built, rebuilt here. */
  private fun build(root: FsFile, tree: kotlinx.serialization.json.JsonArray) {
    for (e in tree) {
      val a = e.jsonArray
      val f = FsFile(root, Fixtures.str(a[0])!!)
      val h = if (a.size > 1) Fixtures.str(a[1]) else null
      if (h == null) f.mkdirs() else { f.parentFile!!.mkdirs(); writeBytes(f, fromHex(h)) }
    }
  }

  @Test fun lookupsInAnInstall() {
    resetObjectsChecksum()
    val root = tempDir("objects-install-")
    build(root, fx["installTree"]!!.jsonArray)
    for (row in fx["install"]!!.jsonArray) {
      val r = row.jsonObject
      r["rewrite"]?.let { w -> writeBytes(FsFile(root, Fixtures.str(w.jsonArray[0])!!), fromHex(Fixtures.str(w.jsonArray[1])!!)); return@let }
      if (r.containsKey("rewrite")) continue
      val warns = ArrayList<String>()
      val dirRel = Fixtures.str(r["dir"])
      val dir = dirRel?.let { NodeFs.join(root.path, it) }
      val got = objectsChecksum(Fixtures.str(r["mod"]), dir = dir, bundled = Fixtures.bool(r["bundled"]) == true,
        warn = { warns += it.split(root.path).joinToString("<dir>") })
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(got))
      assertEquals(Fixtures.js(r), Fixtures.js(r["warns"]), Js.stringify(warns))
    }
  }

  @Test fun lookupsWithoutAnInstall() {
    for (row in fx["lookups"]!!.jsonArray) {
      val r = row.jsonObject
      val got = objectsChecksum(Fixtures.str(r["mod"]), dir = "/no-such-bf1942-install", bundled = Fixtures.bool(r["bundled"]) == true, warn = {})
      assertEquals(Fixtures.js(r), Fixtures.js(r["out"]), Js.stringify(got))
    }
  }
}

/** fs.writeFileSync of bytes (the fake installs the fixtures describe). */
private fun writeBytes(f: FsFile, b: ByteArray) =
  SystemFileSystem.sink(Path(f.path)).buffered().use { it.write(b) }
