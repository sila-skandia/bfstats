# Input: team, kit, spawn and the `PlayerAction` stream

Read from `bf1942_lnxded.static` (1.61 Linux dedicated server, the binary the
lab runs) and implemented in `tools/bf1942-models/sidecar/input.mjs`. This is
roadmap phase E: the outbound half of playing — what turns the sidecar from an
observer into a client. Everything below was re-read for this note; the row
citations (W-1…W-5, D-1…D-6) are the ledger's and are not restated.

| function | address | what it settles |
|---|---|---|
| `PlayerActionManager::transmit` | `0x08148190` | the input block: 4-bit count, signed 32-bit first serial, records |
| `PlayerAction::writeToStream` | `0x08148750` | the record: six 12-bit axes, then the u32 mask |
| `PlayerAction::readFromStream` | `0x081486f0` | the reader of the same layout (the law) |
| `PlayerAction::set` | `0x081128a0` | channel↔axis mapping and the whole button bit map |
| `PlayerAction::get` | `0x0815c5a0` | the decode law and the button bit map read back |
| `floatToFixed` | `0x08113480` | the encode law (W-2) |
| `PlayerActionManager::processReceivedPacket` | `0x081484e0` | the server's reader: 4-bit count, signed first serial |
| `PlayerActionManager::processRcvdPlayerActions` | `0x08148470` | the serial check, and the null-player deref |
| `PlayerActionManager::add` | `0x08148120` | the client's own buffer caps at 3 records |
| `Input<PlayerInputMap,55>::setInput` | `0x0815cfc0` | a digital channel is written as `(float)bool` |
| `Input<PlayerInputMap,55>::isInputMapped` | `0x08056210` | map word bits at `+0xdc`/`+0xe0` are channel indices |
| `SetTeamEvent::deSerialize` / `::serialize` | `0x0811e340` / `0x0811e390` | u8 team, u8 playerId |
| `ChangeKitEvent::deSerialize` / `::serialize` | `0x0811ed10` / `0x0811ed50` | u8 kit |
| `SpawnRequestEvent::deSerialize` / `::serialize` | `0x0811cd20` / `0x0811cd70` | u8 spawnGroup, u8 spawnPoint |
| `CreatePlayerAckEvent::deSerialize` | `0x0811cc50` | u8 playerId |
| `GameServer::handleGameEventManagerEvent` | `0x08135cb0` | where the three are consumed (jump table `0x086c035c`) |
| `GameServer::changeKit` | `0x08158700` | the kit means `(team << 8) \| slot` |
| `GameServer::spawnPlayer` | `0x0814c990` | the spawn group is `player+0x90`, read back at spawn |
| `BFSpawnPointTemplate::createObject` | `0x0816a650` | a level's spawn group is 0..0x7f |
| `BFPlayer::init` | `0x08052c70` | the same 0..0x7f bound, and `+0x80` is a byte in the stats record |
| `BFPlayer::BFPlayer` | `0x08050a40` | `+0x7c` team (starts −1), `+0x80` 0, `+0x90` 0 |
| `BFSoldier::handlePlayerInput` | `0x08273c70` | what the sim does with the axes (±0.1 dead zone → ±1) |
| `ClientConnection::getPlayer` | `0x08116050` | returned without a null check by SpawnRequest's case |

Reproduce any row with

```
cd features/bf1942-engine-reference
TMPDIR=/tmp ./lnxded/decompile.sh /tmp/in '<0xADDR> [...]'
c++filt < /tmp/in/0xADDR.c   # Ghidra emits the file without the 0x prefix
```

The case labels under the `0x08135cb0` switch were read from the jump table at
`0x086c035c` (file offset `0x67835c`; entry `i` is the type of event `i`) and
then confirmed by disassembling each: `0x2f` → `0x08136be7`, `0x39` →
`0x08136d11`, `0x3e` → `0x08137080`, `0x11` → `0x081366e1`, `0x08` →
`0x08135d17`.

## 1. The input block (stream 0)

`PlayerActionManager::transmit` (`0x08148190`) reserves 4 bits, then, when the
buffer holds at least one record, writes a **signed 32-bit first serial** from
`manager+0x28` (the serial of buffer entry 0) and a `PlayerAction` per entry
(`+0x14`, stride `0x18`), and finally patches the count into the reserved 4
bits. A count of 0 writes no serial and no records; the block is then only the
4 bits, which the server reads as a no-op.

