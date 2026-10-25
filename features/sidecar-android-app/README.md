# Sidecar Android app: join real servers from a phone

The desktop tray app (`features/sidecar-desktop-app`) runs the Node sidecar
beside the browser. This folder covers the same idea on Android: pick a live
server in the app, and the game page plays it through a sidecar the app runs.

Not public. It stays private until testing is done, as desktop does.

## Decisions (2026-10-26)

- **The page runs in an in-app WebView**, not in Chrome. The app hosts both
  the sidecar and the page, so Android does not kill the sidecar while the
  game is in front, there is no Chrome local network access prompt, and the
  page gets fullscreen landscape. The WebView loads `https://play.bfstats.io`
  (`map.html?sidecar=127.0.0.1:<port>`, as desktop builds it), so viewer fixes
  reach the app without a new build.
- **The sidecar is ported to Kotlin**, not embedded Node. The port has to stay
  in step with the Node sidecar (`tools/bf1942-models/sidecar`); how that is
  enforced is open, below. Moving desktop onto the Kotlin core as well is
  acceptable if desktop install stays as simple as it is now (one AppImage or
  NSIS installer, no JVM for the user to install).
- **First version: an in-app server list.** Browse the bfstats.io live list
  (`/stats/LiveServers/bf1942/servers`), tap to join. Site links, sign-in and
  profiles, logs and settings come later.
- **Sideloaded APK on the owner's phone.** The SDK is the one Android Studio
  installs (`~/Android/Sdk`), so the IDE and command-line builds share it.
- **Order is free.** The goal is a proof that the sidecar joins a real server
  from a phone; take the steps in whatever order proves it.
- **Code lives in `tools/sidecar-android`**, beside `tools/sidecar-desktop`.

## Open

- How the two implementations are kept in sync. Proposed: golden transcripts
  recorded from the Node sidecar on the lab (every datagram in, every WebSocket
  frame and datagram out, with times), replayed into the Kotlin core in a JVM
  test that requires identical output.
- Whether desktop moves to the Kotlin core (a native binary the Electron app
  spawns in place of Node).

## Tasks

- [x] Android SDK on this PC (`~/Android/Sdk`: platform 37.0, build-tools
      36 and 37, platform-tools; AGP 9.4.1, Gradle 9.8.2, Kotlin 2.4.21)
- [x] `tools/sidecar-android` Gradle project: `core` (pure JVM, no Android
      APIs) and `app`; opens in Android Studio
- [x] App shell: server list, tap to join, foreground service, fullscreen
      WebView on play.bfstats.io; `core` hosts the page socket (`WsServer`,
      a port of `wsserver.mjs`) and logs what the page sends
- [ ] The shell on a phone: the page opens the socket from the WebView
- [ ] Kotlin core: handshake and join on the lab
- [ ] Kotlin core: events and ghost streams to the page
- [ ] Kotlin core: input from the page
- [ ] A join from the phone to the lab, played in the WebView
