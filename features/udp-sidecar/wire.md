# The BF1942 wire, read from the dedicated server

Everything here is read from `bf1942_lnxded.static` (the 1.61 Linux dedicated
server, sha256 `496672…447cf2`, the same binary the lab runs). Addresses are
that binary's. A POC client (`tools/bf1942-models/sidecar/`) implements this
and was run against the lab; what it confirmed and where it stopped are in the
POC status section at the end. This is the byte-level companion to
[netcode.md](../bf1942-engine-reference/subsystems/netcode.md); that note owns
the tick law and the `PlayerAction` record, this one owns the datagram and the
event layouts.

## 1. The datagram

The transport is `dice::ref2::io::NetServer` / `SWConnection`. The server's
receive loop `NetServer::_update` (`0x08433e60`) reads one datagram, switches on
the type nibble, and routes it. The header is **7 bytes**:

| byte | bits | meaning |
|---|---|---|
| 0 | 8 | connection id. The server assigns it in ConnectAccept; everything the client sends before carries 0, everything after carries the assigned id |
| 1 | 0–5 | **sequence** (6 bits, wraps mod 64) |
| 1 | 6–7 | low 2 bits of the **ack sequence** |
| 2 | 0–3 | high 4 bits of the ack sequence (so the ack is 6 bits) |
| 2 | 4–7 | **packet type** nibble |
| 3–6 | 32 | **ack mask**, little-endian: bit *i* set means the sender received (ack − *i*) |

The type nibble (`_update`'s switch, and `handleConnectRequest` reads `0x54`
bytes etc.):

| type | name | length | from |
|---|---|---|---|
| 1 | ConnectRequest | 0x54 (84) | client |
| 2 | ConnectAccept | 0xd (13) | server |
| 3 | ConnectDenied | 0x10 (16) | server |
| 4 | ConnectAcceptAck | 8 | client |
| 5 | Disconnect | 0x20c (524) | either |
| 7 | PingRequest | 0xd (13) | either |
| 8 | PingResponse | 0x11 (17) | either |
| 9 | ServerInfoRequest | — | client (no connection needed) |
| 0xa | ServerInfo | 0x88 (136) | server |
| 0xf | Data | ≤ 0x5c0 | either |

A payload rides a type-0xf datagram: `SWConnection::addPacketToSendBuffer`
(`0x0843bb80`) writes the header, a **u16 length** at byte 7, then the bytes,
and refuses when `payload + 9 ≥ 0x5c1` ("packet splitting is not supported"), so
**one payload is at most 0x5c0 − 9 = 1463 bytes**. The server's receive buffer
is 0x5c0 (`NetServer::_update` reads `0x5c0` into a stack buffer), so a whole
datagram is at most 1472 bytes.

### The connect handshake

`NetServer::handleConnectRequest` (`0x08436810`) reads the ConnectRequestPacket:
`u32` major version at byte 8, `u32` minor at 12, a password string at 16
(`checkPassword` / `checkReservedPassword`), a 4-byte reconnect key at 0x50.
`checkVersion` (`0x084367d0`) demands **major == 0x1002**; the minor is
`*(0x086b1580)` = **1610** (0x64a), the value `GameServer::startServer` passes
to `setVersion`. A mismatch sends ConnectDenied with PResult `0x17`
(VersionTooOld) or `0x18` (VersionTooNew). On success it allocates an
`SWConnection`, assigns it a connection id off a free-id deque (seeded to 0x40
entries), and `sendConnectAccept` (`0x08436110`): a 13-byte ConnectAccept whose
byte 8 is the id and bytes 9–12 the server's millisecond clock.

The client replies with ConnectAcceptAck (type 4, 8 bytes, byte 0 the id);
`handleConnectAcceptAck` (`0x08436560`) moves the connection from state 1 to
state 2. From here the connection carries the id in every header.

The PResult enum (from `operator<<` `0x0842af40`): 0 Ok, 1 NewConnection,
2 ServerIsFull, 4 ConnectFailed, 5 InvalidParam, 9 Failed, 0xd Disconnect,
0x11 InvalidPassword, 0x17/0x18 version, 0x1e InvalidReservedPassword.

### Acks, pings and the send window

Every datagram both carries a payload (if type 0xf) and acks the peer.
`SWConnection::confirmPacket` (`0x0843bfb0`) walks the sequences from the last
confirmed up to the header's ack, oldest first, reading the 32-bit mask to mark
each delivered or lost. `handleDataPacket` (`0x08436f30`) drops a datagram whose
sequence equals the last received or is more than 0x20 behind it (the usual
sliding-window dedupe). `SWConnection::send` (`0x0843be80`) refuses to send when
more than 30 sequences are outstanding (`0x1e < (seq − lastConfirmed) & 0x3f`).

A PingRequest (type 7) carries the sender's clock at byte 8 and a flag at 12;
the receiver answers PingResponse (type 8) echoing the clock. `_updateConnections`
(`0x08433af0`) pings a connection after 3 s of quiet and times it out; the
GameServer layer's `updateConnections` (`0x081391f0`) also sends TimerSync every
10 s. There is **no separate keepalive** — a client that sends input or pings
every couple of seconds stays alive.

## 2. The streams inside a Data payload

A payload is a `BitStream` shared by up to six stream managers. The connection
holds them in slots (`ClientConnection::ClientConnection` `0x081142a0`):

| slot | id | manager | what |
|---|---|---|---|
| +0x1c | 0 | PlayerActionManager | the client's input, client→server only |
| +0x20 | 1 | GameEventManager | the reliable event stream, both ways |
| +0x24 | 2 | GhostManager | object state, server→client |
| +0x28 | 3 | DownloadManager | file transfer |

The payload opens with a **6-bit stream-presence mask** (`transmitMsgs`
`0x081154a0` reserves `((this[0x153]?0:-1) & ~0x1f) + 0x26` bits — a 6-bit mask,
plus a 32-bit sequence tag when a flag at +0x153 is set, which the lab's
connections do not set). Bit *i* of the mask means stream manager *i* wrote into
this payload. The receiver (`ClientConnection::processReceivedPacket`
`0x081153f0`) reads the 6-bit mask and hands the stream to each present manager
in slot order. **On the LAN connections observed, the leading per-payload field
is the 6-bit mask with no 32-bit prefix.**

### The event block (stream 1)

`GameEventManager::transmit` (`0x0812d770`) and `processReceivedPacket`
(`0x0812e040`) frame it:

- **u8** event count
- **u5** block index (the sender's block counter mod 32)
- **u1** resend flag
- then *count* events.

Each event is **its type in 7 bits** then its body. The 7 is
`rangedBits(0, 0x40)`: the engine's ranged-unsigned helper
(`BitStream::readUnsigned(min,max)` `0x083da040`) counts bits until
`(1<<n)-1 >= (max-min)+1`, which for 0..0x40 is 7. Event ids come from
`GameEvent::initEvents` (`0x0811bee0`); the body layouts are each class's
`serialize()`, listed in §3.

Reliability is per block: `handlePacketStatus` (`0x0812df00`) re-queues a block
the ack says was lost, and the receiver reorders by block index before
delivering (`insertEvents` `0x0812e370`, `getNextRcvdEvent` `0x0812dfe0`).

### The bit order

`BitStream` is **LSB-first** (`writeBits` `0x083db030`, `readBits` `0x083daf50`):
bit *i* of the stream is bit `i & 7` of byte `i >> 3`, and a multi-bit integer
goes least-significant-bit first. A signed integer is a sign bit then `|v|` in
`n−1` bits (`writeSigned` `0x083da150`). A float is its four IEEE-754 bytes
(`writeFullVector` `0x083dac10` writes three raw 32-bit words). A ranged
unsigned writes `v − min` in `rangedBits(min,max)` bits.

### The input block (stream 0)

`PlayerActionManager::transmit` (`0x08148190`): a **u4 count**, then if count > 0
a **signed 32-bit first serial**, then *count* `PlayerAction` records.
`PlayerAction::writeToStream` (`0x08148750`) is six 12-bit axes
(Yaw, Pitch, Roll, Throttle, MouseLookX, MouseLookY) then a 32-bit button mask —
the 104-bit record of ledger W-1. The quantisation and button map are in
netcode.md §1; this folder does not restate them.

## 3. Event layouts

Decoded from each class's `serialize()`. Field widths in bits; `str(n)` is an
n-byte NUL-padded char array, `lstr` an 8-bit length then that many bytes,
`vec3` three float32s. The ids are `initEvents`. The ones a joining client
sends are marked →server.

| id | name | serialize | fields |
|---|---|---|---|
| 0x02 | Ack | `0x0811ff70` | u32 value |
| 0x04 | Simulation | `0x0811e1e0` | bool running, f32 worldTime |
| 0x05 | CreateMultipleObjects | `0x0811d500` | u32 template, u16 firstNetId, u4 count |
| 0x06 | DestroyObject | `0x0811d660` | u16 netId |
| 0x07 | CreateObject | `0x0811d360` | u32 template, u16 netId, bool hasTransform, then if set vec3 pos + vec3 rot |
| 0x08 | CreatePlayer | `0x0811ca60` | u3 team, u4 spawnGroup, bool isRemote, u8 playerId, u16 playerNetId, u16 vehicleNetId, u16 cameraNetId, u16 kitNetId, bool isAI, str(32) name |
| 0x09 | SetDefaultVehicle | `0x0811d020` | u8 playerId, u16 netId |
| 0x0a | SetVehicle | `0x0811ce60` | u8 playerId, u16 netId |
| 0x0b | ExitVehicle | `0x0811d110` | bool flag, u8 playerId |
| 0x0c | DestroyPlayer | `0x0811cbd0` | u8 playerId |
| 0x0d | SetPlayerName | `0x0811fb80` | lstr name, u8 playerId |
| 0x0f | ConnectionType →server | `0x0811e5a0` | ranged(0,6) type |
| 0x10 | UpdateRate | `0x0811e4d0` | u8 rate |
| 0x11 | CreatePlayerAck →server | `0x0811cc90` | u8 playerId |
| 0x13 | Map | `0x0811ec40` | bool add, u8 mapLen, u8 modLen, u8 mode, str(mapLen) map, str(modLen) mod |
| 0x14 | Challenge | `0x0811f1c0` | bytes(10) challenge, s32 xpack, u8 modLen, str(modLen) mod, bytes(8) |
| 0x15 | ChallengeResponse →server | `0x0811f4c0` | bytes(73) keyHash, u32, u32, u32, s32 xpack, bytes(32) statsResponse, u1 flag |
| 0x16 | GameRules | `0x0811f780` | f32 soldierFF, bool externalViews, bool noseCam, f32 ticketRatio, u32 timeLimit, u32 worldTime, bool crosshairCentre |
| 0x17 | WelcomeMsg | `0x0811f990` | lstr message, s8 index (bf42++ reads its server settings out of it, section 30) |
| 0x19 | CheckSum →server | `0x0811c580` | u8 n1, bytes(n1), u8 n2, bytes(n2), u32 value |
| 0x1a | ServerInfo | `0x08120880` | lstr mapId, lstr mod, lstr gameId |
| 0x1b | ServerInfo2 | `0x08120c40` | lstr serverName |
| 0x24 | GameStatus | `0x0811db80` | u8 status; **then, only when status == 5**, bytes(5), u8 length, that many bytes of text |
| 0x29 | TimerSync | `0x0811f5f0` | u32 timeLimit, u32 worldTime |
| 0x2a | ScoreMsg | `0x0811c8d0` | ranged(0,10) type, u8 playerId, then if type∈{3,6} u8 victim, u32 weapon, u8 bodyPart |
| 0x2f | SpawnRequest →server | `0x0811cd70` | u8 spawnGroup, u8 spawnPoint |
| 0x30/31/32 | StatsKills/Shots/Hits | `0x0811dd90`… | u8 rows−1, u8 playerId, then 10×(u32 template, u16 count) |
| 0x34 | DataBaseComplete | `0x0811c7b0` | u16, u16 |
| 0x35 | DatabaseCompleteAck →server | — | empty body |
| 0x36 | SetLevel | `0x0811d7e0` | str(64) levelPath, str(64) modeFile, then settings u8/u16/u32 |
| 0x37 | SessionId | `0x0811da60` | str(64) sessionId |
| 0x39 | SetTeam →server | `0x0811e390` | u8 team, u8 playerId |
| 0x3c | HitFromPos | `0x0811e770` | u3 sector, u8 strength |
| 0x3e | ChangeKit →server | `0x0811ed50` | u8 kit |
| 0x01 | HUDText (bf42++) | — | u3 kind, u7 length, that many bytes (section 30) |
| 0x1c | CreateStaticObject (bf42++) | — | u32 template, u16 id, bool, then if set vec3 pos + vec3 rot; bool, then if set vec3 scale (section 30) |
| 0x1d | UpdateStaticObject (bf42++) | — | u16 id, u2 action, then unless action == 3 vec3 value (section 30) |

The full id→serialize table (every event, not just these) is in
`tools/bf1942-models/sidecar/events.mjs`, which was generated by reading each
`serialize()` and is the machine-readable copy of this table.

## 4. The challenge and the content check

`ClientConnection::initChallengeString` (`0x08116280`) fills a 10-byte challenge
with random lowercase letters and sends it in the Challenge event. The client is
expected to return, in ChallengeResponse (0x15):

- a **key hash** (73 bytes, a GameSpy CD-key hash);
- **three u32 checksums** — the first is checked;
- the **xpack id** it echoes;
- a 32-byte stats-challenge response;
- a 1-bit flag.

`checkClientCheckSums` (`0x08133300`) is tiny: it returns
`(challenge[0..3] ^ response.first) == serverExeChecksum`, where the server's
checksum is a build constant **0xa14aac64** set at the top of
`calculateServerCheckSums` (`0x08133220`). So the client's first checksum must be
`challenge[0..3] (little-endian) ^ 0xa14aac64`. The second and third checksums in
the response correspond to the `objects.rfa` CRCs the server also computes, but
`checkClientCheckSums` only tests the first against the exe checksum.

The CD key is not enforced on a LAN server. The authenticator
`GameSpyHost::authenticateUser` (`0x0810b630`) compares the game id against the
literal `"lan"` and, when it matches, calls the callback with success
immediately ("LanGame Accept") without contacting GameSpy. On the lab
(`serverInternet 0`) the game id is "lan", so any key hash is accepted. The
content check is a separate gate: `Setup::getServerContentCheck` (`0x080d0ae0`)
reads `serverContentCheck` (0 on the lab, so off); with it off, the
`+0x170` content flag on the connection is forced true.

**An expansion's level wants two answers (2026-10-17).** A Road to Rome or
Secret Weapons server's Challenge names its product (`xpack` 713 or 783, from
`XpackUtils::getXpackProdId` `0x080d58c0`; -1 on vanilla). The retail client
answers every Challenge with a ChallengeResponse whose xpack is -1 and, when
the Challenge's xpack is not -1, a second with that xpack, in the same block
(BF1942.exe builds them at `0x0049502b` and `0x00495177`). Each one is an
authentication (prodId 541 for -1, else the expansion's), and
`authentificationOk` (`0x08139950`) counts them on the connection (`+0x16c`):
on a level whose map id is XPack1 or XPack2
(`checkXpackMapModIdForProdAuth` `0x080d6320`) it returns before SetLevel
until the second. One answer echoing 783 left the sidecar waiting on a
Secret Weapons lab server with nothing more sent; `session.mjs`
`challengeResponses` sends both, and it joins
(`features/fh-fhsw-open-issues/lab-firearms.md`).

## 5. The join state machine

Reading the server's own order (`GameServer::processReceivedPackets`
`0x08137ba0`, `handleGameEventManagerEvent` `0x08135cb0`, `authentificationOk`
`0x08139950`):

1. First datagram with a payload makes the `ClientConnection`; the server queues
   **ServerInfo, ServerInfo2, Challenge** to it, sets connection type 0 and chokes
   bandwidth (J-1).
2. The client answers. The event handler's switch (jump table at `0x086c035c`)
   routes: 0x19 CheckSum → content check, 0x15 ChallengeResponse →
   `checkClientCheckSums` then `authenticateUser` (LAN accept) then, in the
   callback `cdKeyAuthorizeCallback` (`0x08135940`), **`authentificationOk`**.
3. `authentificationOk` sends SetLevel, SessionId, the map list, then
   `sendDatabase` (`0x08134400`): a CreateObject per networkable, a CreatePlayer
   per player, scores, teams, **DataBaseComplete**, game status.
4. The client acks with DatabaseCompleteAck (0x35); the server answers with
   **SimulationEvent** (0x04), which marks the client live.
5. Leaving is a type-5 Disconnect datagram with reason 0xd, or a 0x0d sequence
   the GameServer turns into a disconnect.

## 6. POC status (2026-10-15)

`tools/bf1942-models/sidecar/` (Node, no deps): `bitstream.mjs` the BitStream,
`events.mjs` the event table and block framing, `netconn.mjs` the datagram
layer, `join.mjs` the join driver, `decode_pcap.mjs` a tcpdump-capture decoder
built on the same two modules.

**Steps 1–3 of the POC plan are done: the sidecar joins a retail server as a
real player, stays, and leaves cleanly.** Run against the lab
(`lab/scenarios/capture-wake.json` / `sidecar-wake.json`, Wake co-op, port
14568), `node sidecar/join.mjs 192.168.1.226:14568 --name sidecar --stay 20`:

- **Step 1, handshake.** ConnectRequest (major 0x1002 / minor 1610) →
  **ConnectAccept** (connection id, server clock) → ConnectAcceptAck. The first
  Data payload decodes byte-for-byte: the 6-bit stream mask, the event block
  framing, and **ServerInfo / ServerInfo2 / Challenge**. Pings round-trip.