`PlayerActionManager::processReceivedPacket` (`0x081484e0`) is the byte-for-byte
reader: `readUnsigned(4)` count; if `0 < count`, `readSigned(32)` first serial;
then `count` × `PlayerAction::readFromStream`. Record *i* is stored with serial
`firstSerial + i` (`iVar4 + iVar7`) at manager entry `+0x88`, and
`processRcvdPlayerActions` (`0x08148470`) pushes each into the player's
ActionBuffer only when `lastSerial < serial` (stored at manager `+0x68`) — D-4.

**The client's own cap is 3 records**, not 15: `PlayerActionManager::add`
(`0x08148120`) does `count = min(count + 1, 3)` and writes entry `count - 1` of
the same `0x18`-stride array, so `transmit` can never be handed a fourth. The
wire count field is 4 bits (the server would parse up to 15 into a 4-entry array
— `0x74 + 15*0x18` walks past it — so more than 3 is a corruption, not just a
violation). `inputPayload` refuses a fourth record for this reason.

```
input block = mask(6) | count(4) | [firstSerial(s32) | record × count]
record      = yaw, pitch, roll, throttle, mouseLookX, mouseLookY (12 bits each)
            | buttons (u32)                                   = 104 bits
```

One action is `6 + 4 + 32 + 104 = 146` bits, i.e. 19 bytes as the `BitWriter`
emits it (the block starts at bit 6, not on a byte boundary — the engine packs
it the same way, `writeBits` 0x083db030 is LSB-first).

## 2. `PlayerAction`, and the encode/decode round trip

`writeToStream` (`0x08148750`) writes the six `short`s at `+0, +2, +4, +6, +8,
+10` with `writeUnsigned(.., 12)` and the dword at `+0xc` with 32 bits.
`readFromStream` (`0x081486f0`) reads the same. `writeToStream`/`readFromStream`
cover bytes 0–15; byte 16 (ch48) is never serialized (W-4).

Channel order and meaning come from `PlayerAction::set` (`0x081128a0`), which
packs `PlayerInput` channel *i* into action channel *i* (gated by map word bit
*i*), and from `PlayerAction::get` (`0x0815c5a0`), which unpacks the same way.
The channels are `c_PIYaw, c_PIPitch, c_PIRoll, c_PIThrottle, c_PIMouseLookX,
c_PIMouseLookY` — **Yaw, Pitch, Roll, Throttle, MouseLookX, MouseLookY**.

Quantisation, checked twice over:

- **encode** = `floatToFixed(v, 12, 16.0)` (`0x08113480`): `v/16` clamped to ±1,
  then `round((1<<12)−1 · (v/16 + 1) · 0.5)`, i.e.
  `round(4095 · (clamp(v/16, −1, 1) + 1) / 2)`.
- **decode** = `PlayerAction::get` (`0x0815c5a0`): `((2n/4095) − 1) · 16`,
  ×100, `frndint`, ÷100 — rounded to 0.01 (W-3).

What `input.mjs` does about it (`selfTest()`, 12 checks, all pass):

```
cd tools/bf1942-models/sidecar
node --input-type=module -e "import('./input.mjs').then(m => { m.selfTest(); })"
```

| check | result |
|---|---|
| `encodeAxis` vs the law re-derived from W-2, 1281 samples over ±20 | max delta **0** |
| corner values | 0 → **2048**, +1 → **2175**, −1 → **1920**, +0.5 → **2111**, ±16 → **4095 / 0**, ±32 saturates |
| `decodeAxis` vs the law re-derived from W-3, all 4096 codes | max delta **0** |
| round trip `decode(encode(v))` over ±16 at 0.005 steps | max error **0.0050** (the 0.01 decode quantum; the 12-bit step is 0.0078) |
| centre and full deflection | exactly 0.00, +1.00, −1.00 |
| payload vs an **independent** LSB-first sign-and-magnitude packer (no shared code with `bitstream.mjs`) | byte-identical, 19 bytes / 146 bits |
| payload vs the repo's own `writeActionBlock` (`events.mjs`) | byte-identical |
| decode round trip of an encoded record | axes, buttons, count, mask and serial all read back |
| > 3 records in one packet | refused |

