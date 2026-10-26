# bfstats sidecar for Android

Pick a live bfstats.io server, and the app joins it through a Kotlin port of
the UDP sidecar (`tools/bf1942-models/sidecar`) and plays it in a WebView on
play.bfstats.io. Design and progress: `features/sidecar-android-app/README.md`.

- `core/`: the sidecar, Kotlin Multiplatform (no Android APIs): the JVM
  target the app uses, linuxX64 native here, and the iOS targets on a Mac.
  Every line of the port is in `commonMain`; `Platform.kt` is what a
  platform supplies.
- `app/`: the server list, the fullscreen WebView (`PlayActivity`) and the
  foreground service that runs one `Sidecar` per join.

## Open and build

Open this folder (`tools/sidecar-android`, not the repo root) in Android
Studio. It uses the SDK in `~/Android/Sdk` and installs anything missing.

From a shell:

```bash
./gradlew :core:jvmTest :core:linuxX64Test :app:assembleDebug
```

The first build downloads Gradle and a JDK 17 toolchain. The APK is
`app/build/outputs/apk/debug/app-debug.apk`; install it with
`~/Android/Sdk/platform-tools/adb install -r` on a phone with USB debugging on.
On a debug build, `chrome://inspect` on the PC attaches to the WebView.

The app's build needs the SDK's location: `ANDROID_HOME=~/Android/Sdk` or
`sdk.dir` in `local.properties` (git-ignored; Android Studio writes it).

## The sidecar on a PC

`./gradlew -q :core:sidecar --args="127.0.0.1:14568 --name kt --team 2 --ws 17942"`
runs the Kotlin sidecar on the JVM with `node sidecar/sidecar.mjs`'s
arguments, console lines and page socket. The same as a native binary, no
JVM needed: `./gradlew :core:linkSidecarReleaseExecutableLinuxX64`, then
`core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe` with the same
arguments. Either so it can stand in for Node in a lab run: open
`map.html?sidecar=127.0.0.1:17942`. Ctrl-C leaves cleanly. Arguments and
the facade the app uses: `features/sidecar-android-app/README.md`, "Wave 2".

## Parity and the live check

`parity/regen.sh` rebuilds every fixture from the Node sidecar and runs the
Kotlin tests against them (`features/sidecar-android-app/README.md`,
"Porting conventions"); `parity/lib/` holds the generators' shared helpers
and `parity/live/` the tools that run against the lab (not run by regen):
`udp-relay.mjs` records a join's datagrams both ways, `trim-capture.mjs`
cuts one for a fixture, `page-proof.cjs` plays the real map.html headless
through a sidecar. With the BF1942 lab up (UDP 14568),
`./gradlew -q :core:probe` sends a ServerInfoRequest, joins as a bf42++
client and leaves cleanly; `--args="HOST PORT --info-only"` only probes.

## Kotlin Multiplatform

What lives in which source set, the libraries, what replaced each JVM class
and how it is held to V8, and the iOS steps left:
`features/sidecar-android-app/README.md`, "Kotlin Multiplatform". The
resources under `core/resources` are compiled in as Kotlin
(`embedResources`); the tests read their fixtures from
`core/src/commonTest/resources/parity` on every target.
