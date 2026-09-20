# The netcode — the wire, the tick, the join

BF1942's multiplayer architecture as verified 2026-09-20: an authoritative
server stepping the same fixed 30 Hz simulation the client runs, consuming one
buffered `PlayerAction` per tick per player, with the client predicting its own
player from the same actions it sends and overwriting remotes from 0.1 s ghost
state. Read for
[`features/netcode-play-multiplayer/`](../../netcode-play-multiplayer/README.md)
(the P0 research phase and P2's wire format). Every claim below was re-derived
from the binaries by an independent verifier whose wording is binding; ledger
rows W-1…W-5, D-1…D-6, J-1…J-4, P-1/P-2, R-1/R-2. All addresses
`bf1942_lnxded.static` unless marked client.

Two of the design doc's assumptions are overturned here before anything else:
`operator<<`/`>>` are **console name helpers, not the wire format** (W-5), and
IService/IJoinService/IHostService are **empty stubs with no handshake** (J-2).

## 1. The wire: `PlayerAction`, 104 bits

The engine's input record is `dice::bf::PlayerAction`, serialized by
`writeToStream` (`0x08148750`) and read by `readFromStream` (`0x081486f0`):

- **Six 12-bit channels over bytes 0–11** — `writeUnsigned(stream, 12)` /
  `readUnsigned(stream, 12)` on a `short[0..5]` — in fixed order
  **Yaw, Pitch, Roll, Throttle, MouseLookX, MouseLookY**.
- **A 32-bit button mask at byte 12** (bytes 12–15).
- **104 bits total; byte 16 is never touched.**

The channel order is confirmed by `PlayerAction::set` (`0x081128a0`), where
input channel index 0..5 packs into action channel 0..5 and the input-mapped
word's bit i gates input channel i, and by the channel-name rodata at
`0x086c86a5` (`c_PIYaw … c_PIPitch … c_PIRoll … c_PIThrottle … c_PIMouseLookX
… c_PIMouseLookY`), the same names the console operators print.

**The quantization law.** Encode is `floatToFixed` (`0x08113480`): `v/16.0`,
clamped to ±1 (`>1.0→1.0`, `<-1.0→-1.0`), then `(1<<bits)−1 · (v/16+1) · 0.5`.
At 12 bits: **`round(4095 · (clamp(v/16, −1, 1) + 1) / 2)`** — four bits of
headroom above 1.0, the same fact GUN-2b's open calibration question rests on.
Decode is `PlayerAction::get` (`0x0815c5a0`): `n/4095.0`, ×2, −1, ×16.0, then
`×100, frndint, ÷100` — i.e. **`((2n/4095) − 1)·16` rounded to 0.01**, gated
per channel on `isInputMapped`. Constants as raw bytes: −1.0f `0x86b05ec`,
0.5 `0x86be450`, 4095.0 `0x86c0cf0`, 16.0 `0x86c0cf8`, 100.0f `0x86b01ac`,
16.0f `0x41800000` pushed at every channel in `set`.

**Buttons.** The mask's bits map to the `PlayerInput` channels: **bit 0 =
Fire (ch8), 1 = Action (9), 2 = Use (10), 3 = MouseLook (11), 4 = Walk (12),
5 = Run (13), 6–14 = MenuSelect1–9 (14–22), 15 = AltFire (23), 16 = Reload
(24), 17 = Drop (25), 18 = ToggleCameraMode (26), 19 = ToggleCamera (27),
20 = Lie (28), 21 = Crouch (29), 22–25 = ch30..ch33**, and the byte-16 word's
bit 0x100 = ch48 Communication. Buttons are **level-triggered**: `0.5 < value`
at every channel in `set` (the flag bit must also be set). ch48 lives at byte
16, which `writeToStream`/`readFromStream` never cover — **it never crosses
the wire**, and receivers reconstruct it as 0 from an initialized-zero
`PlayerAction` (W-4).

**What the wire format is NOT.** `operator<<(ostream&, PlayerInputMap)`
(`0x081d89f0`) is a 56-case `switch(index)` that sets a pointer to a name
string in rodata (a jump table at `0x086c88c4`; unlisted indices land on the
shared default) — no serialization of any kind. `operator>>(istream&,
PlayerInputMap&)` (`0x081d8bc0`) reads a `std::string` and runs a cascade of
`string::compare` against the same names to assign a channel index. Both are
console/name helpers used by the input-map print/parse console commands.
Neither touches `PlayerAction` or 12-bit encoding. The design README's "the
`>>` operator is the spec for our wire format" is overturned (W-5).

## 2. The delivery law

`GameServer::update` (`0x08132940`) fixes the per-frame order (D-1):

```
processLocalPlayersInputs → processReceivedPackets
→ per-tick loop over vtable+0x140 = simulateFrame (0x0815c2a0)
→ updateStateMasks / updateVoteSystem / updateBanList
→ updateConnections → processGameStateAndSendPackets (the send)
→ clearPlayerActions
```

Per player per tick, with the connection remote:

- **Trim ≤ 4, drop-oldest.** `clearPlayerActions` (`0x0815bb90`) walks the
  connections and, for each player, while `4 < size` pops the OLDEST entry of
  the ActionBuffer at `BFPlayer+0x144`; when any trim occurred it also writes
  `player+0x174 = 0` (D-2).
- **Exactly one consume per tick.** `GameServer::simulatePlayerUpdate`
  (`0x0815bd00`) reads the FIRST ActionBuffer entry and erases it, called once
  per player from `simulatePlayersUpdate` (`0x0815bfa0`); it sets
  `player+0x14b` (D-3).
- **Empty → zeroed input.** The same function decodes the sentinel/zero action
  and runs an explicit 55-float zero loop, so a player who sent nothing is
  simulated with zero input — never skipped (D-4).
- **Receive-side seq dedupe.** `processRcvdPlayerActions` (`0x08148470`)
  `pushBack`s an action only when its serial is `> lastSerial` (stored
  `+0x68`); serially older or equal actions are dropped (D-4).
- **Backlog collapse.** When more than 9 ticks are pending, the tick count
  collapses to 1 on both binaries — server `0x08132940` (`9 < n → n = 1`),
  client `GameClient::update` `0x0048fca0` (`cmp ebx,0x9; jle` at
  `0x48fca8`–`0x48fcb1`; the bridge had lost this function, so it was
  re-derived from PE bytes) (D-4).

On the client the same law is reached from `Setup::dispatchPlayerInput`
(`0x00448520`), which ends in `Game::addPlayerInput` (`0x0040ecb0`) — a
`map<int, list<PlayerInput>>` insert per tick on `Game+0x2c` (D-5) — and is
consumed by `GameClient::processLocalPlayersInputs` (`0x00488840`): per local
player, pop the queued input, pack it with the `PlayerAction::set` twin
(`0x00483e70`), tag with the tick counter (`GameClient+0x21c`) and push into
the ActionBuffer, so the client's own buffer is byte-for-byte the wire record.
`GameClient::simulatePlayerUpdate` (`0x004b6a30`) pops exactly one entry per
tick (the `get` twin `0x004913a0`), erases it, and reaches `handleInput`
(vtable+0x30) then `performHandleUpdate` (`0x004b7680`) (D-6).

## 3. Join and disconnect

**The handshake is entirely the server's.** `GameServer::processReceivedPackets`
(`0x08137ba0`): on `receive() == 1`, allocate a `ClientConnection`
(constructor `0x081142a0`), `setConnectionId`, insert into the connection map,
send **ServerInfoEvent** and **ServerInfoEvent2**, then `initChallengeString`
+ **ChallengeEvent**, `setConnectionType(0)`, and finish with
`chokeBandwidth()` (J-1). The ctor fixes the per-connection numbers: `+0xc` =
raw bits `0x14` = **20 (the send rate)**, `+0x10` = raw bits `0x414` =
**1044 (the byte budget)**, send stream `BitStream(0x400)` = 1024 bytes. The
second BitStream ctor is invoked with no explicit argument — its default limit
was not verified. A second ClientConnection ctor (`0x08113530`, decompiled at
research time) was not re-derived by the verifier and stays open.

**The "services" are stubs.** IService / IJoinService / IHostService (client
PE vtables `0x8c37d8` / `0x8c37e0` / `0x8c3810`, loaded by the three- and
four-byte stubs at `0x4010b0`/`0x4010e0`/`0x401120` and adjacent copies) have
**every slot equal to `0x00804ae0` = `jmp ds:0x8c352c`**, a single import
stub — there is no join, host or reservation logic and no handshake anywhere
in them. The design README's "a dedicated host service, joiners connect to
it" must not be built on these classes (J-2).

**Leaving is an explicit packet.** `GameClient::disconnect` (`0x00490f00`,
client): `push 0xd; call [vtable+0x18]` at `0x490f47` sends packet type
**0xd**, then teardown — `+0x88` cleared, connection state `+0x8` and `+0xc`
set to 4, `+0x34` nulled, held objects released (J-3).

The bf42plus patch sites are the failure-mode history of the above, each
re-derived: `0x00490f4c` (inside `disconnect`; the `GameClient_disconnect_udp`
force-disconnect point), `0x00495fd2` (`force_disconnect_msg` via `0x6a7ee0`),
`0x006d8461` (`skip_spawn_screen_join`: `SpawnScreenStuff::setVisible(1)` via
`0x6cce20`), `0x004b4045` (`network_error_debug` / GameEvent deserialize
site) (J-4).

## 4. Prediction and remote entities

**The client predicts its own player from the same actions it sends.** The
per-player loop `0x004b8d70` (client, read live) takes the front pending
input, re-packs it (`PlayerAction::set` twin `0x00483e70`), decodes it (get
twin `0x004913a0`), runs `handleInput` (vtable+0x30), `performHandleUpdate`
(`0x004b7680`), registers it through `registerPlayerAction` (`0x004904f0`) and
pops the consumed entry — so the local player is stepped each tick from the
same `PlayerAction` that is registered for the wire, with the server
authoritative over it (P-1). `registerPlayerAction` itself is a small
cache-and-call body (cache `FUN_00484820(p)+0x14` into `param_1+0x1c8`, call
`FUN_004b7200`) — it does **not** re-pack or simulate; the exact
register→wire send path between it and the Connection was not re-derived
(NEEDS-MORE, cosmetic).

**Remotes are stepped at zero input, then overwritten.** `GameClient:
simulatePlayersUpdate` (`0x004b6c20`) calls `simulatePlayerUpdate`
(`0x004b6a30`) for every player without a local client (or with a not-ready
one), and `0x004b6a30` zeroes the input on an empty buffer — so remote
entities run the client's own simulation at zero input as a placeholder.
Authority arrives as **ghost state**: the server's `GhostManager::update`
(`0x08141c70`) collects dirty objects into the per-connection send set, and
the client twin `0x0048a130` (read live this round; gated on
`GameClient+0x1d8`) iterates the ghost entities, applying each through the
state-applier `0x00489ed0` and a per-entity factor `0x00489cb0`
(distance/velocity factor, flying) into `0x00498ce0` (P-2).

**There is no interpolation buffer.** The client's ghost-apply path contains
no snapshot-history or sample repository — remote state is applied as a
single current state with a computed factor, at a **0.1 s cadence** on both
binaries (`conn+0x18 = 0x3dcccccd`: server `0x08139420`, client `0x0048c520`;
0.1f confirmed at client `0x8c53cc`, twin two-timer structure with the rate
at `[esi+0xc]` and the period at `[esi+0x14]` vs 0.0 at `0x8c41ac`). The one
caveat: `0x00498ce0`, the actual transform application step, was not read, so
"how the factor maps to movement" stays unread — but the negative claim, "no
interpolation buffer like replay.js's SAMPLE_PERIOD", is confirmed as far as
read (P-2).

## 5. Rates and the choke

- Default per-connection send rate **20 Hz** (`conn+0xc`), minimum **10**,
  applied as the period `1/rate` in `processGameStateAndSendPackets`
  (`0x08139420`; identically on the client at `0x0048c520`).
- `chokeBandwidth` (`0x08132cc0`) / `setBandwidthChokeLimit`
  (`0x08132c90`): with the cap at `GameServer+0x46c`, sum `rate · (conn+0x10
  = 1044)` over the connections; while `cap < Σ`, each offending connection's
  rate is lowered by **5**, floored at 10, written through
  `changeUpdateFrequency` (`0x08132ff0`) to `conn+0xc`. `getBandwidthChokeLimit`
  (`0x08132cb0`) reads the same cap (R-1).
- The receive side reads a **4-bit count field (≤ 15)** in
  `processReceivedPacket` (`0x081484e0`); each counted entry is a full
  `readFromStream` (R-2).
- `GameServer::receive` (`0x081378d0`) is the receive path — the NetServer
  read into the per-connection BitStream at `conn+0x90`, `setMode(read)`
  (R-2).
- `GameServer::setPacketSize` (`0x08132c80`) is an **empty `return;` stub**
  (R-2).

## 6. What this means for the viewer netcode (P2)

The P2 room server and its wire format should implement the engine's own law,
which is now read rather than guessed:

- **The World input queue law.** Per player: buffer actions, trim to
  **≤ 4 dropping the oldest**, consume **exactly one per tick**, treat an
  empty buffer as **zeroed input** (never skip the player), dedupe received
  actions by **strictly increasing serial** (drop `≤ last`), and collapse a
  backlog **`> 9` ticks to 1**.
- **The P2 wire format is the `PlayerAction` record** (W-1…W-3): six 12-bit
  channels in fixed order Yaw, Pitch, Roll, Throttle, MouseLookX,
  MouseLookY, then a u32 button mask at byte 12 — **104 bits**. Encode with
  `floatToFixed` (`v/16` clamped ±1, 12-bit), decode with `((2n/4095)−1)·16`
  rounded to 0.01; buttons are level-triggered at `> 0.5`; the button map is
  W-1's (Fire bit 0 … ch33 bit 25). ch48 stays server-local and off the wire.
  Do **not** derive the format from `operator<<`/`>>` (W-5).
- **Snapshot cadence ≤ 20 Hz with no interpolation** is engine-consistent:
  the engine sends ghost state at 0.1 s and applies it as single current
  state — replay.js-style interpolation is a rendering choice the engine
  never made (P-2). The 20 Hz default and the `Σ(rate × 1044)` choke
  arithmetic are the capacity law (R-1).
- **Joining and leaving are explicit packets.** The server announces itself
  (ServerInfoEvent/ServerInfoEvent2), challenges, then choke-bandwidths; the
  client leaves with an explicit disconnect packet (type 0xd) before
  teardown. There is no host service to build — those classes are empty (J-1,
  J-2, J-3).

## Open

- **R-2's "client batches ≤ 3 actions per packet"** — the ≤ 3 cap exists only
  server-side in `PlayerActionManager::add` (`0x08148120`), reachable only
  indirectly, and a server-managed class; the client PE has no
  `PlayerActionManager` and the client send loop was not re-derivable. Not
  client-verified wire behaviour; do not build the client on it.
- **`0x00498ce0`** — the ghost transform application step was not read; how
  the distance/velocity factor maps to movement stays unread.
- **`registerPlayerAction` → wire send path** (`0x004904f0` → connection):
  not re-derived (NEEDS-MORE, cosmetic — the loop-level claim P-1 holds).
- **`0x08113530`** — the second ClientConnection ctor, decompiled at research
  time, not re-derived by the verifier.
- **J-1's second BitStream ctor** — invoked with no explicit arg; its default
  limit is unverified.
- The client's challenge-answer path (join validation) was not located.