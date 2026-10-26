package io.bfstats.sidecar

// gunzip through the platform's zlib (Linux and Apple both ship it).

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.UByteVar
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.sizeOf
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.addressOf
import platform.zlib.Z_NO_FLUSH
import platform.zlib.Z_OK
import platform.zlib.Z_STREAM_END
import platform.zlib.ZLIB_VERSION
import platform.zlib.inflate
import platform.zlib.inflateEnd
import platform.zlib.inflateInit2_
import platform.zlib.z_stream

@OptIn(ExperimentalForeignApi::class)
actual fun gunzip(b: ByteArray): ByteArray = memScoped {
  val z = alloc<z_stream>()
  // 16 + 15: a gzip wrapper.
  check(inflateInit2_(z.ptr, 16 + 15, ZLIB_VERSION, sizeOf<z_stream>().convert()) == Z_OK) { "inflateInit2 failed" }
  val out = ByteSink(b.size * 4)
  val chunk = ByteArray(1 shl 16)
  try {
    b.usePinned { src ->
      z.next_in = src.addressOf(0).reinterpret<UByteVar>()
      z.avail_in = b.size.convert()
      while (true) {
        val r = chunk.usePinned { dst ->
          z.next_out = dst.addressOf(0).reinterpret<UByteVar>()
          z.avail_out = chunk.size.convert()
          inflate(z.ptr, Z_NO_FLUSH)
        }
        val produced = chunk.size - z.avail_out.toInt()
        out.write(chunk, 0, produced)
        if (r == Z_STREAM_END) break
        check(r == Z_OK) { "inflate failed ($r)" }
        if (produced == 0 && z.avail_in.toInt() == 0) break
      }
    }
  } finally {
    inflateEnd(z.ptr)
  }
  out.toByteArray()
}

actual val testTarget: String = "native"