- **Step 2, join.** The client answers the challenge, reads the whole world dump
  (101 CreateObjects, 9 CreatePlayers, SetLevel, SessionId, Map, GameStatus,
  DataBaseComplete), acks it, and the server replies with **SimulationEvent**
  (worldTime 155.4) — the live marker. The server logs `createPlayer` for
  "sidecar". `lab.py status` lists it as a player.
- **Step 3, stay.** The connection holds for the 20 s run, receiving ~257
  datagrams of ghost state and events (TimerSync among them) at ~2 ms rtt, then
  **disconnects cleanly** (type-5 0xd), which the server logs as
  `disconnectPlayer`. The server stays up.

**What the packet capture settled (the crash, J-8).** The earlier POC crashed
the dedicated server in `handleGameEventManagerEvent` at `0x08136992` — the
ChallengeResponse case null-derefs `player+0x198` when no `BFPlayer` is bound.
A tcpdump capture of a real client's join (the owner joined the lab, 2026-10-15;
`decode_pcap.mjs` reads it) showed the real client sends, client→server:

1. block 0: **ConnectionType(0), CreatePlayer(team 0, name)**
2. block 1, a **separate datagram** ~a tick later: **ChallengeResponse**
3. block 2, after the whole database arrives: **Ack(content), CreatePlayerAck,
   DatabaseCompleteAck, ConnectionType(5)**
4. later, with input: **SpawnRequest(group, point)**

The crash came from bundling CreatePlayer and ChallengeResponse into one block.
The real client always sends **ChallengeResponse in its own datagram, a tick
after CreatePlayer**, and holds the acks until DataBaseComplete. Matching that
order, the sidecar joins without crashing the server. The capture also confirmed
J-7 exactly: the real response's first checksum was `0x68686572 ^ 0xa14aac64 =
0xd32fc40c`, the captured value.

**Settled 2026-10-15: there was no unidentified tail event.** The "unsized type"
was the sidecar's own bug. `GameStatusEvent::serialize` (`0x0811db80`) writes the
five raw bytes, the length byte and the text **only when the status byte is 5**;
the sidecar's reader read them unconditionally, so every `GameStatus` whose
status was not 5 ran 56 bits into the next event, whose 7-bit type then read as
0. `GameEvent::initEvents` registers `0x02` through `0x3e` and nothing at 0 or
1, so the engine cannot send type 0. Re-framing a captured join payload from the
byte after an 8-bit `GameStatus` decodes the hidden event cleanly as
`GameRules` (`0x16`), whose worldTime (3151) sits two ticks behind the join's own
(3153). The three occurrences were exactly the three of the four `GameStatus`
events that were not last in their block. With `GameStatus` reading its tail
conditionally, the event stream decodes at **100%** and the review log has no
unknown event at all. `session.mjs` carries the conditional read; the finding is
`decodes/remaining-events.md`.

Still open from this section: step 5 (sending input, now built as
`sidecar/input.mjs`) and step 6 (the object decoders, now in `sidecar/ghost/`).

## 7. Notes

- **The crash is still in the shipped server.** Sending ChallengeResponse in the
  same block as CreatePlayer null-derefs it (J-8). The sidecar avoids it by
  matching the real client's packet boundaries; a third party that does not
  would crash a server. Keep experiments on the lab.
- **Lab only.** A third-party client on a public server can trip PunkBuster or a
  server's rules; the POC is for the lab (`+isInternet 0`, where the CD key and
  content check are off).
- **Reproduce.** `lab.py start lab/scenarios/sidecar-wake.json`, then
  `node sidecar/join.mjs 192.168.1.226:14568 --stay 20 --log run.ndjson`. To read
  a capture: `tcpdump -i any -s 0 -w cap.pcap udp port 14568` (needs
  `CAP_NET_RAW`; `setcap cap_net_raw,cap_net_admin=eip` on tcpdump), then
  `node sidecar/decode_pcap.mjs cap.pcap`.

## 8. The browser bridge and the review log (2026-10-15)

The sidecar now feeds the game into the **existing replayer** instead of a new
renderer. The decoded events map onto the bf42plus v5 recording schema that
`viewer/replay-recording.js` `parseRecording` already reconstructs (a pure,
Node-importable function, no DOM or WebGL), so the sidecar's output opens in the
replay viewer unchanged — no viewer code is touched.

Modules (`tools/bf1942-models/sidecar/`): `session.mjs` the reusable join +
decode session (used by both the CLI and the bridge), `record.mjs` the decoded
event → v5 record map, `review.mjs` the review log, `wsserver.mjs` a dependency
free WebSocket server, `sidecar.mjs` the bridge, `decode_pcap.mjs` the capture
reader, `join.mjs` the CLI tester, `page/index.html` a live monitor.

```
node sidecar/sidecar.mjs 192.168.1.226:14568 --name sidecar \
    --out run.ndjson --review run.review.ndjson --ws 17942 --stay 0
```

writes `run.ndjson` (a v5 recording), `run.review.ndjson` (the review corpus),
and serves a live feed at `http://127.0.0.1:17942/`.

**What renders now, and what does not.** bf42plus sampled object transforms from
the *applied client world* at 10 Hz (`k:"s"` records); the sidecar has no
applied world, only the raw ghost bits, so it does **not** emit `k:"s"` yet.
The recording therefore reconstructs the **static world, the roster and the
event timeline** — every object at its `createObject` position, players, teams,
kills, vehicle entries, chat, the clock — but soldiers and vehicles do not move
until the ghost bodies are decoded. Proven: a 12 s lab recording fed through
`parseRecording` returned version 5, level wake, 9 players, 113 objects, 31
events, **0 skipped lines**.

**The review log is the path to movement**, the same way the replayer grew:
everything not yet decodable is written to `run.review.ndjson` with a running
tally — unknown event types, unknown datagram types, decode errors, and above
all the **framed ghost records** (NET-5): one line per per-object update with
its netId, action and raw body bits. A lab run logged 927 ghost records in 12 s,
their body bit-lengths clustering by class (0xa2 for soldiers, and so on). The
next decode step reads those bodies — `BFSoldierNetworkable::setNetUpdate`
`0x08224e40` first, since it is the commonest and is what makes soldiers move —
and turns each into a `k:"s"` transform, at which point the replayer renders
movement with no further viewer work.

**Security, for when this leaves the lab** (not POC work, recorded so it is not
lost): `wsserver.mjs` binds 127.0.0.1 and can check `Origin`; a localhost
process that relays UDP must also pin the destination to game/query ports, guard
`Host` against DNS rebinding, and pair the page with a token. See the README's
"If it goes further".

## 9. Movement: decoding the soldier ghost body (2026-10-15)

The first object class decoded from the ghost stream is the soldier, because
"running around" is a soldier. `BFSoldierNetworkable::setNetUpdate` (`0x08224e40`)
reads a 15-bit field-presence mask then the present fields; **position is the
first field, gated by mask bit 0**, written as a `readCompressedVector` (a 2-bit
mode, then for mode 0 three absolute `float32` — the case soldiers use). The
field offsets came from P-4 and were pinned empirically against ground truth
(NET-6).

**Verified with the parallel recording.** On a lab round recorded by both the
real client (bf42plus, real positions) and the sidecar (raw ghost bits), the
sidecar's decoded track for a human's soldier (netId 1204 — the same server
netId in both files) matched the recorded positions to about a metre over a
140 m run, first and last points on the nose. That is the Rosetta-Stone check
of §C made concrete.

**How it reaches the replayer.** `soldier-ghost.mjs` decodes a soldier body to a
position; the sidecar emits a `k:"s"` transform sample per ghost block for every
netId it knows to be a soldier (a player's on-foot control object, from the
`control` / SetDefaultVehicle event), so the live recording animates. For a
recording captured before this landed, `enrich.mjs` reads `run.ndjson` +
`run.review.ndjson` and writes `run.enriched.ndjson` with the same samples added
— no re-run needed. Rotation is identity for now, so soldiers slide without
facing.

**Open.** Rotation (the quaternion later in the body) and the remaining P-4
fields; the other networkable classes, chiefly vehicles (a different body, so a
vehicle is left alone until its decoder lands); and soldiers that were already
in-game before the sidecar joined (their movement is captured only once they
respawn during the capture, since the soldier is identified from the spawn's
control event).

## 10. Object models: names are not on the wire (2026-10-15)

createObject carries only the numeric `tid` (the server's template load order),
not the template name a model is keyed by. The name is never sent — the real
client reads it from its loaded template table. So a sidecar recording places
every object correctly but blank, until each `tid` is given a name.

The tid→name map is **stable per level+mod** (the server loads templates
deterministically: two Wake sessions gave identical names for all 34 shared
ids). So it is built once from any bf42plus recording of that level —
`node sidecar/build-names.mjs <recording> sidecar/templates/<level>.json`
(`names.mjs`, `build-names.mjs`) — and reused. `enrich.mjs --names <map|recording>`
and `sidecar.mjs --names <map|recording>` apply it, setting `createObject.tmpl`,
which is what `replay-recording.js` uses to pick a model. With it, the Wake
recording resolves all 123 objects (soldiers, the carrier, destroyer, tanks, AA
and coastal guns, planes, control points) and the map fills in.

This is a data dependency, not a decode gap: a fully standalone sidecar needs
the level's template table. Since 2026-10-17 it is computed from the install
the way the game builds it (section 25); the recorded maps are fallback and
test fixtures. Vehicles now
appear at their spawn positions but do not yet move; the vehicle ghost body
(a different networkable class from the soldier) is the next decode.

## 11. Why an object renders: the replicated span (2026-10-15)

Placing an object is not enough for the replayer to draw it. `replay-actors.js`
draws a life only inside a **replicated span** (`isReplicated`): a soldier out
of that set is not drawn, and a hull out of it is a green "not in range"
standin. The span is opened by a **`k:"o"` record** (`replay-recording.js:954`)
and closed by `k:"d"` or destroyObject. The sidecar's first version emitted
events and positions but no `k:"o"`, so nothing was replicated — soldiers did
not draw and hulls showed as green standins.

The sidecar (and `enrich.mjs`) now emit a `k:"o"` the first time a netId appears
in the ghost stream — that object is in range by definition — with its name,
tid and team. On a lab run this brings ~46 objects into the drawable set
(soldiers at their decoded positions, hulls solid at their spawn). Hulls are
static until the vehicle ghost body is decoded; soldiers move; everything
in range now renders.


## 12. Facing: the soldier's rotation (2026-10-15)

After position (and velocity, when present), the soldier body carries its
facing as a 16-bit unit quaternion (`readUnitQuaternion`: a sign bit then three
`readSignedFloat(16)`, w reconstructed). The common 162-bit body is exactly
`15 (mask) + 2+96 (position) + 1+48 (quaternion)`. Decoded against the bf42plus
recording its magnitudes match (a pure-yaw quaternion); the sidecar now emits it
in the `k:"s"` sample in place of the identity rotation, carrying the last
facing forward on updates that omit it, so soldiers turn as they did in the
round. The wire yaw is mirrored relative to the replayer's frame — the same
BF1942-vs-viewer handedness flip (a Z negation) the viewer applies elsewhere —
so the decoder negates the quaternion's `y` before emitting
(`soldier-ghost.mjs`), which lines the decoded facing up with the bf42plus
ground truth (its `y` was the negation of the raw decode on a position-matched
sample). Steady-state facing is pure yaw (`x=z=0`); the first couple of samples
after a spawn instead carry a small rotation about `x` (the spawn-in pose, where
`y=0` and the negation is a no-op). Velocity, aim and the animation-state
fields (for a walk pose) are the remaining soldier-body work.

## 13. Stance and fire: the rest of the soldier body (2026-10-15)

A human recorded prone and firing showed neither in the sidecar's recording,
because the decoder stopped at facing. The rest of
`BFSoldierNetworkable::setNetUpdate` (`0x08224e40`) is now read from the
decompile (NET-7) and decoded in `soldier-ghost.mjs` (`decodeSoldierBody`):

| mask | field | read |
|---|---|---|
| (14 bits + 1 bool) | presence mask, then a flag | `readBits(14)`, `readBool` |
| 0x1 | position | `readCompressedVector` (mode 0: three `float32`) |
| 0x4 | rotation | `readUnitQuaternion(16)` |
| 0x2 | velocity | `readCompressedVector` (consumed) |
| 0x200, 0x400 | two vectors | `readCompressedVector` each (consumed) |
| 0x8 | aim twist | `readSignedFloat(16)` × template limit |
| 0x10 | aim pitch | `readSignedFloat(16)` × template limit |
| 0x20 | lower animation state | `readUnsigned(0, nStates-1)`: 11 bits for vanilla's 1395 states |
| 0x40 | upper animation state | the same |
| 0x1000 | two bytes | `readBits(16)` |
| 0x80 | hit points | `readUnsigned(0, round(maxHp))`: 7 bits for a soldier |
| 0x100 | held item | `readBits(32)` |
| 0x800 | state bits | `readUnsigned(15)` (0x10 chute, 0x20 zoom) |
| 0x2000 | kit part | `readBool` |

**Rotation comes before velocity.** §9 and §12 had them the other way round;
it never mattered because the two were not seen together in the bodies
checked. The order above is the decompile's.

**Checked against the run.** All 907 bodies of the human's soldier (netId 1204)
in the 2026-10-15 19:35 run decode to exactly their framed bit length (no
short or long reads), every lower index names an `Lb_*` state and every upper
a `Ub_*`, and the sequence reads as played: `Lb_RunForward` with
`Ub_FireType99` bursts and `Ub_FireGrenadeAxis` throws, `Lb_RunStandToLie`
into `Lb_Lie` with `Ub_LieFireType99`, `Lb_StandToCrouch`, a `Lb_RunJump` into
`Lb_ParachuteFall` / `Open` / `HitGround`, then `Lb_SwimForward`, `Lb_Floating`
and `Lb_DieSwim`.

**How it reaches the replayer.** The state indices are the engine's own table,
the one bf42plus writes as the v4 `anim` record, so the sidecar emits the
replayer's `st` rows (`[nid, lower, upper, pitch, twist, item, bits]`, on
change, `SoldierStateTracker`) and an `anim` record at the start. The table
comes from the names source: `build-names.mjs` now lifts it from a bf42plus
recording into `templates/<level>.json` (`animStates`), and `--names` on the
sidecar and `enrich.mjs` applies it; it also sizes the state fields
(`rangedBits(0, count-1)`). With it, the replay page shows the human prone
(`stance: prone`) at 51.7 s, prone-firing (`Ub_LieFire`) at 52.4 s and
throwing (`Ub_Fire`, GrenadeAxis) at 38 s, read from
`replay.soldiers.bodies.debug()` headlessly; `enrich.mjs` writes the same for
an existing run. Since 2026-10-17 the live sidecar and `rebuild.mjs` build the
table from the install instead (section 24); the recorded copy is the fallback.

**Open.** The aim limits are the soldier template's `+0x188` / `+0x18c` /
`+0x190` (property names not yet found; the template decompile by name came
back empty), so `pitch` and `twist` are carried normalised to [-1, 1] where
bf42plus writes degrees: near zero, harmless, but not the aim. Hit points
decode with a 100-hp width and read oddly (126 at spawn, 96 at drowning), so
the max or the min argument needs a second look before `hp` is emitted. The
state table is per mod: a mod's run needs a names file built from one of its own
bf42plus recordings. Vehicles are still the next body.

## 14. One record is a whole descriptor, not one networkable (2026-10-15)

The framing in §8 and NET-5 said a ghost record is one object's `setNetUpdate`
output. It is not: it is the object's whole **`NetworkableDescriptor`**, the hull
plus its child networkables concatenated.

`GhostManager::readData` (`0x08141ed0`) reads the 2-bit action, the 16-bit netId,
and for action 1 a bool and an 11-bit body length, then resolves the netId to a
descriptor (`networkManager` vtable `+0x2c` = `NetworkManager::getDescriptor`
`0x0842d2a0`) and hands **that descriptor** to `networkManager` vtable `+0x38` =
`NetworkManager::setNetUpdate` (`0x084315f0`). It then requires the bits consumed
to equal the framed length, and `skipBits`es them when the netId is unknown.

`setNetUpdate` is a nested loop: it walks the descriptor's networkable list at
`descriptor+0xc … +0x10` (stride 3 words, each entry holding an inner list) and
calls each networkable's own reader at vtable `+0x1c`, saving and restoring the
bit position around each. So a vehicle's body is its hull followed by its
Engine, Spring and RotationalBundle children in tree order, all inside one bit
budget, and a decoder that reads only the hull always stops short.

Two things follow. The child list is a property of the **template**, not of the
wire, so it comes from the object's `.con` tree (`ghost/children.mjs`). And the
exactness rule of §8 still holds, but it applies to the whole descriptor:
`ghost/verify.mjs` scores a decoder by whether it consumes the framed length
exactly, which is the same test the server's own reader is held to.

## 15. Which class reads which object (2026-10-15)

The wire never names an object's class. `CreateObjectEvent::serialize`
(`0x0811d360`) writes a 32-bit **template id** and a 16-bit net id; the class
comes from the client's own template table. The chain is closed in
[decodes/class-map.md](decodes/class-map.md) and available as data in
`sidecar/classes.json` (built by `sidecar/build-classes.mjs`):

```
tid -> template name -> the template's object class (the .con)
    -> that class's networkable class -> that class's setNetUpdate
```

The link that mattered: `PlayerControlObject` is conditional.
`PlayerControlObject::initNetworkableComp` (`0x08316ea0`) sends an object down
the `SimpleObjectNetworkable` branch when `obj+0x50` is non-zero, and
`PlayerControlObjectNetworkable::setNetUpdate` (`0x08232350`) is a bare `ret`
that writes nothing. Every vehicle in the capture therefore has its body read by
`SimpleObjectNetworkable::setNetUpdate` (`0x08236d00`), not by the PCO
networkable.