So the encoder is byte-compatible with the writer the repo already had, and the
pair of laws round-trips inside its own 0.01 quantum.

## 3. The axes: meanings and ranges

A channel value is in the engine's own units: a **digital control writes exactly
1.0** (`Input::setInput` `0x0815cfc0` stores `(float)bool` into channel *i* at
`+4i`), and an analogue axis lives in [−1, 1]. The `/16` in `floatToFixed` is
headroom **above** 1.0, not the scale of full deflection: the wire clamps at
±16, which the mouse-look axes are the ones to reach (a mouse delta can exceed
1.0 in a frame). A full-deflection encode is therefore `2175`/`1920`, and only
the middle 6 % of the 12-bit range is used by digital input — exactly as the
engine's own client encodes it.

What each channel drives, from the game's own control maps (the lab's
`Mods/bf1942/settings/default/controls/*.con`) and the templates'
`ObjectTemplate.setInputTo*` bindings:

| # | channel | on foot (`infantry.con`) | land/air (`land.con`, `air.con`) | templates |
|---|---|---|---|---|
| 0 | Yaw | `addKeysToAxisMapping c_PIYaw D A` — strafe right/left | D/A steer | `setInputToYaw` → rudder, wheels |
| 1 | Pitch | — | Arrow Up/Down (land); mouse Y (air) | `setInputToPitch` → elevator |
| 2 | Roll | — | mouse X (air) | `setInputToRoll` → ailerons |
| 3 | Throttle | `c_PIThrottle W S` — forward/back | W/S | `setInputToThrottle` → engine |
| 4 | MouseLookX | `addAxisToAxisMapping c_PIMouseLookX IDFMouse IDAxis_0` — the aim/turret yaw | mouse X | turret yaw (`DefgunTurret: yaw −90..90 from c_PIMouseLookX`) |
| 5 | MouseLookY | the same with `IDAxis_1` — the aim pitch | mouse Y | turret pitch |

`BFSoldier::handlePlayerInput` (`0x08273c70`) shows the magnitudes the sim
actually uses on foot: channels 0 and 3 are reduced to **their sign with a ±0.1
dead zone** (`if (0.1 < value) 1.0 else if (value < −0.1) −1.0 else 0`) before
they reach the movement code, so for a soldier only the sign of Throttle and
Yaw matters and any value comfortably past 0.1 is full speed. The aim is the
mouse-look pair, which is why a soldier turns with channels 4/5 and moves with
0/3. A vehicle's throttle and the mouse-look axes are the ones whose *magnitude*
is used.

**Open:** the exact scale of a mouse-look channel (degrees of aim per unit) is a
client-side (`BF1942.exe`) question and is not settled here — see §6.

## 4. The button bit map

The mask is the u32 at record byte 12. Bits come from `PlayerAction::set`
(`0x081128a0`, which sets them) and are confirmed by `PlayerAction::get`
(`0x0815c5a0`, which reads each bit back through
`Input::setInput(channel, bit)` — the arguments are in the decompile):
**bit *n* = PlayerInput channel `BUTTON_CHANNEL[n]`**.

| bit | channel | name | | bit | channel | name |
|---|---|---|---|---|---|---|
| 0 | 8 | Fire | | 15 | 23 | AltFire |
| 1 | 9 | Action | | 16 | 24 | Reload |
| 2 | 10 | Use | | 17 | 25 | Drop |
| 3 | 11 | MouseLook | | 18 | 26 | ToggleCameraMode |
| 4 | 12 | Walk | | 19 | 27 | ToggleCamera |
| 5 | 13 | Run | | 20 | 28 | Lie |
| 6–14 | 14–22 | MenuSelect1–9 | | 21 | 29 | Crouch |
| | | | | 22–25 | 30–33 | ch30..ch33 (unused by the soldier/vehicle maps seen) |

Buttons are **level-triggered**: a set bit means "the channel's value > 0.5",
i.e. held, not a press edge (W-1, `set`'s `0.5 < (float)channel` at every
button). ch48 (Communication) is *not* in the mask — it lives in the dword at
byte 16, which `writeToStream` never writes, so it never crosses the wire and
the receiver reconstructs it as 0 (W-4). `input.mjs` exports `BUTTON` (by name)
and `BUTTON_CHANNEL` (bit → channel), and `buttonMask('fire|crouch')`.

## 5. SetTeam, ChangeKit, SpawnRequest

