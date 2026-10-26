package io.bfstats.sidecar

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

fun cacheDir(env: Map<String, String?> = System.getenv(), platform: String = nodePlatform(), home: String = System.getProperty("user.home")): String {
  env["SIDECAR_CACHE"]?.takeIf { it.isNotEmpty() }?.let { return it }
  if (win(platform)) return winJoin(env["LOCALAPPDATA"]?.takeIf { it.isNotEmpty() } ?: winJoin(home, "AppData", "Local"), "bfstats-sidecar", "cache")
  return posixJoin(home, ".cache", "bfstats-sidecar")
}

fun configDir(env: Map<String, String?> = System.getenv(), platform: String = nodePlatform(), home: String = System.getProperty("user.home")): String {
  if (win(platform)) return winJoin(env["APPDATA"]?.takeIf { it.isNotEmpty() } ?: winJoin(home, "AppData", "Roaming"), "bfstats-sidecar")
  return posixJoin(home, ".config", "bfstats-sidecar")
}

/** process.platform for this JVM. */
fun nodePlatform(): String {
  val os = System.getProperty("os.name").lowercase()
  return when {
    os.startsWith("windows") -> "win32"
    os.startsWith("mac") -> "darwin"
    else -> "linux"
  }
}
