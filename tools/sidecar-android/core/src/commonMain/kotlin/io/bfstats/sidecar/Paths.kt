package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/paths.mjs; keep in step. Two halves,
// one per wave-1 port: the top-level cacheDir/configDir the wire layer uses
// (every input a parameter), and the `Paths` object the decoders use (host
// overrides for the cache and the install, the Python probe stub).

import kotlin.concurrent.Volatile

// Port of the part of tools/bf1942-models/sidecar/paths.mjs the wire layer
// needs (cacheDir, configDir); keep in step.
//
// Where the sidecar keeps things, per platform:
//
//                  Linux (and macOS)                    Windows
//   cache          ~/.cache/bfstats-sidecar             %LOCALAPPDATA%\bfstats-sidecar\cache
//   config         ~/.config/bfstats-sidecar            %APPDATA%\bfstats-sidecar
//
// SIDECAR_CACHE overrides the cache. Every input (env, platform, home) is a
// parameter: on Android the app passes its own files dir as `home`, or hands
// cdKeyStore its key file directly (CdKey.kt).
//
// Not ported: defaultGameDirs / gameDir (Android has no game install; the
// CRC lookups use their bundled tables) and pythonAvailable (no Python).
// path.win32.join's normalisation is not ported either: a Windows path is
// joined with '\' as given.

private fun win(platform: String) = platform == "win32"
private fun winJoin(vararg p: String) = p.joinToString("\\")
private fun posixJoin(vararg p: String) = p.joinToString("/")

fun cacheDir(env: Map<String, String?> = systemEnv(), platform: String = nodePlatform(), home: String = userHome()): String {
  env["SIDECAR_CACHE"]?.takeIf { it.isNotEmpty() }?.let { return it }
  if (win(platform)) return winJoin(env["LOCALAPPDATA"]?.takeIf { it.isNotEmpty() } ?: winJoin(home, "AppData", "Local"), "bfstats-sidecar", "cache")
  return posixJoin(home, ".cache", "bfstats-sidecar")
}

fun configDir(env: Map<String, String?> = systemEnv(), platform: String = nodePlatform(), home: String = userHome()): String {
  if (win(platform)) return winJoin(env["APPDATA"]?.takeIf { it.isNotEmpty() } ?: winJoin(home, "AppData", "Roaming"), "bfstats-sidecar")
  return posixJoin(home, ".config", "bfstats-sidecar")
}

// process.platform: nodePlatform() (Platform.kt).

// ---- the decoders' half ----

object Paths {
  /** Set by the host (the Android app passes its cache folder); wins over the environment. */
  @Volatile var cacheDirOverride: FsFile? = null
  /** Set by the host when it found an install; null means "look where Node looks". */
  @Volatile var gameDirOverride: FsFile? = null
  /** Whether to look for an install at all (false on Android). */
  @Volatile var lookForInstall: Boolean = true
  /** The environment the defaults read (a test swaps it). */
  @Volatile var env: Map<String, String> = systemEnv()

  private val win get() = nodePlatform() == "win32"
  private val home get() = userHome()

  fun cacheDir(): FsFile {
    cacheDirOverride?.let { return it }
    env["SIDECAR_CACHE"]?.takeIf { it.isNotEmpty() }?.let { return FsFile(it) }
    if (win) return FsFile(FsFile(env["LOCALAPPDATA"] ?: FsFile(home, "AppData\\Local").path, "bfstats-sidecar"), "cache")
    return FsFile(FsFile(home, ".cache"), "bfstats-sidecar")
  }

  /** The install folders tried when BF1942_DIR is not set, in order. */
  fun defaultGameDirs(): List<FsFile> {
    if (win) {
      val pf86 = env["ProgramFiles(x86)"] ?: "C:\\Program Files (x86)"
      val pf = env["ProgramFiles"] ?: "C:\\Program Files"
      return listOf(FsFile(pf86, "EA Games\\Battlefield 1942"), FsFile(pf86, "Origin Games\\Battlefield 1942"),
        FsFile(pf, "EA Games\\Battlefield 1942"), FsFile("C:\\EA Games\\Battlefield 1942"))
    }
    return listOf(FsFile(FsFile(FsFile(FsFile(env["WINEPREFIX"] ?: FsFile(home, ".wine").path), "drive_c"), "EA Games"), "Battlefield 1942"))
  }

  /** BF1942_DIR, else the first default folder that exists, else the first
   *  default; null when the host says there is no install to look for. */
  fun gameDir(): FsFile? {
    gameDirOverride?.let { return it }
    if (!lookForInstall) return null
    env["BF1942_DIR"]?.takeIf { it.isNotEmpty() }?.let { return FsFile(it) }
    val dirs = defaultGameDirs()
    return dirs.firstOrNull { try { it.exists() } catch (e: Exception) { false } } ?: dirs[0]
  }

  class PythonProbe(val ok: Boolean, val python: String, val why: String)

  /** STUB. Node's pythonAvailable runs `python3 -c ...` to see whether the
   *  install's tables can be computed. The port never runs the install's
   *  Python helpers (bf42/template_table.py, game_tables.py): it answers no,
   *  so an install, if there is one, falls to its cached tables or the
   *  published bake, as a Node sidecar without Python does. */
  fun pythonAvailable(): PythonProbe = PythonProbe(false, env["SIDECAR_PYTHON"] ?: if (win) "python" else "python3", "the Kotlin sidecar does not run Python")
}