The thirteen networkable classes are registered by
`ObjTemplNetworkModule::getClassList` (`0x0822c360`): SimpleObject,
RotationalBundle, FreeCamera, BFSoldier, Spring, Item, Kit, PlayerControlObject,
Projectile, FireArms, ControlPoint, Engine, Objective. In the capture, 24
templates over six object classes appear: `SimpleObjectNetworkable` (every
vehicle and fixed gun), `BFSoldierNetworkable`, `ControlPointNetworkable`,
`KitNetworkable`, `FreeCameraNetworkable` and `ProjectileNetworkable`.

Decoders live in `sidecar/ghost/`, one per class, each scored by
`sidecar/ghost/verify.mjs` over the framed corpus. The score is strict: the read
must complete and stop on the last bit. A decoder that swallows an underflow
reports `consumed == bodyBits` while having decoded nothing, which is how the
M3A1 body first appeared to score 99.5% and in fact scores 0% on a hull-only
reader.

| class | decoder | verified |
|---|---|---|
| BFSoldierNetworkable | `sidecar/soldier-ghost.mjs` | 100% on all three soldiers in the capture |
| SimpleObjectNetworkable + children | `ghost/pco.mjs`, `ghost/children.mjs` | 100% on the M3A1; the other vehicles open |
| ControlPointNetworkable | `ghost/control-point.mjs` | 100% on the three control points |
| KitNetworkable | `ghost/kit.mjs` | 100% on the three kits |
| RotationalBundle, Engine, Spring, Projectile, FireArms, Item, FreeCamera, Objective | `ghost/*.mjs` | from the binary; the capture does not exercise most of them |

`sidecar/coverage.mjs` reports the whole picture over a recording plus its
review log, per class and per object: the event stream and the body stream, and
what is left in the review log.

## 16. A compressed vector's reference is zero, not the object (2026-10-15)

`BitStream::readCompressedVector` has two overloads, and which one a field uses
decides whether the value is absolute or a delta:

- `readCompressedVector(const Vec3& ref, float scale)` (`0x083db760`) reads a
  2-bit mode, then either three `float32` (mode 0) or three `readSigned` of
  `m_compressionVectorBitTable[mode]` (`[32,20,16,12]`), returning
  `ref + scale * delta`.
- `readCompressedVector(float scale)` (`0x083dabe0`) is a one-line forwarder:
  it calls the first with **`ref = *(Vec3*)(this + 0x58)`**, a vector inside the
  BitStream itself.

The soldier's position uses the second form (`BFSoldierNetworkable::setNetUpdate`
`0x08224e40`, scale `0x3a83126f` = 0.001), and nothing in the engine ever writes
`BitStream+0x58`, so the reference is zero: **the value on the wire is the
absolute position**, in units of the scale, in every mode. The other vector
fields pass `nullVec` explicitly, which is the same zero.

Reading the wire values as `scale * signed` confirms it: a walking soldier's
successive positions come out as a smooth track (297.7, 14.9, -83.1), (297.9,
14.9, -83.1), (298.2, 14.9, -83.1). Treating them as deltas relative to the
object's last position instead makes each one compound: a live soldier's track
reached kilometres in seconds.

**The mistake is invisible to a consumption test**, which is why it survived a
100% strict score for a day. One soldier's 1535 bodies, decoded both ways:

| reference | strict | threw | positions outside any map |
|---|---|---|---|
| zero (correct) | 1535 | 0 | 0 |
| the object's last position | 1535 | 0 | 1045 |

Identical consumption either way: the reference changes what the numbers mean,
never how many bits they take. `ghost/verify.mjs` therefore scores a decoded
position for plausibility as well as consumption, and any decoder here should be
checked against where its objects can plausibly be, not only against the bit
count.

## 17. Seats, scope, hull damage and rounds (2026-10-16)

From a live round (drive an M3A1, man its .50, kill it with a Chi-ha), whose
replay showed the hull mirrored, the gunner back at the entry point, and no
shots or wreck.

- **Hull facing is mirrored like the soldier's.** `ghost/pco.mjs` and
  `ghost/simple-object.mjs` now negate the quaternion's y, as
  `soldier-ghost.mjs` does; unflipped, the M3A1 faced +81 deg driving at -81
  (`tests/test_sidecar_vehicle_heading.py`).
- **A seat is the hull's netId + n with no createObject**, the rule the
  viewer's `rootOf` already uses. Its descriptor has no hull body
  (`PlayerControlObjectNetworkable::setNetUpdate` is empty), only its child
  tail: the M3A1's seat 1 is `R R F` with magazine widths 9 and 2, which lands
  every one of 112 live records exactly (`SEAT_SPECS` in `ghost/children.mjs`).
  The sidecar writes no k:"o" for a seat, so the viewer puts the gunner on
  the hull.
- **Ghost action 3 is a scope-out.** `GhostManager::readData` `0x08141ed0`
  calls `disableObject` on it and `enableObject` when an action 1 brings the
  descriptor back, so it is a k:"d". The server scopes a hull and its seats
  separately (the unmanned M3A1 dropped out while its .50 stayed in), so a seat
  in scope keeps its hull open.
- **Hull hit points** (mask 0x10) become k:"a" rows; 0 is the viewer's wreck.
- **Rounds come from the FireArms counter, not from projectiles.** No tank
  shell or MG round is ghosted. A FireArms child's magA steps down once per
  round (Chi-ha main gun 31 -> 30, the .50 cycling 501..496) and each step down
  is a k:"f" credited to the seat's occupant. The small tid-0 objects that appear
  with a soldier (685, 712..714) carry 7- and 11-bit bodies, too short for a
  projectile's 8-bit mask, so they are not rounds; most likely his kit's
  weapons (unconfirmed). The .50's counter wraps upward every sixth round, which is read as a
  reload, so about one round in six is not drawn.

`sidecar/ghost-writer.mjs` writes all of these for the live sidecar and for
`sidecar/rebuild.mjs`, which re-derives a recording's ghost rows from its
review log (`tests/test_sidecar_rebuild.py`).

## 18. Getting out, and when a shell left (2026-10-16)

The replay of the same round still lost the player between the M3A1 and the
Chi-ha, and drew the tank's shells late.

- **Getting out hands the player back his soldier.** The server sends
  ExitVehicle (0x0b) and nothing else: no SetDefaultVehicle names the soldier
  again, though the soldier's own ghost records resume (707, 90.4 s to 99.0 s).
  The viewer's `controlledAt` therefore kept him in the hull he left. The ghost
  writer now follows each ExitVehicle with a `control` row for his soldier,
  marked `derived: 1` (the server never sent it, and `rebuild.mjs` drops it on
  input). A bf42plus recording carries the same fact in its k:"p" rows.
  ExitVehicle's flag is now recorded; flag 1 is skipped by the viewer, as in
  its binary path.
- **A FireArms counter steps one round interval after the round.** The
  writer (`FireArmsNetworkable::updateStateMask` `0x08228d10`) sends the first
  magazine's count, and the Chi-ha's steps at 104.27 s and 109.42 s. The M3A1
  lost hit points at 101.72 s and 106.72 s, from 27.5 m and 14 m with
  `velocity 80`: the shells left at 101.37 s and 106.54 s, 2.90 s and 2.88 s
  before the steps. `Chi-ha_GunBarrel` has `roundOfFire 0.35`, so one round
  interval is 2.86 s. A k:"f" is now dated `t - 1 / roundOfFire`
  (`children.mjs` `rof`, `fireLagFor`) and credited to whoever sat in the seat
  then. At those times the hull faced 113.6 deg and 84.0 deg with the M3A1 at
  117.2 deg and 92.7 deg; the turret's own traverse (the first R child,
  `angleX * 180`) was 2.4 deg. Only the Chi-ha and Sherman main guns have a
  `rof`; a gun without one is dated at its step (the .50's interval is a
  tenth of a second).
- **Still open.** A k:"f" carries no muzzle or direction, so the viewer fires
  the gun at its rest pose on the hull. The turret's traverse and the gun's
  elevation are decoded but not written as k:"j" part rows.

## 19. Scored against the retail client's own recording (2026-10-16)

The owner recorded one Wake round twice: the sidecar, and his own client with
bf42plus (fly the Zero off the Shokaku firing, drive a Sherman and fire three
shells, run with a Type99, watch the village and the beach change hands).
Network ids are the server's, so the two files name every object alike;
`sidecar/compare.mjs` aligns their clocks on shared events (enterVehicle,
control, the 10 s clock ticks) and scores positions, rotations, hit points,
rounds, wrecks, DestroyObject, seats, tickets, flags, the event story,
stances and part rotations, only over the spans an object was in the
sidecar's scope. Before the fixes below it listed 30 mismatches; after, none
(`tests/test_sidecar_compare.py`, fixtures `*_wake_zero_sherman*`).

- **A run without `--names` replayed as an empty map.** Every template was
  blank, so the replay had no model for anything. The sidecar now names its
  objects from `templates/<level>.json` and the class map once setLevel
  arrives, and `rebuild.mjs` fills a blank recording the same way.