All three are `GameEvent`s inside an ordinary event block (stream 1), so the
block framing of wire.md §2 applies: `u8 count, u5 index, u1 resend`, then each
event as its 7-bit type and body.

| event | type | body | proven by |
|---|---|---|---|
| `SetTeam` | `0x39` | **u8 team, u8 playerId** | `deSerialize` `0x0811e340` reads `+0xd` then `+0xc`; `serialize` `0x0811e390` writes `+0xd` then `+0xc`; the handler (`0x08136d11`) loads `mov 0xd(%esi),%al` and passes it to the GameServer vtable slot `+0x144`, and never reads `+0xc` |
| `ChangeKit` | `0x3e` | **u8 kit** | `deSerialize` `0x0811ed10` reads one byte to `+0xc`; the handler (`0x08137080`) loads `mov 0xc(%esi),%dl` and calls the GameServer vtable slot at `+0x2b8` of `+0xf8` (the indirect `changeKit`) |
| `SpawnRequest` | `0x2f` | **u8 spawnGroup, u8 spawnPoint** | `deSerialize` `0x0811cd20` reads `+0xc` then `+0xd`; `serialize` `0x0811cd70` writes `+0xc` then `+0xd`; the handler (`0x08136be7`) reads `cmpb $0x0,0xc(%eax)` as the group and `mov 0xd(%ebx),%dl` as the second field |
| `CreatePlayerAck` | `0x11` | u8 playerId | `deSerialize` `0x0811cc50` (already sent by the join; listed because it is what binds the player before any of the above is allowed) |

**What the server does with them** (all inside
`GameServer::handleGameEventManagerEvent` `0x08135cb0`):

- **SetTeam** — `getClient` then `getPlayer`, **both null-checked** (bail out),
  then `team = event[+0xd]` → the server's own `setPlayerTeam`. The event's
  `playerId` byte is ignored: the team is applied to *the connection's own*
  player. Sending our own playerId is harmless and is what `sendTeam` does.
- **ChangeKit** — `getClient` then `getPlayer`, **both null-checked**, then
  `GameServer::changeKit(player, kit)`. `changeKit` (`0x08158700`) requires the
  player's control object to be a soldier (`getTypeId() == 0x9493`), builds the
  key `(player_team & 0xff) << 8 | (kit & 0xff)` — the `shl $0x8` at
  `0x08158749` — and looks that up in the kit table at `GameServer+0x4c`,
  creates the kit object on all clients, stores the index at `player+0x80` and
  calls `BFSoldier::selectBestLoadedWeapon`.
- **SpawnRequest** — `getClient`, then `getPlayer` **with no null check**
  (`0x08136c0d`…`0x08136c1a`): if the group byte is non-zero it stores
  `group → player+0x90` and `point → player+0x80`; if the group is **0** it only
  clears `player+0x90`, ignoring the second byte. This is the shape of a spawn
  screen request. There is no reply event; the spawn itself shows up as the
  server's `createObject` for the new soldier, which is at the spawn point on
  the ground (round-replay-capture §12, "Measured conventions it relies on").

**What the ids mean, from the level data** (`bf42.rfa.ArchivePool`, the same
reader the exporter uses — `pool.read('bf1942/levels/wake/init.con')`):

- **kit is the per-team slot index** of the level's
  `game.setKit <team> <slot> <kit>` lines, keyed `team*256 + slot` exactly as
  `changeKit` computes it. Wake: team 1 → `0 Jap_Scout, 1 Jap_Assault,
  2 Jap_AT, 3 Jap_Medic, 4 Jap_Engineer`; team 2 → `0 US_Scout, 1 Us_Assault,
  2 Us_AT, 3 US_Medic, 4 US_Engineer`. (The engine's `KitType` vocabulary is
  `KTMedic/KTScout/KTAssault/KTAT/KTEngineer/KTRocketPack`, rodata
  `0x086b1de2`..`0x086b1e18`.)
