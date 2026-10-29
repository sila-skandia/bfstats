# bfstats.io for iPhone

The bfstats.io companion app for iPhone (`io.bfstats.app`, iOS 16+): the live
server list, who is on a server, and joining it, through the same Kotlin
sidecar as the Android app (`tools/sidecar-android/core`), to play on
play.bfstats.io in a fullscreen WKWebView. Design, decisions and the page
socket finding: `features/sidecar-ios-app/README.md`.

It is built, tested and shipped only by GitHub Actions on GitHub's macOS
runners (`.github/workflows/sidecar-ios.yml`). There is no Xcode project in
git: CI generates one from `project.yml` with XcodeGen.

## Layout

- `project.yml`: the Xcode project (XcodeGen): the app target `BfstatsIO`
  (display name "bfstats.io"), its unit tests, the Info.plist keys.
- `App/Sources/`: SwiftUI. `BfstatsApp.swift` (the navigation stack, the game
  cover, the background grace, the CI smoke hooks), `ServersView.swift` (the
  list and the session bar), `ServerView.swift` (one server, its players, the
  join bar), `JoinAddressView.swift` (join by `host[:port]`, and the page
  socket switch), `PlayView.swift` (the WKWebView and its bridge),
  `Session.swift` (one `PhoneSession` per join), `Model.swift` (the list and a
  server, as Swift values), `Theme.swift`, `Components.swift`, `Icons.swift`
  (the tray panel's look, as `ui/` in the Android app).
- `App/Resources/`: `socket-bridge.js` (the page's WebSocket stand-in), the
  Geist fonts and their OFL licence.
- `App/Assets.xcassets/`: the icon (`scripts/make-icon.py` makes it from the
  site's logo), the header logo, the launch colour.
- `Tests/`: XCTest of the Swift side and of the core as Swift sees it.
- `scripts/`: `test-socket-bridge.mjs` (the stand-in under Node),
  `stand-in-server.mjs` and `simulator-smoke.sh` (the CI smoke test),
  `store-screenshots.sh` (App Store screenshots of the screens),
  `make-icon.py`.

The Kotlin side is `tools/sidecar-android/core`: Gradle builds it as the
static `SidecarCore.xcframework`, and Swift calls `PhoneCore` and
`PhoneSession` (`core/src/iosMain/.../ios/Phone.kt`).

## Build (CI)

Every push to `main` that touches the app, the core or the workflow, and any
`workflow_dispatch`:

1. `:core:iosSimulatorArm64Test`: the core's tests (every parity test) on the
   iOS simulator.
2. `:core:assembleSidecarCoreReleaseXCFramework` (cached while the core is
   unchanged), `node scripts/test-socket-bridge.mjs`, `xcodegen generate`,
   `xcodebuild test` on an iPhone simulator.
3. `scripts/simulator-smoke.sh`: screenshots of the three screens against the
   live list, then a join of a stand-in server on 127.0.0.1 once per page
   socket (direct, bridge, auto), each loading the real play.bfstats.io page.
   The screenshots, the per-socket reports and the app's log are the
   `sidecar-ios-smoke-<run>` artifact, and the table is in the job summary.
4. `scripts/store-screenshots.sh`: the three screens at App Store Connect's
   exact sizes, 6.9" (1320 x 2868) and 6.3" (1206 x 2622), with Apple's 9:41
   status bar: the `sidecar-ios-store-screenshots-<run>` artifact. It never
   holds up the signed build.
5. With the signing secrets: a signed Release archive and its `.ipa`
   (`sidecar-ios-ipa-<run>`).
6. On a `sidecar-ios-v<version>` tag: the `.ipa` goes to TestFlight and to a
   draft GitHub release.

The build number is the workflow's run number; the version is the tag's
(`sidecar-ios-v0.1.0` -> 0.1.0).

## Signing and TestFlight: what the owner sets up once

1. **Apple Developer Program** membership (paid), signed in at
   developer.apple.com. The Team ID is under Membership details.
2. **The app record.** App Store Connect > Apps > + > New App: platform iOS,
   name "bfstats.io", bundle ID `io.bfstats.app` (register it first under
   Certificates, Identifiers & Profiles > Identifiers > + > App IDs if it is
   not offered), SKU e.g. `bfstats-io`. A build cannot be uploaded before the
   record exists.
3. **The API key.** App Store Connect > Users and Access > Integrations >
   App Store Connect API > Team Keys > +. Name it "GitHub Actions", role
   **App Manager**. Note the **Key ID** and the **Issuer ID** (above the
   list), and download the `.p8` once (Apple keeps no copy). If the archive
   step later fails on creating a distribution certificate or profile,
   revoke the key and make a new one with the **Admin** role: automatic
   signing creates the App Store certificate and profile through the key.
4. **The secrets**, from a shell in the repo, reading the values from files
   so nothing is echoed or kept in the shell history:

   ```bash
   printf '%s' 'ABCDE12345' > /tmp/team-id            # your Team ID
   gh secret set APPLE_TEAM_ID < /tmp/team-id
   printf '%s' 'KEY_ID_HERE' > /tmp/asc-key-id          # the Key ID
   gh secret set ASC_KEY_ID < /tmp/asc-key-id
   printf '%s' 'ISSUER-UUID-HERE' > /tmp/asc-issuer     # the Issuer ID
   gh secret set ASC_ISSUER_ID < /tmp/asc-issuer
   base64 -w0 ~/Downloads/AuthKey_KEY_ID_HERE.p8 | gh secret set ASC_KEY_P8_B64
   shred -u /tmp/team-id /tmp/asc-key-id /tmp/asc-issuer
   ```

   (On macOS, `base64 -i <file>` in place of `base64 -w0 <file>`.) Then keep
   the `.p8` somewhere safe, or delete it: a lost key is revoked and replaced.
5. **A release.** `git tag sidecar-ios-v0.1.0 && git push origin sidecar-ios-v0.1.0`.
   The run uploads the build to TestFlight and drafts the GitHub release.
   In App Store Connect > the app > TestFlight, the build appears after
   Apple's processing (minutes to an hour). Add it to an **internal testing**
   group (up to 100 people on the team, no review) and the testers install it
   from the TestFlight app; **external testing** needs the beta review and the
   test information (what to test, a contact, the review notes:
   `features/sidecar-android-app/README.md`, "What a store reviewer will look
   at", applies here too). The encryption question is answered by the
   Info.plist (`ITSAppUsesNonExemptEncryption` = NO: HTTPS only).

A push without the secrets still builds and tests everything; only the signed
archive, the `.ipa` and the release steps are skipped. A tag without them
fails at once.

## Debugging a page in the app

A debug build's WKWebView is inspectable (Safari > Develop > the simulator or
the phone), which needs a Mac. Without one: the smoke artifact's `app.log`
holds the sidecar's lines, the bridge's decisions and the page's console
errors (`page: ...`).
