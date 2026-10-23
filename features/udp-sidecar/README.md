# UDP sidecar: the browser game joins a real BF1942 server

## Start here (2026-10-22)

**State.** A browser page plays a real round through the sidecar, and the owner
calls it "butter smooth" with good hit registration. On foot, the page predicts
its own soldier with the server's own laws, so corrections are near zero:

- the look law (torso twist [-14, +20] and the fold): `viewer/mouse-input.js`
  `soldierYawStep`, exact to 0.001 deg;
- the ground law (PHY-34), with the body at the engine's 30 Hz: about 1 mm a
  tick.

Whatever residual remains (statics, vehicles) is eased into the drawn pose over
0.1 s by `viewer/correction-blend.js`. The simulation takes each correction
whole; `&blend=0` turns the easing off for an A/B. The page draws, collides
with and damages a server hull only while that hull is in this client's ghost
scope, as retail does.

**Run it.** Start the lab server (skill `bf1942-server-lab`). Then run
`node sidecar/sidecar.mjs 127.0.0.1:14568 --name <you> --team 2 --ws 17942`
from `tools/bf1942-models`, and open
`map.html?sidecar=127.0.0.1:17942` on the viewer.

- Restart the sidecar after a sidecar change.
- Hard-reload the page after a viewer change. A mixed module cache froze
  movement once.
- Stop a probe sidecar with SIGINT: a killed one leaves its player on the
  server for about 20 s.

**How a change is checked.** Measure the law against the live server first, by
the method in [review-2026-10-21.md](review-2026-10-21.md) section 8.1. Don't
tune a reconciler instead.

| law | probe on the lab | check | held by |
|---|---|---|---|
| look | `lab/look_law_probe.mjs` | `lab/look_law_check.py --viewer` | `tests/test_netcode_reconcile.py` (q) |
| soldier ground | `lab/move_law_probe.mjs` | `lab/move_law_check.py` | `tests/test_move_law.py` |
| soldier on steep terrain | `lab/slope_slide_probe.mjs` | `tests/slope_slide_harness.mjs` | `tests/test_slope_slide.py` |
| tank ground | `vehlaw/veh_probe.mjs` (scratchpad, being moved into `lab/`) | `vehlaw.py` | port in progress (below) |
| drawn smoothness | headless page, camera per page-clock frame | the residual from a +-100 ms line fit | `tests/test_correction_blend.py` |
| remotes' render clock | `lab/remote_lag_probe.mjs` | `lab/remote_lag_check.py` | `tests/test_remote_clock.py` |

**Remotes are drawn on the client's clock (2026-10-23).** Retail draws every
remote 100 ms behind its own game time, which is the newest block's tick plus
the actions in flight (ledger P-6), not 100 ms behind the newest sample. The
page now does the same, so a bot's plane is drawn within about a metre of the
server's present and 0.1 s behind where a round fired now meets it; before it
was a whole round trip further back. [wire.md](wire.md) section 38.

**The minimap's marks land on its art (2026-10-23).** On Wake the owner saw the
southern flags and the friendly hulls in the sea, sliding into place as he
walked to them. Ghost scope was not the cause: a scoped-out soldier has no
transform and a scoped-out hull no entity, so neither is marked at all, and
the flags are the level's `scene.json` positions. The map widget was. It is not
square on a 16:9 stage, and the art kept its own aspect while every mark was
stretched to the widget, so a mark was right only at the centre and off by a
quarter of its distance from it (92 m for the south base seen from the north
village). The art is now stretched as retail's quad is, and art and marks go
through one mapping (`viewer/bfmap.js` `surfacePoint` / `surfaceArtMatrix`,
`tests/test_bfmap.py`). It was never sidecar-specific; any page on a non-4:3
window had it.

**Which doc to trust.** For the engine, the ledger wins (skill
`bf1942-knowledge`). For the protocol, [wire.md](wire.md). For the play path's
history, the dated sections of [review-2026-10-21.md](review-2026-10-21.md),
newest last, and [netcode-audit.md](netcode-audit.md), whose status table says
which of its items are superseded. Older sections below this one are history
and stay as written.