- **spawnGroup is the level's spawn group id** — the `ObjectTemplate.spawnGroupId`
  of the control point (`bf1942/levels/wake/conquest/controlpointtemplates.con`:
  `The_Beach 1` (Landing_Beach), `The_Airfield 2` (The_Airfield),
  `ALLIES_southbase` 3 (South_Base), `ALLIES_north_base` 4 (North_Base),
  `ALLIES_north_village` 5 (Village)), or 64..83 for the ship-borne groups
  declared in `bf1942/Game/GlobalSpawnGroups.con` (`spawnPointManager.group
  <id>` / `groupTeam <n>`). Valid range **0..0x7f**: the spawn point template
  refuses above 0x7f (`BFSpawnPointTemplate::createObject` `0x0816a650`,
  "Spawngroup to big", string `0x086c1347`; `-1` is "No SpawnGroup set",
  `0x086c135a`) and `BFPlayer::init` (`0x08052c70`) applies the same bound when
  it copies `+0x90` into the player record.
  `GameServer::spawnPlayer` (`0x0814c990`) reads `player+0x90` back,
  `getBFSpawnPointManager` → `getSpawnGroup`, and requires the group's team to
  equal `player+0x7c` (`+0x1f`), falling back to 0 when it does not.
- **team** is 1 and 2 on a vanilla server (the lab's Wake round logs
  `spawnEvent` with `team 1`/`2` and `pickupKit` names `Jap_*`/`USMarine_*`;
  `BFPlayer::BFPlayer` `0x08050a40` starts the team at **−1** = none). The
  `CreatePlayer` request's team is a **3-bit** field and 0 means "server, assign
  me" (the capture's join sends team 0; `createPlayer` closes the connection,
  reason 0xd, if it fails).

