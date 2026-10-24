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
`challenge[0..3] (little-endian) ^ 0xa14aac64`.

**The second checksum `b` (2026-10-24).** BF1942.exe `0x005c1280` opens a path
relative to the game directory, takes the file's length and CRCs every byte
with the table `0x005c1220` builds: polynomial `0x04c11db7` MSB-first, init
`0xffffffff`, final NOT, i.e. CRC-32/BZIP2 (not zlib's reflected CRC32). The
builder runs it on `Mods/BF1942/Archives/objects.rfa` (`0x0049507b`) for the
base response and on `Mods/<Challenge mod>/Archives/objects.rfa` (`0x004951ac`)
for an expansion's, and XORs it with `challenge[0..3]` (`0x004950af`,
`0x0049520b`). This PC's vanilla `Objects.rfa` gives `0x56210250`, the retail
capture's value exactly (xpack1 `0x99a44756`, xpack2 `0xebd9e3df`). The server's
`Crc32::calcFileCheckSum` (`0x083f3fc0`) is the same routine:
`calculateServerCheckSums` stores the base archive's CRC at `+0x4a4` and the
current mod's at `+0x4b0`, and nothing in lnxded reads either field back.
`checkClientCheckSums` is called (`0x081368bc`) with a, b, c and `xpack != -1`
but compares only `a`, so `b` and `c` are never checked. `c` looks like the slot
for the mod archive the server keeps at `+0x4b0`; retail leaves it 0 (the
expansion response carries its archive's CRC in `b` instead). The sidecar
sends retail's `b` from the local install (`sidecar/objects-checksum.mjs`,
cached by size and mtime; 0 and one warning when the archive is missing) and
`c` 0.

The CD key is not enforced on a LAN server. The authenticator
`GameSpyHost::authenticateUser` (`0x0810b630`) compares the game id against the
literal `"lan"` and, when it matches, calls the callback with success
immediately ("LanGame Accept") without contacting GameSpy. On the lab
(`serverInternet 0`) the game id is "lan", so any key hash is accepted. The
content check is a separate gate: `Setup::getServerContentCheck` (`0x080d0ae0`)
reads `serverContentCheck` (0 on the lab, so off); with it off, the
`+0x170` content flag on the connection is forced true.

**The key hash, for an internet server (2026-10-24).** The client reads its key
from `HKLM\SOFTWARE\Electronic Arts\EA Games\Battlefield 1942\ergc`
(`0x00495103`; an expansion's own key at `0x00459e20`) and calls GameSpy's
`gcd_compute_response` (BF1942.exe `0x0081fa20`, the same SDK as lnxded's
`0x0810d0a0`) with the Challenge's string:
`md5hex(key) . "%.8x" r . md5hex(key . "%d" (r % 0xffff) . challenge)` and a NUL,
73 bytes, `r = rand() << 16 | rand()`, MD5 as lowercase `%02x`. The server hands
its own challenge and the hash to `gcd_authenticate_user` (`0x0810d380`) and the
master recomputes the second digest. The challenge is nine letters, not ten:
`initChallengeString` writes ten into `+0x148` and then NULs `+0x151`, and that
NUL travels in the event (a Secret Weapons lab Challenge: `wdjvujbwc\0`). The
client keeps the mod name right after the 10 bytes (event `+0x16`), so a
challenge with no NUL would hash on into it. The sidecar implements this in
`sidecar/cdkey.mjs`: one generated 22-digit key per product (bf42++'s shape),
kept in `~/.config/bfstats-sidecar/cdkeys.json`, or `--cdkey` /
`SIDECAR_CDKEY` for the base game's. It never borrows this PC's own key, which
GameSpy would see on two connections when the owner's game is on the same
server.

Proven on a private internet lab (2026-10-24,
`lab/scenarios/sidecar-wake-internet.json`: `serverInternet 1`, a password).
Before asking GameSpy, `gcd_authenticate_user` refuses a response shorter than
72 characters or a key hash already on the server, so the old all-zero hash
never got past the Challenge: no SetLevel, no `playerKeyHash` row in the event
log, and it was dropped. The real hash joined in under 2 s, and the log's
`playerKeyHash` was `md5(key)`, the response's first 32 characters. The lab
cannot reach a validator (`key.gamespy.com:29910`, the gcd default, has no
DNS; with no answer `gcd_think` accepts after three 2 s tries), so it does not
show a master recomputing the second digest. The quick accept is not explained
yet: a timeout would take about 6 s.

**And on a real internet server (2026-10-24).** BF1942-AUSTRALIA
(`159.196.188.2:14567`, a 1.612 Windows dedicated server, no password, no
PunkBuster, content check off). Its Challenge was `usxgntlto\0`, nine letters
and a NUL as on lnxded. The retail client's ChallengeResponse, recomputed from
the capture with `cdkey.mjs` and this PC's registry key, matched byte for byte,
and `a` was `challenge ^ 0xa14aac64` here too. The server sent SetLevel about
0.1 s after the response, and the client sent nothing to GameSpy, so this
server also decides without a key server. Retail's `b` was the
`objects.rfa` checksum xor the challenge (`0x56210250` once un-xored; not a
plain CRC32 of `Objects.rfa`, which is `0x1db9868b`, but its CRC-32/BZIP2, see
above); the sidecar then sent 0 and was accepted. The sidecar then joined with its generated key: SetLevel
0.19 s after its response, `DataBaseComplete` 26 s later on a 64-player Midway
(retail took 23 s), live ghosts after that, and a clean three-Disconnect
leave.

**The content check is the Ack, answered from `contentCrc32.con` (2026-10-24).**
TheGreatEscape (`168.235.94.165:14567`, vanilla Market Garden Conquest) closed
the sidecar with Disconnect reason 0x1b 0.2 s after `DataBaseComplete`. lnxded
has two 0x1b closes in `handleGameEventManagerEvent`: a failed
`checkClientCheckSums` (`0x081368d7`) and, when the client acks the database,
a connection whose content flag `+0x170` is false (`0x08136cc3`). The flag is
set by case 2, the Ack (`0x08136308`): with `serverContentCheck` 1 or 2,
`Ack ^ challenge[0..3]` must be one of the level's rows in
`Setup::getCurrentContentCrc32` (`0x080cef40`, keyed `<mapId>/<level>/<GPM>`),
which `Setup::readContentCrc32File` fills from `mods/<mod>/contentCrc32.con`
(`game.addContentCrc32 BF1942 Market_Garden GPM_CQ 2545831109`). `Setup+0x216`,
which picks that list over the server's own `+0xe8`, is set by `Setup::Setup`
and `Setup::start`; nothing in lnxded or BF1942_w32ded.exe writes the `+0xe8` /
`+0x134` field, so the list is the check. The retail client computes the value
while the level loads (BF1942.exe `0x00410980`): every `.con` the console
runs outside `ai/`, whole and followed by `\n` (lnxded `OldConsole::run`
`0x083ec3c0` hashes into `+0x498` while `setCrc32Active`), chained with the
smallest mip of every DDS it uploads (`0x00596650` -> `0x005c1360`), merged by
`0x005c13c0` and sent as `challenge ^ crc` (`0x00494a4a`) as soon as the level
is loaded, mid-dump. A retail capture on TheGreatEscape gave `0x97be4cc5`, the
file's 2545831109. The install ships the same files the server reads (bf1942,
XPack1, XPack2, GCMOD), so `sidecar/content-crc.mjs` looks the level up there,
then in `sidecar/content-crc.json` (all 124 rows, bundled so the sidecar runs
without the game; `node sidecar/content-crc.mjs --build` rebuilds it), and
`session.mjs` sends `challenge ^ crc` in its Ack; a level with no row sends 0,
which only a server with the check off accepts. With it, the
sidecar joined TheGreatEscape and stayed.

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
- **Lab first.** A third-party client on a public server can trip PunkBuster or a
  server's rules; prove a change on the lab (`+isInternet 0`, where the CD key and
  content check are off) before a public server. The CD key is answered (§4);
  the content check is answered from the install's `contentCrc32.con` (§4).
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
- **Giving up.** A kick or ban (on the drop or during the join), any other close the
  server chose (0x0d or an unknown reason, since 2026-10-24, section 43), a wrong server
  password (0x11), a banned address (0x16), a version mismatch, or the horizon.
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

