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

- Whether desktop moves to the Kotlin core (a native binary the Electron app
  spawns in place of Node). `:core:sidecar` already replaces
  `node sidecar.mjs` on a PC with a JVM.

How the two stay in sync is settled (wave 2): golden transcripts from the
Node code under a fake clock and fake sockets, the lab's own datagrams among
the inputs ("Porting conventions", "Wave 2" below).

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
- **`core` has no Android APIs** and targets JVM 17. Node's `EventEmitter`
  becomes listener lambdas; `Buffer` is `ByteArray` (`Bytes.kt`); a timer or
  clock is passed in, so a test can drive it.
- **One set of shared helpers.** JS semantics are `JsOps.kt` (truthiness,
  `===`, ToNumber, ToInt32/ToUint32, `toFixed`, `Math.round`, V8's `hypot`,
  StrictMath sin/cos, trim, `JSON.parse`); time is `Scheduler.kt` (Node's two
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
  writes `core/src/test/resources/parity/<module>.json`; the Kotlin test runs
  the port over the same inputs and requires identical output. Expected values
  are never typed by hand when Node can produce them. `parity/regen.sh`
  rebuilds every fixture: run it after any change to the Node sidecar, and the
  Kotlin tests that fail are the port's to-do list.

## Tasks

- [x] Android SDK on this PC (`~/Android/Sdk`: platform 37.0, build-tools
      36 and 37, platform-tools; AGP 9.4.1, Gradle 9.8.2, Kotlin 2.4.21)
- [x] `tools/sidecar-android` Gradle project: `core` (pure JVM, no Android
      APIs) and `app`; opens in Android Studio
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
- [ ] Play a round on the phone: spawn, move, shoot with the touch controls

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
paths are under `-PsidecarDir` (default `core/`). Port 14567 is refused
without `--force` (server1 on this PC).

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
  through `StrictMath` (fdlibm, which Node's V8 runs; `java.lang.Math`
  disagreed on 3% of 200,000 arguments).
- **The level tables come from the cache, never the install.** `Paths`
  takes the host's cache folder (`cacheDirOverride`; Android passes its own)
  and `LevelTables.prepareLevel` downloads the published bake into it with
  java.net, revalidating with the copy's ETag. Computing a level's tables
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
