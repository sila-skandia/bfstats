# bfstats sidecar for Android

Pick a live bfstats.io server, and the app joins it through a Kotlin port of
the UDP sidecar (`tools/bf1942-models/sidecar`) and plays it in a WebView on
play.bfstats.io. Design and progress: `features/sidecar-android-app/README.md`.

- `core/`: the sidecar, plain JVM (no Android APIs), with JUnit tests.
- `app/`: the server list, the fullscreen WebView (`PlayActivity`) and the
  foreground service that runs one `Sidecar` per join.

## Open and build

Open this folder (`tools/sidecar-android`, not the repo root) in Android
Studio. It uses the SDK in `~/Android/Sdk` and installs anything missing.

From a shell:

```bash
./gradlew :core:test :app:assembleDebug
```

The first build downloads Gradle and a JDK 17 toolchain. The APK is
`app/build/outputs/apk/debug/app-debug.apk`; install it with
`~/Android/Sdk/platform-tools/adb install -r` on a phone with USB debugging on.
On a debug build, `chrome://inspect` on the PC attaches to the WebView.
