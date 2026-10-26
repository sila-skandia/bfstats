package io.bfstats.sidecar

// Small pure-Kotlin stand-ins for the JVM classes the port used to lean on, so
// commonMain compiles for every target: latin1 and windows-1251 text, a byte
// buffer (ByteArrayOutputStream), files (java.io.File over kotlinx-io), a text
// writer, a lock, and ISO-8601 timestamps.

import kotlinx.atomicfu.locks.SynchronizedObject
import kotlinx.atomicfu.locks.synchronized
import kotlinx.io.buffered
import kotlinx.io.files.FileNotFoundException
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readByteArray
import kotlinx.io.writeString

// ---- text ---------------------------------------------------------------------

/** Bytes as latin1 (Buffer#toString('latin1'), String(b, ISO_8859_1)). */
fun latin1String(b: ByteArray, off: Int = 0, len: Int = b.size - off): String {
  val c = CharArray(len)
  for (i in 0 until len) c[i] = (b[off + i].toInt() and 0xff).toChar()
  return c.concatToString()
}

/** windows-1251 bytes 0x80..0xff (0x98 is unassigned: U+FFFD, as Java decodes it). */
private const val CP1251_HIGH =
  "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ" +
  "ђ‘’“”•–—�™љ›њќћџ" +
  " ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї" +
  "°±Ііґµ¶·ё№є»јЅѕї"

/** Bytes as windows-1251 text. */
fun cp1251String(b: ByteArray): String {
  val c = CharArray(b.size)
  for (i in b.indices) {
    val u = b[i].toInt() and 0xff
    c[i] = when {
      u < 0x80 -> u.toChar()
      u < 0xc0 -> CP1251_HIGH[u - 0x80]
      else -> (0x410 + (u - 0xc0)).toChar() // А..я
    }
  }
  return c.concatToString()
}

/** Character.digit(c, 16). */
fun hexDigit(c: Char): Int = when (c) {
  in '0'..'9' -> c - '0'
  in 'a'..'f' -> c - 'a' + 10
  in 'A'..'F' -> c - 'A' + 10
  else -> -1
}

/** A growing byte array (ByteArrayOutputStream). */
class ByteSink(initial: Int = 64) {
  private var buf = ByteArray(maxOf(initial, 16))
  var size = 0; private set
  fun write(b: Int) { ensure(1); buf[size++] = b.toByte() }
  fun write(b: ByteArray, off: Int = 0, len: Int = b.size - off) { ensure(len); b.copyInto(buf, size, off, off + len); size += len }
  private fun ensure(n: Int) { if (size + n > buf.size) buf = buf.copyOf(maxOf(buf.size * 2, size + n)) }
  fun toByteArray(): ByteArray = buf.copyOf(size)
}

// ---- a lock -------------------------------------------------------------------------

/** A lock for the few tables shared between the loop and background work
 *  (the JVM's synchronized blocks). */
class Lock : SynchronizedObject() {
  inline fun <T> withLock(block: () -> T): T = synchronized(this) { block() }
}

/** CountDownLatch(1), waited on by polling (the one use waits on a post to
 *  the loop, a few ms at most). */
class Latch {
  @kotlin.concurrent.Volatile private var done = false
  fun countDown() { done = true }
  /** Whether it was counted down within `timeoutMs`. */
  fun await(timeoutMs: Long): Boolean {
    val until = monoNanos() + timeoutMs * 1_000_000
    while (!done) {
      if (monoNanos() >= until) return false
      sleepMs(1)
    }
    return true
  }
}

// ---- files ----------------------------------------------------------------------------

/** The part of java.io.File the port uses, over kotlinx-io. Paths join with '/'. */
class FsFile(val path: String) {
  constructor(parent: FsFile, child: String) : this(join(parent.path, child))
  constructor(parent: String, child: String) : this(join(parent, child))

  private val p get() = Path(path)
  val name: String get() = path.trimEnd('/').substringAfterLast('/')
  val parentFile: FsFile? get() {
    val t = path.trimEnd('/')
    val i = t.lastIndexOf('/')
    return when { i > 0 -> FsFile(t.substring(0, i)); i == 0 -> FsFile("/"); else -> null }
  }
  val absolutePath: String get() = if (path.startsWith("/")) path else join(cwd(), path)
  val absoluteFile: FsFile get() = FsFile(absolutePath)
  val isDirectory: Boolean get() = SystemFileSystem.metadataOrNull(p)?.isDirectory == true