## 37. Smooth panning: what the page can and cannot match (2026-10-21)

The owner's report: one spin of the mouse turns his soldier many times on the
retail client and about once in the browser, and the pan feels like the input
is being sampled hard. Read against the client's own input code, the sampling
law is not the difference; the numbers are.

**The law is the same on both sides, and it is a rate.** The client's mouse
device `update(dt)` (`0x0066ffe0`) asks DirectInput for the counts, multiplies
by `axisScale = 5 x sensitivity + 0.1`, then divides by the time the frame's
ticks consume: `axis = 0.001 x counts x scale / dt`. `BFSoldier::
handlePlayerInput` (`0x08273c70`) turns the view `3 x axis` degrees a tick,
and `InputManager::update` (`0x0049ce70`) pumps once a frame and hands every
tick of it the same axis, so the total is `0.09 x counts x scale` degrees
whatever the frame rate. `mouse-input.js` implements it (`pump`, `peek`, the
`#remainder` carry) and `local-look.js` pumps from the world's own tick count.

At the shipped infantry sensitivity (`game.setInfMouseSensitivity 0.25` in
`infantry.con`, so scale 1.35) that is **0.1215 degrees a count, 2,963 counts
a full turn**, and the axis saturates at +-16, so the ceiling is 48 degrees a
tick, **four turns a second**, on both sides. A 10 cm sweep at 800 dpi is
about 3,150 counts, or 1.06 turns: "once" is what the law gives for one
sweep, and the retail client reaching "many times" for the same hand is
either a higher sensitivity in that player's profile or a higher count rate,
not a different sampler. The page's console carries the engine's own words
(`game.setInfMouseSensitivity`, read back with no argument), so the two can be
matched without touching code; `__mouseReport()` reports what is in force.

**What the page cannot match is the device.** The engine opens DirectInput in
exclusive mode and reads raw counts. A browser can only match that with a
pointer lock granted for `unadjustedMovement` (`page-input.js`
`requestRawPointerLock`). So there are three states and only the first is
parity:

| state | what a pan does | how it reads |
|---|---|---|
| locked, raw | count for count, one gain at every speed | the engine's own feel |
| locked, not raw | `movementX` is pre-accelerated by the desktop: a slow hand under-moves and a fast one overshoots | "sticks, then jumps" |
| not locked | the page reads cursor travel, which stops at the window edge | one sweep, then nothing |

The third state is the one that matches "it spins once at most". Until this
round the page also required a **held button** to read motion in that state,
which is not something the game asks for; the pointermove handler now feeds a
playing player's look from plain motion (`page-input.js`), so a player whose
browser refuses the lock can still look, bounded by the screen. It is not
parity, and it cannot be: only a lock removes the edge.

**Saying which state is live** is the point of `__net().mouse` (also
`__mouseReport()`), which reports `locked`, `raw`, `countsPerSecond`, the axis
in force, the sensitivity, the scale, `degreesPerCount` and `countsPerTurn`.
The page also prints one line from `capture()` when the state changes: "raw
counts (the engine's own device)", "pointer acceleration (this browser
refused raw counts)", or "no pointer lock, so the look stops at the window
edge". A panning complaint now comes with its own answer.

**The acknowledgement does not smear a pan.** Measured with the shipped
reconciler, a six-second pan at one turn a second, acks at 20 Hz against a
30 Hz page and two ticks behind, with the authority integrating the axis it
received: the only yaw a correction moved was the wire's own quantisation,
0.036 degrees at the worst ack, no ack went backwards, and the pan covered
5.58 turns against the 5.57 it owed. `tests/test_netcode_reconcile.py` pins
it (scenario `o`), so the law that steps a pan back at 20 Hz cannot come back
unnoticed.

Open: the owner's browser state, which the readout settles. If the lock is
granted raw, the page and the retail client turn the same degrees per count
and any remaining difference is the profile's sensitivity. If raw is refused,
no gain in the page can undo an acceleration curve, and the honest fixes are
the sensitivity word and, on Windows, the pointer-precision setting.

## 38. Remotes are drawn on the client's clock, not behind the newest sample (2026-10-23)

The owner, live: firing at a bot's Aichi Val registered nothing, while
soldiers and tanks took hits. The review (review-2026-10-21.md section 4)
put the page's drawn planes about 0.25 s behind the server and called the
100 ms lookback retail's own. It is retail's, but measured from a different
clock (ledger P-6).

**Retail.** `GameClient::predictAll` (BF1942.exe `0x00491f00`, from the client
tick `0x004b90d0`) calls `predict` on every networkable other than the
player's own, with 1000 x the game time `0x009a2160`. The game time is the
tick counter `0x009a2168` over the sim rate. `readControlObjectState`'s
handler `0x00491c90` sets the counter to the ghost block's server tick
(`GhostManager+0x80`, from the block header at `0x004970f8`) and adds one per
unacknowledged action it re-runs (`0x00491e9f`); the client tick adds one
(`0x004b90ec`). So the clock names the server tick that will run the action
made now, and `predict` draws 100 ms behind THAT. The samples carry the same
tick (`1000 x +0x78`), and past the newest one `predict` extrapolates along
the last pair (section 20). A retail player leads a plane by 0.1 s of its
motion plus the round's flight, whatever the ping.

