# Sidecar iOS app: bfstats.io for iPhone

The iPhone version of the bfstats.io companion app
(`features/sidecar-android-app`): the live server list, who is on a server,
and joining it through the Kotlin sidecar to play on play.bfstats.io in an
in-app web view. Code: `tools/sidecar-ios` (its README has the layout, the
build and the owner's signing steps).

Not public. It stays private until testing is done, as Android and desktop do.

## Decisions (2026-10-28)

- **Built only in CI.** Owner: "I don't like publishing apps that I build
  locally." There is no Mac: GitHub's macOS runners (`macos-26`, the newest
  release Xcode on the image) build, test and ship every build
  (`.github/workflows/sidecar-ios.yml`). The Xcode project is generated from
  `tools/sidecar-ios/project.yml` with XcodeGen in CI; no `.pbxproj` is in git.
- **Same identity as Android.** Bundle ID `io.bfstats.app`, display name
  "bfstats.io", iPhone only (`TARGETED_DEVICE_FAMILY` 1), iOS 16+.
- **SwiftUI shell, Kotlin core.** The core
  (`tools/sidecar-android/core`) is built by Gradle as the static
  `SidecarCore.xcframework` (iosArm64 + iosSimulatorArm64). Swift sees a
  small face on it, `iosMain/.../ios/Phone.kt`: `PhoneCore` (the live list,
  one server, `decodeName`, `mapImageUrl`, address and name checks, the play
  URL, the round clock words) and `PhoneSession` (one join: `start`, `leave`,
  `stop`, and the page bridge). Every call that can throw is `@Throws`, so
  Swift sees `throws` rather than a crash. The screens copy the core's data
  into Swift structs (`Model.swift`), so views never hold Kotlin objects.
- **The same look.** The tray panel's Neutral Depth tokens, Geist and Geist
  Mono (variable, set on their `wght` axis; OFL bundled), the panel's line
  icons from the same SVG paths, olive headline tickets, the country flag in
  list rows only, names decoded for display only. The screens are the
  Android app's: list, server, join by address, the session bar, the game.
- **Play** is a fullscreen, landscape `WKWebView` on
  `https://play.bfstats.io/map.html?sidecar=127.0.0.1:<port>&server=...`,
  status bar and home indicator hidden; a faint corner button returns to the
  list with the join still up (Leave is in the session bar, as on Android).
  The game opens by itself once the page socket is up, once per join.
- **Files.** The CD key file (a per-install player identity) is in
  Application Support/sidecar, the level tables in Caches/sidecar.
- **Background.** iOS suspends a backgrounded app's sockets, so a join runs
  only while the app is in front. Going to the background starts a
  background task and leaves the server cleanly (three Disconnects) after
  15 s unless the app comes back first; iOS's expiry handler leaves at once.
  There is no foreground service equivalent, and none is wanted: the game is
  only played on screen.
- **Info.plist.** `ITSAppUsesNonExemptEncryption` NO (HTTPS only: exempt, no
  export question per upload); `NSLocalNetworkUsageDescription` (joining a
  LAN server such as the lab asks for Local Network access; internet servers
  and 127.0.0.1 do not); ATS `NSAllowsLocalNetworking`.
- **Icon.** `scripts/make-icon.py` puts the site's sigil
  (`ui/src/assets/clippy_my_boi.webp`, 256 px, the only source in the repo)
  on the Neutral Depth ground at 1024 px. It is a Lanczos upscale; a larger
  source would make it sharper.

## The page socket: WKWebView blocks ws://127.0.0.1 from an https page

The open question from `features/sidecar-android-app` ("Apple"): does
WKWebView let https://play.bfstats.io open `ws://127.0.0.1:<port>`?