  fun exists(): Boolean = SystemFileSystem.exists(p)
  /** The size in bytes (0 when it is not there). */
  fun length(): Long = SystemFileSystem.metadataOrNull(p)?.size ?: 0L
  /** The modification time in epoch ms (0 when unknown). */
  fun lastModified(): Long = fileMtimeMs(path) ?: 0L
  fun readBytes(): ByteArray = SystemFileSystem.source(p).buffered().use { it.readByteArray() }
  fun readText(): String = readBytes().decodeToString()
  fun writeText(s: String) = SystemFileSystem.sink(p).buffered().use { it.writeString(s) }
  fun mkdirs(): Boolean = try { SystemFileSystem.createDirectories(p); true } catch (e: Exception) { false }
  fun delete(): Boolean = try { SystemFileSystem.delete(p, mustExist = true); true } catch (e: Exception) { false }
  fun renameTo(dest: FsFile): Boolean = try { SystemFileSystem.atomicMove(p, dest.p); true } catch (e: Exception) { false }
  /** The names in this folder, or null when it is not one. */
  fun list(): List<String>? = try { SystemFileSystem.list(p).map { it.name } } catch (e: Exception) { null }

  override fun toString() = path
  override fun equals(other: Any?) = other is FsFile && other.path == path
  override fun hashCode() = path.hashCode()

  companion object {
    fun join(a: String, b: String) = if (a.isEmpty()) b else if (a.endsWith("/")) a + b else "$a/$b"
    private fun cwd(): String = try { SystemFileSystem.resolve(Path(".")).toString() } catch (e: Exception) { "." }
    /** Whether `e` says the file is not there. */
    fun isNotFound(e: Throwable) = e is FileNotFoundException
  }
}

/** A text file written as UTF-8 through a buffer (fs.createWriteStream,
 *  Files.newBufferedWriter). */
interface TextSink {
  fun write(s: String)
  fun flush()
  fun close()
}

/** A UTF-8 file sink: the folder is made, the file truncated. */
fun fileTextSink(path: String): TextSink {
  FsFile(path).absoluteFile.parentFile?.mkdirs()
  val sink = SystemFileSystem.sink(Path(path)).buffered()
  return object : TextSink {
    override fun write(s: String) = sink.writeString(s)
    override fun flush() = sink.flush()
    override fun close() = sink.close()
  }
}

/** A TextSink into memory (StringWriter), for tests. */
class StringSink : TextSink {
  private val sb = StringBuilder()
  override fun write(s: String) { sb.append(s) }
  override fun flush() {}
  override fun close() {}
  override fun toString() = sb.toString()
}

// ---- time -------------------------------------------------------------------------------

/** Days since 1970-01-01 to (year, month, day), proleptic Gregorian
 *  (Howard Hinnant's civil_from_days). */
private fun civil(days: Long): Triple<Long, Int, Int> {
  val z = days + 719468
  val era = (if (z >= 0) z else z - 146096) / 146097
  val doe = z - era * 146097
  val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  val y = yoe + era * 400
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
  val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
  return Triple(if (m <= 2) y + 1 else y, m, d)
}

private fun p2(n: Int) = n.toString().padStart(2, '0')

/** UTC fields of an epoch ms: year, month, day, hour, minute, second, ms. */
private fun utc(ms: Long): IntArray {
  val days = ms.floorDiv(86_400_000L)
  val rem = ms - days * 86_400_000L
  val (y, mo, d) = civil(days)
  return intArrayOf(y.toInt(), mo, d, (rem / 3_600_000).toInt(), (rem / 60_000 % 60).toInt(), (rem / 1000 % 60).toInt(), (rem % 1000).toInt())
}

/** Date#toISOString: 2026-10-26T04:05:06.789Z. */
fun isoString(ms: Long): String {
  val f = utc(ms)
  return "${f[0].toString().padStart(4, '0')}-${p2(f[1])}-${p2(f[2])}T${p2(f[3])}:${p2(f[4])}:${p2(f[5])}.${f[6].toString().padStart(3, '0')}Z"
}

/** yyyy-MM-dd-HH-mm-ss in UTC (sidecar.mjs's default recording name). */
fun fileStamp(ms: Long): String {
  val f = utc(ms)
  return "${f[0].toString().padStart(4, '0')}-${p2(f[1])}-${p2(f[2])}-${p2(f[3])}-${p2(f[4])}-${p2(f[5])}"
}