**In flight on 2026-10-22, check before redoing.**

- **The tank's ground law.** It is being ported into
  `viewer/tracked-vehicle.js` on a worktree branch (`worktree-agent-*`), from a
  study that replays the server's Sherman to 0.2-0.4 mm per ack. That study
  also covers the turret's aim against the server's. In the owner's fight, the
  server's turret pointed 20-40 deg off the page's.
- **Steep slopes: settled.** The page matches the server (5f41627e). See the
  steep-terrain paragraph below and `tests/test_slope_slide.py`.

**Open, in order.**

1. ~~Aircraft on the ground.~~ Built 2026-10-23
   ([aircraft-ground-law](../aircraft-ground-law/README.md), AIRGND-1..6): the
   SBD, the Val and the Zero stand on their springs by the server's per-tick
   law, 0.3-0.8 mm a tick horizontally. The "runway static 1.2 m above the
   heightmap" was the SBD's ride height misread: Wake's pad is terrain.
2. Count the live input queue depth on the owner's page (`__net().inputQueue`).
3. Statics contacts for the soldier.
4. The netcode audit's section 5 and 6 leftovers (Simulation, UpdateRate,
   Ack, CheckSum).

Status: the POC works end to end, 2026-10-15. The datagram layer, the event wire
format, the challenge, the object bodies and the client's input are all read from
the server binary and written up in [wire.md](wire.md); a Node client in
`tools/bf1942-models/sidecar/` implements them. **It joins the lab server as a
real player**, reads the world dump, receives and decodes the event stream
(100%) and every object body class that appears in a round (soldiers, vehicles,
players, control points, kits), and **plays**: the browser page spawns its
soldier and walks them on the real server, confirmed by a second client watching
the same round ([browser.md](browser.md)). Everything not yet decodable goes to
a review log as the corpus to decode next. The soldier body, the vehicles'
hull-plus-children bodies, the players and the composite framing are all settled
([wire.md](wire.md) §9, §12, §13, §14, §15, §16). Still open: the two fixed guns
(one record each, nothing forced), the aim limits' template properties, one
class's hit points, and the per-level spawn values. Not a production plan.

2026-10-17: the sidecar joins as a **BF42++** client, the community client
most servers expect. It sends the bf42++ marker, decodes bf42++'s three game
events and its SpecialGame 2, parses the server settings in the welcome lines,
and uses bf42++'s map-change pinger (1 s, then every 2 s; a 16 s first delay
on a server that says `UI&nfr`). The page plays the server's statics and its
StaticObjects.con switch. See [wire.md](wire.md) §30 for the inventory and
what is not yet checked live.

2026-10-17: the first **pairing playtest**: the owner on the retail client
watched a browser player through a long El Alamein round (walking, stances,
chat, vehicles, riding as a passenger, a capture, the round end, a team kill).
Two defects found and fixed live; the setup, the results and what is left to
check are in [pairing-playtest.md](pairing-playtest.md).

2026-10-21: **[netcode-audit.md](netcode-audit.md)** reads the whole play path
against the engine, explains the jitter the owner reports in a vehicle (the
acked-tick error applied whole at the ghost rate, with the two integrators
disagreeing and no smoothing on the hull), and lists the events and client
traffic the sidecar decodes but does not act on. (Acted on 2026-10-22; its own status table says what is superseded.)

2026-10-22: the page's on-foot soldier moves by the server's own per-tick
ground law (ledger PHY-34, TERR-16), so its prediction of its own soldier
matches the acked ticks to about a millimetre and the walking corrections are
next to nothing. Measured with `tools/bf1942-models/lab/move_law_probe.mjs` on
Wake and held by `tools/bf1942-models/tests/test_move_law.py`. Statics, the
dive, swimming and the parachute keep the page's own handling and are not yet
measured against the server.