**The page before.** `sideTime` was the newest sample's server time (mapped
by the least offset, section 20) less 100 ms: the clock retail would have
with no words in flight. Every word the page has in flight (sidecar queue,
uplink, server buffer) was a tick more of lag on every remote.

**Now** (`viewer/net-sidecar.js`): each ack row carries its block's `tick`
(`sidecar.mjs`); `clientClockLead` takes `(tick + sent - acked) / 30` less the
mapped server clock, `followLead` filters it (5% a sample, whole on a 0.25 s
jump, at most 1 s), and `slewLead` moves the drawn clock onto it at most
0.05 s per second, so it never steps. Remotes are drawn at that clock less
100 ms: soldiers, hulls, turrets and the server's rounds alike, as retail
does. Past the newest sample a hull's rotation now carries its last pair's
turn (`extrapolateQ`), and so does a turret's, where both used to hold and
would have stepped at 20 Hz now that the drawn time is nearly always past the
newest sample. `createRemoteBlend` eases each new sample's change of the
extrapolated path (position and velocity, 0.1 s, snapping over 2 m), and the
sidecar's `s` rows carry millimetres, the wire's resolution, instead of
centimetres, which put up to 0.3 m/s of noise on that velocity.
`createSidecarClient({ remoteClock: 'lookback' })` keeps the old law for an
A/B.

**Measured** (`lab/remote_lag_probe.mjs`, the page's client under node through
a probe sidecar, 30 Hz words; `lab/remote_lag_check.py`; Wake co-op, bot
Corsair, SBD, Zero and Aichi Val at 39-49 m/s):

| | before (`lookback`) | after |
|---|---|---|
| drawn against the server's present, median | 0.100-0.115 s behind, 4.0-5.6 m | 0.015-0.02 s ahead, 0.8-0.9 m (p90 1.4 m) |
| against the plane at the tick that ran the word sent that frame | 7.4-10.9 m | 4.0-5.6 m (0.1 s, retail's) |
| wobble off a straight line between frames, median / p90 | 2.9 / 7.4 mm (mm rows) | 4.3 / 14.5 mm |

The words in flight on that path were 3-4 (lead 0.12 s). Through a headless
`map.html` the page's own lead read 0.05-0.07 s and its render time 0.047 s
behind the server's present (ground hulls; no bot was flying during that
run). The original page, with centimetre rows, wobbled 5-6 / 12 mm, the
smoothness the owner signed off on; the new law is within that.

Not measured: a scripted probe's hit bool against a bot plane before and
after (aiming a node soldier at a plane is its own controller). The fire
path is as section 23 and review section 4 left it: the server runs the
words, its rounds leave down the camera (VIEW-14, XHIT-12), and the hit bool
comes back on hits (the owner's Chi-ha cannon, 12 marks on an SBD earlier).

## 39. Hit marks: the server's word, timed from the press (2026-10-23)

The owner, live after section 38: on target at a tank, the crosshair's marks
come a little later than in retail; at a plane, sometimes none, or a hit
that does not mark.

**Retail.** The marks are the server's word and nothing else (ledger XHIT-4,
XHIT-6, XHIT-17). `giveDamage` sets the shooter's connection flag on a direct
hit on a soldier or a manned hull; the next control-object state carries it
as the bool after the serial; the client sets `HitIndicationTime` to 1.0.
A byte scan of `BF1942.exe` finds exactly three stores of 1.0 to that field
(`0x00495616`, `0x00495a24`, `0x004a8890`), all three XHIT-6's: no client
path raises the marks from its own rounds. A mark is a round trip plus the
round's flight after the shot, in retail as here.

**The page** does the same: `sidecar.mjs` turns the bool into a `hitMark`
row, `net-sidecar.js` into an event, `net-room.js` into
`raiseHitIndication`. In the owner's session (`run.ndjson`, 18:05) every one
of the 8 marks came in the same block as its hull's or soldier's hit-point
drop; nothing in the path waits for the drawn clock.

**Measured** on the live page through a probe sidecar, Wake co-op
(`lab/hit_reg_probe.cjs` + `lab/hit_target.mjs` + `lab/hit_reg_check.py` for a
standing player; `lab/hit_hull_probe.cjs` + `lab/hit_hull_check.py` for a
bot's hull; `lab/seat_aim_probe.cjs` for a seat's gun). Milliseconds from the
press, headless page, target 1-19 m:

| | median (range) |
|---|---|
| the first word with the trigger leaves the page | 21 (3-42) |
| the server runs it | 73 (49-148) |
| the server's round reaches the page | 95 (54-174) |
| the hit mark row reaches the page | 113 (107-167) |
| the HUD's timer reads 1 | 136 (126-192) |

- **The input path.** At an ack, 1-2 words are in flight and 0-1 wait in
  the sidecar's queue (`iq`); a word takes 36-73 ms at the median from the
  page to the tick that runs it. Replaying the page's recorded word times
  through an ideal sender (every word out the moment it is made) and the
  server's buffer (D-2, D-3) saves about 5 ms: the word the sidecar holds
  would otherwise wait the same time in the server's buffer for its tick. A
  bucket pacer and a page clock that drained the server's buffer too were
  tried live and measured no better; they are not kept. The retail client
  sends at its connection's 20 Hz (netcode.md section 5), so its words wait
  25 ms on average where the sidecar's do not.
- **The page's own frame.** The page reads the mark in its WebSocket handler
  and the HUD shows it the next frame (20-26 ms headless). A message waits
  for the page's main thread: 1-4 ms at the median above the fastest, p90
  18-60 ms headless. That and the display's own latency are the browser's
  share; a busy frame on the owner's page is a later mark.
- **Planes.** With the crosshair held on a bot's Zero as drawn (57-110 m), 30
  server rounds passed 3.5-8.7 m from its origin, behind it, and none
  marked. The page draws a remote 0.115-0.134 s (median 0.120 s) behind the
  tick that runs the word it is making, retail's 0.1 s (P-6; P-5 measured a
  retail client at 0.12 s), and the BAR's round adds 60-180 ms of flight.
  Held ahead of the drawn plane by its drawn velocity times the flight plus
  a lead, the marks per burst were 18/13 at no lead, **27/13 at 0.1 s**,
  12/12 at 0.2 s and 3/12 at 0.3 s (Aichi Val, Zero, Corsair at 60-130 m):
  the server marks a plane where retail would, one tenth of a second ahead
  of where the client draws it. That is the lead a retail player gives a
  plane too. Rounds the page sees strike the drawn plane are the page's own
  prediction; the server prices its own.
- **The seat's gun.** A Sherman's pintle Browning traversed at a steady hand:
  the page's turret against the server's at each acked tick, 0.004 deg at the
  median, 0.034 at p90, 0.062 at worst over 373 acks; elevation exact. The
  seat aims where the page shows.