- **Hit-point width is the template's.** `SimpleObjectNetworkable::
  setNetUpdate` `0x08236d00` reads the hit points as `readUnsigned(0,
  round(armor->getMaxHitPoints()))`, so a Hatsuzuki (300) sends 9 bits and a
  Daihatsu (150) 8; read at 7, they came out as 44 and 22. `hulls.json`
  (`build-hulls.mjs`, from the models' root extras) carried each hull's
  `maxHp`; since section 26 the level's own templates do.
- **A fixed gun sends no controller vectors or flag.** The same function
  reads the six vectors and the 0x80 flag only when the physics node's
  vtable +0xe0 says it moves, whatever the mask says. A Defgun or an AA gun
  (`hasMobilePhysics 0`) has the flag bit in its 0x493 mask but none on the
  wire; reading one halved its hit points (50 as 25, 100 as 50).
- **A hull's rotation is the wire quaternion's conjugate.** Section 17's fix
  negated y alone, which put the yaw right and mirrored pitch and roll: the
  Zero was 26 deg off the client's own (median, 78 at p95) and climbed nose
  down. x, y and z are now all negated; the Zero is 1.5 deg off.
- **A round is a step down of the counter, one per firing.** The counter's
  rises (a Zero's 901 -> 895 -> 901, the .50's 501 -> 497 -> 501, a
  Sherman's 30 -> 31 between shells) are not rounds: the client has five Zero
  rounds for five steps down and two rises, three Sherman shells for three
  steps down and two rises. A two-muzzle gun (ZeroGuns, CorsairGuns) steps by
  2 per firing and the client writes one round. Section 17's "one in six
  lost" was the opposite reading and put a phantom shell in the Sherman.
- **A soldier's rounds are his state bits' counter.** His kit's FireArms is
  ghosted only on pickup. Bits 8-10 of the soldier's state bits jump up on
  each round and decay a tick at a time; each rise is a round (the client's
  four Type99 rounds are the four rises, 0.1 s before each).
- **Every round carries `w`, `p` and `d`.** The gun's template name, its
  pitch part's pivot (`hulls.json` `parts`) and the hull's rotation times the
  seat's traverse and elevation as of the round's (backdated) time. All 34
  match the client's within 0.35 s, their directions 1 deg apart (median).
- **A map reset empties the scope.** After ResetMapEvent the server sends
  every object still in scope a full body again; one out of scope gets
  nothing and no action 3, so the bot's Corsair stayed parked in the
  recording while the client saw it fly. The writer now closes every object
  on the reset.
- **A Daihatsu's ramp leaves are joint rows**, each turning about X by its
  bundle's angleY, the outer riding the inner (65 + 180 = 245 deg, the
  client's -115).
- **Soldier hit points** go to k:"a" as hull hit points do, and a control
  point carries the name the game prints (`cpNames` in the level's map, from
  a client recording's k:"cp" rows: "Village", not ALLIES_north_village).

What the comparison does not count: the client's own soldier's animation
states (its local animation picks a weapon aim pose under a parachute where
the server sends Ub_ParachuteOpen), objects the sidecar's free camera never
had in scope, and a tenth of a second of lead or lag between a remote object
as the client drew it and as the server sent it.

## 20. The client side of play: input shape, turn law, smoothing, correction (2026-10-16)

The owner played the live page against the lab with a retail client in the same
round and reported teleporting, a dragged look, a floating remote soldier, a
death the page ignored and a prone loop. Each was a general fault in one layer,
and each layer is now what the binaries say.

**Input record** (`sidecar/input.mjs`):
- The engine acts on a channel every tick it is down
  (`BFSoldier::handlePlayerInput` 0x08273c70; the Lie arm at 0x08275593 tests
  channel 28 each tick). The control map makes Action, Reload, Drop, Lie, the
  MenuSelects and the camera toggles `c_CMNonRepetive` (Infantry.con), so on the
  wire they are one-tick presses. The page sends levels; `PageButtonEdges`
  converts every non-repetitive bit to a press on its rising edge, and the
  prone toggle state to a press on each change.
- MenuSelect1..9 are record bits 6..14; `GameServer::checkPlayerTriggers`
  0x0814f2c0 sends the soldier message 10 + n for channel 13 + n. The page's
  word now carries them (kit item presses never reached the server before).
- The look axes are per-tick values. Every page word is sent exactly once, in
  order (`InputSender.enqueue`); an idle repeat zeroes the look and the presses.
- The ack: `GhostManager::updatePlayerControlObject` 0x08142210 stores the
  player's `ActionBuffer+8`, which `GameServer::simulatePlayerUpdate` 0x0815bd00
  sets to the serial of the action it consumed that tick.

**Turn law** (`viewer/mouse-input.js` `SOLDIER_MOVING_TURN`): handlePlayerInput's
twist register +0x288 makes the view turn 3 d a tick standing and 6 d moving.
Measured live: same look words, server 112.8 degrees against the page's 58.4
before; 110 against 117 after.

**Remote smoothing** (`viewer/net-sidecar.js` `xfAt`):
`SimpleObjectNetworkable::predict` 0x08237a90, mode 1 (the default, ctor
0x0842b570): draw at now - 100 ms (`interpolationTime`, NetworkManager+0x44)
between the embracing samples, never across a 500 ms gap; past the newest,
extrapolate by the last pair's velocity x elapsed — `pos = newest +
(elapsed / gap) x (newest - prev)`, the gap replaced by `extrapolationTime`
(+0x48) only when it is zero or NaN — for up to 1200 ms, then hold the newest.
(An earlier reading divided the velocity by extrapolationTime as well, and the
page drew every object at 83% speed through every packet gap, snapping it
forward on the next sample; re-read in the decompile 2026-10-18.) The
in-window blend is a slerp on the rotation and a lerp on the position, and a
pair closer than 1 ms draws the newer sample whole. This replaces the
P-2 reading: the functions P-2 named (0x00489ed0 / 0x00489cb0 / 0x00498ce0) are
the ghost-priority pass of the client's local host (distance, view cone,
speed; priority 10000 seeds), not smoothing.

**Own-player correction** (`viewer/net-room.js`): the client's
readControlObjectState (BF1942.exe, read sequence at 0x004968b2) calls
IGameClient vt+0xa0 (`queryInterface` 0x00492ce0 returns this+0x144; vtable
0x008d93d0 slot +0xa0 = 0x00491c90), which drops acknowledged actions, sets the
body to the server's state and re-runs every unacknowledged action at the fixed
tick, with no smoothing or threshold. The reconciler closes the whole error at
the acked tick (smoothing 1). Live: error median 1.8 cm, p90 12 cm.

**State and events**: a soldier's wire position is his origin, 1 m over the
feet (PHY-10), removed at ingest by networkable class; ScoreEvent kind 3/6 is
the killer's row and kind 4 the victim's own death, which the page now applies;
the page takes its own player from the sidecar's `k:"me"` id.

**The server runs nothing without the client's input, and says nothing back.**
A client that sends no input words gets no control-object state at all (live
probe: every ghost block `hasControl` 0 for a spawned soldier), so there is no
ack and no server position for the reconciler. On 2026-10-16 the sidecar's
reconnect (the lab drops clients at a map load) left its input sender bound to
the closed session: a page word in the 3 s wait rebuilt it there, and the new
session's join kept it. The server's soldier stood at his spawn for two lives
(the lab's event log: spawn 1001.8/104.1/822.9, killed at 1001.8/105.1/822.9)
while the page walked to the jeep 37 m away on prediction alone, uncorrected,
which also made it feel smoother. The sender now belongs to one session and is
rebuilt for the next, and the sidecar prints when page words are dropped
unsent. Live, with a forced reconnect: acks 60 per 3 s before, 0 after on the
old code, 55-60 after on the new, and the respawned soldier's server samples
follow the page.

**A standing soldier's view is his body yaw turned by the twist.** The look
turns the twist register (`BFSoldier+0x288`, the body's aimB, the `st` row's
twist), and `handleUpdate` 0x08271f86 draws the view `rotateYDeg(-3.0 x
+0x288)` off the body; moving folds the twist into the body. Live probe: a
standing turn left aimB at -14 and the first moving tick turned the body 42
degrees with no look input. The page took a standing spawn's body yaw as its
facing and walked up to 48 degrees off the server's heading for the whole life,
each ack dragging the body 0.17 to 0.36 m sideways (the owner's stutter,
2026-10-16). The sidecar's self row now carries `viewYaw` (body yaw + 3 x twist
in the page's sense), and the reconciler takes the facing the retail way at
every ack: the server's view yaw at the acked tick against the page's own yaw at
that tick (the ledger records it), closed whole, the newer turns on top
(`facing: 'acked'`). Harness: page yaw minus server view yaw within one tick's
turn (3 degrees) standing, turning and walking; correction error median 19 cm
-> 1.8 cm, sideways slip p95 18.8 -> 1.3 m/s.

**Samples are timed by the server's tick.** The server sends 20 ghost blocks a
second over its 30 ticks, so blocks are one and two ticks apart in turn (live:
200 and 199 of each) while they arrive evenly. Timed by arrival, a walking
remote was drawn at half and double speed in turn (frame speed against its
running median 0.51 to 1.85, p5-p95). Each `s` row now carries the block's
`tick`; the page times samples as tick / 30 s and maps its clock to the
server's with the least offset seen (a packet is only ever late), rising slowly,
instead of re-anchoring on every arrival: 0.95 to 1.08 for a walker, 0.98 to
1.01 for a plane.

**A seat is the server's to give.** Against a real server E is Use on the input
word and nothing more; the page takes the seat when the server's enter arrives
(`adoptServerSeat`, granted even for a hull the page thinks a wreck) and leaves
it when the server's exit does. The page used to seat itself on its own parked
copy, which on 2026-10-16 was the south base Sherman the server's bot had driven
to the beach: the hull was thrown to the beach and back and the server never had
the player in it. And a server hull binds to the placed hull's ROOT node: every
node under a placed Sherman carries its control tag, and the nearest one bound
the hull to `ShermanEntry`, a node with no seats and no drive. Harness: E in the
open stays on foot; at the jeep the page follows the server's enter and exit
within 200 ms, its hull a TrackedVehicle within 4 mm of the server's at the
seat. A seat switch (1..9) is the same: the press goes on the wire and the page
takes the seat the server's row names (`followServerSeat`); live, the Sherman's
seat 0 -> 1 -> 0 followed within 250 ms each way.

**The driven hull is corrected the soldier's way.** BF1942.exe predicts its own
control object every tick whatever it is; `readControlObjectState` (0x004968a0,
not 0x004968b2, which is inside it) applies the server's state at once
(`setNetUpdate` with apply = 1: transform, velocities, children), and the
handler at 0x00491c90 re-runs the unacknowledged actions through
`performMobilePhysicsUpdate`, one 1/30 s tick each. Seat changes are never
predicted: the client's trigger function 0x004b7fc0 never tests Use, and
`Game::enterVehicle` / `exitVehicle` are stubs; only SetVehicle and ExitVehicle
move the client. The page's tick ledger now carries the driven hull's pose, and
`createHullReconciler` (netcode-reconcile.js) applies the server's error at the
acked tick to the present hull, orientation and velocity included, the newer
ticks on top. Measured on the old law (newest pose against the present one):
about 2 m at 12 m/s, read as error and dragged back. On the new one, a Sherman
through a 160 degree turn: 2 to 65 mm at the acked tick, the two hulls coasting
to rest 0.1 m apart. Two pitfalls found on the way: every node under a placed
hull carries its control tag, so a server hull must bind to the subtree's root;
and a drive's orientation is a hair off unit length (1.056 on an M3A1), which an
unnormalised conjugate turned into a velocity growing by its square on every
correction, to Infinity in a second.

**A hull another player holds is off the page's field.** The page keeps its own
parked copy of every hull, and against a real server a bot's Sherman stood on its
south base pad while the server had it at the beach: the occupy callback runs in
the renderer, which does not run on the deploy screen or between lives; a miss
before the level indexed its hulls was cached for good; and hiding the node was
undone every frame by the pads' visibility pass. The server's occupancy now
decides in `syncHulls` every frame, through the pads' own live set
(`setRemoteLive`, which also takes the copy off the field), and a hull its
driver leaves stands back up where the server has it. Live: every bot-held hull
on Wake stood down, deployed or not (Sherman 550 and 532, the AichiVal, a Zero).

Not a physics gap after all: fed the exact words the server ran, the page's
`TrackedVehicle` turns within 3 degrees of the lab's Sherman (a background
investigation, 2026-10-16). The live 25 degrees is still unexplained; the leads
are the live drive's inertia box (the footprint fallback turns about 70 degrees
more in 2.5 s) and words the server dropped or held (its acked serial wandered
+-2 ticks).

## 21. Off Wake: El Alamein, Midway and Kursk (2026-10-16)

A headless page driven against the lab on three more levels (the harness in
memory: `project_sidecar_headless_harness`), each with two bots and the probe
on one side. What Wake had hidden, and what is now true:

- **A template id is the level's own load order.** A Sherman is 2916 on Wake,
  2914 on El Alamein; an M3A1 2790 and 2788. The sidecar named every level's
  objects, and picked their body readers, by Wake's ids. Names now come per
  level (`sidecar/templates/<level>.json`, built from the lab's server
  recordings, which carry id and name together) and the class from the name
  (`template-class.mjs`). A level whose known ids all agree with Wake's
  (Midway, 25 of 25) borrows Wake's names for the rest, never its control
  points.
- **Every vanilla vehicle's body decodes.** The child sequence of a vehicle's
  descriptor is the template tree walked depth-first and then grouped by
  `compareProperties` (`decodes/vehicle-children.md` section 6); 54 vehicles
  derived, every template seen live reading 100% strict.
- **The page plays the server's game type.** A co-op server plays the level's
  SinglePlayer layer; the page loaded Conquest, and Midway's whole fleet stood
  1350 m from the server's. The hello now names the game type.
- **A gunner's control state** is his seat's child tail; it reads now, and the
  serial echo acks the page even when a body does not read.
- **A press from a page that sends no words** (its deploy screen) rides the
  sidecar's idle records.
- **The soldier's wall reach is the engine's 0.40 m** (`soldier-resolve.js`
  `HULL_REACH`); 0.30 m stopped the page 9 cm into walls a server held it off.

Measured (correction error at the acked tick, median / max):

| level | on foot | hull |
|---|---|---|
| Wake | 1.8 cm | Sherman 1.7 / 13 cm, M3A1 2.8 / 18 cm |
| El Alamein | 3.5 cm | Sherman 1.4 / 8 cm |
| Midway (carrier deck) | 2.4 cm | Corsair 6 / 37 cm, SBD 6 / 37 cm (take-off) |
| Kursk (Axis) | 1.2 cm | Kubelwagen 16 / 49 cm |

Remote soldiers drawn at 0.95-1.05 of their running speed on every level;
every parked copy on its server pose.

Open: the wheeled cars' 16 cm (a physics investigation is out on it); the
Panzer IV on Kursk did not seat from what the page's copy calls its entry
point; Kursk's co-op rounds end every 8-9 minutes at 8 slots, short for a
walk-board-drive run.

## 22. Text chat, both directions (2026-10-16)

Ledger CHAT-1..CHAT-5 hold the addresses; `sidecar/chat.mjs` the protocol.

- **The piece.** `ChatFragment` (0x28): bool first; on a first piece only,
  bool team, bool noSender, bool serverFlag, u8 sender (absent with
  noSender), u8 the line's length; then on every piece a 4-bit length and the
  bytes. The old reader took the header on every piece: a line's second
  piece read 20 bits too many and the rest of its event block went wrong.
- **Sending.** At most four lines wait, each cut to 63 bytes; the head line
  goes out 15 bytes a piece, one piece every 0.5 s, and the next line starts
  when it is done. The client sends sender 0xff; the server writes in the
  connection's player. A piece out of order (a first while a line is open, a
  later one with none open, or past 64 bytes) is not dropped: the server
  disconnects the client, reason 0xd. So `ChatSender` never interleaves.
- **The relay.** Every connection with a player gets the line except the
  sender's own; team chat only the sender's side. No alive test: a player on
  the spawn screen hears everything. The sender is never sent his line back,
  so the page writes its own (`net-room.js` `room.sendChat`).
- **Live, Kursk co-op, 8 slots.** chatA (pid 1) and chatB (pid 2), both team
  2, neither spawned. chatB heard `hi all`, a 55-byte line in four pieces at
  0.5 s spacing, and two team lines with team set. chatB then sent `setTeam 1`
  (the event log has it at 144.879). After that it heard the all-chat line
  and the 63-byte cut of an 85-byte line, and not chatA's team line. chatA
  heard chatB's reply with pid 2. The server's event log has all eight lines
  as `chat` events, with `team` 2 for team chat and 0 for all chat.
  `tests/test_sidecar_chat.py` replays those datagrams (the server's bytes and
  ours), and the sent ones rebuild byte for byte.
- **Records.** `{e:'chat', pid, text, team}` with `team` 1 for team chat;
  `pid` -1 and `server` 1 for a server line. The page's action is
  `{type:'chat', text, team}`.


## 23. Shooting each other, and the hit wash (2026-10-17)

Two node clients on one side (friendly fire is on in the lab), Wake co-op
with `lab/scenarios/sidecar-wake-tickets.json` (5x ticket ratio: 1000 a side,
so a round outlives a run; `serverTicketRatio` alone did not take, the
autoexec's `admin.setTicketRatio 1.00` from server1 overrode it until the
scenario appended `admin.setTicketRatio 5.00`).

- **A gunner's gun fires from the input word.** In the M3A1's .50 (seat 1,
  `menu2`), `fire` held 4 s stepped the FireArms counter 38 times
  (`roundOfFire 10`), and the other client's ghost of the seat stepped the same
  38. The counter wraps 496 -> 501 every five or six rounds, so a burst's first
  and last value can be equal: count the steps down, never compare the ends.
- **A soldier's rounds, seen from the other client.** A's own control state
  and B's ghost of A carry the same state-bits sequence (bits 8-10 jump to 7,
  4-6 on each round, decay to 0), and the aim pitch climbs 0.06 -> 0.75 deg
  over a 14-round BAR burst (recoil).
- **The kill.** At 6.9 m B got `HitFromPos` (sector 6, strength 191: the
  0.75 cap), his hp 30 -> 8, then `ScoreMsg` 6 (team kill: A, victim B,
  weapon 1223, body part 42) and `ScoreMsg` 4 for B, and B's control went to
  `FreeCameraNetworkable`. Every client gets both ScoreMsgs; only the victim
  gets `HitFromPos`. Ten seconds later the body's `DestroyObject`.
- **Walking off the island.** A node client that strayed out of Wake's
  playable area got `HitFromPos` once a second (strength 42) and then died:
  the combat area's timed damage, by the look of it (not checked against
  the level's area).
- **`HitFromPos` is the page's wash and arc.** `_giveDamage` (lnxded
  `0x0814b870`) sends a remote victim the octant 0..7 and
  `trunc(min(damage / maxHp, 0.75) * 255)` (ledger HFD-2, HFD-3). The retail
  receiver (BF1942.exe `0x00494dc3`) does `inc al` on the octant and multiplies
  the byte by `0.003921569`, then `BfMenu::setHitFromDir`, nothing else.
  `net-sidecar.js` turns the row into `{type:'hitFrom', dir, alpha}`, and
  `net-room.js` hands it to `triggerHitIndicator`. Off a real server the HP
  poll in `soldier-hud.js` no longer raises its own wash, which pointed every
  hit at 1 (the arc the layout never draws) and could land after the server's
  arc and overwrite it. Live: the page shot four times by a node client read
  HitFromDir 5 at alpha 76/255 on each round, its hp 30 -> 21 -> 12 -> 3 ->
  dead, and it respawned on the next wave.
- **The page's own rounds.** The page, aiming with its own camera through
  the mouse path (`__lookDelta`) and firing with `__setTrigger`, killed a
  node client 6.4 m away on the flat at South_Base with its first burst:
  four `HitFromPos` (sector 0, 76) on the victim, `ScoreMsg` 6 and 4, and the
  page's log read `hprobe_1 killed a teammate` / `st140 is no more`. Up a
  slope (target 1.4 m higher at 7.8 m) the same aim missed every round,
  though the server's pitch agreed with the page's to 0.1 deg. Run down in
  section 33: the view is 2.5 times that pitch (the aim register), so the
  server fired 25 degrees up, over his head.
- **The view's pitch is closed at the acked tick, as the yaw is.** The page
  once spawned with its view 16.0 deg up while the server's soldier was
  level (aimA 0), and the page's look deltas then moved both by the same
  amount (a 20 px look: -0.81 deg on each), so the 16 deg held for the whole
  life: the page aimed at a chest and the server fired 20 deg down. The
  ack now carries the control state's aimA (`sidecar.mjs`), the page's tick
  ledger its pitch, and the reconciler's 'acked' law closes the difference
  whole, as the retail client takes the whole control-object state.
  Checked live: the page looked down 10.12 deg, its local pitch was reset
  to 0, and the next ack (100-200 ms) put it back at -10.12.
- **Aiming a node client is harder than it looks.** The body yaw is the
  view's only while walking; standing, the view is the body turned by 3 deg
  per unit of twist (aimB), and the body yaw read 70 deg off within 0.6 s of
  stopping. Recoil climbs and stays (aimA +7 deg after 40 BAR rounds), so
  every burst after the first goes high unless the harness pulls it back.
- **Radio's bool is "team".** `GameServer::radioMessage` (lnxded
  `0x0813a120`) drops a dead speaker; with the bool set it sends the event to
  every connection on the speaker's side but his own, and clear, to every
  player of either side within 70 m of him (`closeToPos`, 70.0f): a shout.
  The record's `global` (the recorder format's name) is that bool, so
  `global: 1` is team radio. Live: a teammate got both a team message and a
  shout from 4 m away; three clients that had not spawned got nothing (their
  side did, client-side, by RADIO-7).
- **A restart's deaths print, as in retail.** The server kills every player
  at a round restart and when a player disconnects, one `ScoreMsg` 4 each,
  and the page prints `<name> is no more` for each. The retail client does
  the same: its event switch (BF1942.exe `FUN_004933d0`, case 0x2a) builds
  the lexicon's `DEATH` line for type 4 and hands it to the kill messages
  (`0x006a9020`) with no game-state test, and the local player's own also
  goes to the centre line (`0x006a88e0`).

## 24. Tables a client builds from its install: animation states, control point names (2026-10-17)

Two inputs the sidecar used to lift from bf42plus recordings now come from the
game files, the way BF1942.exe gets them (`bf42/game_tables.py`, run by
`sidecar/game-tables.mjs` through `sidecar_tables.py`; ledger ANIM-17, ANIM-18,
LOAD-11). The inputs are the ServerInfo event's mod and the SetLevel event's
level and game type, which every retail client receives.

**The animation state table** (`[index, name, flags]`). A soldier body's lower
and upper states are indices into the engine's state vector, read in
`readUnsigned(0, count-1)` bits (section 13), so the count must be right before
a single body decodes. The vector is what `Animations/AnimationStates.con`
builds, and `Game::load` (lnxded `0x0805b4b0`) runs that script at every level
load, after the level's `Init.con`, with `AnimationStateMachine.init` first
(`0x08327250`, a fresh machine). So it is a mod's table on a level: FH, FHSW and
FHSWEurope levels add states through their own `animations/` folder (FH Cretan
Village 9,180 against FH's 8,840), vanilla, the two packs, DC, DC Final and EoD
levels never do. The flags column is the OR of each state's `setFlag` constants
(`c_AsmHideWeapon` 2 .. `c_AsmIsLying` 0x40). The body decoder
(`body-decoder.mjs`) sizes its state fields from the table at each SetLevel, the
control-state reader takes the same count, and `sidecar.mjs` writes a new `anim`
row whenever the level brings a different table.

**Control point names** (template -> the word the game prints). The name is the
template's `ObjectTemplate.setControlPointName` word (written to the template's
`+0x1e4`, lnxded `0x08309c90`), a lexicon key (`Landing_Beach` is "Landing Beach"
in `lexiconAll.dat`). The templates come from the files the level's root
`<mode>.con` runs, outside its host arm, so a joining client has every one. The
ghost writer's `cp` rows and the class reader's control point set
(`template-class.mjs controlPointTemplates`) take the install's map; the name is
looked up case-blind, as the engine names templates (LOAD-7).

**Agreement.** Every recorded copy matches exactly: the anim tables of the 17
`templates/<level>.json` files and of 269 recordings on this PC (vanilla 1395,
Secret Weapons 1766, Desert Combat 2691, DC Final 2767, EoD 3507 states, index,
name and flags), and every `cpNames` entry of those 17 files and of 304
recordings over vanilla, DC, DC Final, EoD, SW, FH, FHSW and FHSWEurope levels
(`tests/test_sidecar_game_tables.py`; the client tables are
`tests/fixtures/sidecar_anim_tables.json.gz`, the mod control points
`sidecar_cp_names.json`). FH and FHSW tables have no recorded copy: the
recorders stop at 8,192 states.

**Cost and cache.** A first lookup spawns the interpreter: 0.2 s for vanilla,
about 4 s for FHSWEurope's 58,000 states. The answer is kept in
`~/.cache/bfstats-sidecar/<mod>/<level>-<mode>.json` (`SIDECAR_CACHE`) and
checked against the sizes and times of the archives it read; the install is
`BF1942_DIR` (default `~/.wine/drive_c/EA Games/Battlefield 1942`), the
interpreter `SIDECAR_PYTHON`. When the build fails (no install, no ServerInfo,
an unknown mod) the sidecar says so on stderr and falls back to the recorded
tables in `templates/<level>.json`, which are otherwise test fixtures; a
`--names` file's own tables still win.

## 25. Template ids: how a tid is assigned, and computing it from the install (2026-10-17)

CreateObject (0x07) and CreateMultipleObjects (0x05) name a template by a u32
id. The sidecar used to name ids from `templates/<level>.json`, tables lifted
from the lab server's recorder: no use on someone else's server. It now builds
the table the way both retail processes do (`bf42/template_table.py`, run by
`sidecar/template-table.mjs` through `sidecar_tid_table.py`; ledger
LOAD-12..LOAD-18).

**What an id is.** `ObjectTemplateManager::createTemplate(classId, name)`
(lnxded `0x081d5a30`, BF1942.exe `0x0056db00`, the same code) gives a new
template the manager's counter (`+0x20`) and increments it. A name that already
exists (looked up case-blind) takes no id, and neither does a class the class
manager cannot make. The client turns a received id back into a template
through the id map the same function fills: its event switch (`0x004933d0`)
hands event 7 to `0x004930d0`, which calls the manager's `getTemplate(id)`
(`0x0056d9c0`) and logs "Template id N not found" on a miss. So the id is the
place of the template's name in the order the process first created names.

**Why it is the same on every server.** The counter is zeroed in the
constructor and nowhere else; `deleteAll`, which `Game::load` calls at the top
of each level, keeps it. It restarts because the process does: at the end of a
level's last round the dedicated server sends GameStatus 5 with the next level
and re-executes itself (`GameServer::gameStatusEndGame` `0x08152ca0` ->
`Setup::restartBf1942exe` `0x080c7290` -> `execl`), and the client, on that
GameStatus 5, relaunches itself with `+restart 1 ... +joinServer`
(`0x0048ff90` -> `0x006b4130` -> `0x00454dd0`, `CreateProcessA`). A level's
table is therefore a function of the install, the mod, the level and the game
type, whatever the server played before. The client recordings made on
MoonGamers (a public server mid-rotation) carry the same ids as a freshly
started lab server.

**The order.**

| ids | what creates them |
|---|---|
| 0 | `ObjectManagerCamera`, class `Camera`, made by code (`ObjectManager::getCamera` `0x0819e2f0`) before any level |
| 1 .. | the level's `Init.con` and everything it runs (Wake: `BlueFlag` 1, `RedFlag` 2, `TSun`, `terrainObject`, its sound objects) |
| .. | every `.con` under `objects/` in the mod chain, one per path (nearest mod wins), run in `strcasecmp` path order; `/ai/` paths only in co-op (LOAD-5, LOAD-8) |
| .. last | the level's root `<mode>.con` with `v_arg1 = host`: spawners, soldier spawn templates, control points (Wake co-op `The_Airfield` .. `ALLIES_north_village` are 3601..3605) |

A joining client runs the mode script with another `v_arg1`; the templates it
declares are the same, in the same order, for every level tested.

**The console rules that decide which `create` lines run** (LOAD-16..LOAD-18):
`rem` lines; `beginRem` nests up to ten deep and one `endRem` closes one level
(Liberation of Caen's paratrooper script hides `SextonSimple` and `SextonWreck`
behind a second `beginRem`, and the recorded ids are 2 lower for it);
`if`/`elseIf`/`else`/`endIf` on `v_arg<N>` and `var` variables; `return`;
`run`/`include` resolved beside the running file unless `console.useRelativePaths
0`, `.con` added to a name with no dot; `echo X -> v_y` and `game.gamePlayMode ->
v_y`, which FH's `bf1942/game/is_coop.con` uses to choose co-op or Conquest
versions of hundreds of weapons and vehicles; and a `create` with a third
argument creates nothing (FHSW's `ObjectTemplate.create SimpleObject
SimpleObject KV2RaseiniaSimple`).

**Agreement.** Every recorded tid matches (`tests/test_template_table.py`):
the 19 vanilla tables in `templates/` in the game type their runs used, and
`tests/fixtures/sidecar_tid_tables.json`, 19 tables and 1,039 ids from 11 lab
server rounds of Desert Combat, FHSW and FHSWEurope and 12 BF1942.exe client
recording files, most on public vanilla and Secret Weapons servers (Kursk,
Bocage, Stalingrad, Kharkov, Midway, Iwo Jima, Raid on Agheila). Where a lab
server round and a client recording cover the same level (DC El Alamein, FHSW
Arnhem), the two agree id for id. Spot checks: a Sherman is 2916 on Wake and 2914 on El
Alamein, because Wake's `Init.con` declares two flags and El Alamein's none.

**Use.** `names.mjs namesForLevel(level, { mod, mode })` asks
`template-table.mjs` first, with the ServerInfo's mod and the SetLevel's level
and mode file; `sidecar.mjs`, `body-decoder.mjs` and `rebuild.mjs` pass them. A
new level replaces the whole table. A first lookup costs about 0.2 s for a
vanilla level and 2 s for FHSWEurope; the answer is cached in
`~/.cache/bfstats-sidecar/<mod>/<level>-<mode>.tids.json` against the sizes
and times of the archives read (`SIDECAR_CACHE`, `BF1942_DIR`,
`SIDECAR_PYTHON` as section 24). When it cannot be computed (no install, no
ServerInfo, a level the install lacks) the sidecar logs `[names] FALLBACK` on
stderr and names objects from `templates/<level>.json` as before.

Not settled here: what the client's CheckSum event (0x19) is checked against.
In lnxded's `handleGameEventManagerEvent` (`0x08135cb0`) the jump table
(`0x086c035c`) sends type 0x19 to the switch's default arm (`0x08136020`, the
same target as its out-of-range `ja`), so that switch does not handle it;
section 5's "0x19 CheckSum -> content check" names a path not traced.

## 26. Template classes and ghost body layouts from the install (2026-10-17)

Section 25 names each tid from the level load the sidecar replays. Everything
else a ghost body's reader needs came from our own lab or exports until now:
the class of an object (`classes.json`, a Wake capture's net ids and tids),
a hull's hit points and mobility (`hulls.json`, built from our exported
vanilla models), its child networkables and their widths
(`ghost/derived-specs.json`, from an extracted vanilla Objects tree, and six
hand-fitted specs in `children.mjs`), its gunner seats and turning parts
(hand tables, part names from a bf42plus Wake recording), the control points
(our baked `scene.json`) and a soldier's hit points and aim limits (vanilla
constants). All of it now comes from the same replayed load, per mod and
level, as a retail client's own load gives it.

**The class of a tid.** The create line's class word names the first class
the class manager registered whose name it starts, case blind, in class-id
order (`getClassIDFromTemplateClassName` `0x081d63e0`; ledger LOAD-19). So
`SpriteParticle`, `TimerObjective` and `Simple` are classes, and a word that
starts none (FHSW's `SimepleObject`) makes nothing and takes no id.
`bf42/template_table.py` now returns each id's class (`TEMPLATE_CLASSES`, the
42 names); `template-class.mjs` maps it to its networkable class through each
object class's `initNetworkableComp` (NET-8). Every one of the 1,733 objects
of 40 recorded rounds gets a class; the Wake class map agrees 24 of 24 tids
and 52 of 52 net ids.

**The layouts.** `sidecar_tid_table.py --graph` also prints the part of the
load's template graph a body depends on (`object_graph`: every template
reachable from a PlayerControlObject, a BFSoldier or an armoured template,
with its class, `networkableInfo`, the properties below, its `addTemplate`
children and their `setPosition`/`setRotation`, and the NetworkableInfos with
their `setIsUnique` / `setForceNetworkableId`), with the engine's own line
rules: a redeclared name's lines configure nothing (LOAD-1), `active` reopens,
`set<property>` is the property (CON-15). `ghost/derive-children.mjs
deriveLevel` turns it into:

| | from | rule |
|---|---|---|
| a hull's spec: children, nodes, gears, magazines, rounds of fire, guns, muzzles, `O` widths, seats, joints | the hull's tree | NET-9 (`_analyseObject`, grouping, the widths) |
| a hull's `maxHp` | `hitPoints`, `maxHitPoints` | HP-17: `max(min(maxHitPoints, 128), hitPoints)`, each ceil'd, 10 unset |
| a hull's `mobile` | `hasMobilePhysics` | PHY-17: clear is a StaticPhysicsNode, no controller vectors |
| a hull's part pivots | `setPosition` down the `addTemplate` chain | the first placement, depth first (as the exported glbs' node chain) |
| a soldier's `maxHp`, `aimTwist`, `aimPitch` | `hitPoints`, `maxHitPoints`, `setTurnLeftRightAngle`, `setPointUpDownAngle` | HP-17; `max(|a|, |b|)` of each pair (section 13) |

`template-table.mjs` runs it once per mod, level and game type and caches the
result with the tid table (`<level>-<mode>.tids.json`), keyed on the archives
read and on a hash of the code that computes it. `BodyDecoder.setLevel` hands
the level's layouts to `children.mjs` (`useLevelTemplates`), which serves
`specFor`, `hullFor`, `seatSpecFor`, `jointPartsFor`, `gunFor`, `fireLagFor`
and `soldierFor` to the decoders, the control-state reader and the ghost
writer. A first build costs 0.3 s on a vanilla level and about 10 s on an
FHSWEurope one (86,000 templates, 10,000 hulls).

**Agreement** (`tests/test_sidecar_derived_children.py`,
`tests/test_sidecar_template_objects.py`):

- vanilla, against what it replaces: the six hand specs and six hand gunner
  seats, field for field; the 54 specs of `derived-specs.json` and the 58
  hulls of `hulls.json` that vanilla levels load (hit points, mobility, part
  pivots) on all 19 recorded vanilla levels in both game types, with no
  difference but one: the M3A1 .50 holder's rest yaw, -180 in the
  derivation, 180 in the hand table, now written in (-180, 180]; strict reads
  of the 143 Wake and El Alamein wire bodies and 12 driven-Willy control
  states of `fixtures/sidecar_derived_children.json`; the vanilla soldier
  constants (30 hit points, 20 and 38 degrees); and `rebuild.mjs` over two
  sidecar recordings (El Alamein `ea2`, 55,304 rows, and Wake `h5`, 246,171
  rows) writes the same file as before but for one row: a Defgun round now
  leaves from its gun base's pivot 6.8 m up, where `hulls.json` had no
  pivot for it (vehicle-children.md 6.5, item 2);
- on mods, against real rounds (`fixtures/sidecar_object_corpus.json`: 40
  tables from lab server recordings of Desert Combat, FHSW and FHSWEurope
  and bf42plus client recordings of vanilla, Secret Weapons and FHSWEurope):
  every object (1,733) gets its name and a class; every PlayerControlObject (798)
  a spec of readable children, with a seat spec for each of its 1,106 seats; every hit
  point maximum the lab server recorded (870) equals the computed one; every
  derived turning part (1,101) is one the recording's `jn` rows name, with a
  pivot.

There is no sidecar capture of a mod server yet, so no mod wire body has been
read with these specs; the vanilla bodies above are the strict check.

A level's own declarations win (LOAD-2): Kasserine Pass and Battle of
Britain declare their own Willy, M3A1, Sherman, Tiger, BF109, Spitfire and
Stuka, whose layouts differ from the `objects/` ones (a horn or dummy `F`,
other hit points and guns). The single vanilla table had them wrong.

**What is not derived.** The Daihatsu hull's joint row: its two `R`s are the
bow ramp's leaves, which carry no gun, and the joint rule names only the
`R`s a gun rides (which part the replay turns is the viewer's choice, not an
engine fact). It stays a hand row in `children.mjs`, served only where the
level's Daihatsu has exactly those two `R`s. `soldier-ghost.mjs`'s 1395
states remain the last resort for a body decoded with no animation table
(logged once). Without an install, the computed tables are null and the
recorded and vanilla files serve, each with a FALLBACK line: names from
`templates/<level>.json`, classes guessed from names, layouts from
`derived-specs.json` and `hulls.json`. `classes.json` is a test fixture;
`coverage.mjs`, an analysis of that one Wake capture, still reads it.

## 27. Getting in: the server's door finder (2026-10-17)

On a real server the page's E is only the Use input (`sidecar.mjs` `press(BUTTON.USE)`); the
server decides, as for a retail client. What it decides with:

- `GameServer::toggleEntryPoint` (lnxded `0x0814ee70`): nothing within 1.0 s of the
  player's last enter or exit (`player+0x98`); a soldier firing or in recoil
  (`BFSoldier::isNotFireingOrHaveRecoil`) gets nothing; a human's door comes from
  `BFfindEntryPoint(pos, 3.0, team, useEntryRadius = 1, ...)` from his soldier's origin.
- `BFfindEntryPoint` (`0x0831d770`): the candidates are what
  `ObjectManager::getObjectsFromGrid` (`0x0819dc40`) returns within 3.0 m under the
  0x400 flag predicate. Of those, an EntryPoint (class 0x9477) whose linked PCO is not
  `isOccupied()` (`PlayerControlObject+0x110`, set only by `enter` 0x08316f00 and
  `exit` 0x08317d00) and whose hull's Armor is not destroyed, within its own
  `setEntryRadius` (3-D), nearest wins; a hull whose team is neither the player's nor
  0 is skipped. `GameServer::enterVehicle` (`0x0814e860`) then refuses nothing.
- **What the 3.0 m query returns** (ledger SEAT-31, read 2026-10-17): vehicle ROOTS, not
  doors. `getObjectsFromGrid` asks two culling trees (`ObjectManager+0x10`, a
  `BinTreeCuller`, and `+0x8`, a `QuadTreeCuller`; only objects with
  `hasCollisionPhysics`, flag `0x200`, are in them) for roots whose bounding sphere comes
  within 3.0 m of the point, `|p - root| < 3 + R`, 3-D. A root is filed at its origin with
  `getBoundingRadius()`: the larger of its own mesh's radius and each child's distance
  plus that child's radius, recursively, so the sphere holds every part and door of the
  hull. Each root found then brings every object under it (its current LOD) that carries
  flag `0x400`, which every object has. So an `EntryPoint` is never filed by itself; it
  comes in with its hull.
- **The reach rule** (SEAT-32): E takes the nearest free door strictly inside its own
  `setEntryRadius` of the soldier's origin (distance cut to centimetres), of a hull whose
  sphere is within 3 m of that origin. The hull's sphere always holds the door, so the
  3 m query never refuses a door within 3 m of him; it refuses only a door wider than
  3 m (a tank's 3.5 to 4.1, a plane's 5 to 9) reached from its hull's far side, past
  `3 + R` from the hull's origin. Every hull with doors in vanilla, XPack1 and XPack2 has
  `hasCollisionPhysics`, so the `0x200` filing never bites there.
- **Observed, Wake (quiet Conquest round, nobody had used the hull), and what the rule says
  of it:** an M3A1 seated the page at once from 1.8 m off its centre (the driver's door,
  `0/0.13/0`, radius 3.5), and never from 0.66 m off its rear passenger door
  (`M3A1Entry3`, `0/0/-2.6` under each passenger PCO, radius 2.6), six presses, though the
  page put that door exactly where the server's hull pose says it is (1019.67, 858.17). A
  node client seated in an M3A1 from 3.5 m off its centre on another side (Bulge). By the
  rule the rear spot should seat: the page's origin there is 3.50 m from the hull's
  origin and the hull's sphere is at least 3.31 m (the Browning's doors; 3.04 for the
  front wheels), so the hull is in the query, and the rear door is 1.44 m off his origin,
  inside its 2.6; `VTApc` keeps the passenger's seat (SEAT-30). **The six refusals are not
  the finder's**: what the server had for his soldier when he pressed, or whether the
  presses reached it, is the open question (recipe below). The centre door and the node
  client's 3.5 m fit the rule.
- **The page's prompt** (`vehicle-entry.js` `nearestEntry`, 2026-10-17) now runs the
  server's finder itself: `spawn-seat.js` `findEntryPoint(doors, 3.0, { useEntryRadius })`
  with the hull's sphere (`entry-points.js` `boundingRadius`), in a room and offline alike;
  `spawnSeat` takes the same gate. Before, it offered any free door within its radius,
  which differs only for a door wider than 3 m from its hull's far side, and by the
  centimetre cut. It does not explain the M3A1: the page offered that door, and the server's
  finder takes it from there too (`tests/test_vehicle_entry_reach.py`).
- **Live recipe for the M3A1 refusal** (not yet run): on the no-bot Wake scenario
  (`lab/scenarios/sidecar-wake-cq-nobots.json`), walk the page to the rear of a parked
  M3A1, about 0.7 m behind the rear door, stand still 2 s, then press E once a second for
  six seconds. Record each press's tick, the page's origin, the soldier's ghost position
  the server sends back for the page's own soldier (the server's idea of him), the M3A1's
  hull pose, and whether a seat event (section 17) follows. Then: (1) if the ghost
  position is more than 2.6 m from the rear door (or more than 3 + 3.3 m from the hull's
  origin), the server had his soldier elsewhere: a movement or collision gap, not the
  finder; (2) if it is at the door and no seat follows, check that the Use bit is in the
  input frames the server acked for those ticks (section 20) and that no fire or recoil
  state was set (`isNotFireingOrHaveRecoil`); (3) as a control, have the retail client
  (bf42plus recorder on) stand at the same spot and press Use: if retail seats there, the
  gap is the page's; if retail also cannot, the finder reading is wrong and SEAT-32 needs a
  second reader. Repeat from 3.4 m off the hull's centre on its flank (inside the centre
  door's 3.5) to confirm the far-side cases agree.

## 28. The first mod round through the sidecar: Desert Combat (2026-10-17)

`lab/scenarios/sidecar-dc-elalamein.json` (DC El Alamein co-op, 8 slots, 2 bots). The
sidecar joined and named all 73 objects (M1A1, T72, BMP2, M2A3, Humvee, DPV, AH64,
F-15C, A10_C, SA-3, ...) from tables computed from the install for the mod the server
announced; nothing recorded was used. The page (`map.html?mod=desertcombat&map=el_alamein`)
deployed at British_Base, boarded a Desert Patrol Vehicle on the first E (1.8 m off its
centre) and drove it to 22.5 m/s, 0.25 m median from the server (0.74 max; the DPV is the
car the DC lock suite already flags). On foot it corrected 14 cm median against ~1 cm on
every vanilla level: the samples show page and server both crawling at ~0.25 m/s against
something near the base, the page 0.6-1.2 m further in, so it is collision with a static,
the same family as Bocage's hedgerows and Tobruk's wall (sections 22, 27), not the soldier's
speed tables, which DC leaves as vanilla's (its `CommonSoldierData.inc` differs only in
death time, explosion force and repair).

## 29. Surviving a level change: the reconnect password and slots (2026-10-17)

A dedicated server does not load the next level in place. At the end of a level's last
round it restarts its own process, and a retail client restarts itself to follow it. What
carries the players across is a four-digit **reconnect password** and one **reconnect
slot** per previous player, held for 180 s. Read from both binaries; ledger RECON-1 to
RECON-8. The sidecar does the same in place (`sidecar/rejoin.mjs`) and keeps its page
socket and recording.

**The server, before the restart (lnxded):**

1. `GameServer::gameStatusFirstEndGame` (`0x08152a60`) runs when the round ends. When it
   is the level's last round (rounds left `GameServer+0x2f4` is 0 or 1), or an admin
   restart set `GameServer+0x467`, it does the following:
   - rolls four digits (`rand() % 10 + '0'`, four times) and stores them with
     `Game::setReconnectPassword` (vslot `0x11c`, the string at `Game+0xe4`);
   - sets `numReconnectSlots` (`GameServer+0x4cc`) to the number of client connections
     (`GameServer+0x104`);
   - sends every client **GameStatus 5** (`sendGameEventToAll`, vslot `0x210`), then
     GameStatus 2.

   The `GameStatusEvent` constructor (`0x0815b490`) writes the five raw bytes as the
   password's first four characters plus a NUL. The text is the **next level's mod** (up
   to 31 characters): `Setup::nextLevelInMaplist` (`0x080bff80`) returns a maplist entry
   `{map, mode, mod}`, and the server passes its `+8`. The map name is not sent.
2. After the end-of-round delay, `gameStatusEndGame` (`0x08152ca0`) sends the same
   GameStatus 5 again, then closes every connection with **reason 0x19**
   (`closeClientConnection`). `Setup::restartBf1942exe` (`0x080c7290`) then `execl`s the
   server with `+hostServer 1 +reconnectPassword NNNN +reconnectSlots N`. The second
   GameStatus 5 is queued just before the disconnect, so expect only the first to
   arrive.
3. The new process parses both options (`Setup::start` `SimpleParser` ids 0x15 and
   0x16). `GameServer::startServer` (`0x08133330`) passes them to
   `NetServer::setReconnectPassword` (`0x08434890`), which:
   - stores the password (at most 4 characters) at `NetServer+0x90`;
   - stores the slot count at `+0xd8`;
   - sets **`+0x104 = 180000` ms**.

   `_updateConnections` (`0x08433af0`) subtracts the elapsed time from the window each
   pass, and zeroes the slots once it goes negative.

**The server, admitting a rejoin.** `NetServer::handleConnectRequest` (`0x08436810`),
with no reserved slots:

1. A wrong server password gets ConnectDenied 0x11, and a version mismatch 0x17 or 0x18.
2. While slots remain, it copies the request's **bytes [80..83]**.
   `checkReconnectPassword` (`0x08436750`) compares them, four bytes, with the stored
   password; an empty stored password matches anything.
   - **On a match** the request takes a slot (`+0xd8 -= 1`) and is admitted if
     connections < max.
   - **Otherwise** it is refused **ServerIsFull (2)** as soon as connections + slots
     left (+ reserved left) reach max.

   So for 180 s a full server keeps a place for each previous player who brings the
   digits, and refuses everyone else.
3. With no slots left it applies the plain full check.

Nothing about the player is kept: the server is a new process and its command line has
only the two options. Score, team and kit start fresh, and the player's team comes from
its CreatePlayer request as on any join.

**The retail client (BF1942.exe):**

- **On GameStatus 5.** The event switch `0x004933d0`, case 0x24, sets the wait flag
  `+0x248` and stores the four digits with `Game::setReconnectPassword` (vslot `0x11c`).
  It stores the mod with `0x004444c0` (Setup `+0x2ac`).
- **On the disconnect.** The receive loop `0x004957d0` sets the same flag on reason 0x19
  and does not show the "disconnected" box. Reasons 0xa (timeout), 0xd, 0x13-0x16, 0x1a
  and 0x1b only end the session.
- **Waiting for the server.** While the flag is up and the connection is gone, the
  per-frame `0x00495d00` calls `0x0048ff90`. It initialises the poller `0x004b6fc0`
  with the server address and **180.0 s**, and polls it with `0x004b7030`. The poller
  sends an 8-byte **ServerInfoRequest** (type 9, nothing else set): first after **16 s**
  (`+0xc = 16.0`), then every **3 s** (ctor `0x004b6f60`, `+8 = 3.0`). It reports the
  server up on any type-0xa reply of at least 7 bytes. When the 180 s run out it gives
  up with an error.
- **Relaunching.** On an answer, `0x0048ff90` checks that `mods/<mod>` exists, then
  `0x006b4130` builds
  `+joinServer <addr> +isInternet N +reconnectPassword <digits> [+password <pw>]`.
  `0x00454dd0` prefixes `+game <mod> +restart 1`, waits `Sleep(2000)` and
  `CreateProcessA`s a new BF1942.exe.
- **Rejoining.** The new process's join (`0x0044ed70`) calls
  `Game::setReconnectPassword` with the `+reconnectPassword` value (Setup `+0x8c4`).
  The connect `0x0060f7d0` makes three tries, `timeout/3` apart. Its ConnectRequest
  builder `0x0060f300` does `strncpy(+16, password, 0x20)` and
  `strncpy(+80, reconnectPassword, 4)`, and sets byte 0 to 1 (the server dispatches
  types 1 and 9 before it looks at byte 0, so the sidecar's 0 is equally accepted).
- **What carries across.** The client process is new too and asks for team 0 (auto),
  as the captured join showed (section 6). Only the profile name and the digits carry
  across.

`Setup::reconnect(std::string)` in lnxded (`0x080c5780`) is a stub that returns 0.

**Other disconnect reasons** (the u32 at [8] of a Disconnect datagram):

| reason | sender | meaning |
|---|---|---|
| 0x0a | — | timeout |
| 0x0d | `handleGameEventManagerEvent` | the client left |
| 0x15 | `kickPlayers` (`0x08148b20`) | kicked |
| 0x16 | `kickPlayers`, when `isKeyBanned` (vslot `0x380`) | banned |
| 0x19 | `gameStatusEndGame` | level change |

ConnectDenied 0x16 is the banned-address list in `handleConnectRequest`.

**The sidecar (`sidecar/rejoin.mjs`):**

- **Detection.** `session.mjs` reads GameStatus 5 into `levelChange {password, mod}`
  and emits `level-change`. A Disconnect with 0x19, or any drop after a GameStatus 5,
  is a level change (`classifyDisconnect`). The session also reports a server that is
  quiet for 20 s while connected as a 0x0a drop, so a lost Disconnect datagram is
  noticed.
- **Waiting.** The `Rejoiner` probes with the retail ServerInfoRequest
  (`netconn.mjs probeServerInfo`) on the client's own schedule. Since 2026-10-17 that is
  bf42++'s: 1 s, then every 2 s, or a 16 s first probe on a server that sent `UI&nfr`.
  With `--retail` it is retail's 16 s, then every 3 s (section 30.5). A big mod level
  can take minutes before the new server answers, so it keeps going up to
  `--rejoin-horizon` (default 600 s) rather than retail's 180 s. A refused or silent
  attempt backs off ×1.5, capped at 15 s, which keeps it inside the server's 180 s
  slot window once the server is up.
- **Joining.** On an answer it opens a new Session. That session carries the digits at
  [80..83] (`buildConnectRequest`) and asks for the side the player was on, which the
  server honours unless auto-balance overrides it. This is the one deliberate departure
  from retail, which asks for auto.
- **Failures.** ServerIsFull, 0x1e, no ConnectAccept within 10 s, or a join that stalls
  for 90 s all go back to probing, with the backoff.
- **Giving up.** A kick or ban (on the drop or during the join), a wrong server password
  (0x11), a banned address (0x16), a version mismatch, or the horizon.
- **Plain drops.** A drop with no GameStatus 5 (a timeout, a server crash) rejoins the
  same way without a key.
- **Afterwards.** The kit is not kept: the page is back at its deploy screen after the
  new world dump's SetLevel. The page socket, the recording and the input path carry
  over as before (section 20).

Tests: `tests/test_sidecar_rejoin.py` checks:

- the ConnectRequest bytes, with and without the key;
- GameStatus 5 built per `serialize` and decoded by a Session, with the stream staying
  framed after it;
- the classification;
- the state machine against a fake session on a fake clock: a slow server, a full one, a
  wrong password, a kick, the horizon, a silent attempt, a ban mid-join, a plain drop;
- the probe against a real socket.

**Not yet seen live.** The slots count network connections, not players. The full
check compares `NetServer`'s connection map with `setMaxNumberOfConnections`
(`0x084348f0`), which is fed `Game::getMaxNrOfPlayers`. So bots never fill it, and the
test needs human clients up to `serverMaxPlayers`.

The scenario is `lab/scenarios/sidecar-levelchange.json`: Wake CQ, then El Alamein CQ,
two slots, two-minute rounds, no bots.

1. Start the scenario.
2. Join the sidecar (`--team 2`) and a filler `join.mjs`, so both slots are taken.
3. When the round ends, watch the sidecar log. Expect, in order:
   - `level over ... reconnect password NNNN`;
   - `server disconnected us: LevelChange (level-change)`;
   - probes until the new process answers;
   - `rejoining (attempt 1, reconnect password NNNN, team 2)`;
   - `back on ... through a reconnect slot`.
4. Check the restarted server's command line (`ps -o args`). It should carry
   `+reconnectPassword NNNN +reconnectSlots 2` with the same digits. The round's event
   log should show `rejoinA` created on El Alamein, on team 2.
5. Control: start a keyless `join.mjs` after the drop. It should be denied
   `PRServerIsFull` while the slots are held, then admitted after the 180 s window, since
   it then needs only connections < 2.

## 30. BF42++: what the community client adds to the wire (2026-10-17)

BF42++ (bf42plus) is the community client most BF1942 servers now expect, so
the sidecar joins as one. Its source is on this PC at
`~/projects/skandia/bf42plus` (origin `sila-skandia/bf42plus`, upstream
`Casqade/bf42plusplus`, the work of uuuzbf). Line numbers below are that
checkout at `2c811e0`. Client addresses are BF1942.exe, read with
`objdump` on this PC's copy, and server addresses are `bf1942_lnxded.static`.

These are bf42++ facts, not engine facts, so they are kept here and not in the
ledger, which has no client-mod section. **bf42plus has no server-side
component.** Its README mentions a private server mod by its author, and only
a server running something like it sends the three new events or SpecialGame
action 2. Any server can send the welcome-line settings, a vanilla lnxded
included.

### 30.1 The inventory

Everything bf42plus changes that a server can see or drive, from the git log
(217 commits) and the source:

| # | Addition | Direction | Source | Sidecar | Page |
|---|---|---|---|---|---|
| 1 | Marker in ConnectAcceptAck | client → server | `bfhook.cpp:338-366`, `util.cpp:195` (crc8), `version.h` (7d57ff2) | sent by default (`--retail` sends the retail ack) | — |
| 2 | HUDTextEvent 0x01 | server → client | `gameevent.cpp:241-277, 329-335` (78c011f, f924835) | decoded, recorded `hudText` | line to the console |
| 3 | CreateStaticObjectEvent 0x1c | server → client | `gameevent.cpp:158-191, 288-307`, `object.cpp:102-131` (279644f) | decoded, recorded `createStatic` | placed, solid (`server-statics.js`) |
| 4 | UpdateStaticObjectEvent 0x1d | server → client | `gameevent.cpp:192-224, 314-322` (279644f) | decoded, recorded `updateStatic` | moved, turned, deleted |
| 5 | SpecialGameEvent action 2 before SetLevel | server → client | `gameevent.cpp:225-236`, `bfhook.cpp:652-663` (279644f) | `setLevel` row carries `statics: 0` | StaticObjects.con statics taken out |
| 6 | Server settings in the welcome lines | server → client | `settings.cpp:270-395`, `settings.h:273-311`, `gameevent.cpp:153-157` (4eb8034 onwards) | parsed as the client parses them, recorded `plusSettings` | — (see 30.5) |
| 7 | Faster map-change pinger, `UI&nfr` turns it off | client → server timing | `bfhook.cpp:114-148` (ac3a19b, e448bcf, 7f41df3) | adopted in `rejoin.mjs` | — |
| 8 | A GameEvent id with no maker fails the block instead of crashing | client robustness | `gameevent.cpp:384` (`0x004b403f` `74 09` → `74 0b`) | already so: an unknown id ends the block | — |
| 9 | MapEvent accepted whatever its `add` bool says | client robustness | `bfhook.cpp:193-197` (nop at `0x00494dfa`) | already so: every Map event is recorded | — |
| 10 | A CreateObjectEvent of a non-network template disconnects with "DATA CORRUPT" (7) | client robustness | `bfhook.cpp:596-650` (`0x004931c5`, `0x00493271`, `0x004932d2`) | not adopted (the sidecar keeps the session) | — |
| 11 | Three PlayerActions dropped after the local player's death | client → server input | `bfhook.cpp:394-417`, `gameevent.cpp:114-123` (`smootherGameplay`, on by default) | not adopted, see 30.6 | — |
| 12 | In an aircraft, a held free-look is sent with the MouseLook bit and MouseLookX/Y cleared | client → server input | `bf/input.cpp:395-415` (`dontBlockInputDuringFreeLook`, on by default) | not adopted, see 30.6 | — |
| 13 | The restart pinger sends from the game connection's own UDP socket | client → server | `bfhook.cpp:137-147` (hook at `0x00490f4c`) | not adopted: a fresh socket per probe | — |
| 14 | Mod switch from the server list's `gameId` before connecting | client ↔ master/GameSpy query | `bfhook.cpp:168-191` | n/a: the sidecar reads the mod from ServerInfo 0x1a | — |
| 15 | The "spawned" ScoreMsg in the database dump ignored for a player whose vehicle is `MultiPlayerFreeCamera` | client reading | `gameevent.cpp:100-112` (35049ac) | n/a: neither side reads a "spawned" score as alive | — |

These are client-only and never touch the wire: the master server address
(`master.bf1942.org`), the version string in the menu, the scoreboard columns,
resolution fixes, nametag lowering, buddy colours, IDs in chat and kill lines,
"connecting" lines, vote lines in the console, the ignore list, the hit
indicator time, screenshots, the replay recorder, the FPU precision, busy
waiting, archive and zip loading, the crash handlers, and the rendering fixes.

### 30.2 The ConnectAcceptAck marker (item 1)

The retail builder (`0x0060f390`) sends an **uninitialised 8-byte stack
buffer**. Byte 0 is the connection id, and the u16 at [1] is masked
`& 0x0fff | 0x4000`, so byte 1 and the low nibble of byte 2 are stack garbage
and bytes 3..7 are whatever was there. A server reads only the id and the type
nibble. bf42++ fills the buffer before the retail code runs (hook at
`0x0060f393`):

| byte | value |
|---|---|
| 0 | the connection id (retail code) |
| 1 | `'+'` (0x2b) |
| 2 | `0x40 \| min(build, 15)` (the type nibble 4 kept) |
| 3, 4, 5 | major, minor, patch |
| 6 | `PLUS_PROTOCOL_VERSION`: 1 at the marker's introduction, **2** since HUDTextEvent (f924835) |
| 7 | crc8 of bytes 1..6: init 0xff, polynomial 0x97, MSB first, no final xor |

The version comes from `build_version_full` (`version.h`, `"2.0.0-0-0"` on
this PC's build, so 2, 0, 0, build 0). A server that sees the marker knows it
may send bf42++'s events, which a retail client cannot read. The sidecar sends
`052b40020000027a` for connection 5. `--plus-version a.b.c.d` changes the
version, and `--retail` sends `0500400000000000`.

### 30.3 The three events (items 2-4) and SpecialGame 2 (item 5)

Each event is the usual 7-bit type in the event block, followed by its body.
bf42plus implements only `deSerialize` (its `serialize` returns false), so the
layouts below are its readers'. `vec3` is `readFullVector`, three raw float32
(`0x00583180`, three `readBits(…, 32)`).

- **HUDTextEvent 0x01** (`gameevent.cpp:329`): u3 kind, u7 length, then
  `length` bytes of ISO-8859-1 with no NUL.
  - Kind 0 sets the spawn message at top centre and forces it on screen.
  - Kind 1 sets the status message.
  - Kind 2 sets the centre kill message.
  - Kind 3 shows the yellow centre message and forces it on screen.

  Length 0 clears kinds 0, 1 and 3. 0x01 is free in the retail table (lnxded
  `GameEvent::initEvents` starts at 0x02).
- **CreateStaticObjectEvent 0x1c** (`gameevent.cpp:288`): u32 template id (the
  level's own numbering, section 25), u16 object id (the server's own
  namespace, not a networkable id), bool, and when set vec3 position then vec3
  rotation (yaw, pitch, roll degrees). Then a bool, and when set vec3 scale.
  - The handler (`:158`) looks the template up and **ignores an unknown one**.
  - It creates the object, sets the position first and then the rotation
    through `setRotation` on the transform, sets flag `0x40000`, and runs
    `init`.
  - It files the object under the id (`addStaticObject`, `object.cpp:102`). An
    id already in use **destroys the object it held**.
  - The scale is read and never applied.
- **UpdateStaticObjectEvent 0x1d** (`gameevent.cpp:314`): u16 id, u2 action
  (0 move, 1 rotate, 2 scale, 3 delete), then vec3 unless the action is
  delete.
  - Move sets the absolute position.
  - Rotate rewrites the rotation and keeps the position.
  - Scale does nothing.
  - Delete destroys the object.
  - An unknown id is logged and ignored.
- **SpecialGameEvent action 2** (`gameevent.cpp:225`). SpecialGame is 0x27
  with a 2-bit action (lnxded `0x0811fe70`). lnxded only ever sends action 0,
  the ammo refill (`GameServer::triggerSpecialGameEvent` `0x081591a0`; its
  type 1 never reaches the wire).
  - Arriving before the connection's first SetLevel, action 2 sets
    `g_skipLoadingStaticObjects`, and the event is swallowed.
  - `Game::load` then jumps from `0x00411170` to `0x004112bd`, past the block
    that builds `<level>/StaticObjects.con` (string at `0x008c55f4`) and runs
    it. The mode scripts' statics (`AdditionalStaticObjects` and the like) and
    every other level file still load.
  - After the SetLevel, action 2 passes on to the game's own handler.

The client creates these events itself, so nothing about them is replicated.
They are not ghosts and have no network id. The server presumably simulates
its own copies, which is why they matter: they are solid on both sides.

Both clients fail the rest of a block on an id with no maker (item 8). The
retail client crashes outright: `0x004b403f` `je 0x4b404a` falls into a
stale `edi`. bf42++ jumps to the block's failure path at `0x004b417c`. A
server should therefore send these only to a client that showed the marker.

### 30.4 The server settings (item 6)

**Transport.** These are the ordinary welcome lines. lnxded's
`GameServer::authentificationOk` sends, in this order:

1. the SetLevel (`sendLevelPath`);
2. the map list;
3. the database;
4. one `WelcomeMsgEvent(i, line)` for each `i < Setup+0x318` (`0x08139ae0`).

A server sets them with `game.setServerWelcomeMessage <i> "<text>"`.
`Setup::setServerWelcomeMessage` (`0x080c7b00`) accepts only the next index
(`i == count`), takes at most 10 lines, and replaces every `_` with a space.
The event's constructor (`0x0811f8c0`) cuts a line to **63 characters** plus
a NUL. Every player sees every line, setting text included.

**Parsing.** bf42++ parses each line on its own as it arrives
(`gameevent.cpp:153` → `ServerSettings::parseFromText`, `settings.cpp:306`):

1. It finds `%`, then the next `~`. With no `~`, it stops.
2. The name is the leading run of `[A-Z0-9]`. If any other character but `&`
   follows the name, **the whole line's parse stops**.
3. A name of 2 to 4 characters is processed. Any other length is skipped.
4. The parameters are `&key` or `&key=value`. The key ends at the first `=`,
   `&` or `~`, and the value runs to the next `&`.

A setting therefore has to fit inside one line. Settings are never reset:
they stay for the life of the process, which a level change restarts.

| setting | keys | meaning |
|---|---|---|
| `3DM` | `D` distance, `C` colour, `T` text | allow the friendly-mine 3D markers |
| `3DS` | `D` | allow the supply-point markers; **`D` writes the mine map's distance** (`settings.cpp:347`, a slip kept by the port) |
| `3DCP` | `D` | allow the control-point markers; the same slip (`:353`) |
| `3DO` | `t` template (unknown: the setting is dropped), `T` text, `D`, `C`, `A` (all teams), `sD` (show distance) | a custom marker per template; the first entry for a template wins |
| `UI` | `hssdeath`, `hssjoin`, `nfr`, `sbw`, `hen` | no spawn screen on death / on join, **no faster restart**, skip the briefing, no enemy nametags |

Colours are `#rgb`, `#rrggbb` or one of 148 web colour names (`util.cpp:108,
143`). A bad colour reads as `0xffffffff`. Numbers go through `strtol`, and a
key with no `=` hands it a null pointer, which the port takes as 0.

### 30.5 What the sidecar and the page do with it

**Sidecar** (`sidecar/plus.mjs`, `events.mjs`, `session.mjs`, `netconn.mjs`,
`record.mjs`, `rejoin.mjs`, `sidecar.mjs`):

- **Marker.** Sent in the ConnectAcceptAck by default.
- **Events.** All three are in the event table, with readers and writers.
- **SpecialGame 2.** A Session keeps bf42++'s per-process state: the settings,
  whether a SpecialGame 2 came before the SetLevel, and whether the SetLevel
  has been seen. When the switch is on, the `setLevel` row gets `statics: 0`.
- **Settings.** `parseServerSettings` is a line-for-line port of the parser,
  slips included. A welcome line that carried a setting writes a
  `plusSettings` row.
- **Restart timing** (item 7). bf42++ patches the pinger at start-up when its
  `fasterMapchange` option is on (the default):
  - `0x004b6ffd` writes 1.0 s for the first probe, where retail writes 16.0;
  - `0x004b6f6c` makes the interval 2.0 s, where retail has 3.0.

  `UI&nfr` puts back **only the 16 s first delay**. The 2 s interval is
  patched unconditionally (`bfhook.cpp:124-135`), so a bf42++ client on an
  `nfr` server probes at 16, 18, 20 s and so on. `Session.restartTiming()`
  answers as follows, and the `Rejoiner` probes evenly on it:

  | identity and server | first probe | then every |
  |---|---|---|
  | bf42++, the server allows the faster restart | 1 s | 2 s |
  | bf42++, the server sent `UI&nfr` | 16 s | 2 s |
  | `--retail` | 16 s | 3 s |

  The Rejoiner used to back its probes off; now only a refused or silent
  attempt backs off, from the interval up to 15 s. The 600 s horizon is
  unchanged.

**Page** (`viewer/server-statics.js`, `net-sidecar.js`, `net-room.js`,
`level-load.js`):

- **The set.** `net-sidecar.js` keeps the server's statics for the level being
  played, by id, with a version (`st.statics`), plus the switch from the
  `setLevel` row. Each frame, `net-room.js` has `server-statics.js` reconcile
  the page's copies against that set.
- **A server static.**
  - Static templates have no model glbs of their own, so it is a **clone of
    the level's own placement of the same template**. That includes a pruned
    StaticObjects.con one, which is what a server that replaces the file
    sends back. Failing that, it is the model tree's glb.
  - It is placed with `refractorPoint` / `refractorYpr` (the bake's Z mirror
    and Y·X·Z order). Its hulls join the collision index through
    `addOwner`, a move reports its pose through `setMovedOwner`, and a delete
    switches the owner off.
  - A template it cannot find is logged once and skipped, as the client
    skips an unknown one.
- **The StaticObjects.con switch.** The bake writes the environment roots,
  then exactly `scene.json` `objects.placed` roots for StaticObjects.con in
  file order, then the mode statics, `spawners`, the cloths and
  `controlPoints` (`extract_map.py` build_scene). Verified on wake (744),
  el_alamein (897), berlin (325), midway (232), stalingrad (648) and
  battle_of_the_bulge (1518).
  - `markStaticObjectsCon` stamps those roots at load, before `pruneToMode`.
  - When the switch is on, the stamped roots are detached and their
    collision owners switched off, at load or at the frame the row arrives.
    A later load of the same level without the switch puts them back.
  - A scene that does not read that way is left alone, and the console says
    so.
  - **No re-bake is needed.** A bake-written marker (`extras` on the
    StaticObjects.con roots) would be sturdier, but it is a `scene`-layer
    change and every tree would need re-baking.

  Two things the switch does not reach:
  - Area sounds hung off a pruned static (`scene.json` `sounds.areas`) keep
    playing.
  - The supply depots `soldier-view.js` collected at load keep serving.
- **HUDText.** The line goes to the feed and the console.
- **Settings.** By the owner's scope, nothing is shown: the UI keys and the 3D
  markers are presentation. The page has no live nametags or 3D markers. It
  does have a spawn screen on death and join and a briefing, but these are
  left to the page's own rules.

### 30.6 Not adopted, and why

- **Item 11, the death drop.** It empties the server's ≤ 4-deep action buffer
  (D-2) to cut input delay, and is an optimisation, not protocol. The
  sidecar's input path is `input.mjs`.
- **Item 12, aircraft free-look.** It changes what a pilot's input word says.
  The page builds its own words.
- **Item 13, the probe socket.** A probe from a fresh socket gets the same
  answer from a server.

### 30.7 Tests

**`tests/test_sidecar_plus.py`** (`sidecar_plus_harness.mjs`):

- It builds each event's bits from bf42plus's readers (not from `events.mjs`)
  and decodes them through `Session._onData`, one block with an Ack after
  every event. All eleven Acks read `0xdeadbeef`.
- Covered: CreateStaticObject with and without its transform and scale, every
  UpdateStaticObject action, HUDText with Latin-1 and empty text.
- SpecialGame 2 before and after the SetLevel.
- An unregistered id (0x1f) still ends the block.
- The writers emit the same bits as the readers.
- The parser against the client's rules: several settings on a line, no `~`,
  a bad character, name lengths, the 3DS/3DCP slip, numbers, colours, 3DO's
  template check and first-wins rule, a NUL, and a setting split over two
  lines.
- The restart timing for each identity, and the marker bytes and crc
  (recomputed in Python).

**`tests/test_sidecar_rejoin.py`** checks the probe schedules: bf42++ at
1, 3, 5 … s, retail at 16, 19, 22 … s, and bf42++ on an nfr server at 16, 18,
20 s.

**`tests/test_server_statics.py`** (`server_statics_harness.mjs`, the
vendored three.js) checks:

- marking, pruning and restoring with collision owners;
- a layout that does not read;
- the reconcile;
- the pose mirror;
- the whole path from sidecar rows through `net-sidecar.js` state to placed,
  moved, turned, remade and deleted clones;
- the bake order of every real level bake present on this machine.

### 30.8 Checking it live

bf42plus ships no server side, so the lab (skill `bf1942-server-lab`) can check
only what a vanilla server can send.

**1. The settings and the restart timing.** Scenario
`lab/scenarios/sidecar-bf42pp-nfr.json` is `sidecar-levelchange` with two
welcome lines in its autoexec:

```
game.setServerWelcomeMessage 0 "bfstats lab %UI&nfr~"
game.setServerWelcomeMessage 1 "%3DM&D=40&C=red~"
```

1. Start the scenario.
2. Join the sidecar and a filler as for section 29.
3. Expect `[sidecar] bf42++ server settings: UI` and then `… UI, 3DM (no
   faster restart)`.
4. At the level change, expect `probing the server after 16 s, then every
   2 s`.
5. Run `sidecar-levelchange.json` again, which has no welcome lines. It should
   say `after 1 s, then every 2 s`.
6. `--retail` against either scenario says `after 16 s, then every 3 s`.

The welcome lines are sent after the SetLevel, so a sidecar that joined once
has the settings long before the level ends.

**2. The marker.** A vanilla server ignores bytes 1..7. A capture of the lab
port (`tcpdump -i lo -X udp port 14568`) shows the sidecar's 8-byte type-4
datagram as `<id> 2b 40 02 00 00 02 7a`, and the join completes as before.

**3. The events and SpecialGame 2.** These need a server that sends them, and
none exists on this PC. Two ways to get one:

- **(a) A bf42++ server mod.** The author's private server mod. Ask in the
  bf42++ community or the project's issues.
- **(b) A lab-only injector.** A UDP shim in front of the lab server that
  rewrites the server's event blocks to append the events to the next block it
  forwards. It must renumber nothing: an event block's count is in its own
  8-bit header, the block index is the server's, and the shim only grows the
  count and the bits. It must also re-send the block if the client's ack says
  it was lost. This is about a day's work. The sidecar's own
  `events.mjs` writers produce the bits.

Without (a) or (b), the harnesses above are the check.

## 31. Against statics: a slow frame's words, the hull's velocity, wheels and borrowed meshes (2026-10-17)

Three live cases where the page and the server came apart at a static object:
Bocage (a Sherman at 11.4 m/s into the Allied AA pit, 0.6-1.5 m apart through
the climb), Tobruk (a Sherman into a supply depot, the page 1.2 m deeper, error
peak 0.77 m) and Desert Combat El Alamein on foot (both crawling at 0.25 m/s,
the page 0.6-1.2 m ahead every ack, 14 cm median correction). Tools in this
session's scratch `staticcol/`: `drivetruth.mjs` (a node client drives a hull
by a word script and logs the server's per-tick state with the word serials,
the engine child decoded), `replay_sim.mjs` (those words through the page's
own headless runner on the real level: open loop, K ticks from each server
state, or `loop`, the live correction emulated through `createHullReconciler`
with an ack `LAT` ticks old every second tick), `hullrun.cjs` (the page live,
a per-frame trace of the driven hull, its corrections and the body world).
Lab scenarios `sidecar-tobruk-coop-nobots.json`, `sidecar-bocage-coop-nobots.json`.

**El Alamein was not a static: a 2.7 fps page starved the server (ledger D-7).**
The headless page drew a frame every 370 ms, ran eleven world ticks in it and
sent eleven words at once. The server keeps four buffered actions a frame and
runs one a tick (D-2, D-3), so about half were trimmed and it ran zero input
on the ticks it lacked: its soldier crawled, and the page, which had run every
word, was pulled back each ack. A node client sending its words in bursts of
eleven: 0.75 m/s and 161 serials for 116 server ticks; the same words one a
tick: 3.16 m/s. `InputSender` now releases one new page word per server tick
(a word leaves at once only when none waits and the last left most of a tick
ago): the bursts walked 3.18 m/s. Committed as `6e02bc6a`.

**Tobruk: the page's hull sometimes met no static at all, and its correction
kept its speed (ledger NET-10).** Of four live runs of the same drive (and the
sweep's), two met the depot exactly where the server did (origin stopped at
x 2510.6, contacts from the first tick, error median 1.3 cm) and two met
nothing: the body world counted no static contact for two seconds while the
hull sat 1.2 to 2.3 m inside the depot at 11.9 to 13.4 m/s, held back only by
the corrections (0.4 and 0.8 m alternately, every ack). The page's acked-tick
correction moved position and rotation and left the drive's speed, so nothing
stopped it; the retail client's `readControlObjectState` takes the velocities
too. The sidecar's `ack` row now carries a driven hull's position, rotation and
velocity at the acked tick (`hp3`, `hq`, `hv`, engine frame), the page's tick
ledger the hull's velocity, and `createHullReconciler` closes the velocity
error at the acked tick with the position. Why the probe found nothing in those
two runs is not found: the depot's owner was neither disabled nor a body in
the runs instrumented after (`__bodyWorldInfo`, `staticcol/hullrun.cjs` traces
the owners near the hull), and neither failure recurred in two instrumented
runs. A page that misses a static now stops with the server within an ack.

**Bocage: the server's Sherman rammed the AA gun's barrel lying at its base,
stood on its nose and tumbled 30 m; the page had the barrel 1 m up and stopped
dead (ledger COL-18).** The AA gun is a geometry-less root that borrows its
cockpit LOD's mesh, which hangs under the cannon; the engine tests that mesh
with the ROOT's transform as well as where it stands. The page now adds the
root's copy at load (`collision-meshes.js` `addLentCollisionCopies`, 131 vanilla
placements: AA guns, Flak38s, radar towers). And the engine's wheels meet
statics as hull parts do (COL-21), now built: the spring's probe, the push as
the wheel's displacement next tick. The tumble itself the page does not follow:
its `TANK.angularDamping` (15 s^-1 on roll and pitch, fitted, the engine has
none) damps it away; at 0 the orientation follows the server's through the
tumble but the M3A1 rolls over in `test_ground.py`'s held turns, so it stays
(features/viewer-ground-hull-collision, "Statics against the server").

Measured, Bocage's ram (`staticcol/boc2.ndjson`, the server's words through the
runner, K=6 from each server state; `loop`: the live correction emulated, the
ack 6 ticks old):

| | before | after |
|---|---|---|
| `loop`, correction error at the acked tick, median / p90 / max | 0.78 / 1.99 / 3.09 m | 0.16 / 0.57 / 2.02 m |
| `loop`, impact and tumble only, median / p90 | 1.20 / 2.66 m | 0.29 / 0.80 m |
| `loop`, ack 3 ticks old, median / p90 | 0.72 / 2.18 m | 0.06 / 0.22 m |
| K=6 prediction, median / p90 | 0.034 / 0.244 m | 0.035 / 0.233 m |

The velocity correction carries almost all of it: the physics changes alone
(the root copy and the wheels) move the `loop` median 0.78 -> 0.76 m and the K=6
numbers by a centimetre. Live, the page on the new code:

| case | before (sweep, 2026-10-17 morning) | after |
|---|---|---|
| Tobruk Sherman, correction error median / max | 6.5 cm / 0.77 m (sweep), 5.1 cm / 0.82 m (`tob1`), both missing the depot | 1.0 cm / 0.34 m (`toblive4`); 1.3-1.7 cm / 0.31-0.46 m when the old code met the depot (`tob2`, `tob3`) |
| Bocage Sherman, median / max | 31.7 cm / 1.48 m (11.4 m/s, a full tumble) | 1.4 cm / 0.58 m (`boclive1`: 8.7 m/s, the hull rose 2.5 m on the gun and came down, the page with it) |

The two Bocage live runs met the gun at different speeds, so they are not the
same event; the emulated loop above is.

Open: why the page's static probe found nothing in two Tobruk runs; the face
layer (COL-22: a Sherman meets a two-layer static's col0, a Willy its col1; the
bake ships col1 only); the server hull's angular velocity (the body's `vecB`,
world axes, engine frame, constant through a free tumble) is not yet taken
with the rest of the acked state; the first two ticks of the Bocage ram (the
server's hull left the bar with 4 m/s up and 3 m/s sideways, the page's with
1 m/s up).

## 32. The level-change rejoin, live (2026-10-17)

A private lab copy on ports +20 (`BF42_LAB=~/.cache/sidecar-lab/lab BF42_LAB_PORT_OFFSET=20`,
lab README "A second lab") ran `lab/scenarios/sidecar-levelchange.json` (Wake then
El Alamein Conquest, two slots) with the sidecar and a filler on. The scenarios needed
`admin.timeLimit 2` in their autoexec: server1's autoexec sets `admin.timeLimit 0` after the
game settings, so `serverGameTime` alone never ended the round (as with the ticket ratio,
section 23).

- **Retail timing off (BF42++ faster restart):** `level over ... reconnect password 1485`,
  `server disconnected us: LevelChange`, the first probe at 1 s answered, `rejoining
  (attempt 1, reconnect password 1485, team 2)`, the El Alamein tables computed from the
  install in 0.65 s, `back on after 10.0 s ... through a reconnect slot`. The restarted
  server ran `+restart 1 +reconnectPassword 1485 +reconnectSlots 2`.
- **The slot holds:** a keyless `join.mjs` straight after was refused `PRServerIsFull`
  (the filler's slot still reserved).
- **`nfr` from the server** (`lab/scenarios/sidecar-bf42pp-nfr.json`, welcome lines
  `%UI&nfr~` and `%3DM&D=40&C=red~`): both settings read on join and again on the new
  level, `probing the server after 16 s, then every 2 s`, back on after 18.0 s through a
  reconnect slot.

## 33. Aiming up a slope: the view is 2.5 times the aim register (2026-10-17)

Section 23's uphill miss, run down offline from the probe's recording of that
run (the page's soldier 632, the node client's 640) and the server binary. Ledger
VIEW-14.

**The engine's law.** `BFSoldier::handleUpdate` (lnxded `0x08271f68`) poses the
soldier's camera as `setRotateXDeg(-2.5 x aimA) x setRotateYDeg(-3 x twist)` off
his body, at his `setPoseCameraPos` eye (origin + 0.65 m standing), and
`FireArms::Fire` launches a hand weapon's round down that camera (XHIT-12). The
mouse moves the register (`aimA`, the control state's and the ghost body's mask
0x10, the `st` row's pitch, the ack's `aim`) one degree a count and clamps it at
38; the view is 2.5 times it, 95 at the clamp. The yaw's x3 was already in the
page; the pitch's x2.5 was not: `mouse-input.js` turned the view one degree a
count, and the ack's `aim` closed the page's view pitch to the register.

**The miss, rebuilt.** The page stood at origin (1161.402, 109.181, 748.223),
eye 109.831, body yaw 0; the target's origin (1162.66, 110.999, 755.90), feet
110.0, 7.78 m away on a bearing of +9.32 degrees. Every round below is the
server's own aim at the round, from the `st` rows:

| burst | register | twist | view yaw | passes his axis at | to the side |
|---|---|---|---|---|---|
| 1 (275.9 s, 6 rounds) | 9.93..10.83 | -5.39 | +16.2 | 3.4..3.8 m over his feet | 0.86..0.93 m |
| 2 (277.4 s, 6) | 9.94..10.83 | -1.03 | +3.1 | 3.4..3.8 m | 0.84..0.95 m |
| 3 (278.8 s, 6) | 9.93..10.88 | -3.13 | +9.4 | 3.4..3.8 m | 0.01..0.13 m |
| 4 (280.6 s, 2) | 9.99..10.11 | -3.42 | +10.3 | 3.45..3.5 m | 0.13..0.14 m |

A standing man is 1.8 m: every round went 1.6 to 2 m over his head. Read as the
view, the register would have put bursts 3 and 4 at 1.19 to 1.33 m, his chest,
which is where the page aimed (eye 1.65 over its feet, his chest 1.2 over his):
eight rounds that hit by the page's law and missed by the engine's. The flat
kill (700.8 s, South_Base, 6.4 m) is the same law: register -4.0 is -10 degrees
of view, and its four rounds went 0.52 to 0.71 m over his feet, into his legs,
where the page aimed at his chest. No other term is needed: the eye matches to
1.5 cm (the page's eye 109.846 against the server's 109.831), the body is upright
standing, and no slope term exists in `handleUpdate`.

**The other half: two bursts off in yaw.** Bursts 1 and 2 were 7 and 6 degrees
off the target in yaw while the page read itself on him to 0.002 rad. The page's
aim log shows why: each big look step was sent twice, because the page's yaw had
not moved 120 ms after the first, and the server ran both. The page lost the
first step to its own reconciler, by the path the code allows (not traced live
tick by tick): the sidecar sends the ack before the ghost rows
of the same datagram (`session.mjs` decodes the control state first), and the
ghost writer writes the `s` row before the `st` row; the page reconciles on the
`s` row, when the ack is this datagram's but the twist is the previous one's. A
standing turn's twist, measured against the page's ledger at the new ack, took
the turn back off the page's view, and a standing soldier sends few `s` rows, so
nothing put it back. (The pitch was paired with its ack since section 23; the
yaw was not.)

**What changed.**

- `mouse-input.js`: `SOLDIER_VIEW_PITCH_PER_AIM = 2.5`, and `soldierLookDegrees`
  answers the view's pitch (2.5 a count) as it answers the view's yaw (3).
  `soldier.js`'s clamp is the view's, `AIM_PITCH_LIMIT_DEG` 38 times 2.5 = 95.
  Recoil rides the same axis, so its climb on screen is 2.5 times the register's,
  as the server's is.
- `net-sidecar.js`: the ack's `aim` is the register; the reconciler's
  `viewPitch` is 2.5 times it (`VIEW_PITCH_PER_AIM`). The ack now carries the
  control state's `twist` and body `q` as well, each carried forward per soldier
  (`soldier-ghost.mjs` `carrySelfAim`, since a state writes a field only when it
  moved), and the local player's `viewYaw` at the acked tick is built from them,
  not from the ghost rows a datagram behind.
- Another player's drawn rounds (`net-room.js`, `net-remote-rounds.js`) leave
  from his eye for his stance, along his view yaw and 2.5 times his register.
- The sidecar's own `k:"f"` rows for a soldier (`ghost-writer.mjs` `_handFire`)
  take the twist and the x2.5: the uphill rows that read `d = [0, 0.172, 0.985]`
  (10 degrees up, the twist ignored) now read `[0.148, 0.42, 0.895]` for burst 3.
- `tests/test_soldier_view_law.py`: the burst-3 numbers through the sidecar's
  fire row and the page's acked view give the same direction to the third
  decimal, 3.4 m over the target's feet.

**Live check (to run).** The same duo as section 23 on Wake co-op: the page
deploys at South_Base and walks to 8 m of a node client standing up the slope
(the uphill run's spot, the target at about (1162.7, 111.0, 755.9)), aims with
`__lookDelta` at his chest from `__soldier().eyeY`, and holds `__setTrigger` for
0.7 s, eight bursts. Expected: `HitFromPos` on the target from the first burst,
`ScoreMsg` 6 and 4 within two, and in the probe's recording the page soldier's
`st` register near 4.0 (10 degrees of view over 2.5) and its twist within 0.1 of
-3.1 at every burst, the `f` rows' `d` within a degree of the line from his eye to
the target's chest. Up a steeper slope the page should now need 2.5 times less
mouse for the same pitch: `pageshoot.cjs`'s learned `pitch per px` reads -0.00176
rad (was -0.000706).

## 34. The engine body: a remote propeller's speed is told, not derived (2026-10-18)

The last of the owner's playtest list was "a flown aircraft's propeller never
turns". The page had nothing to turn it with: a hull the server stands is a
loaded model, not a `Vehicle`, so nothing runs `advanceEngineLods`, and the
assumption on the record was that the server sends no revs.

It sends them. The `E` child of a vehicle's descriptor (§14) is an
`EngineNetworkable`, and `updateStateMask` (`0x08227620`) names the member
behind every one of its ten mask bits in its own source operands:

| bit | member | width | what |
|---|---|---|---|
| 0x001 | `Engine+0x142` | bool | **running** (TemplateMessage 4 sets, 5 clears) |
| 0x002 | `Engine+0xee`, stored to `+0x143` | bool | disabled by critical damage |
| 0x004 | `physEngine+0xb4` | bool | unread |
| 0x008 | `physEngine+0xbc` | `rangedBits(0, numberOfGears)` | gear |
| 0x010 / 0x020 / 0x040 | `Engine+0x10c` / `+0x104` / `+0x118` | `readSignedFloat(16)` | the engine angles |
| **0x080** | **`physEngine+0xa0`** | **`readSignedFloat(12)`** | **revs** |
| 0x100 | `physEngine+0xb0` | `readSignedFloat(12)` | unread |
| 0x200 | `physEngine+0xa4` | `readSignedFloat(12)` | unread |

then an unconditional `readUnsigned(32)` counter, so a zero-mask engine body is
42 bits. `setNetUpdate` (`0x08227da0`) writes each field back to the offset it
came from. `physEngine+0xa0` is the float the server recorder reads as revs
(`server-replay-recorder/src/core.c`, `pe_revs_off`), and the tail of
`PhysicsEngine::updatePhysics` rolls the Engine's first child LodObject
`revs * 20` degrees a tick from it (PHY-30). **A retail client is told a remote
aircraft's propeller speed.**

**It arrives at 80% of the server's, and retail keeps it that way.** The writer
is `writeSignedFloat(revs, 12, 1.25)` (`0x083da220`): it range-checks against
`±max` and forwards `revs / max`. The reader `readSignedFloat(int, float)`
(`0x083da200`) is a one-line forwarder to `readSignedFloat(int)`
(`0x083da280`), which returns `2 * readUnsignedFloat(bits) - 1` in [-1, 1] and
**drops `max`**; `setNetUpdate` stores that figure with no scale. Undoing the
1.25 would spin ours faster than the game we are matching.

**Checked against a live round** (13 hours of El Alamein co-op, 19 aircraft
created, decoding the review log's framed bodies):

- every aircraft body still frames exactly -- the decoder's scores over the
  whole corpus are byte-identical before and after, because capturing a value
  the reader already consumed changes no widths;
- single-engine fighters decode **one** `E` child a body and the B17 **four**,
  which is the template tree order the spec says and an independent check that
  the engines are addressed correctly;
- revs run **0.000 parked to 0.960** and never above it. 0.96 x 1.25 = 1.20,
  the engine's own revs clamp (TANK-12), so the wire ceiling lands exactly on
  it -- the clearest confirmation of the 1.25 asymmetry above;
- the running bit at `Engine+0x142` agrees with revs on 4,432 of 4,434 rows
  (the remainder are engine-off rows at revs 0): two independent fields of the
  body corroborating.

**A trap.** The running bit is sent only when it CHANGES, so an engine already
turning when this client joined never sends one -- in that round, every
aircraft that reached 0.96 revs had no running row at all. Gating the spin on
it freezes every propeller that was already flying. It needs no gate: revs are
held at 0 while `Engine+0x142` is clear (PHY-14), so a stopped engine is
already 0 on the wire.

**Built.** `ghost/pco.mjs` `readEngine` keeps revs, running and gear;
`ghost-writer.mjs` `_engines` writes them as the recorder's own `g` rows
(`[root, revs, throttle, flags, gear, engine]`, throttle null -- there is no
throttle servo on the wire), so a sidecar recording replays with its blades
turning; `viewer/net-sidecar.js` carries them onto the vehicle and
`viewer/server-entities.js` `spin` turns the pairs by the PHY-30 law
(`tests/test_server_engine_spin.py`, nine checks without a browser).

## 35. Sticky aim: the seated turret was pulled toward a round-trip-old angle (2026-10-19)

The owner reported that aiming "sticks, then updates" on foot and in vehicles.
Measured on the live page against the lab (El Alamein co-op, headless, a
constant `__lookDelta` stream sized to the frame time, the camera's world
direction and the reconciler's corrections logged every frame;
`aimtrace.cjs`/`analyse.py`, a session scratchpad):

**On foot the acked law holds and nothing snaps.** Every ack's correction
(section 20, closed whole at the acked tick; section 33, the aim with its own
ack) was a quantum or two of the axis: standing yaw median 0.03 degrees, max
0.06 (78 acks over 143 degrees of turn); pitch up and down 0.02-0.05;
walking 0.06/0.12; crouched and prone 0.03/0.27; zoomed 0.015/0.12;
strafing 0/0.12; firing while turning 0.08/0.87 (yaw) and 0.05/0.12 (pitch).
The camera's per-frame turn on 16 ms frames is constant (0.60 degrees a frame
at 36 deg/s; prone 0.90-1.06 of the median, p5-p95). The same at 7 fps under
6x CPU throttling: corrections 0-0.12 degrees. The mouse stage keeps its
sub-count remainder (`MouseInput.#remainder`), both sides quantise the axis the
same way (12 bits, 0.01 snap), and the page's look is drawn from the pending
counts between ticks (`footLookPending`), so on foot no reconciliation or
30 Hz cause was found; the remaining long frames are the headless GPU's.