2026-10-22, steep terrain: `lab/slope_slide_probe.mjs` steered a probe soldier
up and down Wake's shore faces and let go on them. The server's soldier, on
materials 3/10: stops within ten ticks and holds on 28 to 38 deg, standing or
crouched; once already moving on 40.5 deg he slides on down the fall line over
42.4 deg, 1.4 to 3.3 m/s, 5.7 m in 2.8 s, and stops dead on a 30.7 deg
triangle; run up to 42.1 deg and released he holds there. Running he slows
with the grade (horizontal 5.7 m/s flat, 5.3 on 28 deg, 5.0 on 32, 3.6 on
46.5) and gets over a 46.5 deg band; walking he stalls 17 cm onto it in half a
second, slides back 0.2 m with W held, and stays at its foot; from a near
standstill at the waterline he cannot get up 43.9 deg at all. All of it is
PHY-34's friction budget (`A 4.8 g dt Ny^5` sliding, `A 7.2 g dt Ny^5` to
break grip, plus `0.75 vCmd` a tick). The page's `Soldier.step` reproduces
every case uncorrected: the same distances and speeds to a few centimetres
and hundredths, `tests/test_slope_slide.py`. No page change was needed.

**Read [wire.md](wire.md) for the byte-level protocol and the POC status.**
This README is the original design; wire.md is what the binary actually says.

## The idea

A browser cannot open a UDP socket, and BF1942 speaks UDP. A small process on
the player's own machine does it instead and offers the page a WebSocket on
localhost:

```
browser page (decode, sim, render)  <-- ws://127.0.0.1:<port> -->  sidecar  <-- UDP -->  game server
```

The alternative, a relay in the cluster, puts every player's packets through
Helsinki. A sidecar keeps the route the real game would take, and it also:

- shows the server the player's own IP, so bans, per-IP limits and admin tools
  work as they do for the real client. Through a relay every web player would
  share one address;
- can ping servers from where the player is, with the GameSpy status query, so
  a server browser shows the pings the player would really get;
- keeps the player's install and any CD key on their machine.

The relay can be the same program deployed in the cluster, with the same
WebSocket API. The page tries localhost and falls back to it. That is for
later; the POC is the sidecar alone.

## Where the line between the two goes

The sidecar owns the connection, the browser owns the game.

**Sidecar:** the UDP socket, the join and the challenge answer, sequence
numbers, acks, resending reliable events, keepalive, and sending input 30
times a second. A background tab's timers are throttled to about once a
second, so anything the server times out on must not live in the page. If the
page stops sending input, the sidecar repeats the last one or sends none; an
empty buffer is simulated as zero input either way (ledger D-4).

**Browser:** decoding events and object updates, the sim, prediction and
rendering. The object decoders depend on the templates the page already loads,
and they share their knowledge with the replay viewer.

**Between them:** the sidecar sends the page decoded events as JSON and object
update payloads as raw bytes. The page sends input records and commands (join,
leave, spawn). On loopback a WebSocket's TCP costs nothing, since nothing is
lost to retransmit.

## What is already known

From the binaries and the recordings. Each row cites where it is proven.

| Piece | What we have | Where |
|---|---|---|
| Input record | `PlayerAction`: six 12-bit axes and a 32-bit button mask, 104 bits, the encode and decode laws, the button bit map | ledger W-1..W-5, [netcode.md §1](../bf1942-engine-reference/subsystems/netcode.md) |
| Input handling | Up to 4 buffered per player, oldest dropped, one used a tick, empty is zero input, a serial no newer than the last is dropped | ledger D-1..D-6, netcode.md §2 |
| Join sequence | First packet makes a `ClientConnection`; the server sends ServerInfoEvent, ServerInfoEvent2, then ChallengeEvent; then the world: a `createObject` per object, a `createPlayer` per player, DataBaseComplete, game status. Leaving is packet type 0xd | ledger J-1..J-6, netcode.md §3 |
| Challenge | ChallengeEvent 0x14 carries a 10-byte challenge, the mod and the xpack id; the client hashes `BF1942.exe` and `objects.rfa` with it and answers with event 0x15 | [round-replay-capture §11.3](../round-replay-capture/README.md) |
| Events | Ids and layouts for about 30 event types: roster, spawn, kits, seats, kills, chat, objects made and destroyed, rules, timers, map list | round-replay-capture §2.2, §11.3; `round-replay-capture/event_sizes.py` |
| Rates | The server sends 20 times a second within a 1044-byte budget per connection; the choke lowers it in steps of 5 to 10 | ledger R-1, R-2 |
| What one client is sent | Full updates within view distance + 20 m; own side's players everywhere | round-replay-capture §19 |
| Datagram shape | One datagram is a `BitStream` shared by four stream managers: events, object state, input, file download | round-replay-capture §2.1, [server-replay-recorder](../server-replay-recorder/README.md) "Why not record the network instead" |