**Fixed.** A control state whose body did not read (a strict soldier read, a
state cut short) threw out of `decodeControlState` and the session's catch
kept neither the serial nor the hit bool, so that mark was lost with it. The
decoder now returns the serial and the bool and marks the body unread
(`tests/test_sidecar_control_state.py`). The owner's session logged no such
failure, so this was not his missing mark; it is the one loss path the
event path had.

**Not found.** A manned bot tank within the probe's range: the tank case's
latency is the table above, since a hull's mark is the same flag (XHIT-4,
XHIT-5).

**Correction (2026-10-24): the input path did carry excess.** The
conclusion above, that nothing between the page and the tick was more than
retail's floor, was wrong. The 5 ms replay assumed an empty server buffer
and was run on fresh sessions, whose backlog was small to begin with. The
press-to-ran figures were also late: `hit_reg_check.py` took the ack's tick
for the press's word, though a 20 Hz ack covers one or two words. That added
half a tick at the median and is fixed.

*The fault.* The page makes one word a world tick on its own clock, and the
server runs one a tick on its own clock (D-3). Nothing ties the two together,
so a backlog a word meets stays for good. A catch-up word from a hitch adds
one, and so does a word that missed its tick. Only a tick the server runs
with nothing (D-4, "starved") takes one away. The sidecar's slot pacing added
to it. A word that came less than 3/4 of a tick after the last one waited for
the sender's own 30 Hz slot, whose phase against the server's tick is
arbitrary, and the server starved with a word still waiting in the sidecar.
The page's 3% slowdown at `iq >= 2` saw only the sidecar's queue, never the
server's buffer.

*Retail does not steer* (ledger D-8, read 2026-10-24). Its client counts
whole ticks off its own wall clock, and nothing the server sends moves that
count (`InputManager::update` 0x0049ce70). Its backlog is bounded by the
server dropping the oldest of more than four (D-2) and by the >9 collapses
(D-4). A page cannot drop words as D-2 does, because it has already run every
word it sends.

*Instrumented.* At each control state the sidecar reads the input path
(`sidecar/input.mjs` `atAck`):

- `iq`: words in its queue.
- `sq`: records the server holds unrun. These were released more than 2 ms
  before the block, with a serial newer than the echo. On localhost the
  server reads, ticks and sends in one frame (D-1).
- `st`: starved ticks, the ticks advanced less the records run.
- `ld`: the acked word's wait, from the sidecar to the block saying it ran.

They ride the ack row (`__net().serverQueue`, `.starved`, `.pace`). They are
also recorded as `k:"iq"` rows in run.ndjson, so a session the owner plays
can be read afterwards with `lab/input_path_check.py run.ndjson --every 60`.

*Fixed.*

- **The page's world clock is steered** (`viewer/input-pace.js`, net-room.js
  `paceToServer`), as clients commonly do. The shortest `ld` over the last
  12 acks is held at 8 ms (the margin by which the latest word still makes
  its tick). The rate moves 1% per 10 ms of error, within 0.94-1.04. A
  starved tick while the page's frames were even and nothing was held grows
  the target by 4 ms, up to 30. The target creeps back at 0.5 ms a second.
  The 1/30 s step is unchanged and no word is dropped.
- **A hitch's catch-up ticks are not run** (world.js `hitchCatchUp`). This
  applies to a 0.1 s frame (a stall of 100 ms or more) on a page whose frames
  are otherwise under 50 ms. Such a frame runs one tick. The server ran those
  ticks without the page's words already, so sending them would only queue
  them.
- **The sidecar releases through a bucket**: one a tick, with a burst of two
  (`pace: 'bucket'`). D-7's eleven-word frame still leaves one a tick after
  the first two.
- **The sidecar merges a queue above three into two words**: look deltas
  summed, one-shot presses once, the newest levels, the newest serial and tag.

`&inputPace=queue` (with the sidecar's `--pace slot`) is the old law, kept
for A/B. `&inputPace=off` runs the clock at 1.

*Measured on the lab*, Wake co-op, 8 bots, localhost. Two harnesses were
used:

- `lab/input_pace_probe.mjs` + `input_pace_check.py`: the sidecar's own
  sender, with the page's clock and pacer under node, at 60 fps. This is what
  a page that keeps its frame rate sees.
- The headless page: `hit_reg_probe.cjs` with `STALL_MS`, `WALK`. It runs at
  28 fps with 60-180 ms frame gaps about 1.5 times a second.

All times are in ms.

| | before | after |
|---|---|---|
| **60 fps page (node)**: press to the tick that runs it, median (p90) | 72 (91) | **30 (52)** |
| word, page to the tick that runs it | 64 | 22 |
| backlog iq+sq, mean words | 1.48 | 0.18 |
| starved ticks | 0% | 0.16% |
| **same, a 300 ms stall every 4 s**: press to run | 87 (131) | **34 (73)** |
| backlog, mean | 2.01 | 0.48 |
| back to at most 1 word after a stall | never in 1 s (14 of 14) | median 0.88 s, max 0.99 s |
| starved ticks outside the stalls | 0.06% | 0% |
| **headless page, 2 runs**: press to run | 80 (111) | 66 (88) |
| word wait, sidecar to run | 68 | 51 |
| backlog, mean | 1.52 | 0.98 |
| starved ticks | 1.4% | 2.3% |
| corrections walking, cm, median (p90) | 5 (41) | 2 (9) |
| corrections standing | 0 (0) | 0 (0) |
| **headless page with stalls**: press to run | 79 (118) | 65 (107) |
| back to at most 1 word after a stall | median 2.7 s, p90 10.8 s | median 2.3 s, p90 6.3 s |
| starved ticks outside the stalls | 3.1% | 4.4% |
| corrections walking, cm | 2 (9) | 2 (10) |

- The node 60 fps rows meet the target. The headless page gains less, and
  starves more, because of its own frame gaps. A 60-180 ms gap makes no word
  at all, so the server runs zero input whatever the margin. Each gap then
  leaves a tick of backlog that the clock drains at a few percent.
- Press to HUD cannot fall below press-to-run (30) plus the next control
  state (20 Hz, so 0-50 ms) plus one frame. That is roughly 70-90 ms on a
  60 fps page. Headless, the mark row reached the page a median 62 ms after
  the tick that ran the press (n=49) and the HUD a median 114 ms after it.
  The HUD part is the headless frame.

*Planes.* By P-6, the page draws a remote 100 ms behind the tick that runs a
word made now. The pending count includes the backlog (`clientClockLead`), so
the lead a plane needs does not move with the backlog. What the backlog moves
is when that tick comes in real time. Every word, shot and mark is later by
33 ms a word, and the drawn remotes are extrapolated that much further past
their newest sample. The lead sweep (`hit_hull_probe.cjs`,
`LEADS=0,0.05,0.1,0.2`, Zero, Val, Corsair and SBD at 95-160 m, two runs
each) gives the following marks / bursts:

| lead beyond the flight | before | after |
|---|---|---|
| 0 | 9/8 | 18/11 |
| 0.05 s | 5/8 | 12/10 |
| 0.1 s | 9/7 | **22/10** |
| 0.2 s | 3/6 | 12/10 |

The best lead is 0.1 s both times. That is P-6's 100 ms, unchanged as
expected. The marks per burst rose from 0.9 to 1.6, but the targets and
ranges differ run to run, so treat that as a tendency only.

*Why the earlier page clock measured no gain* (2026-10-23, reverted). It was
run on fresh headless sessions, 20 taps each. Two of its four baselines
already had a median of one word in flight and 36-44 ms from send to run, so
there was little to drain. It had no measure of the server's buffer and
steered on in-flight counts. The headless page's own frame gaps re-add a tick
about every second. Twenty taps also carry about 20 ms of noise, and the
press-to-run figures carried the half-tick bias above.

## 40. A round restart under the player: re-made hulls and the seat they end (2026-10-24)

The owner, live on the Wake co-op lab: he gunned a bot's Sherman (532,
spawned at the airfield), switched to its driver's seat, and "a second
Sherman appeared, bouncing around where it would have spawned at the
airfield, transparent and flashing, just like the tank I was in". His
session is `tools/bf1942-models/run.ndjson` of that morning (pid 0 is the
page).

