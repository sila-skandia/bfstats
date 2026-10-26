package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/paths.mjs, as far as the decoders need
// it (cacheDir, gameDir, the Python probe); keep in step.
//
// Where the sidecar keeps things and finds the game, per platform.
//
//                  Linux (and macOS)                    Windows
//   cache          ~/.cache/bfstats-sidecar             %LOCALAPPDATA%\bfstats-sidecar\cache
//   game install   ~/.wine/drive_c/EA Games/...         the default install folders
//
// SIDECAR_CACHE and BF1942_DIR override each one, as in Node. On Android there
// is no environment to speak of and no install: the app sets `cacheDir` to its
// own cache folder (Context.getCacheDir) and leaves `gameDir` unset, so every
// level table comes from the published bake (LevelTables.prepareLevel).

import java.io.File

object Paths {
  /** Set by the host (the Android app passes its cache folder); wins over the environment. */
  @Volatile var cacheDirOverride: File? = null
  /** Set by the host when it found an install; null means "look where Node looks". */
  @Volatile var gameDirOverride: File? = null
  /** Whether to look for an install at all (false on Android). */
  @Volatile var lookForInstall: Boolean = true
  /** The environment the defaults read (a test swaps it). */
  @Volatile var env: Map<String, String> = System.getenv()

  private val win get() = System.getProperty("os.name").orEmpty().lowercase().startsWith("windows")
  private val home get() = System.getProperty("user.home").orEmpty()

  fun cacheDir(): File {
    cacheDirOverride?.let { return it }
    env["SIDECAR_CACHE"]?.takeIf { it.isNotEmpty() }?.let { return File(it) }
    if (win) return File(File(env["LOCALAPPDATA"] ?: File(home, "AppData\\Local").path, "bfstats-sidecar"), "cache")
    return File(File(home, ".cache"), "bfstats-sidecar")
  }

  /** The install folders tried when BF1942_DIR is not set, in order. */
  fun defaultGameDirs(): List<File> {
    if (win) {
      val pf86 = env["ProgramFiles(x86)"] ?: "C:\\Program Files (x86)"
      val pf = env["ProgramFiles"] ?: "C:\\Program Files"
      return listOf(File(pf86, "EA Games\\Battlefield 1942"), File(pf86, "Origin Games\\Battlefield 1942"),
        File(pf, "EA Games\\Battlefield 1942"), File("C:\\EA Games\\Battlefield 1942"))
    }
    return listOf(File(File(File(File(env["WINEPREFIX"] ?: File(home, ".wine").path), "drive_c"), "EA Games"), "Battlefield 1942"))
  }

  /** BF1942_DIR, else the first default folder that exists, else the first
   *  default; null when the host says there is no install to look for. */
  fun gameDir(): File? {
    gameDirOverride?.let { return it }
    if (!lookForInstall) return null
    env["BF1942_DIR"]?.takeIf { it.isNotEmpty() }?.let { return File(it) }
    val dirs = defaultGameDirs()
    return dirs.firstOrNull { try { it.exists() } catch (e: SecurityException) { false } } ?: dirs[0]
  }

  class PythonProbe(val ok: Boolean, val python: String, val why: String)

  /** STUB. Node's pythonAvailable runs `python3 -c ...` to see whether the
   *  install's tables can be computed. The port never runs the install's
   *  Python helpers (bf42/template_table.py, game_tables.py): it answers no,
   *  so an install, if there is one, falls to its cached tables or the
   *  published bake, as a Node sidecar without Python does. */
  fun pythonAvailable(): PythonProbe = PythonProbe(false, env["SIDECAR_PYTHON"] ?: if (win) "python" else "python3", "the Kotlin sidecar does not run Python")
}