## What is not known

These are what the POC is for, in the order it will hit them. Each one has a
read in the binaries waiting for it (next section); the capture checks the read.

1. **The packet layer.** ~~The datagram header, the connect request, sequence
   numbers and acks, and how the four streams share a `BitStream`.~~ **Read,
   2026-10-15 ([wire.md](wire.md) §1–2).** The 7-byte header (id, 6-bit
   sequence, 6-bit ack, type nibble, 32-bit ack mask), the connect handshake
   (version 0x1002 / 1610), the six-bit stream-presence mask, and the event
   block framing are all decoded and confirmed on the wire against the lab.
2. **The challenge answer.** ~~Which hash, over which bytes, and the shape of the
   answer.~~ **Read and confirmed on the wire, 2026-10-15 ([wire.md](wire.md)
   §4, §6).** The first checksum is `challenge[0..3] ^ 0xa14aac64`
   (`checkClientCheckSums`), confirmed against a captured real response; the CD
   key is not enforced on a LAN server (`+isInternet 0` makes the game id "lan",
   which `GameSpyHost::authenticateUser` accepts outright); `serverContentCheck`
   is off on the lab. A packet capture settled the exact event order: the client
   sends CreatePlayer and ChallengeResponse in **separate datagrams** (bundling
   them null-derefs the server, J-8). The sidecar now joins cleanly.
3. **What the client sends to choose a team, a kit and a spawn point.**
   ~~Nobody has read these messages.~~ **Partly read, 2026-10-15.** The capture
   shows CreatePlayer with `team 0` (auto-assign) at join and, after spawning,
   **SpawnRequest(spawnGroup, spawnPoint)** (0x2f); SetTeam (0x39) and ChangeKit
   (0x3e) are read ([wire.md](wire.md) §3) but not yet exercised by the POC
   (step 5).
4. **Object updates.** Each of the 13 networkable classes writes its own
   bit-packed delta; a reader per class is strategy C of
   round-replay-capture, "weeks, not days". Without them the page can show
   where objects were created and the event story, but not where anything
   moves.
5. **Prediction.** The client predicts its own soldier and the server
   overrules it (P-1). Wherever our sim differs from the engine, the player
   is snapped back. How much is visible is only knowable once input reaches
   the server. **Partly answered, 2026-10-21
   ([netcode-audit.md](netcode-audit.md) §9).** The authority's pose in the
   packet that acks input serial N is post-N
   (`GameServer::processGameStateAndSendPackets` `0x08139420` runs
   `updatePlayerControlObject` before `updateGhostManager` and
   `GhostManager::update`), so the residual the correction closes is the
   page's. Two page-side ones are fixed: the view yaw is now composed through
   the twist's fold instead of being read literally, and a remote soldier's
   spine takes the aim register's pitch. What is left is the size of the
   residual at the end of a turn, and `__net().jumps` reports it.
   **Answered, 2026-10-22.** The residual at the end of a turn was the page's
   own look law, not the correction: the twist clamp and the move press made
   3-4.5 deg a time. The engine's law is now ported, exact to 0.001 deg, and
   the walk is exact as well (PHY-34). See "Start here" above.

## Reading the binaries