**What the server sent.** A probe sidecar of another session joined as a
second human (`gp29503`, createPlayer pid 1 at t 419.785), the server sent
GameStatus 1, and at t 423.997 it restarted the map, 280 ms after the
page's `enterVehicle 532` (t 423.719):

1. every player killed: ScoreMsg 4, ExitVehicle with the death flag, and a
   SetDefaultVehicle to his camera (pid 0: control netId 2);
2. every hull and kit destroyed (DestroyObject, 423.998-424.033), 532 among
   them;
3. a ResetMap event (0x18, t 424.033) and GameStatus **3**, then
   `gameRules`;
4. every pad's hull made again **under its old netId** at its spawn
   (CreateObject 424.083-424.183: 532 at 1392.5, 115.83, 737), the control
   points that had changed (`cp`), the tickets (`tk` 56/56);
5. GameStatus 1 twenty seconds later (443.985), and the bots spawn.

That is `restartMap` as ROUND-10 reads it (`clearWorld`, ControlPoint and
ObjectSpawner resets, `resetTimers` writing status 3), with no end of round
in front: the status went 1 -> 3, not 2 -> 3. What makes the server restart
on a second human's join (`GameServer+0xd0`, `setMinNrOfPlayersUsed`) is
still unread (ROUND-9). The lab's own log shows the same restart at its
464.9 s and again at 878.9 s.

**The scope of a re-made object (lnxded `GhostManager::readData`).** The
client's in-scope flag is a byte at `+0xc` of the descriptor's first
networkable: action 3 clears it (`0x08141fae`) after `disableObject`; an
action 1 that finds it clear calls `enableObject` (`0x08142142`) and sets it
(`0x08142151`). The networkable is the object's, so DestroyObject takes the
flag with it, and the object CreateObject makes under the same netId starts
disabled until its first record (retail's CreateObject handler makes every
object disabled, `0x00493216`). The review log of the session has no action 3
for 532 at the restart, and its next record is an action 1 with a full
405-bit body at t 449.127, when a bot boarded it: that is the record that
turns the new 532 on.

**What the page did.**

- *The re-made hull was never drawn again.* `ghost-writer.mjs` kept 532 in
  its own scope set across the destroy, so the 449.127 record wrote no k:"o";
  the page had closed the span on destroyObject and drew nothing for 532
  while the bot drove it for 45 s (replayed headless from the session, see
  below). Fixed in both places: the ghost writer closes a destroyed object's
  span with a k:"d" and forgets its scope (and its hit points and poses), and the page takes any ghost record
  (`s`, `a`) of a known object as its scope-in (`net-sidecar.js` `heard`),
  which is retail's rule and keeps recordings made before the fix right.
  Rebuilt from the review log with the fix, the session gains 24 k:"o" rows,
  all after the restart, 532's at 449.127.
- *The restart was not read as one.* Only 2 -> 3 was. Now 1 -> 3 is too, so
  the page starts its round over (`restartRow`: out of the seat, the soldier
  discarded, the flags at their start, the round's state, the deploy
  screen), and the control points the restart resends are the round's first
  word on them, as on a join: the page printed "[Landing Beach] Allies
  captured the control point" at the restart. The restart opens the spawn
  screen a row before the server's fresh tickets, and that screen paints its
  ticket counter only on demand, so it showed the old round's 49 / 13 until
  something else repainted it; a ticket row now repaints it (any count that
  moved while the screen was open had the same staleness).
- *A slow frame across the destroy and the create kept the old entity.*
  `server-entities.js` reused an entity of the same id and template, with its
  pose, its Armor and its wreck. Each createObject now has its own `gen`
  (`net-sidecar.js`), carried on the vehicle entry, and an entity of another
  `gen` is dropped and built again.