**Two spellings of the same field, and the order it forces.** `SpawnRequest`'s
second byte and `ChangeKit`'s kit byte both land on **`BFPlayer+0x80`**
(`0x08136c33` and `0x081588c8` — both read at the instruction level), and
`BFPlayer::init` copies that byte into the stats record at `+0x53`. So the two
meanings share one field and the **last one sent wins** it. `spawnSequence`
sends ChangeKit *before* SpawnRequest (the spawn-screen order) and the spawn
request's point defaults to 0, which overwrites the field with 0; if a live run
shows the kit not applying, the reverse order — SpawnRequest, then ChangeKit —
is the first thing to try. This is not settled from the binary: no reader of
`+0x80` as a *spawn point* was found (`spawnPlayer` reads `+0x90` and a bool
from the player's `vt+0x5c`), while `changeKit` definitely writes the kit index
there. §6, item 3.

## 6. The crash rules, the rate, and the idle policy

**Three null-deref rules, all from the handler and the manager.** The server
binds a `BFPlayer` to a connection while it handles `CreatePlayer`; before that:

1. **SpawnRequest null-derefs** — `0x08136c0d` calls `getPlayer()` and
   `0x08136c1a` stores through the result with no check.
2. **The input stream null-derefs** — `processRcvdPlayerActions` (`0x08148470`)
   loads `*(manager+0x70)` (the player, `setPlayer` `0x08148110`) and
   dereferences `+0x144` (the ActionBuffer), so a *single* input datagram before
   the player exists is a fault, not a dropped input.
3. SetTeam (`0x08136d3a`) and ChangeKit (`0x081370a5`) **are** checked and
   simply do nothing.

This is the same class of bug as J-8 (ChallengeResponse with no player). The
guards in `input.mjs` therefore are not politeness: `InputSender` will not send
before `session.joined`, and `sendTeam`/`sendKit`/`sendSpawnRequest` throw when
`session.me.playerId` is null. **Do not "test" rule 1 or 2 on a shared server.**

**Rate.** The server steps a fixed 30 Hz and consumes exactly one action per
player per tick (D-1, D-3), with a buffer of 4 that drops the oldest (D-2) and
`> 9` pending collapsing to 1 (D-4). So:

- **30 Hz is the intended rate** (`InputSender`'s default, and the README's
  "sending input 30 times a second"). It matches the tick law.
- **Faster is not harmless**: pending actions are 1-3 ticks stale by the time
  they are consumed (drop-oldest), i.e. up to ~100 ms of added input latency,
  and past 4 the older ones are discarded entirely. `rate` is clamped to ≤ 60
  and 30 is what to use; a page that samples at 60 Hz is down-sampled by
  taking the newest state each tick.
- **Slower starves ticks**: at 29 Hz the server simulates ~1 tick a second with
  zero input (D-4's empty buffer), a one-frame stutter every second, which is
  why the sender schedules on wall-clock slots (a self-correcting accumulator)
  rather than a bare `setInterval`, whose drift would push the average below 30.
- **The serial** is a signed 32-bit that must be *strictly greater* than the
  last one the server kept (D-4): `input.mjs` starts at 1 and increments per
  record, and `writeSigned(32)` gives 31 magnitude bits, so it wraps to 1 at
  `0x3fffffff` (~1.1 years at 30 Hz) rather than going negative. Retransmitting
  an action is pointless (the server drops it) — unlike events, input is **not**
  reliable: a lost input datagram is simply not re-sent, and the buffer law
  covers the gap.

**When the page stops sending.** The sidecar owns this, not the page: a
background tab's timers are throttled to ~1 Hz, so input must not depend on
page timers. `InputSender`'s `idle` option, with `idleAfterMs` (default 250 ms):

| mode | what goes on the wire | effect |
|---|---|---|
| `'zero'` (default) | a neutral record at the tick rate | the soldier stops; the wire rhythm and the sequence numbers stay steady, which keeps the send window and any capture uniform |
| `'hold'` | the last record, repeated | a held key stays held (W held = keeps running) — the mode that can run away if the page dies holding a key |
| `'stop'` | nothing | fewest packets; the server's empty buffer is simulated as zero input anyway (D-4) — but it is then the session's own 2 s ping that keeps the connection alive |

All three leave the server simulating zero input if the page never sends, so the
choice is traffic and behaviour, not correctness. `'zero'` is the default
because it is the one that cannot leave a key stuck down and cannot leave the
connection silent.

## 7. What is checked, and what is not

**Checked here (no lab involvement, no server touched):**

```
cd tools/bf1942-models/sidecar
node --input-type=module -e "import('./input.mjs').then(m => { m.selfTest(); })"   # 12 checks, §2
```

and, from scratch, an integration run in two parts — all passing:

- the sender against a stubbed session: nothing is sent before `joined`
  (~4 ticks skipped, 0 datagrams); `rate: 30` produced **30 datagrams in
  1.000 s**; all 30 decode as `count 1`, mask `0x1`, strictly increasing
  serials, neutral axes/buttons while idle; a page update reaches the wire
  (Throttle 1.00, Fire held) and an idle page falls back to neutral in `'zero'`
  mode; `'hold'` keeps the last record and `'stop'` sends nothing; the spawn
  sequence queues SetTeam → ChangeKit → SpawnRequest with our own playerId, is a
  single SpawnRequest when the team already matches and no kit is asked for,
  and refuses before a player exists and above group 127.
- the whole path through the **real** `Session`/`NetConnection` against a fake
  UDP server that completes the connect handshake and sends a real
  `SimulationEvent`: the session opened its `joined` gate on that event and the
  input datagrams came back as 11 well-formed type-0xf Data datagrams, mask
  `0x1`, `count 1`, 146-bit blocks, throttle `2175` (+1.00), buttons `1`, serials
  `1..11` strictly increasing.

**Still to check live (the parent's step 5 run, on the lab):**

1. **That the server accepts the input block at all** — the lab's event log
   should show `player_location` changing for the sidecar's player while
   Throttle is held, and no `disconnectPlayer`. This is the load-bearing check:
   everything above proves the bytes are the engine's, not that the server
   reads them where we think.
2. **Which tick the input lands on.** Whether one action per tick at 30 Hz keeps
   a pending action in the buffer (no stutter) or starves it; if it stutters,
   31-32 Hz is the knob, and the `spawnEvent`/`player_location` timeline says
   which.
3. **The kits.** `ChangeKit(0..4)` should make `lab.py status` / the log's
   `pickupKit` name print `Jap_*`/`USMarine_*` per the §5 table. If the kit is
   the wrong one, first try swapping the order of ChangeKit and SpawnRequest
   (the shared `+0x80` field, §5) before doubting the index.
4. **The spawn.** Whether `SpawnRequest(1..5, 0)` spawns at the named control
   point on the Wake lab (1 = Landing Beach, 2 = The Airfield, 3 = South Base,
   4 = North Base, 5 = Village), and what the second byte does — including
   whether it is in fact the *kit* rather than a point, which is what `+0x80`
   suggests.
5. **The aim scale.** A mouse-look value of 1.0 in each of MouseLookX/Y and the
   change seen in the ghost body's `twist`/`pitch` (which are degrees, per
   `decodes/soldier-residual.md` §3) settles the degrees-per-unit the page needs
   for a mouse-look-to-aim mapping. Not readable in the dedicated server.
6. **SetTeam before spawning.** The binary says a non-zero team is honoured and
   the playerId is ignored; a live `SetTeam(2)` then spawn should show
   `spawnEvent team 2` and the `USMarine_*` kits.
7. **That nothing above panics the server**: rule 1 and 2 predict a crash on an
   early SpawnRequest or an early input datagram. Do not test that on a server
   anyone else is using.

## 8. What `session.mjs` needs (not changed here — this wave does not own it)

`input.mjs` needs **nothing new**: it is written against the public surface that
already exists — `session.queue(name, body)` for the three events (the session's
own reliable event block, with resend), `session.conn.sendData(payload, tag)`
for the input datagrams, and the public `session.joined` / `session.me`. The
integration run above exercised exactly that. The changes worth making when
someone owns the file:

1. **Move the player gate into the session.** Add
   `sendInput(payload, tag = {})` that throws unless
   `conn.state === 'connected' && this.joined` (the §6 rule 2 crash), and have
   the sender call it instead of `conn.sendData`. One gate, every caller.
2. **Bundle input with events, optionally.** Today `_flush` writes
   `mask = EVENTS`; with a pending input it should write
   `mask = EVENTS | INPUT` and the blocks in **slot order — the input block
   first, then the event block** (the receiver hands streams to the managers in
   slot order), tagging `{ block, input: serial }`. This saves a datagram when
   both are pending and is what a real client does. Optional: the standalone
   datagram works and is what the integration run proved.
3. **Count input in the session's stats** (`inputSent`, plus a `sent`-style
   event for input datagrams), so `sidecar.mjs`'s end-of-run line and the review
   log can show it.
4. **Track our own team on the server's echo.** `_handle('CreatePlayer')` sets
   `me.team` only on the first non-remote CreatePlayer, so after a SetTeam the
   session still believes the old team and `spawnSequence` would re-send it.
   `if (!ev.isRemote && ev.playerId === this.me.playerId) this.me.team = ev.team;`
   fixes that (`SetTeamEvent` has no server→client reply of its own).
5. **A lazily-created sender**: `session.input ??= new InputSender(session)` so
   `join.mjs`, `sidecar.mjs` and the future page route share one sender. The
   inbound page message ("input" over the WebSocket) is phase F — `wsserver.mjs`
   today only broadcasts, it needs a `message` handler that calls
   `session.input.setInput(JSON.parse(msg))`.

## 9. Ledger rows this note would add

Not written to `features/bf1942-engine-reference/ledger.md` in this wave (that
file is not part of the deliverable). Suggested, with the evidence above:

- **W-6**: the input block's count field is 4 bits but the *client's own*
  `PlayerActionManager` holds at most **3** records (`add` `0x08148120`), so a
  conforming client never sends 4; the server parses up to 15 into the same
  4-entry array. Closes R-2's open "client batches ≤ 3" question as a
  client-side buffer limit rather than a wire limit.
- **W-7**: a digital input channel is written as `(float)bool` = **1.0**, and
  the channels are ±1 with the ±16 of `floatToFixed` as headroom above full
  deflection (`Input::setInput` `0x0815cfc0`); on foot `BFSoldier::handlePlayerInput`
  `0x08273c70` dead-zones X/Yaw at ±0.1 and takes the sign.
- **W-8**: `SetTeamEvent`'s `playerId` byte is ignored by the server and the
  team is applied to the connection's own player (`0x08136d11`); `ChangeKit`'s
  kit is the level's per-team `game.setKit` slot, keyed `(team << 8) | slot`
  (`GameServer::changeKit` `0x08158700`).
- **W-9 / a crash row**: SpawnRequest (`0x08136c0d`) and the input stream
  (`processRcvdPlayerActions` `0x08148470`) both null-deref with no player bound,
  like J-8; SetTeam and ChangeKit are checked.
- **W-10**: `SpawnRequestEvent`'s two bytes are (spawnGroup, spawnPoint) on the
  wire and the server writes them to `BFPlayer+0x90` / `+0x80`; `+0x80` is also
  where `GameServer::changeKit` stores the kit index, so the meanings share a
  field. Spawn group 0..127 (`BFSpawnPointTemplate::createObject` `0x0816a650`).
