# Sidecar Android app: the bfstats.io companion

The desktop tray app (`features/sidecar-desktop-app`) runs the Node sidecar
beside the browser. This folder covers the same idea on Android: pick a live
server in the app, and the game page plays it through a sidecar the app runs.
Since 2026-10-27 the app is also the start of a bfstats.io companion app
(below): joining is one of its screens, not the whole of it.

Not public. It stays private until testing is done, as desktop does.

## The companion app (2026-10-27)

Owner, 2026-10-27: the phone app was "not as polished and nice looking as"
the tray app's panel, and "I'd like to create a companion app for the site
... The first thing I'd like to be able to do is see who is online before I
join the server. Right now when I tap it, it joins the server."

- **Package `io.bfstats.app`** (was `io.bfstats.sidecar`; changed before the
  first Play upload, after which it is fixed). The name stays "bfstats.io".
  The Kotlin packages stay `io.bfstats.sidecar.*` (namespace
  `io.bfstats.sidecar.app`): renaming them would touch every file for no
  user-visible change.
- **The bar is the tray panel** (`tools/sidecar-desktop/src/ui/panel.*`):
  the same Neutral Depth tokens (`ui/Theme.kt`, kept in step with
  `panel.css` and `ui/src/styles/modern-minimal.css`), Geist and Geist Mono
  (variable TTFs converted losslessly from the tray app's woff2, in
  `res/font`; the OFL licence ships as `assets/licenses/Geist-OFL.txt`), the
  panel's own line icons as vectors (`ui/Icons.kt`, from its SVG sprite),
  its status dot, chip, badges, load bar and ticket split bar
  (`ui/Components.kt`). Dark only; density is the only thing that changes
  with the screen.
- **Screens** are a Navigation 3 back stack of `NavKey`s (`LiveData.kt`:
  `ServersKey`, `ServerKey(ip, port)`, `JoinAddressKey`), with saveable state
  and a ViewModel store per entry. A player page or stats screen is one more
  key and one more `entry<...>` in `MainActivity`.

| screen | what it shows |
|---|---|
| Server list (`servers/ServersScreen.kt`) | brand header with the list's state (live, server and player counts, offline); search (server, map or mod); "Populated" and "Empty" groups, busiest first; per row: the map thumbnail (Coil, cached; a 404 is remembered for the run and the row shows the map's first letters on an olive wash, as the panel does), the decoded name, AC and PW tags, the country flag (the one allowed flag: where a server is, in a list row), map, mode and mod, the round clock counting down between refreshes, the tickets with a split bar (none for a round without tickets, e.g. CTF), players/max with a load bar tinted by how full; pull to refresh and the tray's 60 s refresh while on screen; designed loading (skeleton rows), empty, no-match and offline states, and a notice when an older list is kept after a failed refresh; two rows to a line in landscape with the search in the header |
| Server (`servers/ServerScreen.kt`) | the map art under a scrim (the topographic wash when there is none), back, a live/offline chip, the decoded name, map, mode, mod, an ISO country badge, the address, AC/PW tags and players/max; both sides' tickets in the olive headline treatment (the leader in the lifted olive), the round clock between them, the split bar; each side's players under the site's olive table anchor, best first, with score, kills/deaths and ping tinted as the site's roster does, bots tagged BOT; refreshed every 10 s from the single-server endpoint and on pull; in landscape the round sits beside the player tables |
| Join bar (bottom of the server screen) | the player name (checked as the tray app checks it: Latin-1, no quotes, 23 at most) and Join; once joined there, Open game and Leave; a passworded server or one gone offline cannot be joined, and joining while on another server says it leaves that one |
| Join by address (`join/JoinAddressScreen.kt`, the link icon in the list's header) | `host[:port]` (the tray's `parseAddress`, port 14567 by default) and the name; the last address is remembered |
| Session bar (under the list while joined) | the joined server, Joining/Joined, Open and Leave |

- **Data** (`core`, `ServerDetail.kt`, commonMain so iOS reuses it): the
  live list already carries every server's players and teams, so a server
  opened from the list draws at once; `GET
  /stats/LiveServers/bf1942/{ip}/{port}` (edge-cached 10 s) returns the same
  object for one server, and 404 once the server has left the list, which
  the screen shows as offline with the players last seen. `parseServerDetail`
  splits players by team (labels from `teams`, else the players'
  `teamLabel`, else "Team N"), sorts them by score, kills, fewer deaths,
  name, and keeps each player's stored name as the identifier
  (`displayName` decodes it for the eye only). The panel's round clock,
  game type words, load bands, name and address checks are there too.
  `ServerDetailTest` holds it on the JVM and linuxX64; it has no Node
  fixture, because the tray app shows no players.