- *A hull destroyed with him in it.* The restart killed him a row before the
  destroy, and the death row took him out. A hull the server removes with no
  death row first (a wreck's time to live, HP-19; HP-20) left the page in a
  seat on nothing. `viewer/server-seat.js` `seatPlanForRow` is now the one
  rule for the three rows that end a seat (his death, his hull's
  DestroyObject, the restart), and every one of those exits is quiet: the
  death row's exit used to send a Use to the server.
- *The level copy he drove.* In server-authority mode the hulls are the
  server's entities and the level's copies stay off the field, but a copy the
  page has driven is reparented out of `spawnersRoot` by its drive
  (`vehicle-base.js`), so the pads' visibility pass no longer hides it. It was
  hidden by `visible = false` alone, and kept its parked body and its
  moved-owner collision. `applyHull` still ran the pre-authority law on it:
  on a `padSpawn` it stood the copy up (`remoteStand` -> `respawnVehicle` ->
  `respawnVehicleBody`), which puts it back on its own pad, the airfield
  spawn, on a fresh parked body that settles on its springs. In
  server-authority mode `applyHull` now stands every bound copy down (hidden,
  out of the pads' live set, its moved owner cleared and disabled, its body
  removed) unless the page is driving it, and so do the exit paths.

**What was and was not reproduced.** A headless replay of the session (the
recorded rows streamed to `map.html` at their own times, the
join snapshot built as `sidecar.mjs` builds it; no acks, so the page's drive
was not corrected to the server) showed the unseen 532, the missed restart and
the capture line, all fixed. It did not show the second Sherman: in it the
death row took the page out and the next snapshot hid the copy, both before
the re-made 532 could bind to it. The copy, its pad and its body are the
only things on the page that stand a Sherman on the airfield spawn and bounce
it, so they are the likeliest reading of the owner's report, and the path
that stood it up no longer exists in server-authority mode. The transparent
flicker on both reads as two hulls drawn in one place, a level copy and the
server's entity at the same pose, whose depth tests fight frame to frame:
nothing on the page fades a hull it has not wrecked (no spawn protection, no
scope fade). Not confirmed against the owner's screen.

Held by `tests/test_sidecar_round_restart.py` (the session's rows,
`tests/fixtures/sidecar_wake_round_restart.ndjson.gz`, through
`net-sidecar.js`, `server-seat.js` and `server-entities.js`, and the ghost
writer on the same sequence).

## 41. The seated gun: its rest, and the server's whole servo state (2026-10-24)

The owner, live on Wake (2026-10-24, `run.ndjson`): sitting in the Defgun at
the airfield (netId 524, hull yaw 137.4), he put the crosshair on a moving
Daihatsu and his screen showed hits; the server marked none. The server's
turret, read from the control state's bundles (the `j` rows) and the two
rounds it fired (180.79 s and 186.29 s, each dated 5.03 s before its
magazine step, the Defgun's `roundOfFire 0.2`), was 16.2 and 16.0 degrees
short in traverse and about 11 degrees high, at two shots after swings in
opposite directions. The same offset after opposite swings is not a lag: it
is a standing offset the page never closed.

**The server's servo is GUN-2, to the letter.** Through the owner's 80-degree
swing and its reversal the server's yaw speed ramps at exactly the template's
`setAcceleration 50` both ways (0.5 degrees per 0.1 s per 0.1 s) and turns at
`input x 90` where the hand is slower; nothing beyond a clamp is lost. The
page's `TurretAxis` runs the same law (offline, a 60-count swing ramps at 50
deg/s^2 and the pitch stops at the template's 10 degrees down). So the
hypothesis that the page turned the gun by the full mouse delta while the
server clamped the turn is refuted.

**The cause: the page's rig took a turned pose for its zero.** A
`TurretRig` axis poses its node as `base x Ry(angle)`, and `base` was the
node's quaternion when the seat was first manned (`turret-rig.js`). The
page has another writer of the same node: the server's joint rows for a hull
someone else is aiming (`netcode-render.js` `applyJoints`), and its own rig
from an earlier visit. When the owner climbed back into the Defgun he had
left at 8.5 degrees of traverse and against its elevation stop 90 s earlier,
the new rig measured from that pose; the acked-tick correction (section 35)
then set the rig's NUMBER to the server's, and the barrel was drawn the
server's angle plus the left-over pose. The numbers agreed at every ack and
the gun pointed elsewhere. Reproduced on the lab with `lab/seat_swing_probe.cjs`
(HEAD's page): with the hull still, the drawn view's heading plus the
traverse, and its pitch plus the elevation, are constants of the seat. On a
Defgun the server had left at 90 / -22.6 they were -139.38 and 22.63 (the
seat's own are -49.38, its hull's heading, and 0): the gun drawn 90 and 22.6
degrees off; out and back in, -110.04 and 30.00, off by the angles the page's
own rig had left.

**The fix** (`viewer/rest-pose.js`): a turning part's authored rest is noted
once, before anything first writes the node (`applyJoints` notes it, a rig
and a `RiggedPart` read it), and every rig measures from it. After, the same
probe: -49.38 and 0.00 on the same Defgun, spread under 0.01 over 176 still
acks, and the same after getting out and back in (the tables below).

**The second law: the server's whole servo state.** A control state carries
every bound axis's angle AND speed register (GUN-21), and the retail client
copies both into its bundle before re-running its unacknowledged actions
(NET-12). The page closed the angle alone, so on a slow servo its own speed
register ran on between acks. Now `correctSeatAim` takes both at the acked
tick and re-runs the newer ticks with the inputs they held, by the axis's own
law (`TurretAxis.stepFrom`, the ledger in `createAimReconciler`). The sidecar
forwards the speeds (`hspd`, a share of `|maxSpeed| x 16`) and records each
ack's bundles in its `k:"iq"` rows (`ha`, `hs`), so an owner's session can be
read afterwards. `?seatAimSync=angle` keeps the old law for an A/B.

**Measured** (Wake co-op, the lab, a probe sidecar on ws 17992, the headless
page; fast swings of 40 counts a frame both ways, flicks and reversals, the
elevation driven to its stops, a steady pan; `lab/seat_swing_check.py`): the
page's own angle at each acked tick against the server's, before the ack
closes it, degrees:

Defgun 523 (north base, hull heading -49.38; template `maxSpeed 90/50`,
`setAcceleration 50/75`). Before: HEAD's page; after: this change. Each
`median / p90 / p99 / max`:

| | before | after |
|---|---|---|
| swinging, yaw | 0.0005 / 0.11 / 3.3 / 6.1 | 0.0007 / 0.004 / 0.008 / 0.17 |
| swinging, pitch | 0.0007 / 0.017 / 1.6 / 1.7 | 0 / 0.003 / 0.005 / 0.05 |
| settling (still under 1 s), yaw | 0 / 0.26 / 2.1 / 2.4 | 0 / 0.002 / 0.007 / 0.008 |
| still, yaw p99 / pitch p99 | 0.11 / 0.012 | 0 / 0.0001 |
| acks over 0.1 deg | 124 of 921 | 2 of 748 |
| back in: swinging yaw p90 / p99 | 0.44 / 1.8 | 0.0035 / 0.007 |
| back in: acks over 0.1 deg | 159 of 1114 | 1 of 800 (the boarding ack) |
| drawn: heading + traverse, pitch + elevation | -139.38, 22.63 | -49.38, 0.00 |
| drawn, back in | -110.04, 30.00 | -49.38, 0.00 |

Sherman 712's tower and gun from the driver's seat (`maxSpeed 35/20`,
`setAcceleration 1000`, a servo that reaches its speed in a tick), the
view taken in the hull's own frame because the hull rocks on its springs:

| | before | after |
|---|---|---|
| swinging, yaw p90 / p99 / max | 0.011 / 0.028 / 0.79 | 0.011 / 0.022 / 0.77 |
| acks over 0.1 deg; back in | 3 of 1154; 2 of 1183 | 1 of 1094; 1 of 1163 |
| drawn: traverse and elevation offsets, first boarding | 0.00, 0.00 | 0.00, 0.00 |
| drawn, back in | **-31.52, 14.00** | 0.00, 0.00 |

So a slow servo needed both laws and a fast one only the rest: the
Sherman's numbers were already right, and its drawn gun was off by the pose
the page itself had left it at (the owner's "20-40 degrees off" in a
Sherman, 2026-10-22). The boarding ack is the one over 0.1 after the fix:
the page builds the new rig at the rest and that ack hands it the server's
state whole (the gun was standing at 90 and -27.8, or 101 and 20, from the
run before).

What remains over 0.1 degree comes where the server ran a tick with no word
of the page's (a starved tick, D-4: the headless page's 60-180 ms frame
gaps), which runs the bundle on zero input; the page cannot predict that
tick, and the next ack closes it, as retail's does.

`tests/test_seat_aim_state.py` pins both laws: a rig built on a turned node
draws from the authored rest, and with the server's speeds the page matches
a Defgun through fast swings to float precision, where the angle alone is
1.7 degrees out between acks.

**The owner's Corsair at 233-249 s** (soldier 656, prone with a BAR): the
`f` rows of a soldier are the sidecar's own reconstruction of the server's
camera ray from the ghost (`ghost-writer.mjs` `_handFire`: the body's
rotation, `Ry(-3 x twist)`, `Rx(-2.5 x aimA)`, VIEW-14), not the round, so
they carry no deviation. Against the server's Corsair track that ray missed
by a median 4.2 m inside 40 m, 8.3 m at 40-80 m and 8.2 m beyond (40 rounds),
mostly along the plane's wing axis (its own right), 1-10 m along its
velocity. The marks at 234.43-235.23 s came where the ray passed 0.3-5.4 m
from the origin, inside the Corsair's 6.25 m half-span. The BAR's prone cone
(DEV-9: `setMinDev 0.75` plus a fire bloom of about 0.25 at 8 rounds a
second, `setDevMod 0.5` for the decay) is +-0.0075 to +-0.010 rad on each
axis: 0.15-0.2 m at 20 m, 0.45-0.6 m at 60, 0.75-1.0 m at 100. The misses are
the aim, not the spread, and the page's look law puts its crosshair where the
server's camera is (section 33, the look law exact to 0.001 degree). What
differs is the page's own rounds: the server draws a human's deviation from
`random_seeds` at his action index (DEV-9, bot-deviation.js's law, AI-145 for
bots), the page from its own random stream, so a round the page draws on the
wing's edge can be one the server's lands off it, within that cone. Open:
the human's index (`ActionBuffer::add` 0x081125c0 numbers each action as it
arrives) needs the server recorder's tracked rounds to pin before the page
can draw the server's point.

## 42. A human's round is drawn at his record's serial (2026-10-24)

Section 41 left the page's own rounds drawn off its own random stream while
the server draws a round's two deviation uniforms from `random_seeds` at
`k = (input index + barrel) & 0x3ff` (DEV-9). For a bot that index is a
leftover of its stack slot (AI-145). For a human it is the serial of the
record his tick runs (ledger DEV-14):

- `processRcvdPlayerActions` 0x08148470 queues each record newer than the
  last (D-4) with `ActionBuffer::pushBack` 0x08112750. That copies the
  received entry whole, and the entry's +0x14 is its serial (+0x88 in the
  manager, the field D-4 dedupes on).
