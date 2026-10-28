package io.bfstats.sidecar

import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import platform.posix.stat

// A file's mtime from stat, as on Linux (Stat.linux.kt); Darwin names the
// field st_mtimespec. An iPhone has no game install to fingerprint, but the
// level tables' cache keys and the tests' stand-in installs go through here
// just the same, so it answers as Node would rather than "unknown".
actual fun fileMtimeMs(path: String): Long? = memScoped {
  val st = alloc<stat>()
  if (stat(path, st.ptr) != 0) null
  else st.st_mtimespec.tv_sec * 1000L + st.st_mtimespec.tv_nsec / 1_000_000L
}

actual fun fileMtimeMsExact(path: String): Double? = memScoped {
  val st = alloc<stat>()
  if (stat(path, st.ptr) != 0) null
  else mtimeMsOf(st.st_mtimespec.tv_sec, st.st_mtimespec.tv_nsec)
}