**No.** Measured in the iOS Simulator on the GitHub runner (iOS 26, Xcode 26,
runs 40612209962 and 40614703159, artifacts `sidecar-ios-smoke-2` and `-3`):
with the page's own WebSocket (`direct`), the socket fails with an error
event and close 1006 10 to 13 ms after the page creates it, and the sidecar
never sees a TCP connection on its page port (no "page connected", no Origin
refusal), nor does WebKit's networking process log one: WebKit refuses it in
the page, as mixed content (an insecure ws:// from an https document), before
any connection is tried. Android's WebView allows
the same URL (with `MIXED_CONTENT_COMPATIBILITY_MODE`), and so do desktop
browsers, which treat loopback as potentially trustworthy.

So the app carries the page's frames itself, and the page is none the wiser:

- `App/Resources/socket-bridge.js`, injected at document start, replaces
  `window.WebSocket` for loopback URLs only (every other URL gets the real
  one) with a stand-in that has everything `net-sidecar.js` uses
  (`onopen`/`onmessage`/`onerror`/`onclose`, `addEventListener`,
  `readyState`, `binaryType`, `send`, `close`). Page frames go to the app
  through `webkit.messageHandlers.bfstatsSocket` (text as text, binary as
  base64); the sidecar's frames come back through `evaluateJavaScript`,
  batched once per run loop turn per socket.
- In the core, `BridgedPageHub` (commonMain, `BridgedPageHubTest`) is a
  `PageHub` that is not a socket: a bridged page is a `PageSocket` like a
  WebSocket one, handed over on the loop with its frames queued behind it.
  The real `WsPageHub` listens beside it, so either kind of page can join.
  This is the `SidecarHost.pageHub` seam; the Node sidecar has no bridge, so
  there is no parity fixture for it.
- The handler serves only the main frame of a bfstats.io page. A navigation
  (the page reloads itself onto the server's level on join) closes the old
  document's bridged sockets, as a reload closes a real one.
- **Switchable.** `auto` (the default) tries the page's own socket and falls
  back to the bridge on an error, a close or 4 s with no answer; `direct` and
  `bridge` force one way. The switch is on the join-by-address screen ("Page
  socket"), stored in UserDefaults `socketMode`. `auto` keeps working
  unchanged if a later WebKit allows the direct socket.

Evidence from the same runs, the real page against a stand-in server on
127.0.0.1:

| page socket | used | opened | sidecar frames reached the page |
|---|---|---|---|
| direct | none | no (error, 1006) | no |
| bridge | bridge | yes | yes |
| auto | bridge (direct failed after 13 ms) | yes | yes |

In the bridged runs the sidecar logged `page connected (1 open)` and `page
joined` (the page's own join frame, sent through the bridge), and the page
drew "Connecting to Smoke test server". The same runs show the rest of the
core working on iOS: the pre-join GameSpy query, Wake's level tables
downloaded over HTTPS through ktor's Darwin engine ("tables from download in
2505 ms"), the ConnectRequest and ConnectAcceptAck through the POSIX UDP
socket.

## CI

`.github/workflows/sidecar-ios.yml`, on pushes to main touching the app,
the core or the workflow, `sidecar-ios-v*` tags, and `workflow_dispatch`:

| job | what |
|---|---|
| Core tests (iOS simulator) | `:core:iosSimulatorArm64Test`: every parity test on the simulator |
| App | the XCFramework (cached by a hash of the core's sources), the bridge script's Node test, `xcodegen generate`, `xcodebuild test` (unit tests) on an iPhone simulator, `scripts/simulator-smoke.sh` (screenshots of the three screens against the live list; a join per page socket against `scripts/stand-in-server.mjs`; never a real game server), then with the secrets a signed Release archive and its `.ipa`, and on a tag the TestFlight upload |
| release (tags) | the `.ipa` on a draft GitHub release |

Signing is automatic through the App Store Connect API key
(`xcodebuild -allowProvisioningUpdates -authenticationKeyPath/-ID/-IssuerID`);
the build number is the run number, the version the tag's; export is
`method app-store-connect`; the upload is `xcrun altool --upload-app` with
the same key. The owner's one-time setup (the App Store Connect app record,
the Team API key with the App Manager role, the four secrets set with `gh
secret set` from files) is in `tools/sidecar-ios/README.md`.

## What the first iOS runs found in the core

The core had never been compiled for Apple targets. It compiled as it was
(`nativeMain`'s POSIX sockets, ktor Darwin, zlib), and the simulator run
found three things, fixed:

- `fileMtimeMs` answered null on iOS by design ("no game install"), so the
  level-table cache keys and the stand-in installs of `ContentCrcTest`,
  `ObjectsChecksumTest` and `TablesTest.installCaches` behaved differently
  from Node. iOS now reads `st_mtimespec` as Linux reads `st_mtim`.
- `JsOpsTest.sinAndCosAsV8` compared NaN bits: x86 makes `sin(Infinity)` a
  negative NaN, ARM the positive default one, and no JS or sidecar output can
  tell them apart. The test now counts any NaN as NaN.
- `SchedulerTest.intervalAfterAStall` (real threads and sleeps) timed its
  window from the test's start, and on a busy runner's simulator the loop
  thread began the 150 ms stall late, so no tick had run by 185 ms. It now
  times from the stall's end (a latch) and checks what it is about: a run
  after the stall, every run a period after the last, never the missed
  ticks back to back.

## Store screenshots (2026-10-29)

App Store Connect takes exact pixel sizes per display class; only the 6.9"
class (1320 x 2868, or 2868 x 1320 landscape) is required, and the store
scales it down for the 6.3" and 6.1" slots. There is no iPhone here, so every
shot comes from the simulator or the browser:

- **The screens** (list, server, join by address): CI,
  `tools/sidecar-ios/scripts/store-screenshots.sh`, artifact
  `sidecar-ios-store-screenshots-<run>`, in `6.9/` (iPhone Pro Max) and `6.3/`
  (iPhone Pro). The smoke test's own shots are not store-clean: a fresh
  simulator posts a "Ready for Apple Intelligence" banner over the first app
  it opens (run 40678577191 caught it over the list), and the status bar
  shows the runner's clock. The store script takes a throwaway launch first,
  overrides the status bar to 9:41, and fills in a player name so Join is lit.
- **In game:** CI never joins a game server, and the smoke test's play shots
  are the loading screen. The game screen is the play.bfstats.io page full
  screen with no status bar, so the browser at the iPhone's landscape
  viewport (956 x 440 and 874 x 402 points, device scale 3) is the same
  picture. `tools/sidecar-ios/scripts/store-game-shots.mjs` renders Wake
  Island from this checkout with 12 local bots (no server, no real players)
  and stages each shot through the test hooks; its header has the recipe. The
  output is `store/screenshots/{6.9,6.3}/4-6-*.png` (rifle in the village,
  bazooka on the landing beach, the Sherman in chase view). Every friendly
  bot is moved to South Base first: a friendly in the line of fire puts a
  blue nametag over the target. The bots are live, so look at every image
  after a run. Not got: a landing craft on the beach (ten minutes of AI
  sailing) and a plane in flight (the touch throttle latch overrides a set
  throttle).
- **Layout found at iPhone size, fixed on the page (2026-10-29):** MORE sat
  on the stance figure, PREV on the weapon box, SEAT -/+ on the tank's look
  stick and ammo box, and at 6.3" the mid-right JUMP covered the capture ring
  (which also sat on the tank's FIRE). MORE is gone (the minimap is the map
  button, SPAWN sits at its edge, PICKUP is a contextual pill, VIEW shows on
  foot); the rings and the corner pair now ride the HUD's bottom band, JUMP
  sits over FIRE, and seated FIRE/ALT and SEAT -/+ moved inboard of the
  ring's column. Shots 4-6 were re-rendered after the fix with no control on
  the HUD's paint (features/mobile-four-finger-controls, "The twentieth
  pass").

## Open

- The parity fixtures on main predate the Node change e6227638 (a remote
  vehicle's round from the launch frame): `JoinTest`, `SidecarTest`,
  `TablesTest.prepareLevelAgainstAStandIn` (the table version hash moved),
  `ResourcesDriftTest` and `SidecarCapturesTest` fail on the JVM, linuxX64
  and iOS alike until the port and `parity/regen.sh` catch up. The iOS core
  job is red for that reason only.
- The page's connect screen says "press Escape to cancel"; a phone has no
  Escape. The viewer's touch controls and on-screen hints are the page's
  work (play.bfstats.io), not the app's.
- iPad: not targeted yet (the app runs in iPhone compatibility there).

## First TestFlight build (2026-10-28)

`sidecar-ios-v0.1.0` (build 12, from `01351a68`) signed and uploaded to
TestFlight from GitHub Actions run 40678577191: export succeeded, "UPLOAD
SUCCEEDED with no errors", delivery `79e9f3c9-a9c3-478a-9f83-34e3bdd040a6`;
the `.ipa` is on the draft GitHub release. Two fixes on the way:

- The archive is built unsigned and signed at export: an automatically signed
  archive asks for a development profile, which Apple issues only once a
  device is registered.
- Cloud-managed signing needs an App Store Connect key with the Admin role;
  App Manager failed with "Cloud signing permission error". The secrets hold
  the Admin key (`VBL2L8VDQL`).