- `simulatePlayerUpdate` 0x0815bd00 sets `Game+0x68` from the first queued
  entry's +0x14, or the last run index + 1 with nothing queued, and
  `getCurrentInputIndex` returns it to `fireBarrel`.
- `ActionBuffer::add` 0x081125c0, which numbers entries by a running count
  and which AI-145 had taken for the human path, has no caller.

**Measured.** A recorder built with `-DREC_FIRE_INDEX=1` (server-replay-recorder
README) writes `Game+0x68` beside each `f` (`gi`), with the launch matrix's
three rows at full precision; the shipped build's `d` at 3 decimals is 0.1
hundredths of a radian, too coarse against the BAR's 0.75. `lab/dev_index_probe.mjs`
laid a sidecar soldier prone and still with the BAR on Wake (no bots,
`lab/scenarios/sidecar-wake-dev-rec.json`), its serials from 5001: twelve
taps, a hitch of seven words (merged), five taps, 1.5 s quiet (38 idle
records in the run), five taps, a burst of eight. `lab/dev_index_check.py`:

| | |
|---|---|
| rounds | 30, each with `gi` equal to the serial of the word that carried the press (5623 for the first) |
| on index `gi - 1`'s point | 30 of 30, residual at most 0.0006 hundredths; the BAR has no barrels, so `Fire` hands `fireBarrel` -1 |
| total | the 22 taps 0.7500 (the prone floor), the burst 0.76 rising 0.01 a round (DEV-12) |
| `k = serial - 1 + c`, jointly over the taps | c = 0 at rms 0.0003; the next c at 0.44 |
| `k = words released - 1 + c` | no c fits the run: a count keeps its offset only between two merges or idle spells |

