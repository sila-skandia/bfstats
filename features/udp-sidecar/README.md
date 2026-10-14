# UDP sidecar: the browser game joins a real BF1942 server

Status: idea, 2026-10-15. No code. A proof of concept against the lab server,
to see whether the browser game can be a client on a retail server. Not a
production plan.

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

1. **The packet layer.** The datagram header, the connect request, sequence
   numbers and acks, and how the four streams share a `BitStream`. We have the
   interface (`IStreamManager`), not the bits.
2. **The challenge answer.** Which hash, over which bytes, and the shape of the
   answer. The server checks it, so the server says what it must be. Whether
   the lab, joined with `+isInternet 0`, checks a CD key at all is a step 2
   finding.
3. **What the client sends to choose a team, a kit and a spawn point.** Nobody
   has read these messages.
4. **Object updates.** Each of the 13 networkable classes writes its own
   bit-packed delta; a reader per class is strategy C of
   round-replay-capture, "weeks, not days". Without them the page can show
   where objects were created and the event story, but not where anything
   moves.
5. **Prediction.** The client predicts its own soldier and the server
   overrules it (P-1). Wherever our sim differs from the engine, the player
   is snapped back. How much is visible is only knowable once input reaches
   the server.

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