**The Linux dedicated server is the spec for everything the sidecar sends.**
`bf1942_lnxded.static` keeps its symbols (54,895 of them, analysed in
`~/ghidra/linux-server.rep`; skill `bf1942-ghidra`), and every message a
client sends ends in a server function that parses and checks it. Reading the
receiving side tells us what the client must send without reading the client.
The client, `BF1942.exe`, has no symbols and is read only where the server
cannot answer: how the client draws what it receives.

Most of the names below are not in `symbols.json` yet; they come from the
binary's own symbol table (`nm -C`).

| Unknown | Read on the server | Read on the client |
|---|---|---|
| 1. Connect and packet header | `NetServer::handleConnectRequest` `0x08436810`, `sendConnectAccept` `0x08436110`, `sendConnectDenied` `0x08436230`, `handleConnectAcceptAck` `0x08436560`, `checkVersion` `0x084367d0`, `checkPassword` `0x08436630`, `handleDataPacket` `0x08436f30`, `handlePingRequestPacket` `0x08436e70`, `sendPingResponse` `0x08435f70`, `handleServerInfoRequest` `0x08436e60`, `sendDisconnect` `0x08436360`, `setConnectionTimeOut` `0x08434750`, `processPunkBusterPackets` `0x08437300` (to learn what it does when PunkBuster is off) | |
| 1. Acks and resends | `ClientConnection::processReceivedPacket` `0x081153f0`, `transmitMsgs` `0x081154a0`, `handlePacketStatusNotification` `0x08115a50`; `PacketQueue` / `PacketBuffer` (`0x08438b20`..`0x084399a0`); `AckEvent::deSerialize` `0x0811ff30` | |
| 1. Input on the wire | `PlayerActionManager::processReceivedPacket` `0x081484e0` (the 4-bit count, R-2), `processRcvdPlayerActions` `0x08148470` (the serial check, D-4) | |
| 2. The challenge | `ClientConnection::initChallengeString` `0x08116280`, `ChallengeEvent::serialize` `0x0811f1c0`, `ChallengeResponseEvent::deSerialize` `0x0811f420`, `GameServer::calculateServerCheckSums` `0x08133220`, `checkClientCheckSums` `0x08133300`, `CheckSumEvent::deSerialize` `0x0811c500`; the hashes on offer are `MD5*` `0x0810c1c0`..`0x0810cbf0` and `Crc32::calcFileCheckSum` `0x083f3fc0` | `MD5Digest` `0x00473430` is labelled, so its callers lead to the answer |
| 2. The CD key | `GameServer::validateCDKey` `0x08133990`, `cdKeyAuthorizeCallback` `0x08135940`, `cdkey_process_buf` `0x0810d990` (GameSpy's CD key code) | `patch__cdkey_validation1..3` mark where bf42plus already patches the client |
| 3. Team, kit, spawn | `SetTeamEvent::deSerialize` `0x0811e340`, `ChangeKitEvent::deSerialize` `0x0811ed10`, `SpawnRequestEvent::deSerialize` `0x0811cd20`, `CreatePlayerAckEvent::deSerialize` `0x0811cc50`, `ConnectionTypeEvent::deSerialize` `0x0811e560`; all reach `GameServer::handleGameEventManagerEvent` `0x08135cb0` | |
| 4. Object updates | Each class's `getNetUpdate` is the writer and `setNetUpdate` the reader: BFSoldier `0x08224e40`, ControlPoint `0x08226de0`, Engine `0x08227da0`, FireArms `0x08228f70`, FreeCamera `0x08229ba0`, Item `0x0822ad90`, Kit `0x0822ba10`, Objective `0x08231b20`, PlayerControlObject (writer `0x08232340`), Projectile `0x08232be0`, RotationalBundle `0x082347f0`, SimpleObject `0x08236d00`, Spring `0x08239270`; `GhostManager::update` `0x08141c70` frames them; `BitStream` quantisers | `GameClient__applyGhostState` `0x00489ed0` (verified) and `applyGhostTransform` `0x00498ce0` (open) for how the client applies them |

The server holds the readers too (`setNetUpdate`), since a listen server is
also a client. So decoding object updates is translating functions we can read
with names, not guessing at captured bits: mechanical, but one class at a
time.

**Read, then capture, then build.** For each step, read the functions first,
write down the layout they imply, then check it against the capture byte for
byte before the sidecar sends anything. A layout the capture contradicts is a
misread, never a server quirk to work around.

**Findings go in the ledger.** The W, D, J, P and R rows of
`features/bf1942-engine-reference/ledger.md` hold the netcode; a packet header
or challenge finding is a new row in its section with the address that proves
it, recorded with `xref.py add` and folded into
[netcode.md](../bf1942-engine-reference/subsystems/netcode.md). This folder
cites the rows rather than restating them.

## The POC, step by step

Against the lab server only (skill `bf1942-server-lab`, port 14568). Each step
ends in something checkable, and any step can be where it stops.

| Step | Goal | Done when |
|---|---|---|
| 0. Capture | `tcpdump` on UDP 14568 while the real client joins the lab, plays a minute and leaves, two or three times. The recorder runs too, so its event log names what the packets carry | The captures are saved under this folder with their recordings |
| 1. Handshake | Read unknown 1's server functions; account for every byte of the join datagrams in the capture; a Node script (`dgram`) sends the connect request and prints ServerInfoEvent, ServerInfoEvent2 and the challenge | Ledger rows for the header and the connect; the server's own log shows the connection |
| 2. Join | Read unknown 2; answer the challenge, read the world dump through DataBaseComplete, ack it, get SimulationEvent 0x04 | `lab.py status` lists the script as a player |
| 3. Stay | Acks and keepalive hold the connection for ten minutes; TimerSyncEvent 0x29 arrives every 10 s | No timeout, and leaving with 0xd is a clean disconnect in the log |
| 4. The page | The script becomes the sidecar: a WebSocket on 127.0.0.1. A bare test page shows the roster, chat, kills and the objects at their created positions on the minimap | Bots kill each other on the page as the event log says they do |
| 5. Input | Read unknown 3; choose a team, a kit and a spawn, then send input records: walk forward, turn, fire | The server event log's `player_location` moves, and shots show in its tallies |
| 6. One decoder | Translate `BFSoldierNetworkable::setNetUpdate` into the page | Bots walk on the page where the recorder says they are |

Steps 0 to 3 answer whether it has legs: if the packet layer and the challenge
fall, the rest is known kinds of work. Step 6 is where the long tail starts.

## Choices for the POC

- **Node** for the sidecar, with `ws`. The repo's harnesses are Node, and the
  event decoders can be shared between sidecar and page. A single executable
  (Bun or Deno `compile`, or a Go or Rust rewrite) is a question for after.
- **The test page is a page of its own**, not `map.html`. Wiring into the
  viewer comes after step 6.
- **Lab only.** A third-party client on public servers can trip PunkBuster or
  break a server's rules.

## If it goes further

Not POC work, recorded so it is not forgotten:

- **Security.** A localhost process that sends UDP wherever a page asks is an
  open relay for every site the player visits. Bind 127.0.0.1 only, accept
  only the bfstats `Origin`, check `Host` against DNS rebinding, send only to
  game and query ports, and pair the page with a token on first connect.
- **Browsers.** Chrome and Firefox let an https page open `ws://127.0.0.1`.
  Chrome is adding a Local Network Access prompt for public sites reaching
  localhost, so expect a one-time allow. Safari has been stricter; test it.
- **Distribution.** An unsigned binary meets SmartScreen and the odd antivirus
  flag. This community already installs bf42plus and mods.
- **Recording.** The sidecar sees every datagram, so it can write the raw
  datagram tap (round-replay-capture strategy B) for players without bf42plus.
- **Content.** A player can only join a server running a level the viewer has
  exported.

## Related

- [netcode-play-multiplayer](../netcode-play-multiplayer/README.md): our own
  room server for the browser game. This folder is the other direction, the
  browser game on the real one.
- [round-replay-capture](../round-replay-capture/README.md): what the server
  sends a client, decoded from recordings.
- [parity-lab](../parity-lab/README.md): the lab server the POC joins.