**The seated turret was the snap-back.** `net-room.js` `correctSeatAim`
pulled the PRESENT turret angle 30% of the way to the ack's `haim` every
snapshot, and `haim` is the control state the server ran the acked word in, a
round trip (4-5 ticks here) behind the page. A turret traversing under a steady
hand was dragged back at each snapshot and ran on between them: the page's
tower angle stepped backwards 16 times in 4 s (0.36 degrees at most, 2.85 in
all) over 143 forward ticks, with the page's angle held equal to the server's
stale one (lead 0.29 degrees) instead of a round trip ahead of it -- the rule
section 20 already wrote down for the soldier ("a pull toward the server's yaw
against the CURRENT one dragged the view back a round trip"). And the gun's
pitch was never corrected at all: `haim` is one `[yaw, pitch]` pair per bundle
with null for a missing component (a Panzer IV: `[[56.2, null], [null,
-6.0]]`), and axis i took bundle i / 2, so the gun base read the tower's null.

**Fix.** The rig's axis angles now ride the tick ledger (`local-look.js`
capturePresentationTick, `TICK_POSE` 15 -> 19), and `createAimReconciler`
(`netcode-reconcile.js`) closes the server's angle at the acked tick against
the page's own at that tick, whole, the newer ticks on top -- the soldier's and
the driven hull's law, which is the retail client's readControlObjectState
(the whole control-object state, children included, then the unacked actions
re-run). Each axis takes the next unused bundle component of its own kind
(`ownAimTargets`). After, the same 4 s traverse: 0 backward steps over 0.05
degrees (max 0.03, the residual servo difference), the page a round trip
ahead of the server (lead 1.66 degrees at 13 deg/s) and back on it at rest;
the gun's pitch now corrected (it was off 0.49 degrees). `__net().seatAim`
(the drift, with the raw bundles) and `seatAimCorrection` / `seatAimFixes`
expose it; `tests/test_netcode_reconcile.py` checks the law.