- **The join is unchanged:** the foreground service runs one `Sidecar` per
  join, the game opens in `PlayActivity` once the page socket is up (once per
  join now, so a rotation no longer opens it again), and the notification's
  Leave still leaves.

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
  profiles, logs and settings come later. (Superseded 2026-10-27: a tap
  opens the server and its players; Join is on that screen. "The companion
  app" above.)
- **Sideloaded APK on the owner's phone.** The SDK is the one Android Studio
  installs (`~/Android/Sdk`), so the IDE and command-line builds share it.
- **Order is free.** The goal is a proof that the sidecar joins a real server
  from a phone; take the steps in whatever order proves it.
- **Code lives in `tools/sidecar-android`**, beside `tools/sidecar-desktop`.

## Open

- **Fewer things to maintain (owner, 2026-10-26: revisit once the bug fixes
  and the iPhone groundwork are in).** Two sidecars (Node; Kotlin) kept in
  step by the parity fixtures, and two shells (Electron tray, Android), with
  an iPhone shell to come. Step 2, one sidecar shipped to players, is done
  for Linux (2026-10-26): the tray app runs the Kotlin core as a native
  executable (`kotlin`, its default engine there), bundled in the AppImage,
  deb and pacman packages with no Java
  (`features/sidecar-desktop-app/README.md`, "Engines"). The Node sidecar
  remains the parity reference the Kotlin port is tested against, Windows'
  engine until a mingwX64 build exists, and the tray app's fallback when the
  native binary is missing or fails to start. Still open: the Windows native
  build, and whether the shells can share more than the core.

How the two stay in sync is settled (wave 2): golden transcripts from the
Node code under a fake clock and fake sockets, the lab's own datagrams among
the inputs ("Porting conventions", "Wave 2" below).

## Distribution plan (2026-10-26, proposed)

Nothing here is decided until the owner says so; the open questions are at
the end of the section.

### What a store reviewer will look at

- **Names and marks.** The app is branded bfstats.io (name, icon,
  listing). It must not lead with "Battlefield", EA's logos or box art; "for
  BF1942 servers" in the description is a factual reference.
- **The game's art is not in the app.** The APK holds the sidecar and a
  WebView; every model, texture and sound is the website's, fetched when the
  page loads. A reviewer judges what the app shows, so the page is seen, but
  the package distributes nothing of EA's and the exposure is the site's.
- **CD keys.** Like bf42++, the sidecar makes up a random 22-digit key per
  install (cdkey.mjs), because GameSpy is gone and servers accept any. A
  reviewer reading "generates CD keys" would see a keygen; the listing and
  the review notes should say what it is: a per-install player identity the
  game protocol needs, never a retail key.
- **A web page in a shell.** Both stores reject thin website wrappers. This
  one carries a full network client the page cannot run alone, which is the
  point to make in the review notes.

### Google Play

1. **Account (none yet, 2026-10-26).** A Play developer account, one-off
   fee. Personal: Google verifies a legal name but the store shows the
   developer name ("bfstats.io" or "skandia"), and a new personal account
   must run a closed test with at least 12 testers for 14 days before
   production. Organisation: needs a registered entity and a D-U-N-S number
   (free, days to weeks), and skips the 12-tester rule. Without an entity,
   personal is the route; the testers can come from the bfstats community.
2. **Signing.** Play App Signing: Google holds the app key, we hold an upload
   key (a keystore kept out of git, in CI as a secret). The release build
   becomes an Android App Bundle (`./gradlew :app:bundleRelease`); R8
   already runs on release.
3. **The foreground service.** `specialUse` needs a written justification in
   the Play Console and may be refused. The game is only played with the
   page in front, so the store build can drop the service and leave the
   server when the app is closed, as the game itself does; the notification's
   Leave button goes with it. Simplest path through review.
4. **Store forms.** A privacy policy page on bfstats.io (what is sent: the
   player name to the chosen game server, the live list and level tables
   fetched from bfstats.io; nothing collected), the Data safety form, and the
   content rating questionnaire (war game violence).
5. **CI.** A GitHub Actions job beside `sidecar-desktop.yml`: core tests,
   `assembleRelease` (the R8 check) and a signed bundle on a tag, uploaded to
   the internal testing track (the Play Developer API, or by hand at first).
6. **Tracks.** Internal testing (up to 100 people, minutes to go live) while
   it stays private, then the closed test, then production.

Until then, a signed APK can go to testers directly (a GitHub release or a
bfstats.io link) with "install unknown apps" allowed.

### Apple

**iPhone and iPad.** iOS has no JVM. The way across that keeps one
implementation is Kotlin Multiplatform: `core` is now a shared module with the
JVM-only parts replaced (done 2026-10-26, "Kotlin Multiplatform" below; the
table is what each became).

| JVM piece in core | on iOS |
|---|---|
| `DatagramSocket`, `ServerSocket` (UDP to the server, the page socket) | POSIX sockets (`Sockets.native.kt`; ktor-network lost connections, parity-audit.md) |
| threads, the event loop | a kotlinx-coroutines single-thread dispatcher per loop; native workers for the receive threads |
| `java.io.File`, `HttpURLConnection` | kotlinx-io 0.9.1 (`FsFile`); ktor-client 3.6.0, Curl on Linux, Darwin on iOS |
| `BigDecimal` in `Js.numberToString`, `toFixed`, ToInt32 | `JsNumber.kt`: Steele-White/Burger-Dybvig shortest digits on a small bignum, exact `toFixed` |
| `StrictMath` sin/cos | `JsMath.kt`: fdlibm 5.3 sin/cos in Kotlin; `**` correctly rounded |
| `MessageDigest` (MD5, SHA-1), `Base64`, windows-1251 | `Digest.kt`, `kotlin.io.encoding.Base64`, a table (`Common.kt`) |

The parity tests move with the code and run on the iOS simulator too, so the
port stays checked. The app shell is SwiftUI (or Compose Multiplatform) with
a `WKWebView`. Two things to prove early, before the core moves:

- whether WKWebView lets an https page open `ws://127.0.0.1`. If it does
  not, the shell injects a `WebSocket` stand-in that talks to the app
  through `WKScriptMessageHandler`, and the page is none the wiser;
- iOS suspends a backgrounded app's sockets, so a round ends when the app
  leaves the screen (fine for a game), and a LAN server such as the lab
  needs the Local Network permission prompt.

Needs: the Apple Developer Program (yearly fee), a Mac with Xcode for builds
and signing (or macOS CI runners), TestFlight for testers. Review notes as
above; guideline 4.7 covers HTML5 games loaded from the web.

**What can happen before the Mac (owner's goal: install on an iPhone; the
Mac arrives later).** Kotlin/Native compiles for iOS only on macOS, but the
move to Kotlin Multiplatform can be done and proven on Linux first: a
`commonMain` core with no JVM imports, compiled for the JVM (the Android app,
today's tests) and for `linuxX64` native, whose test run proves nothing JVM is
left. When the Mac is here, adding `iosArm64` and the SwiftUI shell is the
remaining step. Installing on one's own iPhone from Xcode works with a free
Apple ID (the build expires after 7 days); TestFlight and the App Store need
the paid programme.

**macOS desktop (parked 2026-10-26).** The Electron tray app already builds
for macOS; it needs Developer ID signing and notarisation.

### Open questions for the owner

- Personal or organisation Play account (no account yet; personal unless
  there is a registered entity).
- Store build without the foreground service (recommended), or keep it and
  argue the special use.
- Settled 2026-10-26: bfstats.io branding; iPhone is the Apple goal, a Mac
  arrives later; the macOS tray app is parked.

## Porting conventions

The Kotlin core (`tools/sidecar-android/core`) is a line-by-line port of the
Node sidecar (`tools/bf1942-models/sidecar`), so a change to one maps onto the
other by file and function.

- **One Kotlin file per module**, named for it (`netconn.mjs` ->
  `NetConn.kt`, `ghost/pco.mjs` -> `ghost/Pco.kt` in package
  `io.bfstats.sidecar.ghost`), opening with "Port of
  tools/bf1942-models/sidecar/<file>; keep in step". Functions keep their
  names and order; the engine addresses and wire notes in comments come too.
- **Numbers are JS doubles** unless a value is a bit field: decoded floats,
  positions and anything a row carries are `Double`, with the same arithmetic
  order, so the bits match. `Math.fround(x)` is `x.toFloat().toDouble()`; JS
  `x | 0`, `x >>> 0` and `1 << 31` wrap as int32, and the port spells that out.
- **Rows are JSON the page and the recordings read.** Build them as
  `LinkedHashMap<String, Any?>` (or a class with a `toJs()` map) in the
  Node copy's key order and write them with `Js.stringify`, which prints as
  V8 does. A key the Node copy leaves `undefined` holds `Undefined`.
- **`core` is Kotlin Multiplatform, all of it in `commonMain`** with no
  `java.*` import: what it takes from a platform goes through `Platform.kt`
  (jvmMain and nativeMain implement it). It has no Android APIs, and its JVM
  target is JVM 17. Node's `EventEmitter`
  becomes listener lambdas; `Buffer` is `ByteArray` (`Bytes.kt`); a timer or
  clock is passed in, so a test can drive it.
- **One set of shared helpers.** JS semantics are `JsOps.kt` (truthiness,
  `===`, ToNumber, ToInt32/ToUint32, `toFixed`, `Math.round`, V8's `hypot`,
  sin/cos/`**` through `JsMath.kt` (`Math` in the package is JS's Math,
  not java.lang's), trim, `JSON.parse`); time is `Scheduler.kt` (Node's two
  clocks, `schedule` / `every` / `post`; `EventLoop` is the real single thread
  every join runs on, the UDP and page-socket threads post onto it, and
  `ManualScheduler` is the test clock). A port takes these, never its own.
  Test side: `Fixtures.kt`. Node side: `parity/lib/fixture.mjs` (writing,
  the two value encodings, the PRNGs), `parity/lib/fake-time.mjs` (the one
  fake clock, `ManualScheduler`'s twin, with `stepTo` letting promises
  settle as `post` does), `parity/lib/tables.mjs` (the scratch level-table
  cache), `parity/lib/wire-fakes.mjs` (a fake server's datagrams).
- **Parity fixtures come from the Node code itself.** Each
  `tools/sidecar-android/parity/<module>.mjs` imports the real Node module,
  runs it over inputs (recorded datagrams, review-log records, edge cases) and
  writes `core/src/commonTest/resources/parity/<module>.json`; the Kotlin test runs
  the port over the same inputs and requires identical output. Expected values
  are never typed by hand when Node can produce them. `parity/regen.sh`
  rebuilds every fixture: run it after any change to the Node sidecar, and the
  Kotlin tests that fail are the port's to-do list.

## Tasks

- [x] Android SDK on this PC (`~/Android/Sdk`: platform 37.0, build-tools
      36 and 37, platform-tools; AGP 9.4.1, Gradle 9.8.2, Kotlin 2.4.21)
- [x] `tools/sidecar-android` Gradle project: `core` (pure JVM, no Android
      APIs; Kotlin Multiplatform since 2026-10-26) and `app`; opens in
      Android Studio
- [x] App shell: server list, tap to join, foreground service, fullscreen
      WebView on play.bfstats.io; `core` hosts the page socket (`WsServer`,
      a port of `wsserver.mjs`) and logs what the page sends
- [x] The shell on a phone: the page opens the socket from the WebView
- [x] Shared ground: `BitStream.kt` (bitstream.mjs), `Js.kt` (JSON.stringify
      and Number#toString as V8 prints them, checked on 16.5k doubles),
      `Bytes.kt`
- [x] Wave 1, in parallel: the decoders (ghost/*, soldier-ghost,
      body-decoder, the level tables, names, record, ghost-writer, rebuild;
      gate: Node and Kotlin rebuild of a real recording agree line for line);
      the wire (netconn, plus, rejoin, chat, cdkey, the CRCs, server-query);
      events and input (events, input with an injected clock, page-team,
      live-snapshot, player-name, review)
  - [x] The wire (2026-10-26): `NetConn.kt`, `Plus.kt`, `Rejoin.kt`,
        `Chat.kt`, `CdKey.kt`, `Paths.kt` (config and cache dirs only),
        `ObjectsChecksum.kt` and `ContentCrc.kt` (bundled tables only; the
        install readers are stubs, Android has none), `ServerQuery.kt`;
        shared `Emitter.kt`.
        Fixtures: `parity/{netconn,plus,rejoin,chat,cdkey,objects-checksum,
        content-crc,server-query}.mjs`, helpers in `parity/lib/`.
        `./gradlew -q :core:probe` is the live check against the lab.
  - [x] Events and input (2026-10-26): `Events.kt`, `Input.kt` (the
        `server`, `bucket` and `slot` pacing laws), `PageTeam.kt`,
        `LiveSnapshot.kt`, `PlayerName.kt`, `Review.kt`. Fixtures: `parity/{events,input,
        live-snapshot,page-team,player-name,review}.mjs`; the paced runs drive
        the page's own `input-pace.js` against a model server.
  - [x] The decoders (2026-10-26): ghost/*, soldier-ghost, body-decoder,
        template-class, names, template-table, level-tables, game-tables,
        paths (the cache and install lookups), record, ghost-writer, rebuild.
        Gate: Kotlin `Rebuild` and Node `rebuild.mjs` agree line for line on
        the owner's whole Wake round (run.ndjson) and three more sessions
        (`RebuildFilesTest`, opt-in), and on the committed slices
        (`RebuildTest`). See "The decoder port" below.
- [x] Wave 2 (2026-10-26): session.mjs and the sidecar.mjs glue behind
      `Sidecar`; a Kotlin join of the lab from the PC. See "Wave 2" below.
  - [x] One set of shared helpers (the three wave-1 copies merged)
  - [x] `Session.kt` (session.mjs), parity on a real lab join and seven
        synthetic scenarios
  - [x] `Sidecar.kt` (sidecar.mjs) behind the facade, `SidecarHost` for what
        Node takes from its runtime; `tools/SidecarMain` and `:core:sidecar`
  - [x] The live proof on the lab: the Kotlin sidecar 240 s on Wake co-op,
        the real map.html played through it headless
- [x] A join from the phone to the lab (2026-10-26, Galaxy S23 FE over
      wireless debugging, Android 16): the Kotlin sidecar fetched Wake's
      tables from mesh.bfstats.io, joined the lab at 192.168.1.226:14568 as
      player 0 on team 2 (31 players, 291 objects), and play.bfstats.io in the
      WebView opened its socket and drew the live scoreboard (12 ms ping).
      The first try crashed on `java.lang.ProcessHandle`, which Android lacks;
      `:app:assembleRelease` now runs R8, which fails on such a class.
- [x] Play a round on the phone: the owner played the lab round on the
      phone (2026-10-26), then a public server, BF1942-AUSTRALIA
      (159.196.188.2:14567, Battle of the Bulge co-op, 64 players), on the
      post-audit build as skandia-sc: "it works well, I can't fault it"
- [x] Kotlin Multiplatform (2026-10-26): `core` builds for the JVM and for
      linuxX64 native, every test passes on both, and the native sidecar
      joined the lab. See "Kotlin Multiplatform" below.
- [x] Parity audit before the rollout (2026-10-26): every Node runtime
      module mapped to its port, the fixtures' coverage of the Node code
      measured and raised, five live lab sessions replayed identically
      through both sidecars on both targets, a live A/B of the native
      binary against Node, and every divergence fixed or justified.
      [parity-audit.md](parity-audit.md).
- [x] The companion app's first screens (2026-10-27): package
      `io.bfstats.app`, the list redrawn to the tray panel's standard, a
      server screen with who is on it before joining, join by address on its
      own screen ("The companion app" above)
- [ ] iPhone: on a Mac, build the iOS targets and the SwiftUI shell (below)

## Wave 2: the session and the glue

**Run the Kotlin sidecar in place of Node** (from `tools/sidecar-android`):

```bash
./gradlew -q :core:sidecar --args="127.0.0.1:14568 --name kt --team 2 --ws 17942 --out /tmp/kt/run.ndjson --review /tmp/kt/run.review.ndjson"
```

The arguments are `node sidecar/sidecar.mjs`'s (host:port, `--name`,
`--team`, `--ws`, `--out`, `--review`, `--name-from-page`, `--name-wait`,
`--password`, `--tables-url`, `--level-wait`, `--query-port`,
`--no-prejoin`, `--retail`, `--plus-version`, `--pace`, `--word-log`,
`--stay`, `--names`, `--rejoin-horizon`, `--connect-timeout`, `--cdkey`,
`--allow-origin`, `--leave-on-stdin`), and so are the console lines and the
page socket. Ctrl-C leaves cleanly. Without `--out`/`--review` it writes
`sidecar-<stamp>.ndjson` in the current folder, as Node does; relative
paths are under `-PsidecarDir` (default `core/`). (Port 14567 is the
BF1942 default and is joined like any other; mind server1 on this PC.)
`./gradlew -q :core:join --args=...` is join.mjs, the bare-client tester.

**The facade.** `Sidecar(JoinConfig, log, SidecarHost)`: `start()` brings
the page socket up and returns its port (the join goes on in the
background: the pre-join look, the page's name, the connect); `leave()` is
Node's SIGINT; `stop()` leaves and stops the loop. `JoinConfig` carries
sidecar.mjs's options plus `cacheDir` (the level tables) and `configDir`
(the CD keys); the app passes its own `cacheDir/sidecar` and
`filesDir/sidecar`, and writes no recording. `SidecarHost` is what Node
takes from its runtime: the loop, the UDP sockets, the page socket, the
files, the background work (the pre-join query and a level's tables, which
block), the header's clock and `exit`.

**Parity.**

- `parity/session.mjs` drives Node's `Session` through a fake socket and
  the fake clock over eight scenarios: `capture`, a real join of the lab
  (Wake co-op, 8 bots, the first 30 s: handshake, world dump, a spawn, 10 s
  of the soldier's control states) recorded by `parity/live/udp-relay.mjs`
  between the Node sidecar and the server
  (`resources/parity/session/lab-wake-join.capture.ndjson.gz`), and
  synthetic ones from `lib/wire-fakes.mjs` (an expansion's two
  ChallengeResponses, the event window filling and a lost block's resend,
  chat in and out with refusals, bf42++ settings and SpecialGame 2, the
  level gate's hold, timeout, throw and none, the quiet watchdog, a level
  change, malformed streams). `SessionTest` requires every datagram out and
  every emitted event, with its time, line for line.
- `parity/sidecar.mjs` runs the real, unedited `sidecar.mjs` under
  `lib/sidecar-preload.mjs` (fake clock, `dgram.createSocket` replaced,
  the page socket redirected to `lib/fake-wsserver.mjs` by a module hook,
  `crypto.randomInt` seeded) over three scenarios: the lab capture with a
  page that joins a side, spawns, sends 8 s of words, reloads, switches
  seat, chats, radios, suicides and leaves, and a second page joining
  mid-round (the live snapshot); a level change, the rejoin probe and
  reconnect with the password, and a kick the server's chat announced; a
  named-from-page join that goes unreachable and is refused. `SidecarTest`
  reads the same command line with `SidecarMain`'s parser and requires every
  datagram, page frame, console line, the exit, the recording and the review
  log, line for line.
- To make a new capture: start the lab, `node parity/live/udp-relay.mjs
  --listen 14600 --to 127.0.0.1:14568 --out cap.ndjson`, point the Node
  sidecar at `127.0.0.1:14600`, play, stop both with SIGINT, and cut it with
  `parity/live/trim-capture.mjs`.

**The live proof (2026-10-26, lab Wake co-op, 12 bots in 16 slots).** The
Kotlin sidecar (`:core:sidecar ... --name ktproof --stay 240`) joined as
player 0, team 2 (13 players, 140 objects), and in 240 s took 466 events,
4,690 ghost blocks (19.5 a second, Node's rate) and 56,347 ghost records:
52,334 transform samples, 3,407 stance rows, 366 fires, 243 hit point
changes, 163 objects named. The server's own event log has `createPlayer`
ktproof at 44.17 s and `disconnectPlayer` at 284.13 s: a clean leave at the
end of the stay, not a 20 s timeout. The real map.html, headless against
it (`parity/live/page-proof.cjs`, viewer served on 5511): joined with 12
remotes in the roster, 10 of them moved in 10 s, deployed on Landing_Beach
(the server's spawnEvent at 1142.8/758.9, the page's own soldier at
1142.80/-758.91), walked 22.3 m with 268 corrections, none hard, error in
micrometres, the page and the server's ack 0 m apart. The node page client
(`lab/remote_draw_probe.mjs`) also spawned and drew remotes through it. The
Node sidecar on the same server and probe: 12 remotes, deployed, walked
31.7 m, 268 corrections, none hard. `:core:probe` remains the wire layer's
own check.

## The decoder port

- **Values are JS values.** The decoders' rows, bodies and options are the
  Node copy's plain objects: `MutableMap<String, Any?>` in JS key order,
  lists, and every number a `Double`, read through `JsOps.kt` (`g`, `n`,
  `truthy`, `eq`, `str`). That keeps a port line for line, absent and null
  keys included. `JsOps` also carries the maths that must match V8 to the
  bit: `toFixed`, `Math.round`, `Math.hypot` (V8's Kahan sum) and sin/cos
  through `JsMath.kt` (a Kotlin port of fdlibm, which Node's V8 runs;
  `java.lang.Math` disagreed on 3% of 200,000 arguments).
- **The level tables come from the cache, never the install.** `Paths`
  takes the host's cache folder (`cacheDirOverride`; Android passes its own)
  and `LevelTables.prepareLevel` downloads the published bake into it with
  the platform's `httpGet`, revalidating with the copy's ETag. Computing a level's tables
  from an install (Node spawns Python on `bf42/template_table.py`) is stubbed:
  `Paths.pythonAvailable` says no, so a desktop install's already computed
  cache is still read but nothing new is computed. The table code version
  (`template-table.mjs` tableVersion) is hashed from the repo at build time
  (`core/build.gradle.kts`, task `tableVersion`), so a bake made by other
  code is refetched as in Node.
- **Module state is per process, as in Node.** `Rebuild.resetModuleState()`
  puts every memo back to a fresh process's (the tests call it per case).
- **Fixtures** (`tools/sidecar-android/parity`): `rebuild.mjs` (the gate;
  inputs cut once from real recordings and committed), `ghost-decoders.mjs`,
  `body-decoder.mjs`, `control-state.mjs`, `derive-children.mjs` (template
  graphs taken once from the install), `tables.mjs` (prepareLevel against a
  scripted stand-in server), `ghost-writer.mjs`, `js-ops.mjs`. All run
  against the baked tables under `resources/parity/cache` with no install
  and no network, so a regen needs neither.

## Kotlin Multiplatform (2026-10-26)

`core` is a Kotlin Multiplatform module, so the same sidecar can run on an
iPhone. On this Linux PC the proof is a second target, `linuxX64` native:
nothing of the JVM is left in the shared code if it compiles and its tests
pass there.

**Layout** (`core/src`):

| source set | holds |
|---|---|
| `commonMain` | the whole port (every module, `Sidecar`, the CLIs' bodies in `tools/SidecarCli.kt` and `tools/Probe.kt`), `Platform.kt` (the `expect`s), and the pure-Kotlin stand-ins: `JsMath.kt`, `JsNumber.kt`, `Digest.kt`, `Common.kt` |
| `jvmMain` | `Platform.jvm.kt` (java.net, `ScheduledExecutorService`, threads, `HttpURLConnection`: what ran before, unchanged), the JVM `main`s (`SidecarMainKt`, `ProbeMainKt`) |
| `nativeMain` | `Platform.native.kt` (a coroutine dispatcher per loop, native workers, ktor-client, POSIX), `Sockets.native.kt` (blocking POSIX sockets), the native `main` (SIGINT/SIGTERM leave as Ctrl-C does) |
| `linuxMain`, `iosMain` | the HTTP engine (Curl, Darwin) and a file's mtime (stat; none on iOS, which has no game install) |
| `commonTest` | every test, reading fixtures from the source tree (`PARITY_DIR`, generated); `TestSupport.kt` is JUnit's Assert over kotlin.test |
| `jvmTest`, `nativeTest` | gunzip (java.util.zip, zlib); `PureKotlinTest` checks the stand-ins against StrictMath, BigDecimal, MessageDigest, Charset and URLEncoder over a million arguments |

`core/resources` (the template names, hulls, derived specs, the CRC tables)
becomes Kotlin at build time (`embedResources` in `core/build.gradle.kts`,
`EmbeddedResources.text("sidecar/...")`), with the table version hash, so no
target reads a classpath or a file for them.

**Libraries:** kotlinx-coroutines 1.11.0, kotlinx-serialization 1.12.0,
kotlinx-io 0.9.1, atomicfu 0.33.0 (the locks), ktor-client 3.6.0 (native
only; the JVM keeps java.net, so the APK gains nothing but
kotlinx-io and atomicfu). Kotlin 2.4.21. Every one of them publishes
linuxX64, iosArm64 and iosSimulatorArm64.

**What became pure Kotlin, and how it is held to V8:**

- `Js.numberToString`: the shortest round-trip digits, nearest on a tie
  (V8's bignum-dtoa), on a small bignum (`JsNumber.kt`); the 16.5k-double
  V8 fixture (`JsTest`). `toFixed` and ToInt32 are exact on the same bignum.
- Decimal strings to numbers (`JSON.parse`, `Number()`, `toFixed` read
  back): the platform's parser guesses, exact arithmetic checks the two
  midpoints around the guess, so no platform parser can change a value;
  9,000 V8 cases at and around midpoints (`js-ops.json.gz` `decimals`).
- `Math.sin`, `Math.cos`: fdlibm 5.3 in Kotlin (`JsMath.kt`), which is what
  V8 runs; 4,000 V8 arguments from 1e-300 to 1e300 to the bit, and a
  million against StrictMath on the JVM.
- `**` / `Math.pow`: V8 calls the C library's pow, so Node's answer is the
  OS's (glibc here). glibc is within 0.52 ulp and misses the nearest double
  about once in 800 arbitrary arguments, and rounds an exact tie (3 ** 34)
  up. The port is correctly rounded (double-double), held to the bit on the
  special cases and every exact power, 0.5 ** -1100..1200 among them (the
  only pow the sidecar computes: ghost-writer.mjs's 0.5 ** a whole number of
  ticks), and to an ulp elsewhere (`pow`, `powLibm`). StrictMath.pow, which
  the JVM port used, was fdlibm's e_pow and disagreed with V8 on 1 argument
  in 10 with a fractional exponent; the ghost writer never passed one.
- MD5, SHA-1, SHA-256 (`Digest.kt`), Base64 (`kotlin.io.encoding`),
  windows-1251 (a table), `URLEncoder`, ISO dates, the heap behind
  `ManualScheduler`.
- `java.util.regex` to Kotlin `Regex`: every pattern ran unchanged on native
  (lookbehind, `\z`, IGNORE_CASE, the `JS_WS` class) and the parity tests
  pass there.

**A bug the native run found:** `LiveState` (live-snapshot) walked a copy of
a map's entries while removing from the map. The JVM's entries are nodes and
survive that; Kotlin/Native's are views and threw
`ConcurrentModificationException`. It walks key/value pairs now.

**Run each target** (from `tools/sidecar-android`):

```bash
./gradlew :core:jvmTest :core:linuxX64Test          # every parity test on both (jvm adds PureKotlinTest)
SIDECAR_PARITY_CAPTURES=~/.cache/bfstats-parity ./gradlew :core:jvmTest  # plus the whole live captures
./gradlew :core:koverHtmlReport                      # Kotlin coverage of the JVM tests
./gradlew :core:linkSidecarReleaseExecutableLinuxX64  # core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe
core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe 127.0.0.1:14568 --name skandia-sc --team 2 --ws 17942
./gradlew -q :core:sidecar --args="..."               # the same on the JVM
./gradlew :app:assembleDebug :app:assembleRelease     # the app on the jvm target; release runs R8
parity/regen.sh                                       # every fixture from Node, then both test runs
```

The native binary is one 16 MB file with libcurl linked in (ldd: libc, libm,
libz, libresolv); it needs no JVM.

**The live check (2026-10-26, lab Wake co-op, 8 bots in 9 slots):** the
native `sidecar.kexe` as `skandia-sc` (`--stay 75`) joined as player 0 on
team 2 (9 players, 41 objects) and in 75 s took 148 events, 1,455 ghost
blocks (19.4 a second, Node's rate) and 5,754 ghost records (5,214 transform
samples, 217 stances, 53 fires); the server's event log has its
`createPlayer` at 14.88 s and `disconnectPlayer` at 89.85 s, a clean leave.
A second native join with an empty cache downloaded Wake's tables from
mesh.bfstats.io over HTTPS (Curl) in 684 ms; a third left on SIGINT within
0.2 s, the server logging the disconnect. The JVM CLI joined and left the
same server (325 ghost blocks in its 20 s).

**What remains for iOS (on a Mac):**

1. The targets are declared (`iosArm64`, `iosSimulatorArm64`); Kotlin/Native
   builds them only on macOS, so on the Mac run `./gradlew
   :core:iosSimulatorArm64Test` first. `nativeMain` was compiled for Linux
   only, so the Apple side of its ktor and POSIX calls is unproven until
   then; `iosMain` holds the two Apple pieces (the Darwin HTTP engine, no
   file mtimes). Then add an XCFramework (`binaries.framework`) for the shell.
2. The shell: SwiftUI with a `WKWebView` loading play.bfstats.io, the
   server list, starting and stopping a `Sidecar` (`JoinConfig` with the
   app's caches and documents folders as `cacheDir` and `configDir`).
3. Whether WKWebView lets an https page open `ws://127.0.0.1:<port>`
   (mixed content to loopback). If it does not, the shell injects a
   `WebSocket` stand-in that talks to the app through
   `WKScriptMessageHandler`, and `PageHub` gets an implementation that is not
   a socket; the page is none the wiser. Prove this first.
4. A backgrounded app's sockets are suspended (the round ends with the app
   off screen), and a LAN server such as the lab needs the Local Network
   permission (`NSLocalNetworkUsageDescription`).
5. A free Apple ID installs on one's own iPhone for 7 days; TestFlight needs
   the paid programme.

## Status (2026-10-27)

- The companion app (`io.bfstats.app`) is on the owner's phone; they checked
  the list, the server screen and a join through it: "It looks nice, no
  issues from me."
- The Play developer account is going through Google's verification. Next,
  once it clears: the upload key (`scripts/make-upload-key.sh`), the first
  bundle by hand to internal testing, then the closed test
  (`play-listing.md`). The store screenshots in `store/screenshots/` still
  show the old list; retake them with the new screens before the listing.