The prone camera rolls with the ground (row 0's y 0.016 here), so the fit
reads the matrix's own rows; a level frame leaves the up draw a few
hundredths out. The flight samples are a tick apart and their `t` is a wall
clock, so the velocity fit times them by sample index.

**The sidecar's part.** Each `k:"ack"` row now carries `ai`, the input index
the server ran the acked word at (`input.mjs` `actionIndexOf`: the serial).
`k:"iq"` rows carry `mg`, the words merged so far.

**The page's part** (`viewer/input-index.js`). The sidecar gives the page's
words consecutive serials in the order it enqueues them, so a later page
word runs at `ai + (seq - ackSeq)`, and a page word is a world tick
(`sendTickInputs` notes each tick's seq). The round's dice are that index's
point (`bot-deviation.js` `inputDice` through `round-launch.js` `deviate`),
wired for the local player's hand weapon and seat guns as `guns.inputDiceOf`
in map.html. Elsewhere (a level alone, a room, a bot) it answers null and
the guns' own dice stay.

Which tick fires matters. The server fires a press on the first word that
carries it. The page's hand weapon takes the trigger in the frame's
presentation, after the world has stepped, so a press made in a frame that
ran ticks fires on the next frame's first tick, one or more ticks after its
word. So a held trigger's rounds are drawn at their tick less the hold's
lag: the ticks from the first word carrying the press to the page's first
round of it. The press is noted before the step (`room.notePageInput`),
because a press made in a frame with no tick fires in the next frame's step,
before that frame's words go out.

On the lab, through a probe sidecar (`lab/dev_index_page_probe.cjs`, BAR
prone, taps 1.2 s apart, the recorder's `gi` per round):

| page | rounds on the server's index |
|---|---|
| index of the round's own tick | 4 of 11; the rest 1 high (the page's round a tick after the server's) |
| less the lag, the press noted with the words | 13 of 15; both misses 1 low, presses in a frame with no tick, which the old hold's lag of 1 was applied to |
| less the lag, the press noted before the step | 5 of 5, then the other session on the lab restarted the round and the server's soldier fired no more. Re-derived from the previous run's logs, its two misses come out on the server's index |

Where the page is still off: a hitch's merge runs a group of words as one
record under its newest serial, so a round pressed on an older word of the
group draws a few indices later than predicted; a quiet page's idle records
take serials the page never sees, counted from the next ack. Both last until
the next ack.

**The late round, fixed the same day.** The page's own round left a tick or
more after the server's when the press frame ran ticks, which was latency
on every shot. The hand weapon's trigger half now runs before the step
(`hand-fire.js` `footTrigger`, called from map.html `frame` between the
input and `simulate`), so a press fires on the first tick of the frame that
sampled it, as the server fires it (`tests/test_hand_trigger_tick.py`: the
2-tick frame's press on its own tick, not 2 late; held cadences unchanged;
a semi-auto click one round). The lag term above then measures 0 and stays
as a guard. A seat's guns read the word's `fire` inside the tick
(`world-vehicle-tick.js`) and were never late. Still open: a `fireDelay`
wind-up counts down on the frame clock, so below 30 fps a grenade can leave
a tick late; the round aims down the camera the previous frame placed,
which misses that frame's look delta, as before the fix; and the index law
for a seat gun is the same `fireBarrel` but was not measured on the lab.
Neither page change has been rerun against the lab since the round restarts.

`tests/test_human_deviation.py` holds the lab's 30 rounds
(`tests/fixtures/dev_index_bar_prone.json`), the page's prediction through
the sidecar's own sender (merges and idle records included) and the dice.

## 43. Kicks, bans and server closes end the session; the vanished players (2026-10-24)

**What a server sends.** Every kick and ban leaves through `GameServer::kickPlayers`
(ledger RECON-10): an admin's or a server manager's `admin.kickPlayer` (BFSM 2.0
runs BF1942-AUSTRALIA), a won kick vote, `TKPunish`, a CD-key refusal and
PunkBuster all queue the player there. It says "Player <name> was kicked from the
server." to everyone, removes the player, and closes the connection with 0x15 (0x16
when the key is banned) and the kick's reason text as the Disconnect's message.
The text is empty unless the kick carried one (`kickPlayer(int, const char*)`).
The only other closes the server chooses are 0x0d and a malformed packet
(`processReceivedPackets`). A level change is 0x19 after GameStatus 5 (section 29),
and a timeout is 0x0a.

**What retail shows.** Its disconnect box (RECON-11) puts any non-empty server text
under KICKED FROM SERVER. Without text it falls back to BANNED FROM SERVER,
DISCONNECTED FROM SERVER and the CD-key and data lines.

**The sidecar now** (`sidecar/rejoin.mjs`):

- `classifyDisconnect` gives kicked, banned, level-change, drop or closed. Only a
  level change and a drop (0x0a, the server's or the session's own 20 s watchdog)
  rejoin (`rejoinable`). 0x0d from the server and any reason it does not know are
  `closed` and final. Before this change they rejoined at once.
- A kick line in the server's chat that names this player (`kickNoticeFor`: the
  engine's own line, or a server manager's, with 0x80 read as a space) turns the
  next drop within 10 s into the kick. A line that says "will" or "warn" does not.
- A final disconnect is written as a `k:"e", e:"serverLeft"` row with `kind`,
  `reason`, `title` (the retail heading) and `text` (the server's message, else the
  chat line) and `final: true`. The row goes to the page and to the recording. The
  page's state row becomes `kicked`, `banned` or `closed` with the same title and
  text. The sidecar then stops: no probe, no second ConnectRequest, and the process
  exits 1.
- A ConnectDenied carries the lexicon's line as `text` (server full, password,
  banned, version).

**The page now** (`viewer/net-room.js`) raises the SERVER modal with the retail
heading, the server's text and the reason code. MAIN MENU (`play/index.html`)
replaces RETRY, PLAY SOLO stays, the pointer lock is released, and the modal sits
above the briefing and the deploy screen (`#roomIssue.ri-final`). Checked headless
against a fake sidecar fed from run 1: KICKED FROM SERVER, "Kicked for teamkilling",
code 0x15, MAIN MENU focused.

Tests: `tests/test_sidecar_rejoin.py` covers the classification, the kick lines,
what the page is told, and a server close at the start and in the middle of a
rejoin. `tests/test_sidecar_kick.py` runs the real sidecar against a fake server
that accepts and then sends one Disconnect. After 0x15, 0x16 and 0x0d the server
hears nothing more and the page gets one final row. After 0x0a the sidecar probes.

**The vanished players of run 1 (`sidecar-2026-10-24-11-45-43`).** Not reproduced.
The causes the recording rules out:

- The feed shows no `setLevel` after 0.35 s, no `destroyPlayer` and no disconnect.
  The sidecar sends the page exactly the recorded rows, plus `server`, `me` and
  `ack`.
- `net-sidecar.js` driven in node with every row of the run keeps 64 players in its
  roster to the end. The same holds for a page that joins from the sidecar's live
  snapshot at 290 s.
- A headless page fed the run in real time from 190 s, by a fake sidecar that serves
  the snapshot and then the rows, kept 63 remotes in its roster and drawn to the end.

The page's scoreboard and its drawing both read the roster only while
`room.roomJoined`, so a world and scoreboard that both empty point at the page
leaving its room without the modal, or at an error in the page's own frame, rather
than at the feed. The sidecar's console log of the run was not kept, so a page
reload or reconnect cannot be ruled out. The instrumentation for next time:

- the sidecar logs each page connect, with the snapshot's player and object counts,
  and each page socket close;
- `net-sidecar.js` raises a `rosterDrop` row when one row takes away half the roster
  or more, and the page writes it to the message log and the console with the row
  kind that did it;
- `netTeardownRoom` logs "left the server feed" with its caller's stack whenever it
  leaves a joined server;
- a feed row that throws in the page is written to the message log, once every ten
  seconds, instead of being lost without a trace.

Keep the sidecar's console output (`... 2>&1 | tee sidecar.log`) with the recording
when this shows again.

**Found (same day, run `sidecar-2026-10-24-12-52-46`).** The second time it
happened the owner had just killed someone with the engineer's No4. The
sidecar's log shows "the page left", two socket closes and no further page
connect, while the sidecar stayed on the server. The page had sent its own
leave. The only page path that sends one without a reload is `netTeardownRoom`.
`net-room.js` ran it on `beforeunload`.

Crouch is left Ctrl and reload is R, so reloading the bolt-action while crouched
is the browser's Ctrl+R. Mid-play `page-input.js` answers that beforeunload with
the "leave site?" prompt. The page had already left the server by the time the
prompt was answered, and a player who chose to stay was left on an empty field
with no modal.

Reproduced headless against the fake sidecar replaying the run: a reload whose
prompt is dismissed left the page disconnected (leave, two closes, no
reconnect). The teardown now runs on `pagehide`, which fires only when the page
really goes. With the prompt dismissed the page stays connected with 63 remotes.
With it accepted the page sends its leave and reconnects after the reload.
`tests/test_sidecar_page_unload.py` holds the rule: only the prompt may listen
for beforeunload.