Open: the turret's on-screen per-frame turn still varies with the frame
(the rig is slerped between ticks, not predicted from the pending counts the
way the on-foot view is), and an on-foot "stickiness" the owner feels was not
reproduced headless; if it persists, log the same trace from his own browser
(the frame times and `__net().correction.yawDelta` per frame).

## 36. Sticky aim, second pass: the drawn turret, the real mouse path, the hulls (2026-10-19)

Section 35's follow-ups, measured with the page driven through its own
`pointermove` handler (`pointer-route.js` -> `lookDelta`): pointer events
with integer `movementX/Y`, the counts of a mouse sampled at uneven 1-8 ms
(125-1000 Hz), delivered as a batch each frame the way Chrome aligns input to
`requestAnimationFrame`. Headless Chromium grants no pointer lock and gives a
CDP mouse move no `movementX` (266 moves, 0 counts), so synthetic events are
the only way in; under `?shots` the handler treats the page as locked. The
check per phase: fit the camera's per-frame turn to the counts delivered
0..3 frames earlier and report the best lag and the residual (the share of
the turn the counts do not explain).

**On foot the look is applied the frame it arrives, and no frame drops it.**
Yaw, pitch, walking and a slow hand (1 count every 4 frames) all follow the
counts in the same frame: residual 4%, 7%, 2% and 14% (the slow hand's is
the 0.12-degree step of one count), 0.120 degrees a count (the engine's 3 x
0.001 x 1.35 x 30). No frame received counts and left the camera still; none
stood still and then jumped. A frame that runs no tick shows the pending
counts through `footLookPending`, so the camera is posed after the look in
every frame. Events from a timer (not frame-aligned) arrived every other
frame under load and moved the camera on exactly those frames: the page
follows its input whatever its cadence.

