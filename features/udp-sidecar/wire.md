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
| 0x17 | WelcomeMsg | `0x0811f990` | lstr message, s8 index |
| 0x19 | CheckSum →server | `0x0811c580` | u8 n1, bytes(n1), u8 n2, bytes(n2), u32 value |
| 0x1a | ServerInfo | `0x08120880` | lstr mapId, lstr mod, lstr gameId |
| 0x1b | ServerInfo2 | `0x08120c40` | lstr serverName |
| 0x24 | GameStatus | `0x0811db80` | u8 status, bytes(5), lstr text |
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

**Still open.** The pre-game dump's final event block ends with one event the
sidecar's table does not yet size (it decodes cleanly through DataBaseComplete
and GameStatus, then the next 7-bit type reads 0). `GameStatus`'s own layout
matches its deserializer, so the unsized event is a distinct, as-yet-unidentified
type at the tail. `join.mjs` reads blocks **tolerantly** — it keeps the events
that parse and stops at the first that does not — so DataBaseComplete still
arrives and the join completes; identifying that tail event is follow-up work,
as is step 5 (sending input) and step 6 (the first object decoder).

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
the level's template table (from a prior recording, or reconstructed from the
level's `.con`/objects.rfa load order — the latter is unbuilt). Vehicles now
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
an existing run.

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
