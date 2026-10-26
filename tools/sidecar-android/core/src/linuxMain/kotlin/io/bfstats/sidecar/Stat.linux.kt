package io.bfstats.sidecar

import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import platform.posix.stat

actual fun fileMtimeMs(path: String): Long? = memScoped {
  val st = alloc<stat>()
  if (stat(path, st.ptr) != 0) null
  else st.st_mtim.tv_sec * 1000L + st.st_mtim.tv_nsec / 1_000_000L
}

actual fun fileMtimeMsExact(path: String): Double? = memScoped {
  val st = alloc<stat>()
  if (stat(path, st.ptr) != 0) null
  else mtimeMsOf(st.st_mtim.tv_sec, st.st_mtim.tv_nsec)
}