**The seated turret was drawn a tick late and smeared.** Its nodes were
slerped between the last two ticks like any hull part, so a traverse showed
two frames after the hand and its per-frame turn followed the counts with a
40% residual (yaw; pitch 50%). It is now drawn the on-foot way
(`TurretRig.drawAt`, `local-look.js` `presentSeatAim`): the servo's own next
angle for the pending counts (`TurretAxis.preview`, the step law without the
side effects), with the coast the servo carries regardless blended in by the
frame's alpha, so the frame before a tick draws that tick and the frame after
draws the simulated pose (`tests/test_mouse_input.py`). Same session, same
Panzer IV, A/B: lag 2 frames -> 0, residual 40% -> 6% (yaw), 50% -> 10%
(pitch); a later Sherman run at 11 fps 3% and 4%. The simulation never reads
the drawn pose: the frame's first act puts the ticked one back.

**A jeep's free look is immediate** (residual 0%, `view.turn` on each event).
Driving, the camera rides the hull, which the acked-tick hull correction
moves by the page's divergence from the server: orientation 0.08 degrees a
correction at the median, 1.9 at p90 driving straight, 0.47 median while
driving and looking (position 6 mm / 0.12 m p90). The look itself still
follows the counts (13% residual, against 0% parked). Those hull snaps are
physics parity, not the look, and are left open here.

**Aircraft were not measured live.** Both lab Spitfires stayed in bots' hands,
the B17 was another session's, and the German planes have no page copy on
the team-2 side; solo, an entered Spitfire did not integrate under the
harness. A pilot's head look is `view.turn` (the jeep's law above), and his
stick is the hull's physics, drawn by the same interpolation and corrected by
the same law as the jeep.

**The one difference left from retail is the mouse itself.** The engine reads
DirectInput counts, unaccelerated; the page read `movementX`, which the
desktop's pointer acceleration has already scaled: a slow start barely moves
and a faster hand catches up, which is "sticks, then updates" whatever the
page does with the counts. The pointer lock now asks for
`unadjustedMovement: true` (`page-input.js` `requestRawPointerLock`) and
falls back to the plain lock where the browser refuses it, remembering the
refusal; `pageInput.rawMouse` says which the page got. Headless cannot take a
lock, so this is untested until the owner plays: the console line "mouse:
this browser gives no raw counts" means his browser refused it.
