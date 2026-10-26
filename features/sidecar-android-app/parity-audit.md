# Parity audit: the Kotlin sidecar against the Node sidecar (2026-10-26)

The Kotlin port (`tools/sidecar-android/core`) is about to be the sidecar
every player runs: the desktop tray app's native binary, the Android app,
and later the iPhone app. This audit was the gate before that rollout. It
looked for every place where the port behaves differently from the Node
sidecar (`tools/bf1942-models/sidecar`), on purpose and by accident. Every
difference it found is now either fixed with a test, or listed below as
deliberate with its reason.

## Verdict

The port is at parity on everything a player does, and the evidence for
that is now much stronger than before:

- **Replays of whole live sessions match line for line.** Five sessions
  recorded on the lab were replayed through Node and through Kotlin on the
  JVM and on linuxX64. Every datagram out, every page frame, every console
  line, the recording and the review log matched: **358,574 lines** in all.
  The sessions were a 15-minute Wake co-op run (several rounds, a level
  change, a Sherman, chat, a side change, 40 deploys), a two-level Conquest
  rotation with three reconnects, a Sherman driven and its gun fired from
  map.html, a Road to Rome level, and a Desert Combat level.
- **The live A/B on the lab came out equal.** The native `sidecar.kexe`
  and the Node sidecar each ran the same scripted map.html session, twice.
  Both joined, both had the full roster, remotes moved in both, and both
  deployed, walked, boarded a Sherman, chatted and left cleanly. On the
  like-for-like pair (same spawn), the walks were 21.9 m and 22.1 m with
  326 corrections each, none hard, a residual error of 1.4e-6 m in both,
  and 0 m between the page and the server in both.
- **Fixture coverage of the Node code went up.** Over the 40 runtime
  modules, branch coverage rose from 88.9% to 92.2% and line coverage from
  97.0% to 98.2%. sidecar.mjs, the glue every join runs through, went from
  61.9% to 84.6% of its branches. Every branch still uncovered is listed in
  Appendix B with the reason it is not driven.

The audit also found, and fixed, things that would have hurt the rollout:

- **The native binary refused every server on port 14567,** the BF1942
  default, unless given `--force`. That guard protected this PC's server1
  during development. The tray app moving to the kexe would have failed to
  join most real servers. Now it refuses only `127.0.0.1:14567` (server1 on
  the dev PC), so every real server on 14567 joins as with Node.
- **The native sockets lost connections.** About one page connection in a
  few dozen on a fresh listener was never read, or was read as closed. It
  showed on linuxX64 only, and it came from ktor-network's shared selector
  behind runBlocking. Those sockets are now plain POSIX calls; the stress
  tests that failed 1 run in 3 now pass every time.
- **Intervals caught up after a stall.** After an Android doze or suspend,
  `EventLoop.every` fired every missed tick back to back: a burst of pings,
  ConnectRequests and event blocks. It now behaves as Node's setInterval
  does and fires once.
- **The level gate fetched the wrong mod's tables (a Node bug, fixed in
  both copies).** On a Desert Combat server, the SetLevel gate asked for
  vanilla `bf1942` tables, because the Challenge's base mod overwrote
  ServerInfo's mod. A machine without the install (every phone) would then
  have named a mod level's objects from the wrong tables after every level
  change.
- **The Android app's server list did not match the tray app's.** Map
  images were encoded differently ("Kursk (Day 2)"), empty servers sorted
  by code point rather than as `localeCompare`, and numeric strings were
  dropped. The list had no test at all; it now has a parity fixture
  against the tray app's `servers.js`.

What is left over: the deliberate differences below (each one needed, and
commented in the code), and the remaining uncovered branches in Appendix B.

## How the audit was done

1. **Structural cross-reference.** Four auditors each read part of the
   Node sidecar and its Kotlin port side by side. They mapped every
   exported and internal function, class, method, constant table, CLI flag,
   environment variable and branch-bearing option. Each row records the
   Kotlin symbol, the fixture that covers it, and any difference. The maps
   are in Appendix A, corrected for what was ported since.
2. **Coverage of the Node code by the fixtures.** Every parity generator
   ran under V8 coverage (`NODE_V8_COVERAGE`, then `c8 report`), restricted
   to `tools/bf1942-models/sidecar/**`. Each uncovered branch reachable in
   production got a fixture case, where Node generates the expectation and
   Kotlin must match it. Kotlin's own coverage was measured with Kover on
   the JVM tests, to find Kotlin code no test reaches.
3. **Full-round differential.** `parity/live/page-relay.mjs` (new) runs the
   Node sidecar against the lab through a UDP relay and a page-socket
   relay. On one clock it logs every datagram per client socket, every
   page frame and the SIGINT. `parity/sidecar-captures.mjs` replays a
   capture through the real `sidecar.mjs` under the fake clock.
   `SidecarCapturesTest` replays it through `Sidecar.kt`, and the two must
   agree line for line.
4. **Live A/B.** `parity/live/ab-session.sh` (new) plays one scripted page
   session against one sidecar on the lab: map.html headless (join,
   roster, remotes, deploy, walk), a Sherman boarded by
   `lab/seat_aim_probe.cjs`, chat and radio, then Ctrl-C. The same session
   ran against Node and then against the native kexe, and the server's
   event log was read for each.
5. **Fixes.** Every divergence was fixed in Kotlin, or in Node too where
   Node was wrong (with a test in `tools/bf1942-models/tests/`). The
   fixtures were regenerated and both targets kept green.

## The modules

`sidecar.mjs`, `session.mjs` and `join.mjs` pull in 40 runtime modules,
transitively and including the dynamic imports. Each has a Kotlin file of
the same name:

- **Entry points:** `sidecar.mjs` (`Sidecar.kt`, `tools/SidecarCli.kt`),
  `session.mjs` (`Session.kt`), `join.mjs` (`tools/JoinCli.kt`, ported in
  this audit).
- **The wire:** `netconn`, `events`, `bitstream`, `plus`, `rejoin`, `chat`,
  `cdkey`, `objects-checksum`, `content-crc`, `server-query`.
- **Input and the page:** `input`, `page-team`, `player-name`, `wsserver`,
  `live-snapshot`.
- **The recording:** `record`, `review`, `ghost-writer`.
- **The decoders:** `body-decoder`, `soldier-ghost`, and in `ghost/`:
  `children`, `control-point`, `control-state`, `derive-children`,
  `free-camera`, `kit`, `pco`, `player`, `projectile`, `score-manager`,
  `spawn-manager`.
- **The level tables:** `names`, `template-class`, `template-table`,
  `level-tables`, `game-tables`, `paths`.

Not on the runtime path, but ported and checked:

- `rebuild.mjs`, the offline gate.
- The ghost decoders `engine`, `firearms`, `item`, `objective`,
  `rotational-bundle`, `simple-object`, `spring` and `verify`, which the
  sidecar never imports.
- `tools/sidecar-desktop/src/servers.js` and `map-image.js`, which
  `LiveServers.kt` ports for the Android app's server list.

## Coverage of the Node code by the fixtures

`node` under `NODE_V8_COVERAGE`, then `npx c8 report --include 'sidecar/**'`.
"Before" is the parity generators at `80f8f06e`; "after" is this branch's.
Two modules show "not loaded" before:

- No generator had run `wsserver.mjs`; the fixtures replaced it with a fake.
- No generator had run `join.mjs`.

| module | lines before | lines after | branches before | branches after |
|---|---|---|---|---|
| `bitstream.mjs` | 98.8% | 98.8% | 97.2% (70/72) | 97.2% (70/72) |
| `body-decoder.mjs` | 100.0% | 100.0% | 92.7% (140/151) | 92.7% (140/151) |
| `cdkey.mjs` | 100.0% | 100.0% | 94.9% (37/39) | 97.4% (38/39) |
| `chat.mjs` | 100.0% | 100.0% | 97.9% (46/47) | 97.9% (47/48) |
| `content-crc.mjs` | 76.6% | 88.3% | 88.1% (37/42) | 92.8% (52/56) |
| `events.mjs` | 100.0% | 100.0% | 95.2% (120/126) | 96.0% (121/126) |
| `game-tables.mjs` | 77.5% | 80.1% | 90.4% (66/73) | 92.6% (75/81) |
| `ghost-writer.mjs` | 100.0% | 100.0% | 93.4% (396/424) | 94.4% (405/429) |
| `input.mjs` | 100.0% | 100.0% | 95.9% (330/344) | 95.9% (330/344) |
| `join.mjs` | not loaded | 100.0% | not loaded | 88.9% (24/27) |
| `level-tables.mjs` | 92.8% | 95.3% | 88.7% (94/106) | 91.6% (109/119) |
| `live-snapshot.mjs` | 100.0% | 100.0% | 95.8% (138/144) | 95.8% (138/144) |
| `names.mjs` | 99.1% | 99.1% | 84.5% (71/84) | 88.4% (76/86) |
| `netconn.mjs` | 99.2% | 99.2% | 93.1% (135/145) | 93.3% (140/150) |
| `objects-checksum.mjs` | 82.9% | 89.1% | 67.4% (29/43) | 93.0% (53/57) |
| `page-team.mjs` | 100.0% | 100.0% | 100.0% (23/23) | 100.0% (25/25) |
| `paths.mjs` | 69.4% | 84.7% | 93.3% (14/15) | 72.4% (21/29) |
| `player-name.mjs` | 100.0% | 100.0% | 90.9% (10/11) | 91.7% (11/12) |
| `plus.mjs` | 100.0% | 100.0% | 92.0% (103/112) | 100.0% (114/114) |
| `record.mjs` | 100.0% | 100.0% | 94.2% (82/87) | 95.5% (84/88) |
| `rejoin.mjs` | 100.0% | 100.0% | 90.8% (129/142) | 96.2% (150/156) |
| `review.mjs` | 100.0% | 100.0% | 95.2% (20/21) | 95.2% (20/21) |
| `server-query.mjs` | 100.0% | 100.0% | 92.6% (63/68) | 92.6% (63/68) |
| `session.mjs` | 99.2% | 99.7% | 87.3% (165/189) | 91.6% (185/202) |
| `sidecar.mjs` | 93.2% | 98.9% | 61.9% (223/360) | 84.6% (422/499) |
| `soldier-ghost.mjs` | 97.2% | 97.2% | 95.5% (106/111) | 95.5% (106/111) |
| `template-class.mjs` | 100.0% | 100.0% | 97.0% (33/34) | 97.1% (34/35) |
| `template-table.mjs` | 79.5% | 81.4% | 82.1% (55/67) | 88.5% (69/78) |
| `wsserver.mjs` | not loaded | 96.8% | not loaded | 88.5% (69/78) |
| `ghost/children.mjs` | 100.0% | 100.0% | 86.1% (62/72) | 88.3% (68/77) |
| `ghost/control-point.mjs` | 92.7% | 92.7% | 100.0% (6/6) | 100.0% (6/6) |
| `ghost/control-state.mjs` | 100.0% | 100.0% | 75.3% (64/85) | 75.3% (64/85) |
| `ghost/derive-children.mjs` | 97.1% | 97.1% | 87.4% (166/190) | 87.4% (166/190) |
| `ghost/free-camera.mjs` | 100.0% | 100.0% | 81.2% (13/16) | 81.2% (13/16) |
| `ghost/kit.mjs` | 100.0% | 100.0% | 100.0% (15/15) | 100.0% (15/15) |
| `ghost/pco.mjs` | 99.7% | 99.7% | 95.6% (153/160) | 95.6% (153/160) |
| `ghost/player.mjs` | 100.0% | 100.0% | 100.0% (13/13) | 100.0% (13/13) |
| `ghost/projectile.mjs` | 100.0% | 100.0% | 100.0% (24/24) | 100.0% (24/24) |
| `ghost/score-manager.mjs` | 100.0% | 100.0% | 100.0% (19/19) | 100.0% (19/19) |
| `ghost/spawn-manager.mjs` | 100.0% | 100.0% | 92.6% (25/27) | 92.6% (25/27) |
| `rebuild.mjs` | 97.4% | 97.4% | 89.5% (77/86) | 89.5% (77/86) |
| `ghost/engine.mjs` | 100.0% | 100.0% | 100.0% (29/29) | 100.0% (29/29) |
| `ghost/firearms.mjs` | 100.0% | 100.0% | 100.0% (13/13) | 100.0% (13/13) |
| `ghost/item.mjs` | 100.0% | 100.0% | 88.2% (15/17) | 88.2% (15/17) |
| `ghost/objective.mjs` | 100.0% | 100.0% | 100.0% (6/6) | 100.0% (6/6) |
| `ghost/rotational-bundle.mjs` | 100.0% | 100.0% | 95.7% (22/23) | 95.7% (22/23) |
| `ghost/simple-object.mjs` | 100.0% | 100.0% | 97.0% (33/34) | 97.0% (33/34) |
| `ghost/spring.mjs` | 100.0% | 100.0% | 85.7% (12/14) | 85.7% (12/14) |
| `ghost/verify.mjs` | 66.4% | 66.4% | 91.7% (33/36) | 91.7% (33/36) |
| runtime modules, all | 97.0% | 98.2% | 88.9% (3295/3707) | 92.2% (3757/4077) |

Each branch still uncovered is listed in Appendix B with the reason no
fixture drives it. The reasons fall into five groups:

- a `?? default` arm for a value the wire always carries;
- an install-only or Python path that the port deliberately does not have;
- a CLI path (argument defaults, `--leave-on-stdin`, which reads the
  process's stdin);
- a socket fault that loopback cannot produce;
- a few reachable control-state edges that need a hit on a live enemy to
  record: hit marks, a delta before its baseline, an unparsable vehicle
  body. Kotlin ports these line for line, and they were read side by side.

The full captures, which are not committed, add almost nothing beyond the
committed fixtures: 84.56% becomes 84.6% on sidecar.mjs. The synthetic
scenarios reach what live play does not.

**Kotlin (Kover, JVM tests, `./gradlew :core:koverXmlReport`):** lines
94.0%, branches 79.9%, instructions 92.3%.

- **Kotlin-only paths:** the CLI mains (`SidecarMain`, `JoinMain`,
  `Probe`), `Paths` (the Windows and Wine folders), and `LiveServers`.
  `LiveServers` was 15% covered and had no test; it now has the
  `live-servers.json` fixture against the tray app.
- **Platform code:** `Platform.jvm.kt` is covered at 95% of its lines, and
  the native half by `TcpStressTest` and `WsServerParityTest`.
- **`Sidecar.kt` (93% of lines):** the missed lines are `WsPageHub`, the
  real page socket. It is covered by `WsServerParityTest` through
  `WsServer`, and live by the A/B.

## Full-round differential

Five sessions were recorded on the lab with `page-relay.mjs`. Each was
replayed through Node and through Kotlin on both targets. The player was
`skandia-sc`, with one sidecar joined at a time. The whole captures live in
`~/.cache/bfstats-parity/` (`SIDECAR_PARITY_CAPTURES` runs them); four are
small enough that they are committed under `resources/parity/captures/`
and run in every build.

| capture | what it holds | lines | JVM | linuxX64 | committed |
|---|---|---|---|---|---|
| wake-round | Wake co-op, 12 bots, 15 min: several rounds, a GameStatus 5 and a reconnect-password rejoin, map.html (page-proof) deploying and walking, a Sherman boarded and its pintle panned and fired, a scripted page (chat, radio, reload, seat switch, suicide, a side change, a page join after deploying), 40 deploy/suicide cycles, a page after the rejoin | 286,783 | identical | identical | no (13 MB) |
| levelchange | Wake Conquest then El Alamein then Wake: two server restarts, both rejoined through the reconnect slot, a page side held over a rejoin, a deploy and walk after it | 29,684 | identical | identical | yes |
| vehicle | Wake co-op, no bots: map.html walks to a Sherman, boards it, takes the pintle, pans and fires; the page drives it and gets out | 12,992 | identical | identical | yes |
| anzio | Road to Rome (xpack1) Anzio co-op, 8 bots: deploy, walk, fire, reload, chat, suicide, a side change | 15,035 | identical | identical | yes |
| dc-elalamein | Desert Combat El Alamein co-op: the same page script on a mod server | 14,080 | identical | identical | yes |

The replays exposed four problems, all fixed:

- **The replay clock was not the live clock.** The replay read
  `Date.now()` with fractions of a millisecond, where the live clock reads
  whole ones (`ManualScheduler` and `installFakeTime` gained `floorWall`).
- **The live acks did not fit the replay.** The server's acknowledgements
  name the live run's sequence numbers, so the replay now acks what it sent.
- **The control state carried across a rejoin.** Kotlin kept it in
  `Sidecar` where Node keeps it per `wire()`; the `captureRejoin` fixture
  now guards it.
- **A Node bug in the Desert Combat run.** The level gate asked for the
  base game's tables.

## Live A/B (lab, Wake co-op, 8 bots, 2026-10-26)

`parity/live/ab-session.sh`, run twice against each sidecar, alternating.
The page is the real map.html, headless.

| | Node #1 | kexe #1 | kexe #2 | Node #2 |
|---|---|---|---|---|
| joined, s after start | 9 | 9 | 8 | 8 |
| roster on the page | 8 remotes | 8 | 8 | 8 |
| remotes alive / moved in 10 s | 8 / 5 | 8 / 6 | 8 / 3 | 8 / 4 |
| deployed at | South_Base | The_Airfield | North_Base | North_Base |
| walked, corrections, hard | 20.8 m, 327, 0 | 49.7 m, 142, 0 (killed mid-walk) | 21.9 m, 326, 0 | 22.1 m, 326, 0 |
| residual error at the end | 9.4e-7 m | (dead) | 1.36e-6 m | 1.36e-6 m |
| page vs server position | 0 m | (dead) | 0 m | 0 m |
| Sherman boarded (seat_aim_probe) | yes | yes | no (probe could not reach one) | yes |
| server log: createPlayer, spawn, enterVehicle, chat "ab check", radio, disconnectPlayer 2.5 s after the chat (a clean leave) | all | all | all but enterVehicle | all |
| exit code | 0 | 0 | 0 | 0 |

The server's own event log (`ev_14568-20261026_1641.xml`) has all five
sessions as player 0 `skandia-sc`, each ending in `disconnectPlayer` about
2.5 s after its last chat. That is a clean leave, not the 20 s timeout. The
two missed boardings are the probe's walk failing from a far spawn, once on
each side.

The first native run turned up one difference: `server disconnected us:
PRDisconnect` after its own leave. The receive thread had posted the
server's answer to our Disconnects before the close. That is fixed: a
datagram the loop reaches after close is dropped, as a closed dgram socket
emits nothing.

## Divergences found, and what was done

D1 to D14 are the sidecar glue and page socket, D-T, D-S, D-N, D-R, D-C,
D-Q, D-P and D-E the session and the wire, D-1 to D-12 (C) input and the
writer, D-3 to D-23 (D) the decoders and the level tables, as the auditors
numbered them (Appendix A). F = found by the full-round differential, L = by
the live A/B.

| id | divergence | fix | covered by |
|---|---|---|---|
| K6 | The CLI refused port 14567 (the BF1942 default) without `--force` | guard narrowed to loopback (`127.0.0.1:14567`, the dev PC's server1); public servers on 14567 join as with Node | — |
| D1 | Per-session control-state carry (aim, hull, magazines) lived for the run | moved into `WireState`, per `wire()` | `captureRejoin` |
| D2 | The page socket did not serve the monitor page at `/` | `WsServer` serves `sidecar/page/index.html` (embedded) | `wsserver.json` monitorPage |
| D3 | `--names` control point names copied, so refreshed every level | shared by reference, as Node | `namesGiveUp` |
| D4 | Node raised 'close' twice for a clean page close (**Node bug**) | Node fixed (one close) | `test_sidecar_cli.py`, `wsserver.json` |
| D5 | Upgrade gate: Connection header ignored, empty key accepted, 8 KiB head cap, no Host check | Node's http rules: `Connection: upgrade` + `Upgrade`, `!key` 400, 16 KiB 431, Host required | `wsserver.json` (17 raw-TCP cases) |
| D6 | The socket listened before the session opened, so early pages saw `live` before the header | early pages held and taken in at the feed's start, in order, with their frames | by reading: Node refuses that TCP connect, so there is no Node transcript to match; the held page then gets what a page connecting at open gets |
| D7 | Two fallback warnings on stdout, not stderr | `logErr` (CLI: stderr) | by reading (the fixtures fold both streams into one) |
| D8 | After a refusal or give-up, the app's session kept its socket and timers | the run's end closes them, as `process.exit` | by reading (Android host only; the replays keep them, as Node's faked exit does) |
| D9 | Ctrl-C exited 130 (JVM) or raced (native) | leave, then the run's own exit 0 | live A/B (exit 0) |
| D10 | Empty `--ws`, `--query-port`, `--tables-url` and `--cdkey` were taken; a NaN rejoin horizon ran out at once; a trailing flag took its default in Kotlin but `undefined` in Node (**Node bug**) | empty means none; NaN horizon never runs out; Node `opt` fixed in sidecar.mjs and join.mjs | `test_sidecar_cli.py`, `options` |
| D13 | `rec.cls` when the class is non-null rather than truthy; `cpNames ??` vs truthiness; level-change password text | as Node | `options` |
| D14 | Origin normalising used ASCII whitespace | JS trim and `\s` | `wsserver.json` origins |
| D-T1 | `EventLoop.every` caught up missed ticks after a stall | re-arms from each run, as setInterval | `SchedulerTest` |
| D-S2 | A throw in a loop task was swallowed; Node's process dies | `EventLoop.onUncaught`; `Sidecar` ends the run (exit 1) | `SchedulerTest` |
| D-S1 | Empty cdkey kept, not falling back to `SIDECAR_CDKEY` | as Node, in Session and Sidecar | by reading |
| D-S3 | A level gate settled after queued datagrams; Node settles in a microtask | `Scheduler.microtask` | `SchedulerTest`, session |
| D-N3, D-N4, D-N5 | Disconnect reason range; `0:0:0:0:...` local address; the receive thread spun on a failing socket | as Node; `0.0.0.0`; the error goes to the loop once | session, netconn |
| D-R1, D-R3 | `classifyDisconnect` truthiness; "null" and "17.0" in messages | JS truthiness and string conversion | `rejoin.json` (10 machine scenarios) |
| D-CC1 | `gpmFor` `$` matched before a final newline | `\z` | `content-crc.json` gpmNewline |
| D-C1, D-C2 | cdkeys.json holding null or an array; file mode re-set on every write | held as Node holds it; mode only on creation | `cdkey.json` |
| D-Q1 | A null live-list row | drops the list, as Node | `server-query.json` |
| D-P1 | Colour names on Object.prototype became colours (**Node bug**) | Node fixed (`Object.hasOwn`) | `test_sidecar_plus.py`, `plus.json` |
| D-E1, D-E2 | Typed-array vectors; string bytes by UTF-16 unit | as Node | `events.json` |
| install | objects.rfa and contentCrc32.con never read from a desktop install | ported (install first, then the bundled table) | `objects-checksum.json`, `content-crc.json` fake installs |
| D-3 (D) | Cache fingerprints truncated mtimes; Node rounds | exact mtimes, Node's rounding | `js-ops.json` mtimes, `tables.json` install |
| D-4 (D) | httpGet: no whole-request deadline, no gzip, no http->https redirect, BOM kept | fetch's behaviour on both platforms | `HttpGetTest` (loopback server, Node's fetch expectations) |
| D-5, D-6, D-16, D-17 (D) | No in-flight dedupe; downloaded tables pinned forever; empty ETag sent; non-atomic replace | as Node; pruned; not sent; commented | `tables.json` overlap, noetag |
| D-8, D-9, D-10 (D) | Empty env vars as paths; ASCII `\s`; `$` before newline | as Node | `tables.json` levelKeyJs |
| D-11..D-22 (D) | BitReader NaN or fractional end, rangedBits truncation, -0, projPool netId type, missing classes, empty level base, control body without objects, rebuild without dt | as Node | `ghost-decoders.json`, `tables.json`, `rebuild` |
| D-1 (C) | `buttonMask` split on ASCII whitespace only | `JS_WS` | `input.json` |
| D-9 (C) | `recordFor` cast `action as Double` | `JsOps.num` | `ghost-writer.json` |
| serverMod | The level gate asked for the Challenge's base mod's tables on a mod server (**Node bug**) | gate uses ServerInfo's mod in both copies | `test_sidecar_level_tables.py`, session `modServer` |
| F | The parity clock read fractional ms where live is whole | `floorWall` | all sidecar fixtures |
| L | A datagram read before close was handled after it (a spurious "server disconnected us") | dropped after close | live A/B |
| native | ktor-network sockets lost connections now and then | POSIX sockets | `TcpStressTest`, `WsServerParityTest` |
| join | join.mjs had no Kotlin counterpart; join.mjs wrote to its ended log (**Node bug**) | `tools/JoinCli.kt`, `:core:join`; Node guarded | `join.json` (JoinTest) |
| list | The app's server list: encodeURIComponent, localeCompare order, JSON.parse value rules | as servers.js | `live-servers.json` |
| frames | Server-to-page frames over 125 and 65535 bytes had no Node comparison | — | `wsserver.json` big frames |

## Deliberate differences that remain

Each one is commented where it lives. Each was challenged; the answer is
in the right column.

| difference | where | why it stays |
|---|---|---|
| The page socket listens from `start()` | `Sidecar.listenFeed` | The app needs the port before it opens the WebView. Pages that connect early are now held until Node's moment (D6), so what a page sees is Node's. |
| SIGTERM leaves cleanly (Node dies and leaves the player for about 20 s) | the two mains | The tray app stops the kexe this way. Node's behaviour is a defect, and copying it would cost players a 20 s ghost. |
| A loop task's throw ends the run with its end row and stats, where Node's crash writes neither | `Sidecar.start` (`onUncaught`) | Same exit code and the same end to the session. A recording that closes cleanly is worth keeping. |
| `socket failed` ends the run (exit 1); Node's top-level await would crash | `Sidecar.connect` | Same outcome, without a stack trace. |
| No Python: level tables are never computed from an install; the cache or the published bake answer | `Paths.pythonAvailable` | Phones have no Python. On a desktop, the published bake covers every level the site serves. A custom map with no bake falls back to the saved map, as Node does on a PC without Python. |
| CLI-only install tools are not ported (`installChecksums`, `installRows`, `--build`, derive-children's and verify's mains) | — | Build tooling for this repo, not something a player runs. |
| `JoinConfig` defaults: no recording, port 0 | `JoinConfig` | Android writes no recording; the CLI parser restores Node's defaults. |
| The review log flushes every line | `Review.kt` | Only makes the file more current. |
| Counts in the server list are whole numbers | `LiveServers.kt` | The app draws them as such. Node keeps what `Number()` makes of them, and for the live list's integers that is the same. |
| `localeCompare` is a table of what the list carries (Latin letters and accents, ASCII marks in CLDR root order) | `LiveServers.jsLocaleCompare` | Kotlin/Native has no ICU. Anything outside the table orders by code point after the letters, which affects only the order of empty servers with exotic names. |
| `--leave-on-stdin`: a final `leave` with no newline is still honoured (Node waits for stdin to close) | `SidecarCli` | Only the log reason differs ("asked on stdin" against "stdin closed"); both leave. |
| `cacheDirOverride` and `tablesUrlOverride` are process-wide | `Sidecar.start` | One Sidecar per join, all with the same app folders. |

## How to rerun

From `tools/sidecar-android`:

```bash
parity/regen.sh                                        # every fixture from Node, then jvm + linuxX64
SIDECAR_PARITY_CAPTURES=~/.cache/bfstats-parity ./gradlew :core:jvmTest :core:linuxX64Test   # the whole captures too
./gradlew :core:koverHtmlReport                         # Kotlin coverage (JVM)
```

Node coverage, from `tools/sidecar-android/parity`:

```bash
for f in *.mjs; do NODE_V8_COVERAGE=/tmp/cov node $f; done
cd ../../bf1942-models
npx c8 report --temp-directory /tmp/cov --include 'sidecar/**' --reporter=text
```

A new capture, with the lab up (skill `bf1942-server-lab`):

```bash
node parity/live/page-relay.mjs --to 127.0.0.1:14568 --out ~/.cache/bfstats-parity/<name>/capture.ndjson \
  --page-ws 17996 --script parity/live/page-script.json -- --name skandia-sc --team 2 \
  --out ~/.cache/bfstats-parity/<name>/live.ndjson --review ~/.cache/bfstats-parity/<name>/live.review.ndjson
# pages (map.html, lab probes, parity/live/page-script.mjs) connect to 17996; Ctrl-C the relay to finish
node parity/sidecar-captures.mjs ~/.cache/bfstats-parity     # bakes its tables, writes transcript.json.gz
```

The live A/B: `parity/live/ab-session.sh node <out>` and
`parity/live/ab-session.sh core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe <out>`,
with the viewer served on 5511.

## Appendix A: the symbol maps

The auditors' maps, one row for each Node symbol: its Kotlin counterpart, the
fixture that covers it, and notes. They were written before the fixes. Where
a row says GAP or `none`, the Divergences table above gives what was done.
The rows for symbols ported since then (join.mjs, the monitor page, the
install readers) have been updated. "D" numbers in the notes refer to that
auditor's own list; the Divergences table uses the same numbers.

### The sidecar glue: sidecar.mjs, wsserver, page-team, player-name, review, paths, join

#### sidecar.mjs -> Sidecar.kt, tools/SidecarCli.kt, jvmMain/nativeMain SidecarMain

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `args`, `opt(k,d)` (N:41-43) | `parseSidecarArgs.opt` (SidecarCli.kt:36) | SidecarTest (all args go through the parser) | Node returns `args[i+1]` even when undefined (a trailing flag gives `undefined`, not the default); Kotlin falls back to the default. Divergence D10 |
| `target` (first non-`--` arg, default 127.0.0.1:14567) | SidecarCli.kt:35 | SidecarTest | same rule (a flag value before the target is taken as the target in both) |
| `host`, `port = Number(portStr ?? 14567)` | SidecarCli.kt:39-41 | SidecarTest | Kotlin `.toInt()`: NaN -> 0, fractional truncated (D10) |
| `name` (`--name`, 'sidecar') | `JoinConfig.name`, `Sidecar.name` | SidecarTest | |
| `nameFromPage` (`--name-from-page`) | `JoinConfig.nameFromPage` | namedDenied | |
| `nameWaitS` (`--name-wait`, 15) | `JoinConfig.nameWaitS` | namedDenied (identity arrives first; the timeout never fires) | |
| `team` (`--team`, 0) | `JoinConfig.team` (toInt) | capture/rejoin | NaN/fraction -> int in Kotlin (D10) |
| `stay` (`--stay`, 0) | `JoinConfig.stayS` | none | |
| `stamp`, `outPath`, `reviewPath` defaults | SidecarCli.kt:57-58, `defaultStamp`/`fileStamp` | none (fixtures pass --out/--review) | same UTC `YYYY-MM-DD-HH-MM-SS` shape |
| `wsPort` (`--ws`, null; truthy test) | `JoinConfig.wsPort` (Int?) | all scenarios | `--ws ""`: Node no feed, Kotlin port 0 (D10); JoinConfig default is 0 (Android), CLI null when absent |
| `allowOrigins` (`--allow-origin`, repeatable, value must be truthy) | SidecarCli.kt:46 | none | Kotlin keeps an empty-string value (harmless: normaliseOrigin("") is null) |
| `namesFile` (`--names`) | `JoinConfig.namesFile` | none | |
| `rejoinHorizonS` (`--rejoin-horizon`, 600) | `JoinConfig.rejoinHorizonS` | rejoin (default) | NaN: Node horizon NaN, Kotlin `(NaN*1000).toLong()` = 0 (D10) |
| `connectTimeoutS` (`--connect-timeout`, 10) | `JoinConfig.connectTimeoutS` | namedDenied (3) | |
| `retail` (`--retail`) | `JoinConfig.retail` | none | |
| `inputPace` (`--pace`, 'server') | `JoinConfig.pace` | default only | |
| `wordLog` (`--word-log`) | `JoinConfig.wordLog` | none | |
| `plusVersion` (`--plus-version a.b.c.d`) | SidecarCli.kt:42-45 | none | Node keeps NaN for a non-numeric part (`[2, NaN]`), Kotlin maps it to 0 (D10) |
| `serverPassword` (`--password`) | `JoinConfig.password` | none | |
| `--tables-url` -> `process.env.SIDECAR_TABLES_URL` | `JoinConfig.tablesUrl` -> `LevelTables.tablesUrlOverride` (Sidecar.kt:1038) | none | Node ignores an empty value, Kotlin sets "" (D10); Kotlin override is process-global and never reset |
| `levelWaitMs` (`--level-wait`, env `SIDECAR_LEVEL_WAIT_S`, 30) | `JoinConfig.levelWaitS`, `Sidecar.levelWaitMs` | default only | Kotlin truncates to whole ms (`toLong`) |
| `queryPortOpt` (`--query-port`) | `JoinConfig.queryPort` | none | `""`: Node null, Kotlin 0 |
| `keyFor = cdKeyStore(--cdkey / SIDECAR_CDKEY)` | `Sidecar.keyFor` (Sidecar.kt:209) | all (`--cdkey KEY`) | Kotlin `config.cdkey ?: env` lets `--cdkey ""` through as an override; Node's `opt(...) ? … : {}` drops it. `configDir` (Android) ignores `SIDECAR_CDKEY_FILE` |
| `plusIdentity` (null / `{version}` / undefined) | Sidecar.kt:214 (`PlusIdentity()` for undefined) | capture/rejoin | equivalent: NetConnection turns undefined into `{}` (default version) |
| `names`, `tidNames`, `names.fileTidNames`, `animStates`, `namesAnim`, `serverMod` | Sidecar.kt:215-227 | `--names` none | |
| `outStream`, `outEnded`, `out.write/end` | Sidecar.kt:229-236 | all | Kotlin: `outPath == null` writes nothing (Kotlin-only, Android) |
| `review = new ReviewLog(reviewPath)` | Sidecar.kt:237 | all | |
| `t0`, `now()` | Sidecar.kt:238-240 | all | |
| `ws` | `Sidecar.ws: PageHub?` | all | |
| `createLiveState()` (live, remember, liveSnapshot) | `liveState` | capture (second page's snapshot) | |
| `writeRec` | `writeRec` | all | |
| `stats` | `stats` (Doubles) | all (stats line) | |
| `objInfo`, `pidTeam` | Sidecar.kt:260-261 | capture | |
| `ghosts = new GhostWriter({cpNames: names.cpNames ?? {}})` | Sidecar.kt:263-265 (`LinkedHashMap(copy)`) | capture | copy vs shared object: D3 |
| `levelGate` | `levelGate` (Sidecar.kt:276) | capture/rejoin ("loading"/"level loaded") | Kotlin catches a thrown prepareLevel (commented) |
| `newSession` (incl. `templateExists`) | `newSession` | all | |
| `s` | `s` | all | |
| `PAGE` {INPUT, PING, LEAVE, ACTION} | `PAGE` object | capture | PING (0x03) unhandled in both |
| `inputSender`, `lastPageSeq` | same | capture | |
| `serverState`, `setServerState` | same (+ Kotlin-only `state` getter) | all | |
| `lastSpawn`, `everSpawned` | same | capture/rejoin | |
| `pageTeam = createPageTeam(...)` (send try/catch, log prefix) | Sidecar.kt:335 | capture/rejoin/namedDenied | |
| `teamState()` | `teamState()` | as above | |
| `PULSE_MS`, `pulse`, `oneShot`, `press` | Sidecar.kt:342-352 | capture (reload, seat switch, seat enter) | |
| `pageEdges`, `edgesOf` (SIDECAR_DEBUG one-shot line) | Sidecar.kt:356-362 | capture; SIDECAR_DEBUG line none | |
| `pageSeqBySerial` | same | capture (acks) | |
| `pageGone` | same | capture (0x04, closes) | |
| `ensureSender` incl. `sent` handler, `idleButtons`, rtts carry, "moved" line | Sidecar.kt:376-415 | capture; "moved to the new session" none | |
| `ensureSender` word log (`wall(perfAt)`, `iw`, `im` rows) | Sidecar.kt:404-412 | none | Node's `wall` reads the global `inputSender`, Kotlin the captured sender (no observable effect: old senders are stopped) |
| `actionFromPageBytes` | `actionFromPageBytes(bytes, from)` | capture | |
| `identity` IIFE (`wait`, `settled`, `offer`, `timeout`) | `inner class Identity` (`onSettle` replaces the promise) | namedDenied (offer, ignored); timeout none | |
| `onPageAction`: identity | Sidecar.kt:474 | capture (ignored without flag), namedDenied | |
| `onPageAction`: join | Sidecar.kt:475-484 | all three ("held" in namedDenied, "keeping" in capture) | |
| `onPageAction`: spawn | Sidecar.kt:485-500 | capture (ok, no group), rejoin (ok, kit 999 rejected) | |
| `onPageAction`: seat | Sidecar.kt:503-511 | capture | |
| `onPageAction`: reload | Sidecar.kt:512 | capture | |
| `onPageAction`: suicide | Sidecar.kt:514-519 | capture | |
| `onPageAction`: radio | Sidecar.kt:520-523 | capture | no `s.joined` guard in either |
| `onPageAction`: chat | Sidecar.kt:524-531 | capture (sent; drop/fail lines none) | |
| `stalledWarnAt`, `stalledSeen`, `warnIfStalled` | Sidecar.kt:537-546 | none | |
| `onPageFrame` INPUT / ACTION / LEAVE | Sidecar.kt:548-576 | capture (incl. `{not json`) | |
| `feedStarting`, `startFeed` (WSServer with `staticFile`, refused, connection handler, close handler, listen, "live feed" line) | `listenFeed` + `announceFeed` (Sidecar.kt:581-614) | all three via fake hub; refused none | listen moved to `start()`: deliberate (DD1); `staticFile` GAP (D2) |
| `wire(s)` | `wire(s)` | all | per-wire state: D1 |
| `s.on('open')` | Sidecar.kt:622 | all | |
| `s.on('connected')` | Sidecar.kt:633 | all | |
| `s.on('joined')` (incl. `pageTeam.joined`) | Sidecar.kt:638 | all; "page team at the join" none | |
| `lastServerName` (per wire) | `WireState.lastServerName` | capture, rejoin | |
| `s.on('event')` (raw, serverInfo, serverName, chat->kick notice, setLevel tables/cp/anim, tmpl, weaponName, statics=0, pidTeam, objInfo, cls, control team, ghosts.note, extras) | `onEvent` (Sidecar.kt:707) | capture/rejoin: setLevel, anim, cls, kick notice; raw, weaponName, cp fallback, `--names` merge, statics=0 none | stderr vs stdout: D7; cpNames sharing: D3 |
| `s.on('unknown-event')` | Sidecar.kt:654 | none | |
| `s.on('ghost')` | Sidecar.kt:661 | capture (ghost-record rows); `raw` none | Node spreads `{seq,tick,...r}`; records carry neither key, so passing g's is equivalent |
| `r4`, `r6` (per wire) | `r4`, `r6` (class) | capture | |
| `selfAim`, `selfAimOf` (per wire) | `selfAim` (class) + `carrySelfAim` | capture | D1 |
| `selfHullState`, `carryHullState` (per wire) | Sidecar.kt:783-807 (class) | none (infantry only: no hp3/heng in fixture) | D1 |
| `selfMags` (per wire) | Sidecar.kt:784 (class) | none (no hmag) | D1 |
| `s.on('control-state')` (hitMark, no-baseline, decodeError, controlHp, pathAt, bundles/aim/aimSpeed, `iq` row with ha/hs/tr/mg/ld/hd/rt, ack row with sq/st/ld/hp/aim/hull/haim/hspd/hmag) | `onControlState` (Sidecar.kt:809) | capture: iq rows (523), acks (160), ld; hitMark, tr, mg, rt, hull, haim, hmag, decode-error none | |
| `s.on('pong')` | Sidecar.kt:677 | capture (implicitly via rt? "rt"=0 lines) | |
| `s.on('unknown-datagram')` | Sidecar.kt:678 | none | |
| `s.on('decode-error')` | Sidecar.kt:679 | none | |
| `s.on('plus-settings')` | Sidecar.kt:680 | none | |
| `s.on('level-hold')` | Sidecar.kt:687 | capture, rejoin | |
| `s.on('level-release')` | Sidecar.kt:688 | capture, rejoin (timed-out branch none) | |
| `s.on('skip-static-objects')` | Sidecar.kt:693 | none | |
| `s.on('level-change')` | Sidecar.kt:694 | rejoin | Kotlin prints "(none)" for a non-string password (Node prints it) |
| `s.on('denied')` | Sidecar.kt:697 | namedDenied | |
| `s.on('disconnected')` | `onDisconnected` (Sidecar.kt:891) | rejoin (level change + final kick) | |
| `opened` | `opened` | all | |
| `KICK_NOTICE_MS`, `kickNotice`, `noteKickNotice` | Sidecar.kt:934-943 (`kickNoticeAt` split out) | rejoin | |
| `current()` | inlined `sess !== s` | rejoin | |
| `rejoiner = new Rejoiner({...RESTART, horizonMs, probe, connect})` | Sidecar.kt:949-987 | rejoin | Kotlin passes only firstProbeMs/probeMs (the RESTART objects hold nothing else) |
| `rejoiner.on('probe')` | yes | rejoin | |
| `rejoiner.on('attempt')` | yes | rejoin | |
| `rejoiner.on('retry')` | yes | none | |
| `rejoiner.on('rejoined')` | yes | rejoin | |
| `rejoiner.on('give-up')` | yes | none | |
| `finished`, `stayTimer`, `connectTimer`, `finish` | Sidecar.kt:990-1011 | all (exit line) | D8 |
| `started`, `leaving`, `leaveNow` | Sidecar.kt:1016-1024 | capture (sigint) | |
| `process.on('SIGINT')` | `Sidecar.leave()` from jvm shutdown hook / native SIGINT+SIGTERM watcher | capture (`sigint` op calls `leave()`) | exit code and SIGTERM: D9 |
| `--leave-on-stdin` | SidecarCli.kt:107-115 | none | final line without newline: D11 |
| name-from-page boot (`startFeed` or "needs --ws" + timeout) | `boot()` (Sidecar.kt:1049-1052) | namedDenied | |
| `nameTimer` | `nameTimer` | namedDenied (cancelled) | |
| `prejoin` (`--no-prejoin`, `queryServerLevel`, `prepareLevel`, two log lines) | `boot()` prejoin half (Sidecar.kt:1059-1077) | none (all scenarios pass --no-prejoin; test stub returns null) | |
| `await identity.wait` -> name, `s.name`, "player name" line | `onName` | all | |
| `await prejoin`; `if (leaving) hang`; `started = true; await s.start()` | `next()` x2 -> `connect()` | all | Kotlin-only "socket failed" finish(1): K1 |
| connect timer ("no answer", `unreachable`) | Sidecar.kt:1105-1109 | namedDenied | |
| stay timer | Sidecar.kt:1110 | none | |
| (Kotlin-only) `JoinConfig.mapId/mapName/gameType`, `cacheDir`, `configDir`; `PageHub`, `WsPageHub`, `SidecarHost`, `wsBoundPort`, `state`, `done`, `start()`, `stop()`, `onLoop`, `viewerUrl` | Sidecar.kt | n/a | K2-K5 |
| (Kotlin-only) `--force` refusal of port 14567 | SidecarCli.kt:85-88 | n/a | K6 |

#### wsserver.mjs -> WsServer.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `GUID` | `GUID` | WsServerTest.acceptKeyIsTheRfcExample | |
| `ALLOWED_ORIGINS` | `ALLOWED_ORIGINS` | WsServerTest.originRules | same four |
| `LOCAL_ORIGIN` | `LOCAL_ORIGIN` | WsServerTest.originRules | |
| `normaliseOrigin` | `normaliseOrigin` | WsServerTest.originRules (hand-typed, no Node fixture) | `\s` and `trim` are Unicode in JS, ASCII-ish in Kotlin/Java (D14) |
| `originAllowed` | `originAllowed` | WsServerTest.originRules | |
| `Socket` class | `WsSocket` | WsServerTest.echoes | |
| `Socket._onData` (close/ping/text/binary) | `WsSocket.readLoop` + `readFrame` | WsServerTest.echoes (text only) | Kotlin 16 MiB frame cap (K7) |
| `Socket.send` (text or Buffer) | `WsSocket.send(String)` / `send(ByteArray)` | echoes | |
| `Socket.close` | `WsSocket.close` | none | Node emits 'close' twice on a clean close (D4) |
| `WSServer` ctor (port, host, allowOrigins, staticFile) | `WsServer(port, host, allowOrigins, staticPage)` (fixed, D2) | wsserver.json | |
| `WSServer.listen` | `WsServer.listen` (returns port) | echoes | |
| `WSServer._onHttp` (serve page/index.html at `/` and `/index.html`, else 404) | `handle` non-upgrade branch, `staticPage` (fixed, D2) | wsserver.json | |
| `WSServer._onUpgrade` (origin 403, missing key 400, 101) | `handle` | refusesAStrayOrigin, echoes | upgrade detection and empty key differ (D5) |
| `WSServer.broadcast` | `broadcast(String)` / `broadcast(ByteArray)` | via Sidecar fake only | |
| `WSServer.close` | `close` | none | |
| `WSServer.clients` (Set) | `clients` (snapshot list) | | |
| emitted `refused`, `connection` | `onRefused`, `onConnection` | refused: none at Sidecar level | |
| `encodeFrame` | `encodeFrame` | framesRoundTrip | Node writes the 64-bit length as two u32, Kotlin 8 shifts: same bytes |
| `decodeFrame` | `readFrame` (blocking reader) | framesRoundTrip | |
| (Kotlin-only) `acceptKey`, `readHttpHead` (8 KiB cap), `WsPageHub` per-socket writer threads, 5 s connection hand-off latch | | | K7, K8 |

#### page-team.mjs -> PageTeam.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `side(t)` | `side(t: Double)` | SmallModulesTest.pageTeam (teams 0,1,2,3,-1,1.5,'2','1',null,'x',true) | |
| `createPageTeam({send, log})` | `createPageTeam(send, log)` / `class PageTeam` | same | |
| `held` (closure) / `get held()` | `PageTeam.held` | same | |
| `apply(team, state)` | `PageTeam.apply` | same | |
| `offer(team, state)` | `PageTeam.offer` | same | |
| `joined(state)` | `PageTeam.joined` | same | |
| (state object) | `TeamState` | | |
No divergence found.

#### player-name.mjs -> PlayerName.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `SERVER_NAME_BYTES` | `SERVER_NAME_BYTES` | SmallModulesTest.playerNames | |
| `validPlayerName` | `validPlayerName` | SmallModulesTest.playerNames (435 strings incl. JS-trim spaces, surrogates, latin1 edge; 3 non-strings) | uses `JsOps.trim`/`trimEnd` as documented |
No divergence found.

#### review.mjs -> Review.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `ReviewLog` ctor (path, stream, counts, eventIds, ghostNetIds, ghostLens, started) | `ReviewLog(path, clock, out)` | SmallModulesTest.reviewLog | Kotlin `path == null` -> no file (Node too) |
| `_bump` | `bump` | same | |
| `_write` (tag, dt, ...rec) | `write` | same | Kotlin flushes every line (documented) |
| `unknownEvent` | `unknownEvent(id, seq, block, bitOffset, hex)` | same | Node throws on `id` undefined (`id.toString`), Kotlin prints `0xNaN`-style via `JsOps.hex`; unreachable from Session |
| `ghostRecord` | `ghostRecord(...)` | same (120 real records + null/absent bodyBits) | |
| `ghostBlockRaw` | `ghostBlockRaw` | same | |
| `unknownDatagram` | `unknownDatagram` | same | same `type` undefined note |
| `decodeError` | `decodeError` | same | |
| `summary` (`top`) | `summary` | same (summaries every 40 ops) | |
| `close` | `close` | same | |
No divergence found.

#### paths.mjs -> Paths.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `win(platform)` | `win()` / `Paths.win` | none | |
| `cacheDir({env, platform, home})` | top-level `cacheDir(env, platform, home)` and `Paths.cacheDir()` | none (no Node fixture) | two copies; `Paths.cacheDir` uses `?:` where Node uses `||` (D12) |
| `configDir` | top-level `configDir` | none | `path.win32.join` normalisation not ported (documented) |
| `defaultGameDirs` | `Paths.defaultGameDirs()` | none | `?:` vs `||` for `ProgramFiles(x86)`, `ProgramFiles`, `WINEPREFIX` (D12) |
| `gameDir` (`BF1942_DIR`) | `Paths.gameDir()` | none | adds `gameDirOverride`, `lookForInstall` (documented) |
| `pythonCommand` (`SIDECAR_PYTHON`) | inlined in `Paths.pythonAvailable` | none | GAP as a function |
| `pythonAvailable` (memoised spawn) | `Paths.pythonAvailable()` STUB, always `ok=false` | none | DD4 |
| `resetPythonProbe` | GAP | none | test-only in Node |
| env `SIDECAR_CACHE` | both copies | none | |
| (Kotlin-only) `Paths.cacheDirOverride`, `Paths.env` | | | documented |

#### join.mjs -> (none)

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| `join.mjs` whole CLI (target/opt, `--name`, `--team`, `--stay` default 30, `--log`, `--verbose`, `--password`, `--cdkey`; `log(kind, rec)`; Session listeners open/connected/joined/event/unknown-event/unknown-datagram/decode-error/ghost/denied/disconnected/stats; `finish`; SIGINT) | `tools/JoinCli.kt` (ported in this audit) | join.json (JoinTest) | `tools/Probe.kt` is NOT a counterpart: it drives `NetConnection` directly (no Session, no events, no world dump), takes `HOST PORT [--info-only] [--password] [--force]`, never stays joined, prints raw datagram heads, and writes no NDJSON log. It is a wire-layer smoke test of its own design. |

### The session and the wire: session, netconn, events, plus, rejoin, chat, cdkey, server-query, objects-checksum, content-crc, Emitter, timers

#### events.mjs -> Events.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| EVENT_TYPE_BITS (rangedBits(0,0x40)) | EVENT_TYPE_BITS = 7 | P/events.mjs `eventTypeBits`, T/EventsTest | hard-coded 7, which is correct |
| BLOCK_COUNT_BITS, BLOCK_INDEX_BITS, MAX_EVENTS_PER_BLOCK | same | events.json blocks/errors (block254/255) | |
| field kinds u/s/b/f/bytes/str/lstr/ranged/vec3 | sealed FieldKind | encode/decode | |
| EVENTS table (all 58 entries, ids, addrs, field order) | EVENTS LinkedHashMap | `names` [name,id,addr] | ids, addrs, order and field lists match line for line |
| HUDText read/write | HUDText | decode + encode custom bodies | |
| CreateStaticObject read/write | same | decode + encode edges | |
| UpdateStaticObject read/write | same | decode + encode (`action:'3'`) | `!==` maps to JsOps.eq, which is strict |
| CreateObject, Map, Challenge, CheckSum, GameStatus, ScoreMsg, PBFragment, Stats* (read only) | same | decode; errors (CreateObject, Map, GameStatus have no writer) | |
| ChatFragment read/write | same | decode + encode | |
| EVENT_BY_ID | EVENT_BY_ID (Map<Int,EventDef>) | decode with unknown ids | |
| readVec3 / writeVec3 | readVec3 / writeVec3 | encode edges (`'ab'`, `{0:1}`, `[null,'2',3]`) | see D-E1 |
| readStats | readStats | decode | |
| readField / writeField | readField / writeField + uint8From | encode | see D-E2 |
| readEvent | readEvent (+EventError) | decode, windows | |
| writeEvent | writeEvent | encode, errors | |
| readEventBlock / writeEventBlock | same (+EventBlock class) | blocks | |
| writeActionBlock | writeActionBlock | actions | |
| re-export BitReader/BitWriter | (package-level classes) | n/a | |

#### session.mjs -> Session.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| SERVER_EXE_CHECKSUM | same (private) | session helpers | |
| CLIENT_PUNKBUSTER | same | session transcripts | |
| STREAM | object STREAM | transcripts (malformed) | Node only exports it; Kotlin has it public too |
| MASK_BITS | same | | |
| contentAck | contentAck | P/session.mjs `contentAck` | |
| challengeResponses | challengeResponses (+randomInt) | `challengeResponses`, xpackJoin | |
| EVENT_WINDOW, eventWindowFull | same | `eventWindowFull`, window scenario | |
| Session ctor opts (name, team, password, reconnectPassword, plus, templateExists, keyFor, cdkey, checksumFor, contentCrcFor, silenceMs, animStates, levelGate, levelHoldMs) | SessionOptions | transcripts | see D-S1 (cdkey "") |
| start() | start() | all scenarios | sync vs async, see D-S6 |
| _checkQuiet | checkQuiet | chatQuiet | |
| leave | leave | capture, gate* | |
| close | close | malformed | |
| queue | queue | window | |
| restartTiming | restartTiming | final state line `restart` | |
| _wire | wire | all | |
| _flush | flush | window | see D-S2 (throw in a timer) |
| _onStatus | onStatus | window | |
| _onData | onData | malformed | |
| _readEvents | readEvents | malformed (unknown id, short block) | |
| _deliver | deliver | xpackJoin (resend, out of order) | |
| _pump | pump | gate* | |
| _holdLevel (promise) | holdLevel + HoldDone (callback) | gateTimeout/Throws/None, capture | see D-S3 |
| _readGhosts | readGhosts | capture, malformed | |
| _decodeControl | decodeControl | capture | |
| _controlRecord | controlRecord | capture | |
| _handle (Challenge, CreatePlayer, DestroyPlayer, SetTeam, GameStatus, ChatFragment, WelcomeMsg, SpecialGame, ServerInfo, SetLevel, SetDefaultVehicle, CreateObject, DestroyObject, DataBaseComplete, Simulation) | handle (same cases) | capture, xpackJoin, chatQuiet | every case is present; ChatFragment goes through chatPiece() |
| hexFrom, bitSliceHex | same | malformed | |
| (none) | jsValue, LevelGate, SessionMe, PlusState, chatPiece, chatOut wrapper | | Kotlin only; each has a comment |

#### netconn.mjs -> NetConn.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| PT | object PT | netconn.json | |
| PRESULT | PRESULT (Map<Long,String>) + presultName | `presultNamesAndConstants` | `0x-1` for -1 matches |
| PROTOCOL_MAJOR/MINOR, MAX_DATAGRAM, MAX_PAYLOAD, SEQ_MASK, SEQ_HALF | same | constants | |
| buildConnectRequest | buildConnectRequest | `connectRequestBytes` | |
| buildServerInfoRequest, parseServerInfo | same | `serverInfoParse` | |
| probeServerInfo (promise) | probeServerInfo (blocking) + probeServerInfoAsync (loop) | T/NetConnSocketTest `probeServerInfoMatchesNode` | |
| NetConnection ctor (password, reconnectPassword, plus, log, env SIDECAR_LAG_MS/JITTER_MS/LOSS) | NetConnection + PathFaults.fromEnv + `random` | `labKnobsFromEnv`, scripts.labKnobs/lagOnly | |
| now | now | scripts | |
| bind | bind | NetConnSocketTest | see D-N4 |
| close | close | scripts.goodbye | |
| connect | connect | handshake, passwords | interval: see D-T1 |
| _onConnectAccept | onConnectAccept | handshake, retail, customPlus | |
| disconnect | disconnect | goodbye, longMessage | see D-N3 |
| sendData | sendData (+InputConn overload) | window, ackAhead | |
| pingRequest, _pingResponse | same | scripts | |
| _header, _raw, _pathDelay, _send | same | labKnobs, lagOnly | |
| _onDatagram (every case) | onDatagram | scripts | see D-N1 |
| _accountSeq, _confirm | same | window, ackAhead | |
| cstr | (BitStream cstr) | | |
| (none) | Transport, UdpTransport, NetStats, PathFaults | | Kotlin only; each has a comment |

#### plus.mjs -> Plus.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| PLUS_PROTOCOL_VERSION, PLUS_VERSION | same (+PlusVersion, PlusIdentity) | plus.json | |
| crc8 | crc8(bytes, from, to) | plus.json | |
| buildPlusAcceptAck, parsePlusAcceptAck | same | plus.json | |
| INVALID_COLOR, WEBCOLORS | same | colours | see D-P1 |
| colorFromString | colorFromString | plus.json | |
| strtol10 | strtol10 | settings cases | |
| defaultServerSettings | ServerSettings / defaultServerSettings | settings | classes with toJs() |
| nextParameter | nextParameter | settings | |
| parseServerSettings | parseServerSettings | settings, xpackJoin | |
| RETAIL_RESTART, PLUS_RESTART, restartTiming | same | plus.json | |

#### rejoin.mjs -> Rejoin.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| DISCONNECT | object DISCONNECT | `classification` | |
| FINAL_DENIALS, denialIsFinal | same | classification | |
| classifyDisconnect | classifyDisconnect | classification | see D-R1 |
| rejoinable | rejoinable | classification | |
| BOX_CODE, BOX_LINE, BOX_DEFAULT, retailDisconnectBox | same | `boxesAndDenials` | |
| DISCONNECT_TITLE | same | boxesAndDenials | |
| FAILED, retailDenial, DENIAL_TEXT | same | boxesAndDenials | |
| kickNoticeFor | kickNoticeFor (+KickNotice) | `kickNotices` | \b written as lookarounds |
| describeDisconnect | describeDisconnect | boxesAndDenials | |
| reconnectFromGameStatus(ev) | reconnectFromGameStatus(status, extra, text) | `gameStatusFive` | |
| realTimers | Scheduler | | |
| Rejoiner (start, stop, _schedule, _elapsed, _probeTick, _nextDelay, _attempt, _armAttempt, _retry, _fail, _dropSession, _clearTimers, active) | Rejoiner (same methods) | `stateMachine` | see D-R2, D-R3 |
| (none) | RejoinTarget, Rejoiner.truthy | | |

#### chat.mjs -> Chat.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| CHAT_PIECE, CHAT_MAX, CHAT_QUEUE, CHAT_PIECE_MS, CHAT_RECV_MAX | same | chat.json | |
| chatBytes | chatBytes | chat.json | surrogate handling matches /u |
| chatFragments | chatFragments (+ChatPiece) | chat.json | |
| ChatAssembler (reset, push) | ChatAssembler (+ChatLine) | lab capture + refusals | |
| ChatSender (say, pump, stop; now/setTimer injectable) | ChatSender(queue, Scheduler, pieceMs) | sender pace/queue; chatQuiet | |

#### cdkey.mjs -> CdKey.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| KEY_HASH_BYTES, md5hex | same | cdkey.json | |
| challengeString | challengeString(bytes, mod) | cdkey.json | |
| retailRand | retailRand(randomInt) | seeded | |
| keyHashResponse | keyHashResponse (ByteArray and String overloads) | fixed r | |
| generateCdKey | generateCdKey(randomInt) | seeded | |
| keyFile | defaultKeyFile | config dirs | |
| cdKeyStore | cdKeyStore (+prettyJson) | store file across runs, exact bytes | see D-C1 and D-C2 |

#### server-query.mjs -> ServerQuery.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| DEFAULT_LIVE_LIST | same | | |
| parseGamespy | parseGamespy | `parsers` | |
| levelFromGamespy, levelFromLiveRow | same | parsers | |
| gamespyStatus | gamespyStatus (blocking) | `gamespyStatusOverUdp` | |
| liveListRow | liveListRow (+httpFetch, jsonToJs, jsNumberOf) | queryServerLevel stand-ins | see D-Q1 |
| queryServerLevel | queryServerLevel (+`gamespy` injectable) | `queryServerLevelAgainstStandIns` | |

#### objects-checksum.mjs -> ObjectsChecksum.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| TABLE, crc32Bzip2 | CRC_TABLE, crc32Bzip2 | objects-checksum.json | |
| gameDir | n/a | | stub |
| resolveCi | `ObjectsChecksum.resolveCi` (ported in this audit) | objects-checksum.json installTree | |
| bundledChecksums | bundledChecksums (filters to integers, returns Long) | objects-checksum.json | the return shape differs from Node's raw object |
| installChecksum | stub returning null | none | install only |
| objectsChecksum | objectsChecksum | objects-checksum.json | see D-O1 |
| installChecksums, --build CLI | GAP | none | install only |

#### content-crc.mjs -> ContentCrc.kt

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| GPM, gpmFor | same | content-crc.json | see D-CC1 |
| levelName | levelName | content-crc.json | |
| parseContentCrc32 | parseContentCrc32 | content-crc.json | |
| bundledRows | bundledRows (+bundledContentRows for the test) | content-crc.json | |
| rowsFor, files cache | `ContentCrc.rowsFor` (ported in this audit) | content-crc.json install | installRows and --build: CLI tooling, not ported |
| contentCrc | contentCrc (flattened args) | content-crc.json | install branch stubbed |

#### EventEmitter -> Emitter.kt, timers -> Scheduler.kt

| Node | Kotlin | covered by | notes |
|---|---|---|---|
| EventEmitter on/emit/listenerCount | Emitter.on/emit/listenerCount | indirectly by every transcript | |
| removeListener | off | none | see D-T4 |
| once | GAP | | used only by netconn bind's socket, not on an Emitter |
| emit('error') with no listener throws | returns false | none | none of these modules emits 'error' |
| setTimeout/clearTimeout | Scheduler.schedule / Cancellable | SchedulerTest | |
| setInterval | Scheduler.every (EventLoop: fixedRate) | SchedulerTest (only that it ticks) | see D-T1 |
| setImmediate / microtask | post | | see D-S3 |
| unref | none | | not used in these modules |
| Date.now / performance.now | Clock.wallMs / monoMs, Scheduler.now() floors | | |

### Input and the recording: input, live-snapshot, record, ghost-writer

#### input.mjs -> Input.kt (fixture `parity/input.mjs` -> `InputTest.kt`)

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| STREAM_INPUT, ACTION_BITS, MAX_ACTIONS_PER_PACKET | same consts | input pure.constants | equal |
| PACE_IMMEDIATE, PACE_SLOT, RELEASED_KEEP, SQ_MARGIN_MS, RTT_KEEP, PACE_BURST, MERGE_ABOVE, SERVER_KEEP, SERVER_SEND_MS, SERVER_READ_MS | same private consts | scripts + sims (indirect) | PACE_BURST/MERGE_ABOVE typed Double, same values |
| SERIAL_MAX, DEFAULT_SERIAL | same (Long) | pure.constants | |
| AXIS, AXIS_NAMES, AXIS_BITS/MAX/SCALE/CENTRE/FULL/SATURATE | `object AXIS`, `AXIS_NAMES`, consts | pure.constants | |
| encodeAxis | `encodeAxis` | pure.encodeAxis, encodeAxisOdd | JsOps.toNumber / JsOps.round / JS Math.max/min (NaN propagates); match |
| decodeAxis | `decodeAxis` | pure.decodeAxis | -0 kept by JsOps.round; match |
| BUTTON | `object BUTTON` + `BUTTON.byName` (LinkedHashMap, Node order) | pure.constants | |
| BUTTON_CHANNEL | `BUTTON_CHANNEL` | pure.constants | |
| CAMEL_TO_SNAKE | `CAMEL_TO_SNAKE` | pure.buttonMask | |
| buttonMask | `buttonMask` | pure.buttonMask (28 specs) | **D-1**: the split regex's `\s` is not JS's |
| lookupButton | `lookupButton` | pure.buttonMask | JS replaces per UTF-16 unit, Kotlin per code point; no observable difference (the CAMEL fallback strips `_`) |
| ZERO_ACTION (frozen) | `ZERO_ACTION` (DoubleArray, mutable) | scripts (`enqz`) | not frozen; nothing writes into `.axes` today (grep), so no divergence |
| encodeAction | `encodeAction` | pure.shapes | **D-2** (null input) |
| actionFor | `actionFor` | pure.shapes | **D-2** (null input) |
| ENCODED_KEYS, isEncodedShape | same | pure.shapes | |
| normaliseAction | `normaliseAction` | pure.shapes | |
| inputPayload | `inputPayload` | pure.payload, selfTest | passes `toInt32(firstSerial)`; serial <= SERIAL_MAX, so the same |
| decodeInputBlock | `decodeInputBlock` | pure.payload | key order mask,count,actions,firstSerial,bits matches; per action axes,buttons,serial,channels |
| TICK_RATE, MAX_RATE | same | constants | |
| InputSender ctor/options | `InputSender` + `InputSenderOptions` | scripts `new`, badOptions | `maxQueue` is Int (Node allows Infinity or a fraction); `opts.rate ?:` defaults only on null, not on a passed `Undefined` |
| noteRtt, rttMs | same | scripts `internet`, `rtt` ops | |
| _mayRelease, _spend, _serverHeld, _drain | same | scripts + sims | arithmetic order identical |
| _noteReleased | same | scripts | |
| atAck | `atAck(serial: Long, tick: Double?)` | scripts `atAck`, `internet`, sims | |
| enqueue | same | scripts, sims | |
| _mergePending | same | script `merge` | int32/uint32 handled via u32 on Longs; match |
| _flushWords | same | scripts `failures`, `joinLate` | catches `Exception`, not Throwable (Node catches anything); no practical difference |
| periodMs, running | same | snapshot | |
| setInput, setAction | same | `set` op; setAction: none | |
| press, release | same (inline `_decodeCurrent`) | `press`/`release` ops | `_decodeCurrent` is inlined, not a separate method (cosmetic) |
| start, stop | same, via `scheduler.every` | `start`/`stop` ops | **D-6** (setInterval vs fixed-rate; listener copy) |
| on, _emit | same | all scripts | **D-5** (Kotlin iterates a copy) |
| _pump, _tick | same | scripts `fallBehind`, idle-*, sims | |
| ONE_SHOT_BUTTONS, TOGGLE_STATE_BUTTONS | same | pure.constants | |
| PageButtonEdges | same | pure.edges | |
| holdOf | same | pure.holdOf | |
| clampRate | same | badOptions | |
| actionIndexOf | same | pure.actionIndexOf | |
| serialNewer, nextSerial | same (internal) | scripts (wrap via firstSerial SERIAL_MAX in payload) | |
| SPAWN_GROUP_MAX, TEAMS | same | constants | |
| requirePlayer | same | teams | |
| sendTeam, sendKit, sendSpawnRequest | same | teams | |
| sendChat | `sendChat(session, text, team)` | teams | **D-4** (missing chatOut: InputError, not TypeError) |
| delay, spawnSequence (async) | `spawnSequence(..., scheduler, done)` + `SpawnOptions` | teams.spawnSequence | **D-3** (negative stepMs) |
| selfTest | `selfTest(verbose)` -> `SelfTestResult` | pure.selfTest + selfTestPassesAsNodes | println instead of console.log |
| default export | n/a | n/a | not needed |
| (env) SIDECAR_LAG_MS / JITTER_MS / LOSS, netconn.mjs:130-132, :290-293 | `PathFaults.fromEnv`, `NetConnection.pathDelay` NetConn.kt:202-213, 415-418 | netconn.mjs / session.mjs fixtures (NetConnTest, SessionTest) | **D-7** (Node timer clamping) |
| `--word-log`, sidecar.mjs:83-87, 297-303 | Sidecar.kt:66-67, 404-411 | none | same rows (`+x.toFixed(4)` = `JsOps.toFixed`, key order k,s,q,idle,r,l / k,t,s,n) |

Kotlin with no Node counterpart: `InputError`, `u32`, `i32`, `typeOf`, `Action` (`toJs`, `asInput`), `centres`, `indexOf`, `asMap`,
`InputConn`/`InputPlayer`/`ChatOut`/`InputSession`, `InputSenderOptions`, `InputStats`, `InputPath`, `Word`, `Released`, `AckPath`,
`SpawnOptions`, `SelfTestResult`. All covered by the header "Port notes" (objects as maps, axes as doubles, buttons as Long, clocks
and timers through the Scheduler). `asMap`'s "anything not a map is an empty map" has no comment. It causes D-2.

#### live-snapshot.mjs -> LiveSnapshot.kt (fixture `parity/live-snapshot.mjs` -> `LiveSnapshotTest.kt`: 3 recorded sessions at 12 cuts each, plus join-state cases)

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| createLiveState | `createLiveState()` -> `LiveState` | both tests | class instead of closure |
| `live` object | `class Live` | both | every Map is a LinkedHashMap and outOfScope is a LinkedHashSet. A re-set keeps its slot, and delete then set moves the key to the end, as in JS |
| LIVE_EVENTS, LIVE_REORDER | same sets | cases | |
| setLevel key regex | `KEEP_AT_LEVEL` | cases | |
| remember (h, anim, o, d, s, st, a, g, j/jn, ps, tk/win) | `remember` | recordings + cases | **D-8** (a non-array `o.o`) |
| remember 'e' branch | `rememberEvent` (split out) | recordings + cases | branch order identical; strict `===` via JsOps.eq; keys via JsOps.str |
| projPool loop | same, Double counter | cases | fractional count iterates as JS does |
| liveSnapshot | `liveSnapshot` | both | run-merge (<=15), row key orders, body `seat` only when non-null; `Js.stringify` omits Undefined (a pool-rewritten k:"o" whose old row had no `t`) |

Kotlin with no Node counterpart: `Live`, `LiveBody`, `LiveRound`, and the extension helpers `at`, `field`, `item`, `list`, `k`, `s`, `eq`, `or`.
The "Port notes" header justifies them.

#### record.mjs -> Record.kt (fixture: `parity/ghost-writer.mjs` 'recordFor' (every event type) and 'header' -> `GhostWriterTest.kt`)

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| V | `Record.V` | recordFor | |
| STATIC_ACTIONS | same | recordFor | |
| recordFor (all 40 cases, default null, the undefined cases) | `Record.recordFor` | recordFor | Undefined for the silent cases, null for unmapped; **D-9** (the action lookup) |
| round2, round3 | same | recordFor | |
| header | `Record.header(hz, extra, now)` | header | `JsOps.spread` reorders integer-like keys as an object spread does |

Kotlin with no Node counterpart: `slice0` (commented: JS slice end semantics) and `mapList`.

#### ghost-writer.mjs -> GhostWriter.kt (fixture `parity/ghost-writer.mjs` + `ghost-writer.script.json` -> `GhostWriterTest.kt`; indirectly `RebuildTest.kt` through Rebuild.kt's GhostWriter)

| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| VIEW_PITCH_PER_AIM, VIEW_TWIST_PER_AIM, EYE_HEIGHT, FIRE_STATE | `GhostRows.*` | script | |
| recoilAgo | `GhostRows.recoilAgo` | 'recoilAgo' whole domain | |
| animNamer | `GhostRows.animNamer` | 'animNamer' (table swap) | `seenSet` flag instead of `seen = null`, the same result. **D-10** (a null table entry) |
| PLAYER_STATS | `GhostRows.PLAYER_STATS` | script (BFPlayer) | `Player.STAT_FIELDS` has all nine plus score, so the `!!` is safe |
| controlMagazines | `GhostRows.controlMagazines` | 'controlMagazines' | |
| GhostWriter ctor and state maps | `GhostWriter(...)` | script | the iterated ones (inScope, occupant) are Linked*. The others are only looked up, so a HashMap is fine. Keys go through JsOps.key |
| note, _sit, _leave, _occupantAt | `note`, `sit`, `leave`, `occupantAt` | script (ResetMap, destroyObject, exit hand-back) | **D-11** (a null `t`) |
| block | `block` | script, RebuildTest | branch order and row key order match. `tick` after `t` in s/st/j |
| controlHp | `controlHp` | 'controlHp', 'scopeOutHp' | |
| _engines | `engines` | script (engine running word) | prev.running starts Undefined, so the first row always writes, as in Node |
| _joints | `joints` | script (Daihatsu ramp) | the `rest = 0` destructuring default is reproduced |
| _handFire, _handLine, _lineFrom | `handFire`, `handLine`, `lineFrom` | script soldier rows, 'selfAim' | JsOps.pow / sin / cos are V8-exact |
| _muzzle | `muzzle` | own-vehicle-fire case | |
| _fires | `fires` | own-vehicle-fire case, script | NaN `muzzles` gives zero rounds in both |
| HISTORY, pushRecent, recentAt, qNlerp, qMul, qRotate | `GhostRows.*` | indirect | qNlerp `|| 1` reproduced for 0 and NaN |

Kotlin with no Node counterpart: `GhostRows` (namespace), `Timed`, `Pose`, `Fire`, `Aim`, `RoundState`, `Seated`, `JointState`, `bump`,
`k`, `d`, `fx`. These are typed holders for Node's object literals. There is no comment justifying them, but they are plainly
mechanical. `d()` (list to DoubleArray, a non-number becoming NaN) causes D-12.

### The decoders and the level tables: bitstream, body-decoder, soldier-ghost, names, template-class, template-table, level-tables, game-tables, ghost/*, rebuild

#### bitstream.mjs -> K:BitStream.kt (+ JsOps.kt helpers)
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| COMPRESSION_BITS | BitStream.kt `COMPRESSION_BITS` | ghost-decoders (indirect) | |
| rangedBits | BitStream.kt `rangedBits(Long,Long)`; JsOps.kt `JsOps.rangedBits(Double,Double)` | js-ops (JsOpsTest, both edges incl. 2^32, NaN) | Two copies. The Long one truncates fractional bounds (see D-12). |
| BitWriter ctor/byteLength/bytes | `BitWriter` | events | `bytes()` copies; Node returns a live subarray view |
| writeBit/writeUnsigned/writeSigned/writeBool/writeRanged/writeBytes/writeFloat | same names | events | Kotlin adds Int/Boolean overloads |
| writeFixedString | same | events | |
| reserve / patchUnsigned | same | events (writeEventBlock) | |
| BitReader ctor/remaining/readBit | `BitReader(buf,end)` | ghost-decoders, events | Kotlin throws `BitReaderUnderflow`; reading past `buf` inside `end` throws AIOOBE (Node reads 0); `hexReader` pads to avoid it |
| readUnsigned/readSigned/readBool/readRanged | same (+`readUnsignedInt`) | events, ghost-decoders | Kotlin readSigned returns Long: no -0 (decoders use JsOps `sgn` instead) |
| readBytes/readBits/readFloat | same | events | |
| readUnsignedFloat/readSignedFloat | same | ghost-decoders | n=31 JS wrap reproduced |
| readFullVector/readCompressedVector | same | **none** (dead in Kotlin; decoders use JsOps `fullVec`/`vec`) | readCompressedVector loses -0 via Long (D-13) |
| readUnitQuaternion | same (via JsOps `quat`) | ghost-decoders | |
| readFixedString/readLenString/skip | same | events, session | |
| cstr | `cstr` | events | |
| (none) | `latin1()`, `BitReaderUnderflow`, JsOps `hexReader/u/sgn/ranged/vec/fullVec/quat/dl` | | Commented as Node `Buffer` and JS-number shims |

#### body-decoder.mjs -> K:BodyDecoder.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| MAX_SEATS, WORLD_LIMIT, TRANSFORM_RING | companion consts | body-decoder | |
| BodyDecoder ctor (animStates, animFixed, mod, maps, sets, scoreNet, spawnNet, spawnGroupCount, level, tidNames, tidClasses, cpTemplates, infoCache) | same fields | body-decoder | keys normalised by `JsOps.key` |
| setLevel | `setLevel` | body-decoder `levelTableLookups`, rebuild | |
| note | `note` | body-decoder, rebuild | `projPool` casts netId `as Double` (D-14) |
| info | `info` | body-decoder | |
| seatOf | `seatOf(Double)` | body-decoder, rebuild | |
| classOf | `classOf` | body-decoder | |
| decode | `decode` | body-decoder `sessionsRecordByRecord`, rebuild | |
| (none) | `k()`, `refOpt()` | | private helpers |

#### soldier-ghost.mjs -> K:SoldierGhost.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| POS/VEL/VEC_SCALE, QUAT_BITS, AIM_BITS | private consts | ghost-decoders | |
| VANILLA_ANIM_STATES, VANILLA_SOLDIER_HP, VANILLA_AIM_TWIST_DEG/PITCH_DEG | consts | ghost-decoders (soldier, soldier_wide) | |
| warnedAnim (module state) | `@Volatile warnedAnim` + `reset()` | rebuild (resetModuleState) | |
| MASK | `MASK` (Map) | none | |
| decodeSoldierBody | `SoldierGhost.decodeSoldierBody` | ghost-decoders (5 variants), control-state, body-decoder | |
| decodeSoldierTransform / decodeSoldierPosition | same | **none** | not called at runtime |
| SoldierStateTracker.update | `SoldierStateTracker.update` | ghost-writer | |
| carrySelfAim | top-level `carrySelfAim` | ghost-writer | |

#### names.mjs -> K:Names.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| tidNamesFromRecording | `Names.tidNamesFromRecording` | tables (`fromRecording`) | Kotlin `trim()` is not JS trim (D-9) |
| loadTidNames(path) | `loadTidNames(FsFile)` + `tidNamesFromText(text)` | tables (via savedMap) | |
| fellBack (state) | `fellBack` + `reset()` | | |
| namesForLevel | `namesForLevel(level, mod, mode)` | tables (`names <lv> <mod>` for every level, computed and bare), body-decoder, rebuild | |
| savedMap | `savedMap` (memoised, deep-copied, classpath) | tables | Node rereads the file on every call. Resources are byte-identical to `sidecar/templates`. |
| WAKE / WAKE_OWN / wakeNames / wakeAnim | same | tables (bare) | |

#### template-class.mjs -> K:TemplateClass.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| NETWORKABLE, BY_LOWER | same | tables (`fromClass`, `classes`) | |
| classFromTemplateClass | same | tables | |
| KIT_RE, fam | same | tables (`classes`) | `$` becomes `\z`; regexes become endsWith (D-10) |
| controlPointTemplates | same | tables (`cpTemplates`), body-decoder | |
| classForTemplate | same | tables (17 names x 5 forms) | |

#### template-table.mjs -> K:TemplateTable.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| HERE/SCRIPT/cacheDir | `cacheDir()` -> Paths | tables | |
| memo, warned, warnOnce | same | tables | |
| levelBase, modeBase, safe | same | tables (indirect) | Java `$` (D-10) |
| fingerprint | `fingerprint` | **none** (needs an install cache) | **mtime rounding (D-3)** |
| readCache | `readCache` | none for a hit | |
| writeCache | GAP (install-only) | | stub, fine |
| VERSION_INPUTS, TABLE_VERSION_FILE, tableVersion() | GAP. Replaced by build-time `TABLE_VERSION` (core/build.gradle.kts) | tables (`version` equals Node's) | |
| fromInstall | `fromInstall` (cache read only; Python run is a STUB) | none | |
| fromDownload (WeakSet) | `IdentitySet` (strong) | tables (`revalidate200`) | D-6 |
| fromBaked | same | tables | |
| compute | same | tables | |
| load | same, under `lock` | tables | |
| templateTable | same | tables | missing `classes` handled differently (D-15) |
| levelTemplates / templateValue | same | tables, control-state | |
| TEMPLATE_TABLE_VERSION | `TEMPLATE_TABLE_VERSION` | tables `version` | |
| (none) | `reset()` | | commented |

#### level-tables.mjs -> K:LevelTables.kt (+ Paths.kt)
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| DEFAULT_TABLES_URL, FORMAT | same | tables | |
| cacheDir / gameDir | `cacheDir()` / `gameDir()` (Paths) | tables (`cacheFile`) | Paths env handling (D-8) |
| INSTALL_HELPERS | GAP, folded into `installCanCompute` | | commented |
| warned/warnOnce | same | | |
| levelKey | same | tables (`levelKey` list) | `\s` and `trim` (D-9) |
| MODE_ALIASES / modeKey | same | tables (`modeKey`) | |
| modKey, treeFor, bakedRel | same | tables | |
| tablesBase | same + `tablesUrlOverride` | tables (`off`) | |
| tablesUrl | same | tables (`urls`) | |
| bakedCacheFile | same | tables (`cacheFile`) | |
| generation / bakedGeneration | same (`@Volatile`, non-atomic ++) | tables | |
| validBaked | same | tables (`validBaked`) | |
| readBaked | same | tables | |
| writeBaked | same; per-write tmp name; delete-then-rename fallback | tables (`cache`) | D-17 |
| installHasMod | same | none | |
| installCanCompute | same (python always "no"; helpers check folded; no `python`/`helpers` opts) | none | STUB |
| prepared (Map of promises) | `prepared` (Map of results) | tables (`again`, `requestsForAgain`) | **no in-flight dedupe (D-5)** |
| fetchTables | `fetchTables` + `Fetch`/`Response`/`FetchTimeout`/`httpFetch` | tables (stand-in Fetch) | **real transport differs (D-4)**; empty etag (D-16) |
| describe | same | | |
| prepareLevel | `prepareLevel` (blocking) | tables (first, again, revalidate304/200, offlineHung/Refused, otherCode, xpack, missing, slow, garbled, noFetch, off, noArgs) | error strings (D-7) |
| resetLevelTables | same + `resetProcessState` | | commented |

#### game-tables.mjs -> K:GameTables.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| memo, warned, warnOnce | same | tables | |
| levelBase/modeBase/safe | reuses TemplateTable's (identical in Node) | | |
| fingerprint/readCache | reuses TemplateTable's | none | D-3 |
| writeCache, run | GAP (STUB) | | install-only |
| gameTables | same | tables (`gameNoLevel`, per level), body-decoder | `lv` empty string (D-18) |
| fromBaked | same | tables | |
| cpNameOf | same | tables (`cpNameOf`), ghost-writer | |

#### ghost/children.mjs -> K:ghost/Children.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| lower | `lower` | control-state | |
| LEVEL / LEVEL_LABEL / FALLBACK / warned | same (@Volatile) + `reset()` | | |
| fallback / current | same (+ `readResource`) | body-decoder (bare), rebuild (`run` no tables) | Resources are byte-identical to Node's |
| useLevelTemplates | same | control-state, body-decoder | |
| fallbackHull | same | tables (`classes`) | |
| key, specFor, hullFor, soldierFor | same | control-state, body-decoder | |
| seatSpecFor | same | control-state, ghost-decoders (`seat_m3a1`) | |
| HAND_JOINT_PARTS, jointPartsFor | same | ghost-writer/rebuild (indirect only) | |
| gunFor | same (returns `Gun`) | ghost-writer/rebuild (indirect) | |
| TICK_F32, fireLagFor | same | ghost-writer/rebuild (indirect) | Math.fround placement matches |
| childrenFor, ANCHORS, DEFAULT_TEMPLATE, templateNames, anchorSpec | same | ghost-decoders (`pco_auto`) | |

#### ghost/control-point.mjs -> ghost/ControlPoint.kt
MASK, MASK_BITS, TEAM_BITS, decodeControlPointBody and decodeControlPointTeam
are all ported. Coverage: ghost-decoders (`cp`) and body-decoder. They match.

#### ghost/control-state.mjs -> ghost/ControlState.kt
| Node symbol | Kotlin symbol | covered by | notes |
|---|---|---|---|
| BASELINE_SLOTS | same | control-state | |
| ControlBaselines get/set/clear | `ControlBaselines` | control-state | |
| decodeControlState | same (`Ctx` class for ctx) | control-state (soldier, vehicle, camera, seat, hit, liveHits, other, alameinControl) | |
| decodeControlBody | same | control-state | objects missing (D-19) |
| bitsToHex | same (public) | control-state | |
| countObjects | same | control-state | |

#### ghost/derive-children.mjs -> ghost/DeriveChildren.kt (test-only in Kotlin)
LETTER, graphFromJson, num, networkable, armorMax, hasArmor, RB_CLASSES, vec,
input, rbProps, sameProperties, groupNodes, graphInfoUnique (inlined), walk,
gunSpec, jointParts, descriptorSpec, deriveSpec, partPivots, limit and
deriveLevel are all ported. Coverage: derive-children (`deriveLevel` for every
graph, plus walk, nodes, seats, missing and armour).
- The CLI `main` is a GAP, and the comment says so.
- In Node, a numeric `vec` argument or a string `pos` would throw or
  concatenate. Kotlin coerces both (D-20).

#### ghost/free-camera, kit, projectile, player, score-manager, spawn-manager
All exports are ported: MASK, consts, the decoders, looksLike*, TICKETS,
ROUNDS_WON, FIELDS, STAT_FIELDS and UNUSED_BITS.
- Coverage: ghost-decoders (`freecam`, `kit`, `kit_strict`, `projectile`,
  `projectile_strict`, `player`, `score`, `spawn`) and body-decoder.
- Player.FIELDS drops the Node-only `at`/`slot` metadata, which nothing reads.

#### ghost/pco.mjs -> ghost/Pco.kt
CV, HV, MASK, readVec, readVecFrom, scales, readSimpleObject, readEngine,
readSpringVec, readSpring, readRotationalBundle, readFireArms, specFromOpts,
decodeSeatBody, decodeWithSpec and decodePcoBody are all ported. The default
export is a GAP.
- Coverage: ghost-decoders (`pco_m3a1`, `pco_sherman_ref`, `pco_auto`,
  `pco_children`, `pco_strict`, `pco_control_bases`, `seat_m3a1`),
  control-state (hulls, seats, blockRef) and body-decoder.
- The Kotlin `Cx` and `intOf` helpers have no Node counterpart.

#### Non-runtime decoders (engine, firearms, item, objective, rotational-bundle, simple-object, spring)
All exports are ported. Spring.readHighCompressedVector is ported. Coverage:
ghost-decoders `engine`, `engine_gears`, `firearms`, `firearms_strict`, `item`,
`objective`, `rotational` (+ `rotationalBundleBodyBits` 0..129), `simple`,
`simple_full` and `spring`. Edge: D-12.

#### ghost/verify.mjs -> ghost/Verify.kt (test-only)
loadCorpus and loadNames are ported but take text, not a path, as commented.
verifyDecoder, claimedNetIds and INSANE_ABS are ported. `main` (the CLI) is a
GAP, also commented. Coverage: ghost-decoders census.

#### rebuild.mjs -> Rebuild.kt (the gate)
GHOST_KINDS, derived, the timeline build, review-log grouping, the sort,
auto-names, the BodyDecoder and GhostWriter loop, output and stats are all
ported. `rebuild(text, text, ref)`, `Result.text()`, `summary()`,
`resetModuleState()` and `main(args)` are Kotlin additions.
- Coverage: rebuild (run with ref, without ref and with no tables; m3a1,
  m3a1_blank, zero_sherman, player_stats, fire_line, detonate) and
  RebuildFilesTest.

#### Environment variables
| var | Node | Kotlin | notes |
|---|---|---|---|
| SIDECAR_CACHE | paths.cacheDir `env.SIDECAR_CACHE` (truthy) | Paths.cacheDir (non-empty) + `cacheDirOverride` | matches |
| SIDECAR_TABLES_URL | `?? DEFAULT`; `""`/off/none/0 means off | same + `tablesUrlOverride` | matches |
| SIDECAR_PYTHON | pythonCommand, then a spawnSync probe | only names the interpreter in the stub's log line | `""` is kept in Kotlin (log only) |
| BF1942_DIR | gameDir; also `--game-dir` to Python | Paths.gameDir (non-empty) + `gameDirOverride`, `lookForInstall` | Python half is not ported |
| SIDECAR_LEVEL_WAIT_S | `Number(opt ?? env ?? 30)*1000` | SidecarCli `num(opt ?: env, 30.0)` | out of module scope; NaN handling not checked |

## Appendix B: Node branches the fixtures still do not drive

These are the remaining uncovered statements and branch arms (c8, under every
parity generator), one line per entry or group, with the reason no fixture
drives it. Line numbers are the Node module's as of this audit.

### sidecar.mjs
- L42, L47, L109 (`target ?? default`, `portStr ?? 14567`, `--cdkey` absent): CLI defaults; every fixture names a target, a port and a key (the key so the replay is deterministic). SidecarCli's parser has the same defaults.
- L130 `end()` twice, L344/L367 `if (settled) return` second arm, L949 `if (finished) return`, L969 second leave: re-entry guards; `unreachable` covers a second Ctrl-C, the remaining arms are the guard's other side of a short-circuit.
- L167/168 `mod || mapId`, `m && levelPath` false arms: a SetLevel before any ServerInfo, or one with no level path; servers send ServerInfo first and SetLevel always names a level.
- L225 `sendTeam` throwing, L407 the synchronous spawn throw, L442 `sendChat` throwing: defensive catches around calls that do not throw on a joined session (spawnSequence's own rejection is covered by `rejoin`'s kit 999).
- L277/278/290 the sender moving to a new session with recorded round trips: needs a page word arriving between a rejoin's join and the rejoiner's `rejoined` in one loop turn; the captures' rejoins all had the page idle. Ported line for line.
- L303 `recvAt == null` / `relAt == null`: an idle record under --word-log; the `options` word log only has page words.
- L428/439 suicide and chat before the join: a page that sends them on its deploy screen during the connect; the page sends neither before it has a player.
- L453-456 the stall warning: words dropped because the connection is not up; needs a page word while the session is joined but its connection closed, a sub-millisecond window.
- L573 `ev.id ?? null`: a decoded event with no mapping always has an id.
- L602, L626 (`skipStaticObjects` on a SetLevel), L634 (classOf throwing), L636 (`pidTeam ?? 0`): SpecialGame 2 before a SetLevel is covered in the session fixture, not through the sidecar; the others are `??` arms on values always present.
- L651 `g.records || []`, L657 a ghost block with `raw`: a block the session could not frame (`raw`) is covered in the session fixture's malformed stream; the sidecar arm only forwards it to the review log.
- L683/684 engine registers missing from one state: every Engine child in the captures carries all five registers.
- L700 hit marks, L701 a delta before its baseline, L705 an unparsable control state, L711 (path at ack with no sender), L733/742/747, L782/786/792/793/812/818/820 (the ack row's optional fields): control-state edges. Hit marks need one of our rounds to hit a live enemy, and the other two need a hull or seat the decoder cannot read. The control-state fixture (session) covers the decoder's side of each. Kotlin ports each arm line for line; they were read side by side in Appendix A.
- L832 a bf42++ server that allows the faster restart: the fixture's welcome line says `nfr`; the other arm is a different string in a log line.
- L834-843, L851-885, L904, L926-941: `??` and ternary arms of log lines and server states for values always present (a reason name, a message, a mod, a password).
- L979-986 `--leave-on-stdin`: reads the process's stdin; covered for Node by tools/sidecar-desktop's smoke test (stdin-close) and test_sidecar_cli; the Kotlin CLI's reader is platform code.
- L1007 `lv.mode ?? ''`: a pre-join answer without a mode.
- L1031 `connectTimeoutS > 0` false arm: `--connect-timeout 0`.

### input.mjs
- L228/229 pitch and roll keys, L255 `input ?? {}`: actionFor fields only the vehicle laws' probes pass.
- L452 an ack more than a second after its tick, L589 a merge group of one, L614 an empty queue at release, L628/630 `recvAt ?? null`, L697 the pump falling far behind: pacing edges of a stalled loop; the paced fixtures run the page's own input-pace.js against a model server without stalls. Ported line for line (audit C found no divergence).
- L837 a serial past 2^31: needs 2^31 words.
- L950/951 `selfTest` failure and verbose output: the module's self-test CLI.
- L988/992 negative values and widths past 32 in the bit writer: no field is signed or wider than 32.

### ghost-writer.mjs
- L82/83 `before?.[1] ?? null`: magazine counts with no earlier answer.
- L133/134 `note()` with no row: callers always pass one.
- L298, L409, L550, L580-608, L632/633, L700, L776/778: `??` and guard arms on rows the decoders always fill (a soldier state with a tick, a quaternion with a non-zero norm, a control point whose template is named).

### live-snapshot.mjs
- L103-119 `o.o ?? []`: a sample row without its list; the writer always writes one.
- L200 `o.tid ?? 0`, `o.tmpl ?? ''`: an object row without them.

### record.mjs
- L51-70 the false arms of `? 1 : 0` on gameRules, simStart and radio fields: the lab's servers send one value of each.

### review.mjs, player-name.mjs, join.mjs
- review L15 no review path: the CLI always passes one.
- player-name L30 `cut || null`: a name that trims to nothing.
- join L16/20/27: CLI defaults (no target, no port, no --log).

### wsserver.mjs
- L67/70/73: sending to or closing a socket that is already closed, and a write that throws: races with a page going away, defensive.
- L96 the monitor page unreadable: it ships with the code.
- L120 the TCP close after our own close: the guard's other side.
- L133-137, L147/148: the 16-bit and 64-bit length forms of a frame the page sends to the sidecar; the page's frames are under 126 bytes. The server-to-page side of both forms is covered (`frames` big:200 and big:70000).

### bitstream.mjs
- L42 `BitWriter overflow`: a writer past its capacity; every writer is sized for one datagram and the events fixture never overfills. Ported 1:1; reachable only through a block of >1024 bytes, which Session's flush caps first (D-S2a context).
- L49 `i < 32 ? ... : 0` false arm: writeUnsigned with n > 32; no field is wider than 32.
- L78-79 `patchUnsigned`: only writeEventBlock's count patch when the block is re-counted; events fixture writes blocks whose count is known up front. Ported 1:1.

### body-decoder.mjs
- L67 `level || ''` / `|| null`: setLevel(null) and a level whose base is empty; the sidecar calls setLevel only from a SetLevel event, whose levelPath is always a string with a base.
- L72 `this.mod ?? '?'`, `mode ?? ''`: the label of a log line only (stderr), on a setLevel before any ServerInfo.
- L118 `tmpl ? {tid,tmpl} : null`: a tid with no class and no name: needs a table with holes; the tables never have one.
- L131 `inf.tmpl ?? null`, L143 `networkableClass ?? null`: info rows always carry tmpl/networkableClass once named.
- L141 camera that is also an object: a netId the server reuses between a FreeCamera and an object in one session; not seen on the wire.
- L194/195 template and hull false arms, L222 non-finite position: malformed or unnamed bodies; the corpus has none. Port mirrors each arm.

### cdkey.mjs
- L76 `SIDECAR_CDKEY_FILE ||` default arm: covered in Node only by `cdKeyStore()` with no file and no env, which would write the developer's real ~/.config key file; the Kotlin envFile case covers the env arm.

### chat.mjs
- L85 `piece.text ?? ''`: chatFragments always gives text.

### content-crc.mjs
- L65/66 bundled table unreadable: the table ships with the code.
- L72-81 `installRows`, L131-137 `--build`: the CLI that rebuilds content-crc.json from an install; not ported (desktop build tooling).

### events.mjs
- L307/308, L324/325 `vec3` and `default` in readField/writeField: no EVENTS entry declares a vec3 field kind (vectors are custom readers) and every kind is known; dead arms.
- L374 `a.axes[i] ?? 2047`: writeActionBlock with fewer than 6 axes; Input always fills 6 (orchestrator's module drives it).

### game-tables.mjs
- L44 `level || ''`: levelBase is only called with a truthy level.
- L61-73 writeCache/run, L116-129: the Python install computation; not ported (Paths.pythonAvailable says no), install-only.
- L98-99, L104-106: a memoised download whose re-read finds no newer copy after a generation bump by another level; reachable only with two levels downloading in one process at different times; logic ported 1:1 (memo/generation reviewed in audit D, "no divergence").
- L140/141 `cpNames ?? {}` / `?? null` in fromBaked: a bake without cpNames that still has animStates; the published bakes always carry both (the nocp tables case drops both and stops at the animStates check).

### level-tables.mjs
- L99/101: SIDECAR_TABLES_URL unset / without a trailing slash; the generators set it (env) or pass `base`; urls case covers the slash arm through tablesUrl.
- L111 `modKey(mod) || 'bf1942'`: bakedCacheFile without a mod; prepareLevel returns before that.
- L130-131 a cached bake that is not format 1: needs a corrupt cache file; garbled covers the download side.
- L161-164 helpers missing, L170 `return true`: the Python install path (not ported).
- L246 timeout arm with `otherCode`: an other-code copy whose fresh fetch times out; offlineHung covers the timeout text for a same-code copy.
- L250-257: install computes the tables (Python; not ported).
- L262: a 304 to an unconditional GET; a server bug, not reachable against mesh.bfstats.io.

### names.mjs
- L48 `j.level || ''` etc.: a saved map missing level/mod/animStates; every committed templates/*.json has them.
- L50: loadTidNames on a .ndjson recording; only the CLI tools pass recordings (fromRecording covers the parser itself).
- L67-69 `level || ''`, `base ?` false arms: namesForLevel(null) / a level with an empty base; Session never asks without a level.
- L104-108 `w?.... ?? {}`: the Wake saved map missing; it ships with the code.

### netconn.mjs
- L99/101/107 probeServerInfo: `done` re-entry, a close that throws, a send that errors or throws; socket error paths not reachable on loopback without fault injection into dgram.
- L167, L299: close() that throws on an already-closed dgram socket; dgram's close of a closed socket throws only after a double close, which NetConnection guards.
- L248 `lastSentSeq !== -1` false arm: an ack-only datagram before anything was sent; the handshake always sends first.
- L276-279 `_closeWhenSent`: close() while sends are still pending; the fake sockets in the fixtures complete each send before the next step.
- L393 cstr without a NUL: a ServerInfo name filling the field; the fixture names are short.

### objects-checksum.mjs
- L74/75 bundled table unreadable: ships with the code.
- L113-120 installChecksums, L123-129 `--build`: CLI that rebuilds objects-crc.json; not ported (desktop build tooling).

### paths.mjs
- L38-49 defaultGameDirs on win32, L54 the default-folder search: the generators always set BF1942_DIR (parityEnv) so no run looks in the developer's real install; the Kotlin Paths has the same arms (D-8 fix).
- L60, L76-79 pythonAvailable's arms: runs a real interpreter; the Kotlin port never runs Python (answers no).

### rebuild.mjs
- L31-34 usage, L45/L60 unparsable lines, L47/L49/L94/L108/L109/L112 nullish arms: CLI argument handling and malformed review logs; the committed review logs are well formed. Rebuild.kt mirrors each (D-22 fix makes a missing dt throw as Node's does).

### rejoin.mjs
- L235 `DISCONNECT_TITLE[kind] ?? closed` with a box: covered for the no-box arm (`mystery`); the remaining arm needs a reason with a box and an unknown kind, which describeDisconnect never gets (kind comes from classifyDisconnect).
- L318 `if (this.active)` true arm when stop() is called while waiting is covered by stopDuringProbe; the uncovered arm is the counter's other side of the short-circuit.
- L329: `_probeTick` with state not waiting: the probe timer is cleared on every state change (stop, fail, attempt), so the tick never runs outside waiting. Dead.
- L334: a probe that settles after stop(): stopDuringProbe drives it in Kotlin (delayed probe), but in Node the FakeClock's setImmediate settles the promise before the stop timer; covered by the Kotlin test, not by V8.
- L400 `attempts ?? 0`, `t0 != null`: fail() is only reached after start() set both. Dead.

### server-query.mjs
- L49/51/54/63 gamespyStatus: `done` re-entry, close throwing, the timeout with chunks but no settle, send errors: socket fault paths (see netconn). Kotlin's gamespyStatus is a blocking rewrite with the same answers (gamespyStatusOverUdp case).

### session.mjs
- L120/128/133/144 option defaults (`name ?? 'sidecar'`, team, passwords, `opts.cdkey ?`): the generator always passes them; SessionOptions' Kotlin defaults are the same literals; the cdkey arm is D-S1 (fixed, reviewed by reading).
- L228 conn.close() throwing: double close, guarded.
- L272 status for a block no longer unconfirmed: a duplicate delivery status from NetConnection; NetConnection reports each tag once.
- L375 `serverMod ?? contentMod ?? null`: the middle arm (a Challenge without a ServerInfo before the SetLevel); servers always send ServerInfo first.
- L438, L440-442 control-state throw and rootPos null: decodeControlState never throws (its own catch) and always sets rootPos; dead.
- L471, L526: bodies.decode / bodies.note throwing: both catch inside; defensive.
- L497, L510, L513: control record without a body or position: decodeControlState gives ok:false without body in those cases, covered by malformed; the remaining arms are `?? null` on a known tmpl.
- L532, L598-600 `ev.mod ?? ...`, `ev.mapId ?? null`: a decoded Challenge/ServerInfo always carries every field (the event reader fills '' for an empty string), so the nullish arms are dead on the wire.

### soldier-ghost.mjs
- L105 mask underflow non-strict, L148 non-finite pos: an empty body (bodyBits < 14) is filtered by the caller; corpus has no non-finite position.
- L155-157 decodeSoldierPosition, L161-163 decodeSoldierTransform: exported helpers nothing calls at run time (audit D).
- L190, L216/217 `?? 0` / `!= null` arms in the state tracker: the tracker always seeds these fields.

### template-class.mjs
- L66 `cpNames ?? {}`: controlPointTemplates(level, null); callers pass the tables' cpNames, `{}` at worst.

### template-table.mjs
- L57/58 `level || ''`, `mode || 'conquest.con'`: called with a truthy level; mode null covered in Kotlin, the V8 arm needs modeBase(null) through templateTable with mode null on a hit path.
- L73-81 writeCache, L108-131 fromInstall (Python run), L93-101 tableVersion fallbacks: install and desktop-bundle paths; the Kotlin TABLE_VERSION comes from the Gradle build.
- L139 a downloaded table of other code: oldcode covers level-tables' side; templateTable's warn arm needs reading the stale copy before the fresh one lands.
- L152 `baked ?` false arm, L154/155: `baked:false` with an install that can compute (Python).
- L174 `?? hit.value`: a memoised download whose re-read finds none after another level's download bumped the generation.
- L212-213 templateValue: used only by bake-tables.mjs (desktop CLI).

### ghost/children.mjs
- L50 `o ?? {}`, L64 read() failing: the derived-specs and hulls files ship with the code.
- L97/106 `?? null` / `k ?` arms: specFor/hullFor with an empty template key; callers pass names from the tables.
- L146/147, L201: seat spec arms for a seat number with no spec and templates absent from both the level and the fallback; corpus vehicles all have specs.

### ghost/control-point.mjs
- L39-41: looksLikeControlPoint helper, not called at run time.

### ghost/control-state.mjs
- L74 `?? String(e)`: a non-Error throw; decoders throw Errors.
- L104-139 arms for ctx without templateOf/seatOf, bodies without vel/vecA/vecB, every physics combination failing, a template with no objects: Session always passes templateOf/seatOf; the control-state fixture covers soldier, vehicle, camera, seat and the failure reasons; the remaining arms are `||` defaults on fields the decoders always set. Kotlin mirrors them (D-19 fix makes a body without objects fail as Node's map does).
- L145-171: seat without seatOf, no spec, a seat body that throws: as above; `no seat spec` needs a passenger seat in a capture.
- L189 countObjects on a template with no children: catch arm, defensive.

### ghost/derive-children.mjs (test-only in Kotlin)
- L96-104 `?? []` defaults: graphs from the Python exporter always carry templates/infos/unique/forced.
- L123, L160, L187, L196, L201, L209, L253, L260, L285, L290, L299, L334-356: malformed-graph and depth-limit arms (cyclic graphs, missing roots, guns without RS nodes, rest angles past 180); the committed graphs never take them. D-20 lists the coercions as deliberate.
- L399-411: the CLI main (install half; not ported).

### ghost/free-camera.mjs, item.mjs, spring.mjs, rotational-bundle.mjs, simple-object.mjs
- mask underflow non-strict, `opts.strict` rethrow, `opts.X || default` arms: the strict and lenient sets in ghost-decoders cover each decoder once; these specific arms need an empty body in strict mode or a missing option the callers always pass. Ported 1:1.

### ghost/pco.mjs
- L231 `?? anchorSpec(...)?.gearBits ?? 2`, L234, L254, L288, L290, L293: option defaults the callers always supply.
- L294 `unknown child type`: a spec with a child letter outside E/S/R/O/F; derived specs never have one.

### ghost/spawn-manager.mjs
- L48 `n < 4 || n > 128`, L51 a team > 3: looksLikeSpawnManagerBody's rejections on implausible bodies; the corpus's spawn bodies are all plausible.

### ghost/verify.mjs (test-only in Kotlin)
- L33, L43-51, L76, L103-143: the verify CLI (main, template loader, over-read counter); Kotlin ports the census, which the fixture covers.
